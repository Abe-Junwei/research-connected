import { tr } from "./i18n";
import type { SimilarityGraph } from "./neighborhood";
import type { GraphEdge, PaperNode } from "./types";

/** List views. They do not add edge types. */
export const PRIOR_DEFINITION =
	tr("被图内至少 2 篇论文共同引用的文献；引用列表可能不完整。", "Works cited by at least two papers in this graph; reference lists may be incomplete.");

export const DERIVATIVE_DEFINITION =
	tr("引用了至少 2 篇图内论文的后续工作；引用列表可能不完整。", "Later works that cite at least two papers in this graph; reference lists may be incomplete.");

export const AGGREGATE_EMPTY_TEXT = tr("当前子图里没有命中至少 2 次的文献。", "No papers appear at least twice in this subgraph.");

export interface RankedWork {
	paper: PaperNode;
	count: number;
}

const LIST_LIMIT = 15;
const OFTEN = 2;
const CLASSIC_AGE = 8;
const CLASSIC_CAP = 8;

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

/** In-graph citation hubs that have had time to become canonical. Seed excluded. */
export function classicNodeIds(
	nodes: readonly { id: string; year: number | null; isSeed?: boolean }[],
	edges: readonly GraphEdge[],
	nowYear = new Date().getFullYear(),
): Set<string> {
	const incoming = new Map<string, number>();
	const bump = (id: string): void => {
		incoming.set(id, (incoming.get(id) ?? 0) + 1);
	};
	for (const edge of edges) {
		if (edge.direct === "source-cites-target" || edge.direct === "mutual") bump(edge.target);
		if (edge.direct === "target-cites-source" || edge.direct === "mutual") bump(edge.source);
	}
	return new Set(
		nodes
			.filter((node) => !node.isSeed && (incoming.get(node.id) ?? 0) >= OFTEN && node.year !== null && nowYear - node.year >= CLASSIC_AGE)
			.sort((a, b) => (incoming.get(b.id) ?? 0) - (incoming.get(a.id) ?? 0) || (a.year ?? 0) - (b.year ?? 0) || a.id.localeCompare(b.id))
			.slice(0, CLASSIC_CAP)
			.map((node) => node.id),
	);
}

/** 0–1 influence among classics: √ of year-normalized citations on this graph. */
export function classicInfluence(
	nodes: readonly { id: string; year: number | null; citedByCount: number; isSeed?: boolean }[],
	edges: readonly GraphEdge[],
	nowYear = new Date().getFullYear(),
): Map<string, number> {
	const ids = classicNodeIds(nodes, edges, nowYear);
	const out = new Map<string, number>();
	if (ids.size === 0) return out;
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const score = (id: string): number => {
		const node = byId.get(id);
		if (!node) return 0;
		const age = node.year === null ? 1 : Math.max(1, nowYear - node.year);
		return Math.max(0, node.citedByCount) / age;
	};
	const values = [...ids].map(score);
	const lo = Math.sqrt(Math.min(...values));
	const hi = Math.sqrt(Math.max(...values));
	for (const id of ids) {
		const t = hi - lo < 1e-9 ? 1 : (Math.sqrt(score(id)) - lo) / (hi - lo);
		out.set(id, t);
	}
	return out;
}
