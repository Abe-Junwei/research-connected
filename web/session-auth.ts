const TOKEN_KEY = "research-connected-browser-token";
const NONCE_KEY = "research-connected-session-nonce";
const EXPIRY_KEY = "research-connected-session-expiry";
let booting: Promise<void> | null = null;

export function sessionHeaders(): Record<string, string> {
	return {
		"X-Browser-Token": window.localStorage.getItem(TOKEN_KEY) || "",
		"X-Session-Nonce": window.sessionStorage.getItem(NONCE_KEY) || "",
		"X-Client-Api": "2",
	};
}

export async function ensureSession(force = false): Promise<void> {
	const token = window.localStorage.getItem(TOKEN_KEY);
	const nonce = window.sessionStorage.getItem(NONCE_KEY);
	const expiry = Number(window.sessionStorage.getItem(EXPIRY_KEY));
	if (!force && token && nonce && expiry > Date.now() / 1000 + 360) return;
	if (!booting) {
		const start = async () => {
			const response = await window.fetch("/api/session", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...sessionHeaders() },
				body: "{}", signal: AbortSignal.timeout(15000),
			});
			if (!response.ok) throw new Error(`Could not start a secure session (${response.status}).`);
			const json = await response.json() as { browser_token?: string; session_nonce?: string; expires_at?: number };
			if (!json.browser_token || !json.session_nonce || !json.expires_at) throw new Error("Session response was incomplete.");
			window.localStorage.setItem(TOKEN_KEY, json.browser_token);
			window.sessionStorage.setItem(NONCE_KEY, json.session_nonce);
			window.sessionStorage.setItem(EXPIRY_KEY, String(json.expires_at));
		};
		booting = (async () => {
			if (navigator.locks) await navigator.locks.request("research-connected-session", start);
			else await start();
		})().finally(() => { booting = null; });
	}
	await booting;
}
