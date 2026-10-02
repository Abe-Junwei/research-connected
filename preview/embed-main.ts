import { mountEmbed } from "../src/embed-mount";
import { explainStatus, OpenAlexError, type GetJson } from "../src/openalex";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet } from "./fixture";

const root = document.querySelector("#embed");
if (!(root instanceof HTMLElement)) {
	throw new Error("Missing #embed");
}

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const params = new URLSearchParams(window.location.search);
const doi = params.get("doi") || "10.1038/nature14539";
const position = params.get("position") || "inline";
const labels = params.get("labels") || "author-year";
const width = params.get("width");
const offline = params.has("fixture");
const lines = [`doi: ${doi}`, "height: 640", `position: ${position}`, `labels: ${labels}`];
if (width) lines.push(`width: ${width}`);

mountEmbed(root, {
	source: lines.join("\n"),
	getSettings: () => ({ ...DEFAULT_SETTINGS }),
	getJson: offline ? fixtureGet : getJson,
	openExternal: (url) => {
		const safe = allowedExternalUrl(url);
		if (safe) window.open(safe, "_blank", "noopener,noreferrer");
	},
});
