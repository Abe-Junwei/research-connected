import assert from "node:assert/strict";

import vm from "node:vm";
import { build } from "esbuild";
const code = (await build({ entryPoints: ["web/storage.ts"], bundle: true, format: "cjs", write: false })).outputFiles[0].text;
const module = { exports: {} };
const storageProxy = { setItem: (key, value) => storage.setItem(key, value) };
vm.runInNewContext(code, { module, exports: module.exports, DOMException, window: { localStorage: storageProxy } });
const { StorageFullError, writeWebProjectSettings } = module.exports;

const memory = new Map([["keep", JSON.stringify({ researchProjects: { old: { snapshot: { nodes: [1] } } } })]]);
const storage = {
	getItem: (k) => (memory.has(k) ? memory.get(k) : null),
	setItem(k, v) {
		if (String(v).length > 40) throw new DOMException("full", "QuotaExceededError");
		memory.set(k, v);
	},
};

assert.ok(storage.getItem("keep"));
assert.throws(
	() => writeWebProjectSettings("settings", { researchProjects: { a: { snapshot: { nodes: [1, 2, 3, 4, 5, 6, 7, 8] } } } }),
	(error) => error instanceof StorageFullError,
);
assert.ok(storage.getItem("keep"), "quota failure must not delete existing projects");
assert.equal(memory.has("settings"), false, "failed write must not partially replace");
console.log("verify-web-storage: ok");
