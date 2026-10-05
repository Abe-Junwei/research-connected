export const NARROW_SURFACE_WIDTH = 780;

/** Keep pane and embed responsive state on the same width contract. */
export function applyResponsiveMode(root: HTMLElement, width = root.clientWidth): boolean {
	const narrow = width < NARROW_SURFACE_WIDTH;
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
