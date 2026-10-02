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

mountGraphApp(root, {
	getSettings: () => ({ ...DEFAULT_SETTINGS, llmEnabled: llm, llmEndpoint: llm ? "https://example.test/chat/completions" : "", llmModel: llm ? "fixture" : "" }),
	getJson: offline ? fixtureGet : getJson,
	postJson: offline ? fixturePost : undefined,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
	initialDoi: demo || offline ? EXAMPLE_DOI : undefined,
});
