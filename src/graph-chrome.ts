import { evidenceBadges, paperStateBadges, type CitationEvidence, type CrossCheckLike, type EvidenceBadge, type PaperStateLike } from "./citation-evidence";
import { LAYOUT_HINT, LAYOUT_LABEL, type ColorMode, type LayoutMode } from "./layout-modes";

export type { ColorMode };
export type GraphTab = "graph" | "prior" | "derivative" | "research" | "analysis" | "timeline";
export type ExportKind = "bibtex" | "yaml" | "table" | "note";

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
	color: ColorMode;
	noteButton: boolean;
	onLayout: (mode: LayoutMode) => void;
	onColor: (mode: ColorMode) => void;
	onScrub: (year: number | null) => void;
	onTab: (tab: GraphTab) => void;
	researchButton?: boolean;
	analysisButton?: boolean;
	/** 引用脉络原型页签，仅主面板开启。 */
	timelineButton?: boolean;
	onExport: (kind: ExportKind) => void;
	/** Tabs and export actions. When set, they leave the control host. */
	actionsHost?: HTMLElement;
	/** Layout buttons. When set, they leave the control host for the narrow rail. */
	layoutHost?: HTMLElement;
}

export interface GraphChrome {
	setResearchVisible(visible: boolean): void;
	setYears(min: number, max: number): void;
	setExportText(text: string): void;
	destroy(): void;
}

export interface BottomSheet {
	body: HTMLElement;
	setSummary(title: string, meta: string): void;
	setExpanded(open: boolean): void;
	destroy(): void;
}

const COLOR_LABEL: Record<ColorMode, string> = {
	graph: "单色",
	community: "社区",
	year: "年份",
};

/** Layout, color, year scrubber, list tabs, and export actions. Shared by the embed and the pane. */
export function mountGraphChrome(host: HTMLElement, options: GraphChromeOptions): GraphChrome {
	host.classList.add("cpo-tools");
	host.replaceChildren();
	const actions = options.actionsHost && options.actionsHost !== host ? options.actionsHost : host;
	if (actions !== host) {
		actions.classList.add("cpo-tools", "cpo-actions");
		actions.replaceChildren();
	}
	const layoutHost = options.layoutHost && options.layoutHost !== host ? options.layoutHost : null;
	if (layoutHost) layoutHost.classList.add("cpo-rail-layouts");

	const layoutRow = document.createElement("div");
	layoutRow.className = "cpo-tool-row";
	const colorRow = document.createElement("div");
	colorRow.className = "cpo-tool-row";
	const scrubRow = document.createElement("div");
	scrubRow.className = "cpo-tool-row";
	const tabRow = document.createElement("div");
	tabRow.className = "cpo-tool-row";
	const hint = document.createElement("p");
	hint.className = "cpo-tool-hint";
	let layout = options.layout;
	let color = options.color;
	const updateHint = (): void => {
		hint.textContent = `${LAYOUT_HINT[layout]}${color === "community" ? " 节点颜色表示算法识别的相似性社区，不等同于研究主题或学派。" : ""}`;
	};
	updateHint();
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
		play.textContent = "播放";
		play.setAttribute("aria-pressed", "false");
	};

	const layoutButtons = new Map<LayoutMode, HTMLButtonElement>();
	for (const mode of options.layouts) {
		const button = pressButton(LAYOUT_LABEL[mode], mode === layout, () => {
			stop();
			layout = mode;
			for (const [key, item] of layoutButtons) setPressed(item, key === mode);
			updateHint();
			options.onLayout(mode);
		});
		layoutButtons.set(mode, button);
		layoutRow.append(button);
	}

	const colorButtons = new Map<ColorMode, HTMLButtonElement>();
	for (const mode of ["graph", "community", "year"] as const) {
		const button = pressButton(COLOR_LABEL[mode], mode === color, () => {
			color = mode;
			for (const [key, item] of colorButtons) setPressed(item, key === mode);
			updateHint();
			options.onColor(mode);
		});
		colorButtons.set(mode, button);
		colorRow.append(button);
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
		play.textContent = "暂停";
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

	scrubRow.append(range, readout, play);

	const tabs: Array<[GraphTab, string]> = [
		["graph", "图谱"],
		["prior", "先验工作"],
		["derivative", "衍生工作"],
	];
	if (options.researchButton !== undefined) tabs.push(["research", "研究脉络"]);
	if (options.analysisButton) tabs.push(["analysis", "分析"]);
	if (options.timelineButton) tabs.push(["timeline", "引用脉络"]);
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

	tabRow.append(
		actionButton("BibTeX", () => options.onExport("bibtex")),
		actionButton("YAML", () => options.onExport("yaml")),
		actionButton("表格", () => options.onExport("table")),
	);
	if (options.noteButton) tabRow.append(actionButton("写入笔记", () => options.onExport("note")));
	else tabRow.append(actionButton("笔记骨架", () => options.onExport("note")));

	if (layoutHost) layoutHost.append(layoutRow);
	else host.append(layoutRow);
	host.append(colorRow, scrubRow, hint);
	actions.append(tabRow, output);

	return {
		setResearchVisible(visible: boolean): void {
			const button = tabButtons.get("research");
			if (button) button.hidden = !visible;
			if (!visible && button?.getAttribute("aria-pressed") === "true") {
				for (const [key, item] of tabButtons) setPressed(item, key === "graph");
			}
		},
		setYears(min: number, max: number): void {
			stop();
			minYear = min;
			maxYear = Math.max(min, max);
			range.min = String(minYear);
			range.max = String(maxYear);
			range.value = String(maxYear);
			readout.textContent = "全部年份";
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
		},
	};
}

/** One-line paper strip. Starts collapsed; the body is about 160px when open. */
export function mountBottomSheet(host: HTMLElement): BottomSheet {
	host.classList.add("cpo-sheet", "is-collapsed");
	host.replaceChildren();
	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = "cpo-sheet-toggle";
	toggle.setAttribute("aria-expanded", "false");
	const title = document.createElement("span");
	title.className = "cpo-sheet-title";
	title.textContent = "点选节点查看论文";
	const meta = document.createElement("span");
	meta.className = "cpo-sheet-meta";
	const chevron = document.createElement("span");
	chevron.className = "cpo-sheet-chevron";
	chevron.textContent = "展开";
	toggle.append(title, meta, chevron);
	const body = document.createElement("div");
	body.className = "cpo-sheet-body";
	host.append(toggle, body);

	const setExpanded = (open: boolean): void => {
		host.classList.toggle("is-collapsed", !open);
		toggle.setAttribute("aria-expanded", open ? "true" : "false");
		chevron.textContent = open ? "收起" : "展开";
	};
	toggle.addEventListener("click", () => setExpanded(host.classList.contains("is-collapsed")));

	return {
		body,
		setSummary(nextTitle: string, nextMeta: string): void {
			title.textContent = nextTitle;
			meta.textContent = nextMeta;
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
