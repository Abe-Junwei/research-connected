import type { RawWork } from "./openalex";
import type { Origin, PaperNode, SearchHit } from "./types";

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

export function toPaper(raw: RawWork, origin: Origin): PaperNode | null {
	if (!raw.id) return null;
	const id = shortId(raw.id);
	if (!/^W\d+$/.test(id)) return null;
	const title = (raw.display_name ?? "").trim();
	if (!title) return null;
	const names = authorNames(raw.authorships);
	return {
		id,
		title,
		year: typeof raw.publication_year === "number" ? raw.publication_year : null,
		citedByCount: typeof raw.cited_by_count === "number" ? raw.cited_by_count : 0,
		authors: formatAuthorNames(names),
		authorList: names,
		abstract: reconstructAbstract(raw.abstract_inverted_index),
		doiUrl: toDoiUrl(raw.doi),
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: cleanToken(raw.language),
		workType: cleanToken(raw.type),
		venue: cleanName(raw.primary_location?.source?.display_name),
		bibliography: raw.biblio ? {
			volume: cleanToken(raw.biblio.volume),
			issue: cleanToken(raw.biblio.issue),
			firstPage: cleanToken(raw.biblio.first_page),
			lastPage: cleanToken(raw.biblio.last_page),
		} : undefined,
		retracted: raw.is_retracted === true,
		concepts: conceptNames(raw.topics, raw.concepts),
		topicTags: topicTags(raw.topics, raw.concepts),
	};
}

export function toSearchHit(raw: RawWork): SearchHit | null {
	const paper = toPaper(raw, "related");
	if (!paper) return null;
	return {
		id: paper.id,
		title: paper.title,
		year: paper.year,
		citedByCount: paper.citedByCount,
		authors: paper.authors,
	};
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
	["book-review", "书评"],
	["editorial", "编者语"],
	["erratum", "更正"],
	["correction", "更正"],
	["letter", "读者来信"],
	["retraction", "撤稿"],
	["peer-review", "评审记录"],
	["paratext", "附属内容"],
]);

export function nonResearchLabel(paper: Pick<PaperNode, "workType">): string | null {
	if (!paper.workType) return null;
	return NON_RESEARCH_TYPES.get(paper.workType) ?? null;
}

function cleanToken(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().toLowerCase();
	return trimmed || null;
}

/** Venue/source names keep their case; only whitespace is normalized. */
function cleanName(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/\s+/g, " ");
	return trimmed || null;
}

function conceptNames(topics: RawWork["topics"], concepts: RawWork["concepts"]): string[] {
	const ranked = [...(topics?.length ? topics : concepts ?? [])].sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of ranked) {
		const name = item?.display_name?.trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
		if (names.length >= 8) break;
	}
	return names;
}

function topicTags(topics: RawWork["topics"], concepts: RawWork["concepts"]): Array<{ id: string; name: string; score: number }> {
	if (topics?.length) {
		return topics.flatMap((topic) => {
			const id = topic?.id?.trim();
			const name = topic?.display_name?.trim();
			if (!id || !name) return [];
			return [{ id, name, score: Math.max(0, Math.min(1, topic?.score ?? 1)) }];
		});
	}
	return (concepts ?? []).flatMap((concept) => {
		const name = concept?.display_name?.trim();
		if (!name) return [];
		return [{ id: `name:${name.toLocaleLowerCase()}`, name, score: Math.max(0, Math.min(1, concept?.score ?? 1)) }];
	});
}

function authorNames(authorships: RawWork["authorships"]): string[] {
	const names: string[] = [];
	for (const authorship of authorships ?? []) {
		const name = authorship?.author?.display_name?.trim();
		if (name) names.push(name);
	}
	return names;
}

function formatAuthorNames(names: string[]): string {
	if (names.length === 0) return "作者不详";
	if (names.length <= 3) return names.join(", ");
	return `${names.slice(0, 3).join(", ")} 等`;
}

function toDoiUrl(doi: string | null | undefined): string | null {
	const normalized = normalizeDoi(doi);
	return normalized ? `https://doi.org/${normalized}` : null;
}

function cleanDoi(doi: string): string {
	return normalizeDoi(doi) ?? decodeURIComponentSafe(doi).replace(/[)\].,;>]+$/g, "");
}

export function normalizeDoi(value: string | null | undefined): string | null {
	if (!value) return null;
	let doi = decodeURIComponentSafe(value.trim())
		.replace(/^doi:\s*/i, "")
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.replace(/[)\].,;>]+$/g, "")
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
