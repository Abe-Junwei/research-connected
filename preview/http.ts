import { OpenAlexError, retryAfterMs, type GetJson } from "../src/openalex";
import type { PostJson } from "../src/citation-sources";
import { screenWebResponse } from "./quality";

async function request(url: string, init: { headers: Record<string, string>; body?: string }): Promise<unknown> {
	const target = new URL(url);
	const s2 = target.origin === "https://api.semanticscholar.org";
	if (init.body && !s2) throw new Error("Browser POST is only available for Semantic Scholar.");
	const endpoint = s2 ? new URL("api/semantic-scholar", window.location.href).pathname : url;
	const response = await window.fetch(endpoint, s2 ? {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ method: init.body ? "POST" : "GET", path: target.pathname, query: Object.fromEntries(target.searchParams), ...(init.body ? { body: JSON.parse(init.body) as unknown } : {}) }),
		signal: AbortSignal.timeout(45000),
	} : { headers: init.headers, signal: AbortSignal.timeout(30000) });
	if (!response.ok) {
		const service = s2 ? "Semantic Scholar" : target.hostname === "api.openalex.org" ? "OpenAlex" : target.hostname;
		let message = `${service} request failed (HTTP ${response.status}).`;
		if (s2) {
			try {
				const json: unknown = await response.json();
				if (json && typeof json === "object" && "error" in json && typeof json.error === "string") message = json.error;
			} catch { /* A proxy HTML error still preserves its HTTP status. */ }
		}
		throw new OpenAlexError(message, response.status, retryAfterMs({ "retry-after": response.headers.get("Retry-After") ?? "" }));
	}
	return screenWebResponse(await response.json() as unknown, target, init.body);
}

export const browserGetJson: GetJson = request;
export const browserPostJson: PostJson = request;
