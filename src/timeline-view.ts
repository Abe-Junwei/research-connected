import {
	TIMELINE_CONFLICT_LABEL,
	TIMELINE_EMPTY_TEXT,
	TIMELINE_MUTUAL_LABEL,
	TIMELINE_MISSING_LABEL,
	TIMELINE_UNKNOWN_YEAR,
	timelineOverflowNote,
	type CitationTimeline,
	type TimelineNode,
} from "./citation-timeline";

const ns = "http://www.w3.org/2000/svg";
const ZONE_COLOR = { prior: "#6f7ee0", seed: "#d4a24a", derivative: "#2bb39a" } as const;

/** 每区最多画的点数（有年份部分），超出聚合为一行说明。 */
export const ZONE_LIMIT = 40;
/** 年份未知条最多列出的行数。 */
export const UNKNOWN_LIMIT = 10;
/** viewBox 最小宽度，窄容器转入横向滚动而不是缩小文字。 */
export const TIMELINE_MIN_WIDTH = 520;

const GUTTER = 96;
const ROW = 20;
const TOP = 34;

export interface TimelinePoint {
	node: TimelineNode;
	x: number;
	y: number;
}

export interface TimelineLayout {
	width: number;
	height: number;
	/** 没有任何有年份节点时为 null。 */
	axisY: number | null;
	zoneY: { prior: number; seed: number; derivative: number; unknown: number | null };
	seedAt: { x: number; y: number } | null;
	points: TimelinePoint[];
	unknownRows: TimelinePoint[];
	notes: Array<{ text: string; x: number; y: number }>;
	ticks: Array<{ year: number; x: number; y: number }>;
}

/** 纯布局：坐标、上限聚合、年份未知条都在这里算好，方便离线断言。 */
export function layoutTimeline(timeline: CitationTimeline, width: number): TimelineLayout {
	const w = Math.max(TIMELINE_MIN_WIDTH, Math.round(width));
	const seed = timeline.seed;
	const notes: TimelineLayout["notes"] = [];
	if (!seed) {
		return { width: w, height: 80, axisY: null, zoneY: { prior: TOP, seed: TOP, derivative: TOP, unknown: null }, seedAt: null, points: [], unknownRows: [], notes, ticks: [] };
	}

	const priorCap = capZone(timeline.prior);
	const derivativeCap = capZone(timeline.derivative);
	const priorDated = sortByYear(priorCap.shown.filter((node) => node.year !== null));
	const derivativeDated = sortByYear(derivativeCap.shown.filter((node) => node.year !== null));
	const unknownAll = [...priorCap.shown, ...derivativeCap.shown]
		.filter((node) => node.year === null)
		.sort(byCited);
	const unknownShown = unknownAll.slice(0, UNKNOWN_LIMIT);
	const unknownHidden = unknownAll.length - unknownShown.length;

	const datedYears = [...priorDated, ...derivativeDated, ...(seed.year === null ? [] : [seed as TimelineNode])].map(
		(node) => node.year ?? 0,
	);
	const hasAxis = datedYears.length > 0;
	const minYear = hasAxis ? Math.min(...datedYears) : 0;
	const maxYear = hasAxis ? Math.max(...datedYears) : 0;
	const span = Math.max(1, maxYear - minYear);
	const xOf = (year: number): number => GUTTER + 8 + ((year - minYear) / span) * (w - GUTTER - 48);

	const priorY = TOP;
	let cursor = priorY + rowCount(priorDated) * ROW;
	if (priorCap.hidden > 0) {
		notes.push({ text: timelineOverflowNote(priorCap.hidden), x: GUTTER + 8, y: cursor + 14 });
		cursor += ROW;
	}
	const seedY = cursor + 28;
	const derivativeY = seedY + 30;
	cursor = derivativeY + rowCount(derivativeDated) * ROW;
	if (derivativeCap.hidden > 0) {
		notes.push({ text: timelineOverflowNote(derivativeCap.hidden), x: GUTTER + 8, y: cursor + 14 });
		cursor += ROW;
	}
	const axisY = hasAxis ? cursor + 18 : null;

	const points: TimelinePoint[] = [];
	const placeBand = (nodes: TimelineNode[], y0: number): void => {
		const bucket = new Map<number, number>();
		for (const node of nodes) {
			const year = node.year ?? minYear;
			const row = bucket.get(year) ?? 0;
			bucket.set(year, row + 1);
			points.push({ node, x: xOf(year), y: y0 + row * ROW });
		}
	};
	placeBand(priorDated, priorY);
	placeBand(derivativeDated, derivativeY);
	const seedAt = { x: seed.year === null ? w / 2 : xOf(seed.year), y: seedY };

	const ticks: TimelineLayout["ticks"] = [];
	if (axisY !== null) {
		for (const year of new Set([minYear, Math.round((minYear + maxYear) / 2), maxYear])) {
			ticks.push({ year, x: xOf(year), y: axisY + 14 });
		}
	}

	const unknownRows: TimelinePoint[] = [];
	let unknownY: number | null = null;
	if (unknownShown.length > 0 || unknownHidden > 0) {
		const unknownStartY = (axisY ?? cursor) + 24;
		unknownY = unknownStartY;
		unknownShown.forEach((node, index) => {
			unknownRows.push({ node, x: GUTTER + 8, y: unknownStartY + 14 + index * ROW });
		});
		let endY = unknownStartY + 14 + unknownShown.length * ROW;
		if (unknownHidden > 0) {
			notes.push({ text: timelineOverflowNote(unknownHidden), x: GUTTER + 8, y: endY + 4 });
			endY += ROW;
		}
		return {
			width: w,
			height: endY + 12,
			axisY,
			zoneY: { prior: priorY, seed: seedY, derivative: derivativeY, unknown: unknownY },
			seedAt,
			points,
			unknownRows,
			notes,
			ticks,
		};
	}

	return {
		width: w,
		height: (axisY ?? cursor) + 26,
		axisY,
		zoneY: { prior: priorY, seed: seedY, derivative: derivativeY, unknown: unknownY },
		seedAt,
		points,
		unknownRows,
		notes,
		ticks,
	};
}

