import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const entry = 'export { writeWebProjectSettings as save, sourceReviewPaused, pauseSourceReview, StorageFullError } from "./web/storage";';
const code = (await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, alias: { obsidian: "./scripts/obsidian-stub.ts" }, format: "cjs", platform: "browser", write: false })).outputFiles[0].text;
const before = JSON.stringify({ researchProjects: { W1: { name: "Saved project", padding: "x".repeat(1500) } } });
const after = { researchProjects: { W1: { name: "Updated source", padding: "x".repeat(1500) } } };
const data = new Map([["settings", before]]);
let capacity = 2000;
const storage = {
	getItem: key => data.get(key) ?? null,
	setItem(key, value) {
		const next = new Map(data); next.set(key, value);
		if ([...next.values()].reduce((sum, text) => sum + text.length, 0) > capacity) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
		data.set(key, value);
	},
};
const module = { exports: {} };
const session = new Map();
vm.runInNewContext(code, { module, exports: module.exports, window: { localStorage: storage, sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) } }, DOMException, Date, URL, Map, Set, structuredClone });
module.exports.save("settings", after);
assert.equal(data.get("settings"), JSON.stringify(after), "Source review must fit when atomic replacement fits; it must not require a second complete project copy");
capacity = 1600;
const saved = data.get("settings");
assert.throws(() => module.exports.save("settings", { ...after, padding: "x".repeat(1000) }), error => error.name === "StorageFullError");
assert.equal(data.get("settings"), saved, "Real full-storage failures preserve the original project");
assert.equal(module.exports.sourceReviewPaused("settings"), false);
module.exports.pauseSourceReview("settings", true);
assert.equal(module.exports.sourceReviewPaused("settings"), true, "Pause survives a page reload in this tab");
module.exports.pauseSourceReview("settings", false);
assert.equal(module.exports.sourceReviewPaused("settings"), false, "Successful save or explicit cleanup permits review again");
console.log("Source review: atomic replacement without duplicate snapshot; full storage preserves project: passed");
