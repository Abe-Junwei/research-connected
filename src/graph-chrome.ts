import { evidenceBadges, paperStateBadges, type CitationEvidence, type CrossCheckLike, type EvidenceBadge, type PaperStateLike } from "./citation-evidence";
import { LAYOUT_HINT, LAYOUT_LABEL, type LayoutMode } from "./layout-modes";
export type ExportKind = "bibtex" | "yaml" | "table" | "note";
export type GraphTab = "graph" | "prior" | "derivative" | "research" | "staged";

export function createChromeIcon(name: "grid" | "clock" | "radial" | "play" | "pause" | "edit" | "save" | "project" | "views" | "refresh" | "diagnose" | "external"): SVGSVGElement {
	const paths: Record<typeof name, string[]> = {
		grid: ["M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z"],
		clock: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "M10 5v5l3.2 2"],
		radial: ["M10 10 4 4M10 10l7-1M10 10l-3 7", "M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M2.5 2.5h3v3h-3zM15 7h3v3h-3zM5.5 15h3v3h-3z"],
		play: ["m7 4 9 6-9 6z"],
		pause: ["M6.5 4.5v11M13.5 4.5v11"],
		edit: ["m4 13.5-.8 3.3 3.3-.8L16 6.5 13.5 4z", "m11.8 5.7 2.5 2.5"],
		save: ["M4 3.5h10l2 2V16.5H4z", "M7 3.5v4h6v-4M7 16.5v-5h6v5"],
		project: ["M2.5 5.5h6l1.5 1.7h7.5v8.3h-15z", "M2.5 5.5V4h6l1.5 1.5"],
		views: ["m10 3 7 3.5-7 3.5-7-3.5z", "m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5"],
		refresh: ["M16 7V3.5l-2 2A6.5 6.5 0 1 0 16.5 12", "M16 3.5v4h-4"],
		diagnose: ["M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z", "m12.2 12.2 4.3 4.3"],
		external: ["M11 4h5v5", "m16 4-7 7", "M14 11v5H4V6h5"],
	};
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 20 20");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("cpo-icon-glyph");
	for (const d of paths[name]) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

/** Shared badge row; empty input paints nothing. */
export function paintBadges(host: HTMLElement, badges: readonly EvidenceBadge[]): void {
	if (badges.length === 0) return;
	const row = document.createElement("span");
	row.className = "cpo-badges";
	for (const badge of badges) {
		const item = document.createElement("span");
		item.className = `cpo-badge cpo-badge-${badge.tone}`;
		item.textContent = badge.label;
		row.append(item);
	}
	host.append(row);
}

/** Source-confidence badges for a citation record; 数据缺失 when there is none. */
export function paintEvidenceBadges(host: HTMLElement, evidence: CitationEvidence | null): void {
	paintBadges(host, evidenceBadges(evidence));
}

/** Node-level state badges (撤稿 / 非研究记录 / 数据源差异 / S2 回填); nothing painted when clean. */
export function paintPaperStateBadges(host: HTMLElement, paper: PaperStateLike, check: CrossCheckLike | null | undefined): void {
	paintBadges(host, paperStateBadges(paper, check));
}

export interface GraphChromeOptions {
	layouts: readonly LayoutMode[];
	layout: LayoutMode;
	noteButton: boolean;
	onExport: (kind: ExportKind) => void;
	onLayout: (mode: LayoutMode) => void;
	onScrub: (year: number | null) => void;
	onTab: (tab: GraphTab) => void;
	researchButton?: boolean;
	stagingButton?: boolean;
	/** Tabs and export actions. When set, they leave the control host. */
	actionsHost?: HTMLElement;
	/** Layout buttons. When set, they leave the control host for the narrow rail. */
	layoutHost?: HTMLElement;
	/** Year scrubber / play. Hidden unless layout is temporal. */
	scrubHost?: HTMLElement;
}

export interface GraphChrome {
	setLayout(mode: LayoutMode): void;
	setResearchVisible(visible: boolean): void;
	setYears(min: number, max: number): void;
	/** 新图没有任何年份时收起滑块行，避免旧范围把节点全部过滤掉。 */
	clearYears(): void;
	/** 同步页签按钮高亮（不触发 onTab，由调用方自己渲染）。 */
	setTab(tab: GraphTab): void;
	setExportText(text: string): void;
	destroy(): void;
}

export interface BottomSheet {
	body: HTMLElement;
	setSummary(title: string, meta: string, tags?: { lang?: string | null }): void;
	setExpanded(open: boolean): void;
	destroy(): void;
}

