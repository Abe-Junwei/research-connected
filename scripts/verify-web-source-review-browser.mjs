import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const bin = process.env.PATH.split(delimiter).find(p => p.includes("_npx") && p.endsWith("node_modules/.bin"));
const require = createRequire(bin ? join(bin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const code = (await build({ entryPoints: ["preview/fixture.ts"], bundle: true, format: "esm", write: false })).outputFiles[0].text;
const { fixtureGet } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const version = JSON.parse(readFileSync("web/dist/version.json", "utf8"));
const key = "research-connected-web-settings", backup = `${key}-before-source-review`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
try {
	const context = await browser.newContext();
	let providerRequests = 0;
	await context.route("**/api/**", async route => {
		const path = new URL(route.request().url()).pathname;
		const fulfill = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
		if (path === "/api/version") return fulfill(version);
		if (path === "/api/session") return fulfill({ browser_token: "test-browser", session_nonce: "test-nonce", expires_at: Date.now() / 1000 + 43200 });
		if (path === "/api/quota/status") return fulfill({ browser_remaining: 10, site_remaining: 500 });
		if (path === "/api/openalex") {
			providerRequests++;
			const payload = route.request().postDataJSON(), url = new URL("https://api.openalex.org" + payload.path);
			for (const [name, value] of Object.entries(payload.query || {})) url.searchParams.set(name, value);
			return fulfill(await fixtureGet(url.toString(), { headers: {} }));
		}
		return route.fulfill({ status: 503, body: "{}" });
	});
	await context.addInitScript(({ key, backup }) => {
		const setItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (name, value) {
			if (this === localStorage && (name === backup || name === key && localStorage.getItem("test-storage-full") === "1" && localStorage.getItem(backup) !== null)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
			return setItem.call(this, name, value);
		};
	}, { key, backup });
	const page = await context.newPage();
	const errors = []; page.on("pageerror", error => errors.push(error.message));
	const base = process.env.WEB_URL || "http://127.0.0.1:4190";
	const landing = new URL(base); landing.searchParams.set("v", version.build);
	const fixture = new URL(landing); fixture.searchParams.set("fixture", "1");
	await page.goto(fixture.href);
	await page.getByRole("button", { name: /^构建$|^Build$/ }).click();
	await page.waitForFunction(key => Boolean(localStorage.getItem(key)), key);
	// A duplicate backup write is denied; replacing the live project is allowed.
	await page.goto(landing.href);
	await page.waitForFunction(() => document.querySelector("#cpo-web-notice")?.textContent?.includes("已核对"));
	assert.equal(await page.evaluate(backup => localStorage.getItem(backup), backup), null);
	// Simulate a pre-existing legacy backup and a genuinely full Safari store.
	await page.evaluate(({ key, backup }) => {
		const settings = JSON.parse(localStorage.getItem(key));
		const visit = value => { if (!value || typeof value !== "object") return; if (value.webSource) value.webSource.checkedAt = 0; Object.values(value).forEach(visit); };
		visit(settings); localStorage.setItem(key, JSON.stringify(settings));
	}, { key, backup });
	// CDP storage assignment represents an already existing backup, bypassing page instrumentation.
	const cdp = await context.newCDPSession(page);
	const original = await page.evaluate(key => localStorage.getItem(key), key);
	await cdp.send("DOMStorage.setDOMStorageItem", { storageId: { securityOrigin: new URL(base).origin, isLocalStorage: true }, key: backup, value: original });
	await page.evaluate(() => localStorage.setItem("test-storage-full", "1"));
	await page.reload();
	const cleanup = page.getByRole("button", { name: /清理旧来源备份并重试/ });
	await cleanup.waitFor();
	assert.equal(await page.evaluate(key => localStorage.getItem(key), key), original);
	assert.equal(await page.evaluate(backup => localStorage.getItem(backup), backup), original, "Legacy backup is not silently deleted");
	assert.equal((await page.locator("#cpo-web-notice").innerText()).includes("The quota has been exceeded"), false);
	const count = providerRequests;
	await page.reload();
	await page.locator(".cpo-bar").waitFor(); await page.waitForTimeout(700);
	assert.equal(providerRequests, count, "Reload must not repeat a failed automatic review");
	assert.equal(await page.locator("#cpo-web-notice").isVisible(), false);
	// Recovery remains reachable from info even after refreshing the paused page.
	await page.locator("#cpo-privacy-info").click();
	const recovery = page.locator("#cpo-privacy-panel").getByRole("button", { name: /清理旧来源备份并重试/ });
	await recovery.waitFor();
	await page.evaluate(() => sessionStorage.setItem("research-connected-web-task", JSON.stringify({ reservationId: "busy-test", expiresAt: Date.now() / 1000 + 300 })));
	await recovery.click();
	assert.equal(await page.evaluate(backup => localStorage.getItem(backup), backup), original, "Cleanup must not reload a running task");
	await page.evaluate(() => sessionStorage.removeItem("research-connected-web-task"));
	await recovery.click();
	await page.waitForFunction(() => document.querySelector("#cpo-web-notice")?.textContent?.includes("已核对"));
	assert.equal(await page.evaluate(backup => localStorage.getItem(backup), backup), null);
	assert.ok(await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)).researchProjects).length > 0, key));
	await cdp.send("DOMStorage.setDOMStorageItem", { storageId: { securityOrigin: new URL(base).origin, isLocalStorage: true }, key: backup, value: original });
	await page.evaluate(key => localStorage.removeItem(key), key);
	await page.reload(); await page.locator(".cpo-bar").waitFor();
	await page.locator("#cpo-privacy-info").click();
	assert.equal(await page.getByRole("button", { name: /清理旧来源备份并重试/ }).count(), 0, "Never offer to discard the only remaining project copy");
	assert.equal(await page.evaluate(backup => localStorage.getItem(backup), backup), original);
	assert.deepEqual(errors, []);
	console.log("Source review browser: no duplicate backup; Safari quota preserves projects; reload pauses; explicit backup cleanup recovers: passed");
} finally { await browser.close(); }
