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
assert.match(css, /\.cpo-stage:hover \.cpo-zoom/, "zoom chrome appears on graph hover");
assert.match(css, /\.cpo-detail-source-actions/, "source links sit beside the selected paper");
assert.match(css, /\.cpo-actions-bar \.cpo-tool-row,[\s\S]*?flex-wrap: wrap;/, "actions must wrap instead of overflow");
assert.doesNotMatch(css.slice(css.lastIndexOf("Shared Research Connected surface contract")), /overflow-x:\s*auto/, "final surface contract must not restore hidden horizontal actions");
assert.match(responsive, /NARROW_SURFACE_WIDTH = 780/, "one responsive breakpoint must drive both surfaces");
assert.match(responsive, /NARROW_EMBED_WIDTH = 560/, "embed stays side-by-side in the default note column");
assert.match(app, /observeResponsiveMode\(root/, "pane must use shared responsive state");
assert.match(embed, /observeResponsiveMode\(shell/, "embed must use shared responsive state");
assert.match(embed, /defaultWidth:\s*260/, "embed evidence rail starts at the minimum width");
assert.match(app, /mountGraphKey\(rail/, "pane legend sits in the left rail");
assert.match(embed, /mountGraphKey\(rail/, "embed legend sits in the left rail");
	assert.doesNotMatch(app, /buildPathToggle/, "pane has no path-to-seed toggle");
	assert.doesNotMatch(embed, /buildPathToggle/, "embed has no path-to-seed toggle");
	assert.doesNotMatch(css, /cpo-path-toggle/, "path toggle styles are gone");
assert.match(app, /scrubHost,/, "pane year play sits in the left rail");
assert.match(embed, /scrubHost,/, "embed year play sits in the left rail");
assert.match(embed, /诊断候选/, "embed exposes candidate diagnosis");
assert.match(app, /cpo-evidence-header[\s\S]*?诊断候选/, "pane exposes candidate diagnosis in evidence header");
assert.doesNotMatch(app, /cpo-rail-filter/, "pane has no filter tab");
assert.doesNotMatch(embed, /cpo-rail-filter/, "embed has no filter tab");
assert.match(css, /\.cpo-graph-key\b/, "graph key strip is styled");
assert.match(css, /@keyframes cpo-classic-breath/, "classic glow is keyed in the legend");
assert.match(readFileSync("src/filter-controls.ts", "utf8"), /经典文献/, "legend names classic papers");
assert.match(readFileSync("src/filter-controls.ts", "utf8"), /种子文献/, "legend names the seed");
assert.match(readFileSync("src/filter-controls.ts", "utf8"), /引用团/, "grouped layout keeps community color");
assert.doesNotMatch(readFileSync("src/filter-controls.ts", "utf8"), /年归一/, "size copy is gone");
assert.doesNotMatch(readFileSync("src/filter-controls.ts", "utf8"), /weak/, "weak-edge chip is gone from the legend");
assert.match(embed, /semanticScholarApiKey\.trim\(\)/, "embed cache must include S2 key presence");
assert.match(app, /cpo-node-menu/, "pane has a node context menu");
assert.match(app, /设为种子/, "pane can reassign the seed");
assert.match(app, /rememberGrafted|graftedBySeed/, "pane persists deep-dug grafts");
assert.match(css, /\.cpo-node-menu\[hidden\]/, "node menu hides with hidden");
assert.match(css, /\.cpo-panel-toggle\b/, "panel collapse toggles are styled");
assert.match(app, /is-rail-collapsed/, "pane can collapse the left rail");
assert.match(app, /is-sidebar-collapsed/, "pane can collapse the evidence rail");
assert.match(embed, /is-rail-collapsed/, "embed can collapse the left rail");
assert.doesNotMatch(embed, /expandAround/, "embed does not graft neighbors yet");
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
