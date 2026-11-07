import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
const result = await build({ entryPoints: ["web/session-auth.ts"], bundle: true, platform: "browser", format: "cjs", write: false });
const store = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };
const shared = store();
let sequence = 0;
let lock = Promise.resolve();
const locks = { request: (_name, callback) => { const pending = lock.then(callback); lock = pending.catch(() => {}); return pending; } };
const sessions = new Map();
function tab() {
 const sessionStorage = store();
 const module = { exports: {} };
 const window = { localStorage: shared, sessionStorage, fetch: async (_path, options) => {
  const previous = options.headers["X-Browser-Token"];
  const token = sessions.has(previous) ? previous : `token-${++sequence}`;
  const nonce = `nonce-${++sequence}`;
  sessions.set(token, [...(sessions.get(token) ?? []), nonce]);
  return { ok: true, json: async () => ({ browser_token: token, session_nonce: nonce, expires_at: Date.now() / 1000 + 43200 }) };
 } };
 vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, window, navigator: { locks }, AbortSignal, Date });
 return { ...module.exports, sessionStorage };
}
const a = tab(), b = tab();
await Promise.all([a.ensureSession(), b.ensureSession()]);
assert.equal(a.sessionHeaders()["X-Browser-Token"], b.sessionHeaders()["X-Browser-Token"]);
assert.notEqual(a.sessionHeaders()["X-Session-Nonce"], b.sessionHeaders()["X-Session-Nonce"]);
const before = a.sessionHeaders();
const c = tab(); await c.ensureSession();
assert.deepEqual(a.sessionHeaders(), before);
a.sessionStorage.setItem("research-connected-session-expiry", "0");
await a.ensureSession();
assert.equal(a.sessionHeaders()["X-Browser-Token"], before["X-Browser-Token"]);
assert.notEqual(a.sessionHeaders()["X-Session-Nonce"], before["X-Session-Nonce"]);
assert.ok(sessions.get(before["X-Browser-Token"]).includes(b.sessionHeaders()["X-Session-Nonce"]));
console.log("verify-web-session: concurrent tabs, reopen and expiry preserve identity and independent credentials");
const versionCode = await build({ entryPoints: ["web/version.ts"], bundle: true, platform: "browser", format: "cjs", write: false, define: { __WEB_BUILD__: '"old-build"' } });
const versionModule = { exports: {} };
let current = { build: "new-build", minClientApi: 2 }, busy = true, reloads = 0, banner;
const createElement = () => ({ hidden: false, children: [], setAttribute() {}, append(child) { this.children.push(child); }, set textContent(value) { this.text = value; this.children = []; } });
const windowMock = { fetch: async () => ({ ok: true, json: async () => current }), setInterval() {}, location: {
 href: "https://graph.jieyu.ai/?paper=W1&v=old-build#node",
 reload: () => { reloads++; },
 replace: target => { reloads++; windowMock.location.href = target; },
} };
const documentMock = { hidden: false, createElement, querySelector: () => ({ after: node => { banner = node; } }), addEventListener() {} };
vm.runInNewContext(versionCode.outputFiles[0].text, { module: versionModule, exports: versionModule.exports, window: windowMock, document: documentMock, AbortSignal, Error, URL });
versionModule.exports.watchVersion(() => busy);
await versionModule.exports.requireCompatibleClient();
assert.equal(reloads, 0);
assert.equal(banner.children[0].disabled, true);
banner.children[0].onclick(); assert.equal(reloads, 0);
busy = false;
await versionModule.exports.requireCompatibleClient();
assert.equal(banner.children[0].disabled, false);
banner.children[0].onclick(); assert.equal(reloads, 1);
const refreshed = new URL(windowMock.location.href);
assert.equal(refreshed.searchParams.get("v"), "new-build", "Explicit update must bypass cached HTML for the old release");
assert.equal(refreshed.searchParams.get("paper"), "W1");
assert.equal(refreshed.hash, "#node");
current = { build: "new-build", minClientApi: 3 };
await assert.rejects(versionModule.exports.requireCompatibleClient(), /版本/);
current = { build: "old-build", minClientApi: 2 };
await versionModule.exports.requireCompatibleClient(); assert.equal(banner.hidden, true);
console.log("verify-web-version: update waits for tasks, incompatible client blocked, rollback hides stale notice");
