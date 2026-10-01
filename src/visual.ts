/** Shared color stops for the canvas year ramp and the HTML legend. */
const YEAR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
	[106, 120, 240],
	[62, 207, 178],
	[240, 193, 74],
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

export function citationRadius(citedByCount: number, maxCited: number, isSeed: boolean): number {
	const maxLog = Math.log10(maxCited + 1) || 1;
	const t = Math.log10(Math.max(0, citedByCount) + 1) / maxLog;
	const radius = 7 + clamp(t, 0, 1) * 15;
	return isSeed ? Math.max(radius, 13) : radius;
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat("zh-CN").format(value);
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
