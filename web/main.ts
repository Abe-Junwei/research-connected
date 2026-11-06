import "../src/host-language";
import { mountGraphApp, type AppDeps } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { browserGetJson, browserPostJson } from "./http";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { normalizeProjects } from "../src/project-state";
import { createReadingWorkflow, normalizeReadingWorkflow } from "../src/reading-workflow";
import { revalidateWebSettings, commitWebRevalidation } from "../preview/revalidate";
import { prepareWebSettings, checkWebMetadata, prepareWebGraph, decorateWebExport } from "../preview/quality";
import { writeWebProjectSettings, StorageFullError } from "./storage";
import { confirmQuota, fetchQuotaStatus, formatQuotaBanner, releaseQuota, reserveQuota, type QuotaAction } from "./quota-client";
import { claimBrowserTask, claimEdit, clearBrowserTask, currentTabId, isReadOnly, releaseEdit, startHeartbeat } from "./session";
import { tr } from "../src/i18n";

const STORAGE_KEY = "research-connected-web-settings";
const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing #app");

const params = new URLSearchParams(window.location.search);
const detailId = params.get("paper") || params.get("doi") || "";
const offline = params.has("fixture");

const settings = { ...DEFAULT_SETTINGS, researchProjects: { ...DEFAULT_SETTINGS.researchProjects } };
// Empty client key: Authorization is injected by the system proxy. A non-empty
// marker keeps deep OpenAlex paging enabled under the shared neighborhood rules.
settings.apiKey = "system-proxy";
settings.contactEmail = "";

try {
	const saved = window.localStorage.getItem(STORAGE_KEY);
	if (saved) Object.assign(settings, JSON.parse(saved));
	settings.researchProjects = normalizeProjects(settings.researchProjects);
	settings.readingWorkflow = normalizeReadingWorkflow(settings.readingWorkflow);
	settings.apiKey = "system-proxy";
} catch { /* Keep defaults when storage is unavailable. */ }

prepareWebSettings(settings);

const notice = document.querySelector("#cpo-web-notice");
const quotaLine = document.querySelector("#cpo-quota-line");

function setNotice(text: string, kind: "info" | "error" = "info"): void {
	if (!(notice instanceof HTMLElement)) return;
	notice.hidden = !text;
	notice.textContent = text;
	notice.dataset.kind = kind;
}

async function refreshQuota(): Promise<void> {
	if (!(quotaLine instanceof HTMLElement) || offline) return;
	try {
		const status = await fetchQuotaStatus();
		quotaLine.textContent = formatQuotaBanner(status);
		quotaLine.hidden = false;
	} catch {
		quotaLine.textContent = tr("额度状态暂时不可用", "Quota status temporarily unavailable");
		quotaLine.hidden = false;
	}
}

let heartbeatStop: (() => void) | null = null;
let editingProject: string | null = null;

function persistSettings(): void {
	prepareWebSettings(settings);
	try {
		writeWebProjectSettings(STORAGE_KEY, settings);
		window.dispatchEvent(new Event("research-connected-project"));
	} catch (error) {
		if (error instanceof StorageFullError) {
			setNotice(tr("浏览器存储已满，已保留现有项目；请清理旧项目后再保存。本次不扣次数。", "Browser storage is full. Existing projects were kept. Clear old projects and retry. This attempt is not charged."), "error");
			throw error;
		}
		throw error;
	}
}

function ensureEdit(projectKey: string): boolean {
	const result = claimEdit(projectKey);
	if (!result.ok) {
		setNotice(tr("另一标签页正在编辑此项目。可查看和复制，或使用“接管编辑”。", "Another tab is editing this project. You can view and copy, or take over editing."), "info");
		return false;
	}
	editingProject = projectKey;
	heartbeatStop?.();
	heartbeatStop = startHeartbeat(projectKey);
	return true;
}

const operationGate: NonNullable<AppDeps["operationGate"]> = {
	async reserve(action: QuotaAction) {
		await refreshQuota();
		const decision = await reserveQuota(action);
		if (!decision.ok || !decision.reservation_id) {
			setNotice(decision.message || tr("当前无法开始任务", "Cannot start a task right now"), "error");
			await refreshQuota();
			return { blocked: decision.reason || decision.code || decision.message };
		}
		if (!claimBrowserTask({ reservationId: decision.reservation_id, action, projectKey: editingProject ?? "global" })) {
			await releaseQuota(decision.reservation_id);
			setNotice(tr("同一浏览器已有建图、重建或深挖任务在进行。", "This browser already has a build, rebuild, or deep-dive task running."), "error");
			return { blocked: "browser_busy" };
		}
		await refreshQuota();
		return { reservationId: decision.reservation_id };
	},
	async confirm(reservationId: string) {
		const decision = await confirmQuota(reservationId);
		clearBrowserTask(reservationId);
		await refreshQuota();
		if (!decision.ok) throw new Error(decision.message || tr("确认扣次失败", "Could not confirm the operation quota"));
	},
	async release(reservationId: string) {
		try { await releaseQuota(reservationId); } catch { /* Best-effort release. */ }
		clearBrowserTask(reservationId);
		await refreshQuota();
	},
};

