import { emptyFilter } from "../src/graph-filter";
import { mountGraphApp } from "../src/app";
import { SimilarityMap } from "../src/map-canvas";
import { saveGraphSnapshot, type ResearchProject } from "../src/project-state";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { syntheticGraph } from "./perf-fixture";
import { fixtureGet } from "../preview/fixture";

export async function verifyProjectSwitchPerformanceBrowser(): Promise<void> {
	const graph = syntheticGraph(150);
	const snapshot = saveGraphSnapshot(graph);
	const alternate = structuredClone(snapshot);
	alternate.seedId = alternate.nodes[1]!.id;
	for (const paper of [...alternate.nodes, ...alternate.catalog]) paper.isSeed = paper.id === alternate.seedId;
	const make = (name: string, saved: typeof snapshot): ResearchProject => ({ version: 1, seedId: saved.seedId, name, updatedAt: 1, views: [], snapshot: saved, currentView: { name: "View", layout: "force2d", scrubYear: null, zoom: 1, centerX: 0, centerY: 0, selectedId: null, rightCollapsed: true, updatedAt: 1 } });
	const settings = { ...structuredClone(DEFAULT_SETTINGS), maxNodes: 150, researchProjects: { A: make("Project A", snapshot), B: make("Project B", alternate) } as Record<string, ResearchProject> };
	settings.researchProjects.C = make("Project C", alternate);
	settings.researchProjects.C.currentView!.layout = "temporal";
	settings.researchProjects.C.currentView!.filter = { ...emptyFilter(), language: "en" };
	const host = document.createElement("div"); host.style.cssText = "width:1200px;height:800px"; document.body.append(host);
	const proto = SimilarityMap.prototype as unknown as { rebuild(this: { layoutMode: string }, ...args: unknown[]): void };
	const rebuild = proto.rebuild;
	let measuring = false, layouts = 0, layoutMs = 0;
	proto.rebuild = function (...args) {
		const start = performance.now();
		rebuild.apply(this, args);
		if (measuring && this.layoutMode === "force2d") { layouts++; layoutMs += performance.now() - start; }
	};
	let requests = 0;
	const app = mountGraphApp(host, { getSettings: () => settings, getJson: async (url, options) => { requests++; return fixtureGet(url, options); }, openExternal() {}, loadSavedProject: () => settings.researchProjects.A!, saveProject(project, key = project.seedId) { settings.researchProjects[key] = project; } });
	const results: Array<{ project: string; elapsedMs: number; layouts: number; layoutMs: number }> = [];
	try {
		for (const name of ["Project B", "Project A", "Project C"]) {
			layouts = 0; layoutMs = 0; measuring = true;
			const start = performance.now();
			const button = Array.from(host.querySelectorAll<HTMLButtonElement>(".cpo-menu-switch")).find(button => button.textContent === name)!;
			button.click();
			for (let index = 0; index < 100 && host.querySelector(".cpo-menu-name")?.textContent !== name; index++) await new Promise(resolve => setTimeout(resolve, 5));
			measuring = false;
			if (host.querySelector(".cpo-menu-name")?.textContent !== name) throw new Error("Project switch did not complete");
			results.push({ project: name, elapsedMs: performance.now() - start, layouts, layoutMs });
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
			if (Math.abs(Number(host.querySelector<HTMLCanvasElement>("canvas")!.dataset.zoom) - 1) > 0.001) throw new Error("Project switch lost the saved camera");
			if (name === "Project C" && host.querySelector('[data-layout="temporal"]')?.getAttribute("aria-pressed") !== "true") throw new Error("Saved year layout was not restored");
		}
		if (requests) throw new Error("Restoring saved projects must not fetch providers");
		document.body.dataset.projectSwitchPerf = JSON.stringify(results);
		if (results.some(result => result.layouts !== (result.project === "Project C" ? 0 : 1))) throw new Error(`A saved project should compute its layout once: ${JSON.stringify(results)}`);
	} finally { measuring = false; proto.rebuild = rebuild; app.destroy(); host.remove(); }
}
