import { getLanguage, moment } from "obsidian";

/** The host language is the single source of truth for both graph and note embeds. */
export function isChinese(): boolean {
	const appLanguage = typeof getLanguage === "function" ? getLanguage() : "";
	const dateLanguage = typeof moment?.locale === "function" ? moment.locale() : "";
	const documentLanguage = typeof document !== "undefined" ? document.documentElement.lang : "";
	// Obsidian can mount plugins before its language API reflects the saved UI choice.
	const storedLanguage = typeof localStorage !== "undefined" ? localStorage.getItem("language") ?? "" : "";
	return (storedLanguage || appLanguage || dateLanguage || documentLanguage).toLowerCase().startsWith("zh");
}

export function localize(chinese: string, english: string): string {
	return isChinese() ? chinese : english;
}

export const tr = localize;
