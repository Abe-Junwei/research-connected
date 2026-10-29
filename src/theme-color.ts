export interface Rgb {
	r: number;
	g: number;
	b: number;
}

const cache = new Map<string, Rgb>();

export function clearThemeColorCache(): void {
	cache.clear();
}

export function rgba({ r, g, b }: Rgb, alpha: number): string {
	return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Browser-resolved channels. rgb()/hex skip the probe; hsl and color-mix do not. */
export function channelsFromCss(value: string, fallback: Rgb): Rgb {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	const hit = cache.get(trimmed);
	if (hit) return hit;
	const resolved = resolveChannels(trimmed, fallback);
	if (resolved !== fallback) cache.set(trimmed, resolved);
	return resolved;
}

function resolveChannels(trimmed: string, fallback: Rgb): Rgb {
	const literal = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
	if (literal) return { r: Number(literal[1]), g: Number(literal[2]), b: Number(literal[3]) };
	const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = Number.parseInt(hex[1] ?? "", 16);
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
	}
	if (typeof document === "undefined") return fallback;
	try {
		if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", trimmed)) return fallback;
	} catch {
		return fallback;
	}
	const probe = createSpan();
	probe.style.color = trimmed;
	document.documentElement.append(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();
	if (!computed) return fallback;
	const parsed = computed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
	if (parsed) return { r: Number(parsed[1]), g: Number(parsed[2]), b: Number(parsed[3]) };
	// Modern computed colors can remain OKLCH; rasterization resolves their sRGB channels.
	const canvas = createEl("canvas");
	canvas.width = canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return fallback;
	context.fillStyle = computed;
	context.fillRect(0, 0, 1, 1);
	const pixel = context.getImageData(0, 0, 1, 1).data;
	return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]! };
}
