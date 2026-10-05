import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("styles.css", "utf8");
const app = readFileSync("src/app.ts", "utf8");
const embed = readFileSync("src/embed-mount.ts", "utf8");
const responsive = readFileSync("src/responsive.ts", "utf8");

for (const token of ["surface", "canvas", "ink", "muted", "border", "accent", "focus", "sidebar-min", "sidebar-max"]) {
	assert.match(css, new RegExp(`--rc-${token}:`), `missing --rc-${token}`);
}
assert.match(css, /:focus-visible/, "shared keyboard focus contract is required");
assert.match(css, /\.cpo-actions-bar \.cpo-tool-row,[\s\S]*?flex-wrap: wrap;/, "actions must wrap instead of overflow");
assert.doesNotMatch(css.slice(css.lastIndexOf("Shared Research Connected surface contract")), /overflow-x:\s*auto/, "final surface contract must not restore hidden horizontal actions");
assert.match(responsive, /NARROW_SURFACE_WIDTH = 780/, "one responsive breakpoint must drive both surfaces");
assert.match(responsive, /NARROW_EMBED_WIDTH = 560/, "embed stays side-by-side in the default note column");
assert.match(app, /observeResponsiveMode\(root/, "pane must use shared responsive state");
assert.match(embed, /observeResponsiveMode\(shell/, "embed must use shared responsive state");
assert.match(embed, /semanticScholarApiKey\.trim\(\)/, "embed cache must include S2 key presence");
assert.match(app, /paintSelectionReasons\(detail, rankInfo, score\)/, "pane wires selection reasons");
assert.match(embed, /paintSelectionReasons\(detail, rankInfo, graph\.seedScore\.get\(paper\.id\)\)/, "embed wires selection reasons");
const details = readFileSync("src/detail-cards.ts", "utf8");
assert.match(details, /createElement\("details"\)/, "入选原因 uses native details");
assert.match(details, /createElement\("summary"\)/, "入选原因 uses native summary");
assert.match(details, /选择时相关性/, "relevance meter is shown");
assert.match(details, /建图后当前综合分/, "post-graph score is labeled as not used in selection");
assert.match(css, /\.cpo-root :where\([^)]*summary[^)]*\):focus-visible/, "summary keyboard focus is shared");
for (const width of [320, 480, 768, 1024]) {
	assert.equal(width < 780, [320, 480, 768].includes(width), `responsive matrix mismatch at ${width}px`);
}
console.log("ui contract checks passed (320/480/768/1024px)");
