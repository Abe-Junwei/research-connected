import "../src/host-language";
import { classicCandidates } from "../src/aggregates";
import { channelsFromCss } from "../src/theme-color";
import { mountGraphApp } from "../src/app";
import { mountEmbed } from "../src/embed-mount";
import { paintWorkflowLibrary } from "../src/workflow-library";
import { paintMetadataCard, paintAbstractCard, paintIdentityDecisionActions, paintPaperWorkflowState, paintRelationSection } from "../src/detail-cards";
import { paintPaperActions, paintPaperActionFeedback } from "../src/paper-actions";
import type { ProjectPaperState, ResearchProject } from "../src/project-state";
import { createChromeIcon } from "../src/graph-chrome";
import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../src/settings-model";
import type { GraphEdge, PaperNode } from "../src/types";
import { SimilarityMap } from "../src/map-canvas";
import { fixtureGet } from "../preview/fixture";
import { mountGraphSurface } from "../src/graph-surface";
import { createReadingWorkflow } from "../src/reading-workflow";
import { verifyProjectBrowser } from "./verify-project-browser";
import { verifyExportBrowser } from "./verify-export-browser";
import { verifyIntroCamera, verifyMapResizeBrowser } from "./verify-map-resize-browser";
import { syntheticGraph } from "./perf-fixture";
import type { GetJson } from "../src/openalex";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function channel(value: number): number {
	const unit = value / 255;
	return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function paintColor(color: string): { r: number; g: number; b: number; a: number } {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("color sample canvas is unavailable");
	context.clearRect(0, 0, 1, 1);
	context.fillStyle = color;
	context.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
	return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 0 };
}

