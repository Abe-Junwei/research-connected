const KEY = "research-connected-browser-id";

/** Stable anonymous browser id for quota accounting. Clearing site data resets the personal counter. */
export function browserId(): string {
	try {
		const existing = window.localStorage.getItem(KEY);
		if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing;
		const created = crypto.randomUUID();
		window.localStorage.setItem(KEY, created);
		return created;
	} catch {
		return `ephemeral-${Math.random().toString(36).slice(2)}`;
	}
}
