import { mountGraphApp } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet, fixturePost } from "./fixture";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #app");
}

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const demo = new URLSearchParams(window.location.search).has("demo");
const offline = new URLSearchParams(window.location.search).has("fixture");
const llm = offline && new URLSearchParams(window.location.search).has("llm");
const previewSettings = { ...DEFAULT_SETTINGS, researchProjects: { ...DEFAULT_SETTINGS.researchProjects } };
try {
	const saved = localStorage.getItem("research-connected-preview-projects");
	if (saved) previewSettings.researchProjects = JSON.parse(saved);
} catch { /* Preview remains usable if storage is unavailable or malformed. */ }

mountGraphApp(root, {
	getSettings: () => ({ ...previewSettings, llmEnabled: llm, llmEndpoint: llm ? "https://example.test/chat/completions" : "", llmModel: llm ? "fixture" : "" }),
	saveProject: (project) => {
		previewSettings.researchProjects[project.seedId] = project;
		localStorage.setItem("research-connected-preview-projects", JSON.stringify(previewSettings.researchProjects));
	},
	getJson: offline ? fixtureGet : getJson,
	postJson: offline ? fixturePost : undefined,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
	initialDoi: demo || offline ? EXAMPLE_DOI : undefined,
});
