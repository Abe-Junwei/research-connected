import { tr } from "./i18n";
import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Research Connected" });

		new Setting(containerEl)
			.setName(tr("OpenAlex API 密钥", "OpenAlex API key"))
			.setDesc(
				tr("在 openalex.org/settings/api 免费创建。不填也能查询，但匿名每日额度很小，用尽后会返回 429。免费密钥大约是匿名额度的 10 倍。密钥只保存在本机插件数据里，请求通过 Authorization 头发送。", "Create a free key at openalex.org/settings/api. Searches can run without one, but the anonymous daily limit is small and returns HTTP 429 when exhausted. A free key offers roughly ten times the anonymous allowance. It is stored only in local plugin data and sent in the Authorization header."),
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(tr("粘贴 API key", "Paste API key"))
					.setValue(this.store.settings.apiKey)
					.onChange(async (value) => {
						this.store.settings.apiKey = value.trim();
						await this.store.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr("联系邮箱（mailto）", "Contact email (mailto)"))
			.setDesc(
				tr("2026 年 2 月起 OpenAlex 已取消 polite pool，mailto 会被忽略，不能提高额度。如果填写，仍会附在请求上，只为兼容旧网关。", "OpenAlex retired the polite pool in February 2026. The mailto parameter is ignored and does not increase limits. If supplied, it is still sent for compatibility with older gateways."),
			)
			.addText((text) => {
				text
					.setPlaceholder("you@example.com")
					.setValue(this.store.settings.contactEmail)
					.onChange(async (value) => {
						this.store.settings.contactEmail = value.trim();
						await this.store.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr("最大节点数", "Maximum nodes"))
			.setDesc(tr("含种子论文。默认 50，标准采样建议 40–60；配合扩展或深度采样可到 300。下次构建图谱时生效。", "Includes the seed paper. Default: 50. Use 40–60 for standard sampling; extended or deep sampling can use up to 300. Applies to the next graph build."))
			.addSlider((slider) => {
				slider
					.setLimits(20, 300, 1)
					.setValue(this.store.settings.maxNodes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.store.settings.maxNodes = clamp(value, 20, 300);
						await this.store.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(tr("采样深度", "Sampling depth"))
			.setDesc(
				tr("标准：80 参考文献 + 40 施引 + 20 相关，约 5 次请求；扩展：参考文献和施引各 200；深度：各最多 1000（翻页获取，约 20 次请求，建议先配置 OpenAlex API 密钥）。下次构建图谱时生效。", "Standard: 80 references, 40 citing papers, and 20 related works in about five requests. Extended: up to 200 references and citing papers each. Deep: up to 1,000 each across pages, about 20 requests; configure an OpenAlex API key first. Applies to the next graph build."),
			)
			.addDropdown((dropdown) => {
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

		new Setting(containerEl)
			.setName(tr("纳入参考文献", "Include references"))
			.setDesc(tr("种子引用的作品。用于 bibliographic coupling（参考文献集合的重叠）。", "Works cited by the seed. Used to calculate bibliographic coupling (overlap between reference sets)."))
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeReferences).onChange(async (value) => {
					this.store.settings.includeReferences = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("排除已撤稿作品", "Exclude retracted works"))
			.setDesc(tr("开启后，新建图谱时跳过 OpenAlex 标记为已撤稿的作品；关闭时保留警告并在候选排序中降权。", "When enabled, new graphs skip works marked as retracted by OpenAlex. Otherwise, they remain with a warning and a ranking penalty."))
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.excludeRetracted).onChange(async (value) => {
					this.store.settings.excludeRetracted = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("OpenCitations 访问令牌", "OpenCitations access token"))
			.setDesc(tr("可选。用于补充 OpenAlex 缺失的引用关系。令牌只保存在本机。", "Optional. Adds citation links missing from OpenAlex. The token is stored locally only."))
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder(tr("可选 token", "Optional token")).setValue(this.store.settings.openCitationsToken).onChange(async (value) => {
					this.store.settings.openCitationsToken = value.trim();
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("Semantic Scholar API 密钥", "Semantic Scholar API key"))
			.setDesc(tr("可选。点击引用边时读取引用意图和 Influential 标记。", "Optional. Fetches citation intent and the Influential flag when a citation edge is selected."))
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder(tr("可选 API key", "Optional API key")).setValue(this.store.settings.semanticScholarApiKey).onChange(async (value) => {
					this.store.settings.semanticScholarApiKey = value.trim();
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("Semantic Scholar 交叉比对", "Semantic Scholar cross-check"))
			.setDesc(
				tr("建图时用 Semantic Scholar 批量核对每篇的被引数与参考文献数：差异悬殊的节点（通常是记录错配，如书评继承了原书引用）会在详情里标注；OpenAlex 缺失的参考文献列表会从 Semantic Scholar 回填并参与连线。失败不影响建图。", "During graph building, compare citation and reference counts against Semantic Scholar. Large discrepancies, often caused by mismatched records such as a review inheriting a book citations, are flagged in the details. Missing OpenAlex reference lists are backfilled from Semantic Scholar and used for links. Failures do not stop graph building."),
			)
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.s2Reconcile).onChange(async (value) => {
					this.store.settings.s2Reconcile = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("语义向量（SPECTER2）", "Semantic embeddings (SPECTER2)"))
			.setDesc(
				tr("随上面的批量核对一同取回 Semantic Scholar 的 SPECTER2 语义向量，用于文本相似度打分（不增加请求数，向量只存内存）。接口不可用或某篇缺向量时自动退回本地文本相似度。需先开启交叉比对。", "Fetch Semantic Scholar SPECTER2 embeddings during the cross-check for text similarity scoring. This adds no requests; embeddings stay in memory. If unavailable, scoring falls back to local text similarity. Requires the cross-check above."),
			)
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.semanticEmbedding).onChange(async (value) => {
					this.store.settings.semanticEmbedding = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("启用 LLM 研究脉络", "Enable LLM research narrative"))
			.setDesc(tr("关闭时不显示研究脉络入口，也不会发送任何 LLM 请求。", "When disabled, the research narrative entry is hidden and no LLM requests are sent."))
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.llmEnabled).onChange(async (value) => {
					this.store.settings.llmEnabled = value;
					await this.store.saveSettings();
					this.display();
				});
			});

		if (this.store.settings.llmEnabled) {
			new Setting(containerEl)
				.setName(tr("LLM 接口地址", "LLM endpoint"))
				.setDesc(tr("兼容 OpenAI 风格 chat/completions 的接口地址。", "Endpoint compatible with the OpenAI-style chat/completions API."))
				.addText((text) => {
					text.setPlaceholder("https://…/v1/chat/completions").setValue(this.store.settings.llmEndpoint).onChange(async (value) => {
						this.store.settings.llmEndpoint = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName(tr("LLM API 密钥", "LLM API key"))
				.setDesc(tr("只保存在本机；生成总结时才发送。", "Stored locally; sent only when generating a summary."))
				.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder("API key").setValue(this.store.settings.llmApiKey).onChange(async (value) => {
						this.store.settings.llmApiKey = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName(tr("LLM 模型", "LLM model"))
				.setDesc(tr("填写所配置服务商支持的模型名。", "Enter a model name supported by the configured provider."))
				.addText((text) => {
					text.setPlaceholder(tr("模型名", "Model name")).setValue(this.store.settings.llmModel).onChange(async (value) => {
						this.store.settings.llmModel = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName(tr("发送摘要", "Send abstracts"))
				.setDesc(tr("关闭时只发送标题、作者、年份和引用关系；开启可提高总结质量。", "When off, only titles, authors, years, and citation links are sent. Enabling abstracts may improve summary quality."))
				.addToggle((toggle) => {
					toggle.setValue(this.store.settings.llmSendAbstracts).onChange(async (value) => {
						this.store.settings.llmSendAbstracts = value;
						await this.store.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName(tr("纳入施引文献", "Include citing papers"))
			.setDesc(tr("引用了种子的作品。它们的参考文献列表同时作为共被引的上下文。", "Works that cite the seed. Their reference lists also provide co-citation context."))
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeCitations).onChange(async (value) => {
					this.store.settings.includeCitations = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(tr("纳入相关作品", "Include related works"))
			.setDesc(tr("OpenAlex 的 related_works，按主题相近补充候选节点，不直接当作边的权重。", "OpenAlex related_works add topically similar candidates; they do not directly determine edge weights."))
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeRelated).onChange(async (value) => {
					this.store.settings.includeRelated = value;
					await this.store.saveSettings();
				});
			});
	}
}
