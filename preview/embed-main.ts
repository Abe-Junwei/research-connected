import "../src/host-language";
import { mountEmbed } from "../src/embed-mount";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../src/settings-model";
import { nicholsSnapshot, workIdentityFixtureGet } from "./work-identity-fixture";
import { normalizeProjects } from "../src/project-state";
import { fixtureGet } from "./fixture";
import { createReadingWorkflow, normalizeReadingWorkflow } from "../src/reading-workflow";

const root = document.querySelector("#embed");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #embed");
}

const getJson: GetJson = async (url, init) => {
	const response = await window.fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const params = new URLSearchParams(window.location.search);
const identity = params.has("identity");
const doi = params.get("doi") || (identity ? "10.1353/lan.1986.0014" : "10.1038/nature14539");
const position = params.get("position") || "inline";
const labels = params.get("labels") || "author-year";
const width = params.get("width");
const layout = params.get("layout");
const offline = params.has("fixture");
const lines = [`doi: ${doi}`, "height: 640", `position: ${position}`, `labels: ${labels}`];
if (width) lines.push(`width: ${width}`);
if (layout) lines.push(`layout: ${layout}`);

const storageKey = identity ? "research-connected-preview-identity-settings" : "research-connected-preview-settings";
const legacyStorageKey = identity ? "research-connected-preview-identity-projects" : "research-connected-preview-projects";
const settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS, researchProjects: {} };
try {
	const saved = window.localStorage.getItem(storageKey);
	if (saved) Object.assign(settings, JSON.parse(saved));
	settings.researchProjects = normalizeProjects(saved ? settings.researchProjects : JSON.parse(window.localStorage.getItem(legacyStorageKey) ?? "{}"));
	settings.readingWorkflow = normalizeReadingWorkflow(settings.readingWorkflow);
} catch { /* Invalid preview storage does not prevent opening a graph. */ }
if (identity && !Object.keys(settings.researchProjects).length) settings.researchProjects = normalizeProjects({ W4245234602: { version: 1, seedId: "W4245234602", name: "Nichols 1986", updatedAt: 1, views: [], snapshot: nicholsSnapshot() } });
const persistSettings = (): void => {
	window.localStorage.setItem(storageKey, JSON.stringify(settings));
	window.dispatchEvent(new Event("research-connected-project"));
};

mountEmbed(root, {
	...createReadingWorkflow({ getSettings: () => settings, persist: persistSettings }),
	source: lines.join("\n"),
	getSettings: () => settings,
	stagePaper: persistSettings,
	getJson: identity ? workIdentityFixtureGet : offline ? fixtureGet : getJson,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
});
