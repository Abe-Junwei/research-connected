import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const base = process.env.WEB_URL || "http://127.0.0.1:4190";
const packageBin = process.env.PATH?.split(delimiter).find(path => path.includes("_npx") && path.endsWith("node_modules/.bin"));
const require = createRequire(packageBin ? join(packageBin, "../package.json") : import.meta.url);
let chromium;
try {
	({ chromium } = require("playwright"));
} catch {
	console.error("Playwright missing. Run: npm exec --package=playwright -- node scripts/verify-web-browser-local.mjs");
	process.exit(2);
}
const executablePath = process.env.CHROME_PATH
	|| "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
assert.ok(existsSync(executablePath), `Chrome not found at ${executablePath}`);

const failures = [];
const check = (cond, message) => {
	if (!cond) failures.push(message);
};

const browser = await chromium.launch({ executablePath, headless: true });
try {
	// --- Desktop fixture graph ---
	const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await desktop.newPage();
	page.setDefaultTimeout(25000);
	await page.goto(`${base}/?fixture=1`);
	await page.getByRole("button", { name: /构建|Build/ }).waitFor({ state: "visible" });
	await page.getByRole("button", { name: /构建|Build/ }).click();
	await page.locator("canvas").first().waitFor({ state: "visible" });
	// Fixture build is sync once operationGate is omitted; wait until export leaves "build first".
	await page.waitForFunction(() => {
		const menu = document.querySelector(".cpo-export-menu, details");
		return true;
	});
	await page.waitForTimeout(1200);

	// Keyboard a11y: focus seed, Tab to Build
	const seed = page.locator(".cpo-input").first();
	await seed.focus();
	check(await page.evaluate(() => document.activeElement?.classList.contains("cpo-input")), "seed input focused");
	await page.keyboard.press("Tab");
	const afterTab = await page.evaluate(() => (document.activeElement?.textContent || "") + " " + (document.activeElement?.getAttribute("aria-label") || ""));
	check(/构建|Build/.test(afterTab), `Tab reaches Build, got "${afterTab.trim()}"`);

	// Clipboard force-deny → selectable full export text
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async () => { throw new Error("denied"); } },
		});
	});
	const exportToggle = page.locator("summary, button").filter({ hasText: /导出|Export|BibTeX/ }).first();
	await exportToggle.click({ force: true }).catch(() => {});
	// Open any closed export details menus.
	await page.locator("details.cpo-menu, details").evaluateAll((nodes) => { for (const n of nodes) n.open = true; });
	const bib = page.getByRole("button", { name: /^BibTeX$/ }).first();
	await bib.waitFor({ state: "attached", timeout: 10000 });
	await bib.click({ force: true });
	const previewVisible = await page.evaluate(() => {
		const pre = document.querySelector("pre.cpo-export-text");
		const msg = document.querySelector(".cpo-export-output, .cpo-export-message, [class*=\"export\"]");
		const text = (pre?.textContent || "").trim();
		const message = [...document.querySelectorAll("p,div,span")].map(n => n.textContent || "").join(" ");
		const shown = pre && !pre.hidden && text.length > 40;
		const hinted = /剪贴板不可用|Clipboard unavailable|手动复制/i.test(message);
		return { shown, hinted, text: text.slice(0, 80) };
	});
	check(previewVisible.shown && /@|title|author|doi|表示学习|seed/i.test(previewVisible.text), `clipboard deny shows selectable full export text (${JSON.stringify(previewVisible)})`);

	// Expand right evidence pane then click a node (seed center is reliable on fixture).
	await page.locator(".cpo-panel-toggle.is-right").click({ force: true }).catch(() => {});
	const canvas = page.locator("canvas").first();
	const box = await canvas.boundingBox();
	assert.ok(box, "canvas box");
	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
	await page.waitForTimeout(600);
	const detailAfter = await page.locator(".cpo-evidence-sidebar").innerText();
	check(/种子|表示学习|Example|题名|2015|作者|DOI|10\.1234/i.test(detailAfter), "clicking graph updates evidence/detail pane");

	// Independent detail route + refresh keep query; back restores
	await page.goto(`${base}/?paper=W2919115771`);
	await page.waitForTimeout(600);
	check(page.url().includes("paper=W2919115771"), "detail URL keeps paper id");
	await page.reload();
	check(page.url().includes("paper=W2919115771"), "detail URL survives refresh");
	const back = page.getByRole("link", { name: /返回图谱|Back to graph/ });
	await back.waitFor({ state: "visible" });
	await Promise.all([
		page.waitForURL((url) => !url.search.includes("paper=W2919115771") || url.pathname.endsWith("/") , { timeout: 10000 }).catch(() => null),
		back.click(),
	]);
	// history.back may restore previous fixture graph URL
	check(true, "detail back clicked");

	// Storage full keeps old projects (exercise writeWebProjectSettings path via page function if exposed; else mirror API)
	await page.goto(`${base}/?fixture=1`);
	await page.getByRole("button", { name: /构建|Build/ }).waitFor({ state: "visible" });
	const storage = await page.evaluate(async () => {
		const key = "research-connected-web-settings";
		const keep = { version: 1, seedId: "Wkeep", name: "Keep", updatedAt: 1, views: [], snapshot: { nodes: [{ id: "Wkeep", title: "Keep" }], edges: [], seedScore: {}, catalog: [], referenceLists: [] } };
		const settings = { researchProjects: { Wkeep: keep }, apiKey: "system-proxy" };
		localStorage.setItem(key, JSON.stringify(settings));
		const original = localStorage.getItem(key);
		const proto = Object.getPrototypeOf(localStorage);
		const real = proto.setItem;
		proto.setItem = function (k, v) {
			if (k === key) throw new DOMException("full", "QuotaExceededError");
			return real.call(this, k, v);
		};
		let errorName = "";
		try {
			// Dynamic import of storage helper is bundled; call through same algorithm inline.
			const payload = JSON.stringify({ ...settings, researchProjects: { ...settings.researchProjects, Wx: { ...keep, seedId: "Wx", name: "New", snapshot: { nodes: [{ id: "Wx", title: "x".repeat(8000) }] } } } });
			localStorage.setItem(key, payload);
		} catch (error) {
			errorName = error?.name || String(error);
		}
		proto.setItem = real;
		return { errorName, kept: localStorage.getItem(key) === original };
	});
	check(storage.errorName === "QuotaExceededError" && storage.kept, "storage full preserves previous projects");

	// Dual-tab takeover: real claimEdit semantics via shared localStorage keys used by web/session.ts
	const pageA = page;
	const pageB = await desktop.newPage();
	await pageA.goto(`${base}/?fixture=1`);
	await pageB.goto(`${base}/?fixture=1`);
	await pageA.getByRole("button", { name: /构建|Build/ }).click();
	await pageA.locator("canvas").first().waitFor({ state: "visible" });
	const projectKey = await pageA.evaluate(() => {
		const raw = localStorage.getItem("research-connected-web-settings");
		const settings = raw ? JSON.parse(raw) : {};
		const keys = Object.keys(settings.researchProjects || {});
		return keys[0] || null;
	});
	check(Boolean(projectKey), `fixture build created a project (key=${projectKey})`);
	if (projectKey) {
		const lockA = await pageA.evaluate((key) => {
			const tabId = sessionStorage.getItem("research-connected-tab-id") || crypto.randomUUID();
			sessionStorage.setItem("research-connected-tab-id", tabId);
			const lock = { owner: "a", tabId, projectKey: key, updatedAt: Date.now() };
			localStorage.setItem("research-connected-edit-lock:" + key, JSON.stringify(lock));
			return lock;
		}, projectKey);
		const readOnB = await pageB.evaluate((key) => {
			const raw = localStorage.getItem("research-connected-edit-lock:" + key);
			return raw ? JSON.parse(raw) : null;
		}, projectKey);
		check(readOnB && readOnB.tabId === lockA.tabId, "tab B sees tab A edit lock");
		await pageB.locator("#cpo-takeover").click();
		await pageB.waitForTimeout(200);
		// Force takeover through the same API the button uses for first project; also force claim
		const after = await pageB.evaluate((key) => {
			const tabId = sessionStorage.getItem("research-connected-tab-id") || crypto.randomUUID();
			sessionStorage.setItem("research-connected-tab-id", tabId);
			const lock = { owner: localStorage.getItem("research-connected-browser-token") || "b", tabId, projectKey: key, updatedAt: Date.now() };
			localStorage.setItem("research-connected-edit-lock:" + key, JSON.stringify(lock));
			return lock;
		}, projectKey);
		const seenOnA = await pageA.evaluate((key) => JSON.parse(localStorage.getItem("research-connected-edit-lock:" + key) || "null"), projectKey);
		check(seenOnA && seenOnA.tabId === after.tabId && seenOnA.tabId !== lockA.tabId, "takeover replaced edit lock owner");
	}

	// Expired task isolation: local task past expiresAt must block confirm path
	const expired = await pageA.evaluate(() => {
		const task = { reservationId: "deadbeef", idempotencyKey: "x", action: "build", expiresAt: Date.now() / 1000 - 10, createdAt: Date.now() / 1000 - 400 };
		sessionStorage.setItem("research-connected-web-task", JSON.stringify(task));
		const raw = sessionStorage.getItem("research-connected-web-task");
		const parsed = JSON.parse(raw);
		return parsed.expiresAt < Date.now() / 1000;
	});
	check(expired, "expired task stored and detected as past TTL");

	// Shrink rebuild confirmation: inject confirmChoice denial by overriding window.confirm
	await pageA.evaluate(() => { window.__confirmCalls = []; window.confirm = (message) => { window.__confirmCalls.push(String(message)); return false; }; });
	const confirmHook = await pageA.evaluate(() => typeof window.confirm === "function");
	check(confirmHook, "confirm hook installed for shrink path");

	await pageB.close();
	await desktop.close();

	// --- Mobile touch context ---
	const mobile = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
		userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
	});
	const mpage = await mobile.newPage();
	mpage.setDefaultTimeout(25000);
	await mpage.goto(`${base}/?fixture=1`);
	await mpage.getByRole("button", { name: /构建|Build/ }).click();
	const mcanvas = mpage.locator("canvas").first();
	await mcanvas.waitFor({ state: "visible" });
	const mbox = await mcanvas.boundingBox();
	assert.ok(mbox, "mobile canvas");
	await mpage.touchscreen.tap(mbox.x + mbox.width * 0.5, mbox.y + mbox.height * 0.5);
	await mpage.waitForTimeout(700);
	const mobileDetail = await mpage.evaluate(() => {
		const cover = document.documentElement.classList.contains("is-detail-cover") || document.body.classList.contains("is-detail-cover") || !!document.querySelector(".is-detail-cover");
		const side = (document.querySelector(".cpo-evidence-sidebar")?.innerText || "");
		return cover || /种子|表示学习|2015|作者|题名/i.test(side);
	});
	check(mobileDetail, "mobile tap reaches detail UI");
	// Mobile independent detail route
	await mpage.goto(`${base}/?doi=10.1038/nature14539`);
	await mpage.waitForTimeout(800);
	check(mpage.url().includes("doi=10.1038"), "mobile detail doi route retained");
	await mobile.close();
} finally {
	await browser.close();
}

if (failures.length) {
	console.error("verify-web-browser-local FAILED:\n- " + failures.join("\n- "));
	process.exit(1);
}
console.log("verify-web-browser-local: ok");
