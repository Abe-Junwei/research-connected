import { explainRelation, relationKind, type RelationKind } from "./relation";
import { authorYear } from "./labels";
import type { GraphEdge, PaperNode } from "./types";

export interface GraphFilter {
	kinds: Record<RelationKind, boolean>;
	minCoCitedBy: number;
	minSharedRefs: number;
	yearFrom: number | null;
	yearTo: number | null;
	language: string | null;
	workType: string | null;
	concept: string | null;
	/** Hide papers published after this year. Null shows the whole filtered graph, including undated papers. */
	scrubYear: number | null;
}

export function emptyFilter(): GraphFilter {
	return {
		kinds: { direct: true, cocitation: true, coupling: true, weak: false },
		minCoCitedBy: 1,
		minSharedRefs: 1,
		yearFrom: null,
		yearTo: null,
		language: null,
		workType: null,
		concept: null,
		scrubYear: null,
	};
}

export function nodeVisible(node: PaperNode, filter: GraphFilter): boolean {
	if (filter.scrubYear !== null && (node.year === null || node.year > filter.scrubYear)) return false;
	if (node.isSeed) return true;
	let yearFrom = filter.yearFrom;
	let yearTo = filter.yearTo;
	if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
		const swap = yearFrom;
		yearFrom = yearTo;
		yearTo = swap;
	}
	if (yearFrom !== null && (node.year === null || node.year < yearFrom)) return false;
	if (yearTo !== null && (node.year === null || node.year > yearTo)) return false;
	if (filter.language && node.language !== filter.language) return false;
	if (filter.workType && node.workType !== filter.workType) return false;
	if (filter.concept && !node.concepts.some((name) => name.toLowerCase() === filter.concept?.toLowerCase())) {
		return false;
	}
	return true;
}

export function visibleNodes(nodes: readonly PaperNode[], filter: GraphFilter): PaperNode[] {
	return nodes.filter((node) => nodeVisible(node, filter));
}

export function edgeVisible(
	edge: GraphEdge,
	nodes: ReadonlyMap<string, PaperNode>,
	filter: GraphFilter,
): boolean {
	const source = nodes.get(edge.source);
	const target = nodes.get(edge.target);
	if (!source || !target || !nodeVisible(source, filter) || !nodeVisible(target, filter)) return false;
	const kind = relationKind(edge);
	if (!filter.kinds[kind]) return false;
	if (kind === "cocitation" && edge.coCitedBy < filter.minCoCitedBy) return false;
	if (kind === "coupling" && edge.sharedRefs < filter.minSharedRefs) return false;
	return true;
}

/** One-hop neighborhood of the hovered or selected node. */
export function focusNodes(
	selectedId: string | null,
	edges: readonly GraphEdge[],
	visible: (edge: GraphEdge) => boolean,
): Set<string> | null {
	if (!selectedId) return null;
	const keep = new Set<string>([selectedId]);
	for (const edge of edges) {
		if (!visible(edge)) continue;
		if (edge.source === selectedId) keep.add(edge.target);
		else if (edge.target === selectedId) keep.add(edge.source);
	}
	return keep;
}

/** Shown whenever a connection rests on similarity signals without a direct citation record. */
export const SIMILARITY_NOT_CITATION = "图谱相似关系，不代表直接引用";

/** Counts and the OpenAlex sampling caveat. Shown on edge hover and click. */
export function evidenceText(
	edge: GraphEdge,
	source: Pick<PaperNode, "authors" | "year">,
	target: Pick<PaperNode, "authors" | "year">,
	sources = "OpenAlex 采样",
): string {
	return [
		explainRelation(edge, source, target),
		...(edge.direct === "none" ? [SIMILARITY_NOT_CITATION] : []),
		`共享参考文献 ${edge.sharedRefs} 篇`,
		`共被引 ${edge.coCitedBy} 次`,
		`来源：${sources}`,
		"引用列表可能不完整",
	].join("\n");
}

export interface RelationFact {
	label: string;
	value: string;
}

/**
 * Structured counterpart of evidenceText for the sidebar card: one lead
 * sentence, deduplicated label/value rows, then caveats. Numbers appear
 * either in the lead or in a row, never both.
 */
export interface RelationFacts {
	lead: string;
	facts: RelationFact[];
	caveats: string[];
}

export function relationFacts(
	edge: GraphEdge,
	source: Pick<PaperNode, "authors" | "year">,
	target: Pick<PaperNode, "authors" | "year">,
	sources = "OpenAlex 采样",
): RelationFacts {
	const from = authorYear(source);
	const to = authorYear(target);
	let lead = "采样邻域里的弱连线";
	if (edge.direct === "mutual") lead = `${from} 与 ${to} 互相引用`;
	else if (edge.direct === "source-cites-target") lead = `${from} 引用了 ${to}`;
	else if (edge.direct === "target-cites-source") lead = `${to} 引用了 ${from}`;
	else if (edge.coCitedBy > 0 || edge.sharedRefs > 0) lead = "没有直接引用记录";
	const facts: RelationFact[] = [
		{
			label: "相似度",
			value: edge.structuralSimilarity === null
				? "不可用（缺少可比较数据）"
				: (edge.structuralSimilarity ?? edge.weight).toFixed(2),
		},
		{ label: "共享参考文献", value: `${edge.sharedRefs} 篇` },
		{ label: "共被引", value: `${edge.coCitedBy} 次` },
		{ label: "来源", value: sources },
	];
	const caveats = [
		...(edge.direct === "none" ? [SIMILARITY_NOT_CITATION] : []),
		"引用列表可能不完整",
	];
	return { lead, facts, caveats };
}
