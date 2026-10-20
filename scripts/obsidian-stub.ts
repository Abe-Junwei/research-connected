export function getLanguage(): string {
	return typeof document !== "undefined" ? document.documentElement.lang || "en" : "zh-CN";
}

export const moment = { locale: getLanguage };

// Implement host helpers only for the standalone browser preview.
if (typeof document !== "undefined") {
	Object.assign(window, {
		createSvg: (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag),
		createDiv: () => document.createElement("div"),
		createSpan: () => document.createElement("span"),
		createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
			return document.createElement(tag);
		},
	});
}
