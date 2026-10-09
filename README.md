# Research Connected

Explore how papers relate through citations and shared references, directly in Obsidian. Research Connected turns a seed paper into an interactive map in a graph tab or a note.

**Available for Obsidian desktop 1.14.4 and later.** Mobile support will follow device testing.

## Explore the literature

- **See the neighborhood.** Compare papers in planar, timeline, or radial layouts. Select a node or edge to inspect its metadata and relationship evidence.
- **Follow a research path.** Deep dive from a paper, review prior and later work, and keep reading, staging, and exclusion states in a local project.
- **Return to your work.** Save named views and restore the graph, selection, filters, and position.
- **Work inside notes.** Embed the same interactive graph in Reading view or Live Preview.

The map is a sampled view of citation data, not a complete citation index. Similarity and graph groups are exploratory signals; verify important claims against the original papers.

## Get started

1. Install **Research Connected** from Obsidian's Community plugins and enable it.
2. Run **Open Research Connected** from the command palette.
3. Enter a paper title, DOI, or OpenAlex work ID, then select **Build**.
4. Select a paper to inspect its evidence, or right-click a node to explore further.

To place a graph in a note, add a code block:

````markdown
```research-connected
doi: 10.1038/nature14539
```
````

The older `connected-papers` code block name still works. See the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#embed-a-graph-in-a-note) for layout, size, filters, and other options.

## Data and privacy

The graph uses [OpenAlex](https://openalex.org/), with Semantic Scholar, Crossref, and OpenCitations for additional metadata or citation evidence. Searches and graph building send paper identifiers or search text to those services. The optional research narrative is off by default; using **Generate** sends selected paper data and available evidence to the LLM endpoint you configure. Abstracts are included only if you enable that option.

Projects, reading states, saved views, and service credentials are stored in this vault's plugin `data.json`. Credentials are **not encrypted**. The plugin sends no usage telemetry. The interface follows Obsidian's language: Simplified Chinese for Chinese locales and English otherwise. Paper metadata keeps its source language.

Read the [user guide](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#network-use-and-local-data) for service behavior, API limits, settings, and manual installation. Source code is available under the [MIT License](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE).

Research Connected is an independent project and is not affiliated with Connected Papers.
