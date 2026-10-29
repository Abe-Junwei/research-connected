import { ItemView, WorkspaceLeaf } from "obsidian";
import { mountGraphApp, type GraphAppHandle } from "./app";
import { LOGO_ICON } from "./logo";
import { VIEW_TYPE } from "./constants";
import { obsidianGetJson, obsidianPostJson } from "./obsidian-http";
import { openExternal } from "./open-external";
import { createVaultNote, lookupLiteratureNote, openLiteratureNote, rememberLiteratureNote, syncLiteratureReading } from "./vault-note";
import type { ConnectedPapersSettings } from "./settings";
import { projectWriteKey, writeProject, type ResearchProject } from "./project-state";
import type { createReadingWorkflow } from "./reading-workflow";

export interface GraphHost {
	getSettings(): ConnectedPapersSettings;
	saveSettings(notify?: boolean): Promise<void>;
	readingWorkflow: ReturnType<typeof createReadingWorkflow>;
}

export class ConnectedPapersView extends ItemView {
	private appHandle: GraphAppHandle | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: GraphHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Research Connected";
	}

	getIcon(): string {
		return LOGO_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("cpo-host");
		this.mount();
	}

	/** Rebuild the pane on a new seed, e.g. from a note embed. */
	openSeed(target: { kind: "doi" | "openalex"; value: string }): void {
		this.appHandle?.destroy();
		this.contentEl.empty();
		this.mount(target);
	}

	openDoiPathSearch(): void {
		this.appHandle?.openDoiPathSearch();
	}

	private mount(initialTarget?: { kind: "doi" | "openalex"; value: string }): void {
		this.appHandle = mountGraphApp(this.contentEl, {
			...this.host.readingWorkflow,
			getSettings: () => this.host.getSettings(),
			persistSettings: () => this.host.saveSettings(false),
			getJson: obsidianGetJson,
			postJson: obsidianPostJson,
			openExternal,
			createNote: (filename, markdown, folder) => createVaultNote(this.app, filename, markdown, folder),
			lookupLiteratureNote: (paper) => lookupLiteratureNote(this.app, paper, this.host.getSettings().literatureDoiProperty),
			openLiteratureNote: (path) => { void openLiteratureNote(this.app, path); },
			syncLiteratureReading: (paper, reading) => syncLiteratureReading(this.app, paper, reading, this.host.getSettings().literatureDoiProperty),
			rememberLiteratureNote,
			stagePaper: async () => { await this.host.saveSettings(false); },
			loadSavedProject: () => Object.values(this.host.getSettings().researchProjects ?? {}).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
		saveProject: async (project: ResearchProject, projectKey?: string) => {
			const projects = this.host.getSettings().researchProjects;
			const key = projectKey ?? projectWriteKey(projects, project.seedId);
			const previous = projects[key];
			if (projectKey) projects[key] = project;
			else writeProject(projects, project);
			try { await this.host.saveSettings(false); }
			catch (error) {
				const live = this.host.getSettings().researchProjects;
				if (live[key]?.snapshot === project.snapshot) {
					if (previous) live[key] = { ...live[key]!, name: previous.name, updatedAt: previous.updatedAt, snapshot: previous.snapshot, seedId: previous.seedId, currentView: previous.currentView, deepDives: previous.deepDives, sampleIds: previous.sampleIds };
					else delete live[key];
				}
				throw error;
			}
		},
			initialTarget,
		});
	}

	async onClose(): Promise<void> {
		this.appHandle?.destroy();
		this.appHandle = null;
		this.contentEl.empty();
		this.contentEl.removeClass("cpo-host");
	}
}
