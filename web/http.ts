import { OpenAlexError, retryAfterMs, type GetJson } from "../src/openalex";
import type { PostJson } from "../src/citation-sources";
import { screenWebResponse } from "../preview/quality";
import { browserId } from "./browser-id";

const OPENALEX_HOST = "api.openalex.org";
const S2_HOST = "api.semanticscholar.org";

function apiUrl(path: string): string {
	return new URL(path, window.location.href).pathname;
}

async function readError(response: Response, fallback: string): Promise<string> {
	try {
		const json: unknown = await response.json();
		if (!json || typeof json !== "object" || !("error" in json)) return fallback;
		const message = json.error;
		if (typeof message === "string") return message;
	} catch { /* Keep the HTTP status message. */ }
	return fallback;
}

async function request(url: string, init: { headers: Record<string, string>; body?: string }): Promise<unknown> {
	const target = new URL(url);
	const openalex = target.hostname === OPENALEX_HOST;
	const s2 = target.hostname === S2_HOST;
	if (init.body && !s2) throw new Error("Browser POST is only available for Semantic Scholar.");
	const headers: Record<string, string> = { "Content-Type": "application/json", "X-Browser-Id": browserId() };
	let endpoint: string;
	let body: string | undefined;
	if (openalex) {
		endpoint = apiUrl("/api/openalex");
		const query = Object.fromEntries(target.searchParams);
		delete query.mailto;
		body = JSON.stringify({ method: "GET", path: target.pathname, query });
	} else if (s2) {
		endpoint = apiUrl("/api/semantic-scholar");
		body = JSON.stringify({
			method: init.body ? "POST" : "GET",
			path: target.pathname,
			query: Object.fromEntries(target.searchParams),
			...(init.body ? { body: JSON.parse(init.body) as unknown } : {}),
		});
	} else {
		const response = await window.fetch(url, { headers: init.headers, signal: AbortSignal.timeout(30000) });
		if (!response.ok) {
			throw new OpenAlexError(`${target.hostname} request failed (HTTP ${response.status}).`, response.status, retryAfterMs({ "retry-after": response.headers.get("Retry-After") ?? "" }));
		}
		return screenWebResponse(await response.json() as unknown, target, init.body);
	}
	const response = await window.fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(45000) });
	if (!response.ok) {
		const service = openalex ? "OpenAlex" : "Semantic Scholar";
		const message = await readError(response, `${service} request failed (HTTP ${response.status}).`);
		throw new OpenAlexError(message, response.status, retryAfterMs({ "retry-after": response.headers.get("Retry-After") ?? "" }));
	}
	return screenWebResponse(await response.json() as unknown, target, init.body);
}

export const browserGetJson: GetJson = request;
export const browserPostJson: PostJson = request;
