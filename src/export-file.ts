import type { PaperNode } from "./types";
import { knownAuthorNames, normalizeDoi } from "./paper";
import { availableCitations } from "./visual";

export function exportFilename(title: string, extension: string): string {
	const safe = [...title].map(char => char.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(char) ? "_" : char).join("").trim().slice(0, 100) || "literature";
	const date = new Date();
	const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return `${safe}-${day}.${extension}`;
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
	if (typeof URL.createObjectURL !== "function") throw new Error("File downloads are unavailable");
	const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
	const link = createEl("a"); link.href = url; link.download = filename;
	document.body.append(link);
	try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Quote every field and neutralize spreadsheet formulas before CSV escaping. */
export function toCsv(papers: readonly PaperNode[]): string {
	const cell = (value: string | number | null | undefined): string => { const text = String(value ?? ""); return `"${(/^[=+@-]/u.test(text.trimStart()) || (text.charCodeAt(0) < 32) ? `'${text}` : text).replace(/"/g, '""')}"`; };
	const rows: Array<Array<string | number | null | undefined>> = [["Title", "Authors", "Editors", "Year", "Citations", "DOI", "OpenAlex"], ...papers.map(paper => [paper.title, knownAuthorNames(paper).join("; "), paper.editorList?.join("; ") ?? "", paper.year, availableCitations(paper), normalizeDoi(paper.doiUrl) ?? "", paper.openAlexUrl])];
	return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
