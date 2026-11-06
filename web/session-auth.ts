const TOKEN_KEY = "research-connected-browser-token";
const NONCE_KEY = "research-connected-session-nonce";

let booting: Promise<void> | null = null;

export function sessionHeaders(): Record<string, string> {
	const token = window.localStorage.getItem(TOKEN_KEY) || "";
	const nonce = window.sessionStorage.getItem(NONCE_KEY) || "";
	return {
		"X-Browser-Token": token,
		"X-Session-Nonce": nonce,
	};
}

export async function ensureSession(): Promise<void> {
	const token = window.localStorage.getItem(TOKEN_KEY);
	const nonce = window.sessionStorage.getItem(NONCE_KEY);
	if (token && nonce) return;
	if (!booting) {
		booting = (async () => {
			const response = await window.fetch("/api/session", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
				signal: AbortSignal.timeout(15000),
			});
			if (!response.ok) throw new Error(`Could not start a secure session (${response.status}).`);
			const json = await response.json() as { browser_token?: string; session_nonce?: string };
			if (!json.browser_token || !json.session_nonce) throw new Error("Session response was incomplete.");
			window.localStorage.setItem(TOKEN_KEY, json.browser_token);
			window.sessionStorage.setItem(NONCE_KEY, json.session_nonce);
		})().finally(() => { booting = null; });
	}
	await booting;
}