/**
 * 引用脉络原型：默认只画圆点、年份轴和分区标签；悬停在点旁浮出标题并
 * 高亮与种子的连线，点击在下方 selection 区出详情。宽度跟随容器，不足
 * TIMELINE_MIN_WIDTH 时由外层横向滚动。
 */
export function drawTimeline(
	svg: SVGSVGElement,
	timeline: CitationTimeline,
	options: { width: number; onPick: (node: TimelineNode) => void },
): void {
	svg.replaceChildren();
	svg.classList.add("cpo-timeline-svg");
	if (!timeline.seed || timeline.empty) {
		svg.setAttribute("viewBox", "0 0 520 100");
		text(svg, 30, 56, TIMELINE_EMPTY_TEXT);
		return;
	}
	const layout = layoutTimeline(timeline, options.width);
	svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
	svg.style.width = `${layout.width}px`;

	const defs = document.createElementNS(ns, "defs");
	const marker = document.createElementNS(ns, "marker");
	marker.setAttribute("id", "cpo-timeline-arrow");
	marker.setAttribute("viewBox", "0 0 8 8");
	marker.setAttribute("refX", "7");
	marker.setAttribute("refY", "4");
	marker.setAttribute("markerWidth", "7");
	marker.setAttribute("markerHeight", "7");
	marker.setAttribute("orient", "auto-start-reverse");
	const tipShape = document.createElementNS(ns, "path");
	tipShape.setAttribute("d", "M0,0 L8,4 L0,8 Z");
	tipShape.setAttribute("fill", "#b99850");
	marker.append(tipShape);
	defs.append(marker);
	svg.append(defs);

	text(svg, 8, layout.zoneY.prior + 5, "种子的参考文献", "start", true);
	text(svg, 8, layout.zoneY.seed + 4, "种子", "start", true);
	text(svg, 8, layout.zoneY.derivative + 5, "引用了种子", "start", true);
	if (layout.zoneY.unknown !== null) text(svg, 8, layout.zoneY.unknown + 10, TIMELINE_UNKNOWN_YEAR, "start", true);
	for (const note of layout.notes) {
		const noteEl = text(svg, note.x, note.y, note.text, "start", true);
		noteEl.setAttribute("font-size", "11");
	}

	if (layout.axisY !== null) {
		const axis = document.createElementNS(ns, "line");
		axis.setAttribute("x1", String(GUTTER));
		axis.setAttribute("x2", String(layout.width - 24));
		axis.setAttribute("y1", String(layout.axisY));
		axis.setAttribute("y2", String(layout.axisY));
		axis.setAttribute("stroke", "currentColor");
		axis.setAttribute("stroke-opacity", "0.35");
		svg.append(axis);
		for (const tick of layout.ticks) {
			const tickEl = text(svg, tick.x, tick.y, String(tick.year), "middle", true);
			tickEl.setAttribute("font-size", "11");
		}
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const point of layout.points) positions.set(point.node.id, point);
	for (const row of layout.unknownRows) positions.set(row.node.id, row);
	if (layout.seedAt) positions.set(timeline.seed.id, layout.seedAt);

	// 与种子的连线默认极淡；悬停/选中某节点时只剩它的连线高亮。
	const linkEls: Array<{ el: SVGPathElement; other: string }> = [];
	const seenPairs = new Map<string, { a: string; b: string; aCitesB: boolean; bCitesA: boolean }>();
	for (const link of timeline.links) {
		const key = [link.citingId, link.citedId].sort().join("\0");
		const pair = seenPairs.get(key) ?? {
			a: link.citingId,
			b: link.citedId,
			aCitesB: false,
			bCitesA: false,
		};
		if (link.citingId === pair.a) pair.aCitesB = true;
		else pair.bCitesA = true;
		seenPairs.set(key, pair);
	}
	for (const pair of seenPairs.values()) {
		const from = positions.get(pair.a);
		const to = positions.get(pair.b);
		if (!from || !to) continue;
		const el = document.createElementNS(ns, "path");
		const lift = from.y < to.y ? -14 : 14;
		el.setAttribute("d", `M${from.x},${from.y} C${from.x},${from.y + lift} ${to.x},${to.y + lift} ${to.x},${to.y}`);
		el.setAttribute("fill", "none");
		el.setAttribute("stroke", "#b99850");
		el.setAttribute("stroke-opacity", "0.14");
		if (pair.aCitesB) el.setAttribute("marker-end", "url(#cpo-timeline-arrow)");
		if (pair.bCitesA) el.setAttribute("marker-start", "url(#cpo-timeline-arrow)");
		svg.append(el);
		linkEls.push({ el, other: pair.a === timeline.seed.id ? pair.b : pair.a });
	}

	const hoverLabel = text(svg, 0, 0, "", "start");
	hoverLabel.setAttribute("font-size", "12");
	hoverLabel.setAttribute("visibility", "hidden");
	const hoverBackdrop = document.createElementNS(ns, "rect");
	hoverBackdrop.setAttribute("fill", "var(--background-primary, #ffffff)");
	hoverBackdrop.setAttribute("rx", "3");
	hoverBackdrop.setAttribute("visibility", "hidden");

	const pointEls = new Map<string, SVGGElement>();
	let hoverId: string | null = null;
	let selectedId: string | null = null;

	const apply = (): void => {
		const id = hoverId ?? selectedId;
		for (const { el, other } of linkEls) {
			el.setAttribute("stroke-opacity", id === null ? "0.14" : other === id ? "0.9" : "0.04");
		}
		for (const [pid, group] of pointEls) {
			group.setAttribute("opacity", id === null || pid === id || pid === timeline.seed?.id ? "1" : "0.35");
		}
		const activeNode = id
			? [...layout.points, ...layout.unknownRows].find((point) => point.node.id === id)?.node ?? null
			: null;
		const at = id ? positions.get(id) : undefined;
		if (!activeNode || !at) {
			hoverLabel.setAttribute("visibility", "hidden");
			hoverBackdrop.setAttribute("visibility", "hidden");
			return;
		}
		const name = activeNode.missing
			? `${activeNode.id}（${TIMELINE_MISSING_LABEL}）`
			: truncate(activeNode.title, 40);
		const marks = `${activeNode.mutual ? `（${TIMELINE_MUTUAL_LABEL}）` : ""}${activeNode.conflict ? `（${TIMELINE_CONFLICT_LABEL}）` : ""}`;
		hoverLabel.textContent = `${name}${marks} · ${activeNode.year ?? TIMELINE_UNKNOWN_YEAR}`;
		const flip = at.x > layout.width - 200;
		hoverLabel.setAttribute("x", String(flip ? at.x - 10 : at.x + 10));
		hoverLabel.setAttribute("y", String(at.y - 10));
		hoverLabel.setAttribute("text-anchor", flip ? "end" : "start");
		hoverLabel.setAttribute("visibility", "visible");
		hoverBackdrop.setAttribute("visibility", "hidden");
	};

	const drawPoint = (point: TimelinePoint, radius: number, color: string, label?: string): void => {
		const group = document.createElementNS(ns, "g");
		group.style.cursor = "pointer";
		const circle = document.createElementNS(ns, "circle");
		circle.setAttribute("cx", String(point.x));
		circle.setAttribute("cy", String(point.y));
		circle.setAttribute("r", String(radius));
		circle.setAttribute("fill", color);
		group.append(circle);
		const caption = document.createElementNS(ns, "title");
		caption.textContent = `${point.node.title || point.node.id} · ${point.node.year ?? TIMELINE_UNKNOWN_YEAR}`;
		group.append(caption);
		if (label) {
			const labelEl = text(group, point.x + 12, point.y + 4, label, "start");
			labelEl.setAttribute("font-size", "12");
		}
		group.addEventListener("pointerenter", () => {
			hoverId = point.node.id;
			apply();
		});
		group.addEventListener("pointerleave", () => {
			if (hoverId === point.node.id) hoverId = null;
			apply();
		});
		group.addEventListener("click", () => {
			selectedId = point.node.id;
			apply();
			options.onPick(point.node);
		});
		svg.append(group);
		pointEls.set(point.node.id, group);
	};

	for (const point of layout.points) drawPoint(point, 4.5, ZONE_COLOR[point.node.zone]);
	for (const row of layout.unknownRows) {
		drawPoint(row, 4.5, ZONE_COLOR[row.node.zone]);
		const name = row.node.missing
			? `${row.node.id}（${TIMELINE_MISSING_LABEL}）`
			: truncate(row.node.title, 36);
		const marks = `${row.node.mutual ? `（${TIMELINE_MUTUAL_LABEL}）` : ""}${row.node.conflict ? `（${TIMELINE_CONFLICT_LABEL}）` : ""}`;
		const rowLabel = text(svg, row.x + 10, row.y + 4, `${name}${marks}`, "start");
		rowLabel.setAttribute("font-size", "11");
	}
	if (layout.seedAt) {
		drawPoint(
			{ node: timeline.seed, x: layout.seedAt.x, y: layout.seedAt.y },
			7,
			ZONE_COLOR.seed,
			truncate(timeline.seed.title, 24),
		);
		const ring = document.createElementNS(ns, "circle");
		ring.setAttribute("cx", String(layout.seedAt.x));
		ring.setAttribute("cy", String(layout.seedAt.y));
		ring.setAttribute("r", "11");
		ring.setAttribute("fill", "none");
		ring.setAttribute("stroke", ZONE_COLOR.seed);
		ring.setAttribute("stroke-opacity", "0.6");
		svg.append(ring);
	}
	// 悬停标签最后画，压在点上。
	svg.append(hoverBackdrop, hoverLabel);
	apply();
}

