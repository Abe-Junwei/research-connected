import { classicNodeIds } from "./aggregates";
import { communityColor, detectCommunities } from "./communities";
import type { GraphFilter } from "./graph-filter";
import type { LayoutMode } from "./layout-modes";
import { RELATION_LABEL, relationKind } from "./relation";
import type { GraphEdge } from "./types";

const KIND_ORDER = ["direct", "cocitation", "coupling"] as const;

export function graphKeyStats(
	nodes: readonly { id: string; year: number | null; isSeed?: boolean }[],
	edges: readonly GraphEdge[],
): { kinds: Record<(typeof KIND_ORDER)[number], number>; classics: number; seeds: number; groups: number } {
	const kinds = { direct: 0, cocitation: 0, coupling: 0 };
	for (const edge of edges) {
		const kind = relationKind(edge);
		if (kind === "direct" || kind === "cocitation" || kind === "coupling") kinds[kind] += 1;
	}
	return {
		kinds,
		classics: classicNodeIds(nodes, edges).size,
		seeds: nodes.reduce((n, node) => n + (node.isSeed ? 1 : 0), 0),
		groups: new Set(detectCommunities(nodes.map((node) => node.id), edges).values()).size,
	};
}

export function buildLegend(
	legend: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): Map<(typeof KIND_ORDER)[number], HTMLElement> {
	const counts = new Map<(typeof KIND_ORDER)[number], HTMLElement>();
	for (const kind of KIND_ORDER) {
		const button = document.createElement("button");
		button.type = "button";
		const on = read().kinds[kind];
		button.className = on ? "cpo-legend-kind is-on" : "cpo-legend-kind";
		button.setAttribute("aria-pressed", on ? "true" : "false");
		button.title = RELATION_LABEL[kind];
		const swatch = document.createElement("i");
		swatch.dataset.kind = kind;
		const n = document.createElement("span");
		n.className = "cpo-graph-key-n";
		n.textContent = "0";
		button.append(swatch, document.createTextNode(RELATION_LABEL[kind]), n);
		button.addEventListener("click", () => {
			const current = read();
			const on = !current.kinds[kind];
			button.classList.toggle("is-on", on);
			button.setAttribute("aria-pressed", on ? "true" : "false");
			write({ ...current, kinds: { ...current.kinds, [kind]: on } });
		});
		legend.append(button);
		counts.set(kind, n);
	}
	return counts;
}

function markRow(className: string, label: string): { row: HTMLSpanElement; n: HTMLSpanElement } {
	const row = document.createElement("span");
	row.className = className;
	const swatch = document.createElement("i");
	swatch.setAttribute("aria-hidden", "true");
	const n = document.createElement("span");
	n.className = "cpo-graph-key-n";
	n.textContent = "0";
	row.append(swatch, document.createTextNode(label), n);
	return { row, n };
}

/** Edge-type chips, seed/classic marks, grouping color — in the left rail. */
export function mountGraphKey(
	host: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): {
	paintColor: (mode: LayoutMode) => void;
	setStats: (nodes: readonly { id: string; year: number | null; isSeed?: boolean }[], edges: readonly GraphEdge[]) => void;
} {
	const key = document.createElement("div");
	key.className = "cpo-graph-key";
	const kinds = document.createElement("div");
	kinds.className = "cpo-graph-key-kinds";
	const kindCounts = buildLegend(kinds, read, write);
	const marks = document.createElement("div");
	marks.className = "cpo-graph-key-marks";
	const seed = markRow("cpo-graph-key-seed", "种子文献");
	const classic = markRow("cpo-graph-key-classic", "经典文献");
	marks.append(seed.row, classic.row);
	const color = document.createElement("span");
	color.className = "cpo-graph-key-color";
	const dots = document.createElement("span");
	dots.className = "cpo-graph-key-dots";
	dots.setAttribute("aria-hidden", "true");
	for (let i = 0; i < 3; i++) {
		const dot = document.createElement("i");
		dot.style.background = communityColor(i);
		dots.append(dot);
	}
	const label = document.createElement("span");
	label.textContent = "引用团";
	const groupN = document.createElement("span");
	groupN.className = "cpo-graph-key-n";
	groupN.textContent = "0";
	color.append(dots, label, groupN);
	key.append(kinds, marks, color);
	host.append(key);
	const paintColor = (mode: LayoutMode): void => {
		color.hidden = mode !== "force2d";
	};
	const setStats = (
		nodes: readonly { id: string; year: number | null; isSeed?: boolean }[],
		edges: readonly GraphEdge[],
	): void => {
		const stats = graphKeyStats(nodes, edges);
		for (const kind of KIND_ORDER) {
			const el = kindCounts.get(kind);
			if (el) el.textContent = String(stats.kinds[kind]);
		}
		seed.n.textContent = String(stats.seeds);
		classic.n.textContent = String(stats.classics);
		groupN.textContent = String(stats.groups);
	};
	return { paintColor, setStats };
}
