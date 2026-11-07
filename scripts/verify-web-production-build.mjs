// Real-provider smoke check. Intentionally consumes one successful operation.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
const doi = process.env.WEB_SMOKE_DOI;
assert.ok(doi, "Set WEB_SMOKE_DOI explicitly; this check uses provider allowance.");
const bin = process.env.PATH.split(delimiter).find(p => p.includes("_npx") && p.endsWith("node_modules/.bin"));
const require = createRequire(bin ? join(bin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
try {
	const page = await browser.newPage();
	const errors = [], responses = {};
	page.on("pageerror", error => errors.push(error.message));
	page.on("response", response => {
		const path = new URL(response.url()).pathname;
		if (!path.startsWith("/api/")) return;
		const key = `${path} ${response.status()}`;
		responses[key] = (responses[key] || 0) + 1;
	});
	await page.goto(process.env.WEB_URL || "https://graph.jieyu.ai", { waitUntil: "domcontentloaded" });
	await page.locator(".cpo-input").fill(doi);
	const started = Date.now();
	await page.getByRole("button", { name: /^构建$|^Build$/ }).click();
	try {
		await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("research-connected-web-settings") || "{}").researchProjects || {}).some(p => p.snapshot?.nodes?.length > 1), undefined, { timeout: 300000 });
		await page.waitForFunction(() => !sessionStorage.getItem("research-connected-web-task"), undefined, { timeout: 30000 });
	} catch (error) {
		console.error(JSON.stringify({ responses, errors, status: await page.locator(".cpo-status").innerText(), notice: await page.locator("#cpo-web-notice").innerText() }));
		throw error;
	}
	const result = await page.evaluate(async () => {
		const settings = JSON.parse(localStorage.getItem("research-connected-web-settings"));
		const project = Object.values(settings.researchProjects).find(p => p.snapshot?.nodes?.length > 1);
		const response = await fetch("/api/quota/status", { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Api": "2", "X-Browser-Token": localStorage.getItem("research-connected-browser-token"), "X-Session-Nonce": sessionStorage.getItem("research-connected-session-nonce") }, body: "{}" });
		const quota = await response.json();
		return { nodes: project.snapshot.nodes.length, browserRemaining: quota.browser_remaining, siteRemaining: quota.site_remaining, budgetRemaining: quota.openalex_budget_remaining_usd };
	});
	assert.equal(result.browserRemaining, 9, "Exactly one completed build must be charged");
	assert.deepEqual(errors, [], "No uncaught browser exceptions");
	console.log(JSON.stringify({ ...result, elapsedMs: Date.now() - started, responses, errors }, null, 2));
} finally { await browser.close(); }
