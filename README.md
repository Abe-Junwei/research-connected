# Research Connected

Obsidian plugin: Connected Papers–style similarity map for a seed paper via [OpenAlex](https://openalex.org/), with force / temporal / radial layouts and note embeds.

**Version:** 1.5.1 (installable build)

## Install (manual)

1. Copy this folder into your vault:  
   `.obsidian/plugins/research-connected/`
2. Enable **Research Connected** in Obsidian → Settings → Community plugins.
3. Optional: set an [OpenAlex API key](https://openalex.org/settings/api) in plugin settings for higher rate limits.

Required files: `main.js`, `manifest.json`, `styles.css`.

## Note embed

````markdown
```research-connected
doi: 10.1038/nature14539
layout: temporal
```
````

Aliases: `research-connected`, `connected-papers`.

Useful keys: `position`, `width`, `height`, `align`, `labels`, `yearFrom` / `yearTo`, `language`, `type`, `concept`, `minCoCite`, `minShared`, `layout`, `color`.

## Source

This repo currently holds the **built** plugin for Obsidian. Full TypeScript source lives in the Cursor Origin draft from the cloud agent that developed it; it will be added when that workspace can be exported again.

## License

MIT (unless noted otherwise in a later LICENSE file).
