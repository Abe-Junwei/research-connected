# Contributing

Use the [bug report form](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml) for problems and the [feature request form](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml) for improvements. English or Chinese is welcome. Search [existing issues](https://github.com/Abe-Junwei/research-connected/issues) first.

Reports are public. Remove API keys, private notes, and unpublished research from logs and screenshots. Do not upload a full vault or `data.json`. A public DOI/OpenAlex ID and short reproduction steps are usually more useful.

Use Node.js 24.11.1 and install the locked development tools with `npm ci`.

Before submitting a change, run:

```sh
npm run lint
npm test
npm run build
npm run preview
```

Check the graph pane and note embeds in Reading view and Live Preview, including keyboard navigation, narrow widths, light and dark themes. Settings changes should preserve saved projects and credentials. Changes to stored data need a migration regression and a reversible backup.

For the browser regression, run `npm run test:browser:build`, serve the repository (for example, `python3 -m http.server 8765 --bind 127.0.0.1`), and open `http://127.0.0.1:8765/.superdesign/tmp/review-check.html`. The page must report PASS for reading-state save/rollback and citation-path input validation.

The browser preview uses browser networking and storage because it runs outside Obsidian. Production requests go through `src/obsidian-http.ts`; production persistence goes through the plugin data API. Keep those boundaries intact.

Release tags must match `package.json` and `manifest.json`. The release workflow validates, builds, and attests the three plugin files, then creates a draft release for review. Publish that draft only after host acceptance. Verify provenance with `gh attestation verify main.js --repo Abe-Junwei/research-connected` (and repeat for `manifest.json` and `styles.css`). Community scorecards update after the published release is scanned.
