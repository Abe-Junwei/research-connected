import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{ ignores: ["main.js", "preview/**/*.js", "web/dist/**", "scripts/**", "**/*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
		rules: {
			"obsidianmd/ui/sentence-case": ["error", { brands: ["Research Connected"], acronyms: ["DOI", "API"] }],
		},
	},
	{
		// Shared HTTP adapters also run in the Node budget harness; timers need no DOM.
		files: ["src/citation-sources.ts", "src/s2-batch.ts"],
		rules: { "obsidianmd/no-global-this": "off" },
	},
	{
		// Shared source review also runs in the Node migration regression.
		files: ["src/source-revalidation.ts"],
		rules: { "obsidianmd/prefer-window-timers": "off" },
	},
	{
		files: ["src/main.ts"],
		// Match the community scanner: published command IDs must stay stable.
		rules: { "obsidianmd/commands/no-plugin-id-in-command-id": "off" },
	},
	{
		files: ["web/**/*.ts"],
		rules: {
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/ui/sentence-case": "off",
			"no-alert": "off",
		},
	},
];
