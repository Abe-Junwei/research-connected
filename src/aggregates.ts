import type { SimilarityGraph } from "./neighborhood";
import type { PaperNode } from "./types";

/** List views. They do not add edge types. */
export const PRIOR_DEFINITION =
	"先验工作：常被当前子图里的论文引用。数字是有多少篇子图论文的参考文献列表包含它。这是列表，不是新的连线。引用列表可能不完整。";

export const DERIVATIVE_DEFINITION =
	"衍生工作：常引用当前子图里的论文。数字是它的参考文献列表里包含多少篇子图论文。这是列表，不是新的连线。引用列表可能不完整。";

export interface RankedWork {
	paper: PaperNode;
	count: number;
}

const LIST_LIMIT = 15;
const OFTEN = 2;

/**
 * Works cited by many papers in the visible subgraph.
 * A work needs a title we already fetched; unknown reference ids are skipped.
 */
export function priorWorks(graph: SimilarityGraph, visibleIds: ReadonlySet<string>): RankedWork[] {
	const known = new Set<string>([...visibleIds, ...graph.catalog.map((paper) => paper.id), ...graph.nodes.map((paper) => paper.id)]);
	const counts = new Map<string, number>();
	for (const id of visibleIds) {
		for (const ref of graph.referenceLists.get(id) ?? []) {
			if (ref === id || !known.has(ref)) continue;
			counts.set(ref, (counts.get(ref) ?? 0) + 1);
		}
	}
	return rank(graph, counts, "prior").filter((item) => item.count >= OFTEN);
}

/**
 * Works whose reference list includes many papers in the visible subgraph.
 * Citers that never became nodes are included when their metadata was fetched.
 */
export function derivativeWorks(graph: SimilarityGraph, visibleIds: ReadonlySet<string>): RankedWork[] {
	const counts = new Map<string, number>();
	for (const paper of graph.catalog) {
		if (paper.isSeed || paper.id === graphSeedId(graph)) continue;
		const refs = graph.referenceLists.get(paper.id);
		if (!refs) continue;
		let hits = 0;
		for (const ref of refs) {
			if (ref !== paper.id && visibleIds.has(ref)) hits += 1;
		}
		if (hits > 0) counts.set(paper.id, hits);
	}
	return rank(graph, counts, "derivative").filter((item) => item.count >= OFTEN);
}

function rank(graph: SimilarityGraph, counts: ReadonlyMap<string, number>, kind: "prior" | "derivative"): RankedWork[] {
	const seedId = graphSeedId(graph);
	const known = new Map<string, PaperNode>();
	for (const paper of graph.catalog) known.set(paper.id, paper);
	for (const paper of graph.nodes) known.set(paper.id, paper);
	const items: RankedWork[] = [];
	for (const [id, count] of counts) {
		if (id === seedId) continue;
		const paper = known.get(id);
		if (!paper) continue;
		items.push({ paper, count });
	}
	items.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		const yearA = a.paper.year ?? (kind === "prior" ? 9999 : 0);
		const yearB = b.paper.year ?? (kind === "prior" ? 9999 : 0);
		if (yearA !== yearB) return kind === "prior" ? yearA - yearB : yearB - yearA;
		return a.paper.title.localeCompare(b.paper.title);
	});
	return items.slice(0, LIST_LIMIT);
}

function graphSeedId(graph: SimilarityGraph): string {
	return graph.nodes.find((node) => node.isSeed)?.id ?? "";
}
