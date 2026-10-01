import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
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
			.setDesc("含种子论文。默认 50，建议 40–60。下次构建图谱时生效。")
			.addSlider((slider) => {
				slider
					.setLimits(20, 80, 1)
					.setValue(this.store.settings.maxNodes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.store.settings.maxNodes = clamp(value, 20, 80);
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
