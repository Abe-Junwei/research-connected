import { allowedExternalUrl } from "./safe-url";

/**
 * Open an allowlisted https link. Obsidian rejects any plugin bundle that
 * contains `require("electron")`, so this stays on `window.open` only.
 */
export function openExternal(url: string): void {
	const safe = allowedExternalUrl(url);
	if (!safe) return;
	window.open(safe, "_blank", "noopener,noreferrer");
}
