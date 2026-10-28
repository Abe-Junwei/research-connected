import { tr } from "./i18n";
import { MarkdownRenderChild, Plugin, TFile, type MarkdownPostProcessorContext } from "obsidian";
import { mountEmbed } from "./embed-mount";
import { obsidianGetJson, obsidianPostJson } from "./obsidian-http";
import { openExternal } from "./open-external";
import type { ConnectedPapersSettings } from "./settings-model";
import type { createReadingWorkflow } from "./reading-workflow";
import { createVaultNote, lookupLiteratureNote, openLiteratureNote, rememberLiteratureNote, syncLiteratureReading } from "./vault-note";

interface EmbedHost extends Plugin {
	getSettings(): ConnectedPapersSettings;
	saveSettings(notify?: boolean): Promise<void>;
	readingWorkflow: ReturnType<typeof createReadingWorkflow>;
	/** Open the full graph pane focused on a seed; absent in hosts that cannot. */
	openGraph?(target: { kind: "doi" | "openalex"; value: string }): void;
}

/**
 * Reading view and Live Preview both use this processor. While the cursor is
 * inside the fence, Obsidian shows the source; leaving the block mounts the
 * graph again.
 */
export function registerConnectedPapersEmbed(plugin: EmbedHost): void {
	const handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		ctx.addChild(new ConnectedPapersEmbed(el, source, plugin, ctx));
	};
	// `connected-papers` stays valid so existing notes keep rendering.
	plugin.registerMarkdownCodeBlockProcessor("connected-papers", handler);
	plugin.registerMarkdownCodeBlockProcessor("research-connected", handler);
}

class ConnectedPapersEmbed extends MarkdownRenderChild {
	private destroyView: (() => void) | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly source: string,
		private readonly plugin: EmbedHost,
		private readonly ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	onload(): void {
		const { plugin } = this;
		this.destroyView = mountEmbed(this.containerEl, {
			...plugin.readingWorkflow,
			source: this.source,
			getSettings: () => plugin.getSettings(),
			getJson: obsidianGetJson,
			postJson: obsidianPostJson,
			openExternal,
			stagePaper: async () => { await plugin.saveSettings(false); },
			persistAssociation: async key => {
				const file = plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
				const section = this.ctx.getSectionInfo(this.containerEl);
				if (!(file instanceof TFile) || !section) throw new Error(tr("代码块位置已变更，请重新打开后再关联项目", "Code block moved; reopen it before linking a project"));
				await plugin.app.vault.process(file, content => {
					const lines = content.split("\n");
					const body = lines.slice(section.lineStart + 1, section.lineEnd).join("\n");
					if (body.trim() !== this.source.trim()) throw new Error(tr("代码块内容已变更，请重新打开后再关联项目", "Code block changed; reopen it before linking a project"));
					const next = body.split("\n").filter(line => !/^\s*project\s*:/i.test(line));
					if (key) next.push(`project: ${key}`);
					lines.splice(section.lineStart + 1, section.lineEnd - section.lineStart - 1, ...next);
					return lines.join("\n");
				});
			},
			createNote: (filename, markdown, folder) => createVaultNote(plugin.app, filename, markdown, folder),
			lookupLiteratureNote: (paper) => lookupLiteratureNote(plugin.app, paper, plugin.getSettings().literatureDoiProperty),
			openLiteratureNote: (path) => { void openLiteratureNote(plugin.app, path); },
			syncLiteratureReading: (paper, reading) => syncLiteratureReading(plugin.app, paper, reading, plugin.getSettings().literatureDoiProperty),
			rememberLiteratureNote,
			openGraph: plugin.openGraph ? (target) => plugin.openGraph?.(target) : undefined,
		});
	}

	onunload(): void {
		this.destroyView?.();
		this.destroyView = null;
	}
}
