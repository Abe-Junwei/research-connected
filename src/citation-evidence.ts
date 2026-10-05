import type { SemanticCitation } from "./citation-sources";
import { nonResearchLabel } from "./paper";
import type { GraphEdge, PaperNode } from "./types";
import type { SimilarityGraph } from "./neighborhood";

export type CitationIntent = "background" | "method" | "result";
export type CitationRelation = "background" | "method" | "extension" | "validation" | "application" | "criticism" | "unclear";

export interface CitationEvidence {
	citingId: string;
	citedId: string;
	sources: Array<"openalex" | "opencitations" | "semantic-scholar" | "crossref">;
	intents: CitationIntent[];
	influential?: boolean;
	contexts: string[];
	relation: CitationRelation;
	evidenceQuotes: string[];
	confidence: "high" | "medium" | "low";
}

export class CitationEvidenceStore {
	private readonly items = new Map<string, CitationEvidence>();

	get(citingId: string, citedId: string): CitationEvidence | null {
		return this.items.get(key(citingId, citedId)) ?? null;
	}

	set(next: CitationEvidence): void {
		const current = this.get(next.citingId, next.citedId);
		this.items.set(key(next.citingId, next.citedId), current ? merge(current, next) : next);
	}

	entries(): CitationEvidence[] {
		return [...this.items.values()];
	}
}

export function evidenceFromSemanticCitation(
	citingId: string,
	citedId: string,
	citation: SemanticCitation,
): CitationEvidence {
	const intents = (citation.intents ?? []).map(normalizeIntent).filter((item): item is CitationIntent => item !== null);
	const relation: CitationRelation = intents.includes("method")
		? "method"
		: intents.includes("result")
			? "extension"
			: intents.includes("background")
				? "background"
				: "unclear";
	return {
		citingId,
		citedId,
		sources: ["semantic-scholar"],
		intents,
		influential: typeof citation.isInfluential === "boolean" ? citation.isInfluential : undefined,
		contexts: citation.contexts ?? [],
		relation,
		evidenceQuotes: citation.contexts ?? [],
		confidence: intents.length > 0 || (citation.contexts?.length ?? 0) > 0 ? "medium" : "low",
	};
}

export function evidenceLabel(evidence: CitationEvidence | null): string {
	if (!evidence) return "暂无额外引用证据";
	const labels = evidence.intents.map((intent) => INTENT_TEXT[intent]);
	if (evidence.influential) labels.push("高影响");
	return labels.length > 0 ? labels.join(" · ") : "已确认引用关系，暂无引用意图";
}

const INTENT_TEXT: Record<CitationIntent, string> = {
	background: "背景",
	method: "方法",
	result: "结果",
};

/** Display names for evidence sources, for stats and source lines. */
export const SOURCE_TEXT: Record<CitationEvidence["sources"][number], string> = {
	openalex: "OpenAlex",
	opencitations: "OpenCitations",
	"semantic-scholar": "Semantic Scholar",
	crossref: "Crossref",
};

export interface EvidenceBadge {
	label: string;
	tone: "strong" | "plain" | "warn";
}

/** 双源确认 / 单源记录 / 数据缺失；低置信时追加采样有限。 */
export function evidenceBadges(evidence: CitationEvidence | null): EvidenceBadge[] {
	if (!evidence || evidence.sources.length === 0) return [{ label: "数据缺失", tone: "warn" }];
	const badges: EvidenceBadge[] = [
		evidence.sources.length >= 2
			? { label: "双源确认", tone: "strong" }
			: { label: "单源记录", tone: "plain" },
	];
	if (evidence.confidence === "low") badges.push({ label: "采样有限", tone: "warn" });
	return badges;
}

export interface PaperStateLike {
	retracted?: boolean;
	workType?: string | null;
}

export interface CrossCheckLike {
	mismatched: boolean;
	refsAdded: number;
	crossrefRefsAdded?: number;
}

/**
 * Node-level state badges: retraction, non-research record type, cross-source
 * mismatch, and S2 backfill. Ordered by severity — warnings first, so the
 * most consequential state leads the badge row. Structural input types keep
 * this module free of imports from neighborhood (which already imports us).
 */
export function paperStateBadges(paper: PaperStateLike, check: CrossCheckLike | null | undefined): EvidenceBadge[] {
	const badges: EvidenceBadge[] = [];
	if (paper.retracted) badges.push({ label: "⚠ 已撤稿", tone: "warn" });
	const flagged = nonResearchLabel({ workType: paper.workType ?? null });
	if (flagged) badges.push({ label: flagged, tone: "warn" });
	if (check?.mismatched) badges.push({ label: "⚠ 数据源差异", tone: "warn" });
	if (check && check.refsAdded > 0) badges.push({ label: `S2 回填 ${check.refsAdded} 条`, tone: "plain" });
	if (check?.crossrefRefsAdded) badges.push({ label: `Crossref 补充 ${check.crossrefRefsAdded} 条`, tone: "plain" });
	return badges;
}

