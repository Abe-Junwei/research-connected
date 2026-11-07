import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const html = readFileSync("web/dist/index.html", "utf8");
const script = html.match(/<script defer src="\.\/([^\"]+)"/)[1];
assert.ok(html.includes(`rel="preload" href="./${script}" as="script"`));
assert.equal((html.match(/<script[^>]+src=/g) || []).length, 1);
assert.ok(html.includes('class="cpo-boot"') && html.includes("<noscript>"));
const css = html.match(/<style id="cpo-app-styles">([\s\S]*?)<\/style>/)[1];
assert.ok(!html.includes('rel="stylesheet"'), "First paint must not wait for an external stylesheet");
const raw = readFileSync(`web/dist/${script}`);
assert.deepEqual(brotliDecompressSync(readFileSync(`web/dist/${script}.br`)), raw);
assert.deepEqual(gunzipSync(readFileSync(`web/dist/${script}.gz`)), raw);
assert.ok(css.length < readFileSync("styles.css", "utf8").length);
console.log("Web performance build: one preloaded/deferred bundle, boot content, minified CSS and lossless compressed assets: passed");