async function start(): Promise<void> {
	const host = root as HTMLElement;
	if (detailId) {
		document.title = "Research Connected";
		host.replaceChildren();
		const panel = el(host, "section", "cpo-web-detail");
		const pending = el(panel, "p", "cpo-side-tip");
		pending.textContent = tr("正在查询文献…", "Looking up the paper…");
		try {
			const { OpenAlexClient, toPaper } = await import("../src/openalex");
			const { classifyQuery } = await import("../src/paper");
			const client = new OpenAlexClient(browserGetJson, { apiKey: "", contactEmail: "" });
			const parsed = classifyQuery(detailId);
			const raw = parsed?.kind === "doi" ? await client.workByDoi(parsed.value)
				: parsed?.kind === "openalex" ? await client.workById(parsed.value)
				: null;
			const paper = raw ? toPaper(raw, "related") : null;
			panel.replaceChildren();
			if (!paper) {
				const missing = el(panel, "p", "cpo-side-tip");
				missing.textContent = tr("未找到该文献。打开此链接不会自动建图，也不携带原浏览器的收藏或排除状态。", "Paper not found. Opening this link does not build a graph or carry favorites or exclusions.");
				return;
			}
			const title = el(panel, "h1");
			title.textContent = paper.title;
			const meta = el(panel, "p", "cpo-meta");
			meta.textContent = [paper.authors, paper.year, paper.doiUrl?.replace(/^https?:\/\/doi\.org\//, "")].filter(Boolean).join(" · ");
			const note = el(panel, "p", "cpo-side-tip");
			note.textContent = tr("跨设备打开详情仅展示该文献，不自动新建图谱，也不同步收藏、阅读或排除状态。", "Opening a detail link on another device only shows this paper. It does not rebuild the graph or sync favorites, reading, or exclusions.");
			const back = el(panel, "a");
			back.href = "./";
			back.textContent = tr("返回图谱", "Back to graph");
		} catch (error) {
			panel.replaceChildren();
			const failed = el(panel, "p", "cpo-side-tip");
			failed.textContent = error instanceof Error ? error.message : tr("查询失败", "Lookup failed");
		}
		return;
	}

	host.textContent = tr("正在核对本地项目的文献来源…", "Checking saved sources…");
	const review = offline ? null : await revalidateWebSettings(settings, browserGetJson, next => {
		try { commitWebRevalidation(STORAGE_KEY, next); }
		catch { writeWebProjectSettings(STORAGE_KEY, next); }
	});
	host.replaceChildren();
	await refreshQuota();

	const takeover = document.querySelector("#cpo-takeover");
	if (takeover instanceof HTMLButtonElement) {
		takeover.onclick = () => {
			const projectKey = Object.keys(settings.researchProjects)[0];
			if (!projectKey) return;
			claimEdit(projectKey, true);
			setNotice(tr("已接管编辑。原标签页将变为只读，其进行中的任务结果将被忽略。", "Edit takeover complete. The previous tab becomes read-only and its in-flight results are ignored."));
		};
	}

	mountGraphApp(host, {
		...createReadingWorkflow({ getSettings: () => settings, persist: persistSettings }),
		getSettings: () => settings,
		saveProject: (project, projectKey) => {
			const key = projectKey ?? project.seedId;
			if (isReadOnly(key) && !ensureEdit(key)) throw new Error(tr("当前标签页为只读", "This tab is read-only"));
			if (!ensureEdit(key)) throw new Error(tr("未能取得编辑权", "Could not obtain edit access"));
			settings.researchProjects[key] = project;
			persistSettings();
		},
		persistSettings,
		loadSavedProject: () => Object.values(settings.researchProjects).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
		getJson: browserGetJson,
		postJson: browserPostJson,
		prepareGraph: graph => [review?.notice, prepareWebGraph(graph)].filter(Boolean).join("\n") || null,
		decorateExport: (papers, text, format) => decorateWebExport(papers, text, format, review?.complete === false),
		checkMetadata: paper => checkWebMetadata(paper, browserGetJson),
		operationGate,
		confirmChoice: async (message) => window.confirm(message),
		openExternal: (url) => {
			const safe = allowedExternalUrl(url);
			if (safe) window.open(safe, "_blank", "noopener,noreferrer");
		},
		initialDoi: offline ? EXAMPLE_DOI : undefined,
	});

	window.addEventListener("beforeunload", () => {
		if (editingProject) releaseEdit(editingProject);
	});
	void currentTabId();
}

void start();


function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	parent.append(node);
	return node;
}
