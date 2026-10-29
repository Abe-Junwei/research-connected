<h1 align="center">Research Connected</h1>

<p align="center">English | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected logo"></p>

<p align="center"><strong>From one paper to a connected reading workflow.</strong><br>Discover related research, inspect the evidence, and keep your literature notes connected in Obsidian.</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected#quick-start">Quick start</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">User guide</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">Report a bug</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">Request a feature</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub release"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4+ desktop"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="License"></p>

## See the research neighborhood

<p><img src="docs/images/graph-pane.gif" width="100%" alt="Development preview, light theme: the map opens from the seed, a paper is selected, and the layout switches"></p>
<p><img src="docs/images/graph-pane-dark.gif" width="100%" alt="Development preview, dark theme: the map opens from the seed, a paper is selected, and the layout switches"></p>

*Motion clips and stills: current local development preview, recorded October 29, 2026. These are not Obsidian-host captures or a claim about the latest published release. Sample: “Deep learning” (2015); live public metadata may change.*

Select a node or an edge to inspect shared references, co-citations, and direct citation evidence. The side panel’s bottom tabs include **Frequently cited references** (cited by at least two visible papers) and **Works citing this graph** (cites at least two visible papers); neither label implies publication order or intellectual influence.

## Three steps, one reading workflow

- **Discover related research.** Enter a title, DOI, or OpenAlex ID and build a sampled similarity map. Switch among **Planar**, **Year**, and **Radial** layouts.
- **Inspect each connection.** Read the references and citation evidence behind a relationship. The plugin may retrieve additional abstracts and reference data from OpenAlex, Semantic Scholar, or Crossref; OpenCitations can add citation evidence. A failed request does not prove that a source has no record.
- **Organize your reading.** **Save paper** adds an individual paper to the project’s saved list; **Save project** saves the project. Set a paper’s **Reading status**, exclude noise, write literature notes, embed the graph, or export BibTeX, YAML, and Markdown.

## Quick start

1. **Install and enable.** In Obsidian, open **Settings → Community plugins → Browse**, search for **Research Connected**, then install and enable it.
2. **Build your first map.** Run **Open Research Connected** from the command palette. Paste the DOI below, or enter a paper title to choose the **Seed paper**, then select **Build**.
3. **Inspect a connection.** Select a paper or an edge to see why it is on the map. Use **Save project** to save the project; use **Save paper** to keep an individual paper in its saved list.

```text
10.1038/nature14539
```

This example is “Deep learning” by LeCun, Bengio, and Hinton (2015). Results can change as the source databases update.

**Manual installation.** Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Abe-Junwei/research-connected/releases/latest), place them in `<vault>/.obsidian/plugins/research-connected/`, reload Obsidian, and enable the plugin.

## Explore research over time

<p><img src="docs/images/timeline.gif" width="100%" alt="Development preview, light theme: year layout with the year band playing through publication years"></p>
<p><img src="docs/images/timeline-dark.gif" width="100%" alt="Development preview, dark theme: year layout with the year band playing through publication years"></p>

Choose the **Year** layout. The year band below the map narrows the visible papers by publication year.

## Keep the graph beside your notes

<p><img src="docs/images/note-embed.png" width="100%" alt="Development preview, light theme: an interactive timeline graph embedded in a reading-note page"></p>
<p><img src="docs/images/note-embed-dark.png" width="100%" alt="Development preview, dark theme: an interactive timeline graph embedded in a reading-note page"></p>

Add this block to a note. It renders in Reading view and Live Preview.

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

Select a paper and choose **Export → Write to note** to create a literature note. The plugin recognizes existing notes by DOI or OpenAlex ID. Reading status can be synchronized with linked notes; conflicting values require review. Set the folder, filename, body template, and DOI property in settings.

Embed options, note properties (YAML frontmatter), sampling, and algorithms are in the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md). The older `connected-papers` embed name still works.

## Development status

<details>
<summary>Unreleased features and validation boundaries</summary>

The current [`slices/s02-s10`](https://github.com/Abe-Junwei/research-connected/tree/slices/s02-s10) work is tracked in [PR #10](https://github.com/Abe-Junwei/research-connected/pull/10). Full acceptance in the Obsidian host remains pending. Install a release for published functionality.

- Reading status is shared across projects and confirmed version groups; saved papers and exclusions stay project-specific. Conflicts and external note edits require explicit resolution, retry, or sync opt-out.
- Version groups use source-confirmed relationships or manual decisions, never title-only guesses. Exports retain version provenance.
- Candidate diagnosis and citation paths distinguish missing evidence from measured zero. MMR balances relevance and diversity; semantic signals supplement structural evidence.
- Node size uses log-scaled citation counts. The high-citation indicator is a heuristic, not an authoritative assessment. Animation respects reduced-motion preferences.

</details>

## Before you start

- **Desktop.** Obsidian 1.14.4 or later. Mobile support awaits device testing.
- **Network.** Building a map queries external scholarly services. Projects and reading status stay in your vault; see the privacy note below for what is sent.
- **Service key.** An OpenAlex API key is optional and recommended. Create one in [OpenAlex settings](https://openalex.org/settings/api). Configuration is in the [guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md).
- **Notes.** Note properties (YAML frontmatter) are read to recognize literature notes. A note file changes only when you write one or change its reading status.
- **AI.** The research narrative is off by default. Exploring the map does not require a language model.
- **Interface language.** Simplified Chinese for Chinese locales, English otherwise.

## Network use and privacy

- **OpenAlex** receives the DOI, OpenAlex ID, or search text you enter, and your API key and optional contact email if set. The email is also sent to Crossref as contact information; it does not guarantee a higher request limit.
- **Semantic Scholar**, **Crossref**, and **OpenCitations** receive paper identifiers. A key or token is sent only to the service it belongs to.
- **Your language-model endpoint** receives the selected papers and their citation evidence only after you enable the research narrative and press **Generate**. Abstracts are included only if that option is on.

To match existing literature notes, the plugin lists Markdown paths and reads their cached note properties. Copy and export write to the system clipboard; the plugin does not read it. Writing a literature note or changing its reading status updates that vault file.

Projects, reading statuses, saved papers, and service credentials are stored in this vault's plugin `data.json`. Credentials are **not encrypted**; vault sync or backup tools may copy this file. The plugin sends no telemetry and reads note properties (YAML frontmatter) to recognize literature notes.

## Limitations

- The map is a **sample**, not a complete citation index; consult the user guide for sampling details.
- Semantic similarity can use compatible vectors as well as local text and topic signals; it is exploratory, not a measure of research quality. Verify important claims against the original papers.
- OpenAlex has known gaps: missing abstracts, incomplete reference lists, and author disambiguation errors. The [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues) lists each gap and what the plugin does about it.

## Help and feedback

- **Something is not working.** [Report a bug](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml). Include the plugin and Obsidian versions, your system, the steps, and the expected and actual results. A public DOI or OpenAlex ID helps with paper-data problems.
- **A research workflow needs to change.** [Request a feature](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml). Describe the task, what gets in the way, and the result you need.
- **Setup help.** Read the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) and [check existing issues](https://github.com/Abe-Junwei/research-connected/issues).

English or Chinese is welcome. Submitting requires a GitHub account, and reports are public. Do not include API keys, private notes, unpublished research, a full vault, or `data.json`. A feature request does not promise implementation or a delivery date.

## Updates and license

Changes are in the [release notes](https://github.com/Abe-Junwei/research-connected/releases). Planned work is on the [roadmap](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md). Code and documentation contributions follow the [contributing guide](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md).

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE). Research Connected is an independent project and is not affiliated with Connected Papers.
