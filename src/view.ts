import { ItemView, WorkspaceLeaf } from "obsidian";
import { mountGraphApp } from "./app";
import { VIEW_TYPE } from "./constants";
import { obsidianGetJson, obsidianPostJson } from "./obsidian-http";
import { openExternal } from "./open-external";
import { createVaultNote } from "./vault-note";
import type { ConnectedPapersSettings } from "./settings";

export interface GraphHost {
	getSettings(): ConnectedPapersSettings;
}

export class ConnectedPapersView extends ItemView {
	private destroyApp: (() => void) | null = null;

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
		return "git-fork";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("cpo-host");
		this.mount();
	}

	/** Rebuild the pane on a new seed, e.g. from a note embed. */
	openSeed(target: { kind: "doi" | "openalex"; value: string }): void {
		this.destroyApp?.();
		this.contentEl.empty();
		this.mount(target);
	}

	private mount(initialTarget?: { kind: "doi" | "openalex"; value: string }): void {
		this.destroyApp = mountGraphApp(this.contentEl, {
			getSettings: () => this.host.getSettings(),
			getJson: obsidianGetJson,
			postJson: obsidianPostJson,
			openExternal,
			createNote: (filename, markdown) => createVaultNote(this.app, filename, markdown),
			initialTarget,
		});
	}

	async onClose(): Promise<void> {
		this.destroyApp?.();
		this.destroyApp = null;
		this.contentEl.empty();
		this.contentEl.removeClass("cpo-host");
	}
};
