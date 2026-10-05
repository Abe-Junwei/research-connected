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
			.setName("OpenAlex API 密钥")
			.setDesc(
				"在 openalex.org/settings/api 免费创建。不填也能查询，但匿名每日额度很小，用尽后会返回 429。免费密钥大约是匿名额度的 10 倍。密钥只保存在本机插件数据里，请求通过 Authorization 头发送。",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("粘贴 API key")
					.setValue(this.store.settings.apiKey)
					.onChange(async (value) => {
						this.store.settings.apiKey = value.trim();
						await this.store.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("联系邮箱（mailto）")
			.setDesc(
				"2026 年 2 月起 OpenAlex 已取消 polite pool，mailto 会被忽略，不能提高额度。如果填写，仍会附在请求上，只为兼容旧网关。",
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
			.setName("最大节点数")
			.setDesc("含种子论文。默认 50，标准采样建议 40–60；配合扩展或深度采样可到 300。下次构建图谱时生效。")
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
			.setName("采样深度")
			.setDesc(
				"标准：80 参考文献 + 40 施引 + 20 相关，约 5 次请求；扩展：参考文献和施引各 200；深度：各最多 1000（翻页获取，约 20 次请求，建议先配置 OpenAlex API 密钥）。下次构建图谱时生效。",
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("standard", "标准")
					.addOption("extended", "扩展")
					.addOption("deep", "深度")
					.setValue(this.store.settings.sampleDepth)
					.onChange(async (value) => {
						this.store.settings.sampleDepth = value as SampleDepth;
						await this.store.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("纳入参考文献")
			.setDesc("种子引用的作品。用于 bibliographic coupling（参考文献集合的重叠）。")
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeReferences).onChange(async (value) => {
					this.store.settings.includeReferences = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("OpenCitations 访问令牌")
			.setDesc("可选。用于补充 OpenAlex 缺失的引用关系。令牌只保存在本机。")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("可选 token").setValue(this.store.settings.openCitationsToken).onChange(async (value) => {
					this.store.settings.openCitationsToken = value.trim();
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Semantic Scholar API 密钥")
			.setDesc("可选。点击引用边时读取引用意图和 Influential 标记。")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("可选 API key").setValue(this.store.settings.semanticScholarApiKey).onChange(async (value) => {
					this.store.settings.semanticScholarApiKey = value.trim();
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Semantic Scholar 交叉比对")
			.setDesc(
				"建图时用 Semantic Scholar 批量核对每篇的被引数与参考文献数：差异悬殊的节点（通常是记录错配，如书评继承了原书引用）会在详情里标注；OpenAlex 缺失的参考文献列表会从 Semantic Scholar 回填并参与连线。失败不影响建图。",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.s2Reconcile).onChange(async (value) => {
					this.store.settings.s2Reconcile = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("语义向量（SPECTER2）")
			.setDesc(
				"随上面的批量核对一同取回 Semantic Scholar 的 SPECTER2 语义向量，用于文本相似度打分（不增加请求数，向量只存内存）。接口不可用或某篇缺向量时自动退回本地文本相似度。需先开启交叉比对。",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.semanticEmbedding).onChange(async (value) => {
					this.store.settings.semanticEmbedding = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("启用 LLM 研究脉络")
			.setDesc("关闭时不显示研究脉络入口，也不会发送任何 LLM 请求。")
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.llmEnabled).onChange(async (value) => {
					this.store.settings.llmEnabled = value;
					await this.store.saveSettings();
					this.display();
				});
			});

		if (this.store.settings.llmEnabled) {
			new Setting(containerEl)
				.setName("LLM Endpoint")
				.setDesc("兼容 OpenAI 风格 chat/completions 的接口地址。")
				.addText((text) => {
					text.setPlaceholder("https://…/v1/chat/completions").setValue(this.store.settings.llmEndpoint).onChange(async (value) => {
						this.store.settings.llmEndpoint = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName("LLM API 密钥")
				.setDesc("只保存在本机；生成总结时才发送。")
				.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder("API key").setValue(this.store.settings.llmApiKey).onChange(async (value) => {
						this.store.settings.llmApiKey = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName("LLM 模型")
				.setDesc("填写所配置服务商支持的模型名。")
				.addText((text) => {
					text.setPlaceholder("模型名").setValue(this.store.settings.llmModel).onChange(async (value) => {
						this.store.settings.llmModel = value.trim();
						await this.store.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName("发送摘要")
				.setDesc("关闭时只发送标题、作者、年份和引用关系；开启可提高总结质量。")
				.addToggle((toggle) => {
					toggle.setValue(this.store.settings.llmSendAbstracts).onChange(async (value) => {
						this.store.settings.llmSendAbstracts = value;
						await this.store.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName("纳入施引文献")
			.setDesc("引用了种子的作品。它们的参考文献列表同时作为共被引的上下文。")
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeCitations).onChange(async (value) => {
					this.store.settings.includeCitations = value;
					await this.store.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("纳入相关作品")
			.setDesc("OpenAlex 的 related_works，按主题相近补充候选节点，不直接当作边的权重。")
			.addToggle((toggle) => {
				toggle.setValue(this.store.settings.includeRelated).onChange(async (value) => {
					this.store.settings.includeRelated = value;
					await this.store.saveSettings();
				});
			});
	}
}
