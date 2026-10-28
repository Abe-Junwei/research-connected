import { tr } from "./i18n";
import type { PaperNode } from "./types";

export type SeedQuery =
	| { kind: "doi"; value: string }
	| { kind: "openalex"; value: string }
	| { kind: "search"; value: string };

export function classifyQuery(raw: string): SeedQuery | null {
	const query = raw.trim();
	if (!query) return null;

	const openAlex =
		query.match(/openalex\.org\/(?:works\/)?(W\d+)/i) ?? query.match(/^(W\d+)$/i);
	const openAlexId = openAlex?.[1];
	if (openAlexId) return { kind: "openalex", value: openAlexId.toUpperCase() };

	const doiFromUrl = query.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i)?.[1];
	if (doiFromUrl) return { kind: "doi", value: cleanDoi(doiFromUrl) };

	const doi = query.match(/^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i)?.[1];
	if (doi) return { kind: "doi", value: cleanDoi(doi) };

	if (query.length < 2) return null;
	return { kind: "search", value: query };
}

export function shortId(value: string): string {
	const match = value.match(/W\d+/i);
	return match?.[0] ? match[0].toUpperCase() : "";
}

export function referenceIds(values: string[] | null | undefined): string[] {
	if (!values) return [];
	const ids: string[] = [];
	for (const value of values) {
		const id = shortId(value);
		if (/^W\d+$/.test(id)) ids.push(id);
	}
	return ids;
}

export function reconstructAbstract(
	index: Record<string, number[]> | null | undefined,
): string {
	if (!index) return "";
	const placed: string[] = [];
	let max = -1;
	for (const [word, spots] of Object.entries(index)) {
		if (!Array.isArray(spots)) continue;
		for (const pos of spots) {
			if (!Number.isInteger(pos) || pos < 0 || pos > 20000) continue;
			placed[pos] = word;
			if (pos > max) max = pos;
		}
	}
	if (max < 0) return "";
	const words: string[] = [];
	for (let i = 0; i <= max; i++) {
		const word = placed[i];
		if (word) words.push(word);
	}
	return cleanAbstractText(words.join(" "));
}

/**
 * Publisher-deposited abstracts often carry the JATS section label as a
 * leading word ("Abstract", "Summary"), with or without punctuation. Strip
 * that label; a real sentence starting with the word is rare enough, and the
 * bare-word form is only stripped before an uppercase/CJK opening.
 */
export function cleanAbstractText(text: string): string {
	return text
		.replace(/^\s*(?:abstract|summary)\s*[:.．。\-–—]\s*/i, "")
		.replace(/^abstract\s+(?=[A-Z\u4e00-\u9fff"“‘'])/i, "")
		.trim();
}

export function isPaper(value: PaperNode | null): value is PaperNode {
	return value !== null;
}

/**
 * OpenAlex records that are not research content. Book reviews are the
 * common trap: their titles embed the reviewed book ("Title. By Author.
 * Publisher, year. Pp. …"), citations meant for the book land on them,
 * and the graph then treats a review as the book itself. OpenAlex flags
 * these in `type`, which is the reliable detector.
 */
export const NON_RESEARCH_TYPES: ReadonlyMap<string, string> = new Map([
	["book-review", tr("书评", "Book review")],
	["editorial", tr("编者语", "Editorial")],
	["erratum", tr("更正", "Correction")],
	["correction", tr("更正", "Correction")],
	["letter", tr("读者来信", "Letter")],
	["retraction", tr("撤稿", "Retraction")],
	["peer-review", tr("评审记录", "Peer-review record")],
	["paratext", tr("附属内容", "Paratext")],
]);

export function nonResearchLabel(paper: Pick<PaperNode, "workType">): string | null {
	if (!paper.workType) return null;
	return NON_RESEARCH_TYPES.get(paper.workType) ?? null;
}

function cleanDoi(doi: string): string {
	return normalizeDoi(doi) ?? stripCitationPunctuation(decodeURIComponentSafe(doi));
}

/** Drop citation punctuation after a DOI, but keep a balanced bracket that belongs to the identifier. */
function stripCitationPunctuation(value: string): string {
	let end = value.length;
	while (end > 0 && /[)\].,;>]/.test(value[end - 1] ?? "")) {
		const closer = value[end - 1] ?? "";
		const opener = closer === ")" ? "(" : closer === "]" ? "[" : "";
		if (opener) {
			let opened = 0;
			let closed = 0;
			for (let index = 0; index < end; index += 1) {
				if (value[index] === opener) opened += 1;
				else if (value[index] === closer) closed += 1;
			}
			if (closed <= opened) break;
		}
		end -= 1;
	}
	return value.slice(0, end);
}

export function normalizeDoi(value: string | null | undefined): string | null {
	if (!value) return null;
	const doi = stripCitationPunctuation(decodeURIComponentSafe(value.trim())
		.replace(/^doi:\s*/i, "")
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""))
		.trim()
		.toLowerCase();
	return /^10\.\d{1,9}\/\S+$/.test(doi) ? doi : null;
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
