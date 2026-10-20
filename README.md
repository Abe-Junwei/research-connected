# Research Connected

<img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected logo">

Map related papers, inspect the evidence behind each connection, and turn your reading into linked notes in Obsidian.

[Quick start](https://github.com/Abe-Junwei/research-connected#quick-start) · [User guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) · [Report a bug](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)

![GitHub release](https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver) ![Obsidian](https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed) ![License](https://img.shields.io/github/license/Abe-Junwei/research-connected)

![Research Connected graph pane around “Deep learning”: related papers on the left and the selected paper’s relationship evidence on the right](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

Start with one paper. Select a node or an edge to see shared references, co-citations, and direct citation evidence.

## What you can do

- **Discover related research.** Enter a title, DOI, or OpenAlex ID to build a sampled similarity map. Explore citation communities, follow prior and later work, or switch between planar, timeline, and radial layouts.
- **Inspect each connection.** Review the references and citation evidence behind a relationship. Semantic Scholar, Crossref, and OpenCitations supplement OpenAlex data and help flag mismatched records.
- **Organize your reading.** Stage papers, mark them as to read or read, exclude noise, and save named views. Write literature notes with synchronized reading status, embed graphs in notes, or export BibTeX, YAML, and Markdown.

## Quick start

1. **Install and enable.** In Obsidian, open **Settings → Community plugins → Browse**, search for **Research Connected**, then install and enable it.
2. **Build your first map.** Run **Open Research Connected** from the command palette. Paste the DOI below, or enter a paper title, then select **Build**.
3. **Inspect a connection.** Select a paper or an edge to see why it is on the map. Use **Save view** to return to your arrangement later.

```text
10.1038/nature14539
```

This example is “Deep learning” by LeCun, Bengio, and Hinton (2015). Results can change as the source databases update.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Abe-Junwei/research-connected/releases/latest), place them in `<vault>/.obsidian/plugins/research-connected/`, reload Obsidian, and enable the plugin.

## Explore research over time

![Timeline layout showing papers by publication year, with layout controls and a year slider](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

Switch to **Timeline** to explore earlier and later research. The year slider narrows the visible map; saved views let you return to a useful selection.

## Keep the graph beside your notes

![A reading note with a Research Connected graph embedded between paragraphs](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

Add this code block to a note to embed the graph in Reading view or Live Preview:

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

To create a literature note, select a paper and choose **Export → Write to note**. The plugin can recognize existing notes by DOI or OpenAlex ID, and synchronizes `rc-status` when you change reading status. Configure the destination folder, filename, body template, and DOI property in settings.

See the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) for embed options, note frontmatter, settings, sampling, and algorithms. The older `connected-papers` embed name remains supported.

## Before you start

- **Desktop:** requires Obsidian 1.14.4 or later. Mobile support awaits device testing.
- **Network access:** building a map queries external scholarly services. Projects and reading states are stored in your vault; this is not an offline citation index.
- **Service keys:** an OpenAlex API key is optional but recommended. Anonymous limits and deep-sampling restrictions can affect results. Create a key at [OpenAlex settings](https://openalex.org/settings/api); see the [guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) for configuration.
- **AI is optional:** the research narrative is off by default. Exploring maps and inspecting citation evidence do not require an LLM. If enabled, generation uses the provider you configure, whose terms and charges apply.
- **Languages:** the interface follows Obsidian’s language: Simplified Chinese for Chinese locales, English otherwise.

## Network use and privacy

Research Connected needs network access to build graphs:

- **OpenAlex** receives the DOI, OpenAlex ID, or search text you enter, and your API key if you set one.
- **Semantic Scholar**, **Crossref**, and **OpenCitations** receive paper identifiers to fill missing metadata and check citations. API keys or tokens are sent only to the service they belong to.
- **Your LLM endpoint** receives the selected papers and their citation evidence only when you enable the research narrative and press **Generate**. Abstracts are included only if you turn that option on.

To recognize existing literature notes, the plugin enumerates Markdown file paths and reads their cached frontmatter. Copy and export actions write to the system clipboard; the plugin does not read clipboard contents. Writing a literature note or changing its reading state creates or updates the corresponding vault file.

Projects, reading states, saved views, and service credentials are stored in this vault's plugin `data.json`. Credentials are **not encrypted**. The plugin sends no telemetry and does not read your notes beyond the frontmatter of literature notes. The interface follows Obsidian's language: Simplified Chinese for Chinese locales, English otherwise.

## Limitations

- The map is a **sample** of a citation neighborhood, not a complete citation index. Highly cited papers contribute their most-cited citers, not all of them.
- Similarity and community colors are exploratory signals. Verify important claims against the original papers.
- OpenAlex has known gaps: missing abstracts, incomplete reference lists, and author disambiguation errors. The [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues) lists each issue and what the plugin does about it.

## Help and feedback

- **Something is not working?** [Report a bug](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml). Include your plugin and Obsidian versions, system, steps, and expected and actual results. A public DOI or OpenAlex ID helps with paper-data problems.
- **Want to improve a research workflow?** [Request a feature](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml). Describe your task, what gets in the way, and the result you need.
- **Need setup help?** Read the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md) and [check existing issues](https://github.com/Abe-Junwei/research-connected/issues).

English or Chinese is welcome. Submitting requires a GitHub account, and reports are public. Do not include API keys, private notes, unpublished research, a full vault, or `data.json`. A feature request does not guarantee implementation or a delivery date.

支持中文或英文。提交需要 GitHub 账户，反馈公开可见；请勿上传密钥、私人笔记、未公开研究材料或完整库数据。

## Updates and contributing

See the [release notes](https://github.com/Abe-Junwei/research-connected/releases) for changes and the [roadmap](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md) for planned work. For code and documentation contributions, see the [contributing guide](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE).

Research Connected is an independent project and is not affiliated with Connected Papers.
