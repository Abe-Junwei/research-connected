import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/ime-input.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	logLevel: "silent",
});
const loaded = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(loaded, loaded.exports);
const { isImeConfirmingEnter, isImeSubmit, IME_CONFIRM_WINDOW_MS } = loaded.exports;

const enter = (overrides) => ({ key: "Enter", isComposing: false, timeStamp: 100, ...overrides });

assert.equal(isImeConfirmingEnter(enter({ isComposing: true }), null), true, "composing Enter does not submit");
assert.equal(isImeConfirmingEnter(enter({ timeStamp: 100 }), 80), true, "Enter just after compositionend does not submit");
assert.equal(isImeConfirmingEnter(enter({ timeStamp: 100 }), 100 - IME_CONFIRM_WINDOW_MS), false, "the guard window is exclusive");
assert.equal(isImeConfirmingEnter(enter({ timeStamp: 200 }), 100), false, "a later Enter submits");
assert.equal(isImeConfirmingEnter(enter({ key: "a", isComposing: true }), null), false, "non-Enter keys are ignored");
assert.equal(isImeSubmit({ timeStamp: 100 }, true, null), true, "submit during composition is blocked");
assert.equal(isImeSubmit({ timeStamp: 100 }, false, 90), true, "submit in the composition window is blocked");
assert.equal(isImeSubmit({ timeStamp: 200 }, false, 100), false, "a later submit runs");

console.log("ime checks passed");