/** Layout, color, year scrubber, list tabs, and export actions. Shared by the embed and the pane. */
export function mountGraphChrome(host: HTMLElement, options: GraphChromeOptions): GraphChrome {
	const actions = options.actionsHost && options.actionsHost !== host ? options.actionsHost : host;
	if (actions !== host) {
		actions.classList.add("cpo-tools", "cpo-actions");
		actions.replaceChildren();
	}
	const layoutHost = options.layoutHost && options.layoutHost !== host ? options.layoutHost : null;
	const scrubHost = options.scrubHost && options.scrubHost !== host ? options.scrubHost : null;
	if (layoutHost) layoutHost.classList.add("cpo-rail-layouts");
	if (!layoutHost && !scrubHost) {
		host.classList.add("cpo-tools");
		if (actions === host) host.replaceChildren();
	}

	const layoutRow = document.createElement("div");
	layoutRow.className = "cpo-tool-row";
	const scrubRow = document.createElement("div");
	scrubRow.className = "cpo-tool-row cpo-scrub-row";
	const tabRow = document.createElement("div");
	tabRow.className = "cpo-tool-row cpo-tab-row";
	let layout = options.layout;
	let hasYears = false;
	const syncScrub = (): void => {
		const show = layout === "temporal" && hasYears;
		scrubRow.hidden = !show;
		if (show) return;
		stop();
		range.value = String(maxYear);
		readout.textContent = "全部年份";
		options.onScrub(null);
	};
	const readout = document.createElement("span");
	readout.className = "cpo-scrub-readout";
	readout.textContent = "全部年份";
	const output = document.createElement("pre");
	output.className = "cpo-export-text";
	output.hidden = true;
	let minYear = 1900;
	let maxYear = 2020;
	let timer = 0;

	const stop = (): void => {
		if (timer) window.clearInterval(timer);
		timer = 0;
		play.setAttribute("aria-label", "播放时间视图");
		play.title = "播放时间视图";
		play.replaceChildren(createChromeIcon("play"));
		play.setAttribute("aria-pressed", "false");
	};

	const layoutButtons = new Map<LayoutMode, HTMLButtonElement>();
	for (const mode of options.layouts) {
		const button = pressButton(LAYOUT_LABEL[mode], mode === layout, () => {
			stop();
			layout = mode;
			for (const [key, item] of layoutButtons) setPressed(item, key === mode);
			syncScrub();
			options.onLayout(mode);
		});
		button.title = LAYOUT_HINT[mode];
		button.dataset.layout = mode;
		button.setAttribute("aria-label", LAYOUT_LABEL[mode]);
		const label = document.createElement("span");
		label.className = "cpo-layout-label";
		label.textContent = LAYOUT_LABEL[mode];
		const icon = document.createElement("span");
		icon.className = "cpo-layout-icon";
		icon.setAttribute("aria-hidden", "true");
		icon.append(createChromeIcon(mode === "force2d" ? "grid" : mode === "temporal" ? "clock" : "radial"));
		button.replaceChildren(icon, label);
		layoutButtons.set(mode, button);
		layoutRow.append(button);
	}

	const range = document.createElement("input");
	range.type = "range";
	range.min = String(minYear);
	range.max = String(maxYear);
	range.step = "1";
	range.value = String(maxYear);
	range.setAttribute("aria-label", "年份播放");
	const publish = (): void => {
		const year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) {
			readout.textContent = "全部年份";
			options.onScrub(null);
			return;
		}
		readout.textContent = `截至 ${year}`;
		options.onScrub(year);
	};
	range.addEventListener("input", () => {
		stop();
		publish();
	});

	const play = pressButton("播放", false, () => {
		if (timer) {
			stop();
			return;
		}
		let year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) year = minYear;
		range.value = String(year);
		publish();
		play.setAttribute("aria-label", "暂停时间视图");
		play.title = "暂停时间视图";
		play.replaceChildren(createChromeIcon("pause"));
		play.setAttribute("aria-pressed", "true");
		timer = window.setInterval(() => {
			year += 1;
			if (year >= maxYear) {
				range.value = String(maxYear);
				stop();
				publish();
				return;
			}
			range.value = String(year);
			publish();
		}, 700);
	});

	const scrubMeta = document.createElement("div");
	scrubMeta.className = "cpo-scrub-meta";
	scrubMeta.append(readout, play);
	scrubRow.append(range, scrubMeta);

	const tabs: Array<[GraphTab, string]> = [
		["graph", "图谱"],
		["prior", "先验工作"],
		["derivative", "衍生工作"],
	];
	if (options.researchButton !== undefined) tabs.push(["research", "研究脉络"]);
	if (options.stagingButton) tabs.push(["staged", "暂存"]);
	const tabButtons = new Map<GraphTab, HTMLButtonElement>();
	for (const [tab, label] of tabs) {
		const button = pressButton(label, tab === "graph", () => {
			for (const [key, item] of tabButtons) setPressed(item, key === tab);
			options.onTab(tab);
		});
		tabButtons.set(tab, button);
		if (tab === "research") button.hidden = !options.researchButton;
		tabRow.append(button);
	}

	const exportMenu = document.createElement("details");
	exportMenu.className = "cpo-export-menu";
	const exportSummary = document.createElement("summary");
	exportSummary.textContent = "导出";
	exportMenu.append(exportSummary);
	const exportItems = document.createElement("div");
	exportItems.className = "cpo-export-items";
	for (const [label, kind] of [["BibTeX", "bibtex"], ["YAML", "yaml"], ["表格", "table"], [options.noteButton ? "写入笔记" : "笔记骨架", "note"]] as const) {
		exportItems.append(actionButton(label, () => options.onExport(kind)));
	}
	exportMenu.append(exportItems);
	tabRow.append(exportMenu);

	if (layoutHost) layoutHost.append(layoutRow);
	else host.append(layoutRow);
	(scrubHost ?? host).append(scrubRow);
	syncScrub();
	actions.append(tabRow, output);

	return {
		setLayout(mode: LayoutMode): void {
			layoutButtons.get(mode)?.click();
		},
		setResearchVisible(visible: boolean): void {
			const button = tabButtons.get("research");
			if (button) button.hidden = !visible;
			if (!visible && button?.getAttribute("aria-pressed") === "true") {
				for (const [key, item] of tabButtons) setPressed(item, key === "graph");
			}
		},
		setYears(min: number, max: number): void {
			stop();
			hasYears = true;
			minYear = min;
			maxYear = Math.max(min, max);
			range.min = String(minYear);
			range.max = String(maxYear);
			range.value = String(maxYear);
			readout.textContent = "全部年份";
			syncScrub();
		},
		clearYears(): void {
			stop();
			hasYears = false;
			readout.textContent = "全部年份";
			syncScrub();
		},
		setTab(next: GraphTab): void {
			for (const [key, item] of tabButtons) setPressed(item, key === next);
		},
		setExportText(text: string): void {
			output.hidden = false;
			output.textContent = text;
		},
		destroy(): void {
			stop();
			host.replaceChildren();
			host.classList.remove("cpo-tools");
			if (actions !== host) {
				actions.replaceChildren();
				actions.classList.remove("cpo-tools", "cpo-actions");
			}
			if (layoutHost) {
				layoutHost.replaceChildren();
				layoutHost.classList.remove("cpo-rail-layouts");
			}
			if (scrubHost) scrubHost.replaceChildren();
		},
	};
}