function capZone(nodes: TimelineNode[]): { shown: TimelineNode[]; hidden: number } {
	if (nodes.length <= ZONE_LIMIT) return { shown: nodes, hidden: 0 };
	const shown = [...nodes].sort(byCited).slice(0, ZONE_LIMIT);
	return { shown, hidden: nodes.length - shown.length };
}

function byCited(a: TimelineNode, b: TimelineNode): number {
	return b.citedByCount - a.citedByCount || a.id.localeCompare(b.id);
}

function sortByYear(nodes: TimelineNode[]): TimelineNode[] {
	return [...nodes].sort(
		(a, b) => (a.year ?? 0) - (b.year ?? 0) || b.citedByCount - a.citedByCount || a.id.localeCompare(b.id),
	);
}

function rowCount(nodes: TimelineNode[]): number {
	if (nodes.length === 0) return 0;
	const bucket = new Map<number, number>();
	for (const node of nodes) bucket.set(node.year ?? 0, (bucket.get(node.year ?? 0) ?? 0) + 1);
	return Math.max(...bucket.values());
}

function text(
	host: SVGSVGElement | SVGGElement,
	x: number,
	y: number,
	content: string,
	anchor: "start" | "middle" = "start",
	muted = false,
): SVGTextElement {
	const node = document.createElementNS(ns, "text");
	node.setAttribute("x", String(x));
	node.setAttribute("y", String(y));
	node.setAttribute("text-anchor", anchor);
	node.setAttribute("fill", "currentColor");
	node.setAttribute("font-size", "12");
	if (muted) node.setAttribute("opacity", "0.65");
	node.textContent = content;
	host.append(node);
	return node;
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
