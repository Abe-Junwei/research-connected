import type { PaperNode } from "./types";

/** Text shown next to each graph node. */
export type LabelMode = "author-year" | "title" | "both" | "off";

export function shortAuthor(authors: string): string {
	const cleaned = authors.trim();
	if (!cleaned || cleaned === "作者不详") return "佚名";
	const first = cleaned.split(",")[0]?.trim().replace(/\s+等$/, "") || cleaned;
	const parts = first.split(/\s+/).filter(Boolean);
	const family = parts[parts.length - 1] ?? first;
	if (family.length <= 14) return family;
	return `${family.slice(0, 13)}…`;
}

export function authorYear(paper: Pick<PaperNode, "authors" | "year">): string {
	const year = paper.year === null ? "—" : String(paper.year);
	return `${shortAuthor(paper.authors)} ${year}`;
}

/** 被引名次 × 缩放：Top 3 恒显，其后随放大分档淡入。rank 0 为最高被引。 */
export function citationLabelAlpha(rank: number, zoom: number): number {
	const fade = (from: number): number => Math.min(1, Math.max(0, (zoom - from) / 0.4));
	if (rank <= 2) return 1;
	if (rank <= 7) return fade(0.75);
	if (rank <= 15) return fade(1.1);
	return fade(1.5);
}

export function abbreviateTitle(title: string, max = 32): string {
	const clean = title.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trim()}…`;
}

/** Screen label. Empty when labels are off. */
export function nodeLabel(paper: PaperNode, mode: LabelMode): string {
	if (mode === "off") return "";
	if (mode === "title") return abbreviateTitle(paper.title, 32);
	if (mode === "both") return `${authorYear(paper)}\n${abbreviateTitle(paper.title, 28)}`;
	return authorYear(paper);
}
