import "../src/host-language";
import { mountGraphApp } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { browserGetJson, browserPostJson } from "./http";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { nicholsSnapshot, workIdentityFixtureGet } from "./work-identity-fixture";
import { normalizeProjects } from "../src/project-state";
import { createReadingWorkflow, normalizeReadingWorkflow } from "../src/reading-workflow";
import { fixtureGet, fixturePost } from "./fixture";
import { revalidateWebSettings, writeWebSettings, commitWebRevalidation } from "./revalidate";
import { prepareWebSettings, checkWebMetadata, prepareWebGraph, decorateWebExport } from "./quality";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #app");
}

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
if (!offline) prepareWebSettings(previewSettings);
const persistSettings = (): void => {
	if (!offline) prepareWebSettings(previewSettings);
	writeWebSettings(storageKey, previewSettings);
	window.dispatchEvent(new Event("research-connected-project"));
};

Object.assign(previewSettings, { llmEnabled: llm, llmEndpoint: llm ? "https://example.test/chat/completions" : "", llmModel: llm ? "fixture" : "" });
async function start(): Promise<void> {
	const host = root as HTMLElement;
	if (!offline && !identity) host.textContent = "正在核对本地项目的文献来源… / checking saved sources…";
	const review = !offline && !identity ? await revalidateWebSettings(previewSettings, browserGetJson, next => commitWebRevalidation(storageKey, next)) : null;
	host.replaceChildren();
	mountGraphApp(host, {
		...createReadingWorkflow({ getSettings: () => previewSettings, persist: persistSettings }),
		getSettings: () => previewSettings,
		saveProject: (project, projectKey) => {
			previewSettings.researchProjects[projectKey ?? project.seedId] = project;
			persistSettings();
		},
		persistSettings,
		loadSavedProject: () => Object.values(previewSettings.researchProjects).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
		getJson: identity ? workIdentityFixtureGet : offline ? fixtureGet : browserGetJson,
		postJson: offline ? fixturePost : browserPostJson,
		prepareGraph: offline || identity ? undefined : graph => [review?.notice, prepareWebGraph(graph)].filter(Boolean).join("\n") || null,
		decorateExport: offline || identity ? undefined : (papers, text, format) => decorateWebExport(papers, text, format, review?.complete === false),
		checkMetadata: offline ? undefined : paper => checkWebMetadata(paper, browserGetJson),
		openExternal: (url) => {
			const safe = allowedExternalUrl(url);
			if (safe) window.open(safe, "_blank", "noopener,noreferrer");
		},
		initialDoi: identity ? "10.2307/415601" : demo || offline ? EXAMPLE_DOI : undefined,
	});
}
void start();
