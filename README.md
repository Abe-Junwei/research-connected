# Research Connected

An Obsidian plugin that draws a **similarity map** for one seed paper, in the spirit of [Connected Papers](https://www.connectedpapers.com/). The product is a force-directed graph in its own pane.

It is not a sidebar of citation cards. Reference Map / Literature Flow–style index lists are an explicit non-goal. This project is not affiliated with Connected Papers.

## Rename

The display name is **Research Connected**. The plugin id is `research-connected`, version 1.8.2.

Earlier builds used the id `connected-papers-openalex` and the folder `<vault>/.obsidian/plugins/connected-papers-openalex/`. That id does not carry over. After you install this build:

1. Turn off **Connected Papers (OpenAlex)** if it is still enabled.
2. Remove the old folder `connected-papers-openalex`.
3. Enable **Research Connected** from `research-connected`.

Plugin settings (the OpenAlex API key) live in that folder’s `data.json`. Copy the old `data.json` into the new folder before you reload if you want to keep the key. Notes that already use a `connected-papers` fence keep working. `research-connected` is the same fence.

The graph is built from the public [OpenAlex](https://openalex.org/) works API.

## Build

```bash
npm install
npm run build
```

`npm run build` typechecks, then bundles `src/main.ts` to `main.js`. You need Node 18+.

Loadable plugin files:

| File | Role |
| --- | --- |
| `main.js` | Bundled plugin (generated, gitignored) |
| `manifest.json` | Plugin id `research-connected` |
| `styles.css` | Pane styles |

## Install

1. Build the plugin (above).
2. Copy `main.js`, `manifest.json`, and `styles.css` into:

   ```text
   <vault>/.obsidian/plugins/research-connected/
   ```

3. Reload Obsidian (or restart it). If a previous copy failed with **加载失败**, replace `main.js` and `manifest.json` with this build, reload, then turn the plugin off and on again.
4. Settings → Community plugins → turn on **Research Connected**.

Restricted mode must be off, or Obsidian will not load community plugins.

## Usage

1. Command palette → **Open Research Connected**.
   The same command is on the ribbon (git-fork icon).
   The view opens as a **main-area tab** titled “Research Connected”, not in the sidebars.
2. In the pane, enter a seed:
   - DOI (`10.1038/nature14539` or `https://doi.org/...`)
   - OpenAlex work id (`W2919115771`) or an `openalex.org` work URL
   - or a title. Title search shows up to 8 hits; click one to make it the seed.
3. Press **构建图谱** (Build map). **示例 DOI** loads the Nature review *Deep learning* (`10.1038/nature14539`).
4. The seed sits in the middle with a double ring and a halo. Other papers are placed by similarity:
   - node color runs from indigo (older) to gold (newer)
   - node area grows with citation count
   - line strength follows the similarity score
5. Drag a node to move it. Drag the background to pan. Scroll to zoom. **+ / − / 适配** zoom and fit the map. On touch screens, pinch with two fingers to zoom. With the canvas focused, the arrow keys pan, `+` / `-` zoom, and `0` or `F` fits.
6. Hover a node for its title. Click it for the detail sheet: title, authors, year, citation count, how it relates to the seed, a short abstract, **在 OpenAlex 中打开**, and **打开 DOI** when a DOI exists.
   Those links open with `window.open`. Only `https://openalex.org` and `https://doi.org` URLs are opened. The bundle does not call Electron.
7. Chinese titles render with the interface font plus a CJK fallback stack. In-pane labels are Chinese; the command name stays English.

While a request is in flight the button reads **正在构建…**. Failures (unknown id, exhausted budget, network) show a banner and leave the previous map in place.

## 3D embed in a note

A fenced block renders the same neighborhood as an interactive **3D** graph inside the note. The language can be `connected-papers` or `research-connected`. Reading view and Live Preview both mount it. While the cursor is inside the fence, Obsidian shows the source; leaving the block builds the graph again — the camera, filters, and layout you chose are remembered across that rebuild. The command-palette pane stays the 2D map.

The fence is the anchor in the note. `position` changes how that block sits among the surrounding paragraphs. It does not teleport the graph to another heading.

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
| `height:` | no | Graph area in pixels, clamped to 280–900. Default **480**. The tab bar and the info strip sit below the graph and add their own height. |
| `align:` | no | `left` (default), `center`, or `right`. Centers or right-aligns a block that is narrower than the column. Ignored for floats. |
| `labels:` | no | `author-year` (default: family name and year on each node), `title`, `both`, or `off`. Overlapping labels drop out; the seed, the selection, and the node under the pointer stay. |
| `maxNodes:` | no | 20–80. Overrides the setting for this block only. Default is the setting (50). |
| `depth:` | no | `1` (default) is the seed neighborhood. `2` also samples references of the two closest papers, up to the node cap. |
| `yearFrom:` / `yearTo:` | no | Inclusive year range for the other papers. The seed stays. If both are set and reversed, they are swapped. |
| `language:` / `type:` / `concept:` | no | Preset filters. They apply only when OpenAlex included that field (`language`, `type`, `concepts`). |
| `minCoCite:` / `minShared:` | no | Hide co-citation edges below that count, and coupling edges below that shared-reference count. Default 1. |
| `layout:` | no | `temporal` (default; year on X) or `kumu` / `community` (compact community layout). Legacy `radial`, `force2d`, and `force3d` values are accepted as year layout. |
| `color:` | legacy | Accepted for old notes but ignored; node color always shows topic similarity to the seed. |

`full` widens the block by Obsidian’s `--file-margins` (no effect when that variable is 0, as in the dev preview). Title search is not available in the fence. Use the command pane for that. Lines starting with `#` are comments.

Nodes show **author + year** by default. The full title is the hover tooltip and the evidence panel. The command pane uses a left rail for the **年份 / 社区** layout choices and **筛选**; the filter drawer contains the relationship legend, filters, and year scrubber. The graph stays in the center, with a right-side **论文与关系证据** panel for the selected paper, prior/derivative lists, and analysis. In narrow panes the evidence panel moves below the graph. A compact bottom bar holds the main tabs; export actions are grouped under **导出**. The note embed keeps its compact bottom detail sheet to preserve reading width.

On **年份** and **社区**, drag pans the graph. A plain scroll wheel scrolls the note past the graph; hold **⌘/Ctrl** and scroll — or pinch on a trackpad — to zoom, as do **+ / − / 适配**. On touch screens one finger scrolls the note and a two-finger pinch zooms and pans. The embed grip at the bottom-right changes the graph area’s width and height after it opens (with the grip focused, the arrow keys resize in steps, faster with Shift); `width` and `height` in the fence are only the starting size. The command pane fills its tab and has no grip.

**重新加载** fetches again and skips the short in-memory cache. Click a node for its title, year, citation count, why it connects to the seed, a short abstract, and **在 OpenAlex 中打开** / **打开 DOI**. Inside Obsidian the detail also offers **在图谱面板中打开此图**, which jumps to the full graph pane on the same seed. Hover or click an edge for that pair’s explanation.

Citation edges are arrows (A cites B; mutual cites get both heads). Co-citation and coupling stay undirected. Thickness is three steps, **弱 / 中 / 强**, matching the legend. Click a legend chip to hide that edge type. **共被引 ≥** and **共享文献 ≥** raise the count threshold. **到种子的路径** keeps the shortest visible path bright when you click a node that is not the seed; neighbors stay bright and the rest dim. Hover or click an edge for the evidence strip: shared-reference count, co-citation count, OpenAlex as the source, and a note that the citation lists can be incomplete.

After the graph loads, language, work type, and concept menus appear only when at least one paper has that OpenAlex field. Node size is still citation count. Author–year labels stay.

**年份 / 社区** are the only layout modes. **年份** maps publication year linearly from left to right, so horizontal distance between dated works is proportional to their year difference; unknown-year works sit in a separate left gutter. Vertical position is log citation count, and slight vertical offsets only separate overlapping points. **社区** groups papers using the sampled citation / bibliographic-similarity graph in a compact layout. Group regions are not drawn as large outer circles; visible regions are subtle guides labeled with the most frequent OpenAlex topic words among their members (up to two). These are descriptive summaries of metadata, not inferred schools or definitive community names; groups without topic metadata fall back to a numbered label. In both modes node color shows cosine similarity between each paper's OpenAlex topic scores and the seed's topic scores; gray means topic metadata is missing. This is a seed-relative topic score, not a claim that same-color papers use the same method or reach the same conclusion. The year scrubber hides papers published after the chosen year, including the seed, and **播放** walks forward one year at a time. At the right end the full filtered graph returns, undated papers included.

**先验工作** lists papers often cited by the current subgraph (how many visible papers’ reference lists include them). **衍生工作** lists papers that often cite the current subgraph (how many visible papers appear in their reference list). Both are lists, not new edge types. A count below 2 is left out.

Edges stay thin neutral gray by default; when you hover or select a node (or click an edge), its links take the color of the sharpest relation, not a blend. The legend inside **筛选** lists them:

| Color | Relation | What the text counts |
| --- | --- | --- |
| Gold | 引用 citing | One paper lists the other, or they cite each other. |
| Teal | 共被引 co-citation | How many sampled citing papers list both. |
| Indigo | 文献耦合 coupling | How many referenced works they share. |
| Gray | 弱连线 | A fallback link with none of the counts above. |

Thickness is the same three steps as the legend (弱 / 中 / 强), not a continuous score. The same OpenAlex API key from settings is sent; without a key the small daily budget still applies, and a 429 is shown inside the block instead of freezing the editor. The block renders on demand: frames stop once the camera settles, and rendering pauses while the block is off screen.

`depth: 2` costs a few extra OpenAlex calls. If that second hop fails, the block keeps the depth-1 graph and says so.

## Settings

### 多源证据、分析视图与可选 LLM

OpenCitations 检查和可选 LLM 仅在命令面板图谱中提供；Crossref 回退同时用于命令面板与笔记内嵌。分析视图（桑基 / 弦图）在图谱面板和笔记内嵌中都可用。

- **OpenCitations**：建图后顺序检查最多 20 篇有 DOI 的图内论文的参考文献，只补当前节点之间的引用边。仅在 OpenAlex 同样记录了该方向引用时显示双源。状态栏显示已检查数和失败数；这不是全量覆盖。可在设置中填写访问令牌。
- **Semantic Scholar**：建图时批量核对每篇的被引数与参考文献数，差异悬殊的节点在详情中标注；OpenAlex 缺失的参考文献列表会回填并参与连线，标记 Semantic Scholar 来源。当 OpenAlex 没有某篇论文的摘要时（Nature 等出版商不寄存摘要），打开该论文详情会自动向 Semantic Scholar 查询一次摘要作为回退，取到后标注“摘要来源：Semantic Scholar”；两个源都没有时如实说明。回退按论文触发、会话内缓存，不会批量预取。API key 可选。
- **Crossref**：作为额外回退，只对 DOI 可识别且 OpenAlex / Semantic Scholar 仍没有参考文献列表的图内论文查询已登记参考文献，每张图最多尝试 12 篇；只将能映射到当前图内 DOI 的条目纳入相似度和引用边，并标记 Crossref 来源。打开缺摘要论文详情时，也会在 Semantic Scholar 没找到后按需查询 Crossref 摘要。Crossref 没登记 DOI 或摘要时不影响主图；这不是完整参考文献补全。
- **分析**：默认图谱不变。图谱下方常驻条上的“分析”页签可切换按年代聚合的桑基图和按社区聚合的弦图。只统计当前可见论文间的直接引用，去重后按数量绘制带宽。桑基方向是施引 → 被引；弦图合并两个方向。点击带状区域查看论文。聚合不代表学术影响或完整历史。
- **LLM 默认关闭**：关闭时没有“研究脉络”入口、生成内容或模型请求。开启并填写完整 Endpoint、模型后才出现入口。支持兼容 chat/completions 的 JSON 响应接口；HTTPS 为默认要求，本机 HTTP 服务允许使用。API 密钥保存在插件本地 data.json 中，不是加密密钥库。
- **手动生成**：只在点击生成时发送种子、最多 8 篇直接参考文献、8 篇直接施引文献，以及已取得的引用证据。摘要发送默认关闭；已获取的引用上下文仍属于证据包。总结针对整张采样图，不跟随年份滑块。未访问全文，不声称完整学术史。
- **输出检查**：校验 JSON 结构、论文 ID 和引用方向；拒绝输入之外的论文。该校验无法证明模型每一句叙述正确，“模型自评”也不是统计置信度。证据快照可展开核对，支持复制或另建笔记。关闭功能不会删除用户已经导出的笔记。

数据源查询使用会话内五分钟缓存与串行限速，失败不清空主图。模型结果只在当前图谱会话保留；重新生成会再次调用模型。切换种子、修改设置或关闭视图后，旧结果不会替换当前总结。Obsidian 的 requestUrl 无法物理中止已发送请求；等待有超时，失效结果会被丢弃。

开发验证：`npm test` 运行离线回归（不联网、不消耗模型额度）；`npm run verify` 还包含 OpenAlex 实时检查。构建预览后，`preview/index.html?fixture=1` 使用离线数据，增加 `&llm=1` 可演示模拟总结，均不会请求实际模型。

Settings → Research Connected.

| Setting | Default | What it does |
| --- | --- | --- |
| OpenAlex API 密钥 | empty | Sent as `Authorization: Bearer`. Stored only in local plugin data. |
| 联系邮箱（mailto） | empty | OpenAlex 不再因此提高额度；有效邮箱会作为 Crossref 的联系信息。 |
| 最大节点数 | 50 (range 20–80) | Cap including the seed. 40–60 is the intended range. Applied on the next build. |
| 纳入参考文献 | on | Seed’s outgoing references. |
| 纳入施引文献 | on | Works that cite the seed, also used as co-citation context. |
| 纳入相关作品 | on | OpenAlex `related_works` as extra candidate nodes. |

Turn off every neighbor toggle and the pane asks you to enable one. The next build uses the new toggles; the current map is not rebuilt automatically.

### Authentication and limits

OpenAlex still answers **without a key**, on a small daily budget. A keyless response while this plugin was written reported `X-RateLimit-Limit: 1000` and `X-RateLimit-Limit-USD: 0.1`. The live numbers are whatever the API puts in `X-RateLimit-*` that day.

A free key from [openalex.org/settings/api](https://openalex.org/settings/api) raises that budget. OpenAlex documents the free key as about **10×** the keyless allowance. Past the budget, or above 100 requests/second, the API returns **HTTP 429**. The pane tells you to add a key or wait until the daily reset.

Since February 2026 OpenAlex **ignores `mailto`**. The email setting is still sent to older OpenAlex gateways but does **not** raise its limit; Crossref uses a valid email as contact information for its public API. An OpenAlex key is the way to get a higher OpenAlex budget. See [OpenAlex authentication](https://help.openalex.org/api/authentication/).

One map on standard sampling is a handful of calls: one work lookup, up to three list calls, and one or two batched id lookups. Deep sampling cursor-pages the reference and citation lists (up to 5 pages each) and fetches more batched details, around 20 calls in total. Title search is a separate, slightly more expensive call.

## Algorithm

Connected Papers builds a similarity map from co-citation and bibliographic coupling over a large citation graph. This plugin approximates that with a **sampled** OpenAlex neighborhood. It is not a citation tree and not a ranked list.

1. Resolve the seed work.
2. Sample candidates (most-cited first when a sort applies). The **采样深度** setting picks the tier:
   - **standard** — up to 80 works the seed cites, 40 that cite it, 20 related works; about 5 requests per map
   - **extended** — one full 200-per-page list of references and citing works, 50 related; about 7 requests
   - **deep** — references and citing works cursor-paged up to 1000 each, 100 related; about 20 requests, so set an OpenAlex API key first
3. Keep at most `最大节点数 − 1` neighbors (20–300; pair anything above ~80 with extended or deep sampling so the pools can fill the slots):
   - records whose OpenAlex `type` is non-research (**book-review**, editorial, correction/erratum, letter, retraction, peer-review, paratext) are dropped first — a book review's title embeds the book ("…By Author. Publisher, year. Pp. …") and citations meant for the book land on the review, which would bend the map toward the wrong record; the status line reports how many were filtered. The seed itself is kept regardless of type, with a note in its detail sheet
   - related works first, capped near 22% of the slots (at least 6 when that many exist), so topic-neighbors cannot crowd out the citation structure
   - remaining slots split between references and citing works
   - unused quota is filled by citation count
   - the same work is kept once; a reference outranks a citing work, which outranks a related work
4. Batch-fetch `referenced_works` and `abstract_inverted_index` for the kept nodes and for the citing sample (the citing sample is the co-citation context even when a citer is not drawn).
5. Score every pair:

   ```text
   score = 0.55 * bibliographic coupling
         + 0.35 * co-citation
         + 0.10 * direct citation
   ```

   - **Bibliographic coupling** is the cosine of the two reference-id sets: `|A ∩ B| / sqrt(|A| |B|)`.
   - **Co-citation** counts how often both ids show up together in the reference lists of the sampled citing papers, normalized by `both / sqrt(countA * countB)`.
   - **Direct citation** is 1 when either work lists the other.
6. Edges, so the picture is a map rather than a star:
   - the seed links to its **7** nearest neighbors
   - every other node links to its **2** nearest neighbors with score ≥ **0.07**
   - a node with no edge still gets its single best link
7. Layout: seed fixed at the origin, other nodes start on a golden-angle spiral (radius from similarity to the seed), then a short force simulation. Springs are shorter for higher scores; nodes repel and cannot overlap. Dragging after that moves only the node you grab.

`related_works` in OpenAlex means “recent papers that share topics”, not a Connected Papers score. Related works are only **candidates**. Edge weight is always the score above.

Highly cited papers are sampled, not exhaustively expanded. With standard sampling a seed with tens of thousands of citations contributes its 40 most-cited citers, not the full citing set; deep sampling raises that to 1000. Co-citation is counted over the reference lists of at most 400 sampled citers, so deep sampling improves edge quality but never covers the whole citing population.

## Data quality: known OpenAlex issues

OpenAlex is the best free citation index, but published audits have found recurring defects. What they are, and what this plugin does about each:

| Known issue | What the plugin does |
| --- | --- |
| **Book reviews, editorials, corrections** are indexed as works; a book review's title embeds the reviewed book and citations meant for the book land on the review, so the record looks like a highly cited "paper" by the wrong author | Records whose `type` is non-research are dropped from the map (the status line reports the count); the seed is kept with a note. OpenAlex's `type` field is the reliable detector — title heuristics are not |
| **Retracted articles** stay in citation graphs and keep accumulating citations | `is_retracted` is fetched for every node; the detail sheet shows a prominent retraction warning. Retracted works are kept on the map (they are part of citation history) but flagged |
| **Missing abstracts** on a large share of records | Abstracts are reconstructed from `abstract_inverted_index` when present; otherwise the sheet asks Semantic Scholar once, and says so when neither source has one |
| **Incomplete reference lists** — OpenAlex captures fewer references than the original articles list (audits report roughly a fifth to a quarter missing on average, worse for older and non-English works) | When Semantic Scholar reports references for a node whose OpenAlex list is empty, the missing list is backfilled from S2 and takes part in scoring (the detail sheet says so, and the edge evidence credits Semantic Scholar). Coupling and co-citation remain approximations over whatever the two sources have |
| **Misattributed citation counts** — the book-review trap and merged/split records make one record inherit another work's citations | Each node's OpenAlex citation count is bulk-compared against Semantic Scholar's (one POST per map). Counts an order of magnitude apart get a ⚠ warning in the detail sheet. Turn this off with the Semantic Scholar 交叉比对 setting |
| **Language field is auto-detected** from title and abstract, with published error rates around one in seven records | The language facet and filter are shown as OpenAlex reports them; treat them as best-effort |
| **Author and institution disambiguation errors** — names are merged or split incorrectly, especially for non-English names | Authors are displayed exactly as OpenAlex sends them. Verify authorship through the DOI link before citing |
| **Duplicate and versioned records** (preprint vs published version, merging mistakes) | De-duplication is by OpenAlex work id only; a preprint and its published version are separate OpenAlex records and can both appear on one map |
| **No predatory-journal screening** — OpenAlex indexes by availability, not quality | Not filtered. If that matters for your field, cross-check venues against DOAJ |

Sources for the audits: Alperin et al. 2024 (coverage and metadata completeness), Gusenbauer 2024 (reference-capture error), Haupka 2024 (document-type misclassification), Céspedes et al. 2025 (language detection accuracy), and the 2025 systematic review of OpenAlex criticism (arXiv 2512.16434). The general advice from that literature applies here too: for anything beyond exploration, cross-validate against a second source (Semantic Scholar, Crossref, or the publisher page).

## OpenAlex endpoints

Base: `https://api.openalex.org`. The plugin sends `Accept: application/json` and, when a key is set, `Authorization: Bearer <key>`.

| Call | Endpoint | Role |
| --- | --- | --- |
| Seed by DOI | `GET /works/doi:{doi}?select=id,display_name,publication_year,cited_by_count,doi,authorships,abstract_inverted_index,referenced_works,related_works` | Resolve a DOI |
| Seed by id | `GET /works/{openAlexId}` with the same `select` | Resolve `W…` or an OpenAlex URL |
| Title search | `GET /works?search={query}&per_page=8&select=id,display_name,publication_year,cited_by_count,doi,authorships` | Picker, not the graph |
| References of the seed | `GET /works?filter=cited_by:{id}&per_page=80&sort=cited_by_count:desc` plus the list `select` | Outgoing citations. OpenAlex’s `cited_by` filter means “works this id cites”. |
| Citing works | `GET /works?filter=cites:{id}&per_page=40&sort=cited_by_count:desc` | Incoming citations |
| Related works | `GET /works?filter=related_to:{id}&per_page=20` | Topic-similar candidates |
| Reference lists and abstracts | `GET /works?filter=openalex:{id}\|{id}…&per_page={n}&select=id,referenced_works,abstract_inverted_index` | Batches of up to 80 ids |

Abstracts are reconstructed from `abstract_inverted_index` when OpenAlex has one and shown in full. Many works have none; the sheet then asks Semantic Scholar once for that paper, and says so when neither source has one.

Filter names are easy to invert: `cited_by:W…` returns works **in** that work’s `referenced_works` (outgoing). `cites:W…` returns works that **list** that id (incoming).

## Development preview

The pane UI is plain DOM (`src/app.ts`) so it can run outside Obsidian. The preview is the same map, not a second product.

```bash
npm run preview
python3 -m http.server 8734 --bind 127.0.0.1
```

Open `http://127.0.0.1:8734/preview/index.html`. Add `?demo=1` to build the example DOI immediately.

The note embed (same DOM as the plugin, without Obsidian) is `http://127.0.0.1:8734/preview/embed.html`. It loads `doi: 10.1038/nature14539` unless you pass `?doi=`. Add `&fixture=1` for offline data, as in the pane preview.

`npm run verify` runs the similarity unit checks and one live OpenAlex build for `10.1038/nature14539`.

## Project layout

Official sample-plugin shape: `src/main.ts` bundled by esbuild to `main.js`, plus `manifest.json`, `styles.css`, and `versions.json`.

- `src/main.ts` — plugin, command, ribbon, settings, code-block registration
- `src/view.ts` — `ItemView` (2D pane)
- `src/embed-block.ts` — `connected-papers` and `research-connected` Markdown code blocks
- `src/embed-syntax.ts` — fence parser (`position`, `width`, `align`, `labels`)
- `src/embed-mount.ts` — embed chrome, cache, optional depth-2 hop
- `src/graph-3d.ts` — Three.js view (drag to rotate, labels, typed edges)
- `src/labels.ts` — author + year labels
- `src/relation.ts` — edge kind and the Chinese explanation
- `src/layout-3d.ts` — 3D force layout
- `src/app.ts` — toolbar, detail sheet, search picker
- `src/map-canvas.ts` — 2D canvas interaction
- `src/neighborhood.ts` — sampling and OpenAlex orchestration
- `src/similarity.ts` — coupling / co-citation scores
- `src/layout.ts` — 2D force layout
- `src/openalex.ts` — works client
