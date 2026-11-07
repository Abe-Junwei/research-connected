// Run via npm exec --package=playwright@1.48.2 -- node scripts/measure-web-startup.mjs [URL].
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import assert from "node:assert/strict";

const packageBin = process.env.PATH.split(delimiter).find(p => p.includes("_npx") && p.endsWith("node_modules/.bin"));
const require = createRequire(packageBin ? join(packageBin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
	headless: true,
	args: process.env.DIRECT_NETWORK === "1" ? ["--no-proxy-server"] : [],
});
try {
	const context = await browser.newContext();
	// Isolate static startup from external queries, account state and provider budgets.
	await context.addInitScript(() => {
		const fetch = window.fetch.bind(window);
		window.fetch = (input, init) => new URL(typeof input === "string" ? input : input.url, location.href).pathname.startsWith("/api/")
			? Promise.resolve(new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } })) : fetch(input, init);
	});
	const page = await context.newPage();
	let responses = [];
	page.on("response", response => {
		const url = new URL(response.url());
		if (response.request().resourceType() !== "document" && !/\.(js|css)$/.test(url.pathname)) return;
		const headers = response.headers();
		responses.push({ path: url.pathname, status: response.status(), cache: headers["cf-cache-status"], age: headers.age, policy: headers["cache-control"] });
	});
	const target = process.argv[2] || "https://graph.jieyu.ai/?fixture=1";
	const results = [];
	for (const visit of ["cold", "warm", "warm"]) {
		responses = [];
		await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
		await page.locator(".cpo-bar #cpo-web-chrome").waitFor({ timeout: 15000 });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const result = await page.evaluate(() => {
			const nav = performance.getEntriesByType("navigation")[0];
			return {
				ttfb: Math.round(nav.responseStart),
				dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
				connect: Math.round(nav.connectEnd - nav.connectStart),
				tls: nav.secureConnectionStart ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
				wait: Math.round(nav.responseStart - nav.requestStart),
				download: Math.round(nav.responseEnd - nav.responseStart),
				html: Math.round(nav.responseEnd),
				ready: Math.round(performance.getEntriesByName("research-connected-ready")[0]?.startTime || performance.now()),
				paint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
				assets: performance.getEntriesByType("resource").filter(r => /\.(js|css)(\?|$)/.test(r.name)).map(r => ({
					name: new URL(r.name).pathname, wait: Math.round(r.responseStart - r.requestStart), download: Math.round(r.responseEnd - r.responseStart), start: Math.round(r.startTime), end: Math.round(r.responseEnd), bytes: r.transferSize,
				})),
			};
		});
		assert.ok(result.ready < Number(process.env.MAX_READY_MS || 60000), `Startup exceeded budget: ${result.ready}ms`);
		results.push({ visit, ...result, responses });
	}
	console.log(JSON.stringify({ target, network: process.env.DIRECT_NETWORK === "1" ? "direct-browser" : "system-default", results }, null, 2));
	if (process.env.VERIFY_STARTUP === "1") {
		const delayed = await browser.newContext();
		let scripts = 0;
		await delayed.route("**/api/**", route => new Promise(resolve => setTimeout(resolve, 3000)).then(() => route.fulfill({ status: 503, body: "{}" })).catch(() => {}));
		await delayed.route("**/web-*.js", async route => {
			scripts++;
			await new Promise(resolve => setTimeout(resolve, 1500));
			await route.continue().catch(() => {});
		});
		const slow = await delayed.newPage();
		const errors = [];
		slow.on("pageerror", error => errors.push(error.message));
		await slow.goto(target.replace("?fixture=1", ""), { waitUntil: "commit" });
		await slow.locator(".cpo-boot").waitFor({ state: "visible", timeout: 1200 });
		assert.equal(await slow.locator(".cpo-bar").count(), 0, "Boot content must appear before the bundle");
		await slow.locator(".cpo-bar #cpo-web-chrome").waitFor({ timeout: 2500 });
		assert.equal(await slow.locator(".cpo-boot").count(), 0, "Mounted application replaces boot content");
		assert.equal(scripts, 1, "Preload and deferred execution must reuse a single download");
		assert.deepEqual(errors, [], "Deferred application must start without errors");
		await delayed.close();
		console.error("Startup regression: visible shell before delayed JS, one script download, API-independent mount: passed");
	}
} finally {
	await browser.close();
}
