import "../src/host-language";
import { mountGraphApp } from "../src/app";
import { createChromeIcon } from "../src/graph-chrome";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet } from "../preview/fixture";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function verify(): Promise<void> {
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
	const root = document.querySelector<HTMLElement>("#app")!;
	const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: {} };
	let failSave = false;
	let openedUrl = "";
	let favoriteWrites = 0;
	const handle = mountGraphApp(root, {
		getSettings: () => settings,
		getJson: fixtureGet,
		openExternal(url) { openedUrl = url; },
		stagePaper: async () => {
			if (failSave) throw new Error("disk full");
			favoriteWrites += 1;
		},
		initialDoi: "10.1234/seed",
		persistSettings: async () => { if (failSave) throw new Error("disk full"); },
	});
	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error("graph did not load")); }, 5000);
		const observer = new MutationObserver(() => {
			if (root.querySelector(".cpo-paper-reading-select")) {
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
	const clearRect = context.clearRect.bind(context);
	context.clearRect = (x, y, width, height) => {
		yearPositions.clear();
		clearRect(x, y, width, height);
	};
	context.fillText = (text, x, y, maxWidth) => {
		if (/^\d{4}$/.test(text)) yearLabels.push(y);
		if (/^\d{4}$/.test(text)) yearPositions.set(Number(text), x);
		if (maxWidth === undefined) fillText(text, x, y);
		else fillText(text, x, y, maxWidth);
	};
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
		yearPositions.clear();
		canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
		check(yearPositions.size > 0, "zoom and pan redraw year ticks");
		checkYearBars();
	}
	context.fillText = fillText;
	context.clearRect = clearRect;
	const yearBand = root.querySelector<HTMLElement>(".cpo-year-band")!.getBoundingClientRect();
	check(yearLabels.length > 0 && yearLabels.every((y) => y < yearBand.top - canvas.getBoundingClientRect().top), "year ticks render above the bottom controls");
	check(seedSummary.parentElement === stage, "seed information lives inside the canvas");
	check(Math.abs(seedSummary.getBoundingClientRect().left - stage.getBoundingClientRect().left - 16) < 2, "seed information stays at the canvas left edge");
	const saveProject = root.querySelector<HTMLElement>(".cpo-project-save")!;
	const exportMenu = root.querySelector<HTMLElement>(".cpo-export-menu")!;
	check(exportMenu.closest(".cpo-workspace-tools") === saveProject.nextElementSibling, "export follows save project");
	check(exportMenu.getBoundingClientRect().left >= saveProject.getBoundingClientRect().right, "export sits to the right of save project");
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
	const sourceLink = identity.querySelector<HTMLButtonElement>(".cpo-card-title .cpo-paper-title-source")!;
	check(sourceLink?.textContent?.includes("OpenAlex"), "OpenAlex link follows the paper title");
	check(!identity.querySelector(".cpo-paper-sources")?.textContent?.includes("OpenAlex"), "OpenAlex is not duplicated in the action row");
	sourceLink.click();
	check(openedUrl.startsWith("https://openalex.org/"), "title link opens the original OpenAlex URL");
	const favorite = identity.querySelector<HTMLButtonElement>(".cpo-paper-stage")!;
	check(favorite.nextElementSibling?.classList.contains("cpo-paper-exclude"), "favorite appears immediately before exclude");
	check(String(favorite.textContent) === "收藏", "save action is labeled favorite");
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "true" && String(favorite.textContent) === "已收藏" && favoriteWrites === 1, "favorite reuses persisted staged state");
	failSave = true;
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "true" && !favorite.disabled, "failed favorite removal rolls back");
	failSave = false;
	favorite.click();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(favorite.getAttribute("aria-pressed") === "false" && String(favorite.textContent) === "收藏", "favorite can be removed");
	const reading = root.querySelector<HTMLSelectElement>(".cpo-paper-reading-select")!;
	reading.value = "read";
	reading.dispatchEvent(new Event("change"));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(reading.value === "read" && !reading.disabled, "reading state must save and re-enable");
	failSave = true;
	reading.value = "unread";
	reading.dispatchEvent(new Event("change"));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	check(reading.value === "read" && !reading.disabled, "failed reading save must roll back");
	failSave = false;
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
	handle.destroy();
	document.body.textContent = "PASS: reading persistence and rollback, visible path search, invalid and valid endpoints, hidden controls, cleanup";
	document.body.dataset.result = "passed";
}

void verify().catch((error: unknown) => {
	document.body.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
	document.body.dataset.result = "failed";
});
