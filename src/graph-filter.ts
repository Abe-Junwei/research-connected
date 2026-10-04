import { explainRelation, relationKind, type RelationKind } from "./relation";
import type { GraphEdge, PaperNode } from "./types";

export type StrengthTier = "weak" | "mid" | "strong";

export const TIER_LABEL: Record<StrengthTier, string> = {
	weak: "弱",
	mid: "中",
	strong: "强",
};

/** Cylinder radius in layout units. Same three steps as the 弱 / 中 / 强 legend bars. */
export const TIER_RADIUS: Record<StrengthTier, number> = {
	weak: 0.9,
	mid: 1.8,
	strong: 3.1,
};

export interface GraphFilter {
	kinds: Record<RelationKind, boolean>;
	minCoCitedBy: number;
	minSharedRefs: number;
	yearFrom: number | null;
	yearTo: number | null;
	language: string | null;
	workType: string | null;
	concept: string | null;
	focusPath: boolean;
	/** Hide papers published after this year. Null shows the whole filtered graph, including undated papers. */
	scrubYear: number | null;
}

export function emptyFilter(): GraphFilter {
	return {
		kinds: { direct: true, cocitation: true, coupling: true, weak: true },
		minCoCitedBy: 1,
		minSharedRefs: 1,
		yearFrom: null,
		yearTo: null,
		language: null,
		workType: null,
		concept: null,
		focusPath: true,
		scrubYear: null,
	};
}

export function strengthTier(edge: GraphEdge): StrengthTier {
	const kind = relationKind(edge);
	if (kind === "weak") return "weak";
	const score = edge.structuralSimilarity === null ? 0 : edge.structuralSimilarity ?? edge.weight;
	if (score >= 0.55) return "strong";
	if (score >= 0.22) return "mid";
	return "weak";
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

/** Neighbors of the selection, plus the shortest visible path back to the seed when requested. */
export function focusNodes(
	selectedId: string | null,
	seedId: string,
	edges: readonly GraphEdge[],
	visible: (edge: GraphEdge) => boolean,
	includePath: boolean,
): Set<string> | null {
	if (!selectedId) return null;
	const adjacent = new Map<string, string[]>();
	const link = (from: string, to: string): void => {
		const list = adjacent.get(from);
		if (list) list.push(to);
		else adjacent.set(from, [to]);
	};
	for (const edge of edges) {
		if (!visible(edge)) continue;
		link(edge.source, edge.target);
		link(edge.target, edge.source);
	}
	const keep = new Set<string>([selectedId, ...(adjacent.get(selectedId) ?? [])]);
	if (includePath && selectedId !== seedId) {
		for (const id of shortestPath(adjacent, selectedId, seedId)) keep.add(id);
	}
	return keep;
}

export function shortestPath(adjacent: ReadonlyMap<string, readonly string[]>, start: string, goal: string): string[] {
	if (start === goal) return [start];
	const previous = new Map<string, string | null>([[start, null]]);
	const queue = [start];
	for (let head = 0; head < queue.length; head++) {
		const current = queue[head];
		if (!current) continue;
		for (const next of adjacent.get(current) ?? []) {
			if (previous.has(next)) continue;
			previous.set(next, current);
			if (next === goal) {
				const path = [goal];
				let cursor: string | null = current;
				while (cursor) {
					path.push(cursor);
					cursor = previous.get(cursor) ?? null;
				}
				path.reverse();
				return path;
			}
			queue.push(next);
		}
	}
	return [];
}

export function facetOptions(nodes: readonly PaperNode[]): {
	languages: string[];
	types: string[];
	concepts: string[];
} {
	const languages = new Set<string>();
	const types = new Set<string>();
	const conceptCount = new Map<string, { label: string; count: number }>();
	for (const node of nodes) {
		if (node.language) languages.add(node.language);
		if (node.workType) types.add(node.workType);
		for (const concept of node.concepts) {
			const key = concept.toLowerCase();
			const existing = conceptCount.get(key);
			if (existing) existing.count += 1;
			else conceptCount.set(key, { label: concept, count: 1 });
		}
	}
	const concepts = [...conceptCount.values()]
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
		.slice(0, 40)
		.map((item) => item.label);
	return {
		languages: [...languages].sort(),
		types: [...types].sort(),
		concepts,
	};
}

/** Shown whenever a connection rests on similarity signals without a direct citation record. */
export const SIMILARITY_NOT_CITATION = "图谱相似关系，不代表直接引用";

/** Counts, tier, and the OpenAlex sampling caveat. Shown on edge hover and click. */
export function evidenceText(
	edge: GraphEdge,
	source: Pick<PaperNode, "authors" | "year">,
	target: Pick<PaperNode, "authors" | "year">,
	sources = "OpenAlex 采样",
): string {
	return [
		explainRelation(edge, source, target),
		...(edge.direct === "none" ? [SIMILARITY_NOT_CITATION] : []),
		`强度 ${TIER_LABEL[strengthTier(edge)]}`,
		`共享参考文献 ${edge.sharedRefs} 篇`,
		`共被引 ${edge.coCitedBy} 次`,
		`来源：${sources}`,
		"引用列表可能不完整",
	].join("\n");
}
