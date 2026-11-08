import { getIcon } from "obsidian";
import { tr } from "./i18n";
import { type YearHistogram } from "./year-histogram";
import { evidenceBadges, paperStateBadges, type CitationEvidence, type CrossCheckLike, type EvidenceBadge, type PaperStateLike } from "./citation-evidence";
import { LAYOUT_HINT, LAYOUT_LABEL, type LayoutMode } from "./layout-modes";
export type ExportAction = "download" | "copy" | "write";
export type ExportRange = { scope: "filtered" | "full"; mode: "one" | "all"; includeSeedException: false };
export type ExportKind = "bibtex" | "yaml" | "table" | "note";
export type GraphTab = "graph" | "prior" | "derivative" | "research" | "staged" | "excluded" | "pending";

let tabPanelSequence = 0;

const CHROME_ICONS = {
	grid: "layout-grid", clock: "clock", radial: "network",
	play: "play", pause: "pause", edit: "pencil", trash: "trash-2",
	save: "save", project: "folder", views: "layers", refresh: "rotate-cw",
	fit: "maximize", diagnose: "search", external: "external-link",
	star: "star", bookmark: "bookmark", bookmarkCheck: "bookmark-check", read: "book-open",
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
	onExport: (kind: ExportKind, action: ExportAction) => void;
	getExportInfo?: (range: ExportRange) => { count: number; noteTitle: string; noteIsSeed?: boolean; filteredCount?: number; fullCount?: number };
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
	exportOptions(): ExportRange;
	refreshExportInfo(): void;
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
			bar.dataset.year = String(bin.year);
			bar.dataset.hint = tr(`${bin.year} 年 · ${bin.count} 篇文献`, `${bin.year} · ${bin.count} ${bin.count === 1 ? "paper" : "papers"}`);
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
		play.disabled = histogram.bins.filter(bin => bin.count > 0).length < 2;
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
		const years = histogram.bins.filter(bin => bin.count > 0).map(bin => bin.year);
		let year = Number(range.value);
		if (!Number.isFinite(year) || year >= maxYear) year = years[0]!;
		else year = years.find(candidate => candidate >= year) ?? years[0]!;
		range.value = String(year);
		publish();
		play.setAttribute("aria-label", tr("暂停时间视图", "Pause timeline"));
		play.title = tr("暂停时间视图", "Pause timeline");
		play.replaceChildren(createChromeIcon("pause"));
		play.setAttribute("aria-pressed", "true");
		timer = window.setInterval(() => {
			year = years.find(candidate => candidate > year) ?? maxYear;
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
		["prior", tr("图内常引文献", "Frequently cited references")],
		["derivative", tr("引用本图的文献", "Works citing this graph")],
	];
	if (options.researchButton !== undefined) tabs.push(["research", tr("研究脉络", "Research narrative")]);
	if (options.libraryTab) tabs.push(["staged", tr("收藏与排除", "Saved and excluded")]);
	const tabButtons = new Map<GraphTab, HTMLButtonElement>();
	const selectTab = (next: GraphTab): void => {
		const shown: GraphTab = (next === "excluded" || next === "pending") && tabButtons.has("staged") ? "staged" : next;
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
	const exportSummary = createEl("summary"); exportSummary.className = "cpo-tool";
	exportSummary.append(createChromeIcon("export"), document.createTextNode(tr("导出文献资料", "Export literature")), createChromeIcon("chevronDown"));
	exportSummary.setAttribute("aria-label", tr("导出文献资料", "Export literature"));
	exportSummary.title = tr("导出文献资料", "Export literature");
	exportMenu.append(exportSummary);
	const exportItems = createDiv(); exportItems.className = "cpo-export-items";
	const exportHeader = createDiv(); exportHeader.className = "cpo-export-header";
	const exportTitle = createEl("strong"); exportTitle.textContent = tr("导出文献资料", "Export literature");
	const closeExport = actionButton(tr("关闭", "Close"), () => { exportMenu.open = false; exportSummary.focus(); });
	closeExport.classList.add("cpo-export-close"); closeExport.setAttribute("aria-label", tr("关闭导出菜单", "Close export menu"));
	exportHeader.append(exportTitle, closeExport); exportItems.append(exportHeader);
	const batch = createEl("section"); batch.className = "cpo-export-section cpo-export-list";
	const batchTitle = createEl("h3"); batchTitle.textContent = tr("文献列表", "Literature list"); batchTitle.id = `${panelId}-export-list`; batch.setAttribute("aria-labelledby", batchTitle.id);
	const batchDescription = createEl("p"); batchDescription.className = "cpo-export-description";
	batchDescription.textContent = tr("题名、作者、年份、DOI 等文献文本资料", "Titles, contributors, years, DOIs and other literature metadata"); batch.append(batchTitle, batchDescription);
	const scope = createEl("select"); scope.setAttribute("aria-label", tr("文献导出范围", "Literature export scope"));
	for (const [value, text] of [["filtered", tr("当前筛选结果", "Current filtered papers")], ["full", tr("当前图谱全部文献", "All papers in this graph")]] as const) { const option = createEl("option"); option.value = value; option.textContent = text; scope.append(option); }
	const versionMode = createEl("select"); versionMode.setAttribute("aria-label", tr("导出版本范围", "Export version range"));
	for (const [value, text] of [["one", tr("每项研究仅导出当前展示版本", "Current displayed version per research")], ["all", tr("导出所有符合条件的版本", "All eligible versions")]] as const) { const option = createEl("option"); option.value = value; option.textContent = text; versionMode.append(option); }
	for (const [label, select] of [[tr("导出哪些文献？", "Paper scope"), scope], [tr("版本选择", "Versions"), versionMode]] as const) { const field = createEl("label"); field.className = "cpo-export-field"; const name = createSpan(); name.textContent = label; field.append(name, select); batch.append(field); }
	const result = createDiv(); result.className = "cpo-export-result";
	const exportHint = createDiv(); exportHint.className = "cpo-tool-hint"; exportHint.setAttribute("aria-live", "polite");
	const exclusionHint = createSpan(); exclusionHint.textContent = tr("已排除的文献不导出", "Excluded papers omitted"); result.append(exportHint, exclusionHint); batch.append(result);
	const note = createEl("section"); note.className = "cpo-export-section cpo-export-note";
	const noteTitle = createEl("h3"); noteTitle.textContent = tr("单篇文献笔记", "Single literature note"); noteTitle.id = `${panelId}-export-note`; note.setAttribute("aria-labelledby", noteTitle.id);
	const noteDescription = createEl("p"); noteDescription.className = "cpo-export-description"; noteDescription.textContent = tr("仅下方这一篇，不受列表范围影响", "Only this paper; independent of the list scope");
	const notePaper = createDiv(); notePaper.className = "cpo-export-note-paper";
	const noteContext = createSpan(); const noteHint = createEl("strong"); noteHint.className = "cpo-export-note-title"; notePaper.append(noteContext, noteHint);
	const noteHelp = createEl("p"); noteHelp.className = "cpo-export-description"; noteHelp.textContent = tr("包含文献信息和阅读状态的 Markdown 笔记骨架", "Markdown template with literature metadata and reading status");
	const noteActions = createDiv(); noteActions.className = "cpo-export-note-actions";
	note.append(noteTitle, noteDescription, notePaper, noteHelp, noteActions);
	exportItems.append(batch, note);
	const exportButtons: HTMLButtonElement[] = [], batchButtons: HTMLButtonElement[] = [];
	let exportsEnabled = false;
	const exportRange = (): ExportRange => ({ scope: scope.value === "full" ? "full" : "filtered", mode: versionMode.value === "all" ? "all" : "one", includeSeedException: false });
	const refreshExportInfo = (): void => {
		const info = exportsEnabled ? options.getExportInfo?.(exportRange()) : undefined;
		for (const [index, label, count] of [[0, tr("当前筛选结果", "Current filtered papers"), info?.filteredCount], [1, tr("当前图谱全部文献", "All papers in this graph"), info?.fullCount]] as const) scope.options[index]!.textContent = count === undefined ? label : tr(`${label} · ${count} 篇`, `${label} · ${count}`);
		exportHint.textContent = exportsEnabled ? tr(`本次导出 ${info?.count ?? 0} 条文献记录`, `${info?.count ?? 0} literature records to export`) : tr("请先构建图谱", "Build a graph first");
		exclusionHint.hidden = !exportsEnabled;
		noteContext.textContent = info?.noteIsSeed ? tr("种子文献", "Seed paper") : tr("当前选中的文献", "Selected paper"); noteHint.textContent = info?.noteTitle || "—";
		for (const button of batchButtons) button.disabled = !exportsEnabled || info?.count === 0;
		if (exportMenu.open && exportItems.isConnected) positionPopover(exportItems);
	};
	for (const [label, kind, extension] of [[tr("参考文献 · BibTeX", "References · BibTeX"), "bibtex", "bib"], [tr("结构化资料 · YAML", "Metadata · YAML"), "yaml", "yaml"], [tr("文献表格", "Literature table"), "table", "csv"], ["Markdown", "note", "md"]] as const) {
		const row = kind === "note" ? noteActions : createDiv();
		if (kind !== "note") { row.className = "cpo-export-format"; const title = createSpan(); title.textContent = label; row.append(title); batch.append(row); }
		for (const action of ["download", "copy"] as const) {
			const text = action === "download" ? tr(`下载 .${extension}`, `Download .${extension}`) : kind === "note" ? tr("复制笔记骨架", "Copy note template") : tr("复制", "Copy");
			const button = actionButton(text, () => options.onExport(kind, action));
			button.setAttribute("aria-label", `${action === "download" ? tr("下载", "Download") : tr("复制", "Copy")} ${kind === "table" ? tr("文献表格", "Literature table") : label}`);
			exportButtons.push(button); if (kind !== "note") batchButtons.push(button); row.append(button);
		}
	}
	if (options.noteButton) { const button = actionButton(tr("写入 Obsidian 笔记", "Write to Obsidian note"), () => options.onExport("note", "write")); exportButtons.push(button); noteActions.append(button); }
	scope.onchange = versionMode.onchange = refreshExportInfo;
	exportMenu.addEventListener("toggle", () => { if (exportMenu.open) refreshExportInfo(); });
	const setExportsEnabled = (enabled: boolean): void => { exportsEnabled = enabled; for (const button of exportButtons) button.disabled = !enabled; refreshExportInfo(); };
	setExportsEnabled(false); exportMenu.append(exportItems);
	const releaseExportMenu = registerPopover(exportMenu);
	const onExportResize = (): void => { if (exportMenu.open) refreshExportInfo(); };
	window.addEventListener("resize", onExportResize);

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
		exportOptions: exportRange,
		refreshExportInfo,
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
			window.removeEventListener("resize", onExportResize);
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

/** Keep a compact menu within the viewport without changing its anchor. */
export function positionPopover(panel: HTMLElement): void {
	panel.style.removeProperty("--cpo-export-x"); panel.style.removeProperty("--cpo-export-y");
	const frame = getComputedStyle(panel).position === "fixed" ? null : panel.closest<HTMLElement>(".cpo-root, .cpo-embed");
	const bounds = frame?.getBoundingClientRect();
	const left = Math.max(8, (bounds?.left ?? 0) + 8), right = Math.min(window.innerWidth - 8, (bounds?.right ?? window.innerWidth) - 8);
	const top = Math.max(8, (bounds?.top ?? 0) + 8), bottom = Math.min(window.innerHeight - 8, (bounds?.bottom ?? window.innerHeight) - 8);
	panel.style.setProperty("--cpo-menu-width", `${Math.max(0, Math.min(440, right - left))}px`);
	panel.style.setProperty("--cpo-menu-height", `${Math.max(44, bottom - top)}px`);
	const rect = panel.getBoundingClientRect();
	panel.style.setProperty("--cpo-export-x", `${Math.max(left, Math.min(rect.left, right - rect.width)) - rect.left}px`);
	panel.style.setProperty("--cpo-export-y", `${Math.max(top, Math.min(rect.top, bottom - rect.height)) - rect.top}px`);
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
