import { tr } from "./i18n";
import { App, Plugin, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
	type SampleDepth,
} from "./settings-model";
import { clamp } from "./visual";

export { DEFAULT_SETTINGS, type ConnectedPapersSettings };

export interface SettingsStore {
	settings: ConnectedPapersSettings;
	saveSettings(): Promise<void>;
}

export class ConnectedPapersSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly store: SettingsStore,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [];

		items.push({
			name: tr("OpenAlex API 密钥", "OpenAlex API key"),
			desc: tr("在 openalex.org/settings/api 创建。匿名请求可能受限，具体额度以服务方为准。密钥未加密保存在库内插件数据中，可能随库同步或备份；仅向 OpenAlex 请求发送 Authorization 头。", "Create a key at openalex.org/settings/api. Anonymous requests may be limited; allowances are set by the provider. The key is stored unencrypted in vault plugin data, which may be synced or backed up. Its Authorization header is sent only to OpenAlex."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text
						.setPlaceholder(tr("粘贴 API key", "Paste API key"))
						.setValue(this.store.settings.apiKey)
						.onChange(async (value) => {
							this.store.settings.apiKey = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("联系邮箱（mailto）", "Contact email (mailto)"),
			desc: tr("可选。填写后随 OpenAlex 请求发送；格式有效时也随 Crossref 请求发送，供服务方联系。填写邮箱不保证提高请求额度。", "Optional. Sent with OpenAlex requests and, when valid, Crossref requests so providers can contact you. An email does not guarantee a higher request allowance."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("you@example.com")
						.setValue(this.store.settings.contactEmail)
						.onChange(async (value) => {
							this.store.settings.contactEmail = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("最大节点数", "Maximum nodes"),
			desc: tr("含种子文献，默认 50，可设 20–300。默认值是性能与可读性的工程折中，不是相关性最优值。下次建图生效；候选不足时实际数量较少。", "Includes the seed paper. Default: 50; range: 20–300. This is an engineering trade-off for performance and readability, not a relevance optimum. Applies to the next build; fewer candidates may yield fewer nodes."),
			render: (setting) => {
				setting.addSlider((slider) => {
					slider
						.setLimits(20, 300, 1)
						.setValue(this.store.settings.maxNodes)
						.onChange(async (value) => {
							this.store.settings.maxNodes = clamp(value, 20, 300);
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("采样深度", "Sampling depth"),
			desc: tr("候选目标：标准为参考 80、施引 40、相关 20；扩展为 200、200、50；深度为 200、200、100。深度对参考与施引各检查最多 1000 条原始记录，无 OpenAlex 密钥时仅第一页。候选目标不是最终节点数；实际请求见采样详情。下次建图生效。", "Candidate targets (references/citing/related): standard 80/40/20; extended 200/200/50; deep 200/200/100. Deep examines up to 1,000 raw records per reference or citing list, but only page 1 without an OpenAlex key. Targets are not final node counts. See sampling details for actual requests. Applies to the next build."),
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					dropdown
						.addOption("standard", tr("标准", "Standard"))
						.addOption("extended", tr("扩展", "Extended"))
						.addOption("deep", tr("深度", "Deep"))
						.setValue(this.store.settings.sampleDepth)
						.onChange(async (value) => {
							this.store.settings.sampleDepth = value as SampleDepth;
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记文件夹", "Literature note folder"),
			desc: tr("导出的单篇笔记写到这个文件夹。留空则写到库根目录。文件夹不存在时会创建。", "Single-paper notes are written here. Leave empty to use the vault root. The folder is created if it does not exist."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder(tr("例如 Literature", "e.g. Literature"))
						.setValue(this.store.settings.literatureFolder)
						.onChange(async (value) => {
							this.store.settings.literatureFolder = value.trim();
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记文件名", "Literature note filename"),
			desc: tr("可用 {{title}} {{authors}} {{year}} {{doi}} {{openalex}} {{relation}} {{project}} {{status}}。留空则用「年份 题名」。", "Tokens: {{title}} {{authors}} {{year}} {{doi}} {{openalex}} {{relation}} {{project}} {{status}}. Empty uses “year title”."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("{{year}} {{title}}")
						.setValue(this.store.settings.literatureFilename)
						.onChange(async (value) => {
							this.store.settings.literatureFilename = value;
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("文献笔记正文", "Literature note body"),
			desc: tr("留空则只写题名标题。笔记属性包含 openalex、rc-project、rc-status，有 DOI 时才写 doi。打开文献时读取关联笔记的阅读状态；来源冲突需确认，面板中的修改会同步到参与的笔记。", "Empty writes a title heading only. Note properties include openalex, rc-project, and rc-status; doi is added when available. Opening a paper reads linked notes' reading status. Conflicts require confirmation; panel changes sync to participating notes."),
			render: (setting) => {
				setting.addTextArea((text) => {
					text
						.setPlaceholder("# {{title}}\n\n{{authors}}")
						.setValue(this.store.settings.literatureTemplate)
						.onChange(async (value) => {
							this.store.settings.literatureTemplate = value;
							await this.store.saveSettings();
						});
					text.inputEl.rows = 4;
				});
			},
		});

		items.push({
			name: tr("DOI 属性名", "DOI property name"),
			desc: tr("用来识别库里已有笔记。默认 doi，也同时认这个名字。Zotero Integration 等插件若把 DOI 写在别的属性里，填那个名字。", "Used to recognize notes already in the vault. doi is always checked as well. If another plugin stores the DOI under a different property, enter that name."),
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("DOI")
						.setValue(this.store.settings.literatureDoiProperty)
						.onChange(async (value) => {
							this.store.settings.literatureDoiProperty = value.trim() || "doi";
							await this.store.saveSettings();
						});
				});
			},
		});

		items.push({
			name: tr("纳入参考文献", "Include references"),
			desc: tr("种子引用的作品。用于 bibliographic coupling（参考文献集合的重叠）。", "Works cited by the seed. Used to calculate bibliographic coupling (overlap between reference sets)."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeReferences).onChange(async (value) => {
						this.store.settings.includeReferences = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("排除已撤稿作品", "Exclude retracted works"),
			desc: tr("开启后，新建图谱时跳过 OpenAlex 标记为已撤稿的作品；关闭时保留警告并在候选排序中降权。", "When enabled, new graphs skip works marked as retracted by OpenAlex. Otherwise, they remain with a warning and a ranking penalty."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.excludeRetracted).onChange(async (value) => {
						this.store.settings.excludeRetracted = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("OpenCitations 访问令牌", "OpenCitations access token"),
			desc: tr("可选。尝试补充引用关系。令牌未加密保存在库内插件数据中，可能被同步或备份，仅发送给 OpenCitations。", "Optional. Attempts to add citation links. Stored unencrypted in vault plugin data, which may be synced or backed up; sent only to OpenCitations."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder(tr("可选 token", "Optional token")).setValue(this.store.settings.openCitationsToken).onChange(async (value) => {
						this.store.settings.openCitationsToken = value.trim();
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("Semantic Scholar API 密钥", "Semantic Scholar API key"),
			desc: tr("可选。用于候选摘要、计数与可选向量增强，以及引用边的意图和 Influential 标记。密钥未加密保存在库内插件数据中，可能被同步或备份，仅发送给 Semantic Scholar。", "Optional. Used for candidate abstracts, counts, optional vectors, and citation intent/Influential flags. Stored unencrypted in vault plugin data, which may be synced or backed up; sent only to Semantic Scholar."),
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder(tr("可选 API key", "Optional API key")).setValue(this.store.settings.semanticScholarApiKey).onChange(async (value) => {
						this.store.settings.semanticScholarApiKey = value.trim();
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("Semantic Scholar 交叉比对", "Semantic Scholar cross-check"),
			desc: tr("最终选文前，尝试在预算内补候选摘要并核对计数；缺失参考文献可回填参与连线。来源差异不等于记录错配。匹配、缓存与失败信息见采样详情；失败时使用已有证据继续建图。", "Before selection, attempts bounded abstract and count enrichment; missing references may be backfilled for links. Source discrepancies do not prove mismatches. See sampling details for matches, cache hits, and failures. Construction continues with available evidence on failure."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.s2Reconcile).onChange(async (value) => {
						this.store.settings.s2Reconcile = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("语义向量（Semantic Scholar）", "Semantic embeddings (Semantic Scholar)"),
			desc: tr("请求向量参与最终选文前的排序；只比较同模型、同维度的有效向量，实际模型见详情。缺失或限流时使用本地文本与主题。需开启交叉比对。", "Request vectors for ranking before final selection. Only valid vectors with matching models and dimensions are compared; details show the actual model. Missing data or rate limits use local text/topics. Requires cross-check."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.semanticEmbedding).onChange(async (value) => {
						this.store.settings.semanticEmbedding = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("启用 LLM 研究脉络", "Enable LLM research narrative"),
			desc: tr("关闭时不显示研究脉络入口，也不会发送任何 LLM 请求。", "When disabled, the research narrative entry is hidden and no LLM requests are sent."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.llmEnabled).onChange(async (value) => {
						this.store.settings.llmEnabled = value;
						await this.store.saveSettings();
						this.update();
					});
				});
			},
		});

		if (this.store.settings.llmEnabled) {
			items.push({
				name: tr("LLM 接口地址", "LLM endpoint"),
				desc: tr("兼容 OpenAI 风格 chat/completions 的接口地址。", "Endpoint compatible with the OpenAI-style chat/completions API."),
				render: (setting) => {
					setting.addText((text) => {
						text.setPlaceholder(tr("接口 URL", "Endpoint URL")).setValue(this.store.settings.llmEndpoint).onChange(async (value) => {
							this.store.settings.llmEndpoint = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("LLM API 密钥", "LLM API key"),
				desc: tr("未加密保存在库内插件数据中，可能被同步或备份；生成总结时仅发送给所配置的模型服务。", "Stored unencrypted in vault plugin data, which may be synced or backed up; sent only to the configured model service when generating a summary."),
				render: (setting) => {
					setting.addText((text) => {
						text.inputEl.type = "password";
						text.setPlaceholder("API key").setValue(this.store.settings.llmApiKey).onChange(async (value) => {
							this.store.settings.llmApiKey = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("LLM 模型", "LLM model"),
				desc: tr("填写所配置服务商支持的模型名。", "Enter a model name supported by the configured provider."),
				render: (setting) => {
					setting.addText((text) => {
						text.setPlaceholder(tr("模型名", "Model name")).setValue(this.store.settings.llmModel).onChange(async (value) => {
							this.store.settings.llmModel = value.trim();
							await this.store.saveSettings();
						});
					});
				},
			});

			items.push({
				name: tr("发送摘要", "Send abstracts"),
				desc: tr("关闭时只发送标题、作者、年份和引用关系；开启可提高总结质量。", "When off, only titles, authors, years, and citation links are sent. Enabling abstracts may improve summary quality."),
				render: (setting) => {
					setting.addToggle((toggle) => {
						toggle.setValue(this.store.settings.llmSendAbstracts).onChange(async (value) => {
							this.store.settings.llmSendAbstracts = value;
							await this.store.saveSettings();
						});
					});
				},
			});
		}

		items.push({
			name: tr("纳入施引文献", "Include citing papers"),
			desc: tr("引用了种子的作品。它们的参考文献列表同时作为共被引的上下文。", "Works that cite the seed. Their reference lists also provide co-citation context."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeCitations).onChange(async (value) => {
						this.store.settings.includeCitations = value;
						await this.store.saveSettings();
					});
				});
			},
		});

		items.push({
			name: tr("纳入相关作品", "Include related works"),
			desc: tr("OpenAlex 的 related_works，按主题相近补充候选节点，不直接当作边的权重。", "OpenAlex related_works add topically similar candidates; they do not directly determine edge weights."),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.store.settings.includeRelated).onChange(async (value) => {
						this.store.settings.includeRelated = value;
						await this.store.saveSettings();
					});
				});
			},
		});
		items.push({
			name: tr("帮助与反馈", "Help and feedback"),
			desc: tr("使用指南、报告问题与功能建议。支持中文或英文；提交需要 GitHub 账户，内容公开可见。请勿附上密钥或私人笔记。", "User guide, bug reports, and feature requests. English or Chinese is welcome. Submitting requires a GitHub account and is public; do not include keys or private notes."),
			render: (setting) => {
				setting.controlEl.addClass("cpo-help-links");
				for (const [text, href] of [
					[tr("使用指南", "User guide"), "https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md"],
					[tr("报告问题", "Report a bug"), "https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml"],
					[tr("功能建议", "Request a feature"), "https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml"],
				]) {
					setting.controlEl.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener noreferrer" } });
				}
			},
		});
		return items;
	}
}
