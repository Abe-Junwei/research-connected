import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const html = readFileSync("web/dist/index.html", "utf8");
assert.match(html, /<style id="cpo-app-styles">/, "standalone page inlines the shared stylesheet");
assert.match(html, /overscroll-behavior:\s*contain/, "built page contains modal scroll containment");
assert.match(html, /text-wrap:\s*balance/, "built page contains balanced headings");
assert.match(html, /text-wrap:\s*pretty/, "built page contains pretty body wrapping");
assert.match(html, /color-scheme:\s*light/, "built page contains the light native scheme");
assert.match(html, /color-scheme:\s*dark/, "built page contains the dark native scheme");
assert.match(html, /accent-color:/, "built page contains the accent for native controls");
assert.doesNotMatch(html, /scrollbar-width:\s*(?:none|thin)/, "built page does not hide or thin scrollbars");

const jsName = readdirSync("web/dist").find((name) => name.startsWith("web-") && name.endsWith(".js"));
assert.ok(jsName, "web build emits a hashed script");
const js = readFileSync(`web/dist/${jsName}`, "utf8");
assert.match(js, /compositionend/, "web bundle includes the IME composition guard");
assert.match(js, /isComposing/, "web bundle checks KeyboardEvent.isComposing");
assert.match(js, /closedby/, "web bundle marks dialogs as backdrop-dismissible");
assert.match(js, /aria-labelledby/, "web bundle names dialogs from their headings");
assert.doesNotMatch(js, /require\(["']obsidian["']\)/, "web bundle does not load the Obsidian module");

console.log(`web MWG bundle checks passed (${jsName})`);