/** One-line paper strip. Starts collapsed; the body is about 160px when open.
   With `collapsible: false` the toggle strip is not rendered and the body is always visible. */
export function mountBottomSheet(host: HTMLElement, options?: { collapsible?: boolean }): BottomSheet {
	host.classList.add("cpo-sheet", "is-collapsed");
	host.replaceChildren();
	const body = document.createElement("div");
	body.className = "cpo-sheet-body";
	if (options?.collapsible === false) {
		host.classList.remove("is-collapsed");
		host.append(body);
		return {
			body,
			setSummary(): void {},
			setExpanded(): void {},
			destroy(): void {
				host.replaceChildren();
				host.classList.remove("cpo-sheet", "is-collapsed");
			},
		};
	}
	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = "cpo-sheet-toggle";
	toggle.setAttribute("aria-expanded", "false");
	const title = document.createElement("span");
	title.className = "cpo-sheet-title";
	title.textContent = "点选节点查看论文";
	const langTag = document.createElement("span");
	langTag.className = "cpo-tag cpo-sheet-tag";
	langTag.hidden = true;
	const meta = document.createElement("span");
	meta.className = "cpo-sheet-meta";
	const chevron = document.createElement("span");
	chevron.className = "cpo-sheet-chevron";
	chevron.textContent = "展开";
	toggle.append(title, langTag, meta, chevron);
	host.append(toggle, body);

	const setExpanded = (open: boolean): void => {
		host.classList.toggle("is-collapsed", !open);
		toggle.setAttribute("aria-expanded", open ? "true" : "false");
		chevron.textContent = open ? "收起" : "展开";
	};
	toggle.addEventListener("click", () => setExpanded(host.classList.contains("is-collapsed")));

	return {
		body,
		setSummary(nextTitle: string, nextMeta: string, tags?: { lang?: string | null }): void {
			title.textContent = nextTitle;
			meta.textContent = nextMeta;
			const lang = tags?.lang ?? null;
			langTag.hidden = !lang;
			if (lang) langTag.textContent = lang.toUpperCase();
		},
		setExpanded,
		destroy(): void {
			host.replaceChildren();
			host.classList.remove("cpo-sheet", "is-collapsed");
		},
	};
}

function pressButton(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-tool";
	button.textContent = label;
	setPressed(button, on);
	button.addEventListener("click", onClick);
	return button;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-tool";
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function setPressed(button: HTMLButtonElement, on: boolean): void {
	button.classList.toggle("is-on", on);
	button.setAttribute("aria-pressed", on ? "true" : "false");
}
