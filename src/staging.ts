import { SOURCE_TEXT, type CitationEvidence } from "./citation-evidence";
import type { GraphEdge, Origin, PaperNode } from "./types";

export const STAGED_VERSION = 1 as const;

export interface StagedPaper {
	seedId: string;
	paper: PaperNode;
	source: string;
	addedAt: string;
	read: boolean;
}

/** Persisted shape; in-memory settings keep a flat `StagedPaper[]`. */
export interface StagedList {
	version: typeof STAGED_VERSION;
	items: StagedPaper[];
}

const ORIGIN_FALLBACK: Record<Origin, string> = {
	seed: "种子论文",
	reference: "种子的参考文献",
	citation: "引用了种子",
	related: "OpenAlex 相关作品",
};

export function stageKey(item: Pick<StagedPaper, "seedId" | "paper">): string {
	return `${item.seedId}\0${item.paper.id}`;
}

export function toggleStaged(items: readonly StagedPaper[], paper: PaperNode, seedId: string, source: string): StagedPaper[] {
	const key = `${seedId}\0${paper.id}`;
	if (items.some((item) => stageKey(item) === key)) return items.filter((item) => stageKey(item) !== key);
	return [...items, { seedId, paper, source, addedAt: new Date().toISOString(), read: false }];
}

/** Accept legacy bare arrays and `{ version: 1, items }`. */
export function normalizeStagedList(raw: unknown): StagedPaper[] {
	if (Array.isArray(raw)) return raw.filter(isStagedPaper);
	if (raw && typeof raw === "object") {
		const list = raw as Partial<StagedList>;
		if (list.version === STAGED_VERSION && Array.isArray(list.items)) return list.items.filter(isStagedPaper);
	}
	return [];
}

export function wrapStagedList(items: readonly StagedPaper[]): StagedList {
	return { version: STAGED_VERSION, items: [...items] };
}

export function groupStagedBySeed(items: readonly StagedPaper[]): Array<{ seedId: string; items: StagedPaper[] }> {
	const order: string[] = [];
	const map = new Map<string, StagedPaper[]>();
	for (const item of items) {
		const list = map.get(item.seedId);
		if (list) list.push(item);
		else {
			order.push(item.seedId);
			map.set(item.seedId, [item]);
		}
	}
	return order.map((seedId) => ({ seedId, items: map.get(seedId)! }));
}

/** True when `from` cites `to` on this edge (mutual counts both ways). */
function directedCite(edge: GraphEdge, from: string, to: string): boolean {
	if (edge.direct === "source-cites-target") return edge.source === from && edge.target === to;
	if (edge.direct === "target-cites-source") return edge.target === from && edge.source === to;
	if (edge.direct === "mutual") {
		return (edge.source === from && edge.target === to) || (edge.source === to && edge.target === from);
	}
	return false;
}

/**
 * Human-readable provenance for a staged row, e.g. 「种子引用了它 · OpenAlex」.
 * Falls back to sampling origin when there is no directed citation record.
 */
export function stageSourceLabel(
	paper: PaperNode,
	seedId: string,
	edge: GraphEdge | null,
	evidence: CitationEvidence | null,
): string {
	const sources = evidence?.sources.length
		? [...new Set(evidence.sources)].map((source) => SOURCE_TEXT[source]).join(" + ")
		: "OpenAlex";
	if (!edge || edge.direct === "none") return `${ORIGIN_FALLBACK[paper.origin]} · ${sources}`;
	const seedCites = directedCite(edge, seedId, paper.id);
	const paperCites = directedCite(edge, paper.id, seedId);
	if (seedCites && paperCites) return `互引 · ${sources}`;
	if (seedCites) return `种子引用了它 · ${sources}`;
	if (paperCites) return `它引用了种子 · ${sources}`;
	return `${ORIGIN_FALLBACK[paper.origin]} · ${sources}`;
}

function isStagedPaper(value: unknown): value is StagedPaper {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<StagedPaper>;
	return typeof item.seedId === "string" && Boolean(item.paper) && typeof item.source === "string";
}
