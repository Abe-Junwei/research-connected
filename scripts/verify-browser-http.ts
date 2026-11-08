import assert from "node:assert/strict";
import { browserGetJson, browserPostJson } from "../preview/http";

export async function verifyBrowserHttp(): Promise<void> {
	const originalFetch = globalThis.fetch;
	const location = Object.getOwnPropertyDescriptor(window, "location");
	const browserFetch = Object.getOwnPropertyDescriptor(window, "fetch");
	Object.defineProperty(window, "location", { configurable: true, value: { href: "https://status.jieyu.ai/research-connected/preview/" } });
	Object.defineProperty(window, "fetch", { configurable: true, value: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) });
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	try {
		globalThis.fetch = async (input, init) => {
			calls.push({ url: String(input), init });
			return new Response(JSON.stringify([{ abstract: "Recovered" }]), { status: 200 });
		};
		await browserPostJson("https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract", { headers: { "x-api-key": "must-not-leak" }, body: JSON.stringify({ ids: ["DOI:10.1234/test"] }) });
		assert.equal(calls[0]?.url, "/research-connected/preview/api/semantic-scholar");
		assert.equal(JSON.stringify(calls).includes("must-not-leak"), false, "personal key is never forwarded to the system proxy");
		assert.equal(JSON.parse(String(calls[0]?.init?.body)).method, "POST");
		await browserGetJson("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1234%2Ftest?fields=abstract", { headers: {} });
		assert.equal(JSON.parse(String(calls[1]?.init?.body)).method, "GET", "S2 GET uses the same proxy");
		await browserGetJson("https://api.openalex.org/works/W1", { headers: {} });
		assert.equal(calls[2]?.url, "https://api.openalex.org/works/W1", "other data sources retain their transport");
		globalThis.fetch = async () => new Response(JSON.stringify({ error: "Semantic Scholar cooling down" }), { status: 429, headers: { "Retry-After": "12" } });
		await assert.rejects(browserPostJson("https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract", { headers: {}, body: "{}" }), (error: unknown) => error instanceof Error && "status" in error && error.status === 429 && "retryAfterMs" in error && error.retryAfterMs === 12000);
		await assert.rejects(browserPostJson("https://example.test/chat", { headers: {}, body: "{}" }), /only available/);
	} finally {
		globalThis.fetch = originalFetch;
		if (location) Object.defineProperty(window, "location", location);
		else Reflect.deleteProperty(window, "location");
		if (browserFetch) Object.defineProperty(window, "fetch", browserFetch);
		else Reflect.deleteProperty(window, "fetch");
	}
}
