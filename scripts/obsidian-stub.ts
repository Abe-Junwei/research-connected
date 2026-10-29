import {
	createElement, LayoutGrid, Clock, Network, Play, Pause, Pencil, Trash2,
	Save, Folder, Layers, RotateCw, Maximize, Search, ExternalLink,
	Bookmark, BookmarkCheck, BookOpen, CircleMinus, Copy, Table, FileText,
	Download, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus, Minus, ListFilter, Sun, Moon, Star,
} from "lucide";

const previewIcons = {
	LayoutGrid, Clock, Network, Play, Pause, Pencil, Trash2, Save, Folder,
	Layers, RotateCw, Maximize, Search, ExternalLink, Bookmark, BookmarkCheck,
	BookOpen, CircleMinus, Copy, Table, FileText, Download, ChevronDown, ChevronUp,
	ChevronRight, ChevronLeft, Plus, Minus, ListFilter, Sun, Moon, Star,
};

export function getIcon(name: string): SVGSVGElement | null {
	const key = name.replace(/(^|-)(\w)/g, (_, _separator: string, letter: string) => letter.toUpperCase());
	const icon = previewIcons[key as keyof typeof previewIcons];
	return icon ? createElement(icon, { class: `lucide lucide-${name}` }) as SVGSVGElement : null;
}

export class TFile {}

export function getLanguage(): string {
	return typeof document !== "undefined" ? document.documentElement.lang || "en" : "zh-CN";
}

export const moment = { locale: getLanguage };

// Implement host helpers only for the standalone browser preview.
if (typeof document !== "undefined") {
	for (const placeholder of Array.from(document.querySelectorAll<HTMLElement>("[data-lucide]"))) {
		const icon = getIcon(placeholder.dataset.lucide!);
		if (icon) {
			icon.classList.add(...Array.from(placeholder.classList));
			icon.setAttribute("aria-hidden", "true");
			placeholder.replaceWith(icon);
		}
	}
	Object.assign(window, {
		createSvg: (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag),
		createDiv: () => document.createElement("div"),
		createSpan: () => document.createElement("span"),
		createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
			return document.createElement(tag);
		},
	});
}
