import { tr } from "./i18n";
import type { App } from "obsidian";

/** Create a markdown note in the vault root and open it. Filename collisions get a numeric suffix. */
export async function createVaultNote(app: App, filename: string, markdown: string): Promise<void> {
	let path = filename.endsWith(".md") ? filename : `${filename}.md`;
	let suffix = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		path = filename.replace(/\.md$/i, "") + ` ${suffix}.md`;
		suffix += 1;
		if (suffix > 40) throw new Error(tr("同名笔记太多，没有写成。", "Too many notes have this name; the note could not be written."));
	}
	const file = await app.vault.create(path, markdown);
	await app.workspace.getLeaf(false).openFile(file);
}
