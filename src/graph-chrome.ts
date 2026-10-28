import { getIcon } from "obsidian";
import { tr } from "./i18n";
import { type YearHistogram } from "./year-histogram";
import { evidenceBadges, paperStateBadges, type CitationEvidence, type CrossCheckLike, type EvidenceBadge, type PaperStateLike } from "./citation-evidence";
import { LAYOUT_HINT, LAYOUT_LABEL, type LayoutMode } from "./layout-modes";
export type ExportKind = "bibtex" | "yaml" | "table" | "note";
export type GraphTab = "graph" | "prior" | "derivative" | "research" | "staged" | "excluded";

let tabPanelSequence = 0;

const CHROME_ICONS = {
	grid: "layout-grid", clock: "clock", radial: "network",
	play: "play", pause: "pause", edit: "pencil", trash: "trash-2",
	save: "save", project: "folder", views: "layers", refresh: "rotate-cw",
	fit: "maximize", diagnose: "search", external: "external-link",
	bookmark: "bookmark", bookmarkCheck: "bookmark-check", read: "book-open",
	exclude: "circle-minus", copy: "copy", table: "table", note: "file-text",
	export: "download", chevronDown: "chevron-down", chevronUp: "chevron-up", chevronRight: "chevron-right",
	plus: "plus", minus: "minus", back: "chevron-left", filter: "list-filter",
} as const;

export function createChromeIcon(name: keyof typeof CHROME_ICONS): SVGSVGElement {
	const svg = getIcon(CHROME_ICONS[name]);
	if (!svg) throw new Error(`Missing Lucide icon: ${CHROME_ICONS[name]}`);
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("cpo-icon-glyph");
	return svg;
}

