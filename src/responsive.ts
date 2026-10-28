export const NARROW_SURFACE_WIDTH = 780;
export const WIDE_SURFACE_WIDTH = 1200;
/** Note column is often 600–750px; keep embed side-by-side until it cannot fit rail + graph + sidebar. */
export const NARROW_EMBED_WIDTH = 560;
export const MEDIUM_EMBED_WIDTH = 780;

export type SurfaceBand = "wide" | "medium" | "narrow";

export function surfaceBand(width: number, embed: boolean): SurfaceBand {
	if (embed) {
		if (width < NARROW_EMBED_WIDTH) return "narrow";
		if (width < MEDIUM_EMBED_WIDTH) return "medium";
		return "wide";
	}
	if (width < NARROW_SURFACE_WIDTH) return "narrow";
	if (width < WIDE_SURFACE_WIDTH) return "medium";
	return "wide";
}

export function narrowThreshold(root: HTMLElement): number {
	return root.classList.contains("cpo-embed") ? NARROW_EMBED_WIDTH : NARROW_SURFACE_WIDTH;
}

/** Keep pane and embed responsive state on the same width contract. */
export function applyResponsiveMode(root: HTMLElement, width = root.clientWidth): boolean {
	const band = surfaceBand(width, root.classList.contains("cpo-embed"));
	root.classList.toggle("is-narrow", band === "narrow");
	root.classList.toggle("is-medium", band === "medium");
	root.dataset.surfaceSize = band;
	return band === "narrow";
}

export function observeResponsiveMode(root: HTMLElement, onResize?: () => void): ResizeObserver {
	const apply = (): void => {
		applyResponsiveMode(root);
		onResize?.();
	};
	const observer = new ResizeObserver(apply);
	observer.observe(root);
	apply();
	return observer;
}
