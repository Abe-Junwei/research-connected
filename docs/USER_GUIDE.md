# Research Connected — User and technical guide

An Obsidian plugin that draws a **similarity map** around one **Seed paper**, in the spirit of [Connected Papers](https://www.connectedpapers.com/). The product is an interactive 2D canvas graph in its own pane and inside notes.

See the [canonical terminology glossary](../GLOSSARY.md) for user-facing terms and their meaning.

The plugin targets **Obsidian desktop 1.14.4 or newer**. The local development preview has not completed full acceptance in the actual Obsidian host. Mobile support awaits device testing.

It is not a sidebar of citation cards. Reference Map / Literature Flow–style index lists are an explicit non-goal. This project is not affiliated with Connected Papers.

## Development preview (unreleased)

This checkout contains work tracked in [PR #10](https://github.com/Abe-Junwei/research-connected/pull/10); it is not a claim about the latest published release. The README images show a local development preview, **not the Obsidian app**, and do not establish host compatibility. Their capture date and dimensions are in [the screenshot manifest](images/screenshots.json).

- **Reading status.** A paper’s reading status is shared across projects and confirmed version groups; saved papers and exclusions are project-specific. Conflicts require review.
- **Evidence and selection.** Citation paths, structural similarity, semantic similarity, and missing evidence are distinct. Semantic similarity may use compatible vectors and local text/topic signals; it does not certify research quality.
- **Map cues.** Node size follows citation counts. The high-citation indicator is a heuristic, not an authoritative assessment. Motion respects the operating system’s reduced-motion preference.
- **Projects and notes.** Save a project separately from saving an individual paper. Note embeds and the main graph share the reading and evidence workflow.

## Rename

The display name is **Research Connected**. The plugin id is `research-connected`.

Earlier builds used the id `connected-papers-openalex` and the folder `<vault>/.obsidian/plugins/connected-papers-openalex/`. That id does not carry over. After you install this build:

1. Turn off **Connected Papers (OpenAlex)** if it is still enabled.
2. Remove the old folder `connected-papers-openalex`.
3. Enable **Research Connected** from `research-connected`.

Plugin settings (the OpenAlex API key) live in that folder’s `data.json`. Copy the old `data.json` into the new folder before you reload if you want to keep the key. Notes that already use a `connected-papers` fence keep working. `research-connected` is the same fence.

The graph is built from the public [OpenAlex](https://openalex.org/) works API.

## Network use and local data

Building a graph or searching for a paper sends its DOI, OpenAlex ID, or search text to OpenAlex. The plugin may request abstracts, reference data, or citation evidence from Semantic Scholar, Crossref, and OpenCitations. Requests can fail or return no match; neither outcome proves that a source has no record. Paper identifiers and, if configured, the relevant service’s key or token are sent to that service. An optional contact email is sent to Crossref as contact information and included in OpenAlex requests; it does not guarantee a higher request limit.

The optional research narrative is off by default. Only when you click Generate does it send the selected papers and available citation evidence to your configured language-model endpoint; abstracts are included only if that option is enabled. Projects, reading status, saved papers, exclusions, and service credentials are stored in this vault’s plugin `data.json`. Credentials are **not encrypted**; vault sync or backup tools may copy the file. The plugin sends no usage telemetry and reads note properties (YAML frontmatter) to recognize literature notes. See [Settings](#settings) for service behavior.

The source code is available under the [GNU Affero General Public License v3.0](../LICENSE).

## Interface language

The graph pane, note embeds, settings, controls, and plugin messages follow Obsidian's interface language. Simplified Chinese is used for Chinese locales; English is used for other locales. Reload the plugin after changing Obsidian's language. Paper titles, author names, abstracts, and saved user content retain their original language.

## Build

```bash
npm install
npm run build
```

`npm run build` typechecks, then bundles `src/main.ts` to `main.js`. You need Node 18+.

Loadable plugin files:

| File | Role |
| --- | --- |
| `main.js` | Bundled plugin (generated) |
| `manifest.json` | Plugin id `research-connected` |
| `styles.css` | Pane styles |

### Refreshing documentation screenshots

Build the latest preview with `npm run preview`, then serve the repository locally, for example with `python3 -m http.server 8766 --bind 127.0.0.1`. In another terminal run:

```bash
npm exec --yes --package=@playwright/test -- node scripts/capture-readme.mjs
```

This temporary runner requires a Playwright Chromium installation. To use an existing browser instead, set `CHROME_PATH` to its executable; on macOS, for example, `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Set `PREVIEW_URL` if the server is on another port. The script starts a fresh browser context, loads live public metadata without credentials, fits the graph, and captures planar, timeline, and note-embed views in both themes. Each PNG is checked for **3200 × 2000** physical pixels from a **1600 × 1000** viewport at **2×** scale. It also checks for uncaught JavaScript errors and records capture metadata in `docs/images/screenshots.json`.

The note example is available at `preview/embed.html?lang=en&layout=temporal&reading=1`; it changes only the surrounding example prose, not the graph data or evidence. `?fixture=1` still uses the separate small offline test fixture. Service limitations remain visible in screenshots; do not remove warnings or present local-preview images as real-host acceptance evidence. The README uses theme-aware pictures with explicit links to both originals. Stop the local server when finished.

## Install

1. Build the plugin (above).
2. Copy `main.js`, `manifest.json`, and `styles.css` into:

   ```text
   <vault>/.obsidian/plugins/research-connected/
   ```

3. Reload Obsidian (or restart it). If a previous copy failed to load, replace `main.js` and `manifest.json` with this build, reload, then turn the plugin off and on again.
4. Settings → Community plugins → turn on **Research Connected**.

Restricted mode must be off, or Obsidian will not load community plugins.

## Usage

1. Command palette → **Open Research Connected** (the command name follows Obsidian's interface language).
   The same command is on the ribbon (monochrome network icon).
   The view opens as a **main-area tab** titled “Research Connected”, not in the sidebars.
2. In the pane, enter a seed:
   - DOI (`10.1038/nature14539` or `https://doi.org/...`)
   - OpenAlex work id (`W2919115771`) or an `openalex.org` work URL
   - or a title. Title search shows up to 8 hits; click one to make it the **Seed paper**.
3. Press **Build** to load the map.
4. The Seed paper sits in the middle with a double ring and a halo. Other papers are placed by similarity:
   - in **Planar**, node colors identify detected citation-structure groups; in **Year** and **Radial**, color shows topic similarity
   - node size follows log-scaled citation counts; some eligible papers show a high-citation indicator
   - line weight follows structural similarity; missing evidence is shown separately
5. Drag a node to move it. Drag the background to pan. Scroll to zoom. **+ / − / Fit to view** zoom and fit the map. On touch screens, pinch with two fingers to zoom. With the canvas focused, the arrow keys pan, `+` / `-` zoom, and `0` or `F` fits.
6. Hover a node for its title. Click it for the detail sheet: title, authors, year, citation count, how it relates to the seed, a short abstract, **OpenAlex**, and **DOI** when a DOI exists.
7. Controls and command names follow Obsidian’s interface language.

The current navigation is organized around visible controls: project selection and **Save project** at the top, layout choices on the left, paper details and saved-paper lists on the right, and content tabs at the bottom of the right panel. There is no separate filter panel. Use **Save paper** for an individual paper; that action is distinct from **Save project**.

Resizing the window or sidebar preserves the current graph center, including during an animated zoom. Use **Fit to view** at the top-right of the graph to recenter all visible papers.

While a request is in flight the button reads **Building…**. Failures show a message and leave the previous map in place.

The status bar shows paper and edge counts, plus a partial-data warning when needed. Click **Sampling details / 采样详情** to expand the sampling page, request, and filtering counts, together with Semantic Scholar (S2) and OpenCitations diagnostics; these details are not limited to hover text.

## Embed a graph in a note

A fenced block renders the same neighborhood as an interactive **2D canvas** graph inside the note. The language can be `connected-papers` or `research-connected`. Reading view and Live Preview both mount it. While the cursor is inside the fence, Obsidian shows the source; leaving the block builds the graph again — the zoom, filters, and layout you chose are remembered across that rebuild. The command-palette pane uses the same canvas renderer.

The fence is the anchor in the note. `position` changes how that block sits among the surrounding paragraphs; its location in the note determines where the graph appears.

````markdown
```connected-papers
doi: 10.1038/nature14539
# optional
position: inline
width: 100%
height: 520
align: center
labels: author-year
maxNodes: 40
depth: 1
```
````

| Line | Required | Meaning |
| --- | --- | --- |
| `doi:` | one seed | DOI, with or without `https://doi.org/`. |
| `openalex:` / `id:` / `seed:` | one seed | OpenAlex work id (`W2919115771`) or a DOI. A bare DOI or `W…` id on its own line also works. |
| `position:` | no | `inline` (default, in the column), `float-left`, `float-right` (beside the following text), or `full` (clear floats and span the note column). |
| `width:` | no | `420`, `420px` (240–1400), `60%` (30–100), `24em`, or `24rem`. Default `100%`. Floats default to `420px` when `width` is omitted. |
| `height:` | no | Graph area in pixels, clamped to 280–900. Default **480**. |
| `align:` | no | `left` (default), `center`, or `right`. Centers or right-aligns a block that is narrower than the column. Ignored for floats. |
| `labels:` | no | `author-year` (default: family name and year on each node), `title`, `both`, or `off`. Overlapping labels drop out; the seed, the selection, and the node under the pointer stay. |
| `maxNodes:` | no | 20–300. Overrides the setting for this block only. Default is the setting (50). |
| `depth:` | no | `1` (default) is the seed neighborhood. `2` also samples references of the two closest papers, up to the node cap. |
| `yearFrom:` / `yearTo:` | no | Inclusive year range for the other papers. The seed stays. If both are set and reversed, they are swapped. |
| `language:` / `type:` / `concept:` | no | Preset filters. They apply only when OpenAlex included that field (`language`, `type`, `concepts`). |
| `minCoCite:` / `minShared:` | no | Hide co-citation edges below that count, and coupling edges below that shared-reference count. Default 1. |
| `layout:` | no | `temporal` (default; year on X), `radial` (distance from seed = similarity), or `force2d` (Planar force layout grouped by detected citation communities). Legacy `kumu` / `community` and `force3d` values map to `force2d`. |
| `color:` | no | `topic` (default outside Planar), `community` (default in Planar), `graph` (citation-count ramp), or `year`. |

`full` widens the block by Obsidian’s `--file-margins` (no effect when that variable is 0, as in the dev preview). Title search is not available in the fence. Use the command pane for that. Lines starting with `#` are comments.

Nodes show **author + year** by default. The full title is the hover tooltip and appears in the right-side details panel. The left navigation switches layouts; the right panel shows paper details, saved papers, and other content. Its tabs are at the bottom of that panel. The note embed keeps a compact frame; a deep dive opens in the full graph.

Drag pans the graph. A plain scroll wheel scrolls the note past the graph; hold **⌘/Ctrl** and scroll — or pinch on a trackpad — to zoom, as do **+ / − / Fit to view**. On touch screens one finger scrolls the note and a two-finger pinch zooms and pans. The embed grip at the bottom-right changes the graph area’s width and height after it opens (with the grip focused, the arrow keys resize in steps, faster with Shift); `width` and `height` in the fence are only the starting size. The command pane fills its tab and has no grip.

**Reload** fetches again and skips the short in-memory cache. Click a node for its title, year, citation count, why it connects to the seed, a short abstract, and **OpenAlex** / **DOI** source buttons. Inside Obsidian the detail also offers **Open in workbench**, which jumps to the full workbench on the same seed. The note embed and the workbench both show the graph; the workbench is the wider pane for projects, prior and later work, the research narrative, and export. Hover or click an edge for that pair’s explanation.

Citation edges are arrows (A cites B; mutual cites get both heads). Co-citation and coupling stay undirected. Thickness is three steps, **weak / medium / strong**, matching the graph key. Weak edges start hidden. Hovering or selecting a node highlights its visible one-hop neighbors; press **Shift + arrow** to select a nearby node by direction. Right-click a node for **Exclude**, **Deep dive**, or **Set as seed**. Deep-dug members are remembered per seed and restored on rebuild. Hover or click an edge for the evidence detail: shared-reference count, co-citation count, sources, and the caveat that citation lists can be incomplete.

In an embed, `language`, `type`, and `concept` parameters filter only when OpenAlex supplied the corresponding field. Node size uses log-scaled citation counts of the displayed version; missing counts use the minimum size. Author–year labels stay.

The layout modes are **Planar**, **Year**, and **Radial**. **Year** maps publication year linearly from left to right; unknown-year works sit in a separate left gutter. Vertical position follows log citation count, with small offsets to separate overlaps. **Radial** places papers closer to the Seed paper when their combined ranking signals are higher. **Planar** uses a force layout and groups nodes by communities detected from the sampled citation/similarity graph; node color denotes that algorithmic grouping, not a definitive scholarly school. Outside Planar, node color shows topic similarity to the Seed paper; missing topic metadata is gray. Node size uses citation counts, independent of publication year; the Seed paper has a minimum size and does not set the scale. Filters retain the scale. On **Year**, the band under the graph filters papers after the chosen year and draws one bar per year in the current sample. **Play** advances one year at a time. The Seed paper stays visible. Planar and radial layouts hide that band.

**Frequently cited references** lists works cited by at least two visible papers. **Works citing this graph** lists works that cite at least two visible papers. Both are counts within the current visible sample, not new edge types; they do not imply chronology or intellectual influence.

Edges stay thin neutral gray by default; when you hover or select a node, its links take the color of the sharpest relation, not a blend. The graph key lists them:

| Color | Relation | What the text counts |
| --- | --- | --- |
| Gold | Direct citation | One paper lists the other, or they cite each other. |
| Teal | Co-citation | How many sampled citing papers list both. |
| Indigo | Bibliographic coupling | How many referenced works they share. |
| Gray | Weak link | A fallback link with none of the counts above. |

Thickness is the same three steps as the graph key (weak / medium / strong), not a continuous score. The OpenAlex API key from settings is sent with requests; without a key, the service’s current access limits apply. Rate-limit errors appear inside the block instead of freezing the editor.

`depth: 2` costs a few extra OpenAlex calls. If that second hop fails, the block keeps the depth-1 graph and says so.

## Literature notes

Select a paper, then choose **Export → Write to note**. With nothing selected, the seed is written. Outside Obsidian (the dev preview) the same action copies the note contents instead.

The note goes to **Literature note folder** (created if missing; empty means the vault root). A file with the same name gets a numeric suffix rather than being overwritten. The note properties (YAML frontmatter) are always written:

| Property | Value |
| --- | --- |
| `title`, `authors`, `year` | From OpenAlex. `authors` is one comma-separated string. |
| `doi` | Bare DOI, omitted when the work has none. |
| `openalex` | OpenAlex work URL. |
| `rc-project` | Research project name, or the seed ID when the project is unnamed. |
| `rc-status` | `unread`, `to-read`, or `read`. |

**Literature note filename** and **Literature note body** accept `{{title}}`, `{{authors}}`, `{{year}}`, `{{doi}}`, `{{openalex}}`, `{{relation}}` (how the paper relates to the seed), `{{project}}`, and `{{status}}`. The filename defaults to `{{year}} {{title}}`, drops `\ / : * ? " < > |`, and is cut to 80 characters. An empty body writes a `# title` heading.

The plugin recognizes notes already in the vault by note properties: a DOI match (in `doi` or the property set in **DOI property name**) wins over an `openalex` match. When a paper has a note, its details show **In your notes · Open note**. Reading status is shared across projects and confirmed version groups; saving a paper and excluding it remain project-specific. Opening a paper checks available reading-status sources. Conflicting values require explicit resolution rather than silent overwrites. Changing reading status synchronizes participating notes; external edits pause synchronization for review. Notes without `rc-status` are linked but left untouched until you change the status. Works without a DOI omit the `doi` property.

## Settings

### Evidence sources and optional research narrative

- **Semantic Scholar** can enrich a bounded candidate sample with abstracts, citation/reference counts, and compatible vectors before selection. Its abstracts may add content evidence; compatible vectors can contribute to semantic similarity. When a vector is unavailable or incompatible, local text and topic signals may still be used. An API key is optional; anonymous requests can be rate limited.
- **Crossref** may provide DOI-based abstracts or reference data when other sources do not. **OpenCitations** can add citation evidence between papers in the sampled graph. Neither service provides exhaustive coverage.
- Citation-count differences between sources are warnings, not proof that two records refer to different works. Compare the DOI and original source when identity matters.
- The plugin first uses an available OpenAlex abstract, then may try Semantic Scholar and Crossref when needed. Results distinguish a missing DOI, a completed lookup with no abstract content, and a failed request. A failed request offers **Retry abstract lookup / 重试获取摘要** on the paper card and is not permanently treated as a missing abstract. Redrawing the card does not automatically repeat the same lookup. None of these outcomes proves that the paper has no abstract.
- **Research narrative** is off by default and available only in the graph pane. Generate sends the selected papers and available citation evidence to your configured language-model endpoint; abstracts are included only if that option is enabled. The model may make mistakes, and the sampled graph is not a complete scholarly history.
- Language-model credentials are stored in the vault plugin’s `data.json`, not encrypted. Vault sync or backup tools may copy the file. Disabling the feature does not delete notes exported earlier.

<details>
<summary>Developer checks</summary>

`npm test` runs offline checks without network or model usage; `npm run verify` also checks OpenAlex live. After building the preview, `preview/index.html?fixture=1` uses offline data, and `&llm=1` shows a simulated narrative without calling a real model.

</details>

Settings → Research Connected.

| Setting | Default | What it does |
| --- | --- | --- |
| OpenAlex API key | empty | Sent in the `Authorization: Bearer <API key>` header. Stored in the vault’s plugin data, unencrypted; sync or backup tools may copy it. |
| Contact email | empty | Optional; sent to Crossref as contact information and included in OpenAlex requests. It does not guarantee a higher request limit. |
| Maximum nodes | 50 (range 20–300) | Cap including the Seed paper. Larger maps can take more time and be harder to inspect. Applied on the next build. |
| Sampling depth | standard | Standard, extended, or deep sampling. Deep has an accepted-work target of 200 references and 200 citing works per list; when filtering requires it, up to 1,000 raw records per list may be checked. Without an API key, only the first page is read. |
| Include references | on | Seed's outgoing references. |
| Include citing works | on | Works that cite the seed, also used as co-citation context. |
| Include related works | on | OpenAlex `related_to` recommendations are candidates only; they are not guaranteed to be recent, in the same field, or citation evidence. A cap applies when combined with other sources; there is no guaranteed allocation. |
| Exclude retracted works | off | By default, retracted candidates remain with a warning and ranking penalty. Turn this on to skip them in a new graph. |
| Literature note folder | empty | Folder for **Write to note**. Empty is the vault root. See [Literature notes](#literature-notes). |
| Literature note filename | empty | Filename template. Empty is `{{year}} {{title}}`. |
| Literature note body | empty | Body template under note properties (YAML frontmatter). Empty is a title heading. |
| DOI property name | `doi` | Extra note property checked when matching existing notes. `doi` is always checked. |

Turn off every neighbor toggle and the pane asks you to enable one. The next build uses the new toggles; the current map is not rebuilt automatically.

### Authentication and limits

OpenAlex can be queried without a key, subject to its current access limits. An API key may provide a different limit; check the service’s current policy rather than relying on a fixed quota. A `429` response means the service is limiting requests. Deep sampling checks raw pages of references and citing works toward the accepted-work targets described above; without an OpenAlex API key, it reads only the first page. Request volume varies with sampling, candidate enrichment, cache state, and retries.

<details>
<summary>Sampling, scoring, and data-quality details</summary>

## Algorithm

Connected Papers builds a similarity map from co-citation and bibliographic coupling over a large citation graph. This plugin approximates that with a **sampled** OpenAlex neighborhood. It is not a citation tree and not a ranked list.

1. Resolve the seed work.
2. Sample candidates (most-cited first when a sort applies). The **Sampling depth** setting picks the tier:
   - **standard** — accepted-work targets of 80 references, 40 citing works, and 20 related works
   - **extended** — targets of 200 references, 200 citing works, and 50 related works
   - **deep** — targets of 200 references and 200 citing works, with a maximum of 1,000 raw records checked per reference or citing list, and a target of 100 related works. Without an OpenAlex API key, only the first page is read.
3. Enrich candidates **before** final admission/ranking: OpenAlex details are requested for the seed and up to `min(160, max(80, Maximum nodes × 2))` candidates. Local text/topic rank and candidates missing abstracts with uncertain/cross-disciplinary classifications share this budget. Then S2 enriches the seed and up to 120 DOI-bearing candidates from that shortlist, usually in one batch. Neither budget is a citation-count cutoff. Candidates outside the enhancement budget use available local evidence; no uncalibrated vector threshold automatically admits a field mismatch.
   The 0–1 **Selection score** orders candidates; it is not a relevance probability. The **Citation–recency score** is a citation- and publication-year-based heuristic, not a measure of academic authority or quality. The separate **semantic similarity** signal may combine compatible vectors with local title, abstract, and topic evidence; it is not text-only. The selection-time semantic channel and actual vector model, when used, are saved with the graph snapshot. Older snapshots without this evidence do not infer a channel from the graph’s later state.
4. Keep at most `Maximum nodes − 1` neighbors (20–300):
   - records whose OpenAlex `type` is marked non-research (for example, book reviews, editorials, corrections, or letters) are filtered; the type field can be wrong, so verify the record. The Seed paper itself may still be shown with a warning
   - retracted candidates are included by default with a warning and ranking penalty. Turn on **Exclude retracted works** to skip them. A previously saved Seed paper marked retracted pauses rebuilding and requires review
   - a conservative discipline check runs before selection for all three sources. Topic IDs, scores, subfields, fields, domains, and the primary topic are retained. Shared topics/subfields or the same primary field pass this check; this is eligibility evidence, not proof of content relevance
   - a different primary field needs a shared topic/subfield or an adjacent pair of informative terms from titles, available abstracts, or topic labels. Generic English terms such as `language`, `social`, and `theory` do not supply this phrase evidence. A direct citation or high citation count alone does not override a field mismatch. This first-stage heuristic is not a calibrated semantic threshold
   - missing classification is retained conservatively and marked **relevance uncertain** in the detail card; classification-mismatch rejection reasons are available in candidate inspection. Old snapshots remain readable; rebuild to obtain classifications and eligibility decisions
   - all eligible references, citing works, and related works compete using a ranking heuristic and MMR diversity selection (λ = 0.7). Sources have upper bounds, not guaranteed allocations
   - when references or citing works are enabled, related-only nodes cannot exceed `floor((Maximum nodes − 1) × 0.22)`, including any backfill. If only related works are enabled, they may use all neighbor slots. Too few eligible candidates produce a smaller map; excluded works are never used as filler
   - duplicate OpenAlex IDs are sampled once; source-confirmed version relationships and manual identity decisions determine subsequent work grouping
   - automatic second-layer expansion uses the same seed-relative discipline check. Explicit deep dives may retain cross-disciplinary candidates, but report a warning and mark the evidence in their details; restoring those user-chosen members preserves that choice
5. After selection, fetch only missing details for kept nodes, source aliases, and citing context. The citing sample remains co-citation context even when a citer is not drawn.
6. Compute a structural graph score for each pair:

   ```text
   score = 0.55 * bibliographic coupling
         + 0.35 * co-citation
         + 0.10 * direct citation
   ```

   - **Bibliographic coupling** is the cosine of the two reference-id sets: `|A ∩ B| / sqrt(|A| |B|)`.
   - **Co-citation** counts how often both ids show up together in the reference lists of the sampled citing papers, normalized by `both / sqrt(countA * countB)`.
   - **Direct citation** is 1 when either work lists the other.
   The seed relevance score blends this graph score with semantic similarity when available: `0.55 × graph score + 0.45 × semantic score`. Semantic scoring uses available, model-compatible Semantic Scholar vectors or local text/topic signals. Without a semantic score the graph score is retained. Edge thickness uses normalized coupling/co-citation structural similarity, separately from direct citation and semantic relevance. Missing structural evidence is not treated as an observed zero.

7. Edges, so the picture is a map rather than a star:
   - the seed links to its **7** nearest neighbors
   - every other node links to its **2** nearest neighbors with score ≥ **0.07**
   - a node with no edge still gets its single best link
8. Layout: seed fixed at the origin, other nodes start on a golden-angle spiral (radius from similarity to the seed), then a short force simulation. Springs are shorter for higher scores; nodes repel and cannot overlap. Dragging can restart nearby force motion; the seed and pinned nodes remain constrained.

OpenAlex `related_to` results are recommendations and only **candidates**. They are not guaranteed to be recent or in the same field, and do not constitute citation evidence. Candidate ranking, structural edge appearance, and direct citation evidence are separate quantities. Any 0–1 ranking or similarity value is a heuristic, not a probability.

Citation neighborhoods are sampled, not exhaustive. Deep sampling’s 1,000 limit is a raw-record check budget for each reference or citing list; its accepted-work target remains 200 for each. The number of candidates retained and papers drawn on the map can be lower. Co-citation uses reference lists from a bounded sample of citing works.

### Evaluating node limits

The default 50-node limit, 20–300 setting range, 22% related-work cap, and candidate-enhancement budgets are engineering heuristics, not calibrated literature-quality optima. Do not treat larger graphs or more topic IDs as better recall.

Run `npm run evaluate:node-limits -- --capture --s2 --out=/absolute/output-directory` to freeze three public seed neighborhoods and compare 30/50/80/120 nodes. Override exact seeds with `--seeds=W123,W456,10.1234/example`; omit `--s2` for local-only capture. No credentials are loaded or saved. Capture errors, including anonymous cursor restrictions, are retained. The historical open-access seed is an out-of-domain control, not a linguistics sample.

Run the same command **without** `--capture` to replay the frozen pool offline. The output contains `fixtures.json`, its SHA-256 in `results.json`, and an `annotation-template.json`. Each seed/cap gets one warm-up and five measured runs, with fixed order 80/30/120/50 and deterministic-output assertions. Timings are local computation, not live API latency or browser frame rate. The comparison uses production configurations, including node-cap-dependent enrichment budgets; it does not isolate a causal node-count effect.

Fill a separate copy of the annotation template with `relevant`, `cross-disciplinary`, `irrelevant`, or `uncertain`, and independently flag known core papers with `core: true`. The template includes all convertible frozen candidates, including papers never selected, so omissions can be reviewed. Replay with `--labels=/absolute/labels.json`. Without labels, relevance and annotated-core recall stay `null`. Core recall covers only the annotated pool, not the literature globally. Complete labels for the selected union before comparing precision and review the entire candidate pool before comparing core recall; repeated timing runs are not independent literature samples. New topic IDs, circle overlaps, and nearest-neighbor retention are diagnostics, not human relevance, label-occlusion, or information-gain measurements. Browser/Obsidian usability validation remains a separate requirement before changing defaults.

### Node size and high-citation indicator

Node radius maps citation counts through `log1p` to 4–14 graph units; the Seed paper has a minimum radius of 11 and does not set the neighbors’ scale. The displayed version supplies its citation count; counts from versions are not added. Unknown counts remain unknown rather than becoming zero. Radius encodes citations, not the indicator or semantic similarity.

The **high-citation indicator** is a heuristic based on publication age and cumulative citations, not an authoritative assessment. It applies only to dated, non-seed, non-retracted works: at ages 3–7, citations must be at least `age × 100`; at age 8 or older, at least 1,000. Younger works do not qualify. A static indicator remains when reduced motion is enabled.

## Data quality: known OpenAlex issues

OpenAlex metadata has known limitations. The plugin uses it as one source, not as an authority; check records against their original sources when accuracy matters.

| Known issue | What the plugin does |
| --- | --- |
| **Work types and author details can be wrong** | The plugin filters using the source’s work-type field, but that field is not definitive. Check the original source and authors. |
| **Retracted works** | By default, retracted candidates are retained with a warning and ranking penalty. The optional exclusion setting skips them when building a graph. A previously saved Seed paper marked retracted pauses rebuilding and requires review. |
| **Abstracts may not be obtained** | The plugin tries OpenAlex, Semantic Scholar, and Crossref where available. A missing result or failed request does not prove that no abstract exists. |
| **Reference lists can be incomplete** | Available lists may be supplemented from other sources, but citation coupling and co-citation remain estimates based on sampled data. |
| **Citation counts differ across sources** | Differences may reflect coverage, update timing, or record grouping; they do not prove a record mismatch. Verify identity through the DOI and original source. |
| **Language field and authorship may be inaccurate** | The plugin displays source metadata as provided. Verify it against the original publication when needed. |
| **Duplicate and versioned records** (preprint vs published version, merging mistakes) | OpenAlex IDs are deduplicated; source-confirmed version relationships and manual merge/separate decisions group records. Similar titles alone do not establish identity. Ambiguous cases remain reviewable, and exports retain version provenance |
| **Venue quality** | The plugin does not screen venues; verify venue standards separately if relevant. |

</details>

<details>
<summary>Developer reference: OpenAlex API, preview, and project layout</summary>

## OpenAlex endpoints

Base: `https://api.openalex.org`. The plugin sends `Accept: application/json` and, when a key is set, an `Authorization: Bearer <API key>` header.

| Call | Endpoint | Role |
| --- | --- | --- |
| Seed by DOI | `GET /works/doi:{doi}?select=id,display_name,publication_year,cited_by_count,doi,authorships,abstract_inverted_index,referenced_works,related_works` | Resolve a DOI |
| Seed by id | `GET /works/{openAlexId}` with the same `select` | Resolve `W…` or an OpenAlex URL |
| Title search | `GET /works?search={query}&per_page=8&select=id,display_name,publication_year,cited_by_count,doi,authorships` | Picker, not the graph |
| References of the seed | `GET /works?filter=cited_by:{id}&per_page=80&sort=cited_by_count:desc` plus the list `select` | Outgoing citations. OpenAlex’s `cited_by` filter means “works this id cites”. |
| Citing works | `GET /works?filter=cites:{id}&per_page=40&sort=cited_by_count:desc` | Incoming citations |
| Related works | `GET /works?filter=related_to:{id}&per_page=20` | API-recommended candidates |
| Reference lists and abstracts | `GET /works?filter=openalex:{id}\|{id}…&per_page={n}&select=id,referenced_works,abstract_inverted_index` | Batches of up to 80 ids |

Abstracts are reconstructed from `abstract_inverted_index` when OpenAlex provides one. The plugin may also try Semantic Scholar and Crossref; a failed or unmatched request does not establish that an abstract is absent.

Filter names are easy to invert: `cited_by:W…` returns works **in** that work’s `referenced_works` (outgoing). `cites:W…` returns works that **list** that id (incoming).

## Development preview

The local preview runs outside Obsidian and is not a host integration test. It reuses the map interface and renderer.

```bash
npm run preview
python3 -m http.server 8734 --bind 127.0.0.1
```

Open `http://127.0.0.1:8734/preview/index.html`. Add `?demo=1` to build the example DOI immediately.

The note embed (same DOM as the plugin, without Obsidian) is `http://127.0.0.1:8734/preview/embed.html`. It loads `doi: 10.1038/nature14539` unless you pass `?doi=`. Add `&fixture=1` for offline data, as in the pane preview.

`npm test` runs architecture, UI contract, and offline logic checks without network requests. `npm run build` typechecks and creates the production bundle. `npm run verify` also includes a live OpenAlex check for `10.1038/nature14539`.

## Project layout

Official sample-plugin shape: `src/main.ts` bundled by esbuild to `main.js`, plus `manifest.json`, `styles.css`, and `versions.json`.

- `src/main.ts` — plugin, command, ribbon, settings, code-block registration
- `src/view.ts` — `ItemView` (2D pane)
- `src/embed-block.ts` — `connected-papers` and `research-connected` Markdown code blocks
- `src/embed-syntax.ts` — fence parser (`position`, `width`, `align`, `labels`)
- `src/embed-mount.ts` — embed chrome, graph state, optional depth-2 hop
- `src/map-canvas.ts` — shared 2D canvas renderer and graph interactions
- `src/graph-edit.ts` — graph edits and persisted deep-dug members
- `src/labels.ts` — node labels
- `src/relation.ts` — edge kind and localized explanations
- `src/app.ts` — pane orchestration, search, node edits, and detail panels
- `src/neighborhood.ts` — sampling and OpenAlex orchestration
- `src/similarity.ts` — coupling / co-citation scores
- `src/text-similarity.ts`, `src/diversity.ts` — semantic scores and MMR selection
- `src/layout.ts` — 2D force layout
- `src/openalex.ts` — works client

</details>
