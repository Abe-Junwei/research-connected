import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

// Run with npm exec --package=@playwright/test -- node scripts/capture-readme.mjs.
const packageBin = process.env.PATH?.split(delimiter).find(path => path.includes("_npx") && path.endsWith("node_modules/.bin"));
const require = createRequire(packageBin ? join(packageBin, "../package.json") : import.meta.url);
const { chromium } = require("playwright");
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:8766";
const output = resolve("docs/images");
const executablePath = process.env.CHROME_PATH;
if (executablePath) assert.ok(existsSync(executablePath), "CHROME_PATH must point to a browser executable");
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ executablePath });
try {
	const context = await browser.newContext({
		viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2,
		reducedMotion: "reduce", locale: "en-US",
	});
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.goto(`${base}/preview/index.html?demo=1&lang=en`);
	await page.getByRole("button", { name: "Build", exact: true }).waitFor({ state: "visible", timeout: 120000 });
	await page.getByRole("heading", { name: "Deep learning", exact: true }).waitFor();
	assert.match(await page.locator("footer").innerText(), /50 papers/, "capture needs a complete 50-node example");
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	await page.getByRole("tab", { name: "Frequently cited references", exact: true }).click();
	await page.evaluate(() => document.fonts.ready);
	const captures = [];
	const capture = async (name, mode, theme) => {
		await page.mouse.move(1590, 990);
		await page.waitForTimeout(1500);
		assert.equal(await page.evaluate(() => devicePixelRatio), 2);
		assert.equal(await page.evaluate(() => innerWidth), 1600);
		const image = await page.screenshot({ path: join(output, name), animations: "disabled" });
		assert.equal(image.readUInt32BE(16), 3200);
		assert.equal(image.readUInt32BE(20), 2000);
		captures.push({ file: name, mode, theme, width: 3200, height: 2000 });
		console.log(`Captured ${name}`);
	};
	await capture("graph-pane.png", "planar", "light");
	await page.getByRole("button", { name: "Switch to dark theme" }).click();
	await capture("graph-pane-dark.png", "planar", "dark");
	await page.getByRole("button", { name: "Year", exact: true }).click();
	await capture("timeline-dark.png", "timeline", "dark");
	await page.getByRole("button", { name: "Switch to light theme" }).click();
	await capture("timeline.png", "timeline", "light");
	await page.goto(`${base}/preview/embed.html?lang=en&layout=temporal&reading=1`);
	await page.locator("canvas").waitFor();
	await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')]
		.some(node => /Deep learning.*50 papers/.test(node.getAttribute("title") ?? "")), undefined, { timeout: 120000 });
	await page.getByRole("button", { name: "Fit to view", exact: true }).click();
	await capture("note-embed.png", "note embed", "light");
	await page.getByRole("button", { name: "Switch to dark theme" }).click();
	await capture("note-embed-dark.png", "note embed", "dark");
	assert.deepEqual(errors, [], "preview must not throw JavaScript errors");
	writeFileSync(join(output, "screenshots.json"), JSON.stringify({
		capturedAt: new Date().toISOString(),
		source: "Current local development preview, not the Obsidian host or a published release",
		sample: "Deep learning (2015), DOI 10.1038/nature14539; live public metadata, sampled graph",
		viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
		captures,
	}, null, 2) + "\n");
	console.log(`Captured ${captures.length} development-preview screenshots at 3200 × 2000.`);
} finally {
	await browser.close();
}
