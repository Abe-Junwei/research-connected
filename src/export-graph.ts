import { tr } from "./i18n";
import { shortAuthor } from "./labels";
import type { PaperNode } from "./types";

export function toBibTeX(nodes: readonly PaperNode[]): string {
	const used = new Set<string>();
	return nodes.map((paper) => bibEntry(paper, used)).join("\n\n");
}

export function toYamlList(nodes: readonly PaperNode[]): string {
	const lines = ["papers:"];
	for (const paper of nodes) {
		lines.push(`  - title: ${yamlString(paper.title)}`);
		lines.push(`    authors: ${yamlString(paper.authors)}`);
		lines.push(`    year: ${paper.year ?? "null"}`);
		lines.push(`    citations: ${paper.citedByCount}`);
		const doi = doiOf(paper);
		if (doi) lines.push(`    doi: ${yamlString(doi)}`);
		lines.push(`    openalex: ${yamlString(paper.openAlexUrl)}`);
	}
	return lines.join("\n");
}

export function toMarkdownTable(nodes: readonly PaperNode[]): string {
	const header = tr("| 题名 | 作者 | 年份 | 被引 | DOI | OpenAlex |", "| Title | Authors | Year | Citations | DOI | OpenAlex |");
	const rule = "| --- | --- | --- | --- | --- | --- |";
	const rows = nodes.map((paper) => {
		const year = paper.year === null ? "" : String(paper.year);
		const doi = doiOf(paper) ?? "";
		return `| ${cell(paper.title)} | ${cell(paper.authors)} | ${year} | ${paper.citedByCount} | ${cell(doi)} | ${cell(paper.openAlexUrl)} |`;
	});
	return [header, rule, ...rows].join("\n");
}

/** Title, authors, year, DOI, and OpenAlex link. No abstract and no generated prose. */
export function noteSkeleton(paper: PaperNode): string {
	const doi = doiOf(paper);
	const lines = [
		"---",
		`title: ${yamlString(paper.title)}`,
		`authors: ${yamlString(paper.authors)}`,
		`year: ${paper.year ?? "null"}`,
	];
	if (doi) lines.push(`doi: ${yamlString(doi)}`);
	lines.push(`openalex: ${yamlString(paper.openAlexUrl)}`, "---", "", `# ${paper.title}`, "");
	return lines.join("\n");
}

export function noteFilename(paper: PaperNode): string {
	const year = paper.year === null ? tr("未标注", "Unspecified") : String(paper.year);
	const title = paper.title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 72);
	return `${year} ${title || paper.id}.md`;
}

export function orderedForExport(nodes: readonly PaperNode[]): PaperNode[] {
	return [...nodes].sort((a, b) => {
		if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
		return (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title);
	});
}

function bibEntry(paper: PaperNode, used: Set<string>): string {
	const type = bibType(paper.workType);
	const key = citeKey(paper, used);
	const fields = [
		`  title = {${bibText(paper.title)}}`,
		`  author = {${(paper.authorList?.length ? paper.authorList : [paper.authors]).map(bibText).join(" and ")}}`,
		`  year = {${paper.year ?? ""}}`,
	];
	const doi = doiOf(paper);
	if (doi) fields.push(`  doi = {${bibText(doi)}}`);
	fields.push(`  url = {${bibText(paper.openAlexUrl)}}`);
	return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

function bibType(workType: string | null): string {
	if (workType === "book") return "book";
	if (workType === "book-chapter") return "incollection";
	if (workType === "dissertation") return "phdthesis";
	if (workType === "article" || workType === "editorial" || workType === "preprint") return "article";
	return "misc";
}

function citeKey(paper: PaperNode, used: Set<string>): string {
	const author = shortAuthor(paper.authors).replace(/[^A-Za-z0-9]+/g, "") || "anon";
	const year = paper.year ?? "nd";
	let key = `${author}${year}`;
	if (used.has(key)) key = `${key}${paper.id.replace(/\D/g, "").slice(-4)}`;
	used.add(key);
	return key;
}

function bibText(value: string): string {
	return value.replace(/[{}\\]/g, "");
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function cell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function doiOf(paper: Pick<PaperNode, "doiUrl">): string | null {
	if (!paper.doiUrl) return null;
	const match = paper.doiUrl.match(/10\.\d{4,9}\/\S+/);
	return match?.[0]?.replace(/[)\].,;>]+$/g, "") ?? null;
}
