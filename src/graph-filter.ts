import { tr } from "./i18n";
import { comparableStructuralSimilarity, explainRelation, observedRelationCount, relationKind, type RelationKind } from "./relation";
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
	if (node.isSeed) return true;
	return nodeMatchesFilter(node, filter);
}

/** Seed display exceptions do not participate in filtered relations or default exports. */
export function nodeMatchesFilter(node: PaperNode, filter: GraphFilter): boolean {
	if (filter.scrubYear !== null && (node.year === null || node.year > filter.scrubYear)) return false;
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
	if (!source || !target || !nodeMatchesFilter(source, filter) || !nodeMatchesFilter(target, filter)) return false;
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
export const SIMILARITY_NOT_CITATION = tr("图谱相似关系，不代表直接引用", "Graph similarity does not imply a direct citation");

/** Counts and the OpenAlex sampling caveat. Shown on edge hover and click. */
export function evidenceText(
	edge: GraphEdge,
	source: Pick<PaperNode, "authors" | "year">,
	target: Pick<PaperNode, "authors" | "year">,
	sources = tr("OpenAlex 采样", "OpenAlex sample"),
): string {
	return [
		explainRelation(edge, source, target),
		...(edge.direct === "none" ? [SIMILARITY_NOT_CITATION] : []),
		tr(`共享参考文献 ${observedRelationCount(edge, "references")}`, `Shared references: ${observedRelationCount(edge, "references")}`),
		tr(`共被引 ${observedRelationCount(edge, "coCitation")}`, `Co-citations: ${observedRelationCount(edge, "coCitation")}`),
		tr(`来源：${sources}`, `Source: ${sources}`),
		tr("引用列表可能不完整", "Reference lists may be incomplete"),
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
	sources = tr("OpenAlex 采样", "OpenAlex sample"),
): RelationFacts {
	const from = authorYear(source);
	const to = authorYear(target);
	let lead = tr("采样邻域里的弱连线", "Weak link within the sampled neighborhood");
	if (edge.direct === "mutual") lead = tr(`${from} 与 ${to} 互相引用`, `${from} and ${to} cite each other`);
	else if (edge.direct === "source-cites-target") lead = tr(`${from} 引用了 ${to}`, `${from} cites ${to}`);
	else if (edge.direct === "target-cites-source") lead = tr(`${to} 引用了 ${from}`, `${to} cites ${from}`);
	else if (edge.coCitedBy > 0 || edge.sharedRefs > 0) lead = tr("没有直接引用记录", "No direct citation recorded");
	const facts: RelationFact[] = [
		{
			label: tr("相似度", "Similarity"),
			value: comparableStructuralSimilarity(edge) === null
				? tr("不可用（缺少可比较数据）", "Unavailable (no comparable data)")
				: comparableStructuralSimilarity(edge)!.toFixed(2),
		},
		{ label: tr("共享参考文献", "Shared references"), value: observedRelationCount(edge, "references") },
		{ label: tr("共被引", "Co-citations"), value: observedRelationCount(edge, "coCitation") },
		{ label: tr("来源", "Source"), value: sources },
	];
	const caveats = [
		tr("共享参考基于当前取得的列表，共被引基于本次采样；零不代表全库为零。", "Shared references use obtained lists and co-citations use this sample; zero does not mean zero across the database."),
		...(edge.direct === "none" ? [SIMILARITY_NOT_CITATION] : []),
	];
	return { lead, facts, caveats };
}
