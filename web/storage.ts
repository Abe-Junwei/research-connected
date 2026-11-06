import type { ConnectedPapersSettings } from "../src/settings-model";

export class StorageFullError extends Error {
	constructor(message = "Browser storage is full") {
		super(message);
		this.name = "StorageFullError";
	}
}

function isQuota(error: unknown): boolean {
	return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

/**
 * Formal web storage: never auto-delete complete projects to make room.
 * On quota failure keep existing localStorage contents untouched.
 */
export function writeWebProjectSettings(key: string, settings: ConnectedPapersSettings): void {
	const payload = JSON.stringify(settings);
	try {
		window.localStorage.setItem(key, payload);
	} catch (error) {
		if (isQuota(error)) throw new StorageFullError();
		throw error;
	}
}

export function readWebProjectSettings(key: string): ConnectedPapersSettings | null {
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as ConnectedPapersSettings;
	} catch {
		return null;
	}
}
