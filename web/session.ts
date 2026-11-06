import { browserId } from "./browser-id";

const LOCK_PREFIX = "research-connected-edit-lock:";
const TASK_KEY = "research-connected-active-task";
const HEARTBEAT_MS = 4000;
const STALE_MS = 15000;

export interface EditLock {
	owner: string;
	tabId: string;
	projectKey: string;
	updatedAt: number;
}

export interface ActiveTask {
	tabId: string;
	reservationId: string;
	action: string;
	projectKey: string;
	startedAt: number;
}

function tabId(): string {
	const key = "research-connected-tab-id";
	try {
		const existing = window.sessionStorage.getItem(key);
		if (existing) return existing;
		const created = crypto.randomUUID();
		window.sessionStorage.setItem(key, created);
		return created;
	} catch {
		return crypto.randomUUID();
	}
}

export function currentTabId(): string {
	return tabId();
}

export function readLock(projectKey: string): EditLock | null {
	try {
		const raw = window.localStorage.getItem(LOCK_PREFIX + projectKey);
		return raw ? JSON.parse(raw) as EditLock : null;
	} catch {
		return null;
	}
}

export function claimEdit(projectKey: string, force = false): { ok: true; lock: EditLock } | { ok: false; lock: EditLock } {
	const now = Date.now();
	const existing = readLock(projectKey);
	const self = tabId();
	if (existing && existing.tabId !== self && now - existing.updatedAt < STALE_MS && !force) {
		return { ok: false, lock: existing };
	}
	const lock: EditLock = { owner: browserId(), tabId: self, projectKey, updatedAt: now };
	window.localStorage.setItem(LOCK_PREFIX + projectKey, JSON.stringify(lock));
	return { ok: true, lock };
}

export function heartbeatEdit(projectKey: string): void {
	const existing = readLock(projectKey);
	if (!existing || existing.tabId !== tabId()) return;
	window.localStorage.setItem(LOCK_PREFIX + projectKey, JSON.stringify({ ...existing, updatedAt: Date.now() }));
}

export function releaseEdit(projectKey: string): void {
	const existing = readLock(projectKey);
	if (!existing || existing.tabId !== tabId()) return;
	window.localStorage.removeItem(LOCK_PREFIX + projectKey);
}

export function startHeartbeat(projectKey: string): () => void {
	const timer = window.setInterval(() => heartbeatEdit(projectKey), HEARTBEAT_MS);
	return () => window.clearInterval(timer);
}

export function readActiveTask(): ActiveTask | null {
	try {
		const raw = window.localStorage.getItem(TASK_KEY);
		return raw ? JSON.parse(raw) as ActiveTask : null;
	} catch {
		return null;
	}
}

export function claimBrowserTask(task: Omit<ActiveTask, "tabId" | "startedAt">): boolean {
	const existing = readActiveTask();
	const self = tabId();
	const now = Date.now();
	if (existing && existing.tabId !== self && now - existing.startedAt < 5 * 60 * 1000) return false;
	const next: ActiveTask = { ...task, tabId: self, startedAt: now };
	window.localStorage.setItem(TASK_KEY, JSON.stringify(next));
	return true;
}

export function clearBrowserTask(reservationId?: string): void {
	const existing = readActiveTask();
	if (!existing || existing.tabId !== tabId()) return;
	if (reservationId && existing.reservationId !== reservationId) return;
	window.localStorage.removeItem(TASK_KEY);
}

/** True when another tab owns the edit lock and it is still fresh. */
export function isReadOnly(projectKey: string): boolean {
	const lock = readLock(projectKey);
	return Boolean(lock && lock.tabId !== tabId() && Date.now() - lock.updatedAt < STALE_MS);
}
