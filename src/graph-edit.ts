import { buildSimilarity } from "./similarity";
import type { GraphEdge, PaperNode } from "./types";

export const EXPAND_CAP = 8;
/** Max seeds remembered for grafted members. */
export const GRAFT_SEED_CAP = 24;
/** Max grafted paper ids kept per seed. */
export const GRAFT_IDS_CAP = 80;

/** The fields omit/graft/refresh touch. SimilarityGraph is a structural match. */
export interface EditableGraph {
	nodes: PaperNode[];
	edges: GraphEdge[];
	seedScore: Map<string, number>;
	referenceLists: ReadonlyMap<string, readonly string[]>;
	catalog: readonly PaperNode[];
}

export function omitNode<T extends EditableGraph>(graph: T, id: string): T | null {
	const target = graph.nodes.find((node) => node.id === id);
	if (!target || target.isSeed) return null;
	return {
		...graph,
		nodes: graph.nodes.filter((node) => node.id !== id),
		edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
	};
}

export function graftNodes<T extends EditableGraph>(
	graph: T,
	papers: readonly PaperNode[],
	lists: ReadonlyMap<string, readonly string[]>,
): T {
	const have = new Set(graph.nodes.map((node) => node.id));
	const extra = papers.filter((paper) => !have.has(paper.id) && !paper.isSeed);
	if (extra.length === 0 && lists.size === 0) return graph;
	const referenceLists = new Map(graph.referenceLists);
	for (const [id, list] of lists) referenceLists.set(id, list);
	const catalogIds = new Set(graph.catalog.map((paper) => paper.id));
	const catalog = [...graph.catalog];
	for (const paper of extra) {
		if (catalogIds.has(paper.id)) continue;
		catalogIds.add(paper.id);
		catalog.push(paper);
	}
	return { ...graph, nodes: [...graph.nodes, ...extra], referenceLists, catalog };
}

export function refreshDerived<T extends EditableGraph>(graph: T): T {
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) return graph;
	const references = new Map<string, Set<string>>();
	for (const node of graph.nodes) references.set(node.id, new Set(graph.referenceLists.get(node.id) ?? []));
	const contexts = [...graph.referenceLists.values()]
		.filter((list) => list.length > 0)
		.map((list) => new Set(list));
	const { edges, seedScore } = buildSimilarity({
		ids: graph.nodes.map((node) => node.id),
		seedId: seed.id,
		references,
		contexts,
	});
	return { ...graph, edges, seedScore };
}

export function chooseExpand(
	present: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	slots: number,
	groups: { reference: readonly PaperNode[]; citation: readonly PaperNode[] },
): PaperNode[] {
	if (slots <= 0) return [];
	const ok = (paper: PaperNode): boolean => !paper.isSeed && !present.has(paper.id) && !hidden.has(paper.id);
	const byCite = (a: PaperNode, b: PaperNode): number => b.citedByCount - a.citedByCount || a.id.localeCompare(b.id);
	const refs = groups.reference.filter(ok).sort(byCite);
	const cites = groups.citation.filter(ok).sort(byCite);
	const take = (list: PaperNode[], n: number, skip: ReadonlySet<string>): PaperNode[] => {
		const out: PaperNode[] = [];
		for (const paper of list) {
			if (out.length >= n) break;
			if (skip.has(paper.id)) continue;
			out.push(paper);
		}
		return out;
	};
	const refSlots = Math.min(refs.length, Math.ceil(slots / 2));
	const pickedRefs = take(refs, refSlots, new Set());
	const have = new Set(pickedRefs.map((paper) => paper.id));
	const pickedCites = take(cites, slots - pickedRefs.length, have);
	for (const paper of pickedCites) have.add(paper.id);
	const rest = take([...refs, ...cites], slots - have.size, have);
	return [...pickedRefs, ...pickedCites, ...rest];
}

/** Promote catalog papers that share references or cite `fromId`. */
export function couplingFill<T extends EditableGraph>(
	graph: T,
	fromId: string,
	present: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	need: number,
): PaperNode[] {
	if (need <= 0) return [];
	const fromRefs = new Set(graph.referenceLists.get(fromId) ?? []);
	const scored: Array<{ paper: PaperNode; shared: number }> = [];
	for (const paper of graph.catalog) {
		if (paper.isSeed || paper.id === fromId || present.has(paper.id) || hidden.has(paper.id)) continue;
		const refs = graph.referenceLists.get(paper.id) ?? [];
		let shared = 0;
		if (fromRefs.has(paper.id) || refs.includes(fromId)) shared += 2;
		if (fromRefs.size > 0) {
			for (const id of refs) if (fromRefs.has(id)) shared += 1;
		}
		if (shared > 0) scored.push({ paper, shared });
	}
	scored.sort((a, b) => b.shared - a.shared || b.paper.citedByCount - a.paper.citedByCount || a.paper.id.localeCompare(b.paper.id));
	return scored.slice(0, need).map((item) => item.paper);
}

/** Normalize persisted seed → grafted OpenAlex ids. */
export function normalizeGrafted(raw: unknown): Record<string, string[]> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, string[]> = {};
	for (const [seedId, ids] of Object.entries(raw as Record<string, unknown>)) {
		if (!/^W\d+$/i.test(seedId) || !Array.isArray(ids)) continue;
		const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).map((id) => id.toUpperCase()))];
		if (clean.length) out[seedId.toUpperCase()] = clean.slice(0, GRAFT_IDS_CAP);
	}
	return out;
}

export function graftedFor(store: Record<string, string[]>, seedId: string): string[] {
	return store[seedId.toUpperCase()] ?? [];
}

export function rememberGrafted(
	store: Record<string, string[]>,
	seedId: string,
	ids: readonly string[],
): Record<string, string[]> {
	const key = seedId.toUpperCase();
	const next = { ...store };
	const have = new Set(next[key] ?? []);
	for (const id of ids) {
		if (/^W\d+$/i.test(id)) have.add(id.toUpperCase());
	}
	next[key] = [...have].slice(0, GRAFT_IDS_CAP);
	const keys = Object.keys(next);
	if (keys.length <= GRAFT_SEED_CAP) return next;
	// Drop oldest keys (object key order is insertion order).
	for (const drop of keys.slice(0, keys.length - GRAFT_SEED_CAP)) delete next[drop];
	return next;
}

export function forgetGrafted(
	store: Record<string, string[]>,
	seedId: string,
	id: string,
): Record<string, string[]> {
	const key = seedId.toUpperCase();
	const list = nextWithout(store[key], id.toUpperCase());
	if (!list) {
		if (!(key in store)) return store;
		const next = { ...store };
		delete next[key];
		return next;
	}
	return { ...store, [key]: list };
}

function nextWithout(list: string[] | undefined, id: string): string[] | null {
	if (!list?.length) return null;
	const filtered = list.filter((item) => item !== id);
	if (filtered.length === list.length) return list;
	return filtered.length ? filtered : null;
}