function contrastRatio(foreground: { r: number; g: number; b: number }, background: { r: number; g: number; b: number }): number {
	const luminance = (color: { r: number; g: number; b: number }): number => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
	const lighter = Math.max(luminance(foreground), luminance(background));
	const darker = Math.min(luminance(foreground), luminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

function readableContrast(element: HTMLElement): number {
	const foreground = paintColor(getComputedStyle(element).color);
	let node: HTMLElement | null = element;
	let background = { r: 255, g: 255, b: 255, a: 255 };
	while (node) {
		const next = paintColor(getComputedStyle(node).backgroundColor);
		if (next.a >= 250) {
			background = next;
			break;
		}
		node = node.parentElement;
	}
	return contrastRatio(foreground, background);
}

async function verify(): Promise<void> {
	if (new URLSearchParams(location.search).has("copy-only")) {
		await verifyCopyUi();
		document.body.dataset.result = "passed";
		return;
	}
	await verifyMapResizeBrowser();
	await verifyIntroCamera();
	check(channelsFromCss("oklch(pow(0.235, calc(1 / 1)) 0 285)", { r: 255, g: 255, b: 255 }).r < 140, "Obsidian OKLCH dark theme resolves to dark RGB channels");
	const uncaught: unknown[] = [];
	const radialGradient = CanvasRenderingContext2D.prototype.createRadialGradient;
	CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
		check(args.every(Number.isFinite), `canvas gradient coordinates must be finite: ${JSON.stringify(args)}`);
		return radialGradient.apply(this, args);
	};
	window.addEventListener("error", (event) => uncaught.push(event.error));
	window.addEventListener("unhandledrejection", (event) => uncaught.push(event.reason));
	for (const name of ["grid", "clock", "radial", "play", "pause", "edit", "trash", "save", "project", "views", "refresh", "fit", "diagnose", "external", "bookmark", "bookmarkCheck", "read", "exclude", "copy", "table", "note", "export", "chevronDown", "chevronRight", "plus", "minus", "back", "filter"] as const) {
		const icon = createChromeIcon(name);
		check(icon.getAttribute("viewBox") === "0 0 24 24" && icon.childElementCount > 0, `Lucide icon renders: ${name}`);
		check(icon.getAttribute("aria-hidden") === "true", "decorative icons stay hidden from screen readers");
	}
	const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
	const rules = link?.sheet?.cssRules;
	let stylesLoaded = false;
	if (rules) for (let index = 0; index < rules.length; index += 1) if (rules[index]?.cssText.includes(".cpo-root")) stylesLoaded = true;
	check(stylesLoaded, "stylesheet must load before the review can pass");
	const relationHost = document.createElement("div");
	const relationPapers = syntheticGraph(3).nodes;
	const uncertain: GraphEdge = { source: relationPapers[0]!.id, target: relationPapers[1]!.id, weight: 0.1, structuralSimilarity: 0, structuralCoverage: { references: false, coCitation: false }, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "none" };
	paintRelationSection(relationHost, uncertain, relationPapers[0]!, relationPapers[1]!, { sources: "OpenAlex", getEvidence: () => null });
	check(relationHost.textContent?.includes("不可用") && (relationHost.textContent.match(/证据不足/g)?.length ?? 0) === 2, "relation detail distinguishes missing evidence from observed zeros");
	relationHost.replaceChildren();
	paintRelationSection(relationHost, { ...uncertain, structuralCoverage: { references: true, coCitation: true } }, relationPapers[0]!, relationPapers[1]!, { sources: "OpenAlex", getEvidence: () => null });
	check(relationHost.textContent?.includes("0 篇") && relationHost.textContent.includes("0 次"), "relation detail shows sampled zeros when comparable");
	const identityHost = document.createElement("div");
	identityHost.className = "cpo-surface";
	document.body.append(identityHost);
	let mergedIds: string[] = [];
	paintIdentityDecisionActions(identityHost, { id: "W1", title: "First" } as PaperNode, [{ id: "W2", title: "Second" } as PaperNode], async (ids) => { mergedIds = ids; });
	const identitySelect = identityHost.querySelector<HTMLSelectElement>(".cpo-version-choice")!;
	const mergeButton = identityHost.querySelector<HTMLButtonElement>(".cpo-identity-actions button")!;
	check(!identitySelect.value && mergeButton.disabled, "version identity requires an explicit choice");
	identitySelect.value = "W2";
	identitySelect.dispatchEvent(new Event("change"));
	check(!mergeButton.disabled, "choosing a version enables confirmation");
	mergeButton.click();
	await Promise.resolve();
	check(mergedIds.join(",") === "W1,W2", "confirmation uses the chosen version");
	identityHost.remove();
	const root = document.querySelector<HTMLElement>("#app")!;
	root.style.width = "1200px";
	const controlHost = document.createElement("div");
	controlHost.className = "cpo-surface";
	controlHost.style.width = "180px";
	root.append(controlHost);
	const realTimeout = window.setTimeout;
	const expirations: Array<() => void> = [];
	window.setTimeout = Object.assign((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
		if (delay === 3000 && typeof handler === "function") {
			expirations.push(() => handler(...args));
			return 0;
		}
		return realTimeout(handler, delay, ...args);
	}, realTimeout);
	try {
		controlHost.classList.add("cpo-evidence-sidebar");
		const redrawHost = document.createElement("div");
		controlHost.append(redrawHost);
		paintPaperActionFeedback(redrawHost, "Excluded");
		redrawHost.replaceChildren();
		check(controlHost.querySelector('[role="status"]')?.textContent === "Excluded", "action feedback survives card redraw");
		expirations.shift()!();
		check(!controlHost.querySelector('[role="status"]'), "redraw does not restart the three-second feedback timeout");
		controlHost.classList.remove("cpo-evidence-sidebar");
		redrawHost.remove();
		paintPaperActionFeedback(controlHost, "Saved");
		expirations.shift()!();
		check(!controlHost.querySelector('[role="status"]'), "success feedback clears after three seconds");
		paintPaperActionFeedback(controlHost, "Saved");
		paintPaperActionFeedback(controlHost, "Restored");
		expirations.shift()!();
		check(controlHost.textContent === "Restored", "old timeout cannot clear newer feedback");
		paintPaperActionFeedback(controlHost, "disk full", true);
		expirations.shift()!();
		check(String(controlHost.textContent) === "disk full" && expirations.length === 0, "failure feedback persists past old success timeout");
	} finally {
		window.setTimeout = realTimeout;
		controlHost.replaceChildren();
	}
	const paper = { id: "W2", title: "Control test", year: 2020, authors: "", citedByCount: 0, origin: "reference" as const, abstract: "", isSeed: false } as PaperNode;
	const automaticPaper = { ...paper, title: "Language, Usage and Cognition", year: 2010, citedByCount: 3486, concepts: [], authorList: [] };
	paintMetadataCard(controlHost, automaticPaper, null, classicCandidates([automaticPaper], [], 2026).has(automaticPaper.id));
	paintPaperActions(controlHost, automaticPaper, "W1", null, null, {
		getPaperState: () => undefined, setStaged: () => {}, openExternal: () => {},
	});
	const automaticStar = controlHost.querySelector<SVGElement>(".cpo-card-title .cpo-icon-glyph")!;
	check(getComputedStyle(automaticStar).fill !== "none", "Language, Usage and Cognition keeps its automatic solid star without a manual mark");
	check(!controlHost.querySelector(".cpo-card-title button"), "automatic classic star is a non-interactive indicator");
	controlHost.replaceChildren();
	const ordinaryPaper = { ...automaticPaper, title: "From discourse to syntax and back", year: 2009, citedByCount: 171 };
	paintMetadataCard(controlHost, ordinaryPaper, null, classicCandidates([ordinaryPaper], [], 2026).has(ordinaryPaper.id));
	paintPaperActions(controlHost, ordinaryPaper, "W1", null, null, {
		getPaperState: () => undefined, setStaged: () => {}, openExternal: () => {},
	});
	check(!controlHost.querySelector(".cpo-card-title svg, .cpo-card-title button"), "a 2009 paper with 171 citations has no star or manual classic control");
	controlHost.replaceChildren();
	let state: ProjectPaperState = { paper, reading: "read", staged: false, excluded: true, source: "test", updatedAt: 1 };
	let writes = 0;
	let reject = true;
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	paintPaperActions(controlHost, paper, "W1", null, null, {
		getPaperState: () => state, setStaged: () => { throw new Error("must use commit"); }, openExternal: () => undefined,
		readingConflict: true,
		commit: async (patch) => { writes++; if (reject) throw new Error("disk full"); await gate; state = { ...state, ...patch }; },
	});
	const trigger = controlHost.querySelector<HTMLButtonElement>(".cpo-paper-stage")!;
	check(!controlHost.querySelector('[role="menu"], .cpo-paper-stage-menu-button'), "save is independent and has no combination menu");
	check(trigger.type === "button" && trigger.getAttribute("aria-pressed") === "false", "save is an accessible toggle");
	trigger.click();
	await Promise.resolve(); await Promise.resolve();
	check(!state.staged && state.reading === "read" && controlHost.querySelector('[role="status"]'), "failure retains state and visible error");
	reject = false;
	trigger.click(); trigger.click();
	check(trigger.disabled && trigger.getAttribute("aria-busy") === "true" && !state.staged && Number(writes) === 2, "pending save retains state and prevents duplicate writes");
	release!();
	await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
	check(state.staged && state.reading === "read" && state.excluded && trigger.getAttribute("aria-pressed") === "true", "save preserves reading and exclusion");
	check(!controlHost.querySelector('.cpo-paper-action-error') && !trigger.disabled && controlHost.querySelector('.cpo-paper-action-feedback')?.textContent?.includes("已收藏"), "successful retry shows confirmation and re-enables toggle");
	trigger.click();
	await Promise.resolve(); await Promise.resolve();
	check(!state.staged && state.reading === "read" && state.excluded, "unsave preserves reading and exclusion");
	controlHost.replaceChildren();
	let resolved = false, restored = false;
	paintPaperWorkflowState(controlHost, paper, { ...state, readingConflict: true }, () => { resolved = true; }, undefined, () => { restored = true; });
	const choicesReading = controlHost.querySelectorAll<HTMLButtonElement>('.cpo-reading-option');
	check(choicesReading.length === 3 && !Array.from(choicesReading).some(input => input.getAttribute("aria-checked") === "true"), "conflict leaves all three explicit reading choices unselected");
	const readingTrigger = controlHost.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!;
	check(readingTrigger.textContent?.includes("待确认"), "conflict uses one unconfirmed trigger");
	const closedHeight = controlHost.getBoundingClientRect().height;
	readingTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
	check(controlHost.getBoundingClientRect().height === closedHeight, "opening reading menu does not increase card height");
	check(document.activeElement === choicesReading[0], "keyboard opens menu without saving");
	const readingMenu = controlHost.querySelector<HTMLElement>(".cpo-reading-menu")!;
	check(readingMenu.clientWidth > 0 && readingMenu.scrollWidth <= readingMenu.clientWidth, "reading menu fits a narrow card");
	choicesReading[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
	check(document.activeElement === choicesReading[2], "End focuses last reading choice");
	choicesReading[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	check(document.activeElement === readingTrigger && controlHost.querySelector<HTMLElement>(".cpo-reading-menu")!.hidden, "Escape closes menu and restores focus");
	controlHost.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!.click();
	choicesReading[0]!.click();
	await Promise.resolve();
	check(resolved && (choicesReading[0]!.getAttribute("aria-checked") === "true"), "same stored reading can resolve conflict");
	controlHost.replaceChildren();
	let releaseReading: (() => void) | undefined;
	paintPaperWorkflowState(controlHost, paper, { ...state, reading: "unread" }, async () => {
		await new Promise<void>(resolve => { releaseReading = resolve; });
	});
	const savingChoices = controlHost.querySelectorAll<HTMLButtonElement>('.cpo-reading-option');
	controlHost.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!.click();
	savingChoices[2]!.click();
	check(Array.from(savingChoices).every(input => input.disabled) && (savingChoices[0]!.getAttribute("aria-checked") === "true"), "pending reading save disables choices and retains saved value");
	releaseReading!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
	check((savingChoices[2]!.getAttribute("aria-checked") === "true") && !savingChoices[2]!.disabled, "successful reading save selects the new status");
	controlHost.replaceChildren();
	paintPaperWorkflowState(controlHost, paper, { ...state, reading: "read" }, () => { throw new Error("disk full"); });
	const failingChoices = controlHost.querySelectorAll<HTMLButtonElement>('.cpo-reading-option');
	controlHost.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!.click();
	failingChoices[0]!.click();
	check((failingChoices[2]!.getAttribute("aria-checked") === "true") && !failingChoices[0]!.disabled && controlHost.querySelector('[role="status"]')?.textContent?.includes("保存失败"), "failed reading save retains status with a visible error");
	document.documentElement.dataset.readingChecks = "passed";
	controlHost.replaceChildren();
	paintPaperWorkflowState(controlHost, paper, state, () => undefined, undefined, () => { restored = true; });
	const restore = controlHost.querySelector<HTMLButtonElement>(".cpo-paper-exclude")!;
	check(!restore.textContent && restore.getAttribute("aria-label")?.includes("恢复到当前项目"), "restore is an accessible icon button");
	restore.click(); await Promise.resolve(); check(restored && controlHost.querySelector('.cpo-paper-action-feedback')?.textContent?.includes("已恢复"), "restore calls supplied API and shows confirmation");
	controlHost.replaceChildren();
	paintPaperWorkflowState(controlHost, { ...paper, isSeed: true }, state, () => undefined, () => { throw new Error("seed excluded"); });
	check(!controlHost.querySelector(".cpo-paper-exclude"), "seed cannot be excluded");
	controlHost.replaceChildren();
	paintPaperActions(controlHost, paper, "W1", null, null, {
		getPaperState: () => ({ ...state, staged: false, reading: "read" }), setStaged: () => undefined, openExternal: () => undefined, commit: async () => undefined,
	});
	check(!controlHost.querySelector('[role="menu"], .cpo-paper-stage-menu-button'), "confirmed reading also has no combination menu");
	controlHost.replaceChildren();
	let directPatch: { staged?: boolean; reading?: string } | undefined;
	paintPaperActions(controlHost, paper, "W1", null, null, {
		getPaperState: () => state, setStaged: () => undefined, openExternal: () => undefined,
		commit: async (patch) => { directPatch = patch; state = { ...state, ...patch }; },
	});
	controlHost.querySelector<HTMLButtonElement>(".cpo-paper-stage")!.click();
	await Promise.resolve(); await Promise.resolve();
	check(directPatch?.staged === true && directPatch.reading === undefined && state.excluded, "direct save preserves reading and exclusion");
	const libraryOptions: Parameters<typeof paintWorkflowLibrary>[1] = {
		tab: "staged", projectId: "seed",
		projects: { seed: { version: 1, seedId: "seed", name: "Test", updatedAt: 0, views: [], paperStates: { [paper.id]: { ...state, staged: true } } } },
		workflow: {
			getReadingState: () => { throw new Error("saved list must not request reading state"); },
			commitWorkflow: async () => undefined, getReadingIssues: () => [],
			resolveReading: async () => undefined, retryReading: async () => undefined,
		},
		onTab: () => undefined, onView: () => undefined, onLocate: () => undefined,
		onExclude: () => { throw new Error("saved list must not exclude papers"); },
		onRefresh: () => controlHost.replaceChildren(),
		onExtraHeader: footer => { footer.append(document.createElement("button")); },
	};
	paintWorkflowLibrary(controlHost, libraryOptions);
	check(!controlHost.querySelector('.cpo-library-header'), "saved list omits the duplicate heading");
	check(controlHost.querySelector('.cpo-agg-list')?.nextElementSibling?.classList.contains('cpo-library-footer'), "list actions follow the complete list");
	check(!controlHost.querySelector('.cpo-paper-reading, .cpo-paper-exclude'), "saved list omits reading and exclusion controls");
	const unsave = Array.from(controlHost.querySelectorAll<HTMLButtonElement>(".cpo-library-action")).find(button => button.textContent === "取消收藏")!;
	check(unsave, "saved list retains remove-from-saved action");
	unsave.click(); await Promise.resolve(); await Promise.resolve();
	check(controlHost.querySelector('[role="status"]')?.textContent === "已取消收藏", "unsave confirmation appears after list redraw");
	let restoredFromList = false;
	paintWorkflowLibrary(controlHost, { ...libraryOptions, tab: "excluded", onExclude: (_paper, excluded) => { restoredFromList = !excluded; } });
	check(!controlHost.querySelector('.cpo-paper-reading'), "excluded list omits reading controls");
	const restoreFromList = Array.from(controlHost.querySelectorAll<HTMLButtonElement>(".cpo-library-action")).find(button => button.textContent === "恢复到图谱")!;
	check(restoreFromList, "excluded list retains restore action");
	restoreFromList.click(); await Promise.resolve(); await Promise.resolve();
	check(restoredFromList && controlHost.querySelector('[role="status"]')?.textContent?.includes("已恢复"), "restore confirmation survives list redraw");
	controlHost.remove();
	document.body.dataset.controls = "passed";
	const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: {} as typeof DEFAULT_SETTINGS.researchProjects };
	let failSave = false;
	let openedUrl = "";
	let favoriteWrites = 0;
	let projectWrites = 0;
	let saveDelay: Promise<void> | undefined;
	const workflow = createReadingWorkflow({ getSettings: () => settings, persist: async () => { if (failSave) throw new Error("disk full"); favoriteWrites += 1; } });
	const saveProject = async (project: ResearchProject): Promise<void> => {
		if (saveDelay) await saveDelay;
		if (failSave) throw new Error("disk full");
		projectWrites += 1;
		settings.researchProjects[project.seedId] = project;
	};
	const handle = mountGraphApp(root, {
		...workflow,
		getSettings: () => settings,
		getJson: fixtureGet,
		openExternal(url) { openedUrl = url; },
		saveProject,
		stagePaper: async () => {
			if (failSave) throw new Error("disk full");
			favoriteWrites += 1;
		},
		initialDoi: "10.1234/seed",
		persistSettings: async () => { if (failSave) throw new Error("disk full"); },
	});
	const exportButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".cpo-export-items button"));
	const exportHint = root.querySelector<HTMLElement>(".cpo-export-items .cpo-tool-hint");
	check(exportButtons.length === 4 && exportButtons.every((button) => button.disabled), "empty graph disables export");
	check(exportHint && !exportHint.hidden && exportHint.textContent?.includes("请先构建图谱"), "empty export explains why it is unavailable");
	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("graph did not load")); }, 5000);
		const observer = new MutationObserver(() => {
			if (root.querySelector(".cpo-paper-reading")) {
				observer.disconnect(); window.clearTimeout(timer); resolve();
			}
		});
		observer.observe(root, { childList: true, subtree: true });
	});
	for (const hidden of Array.from(root.querySelectorAll<HTMLElement>("[hidden]"))) {
		check(getComputedStyle(hidden).display === "none", "hidden controls must stay hidden without important overrides");
	}
	const seedSummary = root.querySelector<HTMLElement>(".cpo-canvas-seed")!;
	const stage = root.querySelector<HTMLElement>(".cpo-stage")!;
	const canvas = stage.querySelector("canvas")!;
	const context = canvas.getContext("2d")!;
	const fillText = context.fillText.bind(context);
	const yearLabels: number[] = [];
	const yearPositions = new Map<number, number>();
	let axisDraws = 0;
	const clearRect = context.clearRect.bind(context);
	context.clearRect = (x, y, width, height) => {
		yearPositions.clear();
		clearRect(x, y, width, height);
	};
	context.fillText = (text, x, y, maxWidth) => {
		axisDraws++;
		if (/^\d{4}$/.test(text)) yearLabels.push(y);
		if (/^\d{4}$/.test(text)) yearPositions.set(Number(text), x);
		if (maxWidth === undefined) fillText(text, x, y);
		else fillText(text, x, y, maxWidth);
	};
	const adopt = SimilarityMap.prototype.adoptGraph;
	let layoutAdoptions = 0;
	SimilarityMap.prototype.adoptGraph = function (...args) { layoutAdoptions++; return adopt.apply(this, args); };
	try { root.querySelector<HTMLButtonElement>('[data-layout="radial"]')!.click(); }
	finally { SimilarityMap.prototype.adoptGraph = adopt; }
	check(layoutAdoptions === 0, "switching layout with an unchanged year must not reproject version relations");
	root.querySelector<HTMLButtonElement>('[data-layout="temporal"]')!.click();
	await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
	const checkYearBars = (): void => {
		for (const bar of Array.from(root.querySelectorAll<HTMLElement>(".cpo-year-bar"))) {
			const year = Number(bar.style.getPropertyValue("--year"));
			const x = yearPositions.get(year);
			if (x === undefined) continue;
			const rect = bar.getBoundingClientRect();
			check(Math.abs(rect.left + rect.width / 2 - canvas.getBoundingClientRect().left - x) < 1, `year ${year} bar ${rect.left + rect.width / 2 - canvas.getBoundingClientRect().left} aligns with tick ${x}`);
		}
	};
	checkYearBars();
	for (const key of ["+", "-", "ArrowRight"]) {
		const beforeZoom = canvas.dataset.zoom;
		const beforeDraws = axisDraws;
		yearPositions.clear();
		canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		check(yearPositions.size > 0, `zoom and pan redraw year ticks (${key}; zoom ${beforeZoom} -> ${canvas.dataset.zoom}; draws ${beforeDraws} -> ${axisDraws}; layout ${root.querySelector('[data-layout][aria-pressed="true"]')?.getAttribute("data-layout")}; visibility ${document.visibilityState}; ${uncaught.map(String).join("; ")})`);
		checkYearBars();
	}
	context.fillText = fillText;
	context.clearRect = clearRect;
	const yearBand = root.querySelector<HTMLElement>(".cpo-year-band")!.getBoundingClientRect();
	check(yearLabels.length > 0 && yearLabels.every((y) => y < yearBand.top - canvas.getBoundingClientRect().top), "year ticks render above the bottom controls");
	const yearSummary = root.querySelector<HTMLElement>(".cpo-year-summary")!;
	check(getComputedStyle(yearSummary).fontSize === "11px", "production CSS sets the small year text");
	const summaryContrast = readableContrast(yearSummary);
	check(summaryContrast >= 4.5, `small year text contrast is ${summaryContrast.toFixed(2)}`);
	document.getElementById("cpo-theme-toggle")!.click();
	const nightContrast = readableContrast(yearSummary);
	check(nightContrast >= 4.5, `small year text contrast in the dark theme is ${nightContrast.toFixed(2)}`);
	const primaryDot = root.querySelector<HTMLElement>(".cpo-graph-key-dots i")!;
	check(getComputedStyle(primaryDot).backgroundColor === "rgb(150, 155, 232)", "dark default cluster legend uses the stellar blue-violet color");
	const key = root.querySelector<HTMLElement>(".cpo-graph-legend")!;
	key.focus();
	const ordinaryMark = key.querySelector<HTMLElement>(".cpo-graph-key-star")!;
	check(getComputedStyle(ordinaryMark).display !== "none" && getComputedStyle(ordinaryMark.querySelector("i")!).backgroundImage.includes("radial-gradient"), "dark legend shows a stellar paper core");
	check(getComputedStyle(key.querySelector("i[data-kind]")!).height === "1px", "dark legend uses thin constellation line samples");
	check(!key.querySelector(".cpo-graph-key-classic, .cpo-key-explanation"), "legend omits classic, dark-edge, and size notes");
	const backgroundStar = stage.querySelector<SVGElement>(".cpo-stars circle")!;
	const starAnimation = backgroundStar.getAnimations()[0]!;
	const starTime = starAnimation.currentTime;
	const starTiming = starAnimation.effect!.getTiming();
	starAnimation.pause();
	starAnimation.currentTime = -Number(starTiming.delay);
	const starDim = Number(getComputedStyle(backgroundStar).opacity);
	starAnimation.currentTime = -Number(starTiming.delay) + Number(starTiming.duration) / 2;
	check(Math.abs(Number(getComputedStyle(backgroundStar).opacity) - starDim) > 0.1, "visible background stars change opacity");
	starAnimation.currentTime = starTime;
	starAnimation.play();
	const nebula = stage.querySelector<HTMLElement>(".cpo-nebula")!;
	const nebulaAnimation = nebula.getAnimations({ subtree: true })[0]!;
	const nebulaTime = nebulaAnimation.currentTime;
	nebulaAnimation.pause();
	nebulaAnimation.currentTime = 0;
	const nebulaStart = getComputedStyle(nebula, "::before").transform;
	nebulaAnimation.currentTime = Number(nebulaAnimation.effect!.getTiming().duration);
	check(getComputedStyle(nebula, "::before").transform !== nebulaStart, "background nebula drifts over its cycle");
	nebulaAnimation.currentTime = nebulaTime;
	nebulaAnimation.play();
	document.getElementById("cpo-theme-toggle")!.click();
	check(getComputedStyle(primaryDot).backgroundColor === "rgb(214, 142, 142)", "light default cluster legend retains its original color");
	check(getComputedStyle(ordinaryMark).display === "none", "light legend hides the dark-only stellar key");
	key.blur();
	check(!stage.querySelector(".cpo-star-pause"), "starfield motion has no pause button");
	const star = stage.querySelector<SVGElement>(".cpo-stars circle")!;
	check(getComputedStyle(star).animationPlayState === "running", "background stars animate continuously");
	root.querySelector<HTMLButtonElement>('[aria-label="适应窗口"]')!.click();
	await new Promise((resolve) => window.setTimeout(resolve, 700));
	check(getComputedStyle(star).animationPlayState === "running", "redraw keeps background animation running");
	check(seedSummary.parentElement === stage, "seed information lives inside the canvas");
	check(Math.abs(seedSummary.getBoundingClientRect().left - stage.getBoundingClientRect().left - 16) < 2, "seed information stays at the canvas left edge");
	const saveProjectButton = root.querySelector<HTMLElement>(".cpo-project-save")!;
	const exportMenu = root.querySelector<HTMLElement>(".cpo-export-menu")!;
	check(saveProjectButton.textContent?.includes("已保存") && saveProjectButton.hasAttribute("disabled"), "automatic save settles to a persistent saved state");
	canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, clientX: 100, clientY: 100 }));
	check(saveProjectButton.textContent?.includes("待保存") && !saveProjectButton.hasAttribute("disabled"), "a changed view can be saved immediately");
	failSave = true;
	saveProjectButton.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(saveProjectButton.textContent?.includes("重试保存") && !saveProjectButton.hasAttribute("disabled"), "a failed save stays retryable");
	failSave = false;
	saveProjectButton.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(saveProjectButton.textContent?.includes("已保存") && saveProjectButton.hasAttribute("disabled"), "retry returns to the saved state");
	canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, clientX: 100, clientY: 100 }));
	let releaseSave!: () => void;
	saveDelay = new Promise(resolve => { releaseSave = resolve; });
	failSave = true; saveProjectButton.click();
	check(saveProjectButton.textContent?.includes("保存中") && saveProjectButton.hasAttribute("disabled"), "delayed persistence does not announce success");
	releaseSave(); await new Promise(resolve => setTimeout(resolve, 0));
	check(saveProjectButton.textContent?.includes("重试保存") && !saveProjectButton.hasAttribute("disabled"), "a delayed rejection remains visible and retryable");
	saveDelay = undefined; failSave = false; saveProjectButton.click();
	await new Promise(resolve => setTimeout(resolve, 0));
	check(exportMenu.closest(".cpo-workspace-tools") === saveProjectButton.nextElementSibling, "export follows save project");
	check(exportMenu.getBoundingClientRect().left >= saveProjectButton.getBoundingClientRect().right, "export sits to the right of save project");
	const tablist = root.querySelector<HTMLElement>('[role="tablist"]')!;
	const tabSidebar = tablist.closest<HTMLElement>(".cpo-evidence-sidebar")!;
	check(tabSidebar, "tabs must live in the right sidebar");
	const sidebarToggle = tabSidebar.querySelector<HTMLButtonElement>(".cpo-panel-toggle")!;
	if (sidebarToggle.getAttribute("aria-expanded") === "false") sidebarToggle.click();
	check(sidebarToggle.querySelector("svg.lucide-chevron-right"), "sidebar keeps its Lucide icon after toggling");
	const [graphTab, priorTab, laterTab] = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter((button) => !button.hidden);
	check(graphTab && priorTab && laterTab, "three graph tabs must be available");
	priorTab.click();
	check(priorTab.getAttribute("aria-selected") === "true", "click selects prior work");
	check(root.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby") === priorTab.id, "panel follows the active tab");
	priorTab.focus();
	priorTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
	check(laterTab.getAttribute("aria-selected") === "true" && document.activeElement === laterTab, "arrow key selects and focuses the next tab");
	laterTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
	check(graphTab.getAttribute("aria-selected") === "true", "Home returns to the graph tab");
	check(Math.abs(tablist.getBoundingClientRect().bottom - tabSidebar.getBoundingClientRect().bottom) < 2, "tabs stay at the sidebar bottom");
	const identity = root.querySelector<HTMLElement>(".cpo-paper-identity")!;
	const sourceLink = identity.querySelector<HTMLButtonElement>(".cpo-paper-sources .cpo-paper-source")!;
	check(identity.querySelector(".cpo-paper-sources")?.textContent?.includes("OpenAlex"), "OpenAlex is grouped with source links");
	sourceLink.click();
	check(openedUrl.startsWith("https://openalex.org/"), "source link opens the original OpenAlex URL");
	check(exportButtons.every((button) => !button.disabled) && exportHint?.hidden, "a built graph enables export");
	const exportDetails = root.querySelector<HTMLDetailsElement>("details.cpo-export-menu")!;
	const exportMessage = root.querySelector<HTMLElement>(".cpo-export-message")!;
	exportDetails.open = true;
	exportDetails.open = false;
	check(!exportMessage.textContent, "closing the export menu is not a successful export");
	const projectMenu = root.querySelector<HTMLDetailsElement>("details.cpo-project-menu")!;
	projectMenu.open = true;
	const projectButton = projectMenu.querySelector<HTMLButtonElement>(".cpo-menu-switch")!;
	const originalName = projectButton.textContent ?? "";
	check(originalName.length > 0, "the built graph has a project to rename");
	const startRename = (): HTMLButtonElement => {
		projectMenu.querySelector<HTMLButtonElement>(".cpo-project-rename")!.click();
		const field = projectMenu.querySelector<HTMLButtonElement>(".cpo-row-rename");
		check(field, "rename replaces the project name with a field");
		return field;
	};
	const afterRename = async (): Promise<void> => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	};
	let field = startRename();
	field.value = "不会保存";
	field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	await afterRename();
	check(!projectMenu.querySelector(".cpo-row-rename") && projectMenu.querySelector(".cpo-menu-switch")?.textContent === originalName, "Escape leaves the project name and restores the selector");
	field = startRename();
	field.value = "失败的名字";
	failSave = true;
	field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await afterRename();
	failSave = false;
	check(projectMenu.querySelector(".cpo-menu-switch")?.textContent === originalName && root.querySelector(".cpo-status")?.textContent === "disk full", "a failed rename rolls back and says why");
	field = startRename();
	field.value = "新的项目名";
	field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await afterRename();
	check(projectMenu.querySelector(".cpo-menu-switch")?.textContent === "新的项目名", "Enter saves the name and restores the selector");
	field = startRename();
	field.value = "失焦后的名字";
	field.dispatchEvent(new FocusEvent("blur"));
	await afterRename();
	check(projectMenu.querySelector(".cpo-menu-switch")?.textContent === "失焦后的名字", "leaving the field saves the name");
	const liveToggle = root.querySelector<HTMLButtonElement>(".cpo-abstract-toggle");
	check(liveToggle?.hidden === true, "the short fixture abstract does not offer expand");
	const abstractHost = document.createElement("div");
	abstractHost.className = "cpo-surface";
	abstractHost.style.width = "480px";
	document.body.append(abstractHost);
	const sample = (abstract: string): PaperNode => ({ id: "W1", title: "摘要样本", year: 2020, authors: "", citedByCount: 0, origin: "seed", abstract } as PaperNode);
	const settle = async (): Promise<void> => {
		await new Promise((resolve) => window.setTimeout(resolve, 50));
	};
	paintAbstractCard(abstractHost, sample("短"), (paper) => paper.abstract);
	await settle();
	check(abstractHost.querySelector<HTMLElement>(".cpo-abstract-toggle")?.hidden === true && abstractHost.querySelector<HTMLElement>(".cpo-abstract-fade")?.hidden === true, "a short abstract has no fade or expand");
	abstractHost.replaceChildren();
	paintAbstractCard(abstractHost, sample(`${"长摘要句子。".repeat(40)}`), (paper) => paper.abstract);
	await settle();
	const longToggle = abstractHost.querySelector<HTMLButtonElement>(".cpo-abstract-toggle")!;
	check(longToggle.hidden === false, "a long abstract can expand");
	longToggle.click();
	check(longToggle.getAttribute("aria-expanded") === "true", "expanding shows the full abstract");
	longToggle.click();
	check(longToggle.getAttribute("aria-expanded") === "false", "the long abstract can collapse");
	abstractHost.replaceChildren();
	abstractHost.style.width = "480px";
	paintAbstractCard(abstractHost, sample("边界".repeat(24)), (paper) => paper.abstract);
	await settle();
	const resizeToggle = abstractHost.querySelector<HTMLButtonElement>(".cpo-abstract-toggle")!;
	check(resizeToggle.hidden === true, "the boundary abstract fits in a wide container");
	abstractHost.style.width = "72px";
	for (let index = 0; index < 40 && resizeToggle.hidden; index++) await new Promise((resolve) => window.setTimeout(resolve, 50));
	check(!resizeToggle.hidden, "narrowing the container shows expand when the abstract no longer fits");
	abstractHost.remove();
	const favorite = root.querySelector<HTMLButtonElement>(".cpo-paper-identity .cpo-paper-stage")!;
	check(!identity.querySelector(".cpo-paper-stage-menu-button"), "favorite is a standalone toggle");
	check(!favorite.textContent && favorite.getAttribute("aria-label")?.includes("收藏"), "save is an accessible icon button");
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "true" && favoriteWrites === 1, "favorite reuses persisted staged state");
	failSave = true;
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "true" && !favorite.disabled, "failed favorite removal rolls back");
	failSave = false;
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "false", "favorite can be removed");
	check(!root.querySelector(".cpo-paper-manual-classic"), "main graph has no manual classic control");
	const reading = root.querySelector<HTMLButtonElement>('.cpo-reading-option[value="read"]')!;
	root.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!.click();
	reading.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check((reading.getAttribute("aria-checked") === "true") && !reading.disabled, "reading state must save and re-enable");
	failSave = true;
	const unread = root.querySelector<HTMLButtonElement>('.cpo-reading-option[value="unread"]')!;
	root.querySelector<HTMLButtonElement>(".cpo-reading-trigger")!.click();
	unread.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(!(unread.getAttribute("aria-checked") === "true") && !unread.disabled && (root.querySelector<HTMLButtonElement>('.cpo-reading-option[value="read"]')!.getAttribute("aria-checked") === "true"), "failed reading save must roll back");
	failSave = false;

	check(canvas.dataset.focus !== "1", "selecting the seed leaves the full graph visible");
	check(!root.querySelector(".cpo-show-all"), "the redundant full-graph button is absent");
	canvas.focus();
	for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
		canvas.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: true, bubbles: true }));
		if (canvas.dataset.focus === "1") break;
	}
	check(canvas.dataset.focus === "1", "arrow selection dims the rest of the graph");
	for (const menu of Array.from(root.querySelectorAll<HTMLDetailsElement>("details[open]"))) menu.open = false;
	const escapeState = `${root.className} ${root.querySelector("details[open]")?.className ?? "no menu"}`;
	canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	check(canvas.dataset.focus !== "1", `Escape restores the full graph; before: ${escapeState}; errors: ${uncaught.map(String).join("; ")}`);
	canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
	canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
	const nodeMenu = root.querySelector<HTMLElement>(".cpo-node-menu")!;
	check(nodeMenu.hidden === false && nodeMenu.contains(document.activeElement), "Shift+F10 opens the node menu on the selected node");
	document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	check(Boolean(nodeMenu.hidden) && document.activeElement === canvas, "Escape closes the menu and returns focus to the graph");
	check(!root.querySelector("button.cpo-undo"), "project switching does not advertise an obsolete same-project seed undo");
	const libraryHost = document.createElement("div");
	document.body.append(libraryHost);
	paintWorkflowLibrary(libraryHost, {
		tab: "pending",
		projectId: null,
		projects: {},
		workflow: {
			getReadingState: () => ({ reading: "unread", confirmed: true, sources: [] }),
			commitWorkflow: async () => undefined,
			getReadingIssues: () => [],
			resolveReading: async () => undefined,
			retryReading: async () => undefined,
		},
		onTab: () => undefined,
		onView: () => undefined,
		onLocate: () => undefined,
		onExclude: () => undefined,
		onRefresh: () => undefined,
	});
	const pending = Array.from(libraryHost.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("待处理"));
	check(pending && pending.tabIndex >= 0, "the pending list is a keyboard control");
	libraryHost.remove();

	const pointerHits = (host: HTMLElement, element: Element): boolean => {
		window.scrollTo(0, 0);
		element.scrollIntoView({ block: "center", inline: "nearest" });
		const box = element.getBoundingClientRect();
		const hostBox = host.getBoundingClientRect();
		const x = box.left + box.width / 2;
		const y = box.top + box.height / 2;
		if (x < hostBox.left || x > hostBox.right || y < hostBox.top || y > hostBox.bottom) return false;
		const top = document.elementFromPoint(x, y);
		return top === element || (top instanceof Node && element.contains(top));
	};
	const waitFor = async (ready: () => boolean, message: string | (() => string)): Promise<void> => {
		const start = performance.now();
		while (performance.now() - start < 2000) {
			if (ready()) return;
			await new Promise((resolve) => window.setTimeout(resolve, 40));
		}
		throw new Error(typeof message === "function" ? message() : message);
	};
	const savedWidth = root.style.width;
	const savedHeight = root.style.height;
	for (const menu of Array.from(root.querySelectorAll<HTMLDetailsElement>("details[open]"))) menu.open = false;
	for (const width of [400, 559]) {
		root.style.width = `${width}px`;
		root.style.height = "720px";
		if (!root.classList.contains("is-detail-cover")) {
			const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter((button) => !button.hidden);
			tabs[1]?.click();
			await waitFor(() => Boolean(root.querySelector(".cpo-agg-open")), "a listed paper can reopen detail");
			root.querySelector<HTMLButtonElement>(".cpo-agg-open")!.click();
		}
		await waitFor(() => root.classList.contains("is-narrow") && root.classList.contains("is-detail-cover"), () => `detail covers the graph at ${width}px (client ${root.clientWidth}, class ${root.className}, detail ${root.querySelector<HTMLElement>(".cpo-detail")?.hidden})`);
		check(root.querySelector(".cpo-evidence-header h2")?.textContent === "论文详情", "narrow detail keeps the paper title");
		const toggle = root.querySelector<HTMLButtonElement>(".cpo-panel-toggle")!;
		const back = root.querySelector<HTMLButtonElement>(".cpo-detail-return")!;
		const title = root.querySelector<HTMLElement>(".cpo-card-title")!;
		check(pointerHits(root, toggle), `panel toggle is clickable at ${width}px`);
		const expanded = toggle.getAttribute("aria-expanded");
		toggle.click();
		check(toggle.getAttribute("aria-expanded") !== expanded, `panel toggle responds at ${width}px`);
		toggle.click();
		check(pointerHits(root, back) && pointerHits(root, title) && pointerHits(root, saveProjectButton), `detail actions stay inside the ${width}px pane`);
		check(getComputedStyle(title).overflowWrap === "anywhere", "long titles wrap inside the narrow pane");
		const zoom = canvas.dataset.zoom;
		const selected = canvas.dataset.selected;
		root.querySelector<HTMLButtonElement>('[aria-label="放大"]')!.click();
		await waitFor(() => canvas.dataset.zoom !== zoom, "zoom changes before returning");
		back.click();
		check(!root.classList.contains("is-detail-cover") && canvas.dataset.zoom === zoom && canvas.dataset.selected === selected, `return restores zoom and selection at ${width}px (zoom ${zoom} → ${canvas.dataset.zoom}, selected ${selected} → ${canvas.dataset.selected}, cover ${root.classList.contains("is-detail-cover")})`);
	}
	root.style.width = savedWidth;
	root.style.height = savedHeight;
	root.style.display = "none";
	const embedHost = document.createElement("div");
	embedHost.style.cssText = "position:fixed;left:0;top:0;width:559px;height:640px;z-index:30;background:#fff;";
	document.body.append(embedHost);
	const embedSettings = { ...DEFAULT_SETTINGS, researchProjects: {} };
	const unmountEmbed = mountEmbed(embedHost, {
		source: "doi: 10.1038/nature14539\nheight: 640",
		getSettings: () => embedSettings,
		getJson: fixtureGet,
		openExternal: () => undefined,
	});
	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("embed graph did not load")); }, 8000);
		const observer = new MutationObserver(() => {
			if (embedHost.querySelector(".cpo-paper-reading")) {
				observer.disconnect(); window.clearTimeout(timer); resolve();
			}
		});
		observer.observe(embedHost, { childList: true, subtree: true });
	});
	const embed = embedHost.querySelector<HTMLElement>(".cpo-embed")!;
	embed.style.width = "559px";
	embed.style.maxWidth = "559px";
	await waitFor(() => embed.classList.contains("is-narrow") && embed.classList.contains("is-detail-cover"), () => `narrow embed covers its own graph (client ${embed.clientWidth}, class ${embed.className})`);
	check(embed.querySelector(".cpo-evidence-header h2")?.textContent === "论文详情", "embed keeps the paper title");
	window.scrollTo(0, 0);
	const embedToggle = embed.querySelector<HTMLButtonElement>(".cpo-panel-toggle")!;
	const embedBack = embed.querySelector<HTMLButtonElement>(".cpo-detail-return")!;
	const embedCanvas = embed.querySelector("canvas")!;
	check(pointerHits(embed, embedToggle) && pointerHits(embed, embedBack), "embed toggle and return are clickable at 559px");
	check(!embed.querySelector(".cpo-paper-manual-classic"), "embed has no manual classic control");
	const embedZoom = embedCanvas.dataset.zoom;
	const embedSelected = embedCanvas.dataset.selected;
	embed.querySelector<HTMLButtonElement>('[aria-label="放大"]')!.click();
	await waitFor(() => embedCanvas.dataset.zoom !== embedZoom, "embed zoom changes before returning");
	embedBack.click();
	check(!embed.classList.contains("is-detail-cover") && embedCanvas.dataset.zoom === embedZoom && embedCanvas.dataset.selected === embedSelected, "embed return restores zoom and selection");
	unmountEmbed();
	embedHost.remove();
	root.style.display = "";
	const sidebar = root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!;
	sidebar.querySelector<HTMLButtonElement>(".cpo-panel-toggle")!.click();
	handle.openDoiPathSearch();
	check(!sidebar.parentElement!.classList.contains("is-sidebar-collapsed"), "path search must reopen the sidebar");
	const form = root.querySelector<HTMLFormElement>(".cpo-path-search")!;
	check(form.getBoundingClientRect().height > 0, "path form must be visible");
	const input = form.querySelector("input")!;
	input.value = "W1";
	form.requestSubmit();
	check(root.querySelector(".cpo-banner")?.textContent?.includes("两个端点"), "invalid endpoints must show a useful error");
	input.value = "W1 → W2";
	form.requestSubmit();
	check(root.querySelector(".cpo-agg-list")?.textContent?.includes("W2"), "valid endpoints must render a citation path");
	const labelHost = document.createElement("div");
	labelHost.style.cssText = "position:fixed;left:8px;top:8px;width:640px;height:420px;z-index:40;display:flex;";
	document.body.append(labelHost);
	const labelSurface = mountGraphSurface(labelHost, { canvasLabel: "labels", title: "", hint: "" });
	const labelMap = new SimilarityMap(labelSurface.canvas, labelSurface.tooltip, labelSurface.stage);
	const labelContext = labelSurface.canvas.getContext("2d")!;
	const labelFill = labelContext.fillText.bind(labelContext);
	const labelDrawn: Array<{ text: string; x: number; y: number; alpha: number }> = [];
	labelContext.fillText = (text, x, y, maxWidth) => {
		labelDrawn.push({ text: String(text), x, y, alpha: labelContext.globalAlpha });
		if (maxWidth === undefined) labelFill(text, x, y);
		else labelFill(text, x, y, maxWidth);
	};
	const labeled = (id: string, title: string, year: number, cited: number, seed: boolean): PaperNode => ({
		id, title, year, citedByCount: cited, authors: "Example Author", authorList: ["Example Author"],
		abstract: "", doiUrl: null, openAlexUrl: `https://openalex.org/${id}`, isSeed: seed,
		origin: seed ? "seed" : "citation", language: null, workType: "article", venue: null, retracted: false, concepts: [],
	});
	const labelEdge: GraphEdge = { source: "W1", target: "W2", weight: 0.4, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target" };
	labelMap.resize();
	const sizingNodes = [labeled("W1", "Seed", 2020, 10000000, true), labeled("W2", "Older", 1991, 3500, false), labeled("W3", "Newer", 2023, 400, false), { ...labeled("W4", "Missing", 2020, 0, false), citationCountStatus: "missing" as const }];
	for (const mode of ["force2d", "temporal", "radial"] as const) {
		labelMap.setLayout(mode);
		labelMap.setGraph(sizingNodes, [], new Map());
		const sizes = () => (labelMap as unknown as { nodes: Array<{radius: number}> }).nodes.map(n => n.radius);
		const before = sizes();
		check(before[1]! > before[2]! && before[3] === 4, "cumulative sizes and unknown minimum reach the actual canvas in every layout");
		labelMap.adoptGraph(sizingNodes, [], new Map(), "W1");
		check(JSON.stringify(sizes()) === JSON.stringify(before), "adopting near an existing node keeps the shared citation scale");
		const scores = new Map<string, number>([["W1", 1]]);
		const scoreAt = scores.get.bind(scores);
		let layoutReads = 0;
		scores.get = id => { layoutReads++; return scoreAt(id); };
		labelMap.adoptGraph(sizingNodes, [], scores);
		check(layoutReads === 0, "adopting existing nodes must not calculate a layout that will be discarded");
		check(JSON.stringify(sizes()) === JSON.stringify(before), "filter adoption keeps citation sizes");
	}
	labelMap.setLayout("temporal");
	labelMap.setGraph([labeled("W1", "种子论文：表示学习", 2015, 100, true), labeled("W2", "基础研究：优化方法", 1990, 40, false)], [labelEdge], new Map([["W1", 1]]));
	check(labelSurface.canvas.clientWidth > 200, "the label canvas uses the production surface");
	const drawnText = (): string[] => labelDrawn.map((item) => item.text);
	const drawnX = (text: string): number => labelDrawn.find((item) => item.text === text)?.x ?? Number.NaN;
	labelDrawn.length = 0;
	labelMap.setLabelMode("author-year");
	check(drawnText().includes("Author 2015") && !drawnText().some((text) => text.includes("表示学习")), "author-year shows the author and year");
	const authorAtFit = drawnX("Author 2015");
	const yearAtFit = drawnX("2015");
	check(Number.isFinite(authorAtFit) && Number.isFinite(yearAtFit), "the author label and the year tick are both drawn");
	const fitted = labelMap.getViewState();
	labelDrawn.length = 0;
	labelMap.setViewState({ ...fitted, zoom: fitted.zoom * 1.8 });
	check(drawnX("Author 2015") !== authorAtFit && drawnX("2015") !== yearAtFit, "zoom moves the node label and the year tick");
	const zoomed = labelMap.getViewState();
	const zoomedAuthor = drawnX("Author 2015");
	labelDrawn.length = 0;
	labelMap.setViewState({ ...zoomed, centerX: zoomed.centerX + 80 });
	check(drawnX("Author 2015") !== zoomedAuthor && drawnText().includes("2015"), "pan moves the node label and keeps the year tick");
	labelDrawn.length = 0;
	labelMap.setLabelMode("title");
	check(drawnText().includes("种子论文：表示学习") && !drawnText().includes("Author 2015"), "title mode shows the title");
	labelDrawn.length = 0;
	labelMap.setLabelMode("both");
	check(drawnText().includes("Author 2015") && drawnText().includes("种子论文：表示学习"), "both mode shows the author line and the title");
	labelDrawn.length = 0;
	labelMap.setLabelMode("off");
	check(!drawnText().includes("Author 2015") && !drawnText().some((text) => text.includes("表示学习")) && drawnText().includes("2015"), "off mode draws the year tick without a node label");
	const starMap = labelMap as unknown as {
		night: boolean; reducedMotion: boolean; hoverId: string | null; selectedId: string | null;
		focus: Set<string> | null; classicGlow: Map<string, number>;
		focusStarted: number; draw: () => void;
		drawLabels: (ctx: CanvasRenderingContext2D) => void;
		labelOpacity: Map<string, { value: number; at: number }>;
		tx: number; ty: number; k: number;
		layoutMode: string; nodes: Array<{ id: string; x: number; y: number; radius: number }>;
		simAlpha: number; reheat: (alpha: number) => void;
		placeTooltip: (node: PaperNode | null, x: number, y: number) => void;
		pulsing: boolean; stopPulse: () => void; ensurePulse: () => void;
		drawNode: (ctx: CanvasRenderingContext2D, node: PaperNode & { x: number; y: number; radius: number; color: string }) => void;
	};
	const starNode = { ...labeled("W3", "Star", 2000, 10, false), x: 0, y: 0, radius: 5, color: "#58a6df" };
	const starFills: Array<{ alpha: number; style: string | CanvasGradient | CanvasPattern }> = [];
	const starRings: number[] = [];
	const originalFill = labelContext.fill.bind(labelContext);
	const originalStroke = labelContext.stroke.bind(labelContext);
	labelContext.fill = () => { starFills.push({ alpha: labelContext.globalAlpha, style: labelContext.fillStyle }); originalFill(); };
	labelContext.stroke = () => { starRings.push(labelContext.lineWidth); originalStroke(); };
	starMap.night = true;
	starMap.reducedMotion = true;
	starMap.focus = new Set(["W1"]);
	starMap.hoverId = null;
	starMap.selectedId = null;
	starMap.drawNode(labelContext, starNode);
	check(starFills.length === 2 && starFills.every(fill => fill.alpha === 0.25), "dark star halo and core both follow focus dimming");
	check(starFills.every(fill => fill.style instanceof CanvasGradient) && labelContext.globalAlpha === 1, "dark stars have no solid disk and restore drawing opacity");
	const sampleCanvas = document.createElement("canvas");
	sampleCanvas.width = sampleCanvas.height = 64;
	const sampleContext = sampleCanvas.getContext("2d")!;
	starMap.focus = null;
	starMap.drawNode(sampleContext, { ...starNode, radius: 16, x: (32 - starMap.tx) / starMap.k, y: (32 - starMap.ty) / starMap.k });
	const centerPixel = sampleContext.getImageData(32, 32, 1, 1).data;
	const colorPixel = sampleContext.getImageData(37, 32, 1, 1).data;
	const rimPixel = sampleContext.getImageData(47, 32, 1, 1).data;
	check(centerPixel[0]! > colorPixel[0]! + 50 && colorPixel[2]! > colorPixel[0]! + 50, "star has a concentrated bright nucleus and a data-colored surrounding layer");
	check(rimPixel[3]! < colorPixel[3]! / 3, "star fades before its former solid disk edge");
	const stellarPixels = ["#e08050", "#58a6df", "#48bb78", "#a078df"].map(color => {
		sampleContext.clearRect(0, 0, 64, 64);
		starMap.drawNode(sampleContext, { ...starNode, color, radius: 16, x: (32 - starMap.tx) / starMap.k, y: (32 - starMap.ty) / starMap.k });
		return Array.from(sampleContext.getImageData(35, 32, 1, 1).data);
	});
	check(stellarPixels[0]![0]! > stellarPixels[0]![2]! && stellarPixels[1]![2]! > stellarPixels[1]![0]!, "stellar cores retain warm and cool color ordering");
	check(stellarPixels[2]![1]! > stellarPixels[2]![0]! && stellarPixels[3]![2]! > stellarPixels[3]![1]!, "green and purple semantic layers remain distinct");
	starFills.length = 0;
	starMap.drawNode(labelContext, { ...starNode, x: (-200 - starMap.tx) / starMap.k });
	check(starFills.length === 0, "fully offscreen nodes skip their gradients and stellar drawing");
	starMap.drawNode(labelContext, { ...starNode, x: (-10 - starMap.tx) / starMap.k });
	check(starFills.length > 0, "stars near the viewport edge retain their visible halo");
	let tooltipReads = 0;
	Object.defineProperty(labelSurface.tooltip, "offsetWidth", { configurable: true, get: () => { tooltipReads++; return 180; } });
	Object.defineProperty(labelSurface.tooltip, "offsetHeight", { configurable: true, get: () => { tooltipReads++; return 32; } });
	starMap.placeTooltip(starNode, 20, 20);
	starMap.placeTooltip(starNode, 30, 30);
	check(tooltipReads === 2, "moving within one node reuses tooltip dimensions without layout reads");
	starMap.placeTooltip({ ...starNode, title: "Changed title" }, 30, 30);
	check(Number(tooltipReads) === 4, "changed tooltip content is measured again");
	delete (labelSurface.tooltip as unknown as { offsetWidth?: number }).offsetWidth;
	delete (labelSurface.tooltip as unknown as { offsetHeight?: number }).offsetHeight;
	starMap.reducedMotion = false;
	starMap.ensurePulse();
	check(starMap.pulsing, "dark nodes start the animation loop");
	starMap.stopPulse();
	const originalNow = performance.now;
	const originalRay = sampleContext.createLinearGradient.bind(sampleContext);
	let rayStart = 0;
	sampleContext.createLinearGradient = (x0, y0, x1, y1) => { rayStart = x0; return originalRay(x0, y0, x1, y1); };
	const rayAt = (time: number): number => {
		performance.now = () => time;
		starMap.drawNode(sampleContext, { ...starNode, isSeed: true });
		return rayStart;
	};
	try {
		check(Math.abs(rayAt(0) - rayAt(3500)) > 0.01, "bright star rays gently vary over time");
		const ordinaryAlpha = (time: number): number => {
			performance.now = () => time;
			starFills.length = 0;
			starMap.drawNode(labelContext, starNode);
			return starFills[0]!.alpha;
		};
		check(Math.abs(ordinaryAlpha(0) - ordinaryAlpha(3500)) > 0.01, "ordinary stars also twinkle slowly");
		const brightness = Array.from({ length: 15 }, (_, i) => ordinaryAlpha(i * 500));
		check(Math.max(...brightness) - Math.min(...brightness) > 0.65, "seven-second twinkle has visible brightness contrast");
		starMap.reducedMotion = true;
		check(rayAt(0) === rayAt(3500), "reduced motion keeps the stellar geometry fixed");
		check(ordinaryAlpha(0) === ordinaryAlpha(3500), "reduced motion keeps ordinary brightness fixed");
	} finally {
		performance.now = originalNow;
		sampleContext.createLinearGradient = originalRay;
	}
	starMap.reducedMotion = true;
	starMap.ensurePulse();
	check(!starMap.pulsing, "reduced motion prevents node animation");
	starRings.length = 0;
	starMap.classicGlow.set(starNode.id, 0);
	const originalClassicGradient = labelContext.createLinearGradient.bind(labelContext);
	const classicAxes: number[][] = [];
	labelContext.createLinearGradient = (x0, y0, x1, y1) => { classicAxes.push([x0, y0, x1, y1]); return originalClassicGradient(x0, y0, x1, y1); };
	starMap.drawNode(labelContext, starNode);
	labelContext.createLinearGradient = originalClassicGradient;
	const centerX = starNode.x * starMap.k + starMap.tx;
	const centerY = starNode.y * starMap.k + starMap.ty;
	check(classicAxes.length === 2 && classicAxes.every(([x0, y0, x1, y1]) => Math.abs((x0! + x1!) / 2 - centerX) < 0.01 && Math.abs((y0! + y1!) / 2 - centerY) < 0.01), "classic rays fade continuously from the stellar center");
	const lowRays = [...starRings];
	starRings.length = 0;
	starMap.classicGlow.set(starNode.id, 1);
	starMap.drawNode(labelContext, starNode);
	check(lowRays.length === 4 && starRings.length === 8 && lowRays.every(width => width >= 1), "classic rays retain four visible directions and importance adds detail");
	const zoomBeforeClassic = starMap.k;
	starMap.k = 0.3;
	starMap.classicGlow.set(starNode.id, 0);
	sampleContext.clearRect(0, 0, 64, 64);
	starMap.drawNode(sampleContext, { ...starNode, x: (32 - starMap.tx) / starMap.k, y: (32 - starMap.ty) / starMap.k });
	const pixels = sampleContext.getImageData(23, 23, 19, 19).data;
	let rayAlpha = 0;
	for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
		const distance = Math.hypot(x - 9, y - 9);
		if (distance >= 6 && distance <= 9) rayAlpha = Math.max(rayAlpha, pixels[(y * 19 + x) * 4 + 3]!);
	}
	check(rayAlpha >= 20, `a low-ranked classic remains visibly marked at overview zoom (alpha ${rayAlpha})`);
	starMap.reducedMotion = false;
	const originalLineTo = sampleContext.lineTo.bind(sampleContext);
	let classicReach = 0;
	sampleContext.lineTo = (x, y) => {
		classicReach = Math.hypot(x - (starNode.x * starMap.k + starMap.tx), y - (starNode.y * starMap.k + starMap.ty));
		originalLineTo(x, y);
	};
	try {
		const reaches: number[] = [];
		const brightness: number[] = [];
		for (let time = 0; time < 7000; time += 250) {
			performance.now = () => time;
			starFills.length = 0;
			starMap.drawNode(labelContext, starNode);
			brightness.push(starFills[0]!.alpha);
			check(starFills[0]!.alpha >= 0.6, "classic twinkle keeps a visible brightness floor");
			starMap.drawNode(sampleContext, starNode);
			reaches.push(classicReach);
		}
		check(Math.max(...reaches) - Math.min(...reaches) >= 3, "small classic rays visibly breathe by at least 3 CSS pixels");
		check(Math.max(...brightness) - Math.min(...brightness) > 0.38, "classic stars have a stronger twinkle");
	} finally {
		performance.now = originalNow;
		sampleContext.lineTo = originalLineTo;
		starMap.reducedMotion = true;
	}
	starMap.k = zoomBeforeClassic;
	const arcRadii: number[] = [];
	const originalArc = sampleContext.arc.bind(sampleContext);
	sampleContext.arc = (...args) => { arcRadii.push(args[2]); originalArc(...args); };
	const previousZoom = starMap.k;
	starMap.k = 0.3;
	starMap.drawNode(sampleContext, { ...starNode, isSeed: true });
	const distantHalo = arcRadii[0]!;
	arcRadii.length = 0;
	starMap.k = 2;
	starMap.drawNode(sampleContext, { ...starNode, isSeed: true });
	check(arcRadii[0]! > distantHalo && arcRadii[1] === starNode.radius, "zoom reveals halo detail without changing the data radius");
	starMap.k = previousZoom;
	sampleContext.arc = originalArc;
	starMap.classicGlow.delete(starNode.id);
	starMap.hoverId = starNode.id;
	starMap.drawNode(labelContext, starNode);
	check(starRings.some(width => Math.abs(width - 1.2) < 0.001), "dark hovered star has an explicit thin ring");
	starRings.length = 0;
	starMap.selectedId = starNode.id;
	starMap.drawNode(labelContext, { ...starNode, isSeed: true });
	check([1.6, 2.4].every(expected => starRings.some(width => Math.abs(width - expected) < 0.001)), "selected dark seed retains both seed and selection rings");
	starMap.night = false;
	starMap.hoverId = null;
	starMap.selectedId = null;
	starFills.length = 0;
	starMap.drawNode(labelContext, starNode);
	check(starFills.length === 1, "light ordinary node remains a solid data-colored circle");
	starMap.classicGlow.set(starNode.id, 0);
	starMap.reducedMotion = false;
	const lightArc = sampleContext.arc.bind(sampleContext);
	let lightGlowRadius = 0;
	sampleContext.arc = (...args) => { lightGlowRadius = Math.max(lightGlowRadius, args[2]); lightArc(...args); };
	try {
		const radii = Array.from({ length: 15 }, (_, i) => {
			performance.now = () => i * 250;
			lightGlowRadius = 0;
			starMap.drawNode(sampleContext, starNode);
			return lightGlowRadius;
		});
		check(Math.max(...radii) - Math.min(...radii) > 5, "light classic halo breathes over time");
	} finally {
		performance.now = originalNow;
		sampleContext.arc = lightArc;
		starMap.classicGlow.delete(starNode.id);
		starMap.reducedMotion = true;
	}
	labelContext.fill = originalFill;
	labelContext.stroke = originalStroke;
	starMap.layoutMode = "force2d";
	starMap.night = true;
	const edgeMoves: Array<{ x: number; y: number }> = [];
	const originalMove = labelContext.moveTo.bind(labelContext);
	labelContext.moveTo = (x, y) => { edgeMoves.push({ x, y }); originalMove(x, y); };
	const edgeSource = starMap.nodes.find(node => node.id === "W1")!;
	const edgeTarget = starMap.nodes.find(node => node.id === "W2")!;
	const edgeStrokes: Array<{ width: number; color: string | CanvasGradient | CanvasPattern; alpha: number }> = [];
	labelContext.stroke = () => { edgeStrokes.push({ width: labelContext.lineWidth, color: labelContext.strokeStyle, alpha: labelContext.globalAlpha }); originalStroke(); };
	for (const zoom of [0.5, 3]) {
		edgeMoves.length = 0;
		edgeStrokes.length = 0;
		labelMap.setViewState({ ...labelMap.getViewState(), zoom, selectedId: null });
		check(edgeStrokes[0]!.width >= 0.5 && edgeStrokes[0]!.width <= 1, "dark constellation outlines stay within one CSS pixel at each zoom");
		check(String(edgeStrokes[0]!.color).startsWith("rgba(155, 177, 215,"), "unfocused dark outlines use cool silver-blue");
		const start = edgeMoves[0]!;
		const tip = edgeMoves[1]!;
		check(Math.hypot(start.x - (edgeSource.x * zoom + starMap.tx), start.y - (edgeSource.y * zoom + starMap.ty)) > 0, "dark edge stops before the stellar nucleus");
		check(Math.abs(Math.hypot(tip.x - (edgeTarget.x * zoom + starMap.tx), tip.y - (edgeTarget.y * zoom + starMap.ty)) - edgeTarget.radius - 2) < 0.001, "dark arrow clearance matches the screen-space star at different zooms");
	}
	const ordinaryEdgeWidth = edgeStrokes[0]!.width;
	edgeStrokes.length = 0;
	starMap.hoverId = edgeSource.id;
	labelMap.setViewState({ ...labelMap.getViewState(), selectedId: edgeSource.id });
	check(edgeStrokes[0]!.width > ordinaryEdgeWidth && !String(edgeStrokes[0]!.color).startsWith("rgba(155, 177, 215,"), "focused constellation edges retain distinct relationship color and stronger width");
	check(edgeStrokes[0]!.width === 3 && Math.abs(edgeStrokes[0]!.alpha - 0.13) < 0.001 && edgeStrokes[0]!.color instanceof CanvasGradient, "focus has a faint broad gradient underlay");
	check(edgeStrokes[1]!.width >= 1 && edgeStrokes[1]!.width <= 1.3 && edgeStrokes[1]!.alpha === 1, "reduced motion shows the thin focus core immediately");
	labelMap.setGraph([labeled("W1", "Seed", 2015, 100, true), labeled("W2", "A", 2000, 40, false), labeled("W3", "B", 2000, 40, false), labeled("W4", "C", 2000, 40, false)], [labelEdge, { ...labelEdge, target: "W3" }, { ...labelEdge, source: "W2", target: "W3" }, { ...labelEdge, source: "W3", target: "W4" }], new Map([["W1", 1]]));
	starMap.night = true;
	starMap.hoverId = "W1";
	edgeStrokes.length = 0;
	labelMap.setSelected("W1");
	check(edgeStrokes.some(stroke => stroke.width <= 1 && stroke.alpha === 1 && String(stroke.color).startsWith("rgba(155, 177, 215,")), "neighbor-to-neighbor edges keep the ordinary outline");
	check(edgeStrokes.some(stroke => stroke.alpha === 1 && String(stroke.color).endsWith("0.035)")), "unrelated edges stay dimmed");
	check(edgeStrokes.some(stroke => Math.abs(stroke.width - 0.7) < 0.001 && Math.abs(stroke.alpha - 0.6) < 0.001), "ordinary dark citation arrows are faint open strokes");
	starMap.reducedMotion = false;
	starMap.focusStarted = performance.now();
	edgeStrokes.length = 0;
	starMap.draw();
	check(edgeStrokes[1]!.alpha < 0.6, "focus core fades in when motion is allowed");
	starMap.reducedMotion = true;
	const hubNodes = Array.from({ length: 33 }, (_, i) => labeled(`W${i + 1}`, `Hub ${i}`, 2000, 40, i === 0));
	labelMap.setGraph(hubNodes, hubNodes.slice(1).map(node => ({ ...labelEdge, target: node.id })), new Map([["W1", 1]]));
	starMap.night = true;
	starMap.hoverId = "W1";
	edgeStrokes.length = 0;
	labelMap.setSelected("W1");
	check(Math.abs(edgeStrokes[0]!.alpha - 0.065) < 0.001 && edgeStrokes[0]!.width === 3, "32-edge focus halves only the broad glow");
	check(edgeStrokes[1]!.alpha === 1 && edgeStrokes[1]!.width >= 1, "dense focus retains the legible thin core");
	starMap.hoverId = null;
	labelContext.stroke = originalStroke;
	labelContext.moveTo = originalMove;
	labelMap.setGraph([labeled("W1", "Seed", 2015, 100, true), labeled("W2", "Focus", 2000, 40, false), labeled("W3", "Other", 2000, 20, false), labeled("W4", "Tail", 2000, 1, false)], [], new Map([["W1", 1]]));
	starMap.night = true;
	starMap.nodes.forEach(node => { node.x = 0; node.y = 0; });
	labelMap.setSelected("W2");
	labelMap.setLabelMode("title");
	labelMap.setViewState({ zoom: 1, centerX: 0, centerY: 0, selectedId: "W2" });
	labelDrawn.length = 0;
	starMap.drawLabels(labelContext);
	check(labelDrawn[0]?.text === "Focus" && drawnText().includes("Seed"), "focused label is placed before the seed in a crowded group");
	const labelBoxes = labelDrawn.map(item => ({ x: item.x - 3, y: item.y - 9, w: labelContext.measureText(item.text).width + 6, h: 18 }));
	check(labelBoxes.every((box, i) => labelBoxes.slice(i + 1).every(other => box.x + box.w < other.x || other.x + other.w < box.x || box.y + box.h < other.y || other.y + other.h < box.y)), "crowded priority labels do not overlap one another");
	check(labelBoxes.every(box => starMap.nodes.every(node => box.x + box.w < node.x * starMap.k + starMap.tx - node.radius - 4 || box.x > node.x * starMap.k + starMap.tx + node.radius + 4 || box.y + box.h < node.y * starMap.k + starMap.ty - node.radius - 4 || box.y > node.y * starMap.k + starMap.ty + node.radius + 4)), "labels avoid stellar cores");
	starMap.reducedMotion = false;
	starMap.nodes.find(node => node.id === "W4")!.x = 120;
	starMap.labelOpacity.set("W4", { value: 0.15, at: performance.now() - 70 });
	labelDrawn.length = 0;
	starMap.drawLabels(labelContext);
	check((starMap.labelOpacity.get("W4")?.value ?? 0) > 0.15 && (starMap.labelOpacity.get("W4")?.value ?? 1) < 1, "ordinary label opacity eases toward its zoom target");
	starMap.reducedMotion = true;
	labelMap.setViewState({ ...labelMap.getViewState(), zoom: 8, selectedId: null });
	labelMap.zoomBy(1.2);
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
	check(Math.abs(Number(labelSurface.canvas.dataset.zoom) - labelMap.getViewState().zoom) < 0.001, "zoom updates are painted in the same animation frame");
	labelMap.setViewState({ ...labelMap.getViewState(), zoom: 8 });
	for (let tick = 0; tick < 3; tick++) labelMap.zoomBy(1.2);
	await waitFor(() => Math.abs(labelMap.getViewState().zoom - 8 * 1.2 ** 3) < 0.003, "rapid zoom inputs accumulate beyond the former 8x ceiling");
	const denseGraph = syntheticGraph(300);
	labelMap.setGraph(denseGraph.nodes, denseGraph.edges, denseGraph.seedScore);
	starMap.night = true;
	starMap.reducedMotion = true;
	const denseView = labelMap.getViewState();
	const renderTimes: number[] = [];
	const frameIntervals: number[] = [];
	starMap.reducedMotion = false;
	let previousFrame: number | undefined;
	for (let frame = 0; frame < 30; frame += 1) {
		const timestamp = await new Promise<number>(resolve => requestAnimationFrame(resolve));
		if (previousFrame !== undefined) frameIntervals.push(timestamp - previousFrame);
		previousFrame = timestamp;
		const start = performance.now();
		labelMap.setViewState({ ...denseView, centerX: denseView.centerX + frame * 2, zoom: denseView.zoom * (1 + frame / 100) });
		renderTimes.push(performance.now() - start);
	}
	renderTimes.sort((a, b) => a - b);
	frameIntervals.sort((a, b) => a - b);
	check(frameIntervals.length === 29 && frameIntervals.every(interval => interval > 0), "animated pan and zoom record real animation-frame intervals");
	document.body.dataset.starRenderMs = JSON.stringify({ nodes: denseGraph.nodes.length, edges: denseGraph.edges.length, median: renderTimes[15], p95: renderTimes[28], frameMedian: frameIntervals[14], frameP95: frameIntervals[27], visibility: document.visibilityState });
	// Pointer bursts and continuous star animation must share a paint.
	labelMap.setLayout("force2d");
	starMap.reheat(0.55);
	check(starMap.simAlpha > 0, "node dragging reheats force simulation");
	labelMap.setLayout("radial");
	check(starMap.simAlpha === 0, "switching layout stops the previous force simulation");
	starMap.night = true;
	starMap.reducedMotion = false;
	(labelMap as unknown as { ensurePulse(): void }).ensurePulse();
	const paint = labelContext.clearRect.bind(labelContext);
	let dragPaints = 0;
	labelContext.clearRect = (...args) => { dragPaints++; paint(...args); };
	const canvasRect = labelSurface.canvas.getBoundingClientRect();
	const pointer = (type: string, x: number) => new PointerEvent(type, { pointerId: 97, button: 0, buttons: 1, clientX: canvasRect.left + x, clientY: canvasRect.top + 4, bubbles: true });
	labelSurface.canvas.dispatchEvent(pointer("pointerdown", 4));
	const dragStart = performance.now();
	for (let frame = 0; frame < 12; frame++) {
		for (let event = 0; event < 5; event++) labelSurface.canvas.dispatchEvent(pointer("pointermove", 4 + frame * 3 + event));
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
	}
	window.dispatchEvent(pointer("pointerup", 45));
	labelContext.clearRect = paint;
	document.body.dataset.dragRender = JSON.stringify({ frames: 12, events: 60, paints: dragPaints, elapsed: performance.now() - dragStart });
	check(dragPaints <= 14, `pointer input and star animation share a frame: ${dragPaints} paints for 12 frames`);
	const foundationNodes = [labeled("W1", "Seed", 2015, 10, true), labeled("W2", "Foundation", 1981, 4500, false), labeled("W3", "Citer", 2024, 10, false)];
	const foundationLists = new Map([["W1", ["W2"]], ["W3", ["W2"]]]);
	labelMap.setGraph(foundationNodes, [], new Map(), foundationLists);
	check(starMap.classicGlow.has("W2"), "canvas marks long-term classics without drawn edges or percentiles");
	labelMap.adoptGraph(foundationNodes, [], new Map(), undefined, false, foundationLists);
	check(starMap.classicGlow.has("W2"), "adopting a graph retains its classic evidence");
	labelMap.updateGraphData([], new Map());
	check(starMap.classicGlow.has("W2"), "citation list changes do not change cumulative citation qualification");
	labelMap.setGraph([labeled("W2", "Language Universals and Linguistic Typology", 1981, 1390, false), labeled("W3", "Linguistic Diversity in Space and Time", 1992, 1664, false), { ...labeled("W4", "The Minimalist Program", 2014, 8245, false), normalizedCitation: { percentile: 0.999, top1Percent: true } }], [], new Map());
	check(starMap.classicGlow.size === 3, "all three books qualify through long-term citation accumulation");
	labelMap.destroy();
	labelHost.remove();
	const motionHost = document.createElement("div");
	motionHost.className = "cpo-surface";
	motionHost.style.setProperty("--background-primary", "oklch(pow(0.235, calc(1 / 1)) 0 285)");
	document.body.append(motionHost);
	const previousMatch = window.matchMedia.bind(window);
	window.matchMedia = ((query: string) => query.includes("prefers-reduced-motion")
		? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
		: previousMatch(query)) as typeof window.matchMedia;
	try {
		const reducedSurface = mountGraphSurface(motionHost, { canvasLabel: "reduced", title: "", hint: "" });
		const reducedMap = new SimilarityMap(reducedSurface.canvas, reducedSurface.tooltip, reducedSurface.stage);
		reducedMap.resize();
		reducedMap.setGraph([starNode], [], new Map());
		const coloredState = reducedMap as unknown as { nodes: Array<{ color: string }> };
		const clusterColor = (): string | undefined => coloredState.nodes[0]?.color;
		check(clusterColor() === "#969be8", "dark default cluster nodes match the blue-violet legend");
		motionHost.style.setProperty("--background-primary", "#ffffff");
		reducedMap.resize();
		check(clusterColor() === "rgb(214, 142, 142)", "theme changes restore the original light cluster color");
		const reducedState = reducedMap as unknown as { reducedMotion: boolean; pulsing: boolean };
		check(reducedState.reducedMotion && !reducedState.pulsing, "system reduced motion keeps node animation stopped without a pause button");
		reducedMap.destroy();
	} finally {
		window.matchMedia = previousMatch as typeof window.matchMedia;
		motionHost.remove();
	}
	handle.destroy();
	const writesAtClose = projectWrites;
	root.style.width = "400px";
	const reopened = mountGraphApp(root, {
		...workflow,
		getSettings: () => settings,
		getJson: fixtureGet,
		openExternal(url) { openedUrl = url; },
		saveProject,
		stagePaper: async () => {
			if (failSave) throw new Error("disk full");
			favoriteWrites += 1;
		},
		persistSettings: async () => { if (failSave) throw new Error("disk full"); },
		loadSavedProject: () => Object.values(settings.researchProjects)[0] ?? null,
	});
	check(root.querySelector(".cpo-status")?.textContent?.includes("已恢复"), "reopening shows the saved project");
	check(projectWrites === writesAtClose, "reopening does not save");
	const reopenedCanvas = root.querySelector<HTMLCanvasElement>("canvas")!;
	const reopenedZoom = reopenedCanvas.dataset.zoom;
	const reopenedSelected = reopenedCanvas.dataset.selected;
	check(root.classList.contains("is-detail-cover"), "reopened narrow detail covers the graph");
	root.querySelector<HTMLButtonElement>(".cpo-detail-return")!.click();
	check(reopenedCanvas.dataset.zoom === reopenedZoom && reopenedCanvas.dataset.selected === reopenedSelected, "return after narrow reopen preserves the restored view");
	window.dispatchEvent(new Event("research-connected-project"));
	window.dispatchEvent(new Event("research-connected-settings"));
	check(projectWrites === writesAtClose, "a project or settings notice does not save");
	reopened.destroy();
	await verifyProjectBrowser();
	await verifyExportBrowser();
	check(uncaught.length === 0, `no uncaught browser errors: ${uncaught.map(String).join(", ")}`);
	document.body.textContent = "PASS: reading persistence and rollback, visible path search, invalid and valid endpoints, hidden controls, rename exit, abstract clamp, empty export, full graph, continuous star motion, node labels, rapid zoom, narrow return, reopen, cleanup";
	document.body.dataset.result = "passed";
}

