import { TFile, type App } from "obsidian";
import { indexLiteratureFiles, type IndexedNote } from "./export-graph";
import { tr } from "./i18n";
import { normalizeDoi } from "./paper";
import type { ReadingStatus } from "./project-state";
import type { PaperNode } from "./types";

const remembered = new Map<string, IndexedNote>();
let indexed: { property: string; byDoi: Map<string, IndexedNote>; byId: Map<string, IndexedNote> } | null = null;

export function invalidateLiteratureIndex(): void {
	indexed = null;
}

/** Remember a note just written, before the metadata cache has parsed it. */
export function rememberLiteratureNote(paper: PaperNode, path: string, reading: ReadingStatus): void {
	const note = { path, reading };
	remembered.set(paper.id, note);
	const doi = normalizeDoi(paper.doiUrl);
	if (doi) remembered.set(`doi:${doi}`, note);
}

/**
 * Find a vault note whose frontmatter DOI or OpenAlex id matches this paper.
 * ponytail: rebuilds the index from every markdown file after a metadata change.
 * Upgrade path: patch the two maps from the changed file instead of rescanning.
 */
export function lookupLiteratureNote(app: App, paper: PaperNode, doiProperty: string): IndexedNote | null {
	const doi = normalizeDoi(paper.doiUrl);
	const recent = remembered.get(paper.id) ?? (doi ? remembered.get(`doi:${doi}`) : undefined);
	if (recent && app.vault.getAbstractFileByPath(recent.path)) return recent;
	const index = literatureIndex(app, doiProperty);
	if (doi) {
		const match = index.byDoi.get(doi);
		if (match) return match;
	}
	return index.byId.get(paper.id) ?? null;
}

export async function openLiteratureNote(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) await app.workspace.getLeaf(false).openFile(file);
}

/** Write rc-status on an existing literature note. No note means nothing to sync. */
export async function syncLiteratureReading(app: App, paper: PaperNode, reading: ReadingStatus, doiProperty: string): Promise<void> {
	const found = lookupLiteratureNote(app, paper, doiProperty);
	if (!found) return;
	const file = app.vault.getAbstractFileByPath(found.path);
	if (!(file instanceof TFile)) return;
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		frontmatter["rc-status"] = reading;
	});
	found.reading = reading;
}

/** Create a markdown note and open it. Filename collisions get a numeric suffix. */
export async function createVaultNote(app: App, filename: string, markdown: string, folder = ""): Promise<string> {
	const dir = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (dir) await ensureFolder(app, dir);
	const leaf = (filename.split(/[/\\]/).pop() || "note").replace(/\.md$/i, "").trim() || "note";
	const base = dir ? `${dir}/${leaf}` : leaf;
	let path = `${base}.md`;
	let suffix = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		path = `${base} ${suffix}.md`;
		suffix += 1;
		if (suffix > 40) throw new Error(tr("同名笔记太多，没有写成。", "Too many notes have this name; the note could not be written."));
	}
	const file = await app.vault.create(path, markdown);
	await app.workspace.getLeaf(false).openFile(file);
	return file.path;
}

function literatureIndex(app: App, doiProperty: string): { byDoi: Map<string, IndexedNote>; byId: Map<string, IndexedNote> } {
	const property = doiProperty.trim() || "doi";
	if (indexed?.property === property) return indexed;
	const files = app.vault.getMarkdownFiles().map((file) => ({
		path: file.path,
		frontmatter: app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined,
	}));
	indexed = { property, ...indexLiteratureFiles(files, property) };
	return indexed;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	let path = "";
	for (const part of folder.split("/").filter(Boolean)) {
		path = path ? `${path}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
	}
}
