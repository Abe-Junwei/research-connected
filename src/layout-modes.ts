import { runForceLayout, type ForceNode } from "./layout";
import { runForceLayout3D, type ForceNode3D } from "./layout-3d";
import type { GraphEdge, PaperNode } from "./types";
import { citationRadius } from "./visual";

/** `temporal` is the note-embed default: year on X, log citations on Y. */
export type LayoutMode = "force3d" | "force2d" | "temporal" | "radial";

/** `community` is the note-embed default. `year` restores the citation-year ramp. */
export type ColorMode = "year" | "community";

export const LAYOUT_LABEL: Record<LayoutMode, string> = {
	temporal: "时间",
	radial: "放射",
	force2d: "平面",
	force3d: "三维",
};

export const LAYOUT_HINT: Record<LayoutMode, string> = {
	temporal: "横轴是年份，纵轴是对数被引。笔记里推荐这个布局。",
	radial: "种子在中心，越近表示和种子越相似。",
	force2d: "平面力导向，种子固定在中心。",
	force3d: "三维力导向。拖拽旋转，滚轮缩放。",
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
	if (mode === "force3d") return placeForce3d(placed, edges, seed.id, seedScore);
	if (mode === "force2d") return placeForce2d(placed, edges, seed.id, seedScore);
	if (mode === "radial") return placeRadial(placed, nodes, seed.id, seedScore);
	return placeTemporal(placed, nodes);
}

function placeForce3d(
	placed: PlacedNode[],
	edges: readonly GraphEdge[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const nodes: ForceNode3D[] = placed.map((node) => ({ ...node }));
	runForceLayout3D(nodes, edges as GraphEdge[], seedId, new Map(seedScore));
	return nodes.map((node) => ({ ...node }));
}

function placeForce2d(
	placed: PlacedNode[],
	edges: readonly GraphEdge[],
	seedId: string,
	seedScore: ReadonlyMap<string, number>,
): PlacedNode[] {
	const nodes: ForceNode[] = placed.map((node) => ({ id: node.id, x: 0, y: 0, radius: node.radius }));
	runForceLayout(nodes, edges as GraphEdge[], seedId, new Map(seedScore));
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
	const span = Math.max(1, maxYear - minYear);
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
		const x = year === null ? -width / 2 - 36 : ((year - minYear) / span - 0.5) * width;
		const y = (Math.log10(cited + 1) / maxLog - 0.5) * height;
		const jitter = (slot % 5) * 16 - 32;
		return { ...node, x: x + jitter, y, z: (slot % 3) * 10 };
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
