// Hold the real bundle to inspect the HTML-only loading screen, then release it.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
const bin = process.env.PATH.split(delimiter).find(p => p.includes("_npx") && p.endsWith("node_modules/.bin"));
const require = createRequire(bin ? join(bin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Users/junwei/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
try {
	for (const [name, viewport, colorScheme, reducedMotion] of [
		["light", { width: 1440, height: 900 }, "light", "no-preference"],
		["dark", { width: 1440, height: 900 }, "dark", "no-preference"],
		["mobile", { width: 390, height: 844 }, "light", "reduce"],
		["short", { width: 844, height: 390 }, "light", "reduce"],
	]) {
		const context = await browser.newContext({ viewport, colorScheme, reducedMotion });
		const page = await context.newPage();
		const errors = []; let release, requests = 0;
		page.on("pageerror", error => errors.push(error.message));
		await page.route("**/api/**", route => route.fulfill({ status: 503, body: "{}" }));
		await page.route("**/web-*.js", async route => { requests++; await new Promise(resolve => { release = resolve; }); await route.continue().catch(() => {}); });
		await page.goto(process.env.WEB_URL || "http://127.0.0.1:4190", { waitUntil: "commit" });
		await page.locator(".cpo-boot").waitFor({ state: "visible" });
		assert.equal(await page.locator("#cpo-web-chrome").isVisible(), false, "No unfinished toolbar during boot");
		assert.equal(await page.locator(".cpo-boot h1").innerText(), "文现");
		if (name === "light") {
			const cycles = [];
			for (let sample = 0; sample < 13; sample++) {
				cycles.push(await page.locator(".cpo-boot-visual").evaluate(el => ({
					core: getComputedStyle(el.querySelector(".cpo-boot-core")).transform,
					flow: getComputedStyle(el.querySelector(".cpo-boot-flow")).strokeDashoffset,
					animations: el.getAnimations({ subtree: true }).map(animation => ({ state: animation.playState, infinite: animation.effect.getTiming().iterations === Infinity, iteration: animation.effect.getComputedTiming().currentIteration })),
				})));
				if (sample < 12) await page.waitForTimeout(1000);
			}
			assert.ok(cycles[12].animations.length >= 11);
			assert.ok(cycles[12].animations.every(animation => animation.infinite && animation.state === "running" && animation.iteration >= 2), "Every logo animation must still loop after 12 seconds");
			assert.ok(new Set(cycles.slice(7).map(sample => sample.core)).size > 1, "Core must keep changing after two cycles");
			assert.ok(new Set(cycles.slice(7).map(sample => sample.flow)).size > 1, "Connections must keep changing after two cycles");
			console.log("12-second real-time hold: every logo animation reached at least its third cycle and kept moving");
		}
		const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, animation: getComputedStyle(document.querySelector(".cpo-boot-track"), "::after").animationName, background: getComputedStyle(document.body).backgroundColor }));
		assert.equal(layout.overflow, false, "No horizontal overflow");
		if (reducedMotion === "reduce") {
			assert.equal(layout.animation, "none");
			assert.equal(await page.locator(".cpo-boot-core").evaluate(el => getComputedStyle(el).animationName), "none");
			assert.equal(await page.locator(".cpo-boot-flow").first().isVisible(), false);
		} else {
			const moving = await page.evaluate(() => {
				const node = document.querySelector(".cpo-boot-core"), flow = document.querySelector(".cpo-boot-flow");
				const animations = document.querySelector(".cpo-boot-visual").getAnimations({ subtree: true });
				animations.forEach(animation => { animation.pause(); animation.currentTime = 0; });
				const before = [getComputedStyle(node).transform, getComputedStyle(flow).strokeDashoffset];
				animations.forEach(animation => { animation.currentTime = 700; });
				const after = [getComputedStyle(node).transform, getComputedStyle(flow).strokeDashoffset];
				animations.forEach(animation => { animation.currentTime = 2200; });
				const tailBefore = [getComputedStyle(flow).strokeDashoffset, getComputedStyle(document.querySelector('.cpo-boot-node[style="--node-delay: 0s"]')).opacity];
				animations.forEach(animation => { animation.currentTime = 3000; });
				const tailAfter = [getComputedStyle(flow).strokeDashoffset, getComputedStyle(document.querySelector('.cpo-boot-node[style="--node-delay: 0s"]')).opacity];
				animations.forEach(animation => animation.play());
				return { before, after, tailBefore, tailAfter };
			});
			assert.notEqual(moving.before[0], moving.after[0], "Logo core really breathes over time");
			assert.notEqual(moving.before[1], moving.after[1], "Connections really animate over time");
			assert.notEqual(moving.tailBefore[0], moving.tailAfter[0], "Flow must not freeze in the second half of each cycle");
			assert.notEqual(moving.tailBefore[1], moving.tailAfter[1], "Nodes must not freeze in the second half of each cycle");
		}
		if (colorScheme === "dark") assert.notEqual(layout.background, "rgb(255, 255, 255)");
		await page.locator(".cpo-boot-footer").waitFor({ state: "visible" });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await page.screenshot({ path: `/tmp/research-connected-boot-${name}.png`, fullPage: true });
		assert.equal(requests, 1, "Preload and script share one request");
		release();
		await page.locator(".cpo-bar #cpo-web-chrome").waitFor();
		assert.ok((await page.title()).includes("文现"));
		assert.equal(await page.locator(".cpo-brand strong").innerText(), "文现");
		assert.equal(await page.locator(".cpo-brand").isVisible(), true);
		assert.equal(await page.locator(".cpo-boot").count(), 0, "Loading screen disappears as soon as app mounts");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Brand must fit the workbench on mobile");
		if (name === "light" || name === "mobile") await page.screenshot({ path: `/tmp/research-connected-workbench-${name}.png`, fullPage: true });
		assert.deepEqual(errors, []);
		await context.close();
	}
	console.log("Boot: light/dark/mobile/short viewport, reduced motion, single bundle and immediate handoff passed");
} finally { await browser.close(); }
