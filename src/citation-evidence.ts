import type { SemanticCitation } from "./citation-sources";
import type { PaperNode } from "./types";
import type { SimilarityGraph } from "./neighborhood";

export type CitationIntent = "background" | "method" | "result";
export type CitationRelation = "background" | "method" | "extension" | "validation" | "application" | "criticism" | "unclear";

export interface CitationEvidence {
	citingId: string;
	citedId: string;
	sources: Array<"openalex" | "opencitations" | "semantic-scholar">;
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
	const labels = evidence.intents.map((intent) => intent === "result" ? "Result" : `${intent.slice(0, 1).toUpperCase()}${intent.slice(1)}`);
	if (evidence.influential) labels.push("Influential");
	return labels.length > 0 ? labels.join(" · ") : "已确认引用关系，暂无引用意图";
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
		graph.edges.push({ source: citingId, target: citedId, weight: 0.1, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target" });
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