async function verifyCopyUi(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app")!;
	const waitFor = async (ready: () => boolean): Promise<void> => {
		const start = performance.now();
		while (!ready()) {
			check(performance.now() - start < 15000, "copy UI check timed out");
			await new Promise(resolve => setTimeout(resolve, 40));
		}
	};
	const stripAbstracts = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(stripAbstracts);
		return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "abstract_inverted_index").map(([key, item]) => [key, stripAbstracts(item)]));
	};
	for (const embedded of [false, true]) {
		root.replaceChildren();
		let failLookup = true;
		let lookupRequests = 0;
		const getJson: GetJson = async (url, init) => {
			if (url.includes("semanticscholar")) {
				lookupRequests++;
				if (failLookup) throw new Error("HTTP 429 copy-test");
				return { abstract: "Recovered abstract for copy test" };
			}
			if (url.includes("crossref")) return { message: {} };
			return stripAbstracts(await fixtureGet(url, init));
		};
		const settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS, s2Reconcile: false, semanticScholarApiKey: embedded ? "copy-test-embed" : "copy-test-pane", researchProjects: {} };
		const cleanup = embedded
			? mountEmbed(root, { source: "doi: 10.1234/seed", getSettings: () => settings, getJson, openExternal: () => {} })
			: mountGraphApp(root, {
				initialDoi: "10.1234/seed", getSettings: () => settings, getJson, openExternal: () => {},
				persistSettings: () => {},
				saveProject: (project, key) => { settings.researchProjects[key ?? project.seedId] = project; },
			}).destroy;
		try {
			await waitFor(() => Boolean(root.querySelector(".cpo-status-details")));
			const expand = root.querySelector<HTMLButtonElement>(".cpo-panel-toggle.is-right");
			if (expand?.getAttribute("aria-label")?.includes("Expand")) expand.click();
			await waitFor(() => Boolean(root.querySelector(".cpo-abstract")?.textContent?.includes("HTTP 429")));
			const retry = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(button => /Retry abstract lookup|重试获取摘要/.test(button.textContent ?? ""));
			check(retry, "both pane and embed expose abstract retry after a failed request");
			check(!root.querySelector(".cpo-abstract")?.textContent?.includes("都没有"), "errors do not imply absent provider abstracts");
			check(lookupRequests === 1, "failed abstract lookup does not loop during redraw");
			failLookup = false;
			retry.click();
			await waitFor(() => root.querySelector(".cpo-abstract")?.textContent?.includes("Recovered abstract") === true);
			check(Number(lookupRequests) === 2, "explicit retry makes another provider request");
			check(root.querySelector(".cpo-abstract")?.textContent?.includes("Semantic Scholar"), "recovered abstract retains source attribution");
			const diagnostic = root.querySelector<HTMLDetailsElement>(".cpo-status-details")!;
			diagnostic.querySelector<HTMLElement>("summary")!.click();
			check(diagnostic.open && diagnostic.querySelector("p")!.getBoundingClientRect().height > 0, "sampling diagnostics expand visibly");
			const box = diagnostic.querySelector("p")!.getBoundingClientRect();
			check(box.left >= 0 && box.right <= innerWidth, `sampling diagnostics remain inside the viewport: ${box.left}–${box.right}/${innerWidth}`);
			const buttons = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]')).map(button => button.textContent);
			check(buttons.some(text => text === "Frequently cited references" || text === "图内常引文献"), "aggregate title names citation evidence rather than prior knowledge");
			check(buttons.some(text => text === "Works citing this graph" || text === "引用本图的文献"), "aggregate title does not imply derivative research");
			console.log(`Copy and abstract retry UI passed: ${embedded ? "embed" : "pane"}`);
		} finally { cleanup(); }
	}
}

void verify().catch((error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.dataset.result = "failed";
});
