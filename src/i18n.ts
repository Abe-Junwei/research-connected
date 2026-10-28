/** Set by host-language before other modules evaluate. Unset reads the document language. */
let readLanguage: (() => string) | null = null;

export function bindLanguage(read: () => string): void {
	readLanguage = read;
}

/** The host language is the single source of truth for both graph and note embeds. */
export function isChinese(): boolean {
	const language = readLanguage
		? readLanguage()
		: typeof document !== "undefined" ? document.documentElement.lang : "";
	return language.toLowerCase().startsWith("zh");
}

export function localize(chinese: string, english: string): string {
	return isChinese() ? chinese : english;
}

export const tr = localize;
