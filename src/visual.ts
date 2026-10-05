/** Shared color stops for the canvas year ramp and the HTML legend. */
const YEAR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
	[90, 102, 204],
	[53, 176, 152],
	[204, 164, 63],
];

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function yearColor(year: number | null, minYear: number, maxYear: number): string {
	const mid = YEAR_STOPS[1] ?? [62, 207, 178];
	if (year === null || maxYear <= minYear) return rgb(mid);
	const t = clamp((year - minYear) / (maxYear - minYear), 0, 1);
	return rgb(sampleStops(t));
}

/** Citations per year of age (VOSviewer-style; no field baseline in this graph). */
export function yearNormalizedCitations(citedByCount: number, year: number | null, nowYear = new Date().getFullYear()): number {
	const age = year === null ? 1 : Math.max(1, nowYear - year);
	return Math.max(0, citedByCount) / age;
}

/** Area ∝ year-normalized citations on this graph's min–max (D3 scaleSqrt / Gephi ranking). */
const RADIUS_MIN = 4;
const RADIUS_MAX = 14;

export function citationRadius(citedByCount: number, minCited: number, maxCited: number, isSeed: boolean): number {
	const lo = Math.sqrt(Math.max(0, minCited));
	const hi = Math.sqrt(Math.max(maxCited, minCited, 0));
	const t = hi - lo < 1e-9 ? 0.5 : clamp((Math.sqrt(Math.max(0, citedByCount)) - lo) / (hi - lo), 0, 1);
	const radius = RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
	return isSeed ? Math.max(radius, RADIUS_MIN + 0.7 * (RADIUS_MAX - RADIUS_MIN)) : radius;
}

/** 0–1 sine; phase hashed by id. Period ≈ 2.2s. */
export const CLASSIC_BREATH_MS = 350;
export function classicBreath(id: string, now = performance.now()): number {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
	const phase = ((hash >>> 0) / 4294967296) * Math.PI * 2;
	return 0.5 + 0.5 * Math.sin(now / CLASSIC_BREATH_MS + phase);
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat("zh-CN").format(value);
}

/** Scale that maps content bounds into the view with a short margin. */
export function fitViewScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
	const pad = Math.max(16, Math.min(viewW, viewH) * 0.08);
	const innerW = Math.max(1, viewW - pad * 2);
	const innerH = Math.max(1, viewH - pad * 2);
	return clamp(Math.min(innerW / Math.max(1, contentW), innerH / Math.max(1, contentH)), 0.02, 8);
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
	const mid = YEAR_STOPS[1] ?? [62, 207, 178];
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