/** Directed citation pairs carried by an edge, citing id first. */
export function edgeCitationPairs(edge: GraphEdge): Array<{ citingId: string; citedId: string }> {
	if (edge.direct === "source-cites-target") return [{ citingId: edge.source, citedId: edge.target }];
	if (edge.direct === "target-cites-source") return [{ citingId: edge.target, citedId: edge.source }];
	if (edge.direct === "mutual") {
		return [
			{ citingId: edge.source, citedId: edge.target },
			{ citingId: edge.target, citedId: edge.source },
		];
	}
	return [];
}

/**
 * First directed pair on this edge that still lacks S2 context/intents.
 * Similarity-only edges (direct === "none") yield null — no S2 fetch.
 */
export function edgePairNeedingS2Context(
	edge: GraphEdge,
	getEvidence: (citingId: string, citedId: string) => CitationEvidence | null,
): { citingId: string; citedId: string } | null {
	for (const pair of edgeCitationPairs(edge)) {
		const existing = getEvidence(pair.citingId, pair.citedId);
		if (!existing?.contexts.length && !existing?.intents.length) return pair;
	}
	return null;
}

/** Merge S2 reference rows whose cited DOI matches; returns whether any row applied. */
export function mergeS2CitationsForPair(
	store: CitationEvidenceStore,
	citingId: string,
	citedId: string,
	citedDoi: string,
	citations: readonly SemanticCitation[],
	doiOf: (raw: string | null | undefined) => string | null,
): boolean {
	let matched = false;
	for (const citation of citations) {
		if (doiOf(citation.citedPaper?.externalIds?.DOI) !== citedDoi) continue;
		store.set(evidenceFromSemanticCitation(citingId, citedId, citation));
		matched = true;
	}
	return matched;
}

/** Stale async guard: only refresh the detail sheet for the still-selected edge. */
export function edgeDetailStillCurrent(
	selectedEdge: GraphEdge | null,
	edge: GraphEdge,
	alive: boolean,
): boolean {
	return alive && selectedEdge === edge;
}

/** Sources describe this directed citation, never just the paper metadata. */
export function mergeOpenCitation(graph: SimilarityGraph, citingId: string, citedId: string): void {
	const a = graph.nodes.find(p => p.id === citingId);
	const b = graph.nodes.find(p => p.id === citedId);
	if (!a || !b || citingId === citedId) return;
	graph.citationEvidence ??= new CitationEvidenceStore();
	const inOpenAlex = graph.referenceLists.get(citingId)?.includes(citedId) ?? false;
	graph.citationEvidence.set(directEvidence(a, b, inOpenAlex, true));
	const edge = graph.edges.find(e => (e.source === citingId && e.target === citedId) || (e.target === citingId && e.source === citedId));
	if (!edge) {
		graph.edges.push({ source: citingId, target: citedId, weight: 0.1, structuralSimilarity: null, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target" });
	} else {
		const direction = edge.source === citingId ? "source-cites-target" : "target-cites-source";
		if (edge.direct === "none") edge.direct = direction;
		else if (edge.direct !== direction) edge.direct = "mutual";
	}
}

export function directEvidence(
	a: PaperNode,
	b: PaperNode,
	openAlex: boolean,
	openCitations: boolean,
): CitationEvidence {
	return {
		citingId: a.id,
		citedId: b.id,
		sources: [ ...(openAlex ? ["openalex" as const] : []), ...(openCitations ? ["opencitations" as const] : []) ],
		intents: [],
		contexts: [],
		relation: "unclear",
		evidenceQuotes: [],
		confidence: "medium",
	};
}

function normalizeIntent(value: string): CitationIntent | null {
	const normalized = value.toLowerCase();
	if (normalized === "background") return "background";
	if (normalized === "method") return "method";
	if (normalized === "result" || normalized === "result_extension") return "result";
	return null;
}

function key(a: string, b: string): string {
	return `${a}\0${b}`;
}

function merge(a: CitationEvidence, b: CitationEvidence): CitationEvidence {
	return {
		...a,
		...b,
		sources: [...new Set([...a.sources, ...b.sources])],
		intents: [...new Set([...a.intents, ...b.intents])],
		contexts: [...new Set([...a.contexts, ...b.contexts])],
		evidenceQuotes: [...new Set([...a.evidenceQuotes, ...b.evidenceQuotes])],
		influential: b.influential ?? a.influential,
		relation: b.relation === "unclear" ? a.relation : b.relation,
		confidence: a.confidence === "high" || b.confidence === "high" ? "high" : a.confidence === "medium" || b.confidence === "medium" ? "medium" : "low",
	};
}
