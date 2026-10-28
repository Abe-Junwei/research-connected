import { getLanguage, moment } from "obsidian";
import { bindLanguage } from "./i18n";

/** Obsidian's language, then the date locale, then the document. Entries import this first. */
export function readHostLanguage(): string {
	const appLanguage = typeof getLanguage === "function" ? getLanguage() : "";
	const dateLanguage = typeof moment?.locale === "function" ? moment.locale() : "";
	const documentLanguage = typeof document !== "undefined" ? document.documentElement.lang : "";
	return appLanguage || dateLanguage || documentLanguage;
}

bindLanguage(readHostLanguage);
