import { browserId } from "./browser-id";

export type QuotaAction = "build" | "rebuild" | "expand";

export interface QuotaStatus {
	period: string;
	reset_at: string;
	browser_remaining: number;
	site_remaining: number;
	browser_limit: number;
	site_limit: number;
	openalex_budget_remaining_usd: number;
	openalex_budget_usd: number;
	active_reservation?: string;
	reason: string;
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
}

async function post(path: string, body?: Record<string, unknown>): Promise<QuotaDecision | QuotaStatus> {
	const response = await window.fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Browser-Id": browserId() },
		body: body ? JSON.stringify(body) : "{}",
		signal: AbortSignal.timeout(15000),
	});
	const json = await response.json() as QuotaDecision | QuotaStatus;
	if (!response.ok && "ok" in json) return json;
	if (!response.ok) throw new Error(("message" in json && json.message) || ("error" in (json as object) ? String((json as { error?: string }).error) : `Quota request failed (${response.status})`));
	return json;
}

export async function fetchQuotaStatus(): Promise<QuotaStatus> {
	return await post("/api/quota/status") as QuotaStatus;
}

export async function reserveQuota(action: QuotaAction): Promise<QuotaDecision> {
	return await post("/api/quota/reserve", { action }) as QuotaDecision;
}

export async function confirmQuota(reservationId: string): Promise<QuotaDecision> {
	return await post("/api/quota/confirm", { reservation_id: reservationId }) as QuotaDecision;
}

export async function releaseQuota(reservationId: string): Promise<QuotaDecision> {
	return await post("/api/quota/release", { reservation_id: reservationId }) as QuotaDecision;
}

export function formatQuotaBanner(status: QuotaStatus): string {
	const reset = status.reset_at ? new Date(status.reset_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";
	const reason = status.reason === "browser_quota" ? "浏览器今日次数已用完"
		: status.reason === "site_quota" ? "全站今日名额已用完"
		: status.reason === "openalex_budget" ? "OpenAlex 免费用量已用尽"
		: status.reason === "browser_busy" ? "当前浏览器已有进行中的任务"
		: status.reason === "ip_rate" ? "同一网络启动过快，请稍后重试"
		: "";
	return `浏览器剩余 ${status.browser_remaining}/${status.browser_limit} · 全站剩余 ${status.site_remaining}/${status.site_limit} · 北京时间重置 ${reset}${reason ? ` · ${reason}` : ""}`;
}
