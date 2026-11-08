import { ensureSession, sessionHeaders } from "./session-auth";

export type QuotaAction = "build" | "rebuild" | "expand";

export interface QuotaStatus {
	ok?: boolean;
	period: string;
	budget_period?: string;
	reset_at: string;
	browser_remaining: number;
	site_remaining: number;
	browser_limit: number;
	site_limit: number;
	openalex_budget_remaining_usd: number;
	openalex_budget_usd: number;
	openalex_upstream_remaining_usd?: number;
	active_reservation?: string;
	reason: string;
	code?: string;
	message?: string;
}

export interface QuotaDecision {
	ok: boolean;
	code: string;
	message: string;
	reservation_id?: string;
	expires_at?: number;
	browser_remaining: number;
	site_remaining: number;
	reset_at: string;
	reason: string;
	idempotency_key?: string;
}

const TASK_KEY = "research-connected-web-task";

export interface LocalTask {
	reservationId: string;
	idempotencyKey: string;
	action: QuotaAction;
	expiresAt: number;
	createdAt: number;
	saved?: boolean;
}

export function readLocalTask(): LocalTask | null {
	try {
		const raw = window.sessionStorage.getItem(TASK_KEY);
		return raw ? JSON.parse(raw) as LocalTask : null;
	} catch {
		return null;
	}
}

export function writeLocalTask(task: LocalTask): void {
	window.sessionStorage.setItem(TASK_KEY, JSON.stringify(task));
}

export function clearLocalTask(reservationId?: string): void {
	const current = readLocalTask();
	if (reservationId && current && current.reservationId !== reservationId) return;
	window.sessionStorage.removeItem(TASK_KEY);
}

export function taskStillValid(task: LocalTask | null = readLocalTask(), now = Date.now() / 1000): boolean {
	return Boolean(task && task.expiresAt > now + 0.5);
}

async function post(path: string, body?: Record<string, unknown>): Promise<QuotaDecision | QuotaStatus> {
	await ensureSession();
	let response = await window.fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...sessionHeaders() },
		body: body ? JSON.stringify(body) : "{}",
		signal: AbortSignal.timeout(15000),
	});
	if (response.status === 401 && path !== "/api/quota/confirm" && path !== "/api/quota/release") {
		await ensureSession(true);
		response = await window.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() }, body: body ? JSON.stringify(body) : "{}", signal: AbortSignal.timeout(15000) });
	}
	const json = await response.json() as QuotaDecision | QuotaStatus;
	if (!response.ok && "ok" in json) return json;
	if (!response.ok) {
		const message = ("message" in json && json.message)
			|| ("error" in (json as object) ? String((json as { error?: string }).error) : `Quota request failed (${response.status})`);
		throw new Error(message);
	}
	return json;
}

export async function fetchQuotaStatus(): Promise<QuotaStatus> {
	return await post("/api/quota/status") as QuotaStatus;
}

export async function reserveQuota(action: QuotaAction): Promise<QuotaDecision> {
	const idempotencyKey = crypto.randomUUID();
	const decision = await post("/api/quota/reserve", { action, idempotency_key: idempotencyKey }) as QuotaDecision;
	if (decision.ok && decision.reservation_id && decision.expires_at) {
		writeLocalTask({
			reservationId: decision.reservation_id,
			idempotencyKey: decision.idempotency_key || idempotencyKey,
			action,
			expiresAt: decision.expires_at,
			createdAt: Date.now() / 1000,
		});
	}
	return decision;
}

export async function confirmQuota(reservationId: string): Promise<QuotaDecision> {
	const task = readLocalTask();
	if (!task || task.reservationId !== reservationId) {
		return { ok: false, code: "task_missing", message: "No in-tab task record for this reservation.", browser_remaining: 0, site_remaining: 0, reset_at: "", reason: "task_missing" };
	}
	if (!taskStillValid(task)) {
		clearLocalTask(reservationId);
		return { ok: false, code: "expired", message: "Reservation expired before confirmation.", browser_remaining: 0, site_remaining: 0, reset_at: "", reason: "expired" };
	}
	while (taskStillValid() && readLocalTask()?.reservationId === reservationId) {
		try {
			const decision = await post("/api/quota/confirm", { reservation_id: reservationId, idempotency_key: task.idempotencyKey }) as QuotaDecision;
			clearLocalTask(reservationId);
			return decision;
		} catch {
			// The result is already saved; retry the same confirmation, never release on a lost reply.
			await new Promise<void>(resolve => window.setTimeout(resolve, Math.min(2000, Math.max(0, task.expiresAt * 1000 - Date.now()))));
		}
	}
	clearLocalTask(reservationId);
	return { ok: false, code: "expired", message: "Saved result retained; confirmation expired without charging.", browser_remaining: 0, site_remaining: 0, reset_at: "", reason: "expired" };
}

export async function releaseQuota(reservationId: string, takeover = false): Promise<QuotaDecision> {
	const task = readLocalTask();
	const idempotencyKey = task && task.reservationId === reservationId ? task.idempotencyKey : undefined;
	const decision = await post("/api/quota/release", { reservation_id: reservationId, ...(takeover ? { takeover: true } : {}), ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) }) as QuotaDecision;
	clearLocalTask(reservationId);
	return decision;
}

export function formatQuotaBanner(status: QuotaStatus): string {
	const reason = status.reason === "browser_quota" ? "浏览器今日次数已用完"
		: status.reason === "site_quota" ? "全站今日名额已用完"
		: status.reason === "openalex_budget" ? "OpenAlex 免费用量已用尽"
		: status.reason === "browser_busy" ? "当前浏览器已有进行中的任务"
		: status.reason === "ip_rate" ? "同一网络启动过快，请稍后重试"
		: status.reason === "session_invalid" ? "会话已失效，请刷新页面"
		: "";
	return `浏览器剩余 ${status.browser_remaining}/${status.browser_limit} · 全站剩余 ${status.site_remaining}/${status.site_limit}${reason ? ` · ${reason}` : ""}`;
}

export function formatQuotaDetails(status: QuotaStatus): string[] {
	const reset = status.reset_at ? new Date(status.reset_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "暂不可用";
	const budget = Number.isFinite(status.openalex_budget_remaining_usd) ? `$${status.openalex_budget_remaining_usd.toFixed(4)}` : "暂不可用";
	return [`北京时间重置 ${reset}`, `OpenAlex 免费预算保守剩余 ${budget}`, `全站每日最多${status.site_limit}次成功操作，另受数据源剩余额度限制。`];
}
