import { tr } from "./i18n";
import type { SimilarityGraph } from "./neighborhood";
import type { GraphEdge, PaperNode } from "./types";

/** List views. They do not add edge types. */
export const PRIOR_DEFINITION =
	tr("被至少 2 篇可见文献引用的作品；引用列表可能不完整。", "Works cited by at least two visible papers; reference lists may be incomplete.");

export const DERIVATIVE_DEFINITION =
	tr("引用了至少 2 篇可见文献的作品；不表示时间先后或思想继承，引用列表可能不完整。", "Works citing at least two visible papers; this implies neither chronology nor intellectual influence. Reference lists may be incomplete.");

export const AGGREGATE_EMPTY_TEXT = tr("当前子图里没有命中至少 2 次的文献。", "No papers appear at least twice in this subgraph.");

export interface RankedWork {
	paper: PaperNode;
	count: number;
}

const LIST_LIMIT = 15;
const OFTEN = 2;
const CLASSIC_AGE = 3;

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

export interface ClassicEvidence {
	citations: number;
	age: number;
	channel: "short-term" | "long-term";
}

/** Classics qualify through short-term citation intensity or long-term accumulation. */
export function classicCandidates(
	nodes: readonly { id: string; year: number | null; citedByCount?: number; isSeed?: boolean; retracted?: boolean }[],
	_edges: readonly GraphEdge[],
	nowYear = new Date().getFullYear(),
	_referenceLists?: ReadonlyMap<string, readonly string[]>,
): Map<string, ClassicEvidence> {
	const candidates = new Map<string, ClassicEvidence>();
	for (const node of nodes) {
		if (node.isSeed || node.retracted || node.year === null) continue;
		const age = nowYear - node.year;
		const citations = node.citedByCount ?? 0;
		if (!Number.isFinite(age) || age < CLASSIC_AGE || !Number.isFinite(citations)) continue;
		const longTerm = age >= 8;
		if (citations < (longTerm ? 1000 : age * 100)) continue;
		candidates.set(node.id, { citations, age, channel: longTerm ? "long-term" : "short-term" });
	}
	return candidates;
}

export function classicNodeIds(
	nodes: readonly { id: string; year: number | null; citedByCount?: number; isSeed?: boolean; retracted?: boolean }[],
	edges: readonly GraphEdge[],
	nowYear = new Date().getFullYear(),
	referenceLists?: ReadonlyMap<string, readonly string[]>,
): Set<string> {
	return new Set(classicCandidates(nodes, edges, nowYear, referenceLists).keys());
}

/** 0–1 cumulative influence among the selected classics. */
export function classicInfluence(
	nodes: readonly { id: string; year: number | null; citedByCount: number; isSeed?: boolean; retracted?: boolean }[],
	edges: readonly GraphEdge[],
	nowYear = new Date().getFullYear(),
	referenceLists?: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
	const ids = classicNodeIds(nodes, edges, nowYear, referenceLists);
	const out = new Map<string, number>();
	if (ids.size === 0) return out;
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const score = (id: string): number => {
		const node = byId.get(id);
		if (!node) return 0;
		return Math.max(0, node.citedByCount);
	};
	const values = [...ids].map(score);
	const lo = Math.sqrt(Math.min(...values));
	const hi = Math.sqrt(Math.max(...values));
	for (const id of ids) {
		const t = hi === 0 ? 0 : hi - lo < 1e-9 ? 0.5 : (Math.sqrt(score(id)) - lo) / (hi - lo);
		out.set(id, t);
	}
	return out;
}
