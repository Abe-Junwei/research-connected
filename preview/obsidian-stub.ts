export function getLanguage(): string {
	return typeof document !== "undefined" ? document.documentElement.lang || "en" : "zh-CN";
}

export const moment = { locale: getLanguage };
