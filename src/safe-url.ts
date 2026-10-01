const ALLOWED_HOSTS = new Set(["doi.org", "openalex.org"]);

/** HTTPS links we are willing to hand to the OS browser. */
export function allowedExternalUrl(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	const host = parsed.hostname.toLowerCase();
	if (ALLOWED_HOSTS.has(host)) return parsed.toString();
	if (host.endsWith(".doi.org") || host.endsWith(".openalex.org")) return parsed.toString();
	return null;
}