/** Shared badge row; empty input paints nothing. */
export function paintBadges(host: HTMLElement, badges: readonly EvidenceBadge[]): void {
	if (badges.length === 0) return;
	const row = createSpan();
	row.className = "cpo-badges";
	for (const badge of badges) {
		const item = createSpan();
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
	tabsHost: HTMLElement;
	tabPanel: HTMLElement;
	researchButton?: boolean;
	/** Pane library. Becomes the bottom sidebar tab instead of a top-bar button. */
	libraryTab?: boolean;
	/** Export actions. When set, they leave the control host. */
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
	setHistogram(histogram: YearHistogram, cutoff: number | null): void;
	/** Replace the sample bars. A scrub highlight uses setHistogram so the slider is not reset. */
	showSample(histogram: YearHistogram, cutoff: number | null): void;
	/** 同步页签按钮高亮（不触发 onTab，由调用方自己渲染）。 */
	setTab(tab: GraphTab): void;
	setExportsEnabled(enabled: boolean): void;
	setExportText(text: string, showPreview?: boolean): void;
	copyText(text: string, label: string): Promise<void>;
	clearExportText(): void;
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

	const layoutRow = createDiv();
	layoutRow.className = "cpo-tool-row";
	const scrubRow = createDiv();
	scrubRow.className = "cpo-tool-row cpo-scrub-row";
	const tabRow = createDiv();
	tabRow.className = "cpo-tool-row cpo-tab-row";
	tabRow.setAttribute("role", "tablist");
	tabRow.setAttribute("aria-label", tr("图谱内容", "Graph content"));
	const panelId = `cpo-tab-panel-${++tabPanelSequence}`;
	options.tabPanel.id = panelId;
	options.tabPanel.setAttribute("role", "tabpanel");
	options.tabPanel.tabIndex = 0;
	let layout = options.layout;
	let hasYears = false;
	let histogram: YearHistogram = { bins: [], unknown: 0, dated: 0 };
	const bars = createDiv();
	bars.className = "cpo-year-bars";
	bars.setAttribute("aria-hidden", "true");
	const summary = createEl("p");
	summary.className = "cpo-year-summary";
	const paintBars = (): void => {
		const cutoff = Number(range.value);
		const throughAll = !hasYears || !Number.isFinite(cutoff) || cutoff >= maxYear;
		bars.replaceChildren();
		const peak = Math.max(1, ...histogram.bins.map((bin) => bin.count));
		for (const bin of histogram.bins) {
			const bar = createSpan();
			bar.style.setProperty("--year", String(bin.year));
			bar.className = throughAll || bin.year <= cutoff ? "cpo-year-bar is-on" : "cpo-year-bar";
			bar.style.height = `${Math.max(bin.count === 0 ? 2 : 3, Math.round((bin.count / peak) * 18))}px`;
			bars.append(bar);
		}
		if (histogram.bins.length === 0) {
			summary.textContent = tr("当前样本没有年份", "This sample has no years");
			return;
		}
		const first = histogram.bins[0]!.year;
		const last = histogram.bins[histogram.bins.length - 1]!.year;
		const span = first === last ? String(first) : `${first}–${last}`;
		const unknownNote = histogram.unknown ? tr(` · 年份未知 ${histogram.unknown}`, ` · ${histogram.unknown} undated`) : "";
		const seedNote = !throughAll ? tr(" · 种子始终显示", " · Seed stays visible") : "";
		summary.textContent = tr(`${span} · ${histogram.dated} 篇有年份`, `${span} · ${histogram.dated} dated`) + unknownNote + seedNote;
	};
	const showYearBand = (): void => {
		const show = layout === "temporal";
		scrubRow.hidden = !show;
		if (scrubHost) scrubHost.hidden = !show;
		if (!show) return;
		const noYears = !hasYears || histogram.bins.length === 0;
		range.hidden = noYears;
		play.hidden = noYears;
		bars.hidden = noYears;
		play.disabled = histogram.bins.length < 2;
		range.disabled = histogram.bins.length < 2;
		if (noYears) {
			summary.textContent = tr("当前样本没有年份", "This sample has no years");
			return;
		}
		paintBars();
	};
	const syncScrub = (): void => {
		if (layout !== "temporal") {
			stop();
			range.value = String(maxYear);
			readout.textContent = tr("全部年份", "All years");
			options.onScrub(null);
		}
		showYearBand();
	};
	const readout = createSpan();
	readout.className = "cpo-scrub-readout";
	readout.textContent = tr("全部年份", "All years");
	const output = createDiv();
	output.className = "cpo-export-feedback";
	output.hidden = true;
	const outputMessage = createSpan();
	outputMessage.className = "cpo-export-message";
	outputMessage.setAttribute("role", "status");
	const outputPreview = createEl("pre");
	outputPreview.className = "cpo-export-text";
	outputPreview.hidden = true;
	const clearOutput = createEl("button");
	clearOutput.type = "button";
	clearOutput.className = "cpo-export-clear";
	clearOutput.textContent = tr("清除", "Clear");
	let outputTimer = 0;
	const clearOutputText = (): void => {
		if (outputTimer) window.clearTimeout(outputTimer);
		outputTimer = 0;
		output.hidden = true;
		outputMessage.textContent = "";
		outputPreview.textContent = "";
	};
	clearOutput.addEventListener("click", clearOutputText);
	output.append(outputMessage, clearOutput, outputPreview);
	let minYear = 1900;
	let maxYear = 2020;
	let timer = 0;

	const stop = (): void => {
		if (timer) window.clearInterval(timer);
		timer = 0;
		play.setAttribute("aria-label", tr("播放时间视图", "Play timeline"));
		play.title = tr("播放时间视图", "Play timeline");
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
		const label = createSpan();
		label.className = "cpo-layout-label";
		label.textContent = LAYOUT_LABEL[mode];
		const icon = createSpan();
		icon.className = "cpo-layout-icon";
		icon.setAttribute("aria-hidden", "true");
		icon.append(createChromeIcon(mode === "force2d" ? "grid" : mode === "temporal" ? "clock" : "radial"));
		button.replaceChildren(icon, label);
		layoutButtons.set(mode, button);
		layoutRow.append(button);
	}

	const range = createEl("input");
	range.type = "range";
	range.min = String(minYear);
	range.max = String(maxYear);
	range.step = "1";
	range.value = String(maxYear);
	range.setAttribute("aria-label", tr("年份播放", "Year playback"));
	const publish = (): void => {
		const year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) {
			readout.textContent = tr("全部年份", "All years");
			options.onScrub(null);
			paintBars();
			return;
		}
		readout.textContent = tr(`截至 ${year}`, `Through ${year}`);
		options.onScrub(year);
		paintBars();
	};
	range.addEventListener("input", () => {
		stop();
		publish();
	});

	const play = pressButton(tr("播放", "Play"), false, () => {
		if (play.disabled || minYear >= maxYear) return;
		if (timer) {
			stop();
			return;
		}
		let year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) year = minYear;
		range.value = String(year);
		publish();
		play.setAttribute("aria-label", tr("暂停时间视图", "Pause timeline"));
		play.title = tr("暂停时间视图", "Pause timeline");
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

	const scrubMeta = createDiv();
	scrubMeta.className = "cpo-scrub-meta";
	scrubMeta.append(readout, play);
	scrubRow.append(bars, summary, range, scrubMeta);

	const tabs: Array<[GraphTab, string]> = [
		["graph", tr("论文详情", "Paper details")],
		["prior", tr("先验工作", "Prior work")],
		["derivative", tr("衍生工作", "Later work")],
	];
	if (options.researchButton !== undefined) tabs.push(["research", tr("研究脉络", "Research narrative")]);
	if (options.libraryTab) tabs.push(["staged", tr("暂存与排除", "Saved and excluded")]);
	const tabButtons = new Map<GraphTab, HTMLButtonElement>();
	const selectTab = (next: GraphTab): void => {
		const shown: GraphTab = next === "excluded" && tabButtons.has("staged") ? "staged" : next;
		for (const [key, item] of tabButtons) {
			const selected = key === shown;
			item.classList.toggle("is-on", selected);
			item.setAttribute("aria-selected", String(selected));
			item.tabIndex = selected || (!tabButtons.has(shown) && key === "graph") ? 0 : -1;
		}
		const selected = tabButtons.get(shown);
		if (selected) options.tabPanel.setAttribute("aria-labelledby", selected.id);
		else options.tabPanel.removeAttribute("aria-labelledby");
	};
	for (const [tab, label] of tabs) {
		const button = pressButton(label, tab === "graph", () => {
			selectTab(tab);
			options.onTab(tab);
		});
		button.id = `${panelId}-${tab}`;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-controls", panelId);
		button.removeAttribute("aria-pressed");
		button.title = label;
		tabButtons.set(tab, button);
		if (tab === "research") button.hidden = !options.researchButton;
		tabRow.append(button);
	}
	selectTab("graph");
	tabRow.addEventListener("keydown", (event) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		const visible = Array.from(tabButtons.values()).filter((button) => !button.hidden);
		const current = visible.indexOf(document.activeElement as HTMLButtonElement);
		if (current < 0) return;
		const index = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
			: (current + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length;
		event.preventDefault();
		visible[index]?.focus();
		visible[index]?.click();
	});

	const exportMenu = createEl("details");
	exportMenu.className = "cpo-export-menu";
	const exportSummary = createEl("summary");
	exportSummary.className = "cpo-tool";
	exportSummary.append(createChromeIcon("export"), document.createTextNode(tr("导出", "Export")), createChromeIcon("chevronDown"));
	exportMenu.append(exportSummary);
	const exportItems = createDiv();
	exportItems.className = "cpo-export-items";
	const exportHint = createDiv();
	exportHint.className = "cpo-tool-hint";
	exportHint.hidden = true;
	exportHint.textContent = tr("请先构建图谱", "Build a graph first");
	exportItems.append(exportHint);
	const exportButtons: HTMLButtonElement[] = [];
	for (const [label, kind] of [["BibTeX", "bibtex"], ["YAML", "yaml"], [tr("表格", "Table"), "table"], [options.noteButton ? tr("写入笔记", "Write to note") : tr("笔记骨架", "Note template"), "note"]] as const) {
		const button = actionButton(label, () => options.onExport(kind));
		exportButtons.push(button);
		exportItems.append(button);
	}
	exportMenu.append(exportItems);
	const setExportsEnabled = (enabled: boolean): void => {
		exportHint.hidden = enabled;
		for (const button of exportButtons) {
			button.disabled = !enabled;
			if (enabled) button.removeAttribute("title");
			else button.title = exportHint.textContent ?? "";
		}
	};
	setExportsEnabled(false);
	const releaseExportMenu = registerPopover(exportMenu);

	const onExportKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape" && !output.hidden) clearOutputText();
	};
	if (typeof document !== "undefined") document.addEventListener("keydown", onExportKey);

	if (layoutHost) layoutHost.append(layoutRow);
	else host.append(layoutRow);
	(scrubHost ?? host).append(scrubRow);
	syncScrub();
	options.tabsHost.append(tabRow);
	actions.append(exportMenu, output);

	return {
		setLayout(mode: LayoutMode): void {
			layoutButtons.get(mode)?.click();
		},
		setResearchVisible(visible: boolean): void {
			const button = tabButtons.get("research");
			if (button) button.hidden = !visible;
			if (!visible && button?.getAttribute("aria-selected") === "true") selectTab("graph");
		},
		setYears(min: number, max: number): void {
			stop();
			hasYears = true;
			minYear = min;
			maxYear = Math.max(min, max);
			range.min = String(minYear);
			range.max = String(maxYear);
			range.value = String(maxYear);
			readout.textContent = tr("全部年份", "All years");
			syncScrub();
		},
		clearYears(): void {
			stop();
			hasYears = false;
			histogram = { bins: [], unknown: 0, dated: 0 };
			readout.textContent = tr("全部年份", "All years");
			syncScrub();
		},
		setHistogram(next: YearHistogram, cutoff: number | null): void {
			histogram = next;
			hasYears = next.bins.length > 0;
			if (cutoff !== null && next.bins.length > 1) {
				range.value = String(Math.min(maxYear, Math.max(minYear, cutoff)));
			}
			showYearBand();
		},
		showSample(next: YearHistogram, cutoff: number | null): void {
			if (next.dated && next.bins.length > 0) {
				const first = next.bins[0]!.year;
				const last = next.bins[next.bins.length - 1]!.year;
				this.setYears(first, last);
			} else this.clearYears();
			this.setHistogram(next, cutoff);
		},
		setTab(next: GraphTab): void {
			selectTab(next);
		},
		setExportsEnabled,
		setExportText(text: string, showPreview = false): void {
			if (outputTimer) window.clearTimeout(outputTimer);
			outputTimer = 0;
			output.hidden = false;
			outputMessage.textContent = showPreview ? tr("剪贴板不可用，可手动复制以下内容。", "Clipboard unavailable. Copy the text below manually.") : text;
			outputPreview.hidden = !showPreview;
			outputPreview.textContent = showPreview ? text : "";
			if (!showPreview) outputTimer = window.setTimeout(clearOutputText, 3500);
		},
		async copyText(text: string, label: string): Promise<void> {
			try {
				await navigator.clipboard.writeText(text);
				this.setExportText(tr(`已复制${label}到剪贴板`, `Copied ${label} to clipboard`));
			} catch {
				this.setExportText(text, true);
			}
		},
		clearExportText(): void { clearOutputText(); },
		destroy(): void {
			stop();
			clearOutputText();
			releaseExportMenu();
			if (typeof document !== "undefined") document.removeEventListener("keydown", onExportKey);
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
	const body = createDiv();
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
	const toggle = createEl("button");
	toggle.type = "button";
	toggle.className = "cpo-sheet-toggle";
	toggle.setAttribute("aria-expanded", "false");
	const title = createSpan();
	title.className = "cpo-sheet-title";
	title.textContent = tr("点选节点查看论文", "Select a node to view its paper");
	const langTag = createSpan();
	langTag.className = "cpo-tag cpo-sheet-tag";
	langTag.hidden = true;
	const meta = createSpan();
	meta.className = "cpo-sheet-meta";
	const chevron = createSpan();
	chevron.className = "cpo-sheet-chevron";
	chevron.textContent = tr("展开", "Expand");
	toggle.append(title, langTag, meta, chevron);
	host.append(toggle, body);

	const setExpanded = (open: boolean): void => {
		host.classList.toggle("is-collapsed", !open);
		toggle.setAttribute("aria-expanded", open ? "true" : "false");
		chevron.textContent = open ? tr("收起", "Collapse") : tr("展开", "Expand");
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

const popovers = new Set<HTMLDetailsElement>();
let popoverListening = false;

function ensurePopoverListeners(): void {
	if (popoverListening || typeof document === "undefined") return;
	popoverListening = true;
	document.addEventListener("pointerdown", (event) => {
		const target = event.target;
		for (const menu of [...popovers]) {
			if (!menu.isConnected) { popovers.delete(menu); continue; }
			if (!menu.open || (target instanceof Node && menu.contains(target))) continue;
			menu.open = false;
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		for (const menu of [...popovers]) {
			if (!menu.isConnected) { popovers.delete(menu); continue; }
			menu.open = false;
		}
	});
}

/** A details menu closes itself: item click, outside pointer, or Escape. */
export function registerPopover(menu: HTMLDetailsElement): () => void {
	popovers.add(menu);
	ensurePopoverListeners();
	const onClick = (event: Event): void => {
		const target = event.target;
		if (target instanceof Element && target.closest("button")) menu.open = false;
	};
	menu.addEventListener("click", onClick);
	return () => {
		popovers.delete(menu);
		menu.removeEventListener("click", onClick);
	};
}

function pressButton(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.className = "cpo-tool";
	button.textContent = label;
	setPressed(button, on);
	button.addEventListener("click", onClick);
	return button;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
	const button = createEl("button");
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
