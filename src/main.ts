import { Plugin } from "obsidian";
import { tr } from "./i18n";
import { VIEW_TYPE } from "./constants";
import { registerConnectedPapersEmbed } from "./embed-block";
import { normalizeGrafted } from "./graph-edit";
import {
	ConnectedPapersSettingTab,
	DEFAULT_SETTINGS,
	type ConnectedPapersSettings,
} from "./settings";
import { normalizeStagedList } from "./staging";
import { migrateProjectRecords, normalizeProjects } from "./project-state";
import { clamp } from "./visual";
import { ConnectedPapersView } from "./view";

export default class ConnectedPapersPlugin extends Plugin {
	settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();

		// Main-area tab. The graph pane is the product, not a sidebar card list.
		this.registerView(VIEW_TYPE, (leaf) => new ConnectedPapersView(leaf, this));

		this.addRibbonIcon("git-fork", "Research Connected", () => {
			void this.openView();
		});

		this.addCommand({
			id: "open-research-connected",
			name: tr("打开 Research Connected", "Open Research Connected"),
			callback: () => {
				void this.openView();
			},
		});

		this.addCommand({
			id: "find-doi-citation-path",
			name: tr("查找 DOI 引用路径（预算内）", "Find DOI citation path (budgeted)"),
			callback: () => {
				void (async () => {
					await this.openView();
					const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
					if (view instanceof ConnectedPapersView) view.openDoiPathSearch();
				})();
			},
		});

		this.registerEvent(this.app.workspace.on("css-change", () => {
			window.dispatchEvent(new Event("research-connected-theme"));
		}));
		this.addSettingTab(new ConnectedPapersSettingTab(this.app, this, this));
		registerConnectedPapersEmbed(this);
	}

	getSettings(): ConnectedPapersSettings {
		return this.settings;
	}

	/** Note embeds call this to jump to the full graph pane on their seed. */
	openGraph(target: { kind: "doi" | "openalex"; value: string }): void {
		void (async () => {
			await this.openView();
			const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
			if (view instanceof ConnectedPapersView) view.openSeed(target);
		})();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as (Partial<ConnectedPapersSettings> & { stagedPapers?: unknown }) | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		const maxNodes = Number(this.settings.maxNodes);
		this.settings.maxNodes = Number.isFinite(maxNodes) ? clamp(maxNodes, 20, 300) : DEFAULT_SETTINGS.maxNodes;
		this.settings.stagedPapers = normalizeStagedList(stored?.stagedPapers);
		this.settings.graftedBySeed = normalizeGrafted(stored?.graftedBySeed);
		this.settings.researchProjects = migrateProjectRecords(
			normalizeProjects(stored?.researchProjects),
			this.settings.stagedPapers,
			this.settings.graftedBySeed,
		);
		this.settings.stagedPapers = [];
		this.settings.graftedBySeed = {};
	}

	async saveSettings(notify = true): Promise<void> {
		const data = { ...this.settings } as Partial<ConnectedPapersSettings> & { stagedPapers?: unknown; graftedBySeed?: unknown };
		delete data.stagedPapers;
		delete data.graftedBySeed;
		await this.saveData(data);
		window.dispatchEvent(new Event(notify ? "research-connected-settings" : "research-connected-project"));
	}

	private async openView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		const leaf = existing[0] ?? workspace.getLeaf("tab");
		if (existing.length === 0) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}
}
