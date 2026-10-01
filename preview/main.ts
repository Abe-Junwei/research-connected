import { mountGraphApp } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";

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

mountGraphApp(root, {
	getSettings: () => ({ ...DEFAULT_SETTINGS }),
	getJson,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
	initialDoi: demo ? EXAMPLE_DOI : undefined,
});
