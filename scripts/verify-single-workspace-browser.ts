import { SimilarityMap } from "../src/map-canvas";
import { mountGraphApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { saveGraphSnapshot, type ResearchProject } from "../src/project-state";
import { syntheticGraph } from "./perf-fixture";
import { fixtureGet } from "../preview/fixture";
import { EXAMPLE_DOI } from "../src/constants";
import { createWebSettingsStore } from "../web/project-store";
import { clearWorkspaceRecords } from "../web/workspace";

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
export async function verifySingleWorkspaceBrowser(): Promise<void> {
 const settings = structuredClone(DEFAULT_SETTINGS);
 settings.s2Reconcile = false; settings.semanticEmbedding = false;
 const snapshot = saveGraphSnapshot(syntheticGraph(12));
 const original: ResearchProject = { version: 1, seedId: snapshot.seedId, name: "Old", updatedAt: 1, views: [], snapshot };
 settings.researchProjects = { [original.seedId]: original };
 const storageKey = "research-connected-autosave-regression";
 localStorage.setItem(storageKey, JSON.stringify(settings));
 const store = createWebSettingsStore(storageKey, settings, () => {});
 let reusedSnapshot = false;
 let failSave = false, noNeighbors = false, blocked = false, saves = 0;
 const host = document.createElement("div"); host.style.cssText = "width:1100px;height:750px"; document.body.append(host);
 const deps = {
  singleWorkspace: true, getSettings: () => settings, canMutate: () => !blocked,
  loadSavedProject: () => Object.values(settings.researchProjects)[0] ?? null,
  saveProject: async (project: ResearchProject) => { if (failSave) throw new Error("storage full"); saves++; reusedSnapshot = project.snapshot === Object.values(settings.researchProjects)[0]?.snapshot; settings.researchProjects = { [project.seedId]: project }; await store.persist(); window.dispatchEvent(new CustomEvent("research-connected-project", { detail: { localProjectSave: true } })); },
  clearWorkspace: async () => { clearWorkspaceRecords(settings); }, confirmChoice: async () => true,
  getJson: async (url: string, options: { headers: Record<string, string> }) => {
   const value = await fixtureGet(url, options);
   if (!noNeighbors) return value;
   const data = value as Record<string, unknown>;
   return Array.isArray(data.results) ? { ...data, results: [], meta: { count: 0 } } : { ...data, referenced_works: [], related_works: [], cited_by_count: 0 };
  }, openExternal() {},
 };
 let app = mountGraphApp(host, deps);
 const seedTitle = () => host.querySelector(".cpo-seed-title")?.textContent;
 const canvas = () => host.querySelector<HTMLCanvasElement>("canvas")!;
 const build = async () => {
  const input = host.querySelector<HTMLInputElement>(".cpo-bar input")!;
  input.value = EXAMPLE_DOI;
  const button = host.querySelector<HTMLButtonElement>(".cpo-form button[type=submit]")!;
  button.click();
  for (let index = 0; index < 600 && button.disabled; index++) await new Promise(resolve => setTimeout(resolve, 10));
  check(!button.disabled, "Build did not finish");
 };
 try {
  check(!host.querySelector(".cpo-project-menu"), "Project menu remains");
  check(host.querySelector<HTMLButtonElement>(".cpo-project-save")?.hidden, "Save button remains");
  check(canvas().dataset.nodes === undefined || canvas().dataset.nodes !== "0", "Restore is empty");
  canvas().dispatchEvent(new Event("pointerup"));
  await new Promise(resolve => setTimeout(resolve, 600));
  check(!/正在自动保存|Autosaving/.test(host.querySelector(".cpo-workspace-state")?.textContent ?? ""), "Completed autosave remains stuck after store normalizes and notifies the graph");
  const originalSaved = JSON.stringify(settings.researchProjects[original.seedId]);
  const title = seedTitle(); const zoom = canvas().dataset.zoom;
  noNeighbors = true; await build();
  check(JSON.stringify(settings.researchProjects[original.seedId]) === originalSaved && seedTitle() === title, "Seed-only result replaced old graph");
  noNeighbors = false; failSave = true; await build();
  check(JSON.stringify(settings.researchProjects[original.seedId]) === originalSaved && seedTitle() === title && canvas().dataset.zoom === zoom, "Failed save replaced old graph or camera");
  failSave = false; await build();
  check(saves > 0 && Object.keys(settings.researchProjects).length === 1 && !settings.researchProjects[original.seedId], "Successful build did not replace the single slot");
  const newSeed = Object.values(settings.researchProjects)[0]!.seedId;
  const savesBeforeAutosave = saves;
  const adopt = SimilarityMap.prototype.adoptGraph;
  let autosaveAdoptions = 0;
  SimilarityMap.prototype.adoptGraph = function (...args) { autosaveAdoptions++; return adopt.apply(this, args); };
  canvas().dispatchEvent(new Event("pointerup"));
  await new Promise(resolve => setTimeout(resolve, 600));
  SimilarityMap.prototype.adoptGraph = adopt;
  check(autosaveAdoptions === 0, `Camera autosave unnecessarily rebuilds graph ${autosaveAdoptions} times`);
  check(saves > savesBeforeAutosave && !/正在自动保存|Autosaving/.test(host.querySelector(".cpo-workspace-state")?.textContent ?? ""), "Completed autosave remains stuck on a newly built graph after store notification");
  canvas().dispatchEvent(new Event("pointerup"));
  await new Promise(resolve => setTimeout(resolve, 600));
  check(reusedSnapshot, "Camera-only save recreated an unchanged graph snapshot");
  failSave = true;
  canvas().dispatchEvent(new Event("pointerup"));
  await new Promise(resolve => setTimeout(resolve, 550));
  const retry = host.querySelector<HTMLButtonElement>(".cpo-project-save")!;
  check(!retry.hidden && /重试|Retry/.test(retry.textContent ?? "") && /未保存|Not saved/.test(host.textContent ?? ""), "Autosave failure has no retry status");
  failSave = false; retry.click(); await new Promise(resolve => setTimeout(resolve, 10));
  check(retry.hidden, "Retry did not recover autosave");
  app.destroy(); host.replaceChildren(); app = mountGraphApp(host, deps);
  check(host.querySelector<HTMLInputElement>(".cpo-bar input")?.value === newSeed, "New workspace did not restore");
  const clear = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => /清空画布|Clear canvas/.test(button.textContent ?? ""))!;
  blocked = true; clear.click(); await new Promise(resolve => setTimeout(resolve, 0));
  check(Object.keys(settings.researchProjects).length === 1, "Read-only tab cleared workspace");
  blocked = false; clear.click(); await new Promise(resolve => setTimeout(resolve, 0));
  check(Object.keys(settings.researchProjects).length === 0, "Clear failed");
  app.destroy(); host.replaceChildren(); app = mountGraphApp(host, deps);
  check(!host.querySelector(".cpo-project-menu") && !host.querySelector<HTMLInputElement>(".cpo-bar input")?.value, "Cleared graph resurrected");
 } finally { app.destroy(); host.remove(); localStorage.removeItem(storageKey); }
}
