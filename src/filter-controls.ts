import { tr } from "./i18n";
import { classicNodeIds } from "./aggregates";
import { communityColor, detectCommunities } from "./communities";
import type { GraphFilter } from "./graph-filter";
import type { LayoutMode } from "./layout-modes";
import { RELATION_LABEL, relationKind } from "./relation";
import type { GraphEdge } from "./types";

const KIND_ORDER = ["direct", "cocitation", "coupling"] as const;

export function graphKeyStats(
	nodes: readonly { id: string; year: number | null; citedByCount?: number; isSeed?: boolean; retracted?: boolean }[],
	edges: readonly GraphEdge[],
	referenceLists?: ReadonlyMap<string, readonly string[]>,
): { kinds: Record<(typeof KIND_ORDER)[number], number>; classics: number; seeds: number; groups: number } {
	const kinds = { direct: 0, cocitation: 0, coupling: 0 };
	for (const edge of edges) {
		const kind = relationKind(edge);
		if (kind === "direct" || kind === "cocitation" || kind === "coupling") kinds[kind] += 1;
	}
	return {
		kinds,
		classics: classicNodeIds(nodes, edges, undefined, referenceLists).size,
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
		const button = createEl("button");
		button.type = "button";
		const on = read().kinds[kind];
		button.className = on ? "cpo-legend-kind is-on" : "cpo-legend-kind";
		button.setAttribute("aria-pressed", on ? "true" : "false");
		button.title = RELATION_LABEL[kind];
		const swatch = createEl("i");
		swatch.dataset.kind = kind;
		const n = createSpan();
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
	const row = createSpan();
	row.className = className;
	const swatch = createEl("i");
	swatch.setAttribute("aria-hidden", "true");
	const n = createSpan();
	n.className = "cpo-graph-key-n";
	n.textContent = "0";
	row.append(swatch, document.createTextNode(label), n);
	return { row, n };
}

export function mountGraphKey(
	host: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): {
	paintColor: (mode: LayoutMode) => void;
	setStats: (nodes: readonly { id: string; year: number | null; citedByCount?: number; isSeed?: boolean; retracted?: boolean }[], edges: readonly GraphEdge[], referenceLists?: ReadonlyMap<string, readonly string[]>) => void;
	setKinds: (selected: GraphFilter["kinds"]) => void;
} {
	const key = createDiv();
	key.className = "cpo-graph-key cpo-graph-legend";
	key.tabIndex = 0;
	key.setAttribute("role", "group");
	key.setAttribute("aria-label", tr("图例", "Legend"));
	key.title = tr("悬停或聚焦查看图例", "Hover or focus to view the legend");
	key.addEventListener("pointerleave", () => {
		const active = document.activeElement;
		if (active instanceof HTMLElement && key.contains(active) && !active.matches(":focus-visible")) active.blur();
	});
	const label = createSpan();
	label.className = "cpo-legend-label";
	label.textContent = tr("图例", "Legend");
	const content = createDiv();
	content.className = "cpo-legend-content";
	const links = createDiv();
	links.className = "cpo-key-section";
	const kinds = createDiv();
	kinds.className = "cpo-graph-key-kinds";
	const kindCounts = buildLegend(kinds, read, write);
	links.append(kinds);
	const marksSection = createDiv();
	marksSection.className = "cpo-key-section";
	const marks = createDiv();
	marks.className = "cpo-graph-key-marks";
	const seed = markRow("cpo-graph-key-seed", tr("种子文献", "Seed paper"));
	const ordinary = markRow("cpo-graph-key-star", tr("普通文献", "Paper"));
	ordinary.n.remove();
	const focused = markRow("cpo-graph-key-focus", tr("悬停 / 选中", "Hovered / selected"));
	focused.n.remove();
	marks.append(ordinary.row, seed.row, focused.row);
	const color = createSpan();
	color.className = "cpo-graph-key-color";
	const dots = createSpan();
	dots.className = "cpo-graph-key-dots";
	dots.setAttribute("aria-hidden", "true");
	for (let i = 0; i < 3; i++) {
		const dot = createEl("i");
		dot.style.background = i === 0 ? `var(--cpo-community-primary, ${communityColor(i)})` : communityColor(i);
		dots.append(dot);
	}
	const colorLabel = createSpan();
	colorLabel.textContent = tr("引文群组", "Citation clusters");
	const groupN = createSpan();
	groupN.className = "cpo-graph-key-n";
	groupN.textContent = "0";
	color.append(dots, colorLabel, groupN);
	const statsLine = createDiv();
	statsLine.className = "cpo-key-stats";
	statsLine.textContent = tr("0 篇", "0 papers");
	marksSection.append(marks, color, statsLine);
	content.append(links, marksSection);
	key.append(label, content);
	host.append(key);
	const paintColor = (mode: LayoutMode): void => {
		color.hidden = mode !== "force2d";
	};
	const setStats = (
		nodes: readonly { id: string; year: number | null; citedByCount?: number; isSeed?: boolean; retracted?: boolean }[],
		edges: readonly GraphEdge[],
		referenceLists?: ReadonlyMap<string, readonly string[]>,
	): void => {
		const stats = graphKeyStats(nodes, edges, referenceLists);
		statsLine.textContent = tr(`${nodes.length} 篇`, `${nodes.length} papers`);
		for (const kind of KIND_ORDER) {
			const el = kindCounts.get(kind);
			if (el) el.textContent = String(stats.kinds[kind]);
		}
		seed.n.textContent = String(stats.seeds);
		groupN.textContent = String(stats.groups);
	};
	const setKinds = (selected: GraphFilter["kinds"]): void => {
		for (const kind of KIND_ORDER) {
			const button = Array.from(kinds.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.title === RELATION_LABEL[kind]);
			if (!button) continue;
			button.classList.toggle("is-on", selected[kind]);
			button.setAttribute("aria-pressed", String(selected[kind]));
		}
	};
	return { paintColor, setStats, setKinds };
}
