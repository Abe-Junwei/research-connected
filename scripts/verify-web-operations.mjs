import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bin = process.env.PATH.split(delimiter).find(p => p.includes("_npx") && p.endsWith("node_modules/.bin"));
const require = createRequire(bin ? join(bin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const fixtureCode = (await build({ entryPoints: ["preview/fixture.ts"], bundle: true, format: "esm", platform: "node", write: false })).outputFiles[0].text;
const { fixtureGet, fixturePost } = await import("data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64"));
const version = JSON.parse(readFileSync("web/dist/version.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
const base = process.env.WEB_URL || "http://127.0.0.1:4190";
try {
	const context = await browser.newContext();
	let reserve = 0, confirms = 0, releases = 0, held = false, hold, seedOnly = false;
	const errors = [];
	await context.route("**/api/**", async route => {
		const path = new URL(route.request().url()).pathname;
		const fulfill = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
		if (path === "/api/version") return fulfill(version);
		if (path === "/api/session") return fulfill({ browser_token: "test-browser", session_nonce: "test-nonce", expires_at: Date.now() / 1000 + 43200 });
		if (path === "/api/quota/status") return fulfill({ period: "test", reset_at: "2026-11-08T08:00:00+08:00", browser_remaining: 10, browser_limit: 10, site_remaining: 500, site_limit: 500, openalex_budget_remaining_usd: 1, openalex_budget_usd: 1, reason: "" });
		if (path === "/api/quota/reserve") return fulfill({ ok: true, reservation_id: "reservation-" + ++reserve, idempotency_key: route.request().postDataJSON().idempotency_key, expires_at: Date.now() / 1000 + 300 });
		if (path === "/api/quota/confirm") {
			if (++confirms === 1) return route.abort("failed");
			return fulfill({ ok: true, code: "confirmed" });
		}
		if (path === "/api/quota/release") { releases++; return fulfill({ ok: true, code: "released" }); }
		const payload = route.request().postDataJSON();
		if (path === "/api/openalex") {
			if (held && payload.path.startsWith("/works/")) await new Promise(resolve => { hold = resolve; });
			const url = new URL("https://api.openalex.org" + payload.path);
			for (const [key, value] of Object.entries(payload.query || {})) url.searchParams.set(key, value);
			const data = seedOnly && payload.path === "/works" ? { results: [], meta: {} } : await fixtureGet(url.toString(), { headers: {} });
			return fulfill(data);
		}
		if (path === "/api/semantic-scholar") {
			const url = new URL("https://api.semanticscholar.org" + payload.path);
			for (const [key, value] of Object.entries(payload.query || {})) url.searchParams.set(key, value);
			return fulfill(payload.method === "POST" ? await fixturePost(url.toString(), { headers: {}, body: JSON.stringify(payload.body) }) : await fixtureGet(url.toString(), { headers: {} }));
		}
		return route.fulfill({ status: 404, body: "{}" });
	});
	await context.route("https://api.crossref.org/**", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"message":{}}' }));
	await context.route(/https:\/\/.*opencitations.*/, async route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await fixtureGet(route.request().url(), { headers: {} })) }));
	const page = await context.newPage();
	page.on("pageerror", error => errors.push(error.message));
	await page.goto(base);
	await page.locator(".cpo-input").fill("10.1234/seed");
	await page.getByRole("button", { name: /^构建$|^Build$/ }).click();
	await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("research-connected-web-settings") || "{}").researchProjects || {}).some(p => p.snapshot?.nodes?.length > 1));
	for (let i = 0; i < 80 && confirms < 2; i++) await page.waitForTimeout(50);
	assert.equal(confirms, 2, "Lost confirmation response must retry with the saved result intact");
	assert.equal(releases, 0, "Successful local save must not release on transient confirmation failure");
	await page.waitForTimeout(300);
	const original = await page.evaluate(() => localStorage.getItem("research-connected-web-settings"));
	held = true;
	await page.getByRole("button", { name: /^重新加载$|^Reload$/ }).click();
	await page.locator("#cpo-cancel-task").waitFor({ state: "visible" });
	assert.equal(await page.locator(".cpo-empty").isVisible(), false, "Rebuild must keep the previous graph visible");
	assert.equal(await page.locator(".cpo-paper-stage").first().isDisabled(), true, "Project mutations disabled during rebuild");
	await page.locator("#cpo-cancel-task").click();
	held = false; hold?.();
	await page.waitForTimeout(500);
	assert.equal(await page.evaluate(() => localStorage.getItem("research-connected-web-settings")), original, "Cancelled task must not replace the previous project");
	assert.equal(confirms, 2);
	seedOnly = true;
	await page.getByRole("button", { name: /^重新加载$|^Reload$/ }).click();
	await page.waitForFunction(() => document.querySelector(".cpo-status")?.textContent?.includes("未取得邻居"));
	assert.equal(confirms, 2, "Seed-only rebuild must not be charged");
	assert.equal(await page.evaluate(() => localStorage.getItem("research-connected-web-settings")), original, "Seed-only rebuild must retain full prior project");
	assert.deepEqual(errors, []);
	await context.close();
	console.log("Web operations: real gate/save/confirm retry, old graph visible, mutation freeze, cancel and seed-only rebuild: passed");
} finally { await browser.close(); }
