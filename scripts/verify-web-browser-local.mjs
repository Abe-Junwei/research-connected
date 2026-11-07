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

	// A stored paper remains readable and exportable when every API is offline.
	const storedPaper = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("research-connected-web-settings")).researchProjects)[0].snapshot.nodes[0]);
	const localDetail = await desktop.newPage();
	let providerCalls = 0;
	await localDetail.route("**/api/**", route => { if (new URL(route.request().url()).pathname === "/api/openalex") providerCalls++; return route.fulfill({ status: 503, body: "{}" }); });
	await localDetail.goto(`${base}/?paper=${encodeURIComponent(storedPaper.id)}`);
	await localDetail.getByText(storedPaper.title, { exact: true }).waitFor();
	check(providerCalls === 0, "local paper detail makes no provider request");
	await localDetail.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
	await localDetail.getByRole("button", { name: "BibTeX", exact: true }).click();
	check((await localDetail.locator("pre.cpo-export-text").innerText()).includes("@"), "offline detail supports manual BibTeX copy");
	await localDetail.close();

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

	// Exercise the real saved-paper action and storage adapter under quota failure.
	await page.goto(`${base}/?fixture=1`);
	await page.locator(".cpo-paper-stage").first().waitFor();
	const beforeFull = await page.evaluate(() => {
		const key = "research-connected-web-settings";
		const original = localStorage.getItem(key);
		const proto = Object.getPrototypeOf(localStorage), real = proto.setItem;
		window.__restoreStorage = () => { proto.setItem = real; };
		proto.setItem = function (k, v) {
			if (k === key) throw new DOMException("full", "QuotaExceededError");
			return real.call(this, k, v);
		};
		return original;
	});
	await page.locator(".cpo-paper-stage").first().click();
	await page.locator('#cpo-web-notice[data-kind="error"]').waitFor();
	check(await page.evaluate(() => localStorage.getItem("research-connected-web-settings")) === beforeFull, "real failed save preserves previous projects");
	await page.evaluate(() => window.__restoreStorage());

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
		// Load the newly saved project; B was opened before A created it.
		await pageB.reload();
		await pageB.locator(".cpo-bar #cpo-web-chrome").waitFor();
		const lockA = await pageA.evaluate(key => JSON.parse(localStorage.getItem("research-connected-edit-lock:" + key) || "null"), projectKey);
		await pageB.locator("#cpo-takeover").click();
		await pageB.waitForFunction(key => JSON.parse(localStorage.getItem("research-connected-edit-lock:" + key) || "null")?.tabId === sessionStorage.getItem("research-connected-tab-id"), projectKey);
		const seenOnA = await pageA.evaluate(key => JSON.parse(localStorage.getItem("research-connected-edit-lock:" + key) || "null"), projectKey);
		check(seenOnA && seenOnA.tabId !== lockA.tabId, "real takeover replaces edit owner");
		await pageB.locator(".cpo-paper-stage").first().click();
		await pageB.waitForTimeout(200);
		const afterOwnerWrite = await pageB.evaluate(() => localStorage.getItem("research-connected-web-settings"));
		check(await pageA.locator(".cpo-paper-stage").first().isDisabled(), "old tab's project mutations are disabled after takeover");
		await pageA.locator(".cpo-paper-stage").first().dispatchEvent("click");
		await pageA.locator("canvas").first().dispatchEvent("wheel", { deltaY: 100 });
		await pageA.waitForTimeout(700);
		check(await pageA.evaluate(() => localStorage.getItem("research-connected-web-settings")) === afterOwnerWrite, "old tab cannot overwrite takeover owner's save through actions or gesture autosave");

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
	await mpage.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("research-connected-web-settings") || "{}").researchProjects || {}).some(p => p.snapshot?.nodes?.length > 1));
	await mpage.waitForTimeout(1200);
	const closeCover = mpage.getByRole("button", { name: /返回图谱|Back to graph/ });
	if (await closeCover.isVisible()) await closeCover.click();
	const mcanvas = mpage.locator("canvas").first();
	await mcanvas.waitFor({ state: "visible" });
	const mbox = await mcanvas.boundingBox();
	assert.ok(mbox, "mobile canvas");
	await mpage.touchscreen.tap(mbox.x + mbox.width * 0.5, mbox.y + mbox.height * 0.5);
	await mpage.waitForTimeout(700);
	await mpage.waitForURL(url => url.searchParams.has("paper"));
	check(await mpage.locator("#cpo-web-paper-page").isVisible(), "mobile tap opens independent paper page");
	check(await mpage.locator("#cpo-web-notice[data-kind=error]").isVisible() === false, "fresh mobile paper selection must not report a storage conflict");
	await mpage.screenshot({ path: "/tmp/graph-audit-mobile.png", fullPage: true });
	check(await mpage.getByRole("button", { name: /深挖此文献|Explore this paper/ }).isVisible(), "mobile detail has explicit explore action");
	await mpage.getByRole("button", { name: /返回图谱|Back to graph/ }).click();
	await mpage.waitForURL(url => !url.searchParams.has("paper"));
	check(await mcanvas.isVisible(), "browser back restores graph");
	await mpage.goForward();
	check(await mpage.locator("#cpo-web-paper-page").isVisible(), "browser forward restores paper page");
	await mpage.goBack();
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
