import { tr } from "./i18n";
import type { PaperRecord } from "./types";

/** Shared color stops for the canvas year ramp and the HTML legend. */
const YEAR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
	[90, 102, 204],
	[167, 130, 218],
	[204, 164, 63],
];

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function yearColor(year: number | null, minYear: number, maxYear: number): string {
	const mid = YEAR_STOPS[1] ?? [167, 130, 218];
	if (year === null || maxYear <= minYear) return rgb(mid);
	const t = clamp((year - minYear) / (maxYear - minYear), 0, 1);
	return rgb(sampleStops(t));
}

/** Citations per year of age (VOSviewer-style; no field baseline in this graph). */
export function yearNormalizedCitations(citedByCount: number, year: number | null, nowYear = new Date().getFullYear()): number {
	const age = year === null ? 1 : Math.max(1, nowYear - year);
	return Math.max(0, citedByCount) / age;
}

/** Bounded log compression of cumulative citations; radius is not proportional area. */
const RADIUS_MIN = 4;
const RADIUS_MAX = 14;

export function citationRadius(citedByCount: number, minCited: number, maxCited: number, isSeed: boolean): number {
	const lo = Math.log1p(Math.max(0, minCited));
	const hi = Math.log1p(Math.max(maxCited, minCited, 0));
	const t = hi === 0 ? 0 : hi - lo < 1e-9 ? 0.5 : clamp((Math.log1p(Math.max(0, citedByCount)) - lo) / (hi - lo), 0, 1);
	const radius = RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
	return isSeed ? Math.max(radius, RADIUS_MIN + 0.7 * (RADIUS_MAX - RADIUS_MIN)) : radius;
}

/** 0–1 sine; phase hashed by id. Period matches pure-self-color glow (3.5s). */
export const CLASSIC_BREATH_MS = 3500;
export function classicBreath(id: string, now = performance.now()): number {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
	hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
	hash ^= hash >>> 16;
	const phase = ((hash >>> 0) / 4294967296) * Math.PI * 2;
	return 0.5 + 0.5 * Math.sin((now / CLASSIC_BREATH_MS) * Math.PI * 2 + phase);
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat("zh-CN").format(value);
}

/** Shared by wheel zoom, pinch, fit, and restoring a saved view. */
export const GRAPH_ZOOM_MIN = 0.02;
export const GRAPH_ZOOM_MAX = 32;

/** Scale that maps content bounds into the view with a short margin. */
export function fitViewScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
	const pad = Math.max(16, Math.min(viewW, viewH) * 0.08);
	const innerW = Math.max(1, viewW - pad * 2);
	const innerH = Math.max(1, viewH - pad * 2);
	return clamp(Math.min(innerW / Math.max(1, contentW), innerH / Math.max(1, contentH)), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
}

export function snippet(text: string, max = 480): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	const base = lastSpace > 240 ? cut.slice(0, lastSpace) : cut;
	return `${base.trim()}…`;
}

function sampleStops(t: number): [number, number, number] {
	const left = YEAR_STOPS[0] ?? [106, 120, 240];
	const mid = YEAR_STOPS[1] ?? [167, 130, 218];
	const right = YEAR_STOPS[2] ?? [240, 193, 74];
	if (t < 0.5) return lerp(left, mid, t / 0.5);
	return lerp(mid, right, (t - 0.5) / 0.5);
}

function lerp(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

function rgb(channels: readonly [number, number, number]): string {
	return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/** Legacy zero cannot establish whether the source actually supplied a count. */
export function availableCitations(paper: Pick<PaperRecord, "citedByCount" | "citationCountStatus">): number | null {
	const count = paper.citedByCount;
	return paper.citationCountStatus !== "missing" && Number.isSafeInteger(count) && count >= 0 && (count > 0 || paper.citationCountStatus === "known") ? count : null;
}

export function citationCountText(paper: Pick<PaperRecord, "citedByCount" | "citationCountStatus">): string {
	const count = availableCitations(paper);
	return count !== null ? formatCount(count) : paper.citationCountStatus === undefined && paper.citedByCount === 0 ? tr("未知（历史零或缺失）", "Unknown (legacy zero or missing)") : tr("未知", "Unknown");
}

export function citationRadii(nodes: readonly PaperRecord[]): number[] {
	const counts = nodes.map(availableCitations);
	const ordinary = counts.filter((count, i): count is number => count !== null && !nodes[i]!.isSeed);
	const min = ordinary.length ? Math.min(...ordinary) : 0;
	const max = ordinary.length ? Math.max(...ordinary) : 0;
	return nodes.map((node, i) => counts[i] === null ? node.isSeed ? 11 : 4 : citationRadius(counts[i]!, min, max, node.isSeed));
}
