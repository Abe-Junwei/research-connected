import type { ConnectedPapersSettings } from "../src/settings-model";
export * from "../src/source-revalidation";

export function commitWebRevalidation(key: string, settings: ConnectedPapersSettings): void {
	const previous = window.localStorage.getItem(key);
	if (previous !== null) window.localStorage.setItem(`${key}-before-source-review`, previous);
	writeWebSettings(key, settings);
}

export function writeWebSettings(key: string, settings: ConnectedPapersSettings): void {
	window.localStorage.setItem(key, JSON.stringify(settings));
}
