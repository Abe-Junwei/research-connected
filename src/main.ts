import "./host-language";
import { addIcon, Plugin } from "obsidian";
import { LOGO_ICON, LOGO_SVG } from "./logo";
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
import { migrateProjectRecords, migrationRereadAccepted, normalizeProjects, previewMigration } from "./project-state";
import { clamp } from "./visual";
import { invalidateLiteratureIndex, listReadingNotes, listReadingPapers, writeReadingNote } from "./vault-note";
import { createReadingWorkflow, normalizeReadingWorkflow } from "./reading-workflow";
import { ConnectedPapersView } from "./view";
import { validSourceVersionRelations } from "./work-identity";

function persistedSettings(settings: ConnectedPapersSettings): unknown {
	const data = { ...settings } as Partial<ConnectedPapersSettings> & { stagedPapers?: unknown; graftedBySeed?: unknown };
	delete data.stagedPapers;
	delete data.graftedBySeed;
	return JSON.parse(JSON.stringify(data)) as unknown;
}

export default class ConnectedPapersPlugin extends Plugin {
	settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS };
	private pendingSave: Promise<void> = Promise.resolve();
	private migrationWriteStopped = false;
	readonly readingWorkflow = createReadingWorkflow({
		getSettings: () => this.settings,
		persist: () => this.saveSettings(false),
		listNotes: paper => listReadingNotes(this.app, paper, this.settings.literatureDoiProperty),
		listPapers: () => listReadingPapers(this.app, this.settings.literatureDoiProperty),
		writeNote: (path, expected, reading) => writeReadingNote(this.app, path, expected, reading),
	});

	async onload(): Promise<void> {
		await this.loadSettings();

		// Main-area tab. The graph pane is the product, not a sidebar card list.
		this.registerView(VIEW_TYPE, (leaf) => new ConnectedPapersView(leaf, this));

		addIcon(LOGO_ICON, LOGO_SVG);

		this.addRibbonIcon(LOGO_ICON, "Research Connected", () => {
			void this.openView();
		});

		this.addCommand({
			// Preserve the published ID used by existing hotkeys and external links.
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
		const dropLiteratureIndex = (): void => {
			invalidateLiteratureIndex();
			void this.readingWorkflow.refreshReading().catch(console.error);
		};
		this.registerEvent(this.app.metadataCache.on("changed", dropLiteratureIndex));
		this.registerEvent(this.app.vault.on("delete", dropLiteratureIndex));
		this.registerEvent(this.app.vault.on("rename", dropLiteratureIndex));
		this.addSettingTab(new ConnectedPapersSettingTab(this.app, this, this));
		registerConnectedPapersEmbed(this);
		this.app.workspace.onLayoutReady(() => { void this.readingWorkflow.refreshReading().catch(console.error); });
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
		this.migrationWriteStopped = true;
		const stored = (await this.loadData()) as (Partial<ConnectedPapersSettings> & { stagedPapers?: unknown }) | null;
		const migrateIdentity = Boolean(stored && stored.workflowMigration?.version !== 1);
		let backup = "";
		if (migrateIdentity) {
			this.migrationWriteStopped = true;
			if (!this.manifest.dir) throw new Error("Migration requires a plugin directory for backup");
			const base = `${this.manifest.dir}/data-before-work-identity-v2`;
			backup = `${base}.json`;
			for (let suffix = 1; await this.app.vault.adapter.exists(backup); suffix++) backup = `${base}-${suffix}.json`;
			await this.app.vault.adapter.write(backup, JSON.stringify(stored));
			if (!migrationRereadAccepted(stored, JSON.parse(await this.app.vault.adapter.read(backup)) as unknown)) throw new Error("Backup reread did not match; original data retained");
			const preview = previewMigration(stored?.researchProjects ?? {});
			if (preview.stopped) throw new Error(`Migration stopped: ${preview.missing}; original data and backup retained`);
		}
		const next = Object.assign({}, DEFAULT_SETTINGS, stored);
		if (next.sourceVersionRelations !== undefined && !validSourceVersionRelations(next.sourceVersionRelations)) throw new Error("Invalid saved source version relations; original data retained");
		if (next.workIdentityDecisions && (!Array.isArray(next.workIdentityDecisions) || next.workIdentityDecisions.some(item => !item || !Array.isArray(item.ids) || item.ids.length < 2 || item.ids.some(id => typeof id !== "string" || !/^W\d+$/i.test(id)) || !["merge", "separate"].includes(item.kind) || item.source !== "manual" || !Number.isFinite(item.updatedAt)))) throw new Error("Invalid saved identity decisions; original data retained");
		next.readingWorkflow = normalizeReadingWorkflow(stored?.readingWorkflow);
		const maxNodes = Number(next.maxNodes);
		next.maxNodes = Number.isFinite(maxNodes) ? clamp(maxNodes, 20, 300) : DEFAULT_SETTINGS.maxNodes;
		next.stagedPapers = normalizeStagedList(stored?.stagedPapers);
		next.graftedBySeed = normalizeGrafted(stored?.graftedBySeed);
		next.researchProjects = migrateProjectRecords(
			normalizeProjects(stored?.researchProjects),
			next.stagedPapers,
			next.graftedBySeed,
		);
		if (migrateIdentity) {
			const preview = previewMigration(stored?.researchProjects ?? {});
			if (preview.stopped) throw new Error(`Migration stopped: ${preview.missing}`);
			for (const [key, project] of Object.entries(next.researchProjects)) {
				const original = stored?.researchProjects?.[key];
				project.pending = preview.pending.filter(item => item.id.includes(`:${key}:`)).map(item => ({ ...item, paper: original?.snapshot?.nodes.find(paper => item.id.endsWith(`:${paper.id}`)), sources: ["legacy-project-snapshot"], raw: original?.paperStates }));
			}
		}
		if (migrateIdentity && Object.entries(stored?.researchProjects ?? {}).some(([id, project]) => project.snapshot && !next.researchProjects[id.toUpperCase()])) {
			this.migrationWriteStopped = true;
			throw new Error(tr("项目迁移未完成，已保留原数据及备份；请检查保存的项目格式", "Project migration could not complete. Original data and backup are retained; review the saved project format."));
		}
		next.stagedPapers = [];
		next.graftedBySeed = {};
		if (!migrateIdentity) {
			this.settings = next;
			this.migrationWriteStopped = false;
			return;
		}
		next.workflowMigration = { version: 1, backup, completedAt: Date.now() };
		const written = persistedSettings(next);
		await this.saveData(written);
		const reread: unknown = await this.loadData();
		if (!migrationRereadAccepted(written, reread)) {
			this.migrationWriteStopped = true;
			throw new Error(tr("迁移已写入但重读不一致，已停止继续写入。请用备份恢复。", "Migration was written but the reread did not match, so further writes are stopped. Restore the backup."));
		}
		this.settings = next;
		this.migrationWriteStopped = false;
	}

	async saveSettings(notify = true): Promise<void> {
		if (this.migrationWriteStopped) {
			throw new Error(tr("迁移没有完成，已停止写入。", "Migration did not finish, so writes are stopped."));
		}
		const snapshot = persistedSettings(this.settings);
		const save = this.pendingSave.catch(() => {}).then(async () => {
			await this.saveData(snapshot);
			window.dispatchEvent(new Event(notify ? "research-connected-settings" : "research-connected-project"));
		});
		this.pendingSave = save;
		await save;
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
