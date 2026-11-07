import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
const compiled = await build({ entryPoints: ["web/theme.ts"], bundle: true, platform: "browser", format: "cjs", write: false });
const saved = new Map();
function environment() {
 class Element {
  style = { setProperty: (key, value) => { this.style[key] = value; } };
  classes = new Set();
  classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key) };
  attributes = new Map(); events = new Map(); lang = "zh-CN";
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(key, callback) { this.events.set(key, callback); }
 }
 const root = new Element(), body = new Element(), app = new Element(), button = new Element();
 const mediaListeners = new Set(), storage = new Map();
 const media = { matches: false, addEventListener: (_key, callback) => mediaListeners.add(callback), removeEventListener: (_key, callback) => mediaListeners.delete(callback) };
 let redraws = 0;
 const window = { localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, matchMedia: () => media, dispatchEvent: event => { if (event.type === "research-connected-theme") redraws++; }, addEventListener: (key, callback) => storage.set(key, callback) };
 const document = { documentElement: root, body, querySelector: selector => ({ "#app": app, ".cpo-surface": app, "#cpo-theme-toggle": button })[selector] ?? null };
 const module = { exports: {} };
 vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, window, document, HTMLElement: Element, HTMLButtonElement: Element, Event: class { constructor(type) { this.type = type; } } });
 module.exports.initTheme(); module.exports.wireThemeControls();
 return { ...module.exports, root, app, button, media, mediaListeners, storage, redraws: () => redraws };
}
const a = environment();
assert.equal(a.button.attributes.get("aria-pressed"), "false");
a.media.matches = true; for (const callback of a.mediaListeners) callback({ matches: true });
assert.equal(a.button.attributes.get("aria-pressed"), "true");
a.button.events.get("click")();
assert.equal(saved.get(a.THEME_STORAGE_KEY), "light");
assert.equal(a.mediaListeners.size, 0);
assert.equal(a.app.style["--background-primary"], "#ffffff");
a.button.events.get("click")();
assert.equal(a.app.style["--background-primary"], "#1a1d24");
assert.ok(a.root.classes.has("theme-dark"));
assert.ok(a.redraws() >= 4);
const b = environment();
assert.equal(b.button.attributes.get("aria-pressed"), "true");
saved.set(a.THEME_STORAGE_KEY, "light"); a.storage.get("storage")({ key: a.THEME_STORAGE_KEY });
assert.equal(a.button.attributes.get("aria-pressed"), "false");
console.log("verify-web-theme: system changes, manual toggle, CSS tokens, canvas notification, reload and cross-tab sync passed");
const quotaCode = await build({ entryPoints: ["web/quota-client.ts"], bundle: true, platform: "browser", format: "cjs", write: false });
const quotaModule = { exports: {} };
vm.runInNewContext(quotaCode.outputFiles[0].text, { module: quotaModule, exports: quotaModule.exports });
const status = { browser_remaining: 9, browser_limit: 10, site_remaining: 498, site_limit: 500, reset_at: "2026-11-07T08:00:00+08:00", openalex_budget_remaining_usd: 0.998, reason: "" };
const summary = quotaModule.exports.formatQuotaBanner(status);
assert.equal(summary, "浏览器剩余 9/10 · 全站剩余 498/500");
const details = quotaModule.exports.formatQuotaDetails(status);
assert.ok(details[0].includes("北京时间重置"));
assert.ok(details[1].includes("$0.9980"));
assert.ok(details[2].includes("500") && details[2].includes("数据源"));
console.log("verify-web-quota-display: toolbar counts only; reset, budget and limits in info details");
