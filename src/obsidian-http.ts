import { requestUrl } from "obsidian";
import { explainStatus, OpenAlexError, type GetJson } from "./openalex";

/** OpenAlex GET via Obsidian's requestUrl so the embed and the pane share one path. */
export const obsidianGetJson: GetJson = async (url, init) => {
	let response;
	try {
		response = await requestUrl({
			url,
			method: "GET",
			headers: init.headers,
			throw: false,
		});
	} catch {
		throw new OpenAlexError(explainStatus(undefined));
	}
	if (response.status >= 400) {
		throw new OpenAlexError(explainStatus(response.status), response.status);
	}
	try {
		return response.json;
	} catch {
		throw new OpenAlexError("OpenAlex 返回了无法解析的内容。", response.status);
	}
};
