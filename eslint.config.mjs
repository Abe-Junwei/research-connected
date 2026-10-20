import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{ ignores: ["main.js", "preview/**/*.js", "scripts/**", "**/*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
		rules: {
			"obsidianmd/ui/sentence-case": ["error", { brands: ["Research Connected"], acronyms: ["DOI", "API"] }],
		},
	},
	{
		files: ["src/main.ts"],
		// Match the community scanner: published command IDs must stay stable.
		rules: { "obsidianmd/commands/no-plugin-id-in-command-id": "off" },
	},
];
