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
	console.error("Playwright missing. Run via: npm exec --yes --package=playwright -- node scripts/verify-web-chrome-ux.mjs");
	process.exit(2);
}
const executablePath = process.env.CHROME_PATH
	|| "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
assert.ok(existsSync(executablePath), `Chrome not found at ${executablePath}`);

const failures = [];
const check = (cond, message) => { if (!cond) failures.push(message); };

const browser = await chromium.launch({ executablePath, headless: true });
try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	await page.goto(`${base}/?fixture=1`);
	await page.getByRole("button", { name: /构建|Build/ }).waitFor();

	// Privacy info collapsed by default
	const info = page.locator("#cpo-privacy-info");
	const panel = page.locator("#cpo-privacy-panel");
	check(await info.getAttribute("aria-expanded") === "false", "info aria-expanded false initially");
	check(await panel.isHidden(), "privacy panel hidden initially");
	const box = await info.boundingBox();
	check(box && box.width >= 44 && box.height >= 44, `info touch target >=44x44 got ${box?.width}x${box?.height}`);
	await info.click();
	check(await info.getAttribute("aria-expanded") === "true", "info expanded after click");
	check(await panel.isVisible(), "privacy panel visible after click");
	check(/浏览器|OpenAlex|browser|data source/i.test(await panel.innerText()), "privacy text present");
	await page.keyboard.press("Escape");
	check(await panel.isHidden(), "Escape closes privacy panel");
	await info.click();
	check(await panel.isVisible(), "privacy reopened");
	await page.locator("body").click({ position: { x: 10, y: 10 } });
	check(await panel.isHidden(), "outside click closes privacy panel");

	// Takeover hidden for owning/current tab
	const takeover = page.locator("#cpo-takeover");
	check(await takeover.isHidden(), "takeover hidden initially");

	await page.getByRole("button", { name: /构建|Build/ }).click();
	await page.locator("canvas").first().waitFor({ state: "visible" });
	await page.waitForTimeout(1000);
	check(await takeover.isHidden(), "takeover still hidden after build on owning tab");

	const projectKey = await page.evaluate(() => {
		const raw = localStorage.getItem("research-connected-web-settings");
		const settings = raw ? JSON.parse(raw) : {};
		return Object.keys(settings.researchProjects || {})[0] || null;
	});
	check(Boolean(projectKey), `fixture project exists (${projectKey})`);

	// Other tab owns lock → takeover visible; click claims
	const pageB = await context.newPage();
	await pageB.goto(`${base}/?fixture=1`);
	await pageB.getByRole("button", { name: /构建|Build/ }).waitFor();
	if (projectKey) {
		await page.evaluate((key) => {
			const tabId = sessionStorage.getItem("research-connected-tab-id") || crypto.randomUUID();
			sessionStorage.setItem("research-connected-tab-id", tabId);
			localStorage.setItem("research-connected-edit-lock:" + key, JSON.stringify({
				owner: "owner-a", tabId, projectKey: key, updatedAt: Date.now(),
			}));
		}, projectKey);
		await pageB.waitForTimeout(500);
		// Force sync on B (storage event may not fire same-context write from A via evaluate on A)
		await pageB.evaluate((key) => {
			const raw = localStorage.getItem("research-connected-edit-lock:" + key);
			if (!raw) return;
			// bump to trigger storage listeners across tabs: rewrite via StorageEvent simulation
			window.dispatchEvent(new StorageEvent("storage", { key: "research-connected-edit-lock:" + key, newValue: raw }));
			window.dispatchEvent(new Event("research-connected-project"));
		}, projectKey);
		await pageB.waitForTimeout(300);
		const visibleOnB = await pageB.locator("#cpo-takeover").isVisible();
		check(visibleOnB, "takeover visible on tab B when A holds fresh lock");
		if (visibleOnB) {
			await pageB.locator("#cpo-takeover").click();
			await pageB.waitForTimeout(300);
			const after = await pageB.evaluate((key) => {
				const lock = JSON.parse(localStorage.getItem("research-connected-edit-lock:" + key) || "null");
				const self = sessionStorage.getItem("research-connected-tab-id");
				return { hidden: document.querySelector("#cpo-takeover")?.hidden ?? null, lockTab: lock?.tabId, self };
			}, projectKey);
			check(after.hidden === true, "takeover hidden on B after successful claim");
			check(after.lockTab === after.self, "lock tabId matches B after takeover");
		}
	}
	await pageB.close();

	// Theme: light / dark / system via emulateMedia; assert canvas pixel changes
	async function canvasStats() {
		return page.evaluate(() => {
			const canvas = document.querySelector("canvas");
			if (!(canvas instanceof HTMLCanvasElement)) return null;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			// Corner pixels are chart background; center often hits glowing nodes in night mode.
			const corners = [[2, 2], [10, 10], [canvas.width - 5, 5], [5, canvas.height - 5]];
			let sum = 0;
			for (const [x, y] of corners) {
				const px = ctx.getImageData(x, y, 1, 1).data;
				sum += px[0] + px[1] + px[2];
			}
			const avg = sum / (corners.length * 3);
			const surface = document.querySelector(".cpo-surface");
			return {
				avg,
				nightCanvas: surface?.classList.contains("is-night-canvas") === true,
				primary: getComputedStyle(document.body).getPropertyValue("--background-primary").trim(),
				darkClass: document.documentElement.classList.contains("theme-dark"),
				lightClass: document.documentElement.classList.contains("theme-light"),
				colorScheme: document.documentElement.style.colorScheme,
			};
		});
	}

	await page.locator('#cpo-theme-group button[data-theme-mode="light"]').click();
	await page.waitForTimeout(400);
	const light = await canvasStats();
	check(light && light.lightClass && !light.darkClass, "light class on html");
	check(light && light.colorScheme === "light", "color-scheme light");
	check(light && light.avg > 200 && !light.nightCanvas, `light canvas bright avg=${light?.avg} night=${light?.nightCanvas}`);
	check(light && light.primary.toLowerCase() === "#ffffff", `light --background-primary=${light?.primary}`);

	await page.locator('#cpo-theme-group button[data-theme-mode="dark"]').click();
	await page.waitForTimeout(500);
	const dark = await canvasStats();
	check(dark && dark.darkClass && !dark.lightClass, "dark class on html");
	check(dark && dark.colorScheme === "dark", "color-scheme dark");
	check(dark && dark.nightCanvas, "dark enables is-night-canvas");
	check(dark && dark.avg < 40, `dark canvas corner dark avg=${dark?.avg}`);
	check(light && dark && (light.avg - dark.avg) > 150, `canvas bg luminance changed light=${light?.avg} dark=${dark?.avg}`);
	check(dark && dark.primary.toLowerCase() === "#1a1d24", `dark --background-primary=${dark?.primary}`);

	await page.locator('#cpo-theme-group button[data-theme-mode="system"]').click();
	await page.emulateMedia({ colorScheme: "dark" });
	await page.waitForTimeout(500);
	const sysDark = await canvasStats();
	check(sysDark && sysDark.darkClass && sysDark.nightCanvas, "system+emulate dark → theme-dark + night canvas");
	check(sysDark && sysDark.avg < 40, `system dark canvas avg=${sysDark?.avg}`);

	await page.emulateMedia({ colorScheme: "light" });
	await page.waitForTimeout(500);
	const sysLight = await canvasStats();
	check(sysLight && sysLight.lightClass && !sysLight.nightCanvas, "system+emulate light → theme-light");
	check(sysLight && sysLight.avg > 200, `system light canvas avg=${sysLight?.avg}`);

	const persisted = await page.evaluate(() => localStorage.getItem("research-connected-web-theme"));
	check(persisted === "system", `theme preference persisted as system, got ${persisted}`);
} finally {
	await browser.close();
}

if (failures.length) {
	console.error("verify-web-chrome-ux FAILED:\n- " + failures.join("\n- "));
	process.exit(1);
}
console.log("verify-web-chrome-ux: ok");
