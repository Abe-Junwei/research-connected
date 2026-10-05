export const NARROW_SURFACE_WIDTH = 780;
/** Note column is often 600–750px; keep embed side-by-side until it cannot fit rail + graph + sidebar. */
export const NARROW_EMBED_WIDTH = 560;

export function narrowThreshold(root: HTMLElement): number {
	return root.classList.contains("cpo-embed") ? NARROW_EMBED_WIDTH : NARROW_SURFACE_WIDTH;
}

/** Keep pane and embed responsive state on the same width contract. */
export function applyResponsiveMode(root: HTMLElement, width = root.clientWidth): boolean {
	const narrow = width < narrowThreshold(root);
	root.classList.toggle("is-narrow", narrow);
	root.dataset.surfaceSize = narrow ? "narrow" : "wide";
	return narrow;
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
