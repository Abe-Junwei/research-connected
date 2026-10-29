import "../src/host-language";
import { mountGraphApp } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { nicholsSnapshot, workIdentityFixtureGet } from "./work-identity-fixture";
import { normalizeProjects } from "../src/project-state";
import { createReadingWorkflow, normalizeReadingWorkflow } from "../src/reading-workflow";
import { fixtureGet, fixturePost } from "./fixture";
import { writePreviewSettings } from "./storage";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #app");
}

const getJson: GetJson = async (url, init) => {
	const response = await window.fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const demo = new URLSearchParams(window.location.search).has("demo");
const identity = new URLSearchParams(window.location.search).has("identity");
const offline = identity || new URLSearchParams(window.location.search).has("fixture");
const storageKey = identity ? "research-connected-preview-identity-settings" : "research-connected-preview-settings";
const legacyStorageKey = identity ? "research-connected-preview-identity-projects" : "research-connected-preview-projects";
const llm = offline && new URLSearchParams(window.location.search).has("llm");
const previewSettings = { ...DEFAULT_SETTINGS, researchProjects: { ...DEFAULT_SETTINGS.researchProjects } };
try {
	const saved = window.localStorage.getItem(storageKey);
	if (saved) Object.assign(previewSettings, JSON.parse(saved));
	previewSettings.researchProjects = normalizeProjects(saved ? previewSettings.researchProjects : JSON.parse(window.localStorage.getItem(legacyStorageKey) ?? "{}"));
	previewSettings.readingWorkflow = normalizeReadingWorkflow(previewSettings.readingWorkflow);
} catch { /* Preview remains usable if storage is unavailable or malformed. */ }

if (identity && !Object.keys(previewSettings.researchProjects).length) previewSettings.researchProjects = normalizeProjects({ W4245234602: { version: 1, seedId: "W4245234602", name: "Nichols 1986", updatedAt: 1, views: [], snapshot: nicholsSnapshot() } });
const persistSettings = (): void => {
	writePreviewSettings(storageKey, previewSettings, legacyStorageKey);
	window.dispatchEvent(new Event("research-connected-project"));
};

Object.assign(previewSettings, { llmEnabled: llm, llmEndpoint: llm ? "https://example.test/chat/completions" : "", llmModel: llm ? "fixture" : "" });
mountGraphApp(root, {
	...createReadingWorkflow({ getSettings: () => previewSettings, persist: persistSettings }),
	getSettings: () => previewSettings,
	saveProject: (project, projectKey) => {
		previewSettings.researchProjects[projectKey ?? project.seedId] = project;
		persistSettings();
	},
	persistSettings,
	loadSavedProject: () => Object.values(previewSettings.researchProjects).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
	getJson: identity ? workIdentityFixtureGet : offline ? fixtureGet : getJson,
	postJson: offline ? fixturePost : undefined,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
	initialDoi: identity ? "10.2307/415601" : demo || offline ? EXAMPLE_DOI : undefined,
});
