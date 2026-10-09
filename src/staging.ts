import { tr } from "./i18n";
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
	seed: tr("种子论文", "Seed paper"),
	reference: tr("种子的参考文献", "Seed references"),
	citation: tr("引用了种子", "Cites the seed"),
	related: tr("OpenAlex 相关作品", "OpenAlex related works"),
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

export function groupStagedBySeed<T extends StagedPaper>(items: readonly T[]): Array<{ seedId: string; items: T[] }> {
	const order: string[] = [];
	const map = new Map<string, T[]>();
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
	if (seedCites && paperCites) return tr(`互引 · ${sources}`, `Mutual citation · ${sources}`);
	if (seedCites) return tr(`种子引用了它 · ${sources}`, `Seed cites this paper · ${sources}`);
	if (paperCites) return tr(`它引用了种子 · ${sources}`, `This paper cites the seed · ${sources}`);
	return `${ORIGIN_FALLBACK[paper.origin]} · ${sources}`;
}

/** Render source labels saved by either language version without rewriting project data. */
export function displayStageSource(source: string): string {
	const separator = source.indexOf(" · ");
	const head = separator < 0 ? source : source.slice(0, separator);
	const tail = separator < 0 ? "" : source.slice(separator);
	const labels: Array<[string, string]> = [
		["种子论文", "Seed paper"], ["种子的参考文献", "Seed references"],
		["引用了种子", "Cites the seed"], ["OpenAlex 相关作品", "OpenAlex related works"],
		["互引", "Mutual citation"], ["种子引用了它", "Seed cites this paper"],
		["它引用了种子", "This paper cites the seed"],
	];
	const match = labels.find(([zh, en]) => head === zh || head === en);
	return match ? tr(match[0], match[1]) + tail : source;
}

function isStagedPaper(value: unknown): value is StagedPaper {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<StagedPaper>;
	return typeof item.seedId === "string" && Boolean(item.paper) && typeof item.source === "string";
}
