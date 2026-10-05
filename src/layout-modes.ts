import { runForceLayout, separateCommunities, type ForceNode } from "./layout";
import { detectCommunities } from "./communities";
import type { GraphEdge, PaperNode } from "./types";
import { citationRadius } from "./visual";

/** `temporal` is the note-embed default: year on X, log citations on Y. */
export type LayoutMode = "force2d" | "temporal" | "radial";

export type ColorMode = "year" | "community" | "graph" | "topic";

/** 平面按引用团着色；时间/放射仍用相对种子的主题相似度。 */
export function defaultColorMode(layout: LayoutMode): ColorMode {
	return layout === "force2d" ? "community" : "topic";
}

export const LAYOUT_LABEL: Record<LayoutMode, string> = {
	temporal: "时间",
	radial: "放射",
	force2d: "平面",
};

export const LAYOUT_HINT: Record<LayoutMode, string> = {
	temporal: "横向按年份排列，纵向为对数被引量；未知年份在左侧。",
	radial: "种子居中，越近越相似；角度仅用于排开节点。",
	force2d: "平面力导向；节点色为引用结构分组。标签优先用关键词，缺关键词才用标题/摘要里相对其他圈子更独特的词，不代表真实学派。",
};

export interface PlacedNode {
	id: string;
	x: number;
	y: number;
	z: number;
	radius: number;
}

export function placeLayout(
	mode: LayoutMode,
	nodes: readonly PaperNode[],
	edges: readonly GraphEdge[],
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const maxCited = nodes.reduce((max, node) => Math.max(max, node.citedByCount), 1);
	const placed: PlacedNode[] = nodes.map((node) => ({
		id: node.id,
		x: 0,
		y: 0,
		z: 0,
		radius: citationRadius(node.citedByCount, maxCited, node.isSeed),
	}));
	const seed = nodes.find((node) => node.isSeed);
	if (!seed) return placed;
	if (mode === "force2d") return placeForce2d(placed, edges, seed.id, seedScore);
	if (mode === "radial") return placeRadial(placed, nodes, seed.id, seedScore);
	return placeTemporal(placed, nodes);
}

function placeForce2d(
	placed: PlacedNode[],
	edges: readonly GraphEdge[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const nodes: ForceNode[] = placed.map((node) => ({ id: node.id, x: 0, y: 0, radius: node.radius }));
	const communities = detectCommunities(nodes.map((node) => node.id), edges);
	runForceLayout(nodes, edges as GraphEdge[], seedId, new Map(seedScore), 320, communities);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return placed.map((node) => {
		const at = byId.get(node.id);
		return { ...node, x: at?.x ?? 0, y: at?.y ?? 0, z: 0 };
	});
}

/** X is publication year. Y is log10(citations + 1). Undated papers sit just left of the span. */
function placeTemporal(placed: PlacedNode[], nodes: readonly PaperNode[]): PlacedNode[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	const minYear = years.length ? Math.min(...years) : 2000;
	const maxYear = years.length ? Math.max(...years) : minYear;
	const yearSpan = maxYear - minYear;
	const span = Math.max(1, yearSpan);
	const width = 460;
	const height = 300;
	const maxLog = Math.log10(nodes.reduce((max, node) => Math.max(max, node.citedByCount), 1) + 1) || 1;
	const buckets = new Map<string, number>();
	return placed.map((node) => {
		const paper = byId.get(node.id);
		const year = paper?.year ?? null;
		const cited = paper?.citedByCount ?? 0;
		const bucket = year === null ? "none" : String(year);
		const slot = buckets.get(bucket) ?? 0;
		buckets.set(bucket, slot + 1);
		// Keep chronological distances exact: unknown years occupy a separate gutter,
		// while known publication years map linearly onto the horizontal axis.
		const x = year === null ? -width / 2 - 48 : yearSpan === 0 ? 0 : ((year - minYear) / span - 0.5) * width;
		const y = (Math.log10(cited + 1) / maxLog - 0.5) * height;
		const verticalJitter = year === null ? (slot % 7) * 11 - 33 : (slot % 5) * 8 - 16;
		return { ...node, x, y: y + verticalJitter, z: 0 };
	});
}

/** Seed at the origin. Radius falls as similarity to the seed rises. Angle follows year. */
function placeRadial(
	placed: PlacedNode[],
	nodes: readonly PaperNode[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const others = nodes
		.filter((node) => node.id !== seedId)
		.slice()
		.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.id.localeCompare(b.id));
	const angleOf = new Map(others.map((node, index) => [node.id, (index / Math.max(1, others.length)) * Math.PI * 2]));
	return placed.map((node) => {
		if (node.id === seedId) return { ...node, x: 0, y: 0, z: 0 };
		const similarity = Math.min(1, Math.max(0, seedScore.get(node.id) ?? 0));
		const radius = 78 + (1 - similarity) * 200;
		const angle = angleOf.get(node.id) ?? 0;
		return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 };
	});
}

export { separateCommunities };
