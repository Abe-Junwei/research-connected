import { normalizeDoi } from "./paper";
import type { CitationEvidence } from "./citation-evidence";
import type { GraphEdge, PaperNode, PaperRecord } from "./types";

export const WORK_IDENTITY_VERSION = 1;
export interface WorkIdentity {
	version: 1;
	records: PaperRecord[];
	referenceLists: Array<[string, string[]]>;
	evidence: CitationEvidence[];
	directEdges: GraphEdge[];
	canonicalIds: Array<[string, string]>;
	separatedIds: string[];
	contextIds?: string[];
}

const text = (value: string | null | undefined): string => (value ?? "").normalize("NFKC").toLowerCase().replace(/[‐‑‒–−]/g, "-").replace(/\s+/g, " ").trim();
const authors = (paper: PaperRecord): string => paper.authorList?.length && paper.authorList.every((name) => text(name) && !/(?:et\s+al\.?|…|\.\.\.|等\s*\d*\s*位?)/i.test(name)) ? paper.authorList.map(text).join("\0") : "";

function bibliographyKey(paper: PaperRecord): string | null {
	const b = paper.bibliography;
	if (paper.workType !== "article" || paper.year === null || !authors(paper) || !paper.title || !paper.venue || !b?.volume || !b.firstPage || !b.lastPage) return null;
	return [text(paper.title), authors(paper), paper.year, text(paper.venue), text(b.volume), text(b.firstPage), text(b.lastPage)].join("\u0001");
}

export function sameWork(a: PaperRecord, b: PaperRecord): boolean {
	if (a.id === b.id) return true;
	const doi = normalizeDoi(a.doiUrl);
	if (doi && doi === normalizeDoi(b.doiUrl)) return true;
	const key = bibliographyKey(a);
	return key !== null && key === bibliographyKey(b) && (!a.bibliography?.issue || !b.bibliography?.issue || text(a.bibliography.issue) === text(b.bibliography.issue));
}

/** Shared id or DOI only. A matching bibliography is not a confirmed version link. Not consulted by workIndex. */
export function confirmedVersionRelation(a: PaperRecord, b: PaperRecord): boolean {
	if (a.id === b.id) return true;
	const doi = normalizeDoi(a.doiUrl);
	return Boolean(doi && doi === normalizeDoi(b.doiUrl));
}

export type SourceRelationReport =
	| { status: "missing" }
	| { status: "conflict"; evidence: readonly string[] }
	| { status: "negated"; evidence: readonly string[] };

export interface SourceRelationHold {
	/** Unchanged for a miss or a conflict. Negation is queued for split and does not keep the link. */
	merged: boolean;
	review: "check" | "freeze" | "split";
	evidence: readonly string[];
}

/** One missing source does not split. A conflict freezes the current link. An explicit denial is a split review, not a miss. */
export function holdSourceRelation(report: SourceRelationReport, merged: boolean): SourceRelationHold {
	switch (report.status) {
		case "missing":
			return { merged, review: "check", evidence: [] };
		case "conflict":
			return { merged, review: "freeze", evidence: [...report.evidence] };
		case "negated":
			return { merged: false, review: "split", evidence: [...report.evidence] };
		default: {
			const _never: never = report;
			return _never;
		}
	}
}

export function paperRecords(paper: PaperNode): PaperRecord[] {
	const { records, recordsSeparated: _separated, ...record } = paper;
	return records?.length ? records.map((item) => item.id === record.id ? { ...item, ...record } : item) : [record];
}

export function paperHasId(paper: Pick<PaperNode, "id" | "records">, id: string): boolean {
	return paper.id === id || Boolean(paper.records?.some((record) => record.id === id));
}

export function paperDois(paper: Pick<PaperNode, "doiUrl" | "records">): string[] {
	return [...new Set([paper.doiUrl, ...(paper.records ?? []).map((record) => record.doiUrl)].map(normalizeDoi).filter((doi): doi is string => Boolean(doi)))];
}

const OPENALEX_ID = /^(?:https?:\/\/(?:www\.)?openalex\.org\/(?:works\/)?)?(W\d+)$/i;

export function resolveWorkQuery(papers: readonly PaperNode[], query: string): string | null {
	const doi = normalizeDoi(query);
	if (doi) return papers.find((paper) => paperDois(paper).includes(doi))?.id ?? null;
	const id = query.trim().match(OPENALEX_ID)?.[1]?.toUpperCase();
	return id ? papers.find((paper) => paperHasId(paper, id))?.id ?? null : null;
}

export function workIndex(papers: readonly PaperNode[], preferred: readonly string[] = [], separated: readonly string[] = []): { papers: PaperNode[]; ids: Map<string, string>; records: PaperRecord[] } {
	const records = new Map<string, PaperRecord>();
	for (const paper of papers) for (const record of paperRecords(paper)) records.set(record.id, record);
	const order = new Map(preferred.map((id, index) => [id, index]));
	const blocked = new Set([...separated, ...papers.filter((paper) => paper.recordsSeparated).flatMap((paper) => paperRecords(paper).map((record) => record.id))]);
	const sorted = [...records.values()].sort((a, b) => Number(b.isSeed) - Number(a.isSeed) || (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
	const groups: PaperRecord[][] = [];
	const buckets = new Map<string, Set<number>>();
	for (const record of sorted) {
		const doi = normalizeDoi(record.doiUrl);
		const key = bibliographyKey(record);
		const keys = [doi ? `doi:${doi}` : "", key ? `bib:${key}` : ""].filter(Boolean);
		const candidates = new Set(keys.flatMap((value) => [...(buckets.get(value) ?? [])]));
		const index = !blocked.has(record.id) ? [...candidates].find((i) => groups[i]!.every((item) => !blocked.has(item.id) && sameWork(item, record))) : undefined;
		const at = index ?? groups.length;
		if (index === undefined) groups.push([record]);
		else groups[at]!.push(record);
		for (const value of keys) { const groupIds = buckets.get(value) ?? new Set<number>(); groupIds.add(at); buckets.set(value, groupIds); }
	}
	const ids = new Map<string, string>();
	const output = groups.map((group): PaperNode => {
		const representative = group[0]!;
		for (const record of group) ids.set(record.id, representative.id);
		return group.length > 1 ? { ...representative, records: group.map((record) => ({ ...record })) } : { ...representative, ...(blocked.has(representative.id) ? { recordsSeparated: true } : {}) };
	});
	return { papers: output, ids, records: sorted };
}
