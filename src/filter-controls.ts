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
	const classic = markRow("cpo-graph-key-classic", tr("经典文献", "Seminal papers"));
	classic.row.title = tr("经典候选：成熟文献的本地引用支持或累计引用影响；不是经典认证。", "Classic candidates: mature works with local citation support or cumulative citation impact; not a certification.");
	const ordinary = markRow("cpo-graph-key-star", tr("普通文献", "Paper"));
	ordinary.n.remove();
	const focused = markRow("cpo-graph-key-focus", tr("悬停 / 选中", "Hovered / selected"));
	focused.n.remove();
	marks.append(ordinary.row, seed.row, classic.row, focused.row);
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
	colorLabel.textContent = tr("引用团", "Citation clusters");
	const groupN = createSpan();
	groupN.className = "cpo-graph-key-n";
	groupN.textContent = "0";
	color.append(dots, colorLabel, groupN);
	const statsLine = createDiv();
	statsLine.className = "cpo-key-stats";
	statsLine.textContent = tr("0 篇", "0 papers");
	const explanation = createDiv();
	explanation.className = "cpo-key-explanation";
	for (const text of [
		tr("暗色连线：常态为银蓝轮廓；聚焦时按上方关系颜色高亮。箭头指向被引用文献。", "Dark edges: silver-blue outlines; focused edges use the relationship colors above. Arrows point to cited papers."),
		tr("尺寸：代表版本累计被引按对数缩放；种子有最小尺寸，缺失取最小值。筛选不重标度。", "Size: log-scaled cumulative citations of the display version; seed has a minimum size, missing counts use the smallest size. Filtering keeps the scale."),
		tr("经典候选：满八年，且有两篇图内文献引用，或累计被引≥1,000，或在至少十篇成熟文献中位于引用前10%且被引≥100。经验规则，无数量截断；并非经典认证。", "Classic candidates: at least eight years old, with two local citers, or 1,000 cumulative citations, or the top citation decile among at least ten mature works with at least 100 citations. Heuristic, uncapped; not a certification."),
	]) {
		const line = createDiv();
		line.textContent = text;
		if (explanation.childElementCount === 0) line.className = "cpo-key-night-note";
		explanation.append(line);
	}
	marksSection.append(marks, color, statsLine, explanation);
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
		classic.n.textContent = String(stats.classics);
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
