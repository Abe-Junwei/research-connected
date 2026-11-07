import "../src/host-language";
import { paintMetadataCard, paintAbstractCard } from "../src/detail-cards";
import { toBibTeX, toYamlList, toMarkdownTable } from "../src/export-graph";
import { webPaperRecords } from "../src/source-quality";
import { paperHasId } from "../src/work-identity";
import { normalizeDoi } from "../src/paper";
import type { PaperNode } from "../src/types";
import { watchVersion, requireCompatibleClient } from "./version";
import { mountGraphApp, type AppDeps, type GraphAppHandle } from "../src/app";
import { EXAMPLE_DOI } from "../src/constants";
import { browserGetJson, browserPostJson } from "./http";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { createReadingWorkflow } from "../src/reading-workflow";
import { revalidateWebSettings, commitWebRevalidation } from "../preview/revalidate";
import { prepareWebSettings, checkWebMetadata, prepareWebGraph, decorateWebExport } from "../preview/quality";
import { fixtureGet, fixturePost } from "../preview/fixture";
import { StorageFullError } from "./storage";
import { createWebSettingsStore, loadWebSettings } from "./project-store";
import { clearLocalTask, confirmQuota, fetchQuotaStatus, formatQuotaBanner, formatQuotaDetails, readLocalTask, releaseQuota, reserveQuota, taskStillValid, writeLocalTask, type QuotaAction } from "./quota-client";
import { ensureSession } from "./session-auth";
import { claimBrowserTask, claimEdit, readActiveTask, clearBrowserTask, currentTabId, readLock, releaseEdit, startHeartbeat } from "./session";
import { initTheme, wireThemeControls } from "./theme";
import { tr } from "../src/i18n";

const STORAGE_KEY = "research-connected-web-settings";
const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing #app");

const params = new URLSearchParams(window.location.search);
const detailId = params.get("paper") || params.get("doi") || "";
const offline = params.has("fixture");

const settings = structuredClone(DEFAULT_SETTINGS);
// Empty client key: Authorization is injected by the system proxy. A non-empty
// marker keeps deep OpenAlex paging enabled under the shared neighborhood rules.
settings.apiKey = "system-proxy";
settings.contactEmail = "";

let storageWarning = "";
try { Object.assign(settings, loadWebSettings(STORAGE_KEY)); }
catch { storageWarning = tr("浏览器项目存储不可用或格式无法识别。原数据未自动清除；请允许站点存储；若格式损坏，请先清理站点数据再重新建图。", "Browser project storage is unavailable or unreadable. Original data was not cleared. Allow site storage; if the format is corrupt, clear site data before rebuilding."); }

prepareWebSettings(settings);
initTheme();
wireThemeControls();
watchVersion(() => Boolean(readLocalTask() && taskStillValid()));

const notice = document.querySelector("#cpo-web-notice");
const quotaLine = document.querySelector("#cpo-quota-line");

function setNotice(text: string, kind: "info" | "error" = "info"): void {
	if (!(notice instanceof HTMLElement)) return;
	notice.hidden = !text;
	notice.textContent = text;
	notice.dataset.kind = kind;
}

const privacyBtn = document.querySelector("#cpo-privacy-info");
const privacyPanel = document.querySelector("#cpo-privacy-panel");
function setPrivacyOpen(open: boolean): void {
	if (!(privacyBtn instanceof HTMLButtonElement) || !(privacyPanel instanceof HTMLElement)) return;
	privacyBtn.setAttribute("aria-expanded", open ? "true" : "false");
	privacyPanel.hidden = !open;
}

if (privacyBtn instanceof HTMLButtonElement && privacyPanel instanceof HTMLElement) {
	setPrivacyOpen(false);
	privacyBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		setPrivacyOpen(privacyPanel.hidden);
	});
	document.addEventListener("click", (event) => {
		if (privacyPanel.hidden) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (privacyPanel.contains(target) || privacyBtn.contains(target)) return;
		setPrivacyOpen(false);
	}, true);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !privacyPanel.hidden) {
			setPrivacyOpen(false);
			privacyBtn.focus();
		}
	});
}

async function refreshQuota(): Promise<void> {
	if (!(quotaLine instanceof HTMLElement) || offline) return;
	if (quotaLine.hidden) { quotaLine.textContent = tr("额度查询中…", "Checking allowance…"); quotaLine.hidden = false; }
	try {
		const status = await fetchQuotaStatus();
		quotaLine.textContent = formatQuotaBanner(status);
		const details = document.querySelector("#cpo-quota-details");
		if (details instanceof HTMLElement) {
			details.replaceChildren(...formatQuotaDetails(status).map(text => { const p = document.createElement("p"); p.textContent = text; return p; }));
		}
		quotaLine.hidden = false;
	} catch {
		quotaLine.textContent = tr("额度状态暂时不可用", "Quota status temporarily unavailable");
		const details = document.querySelector("#cpo-quota-details");
		if (details instanceof HTMLElement) details.textContent = tr("额度状态暂时不可用；全站每日最多500次成功操作，另受数据源剩余额度限制。", "Quota temporarily unavailable. Up to 500 successful operations daily, subject to source allowance.");
		quotaLine.hidden = false;
	}
}

let heartbeatStop: (() => void) | null = null;
let editingProject: string | null = null;
let activeProjectKey: string | null = null;
let graphApp: GraphAppHandle | null = null;
let taskExpiryTimer: number | null = null;
const lostProjects = new Set<string>();
const store = createWebSettingsStore(STORAGE_KEY, settings, changed => {
	const task = readLocalTask();
	if (task && !task.saved && (!taskStillValid(task) || readActiveTask()?.reservationId !== task.reservationId)) throw new Error(tr("任务已失效，迟到结果不会保存。", "Task invalidated; late results will not be saved."));
	for (const key of [...new Set([...changed, ...(activeProjectKey ? [activeProjectKey] : [])])]) {
		const lock = readLock(key);
		if (lostProjects.has(key) || lock && lock.tabId !== currentTabId()) throw new Error(tr("另一标签页持有编辑权，请先接管并读取最新项目。", "Another tab owns editing. Take over and reload the latest project first."));
		if (!lock && changed.includes(key) && !claimEdit(key).ok) throw new Error("Could not acquire project edit access.");
	}
});
if (storageWarning) setNotice(storageWarning, "error");

async function persistSettings(): Promise<void> {
	prepareWebSettings(settings);
	try {
		await store.persist();
		window.dispatchEvent(new Event("research-connected-project"));
	} catch (error) {
		window.dispatchEvent(new Event("research-connected-project"));
		if (error instanceof StorageFullError) {
			setNotice(tr("浏览器存储已满，已保留现有项目；请清理旧项目后再保存。本次不扣次数。", "Browser storage is full. Existing projects were kept. Clear old projects and retry. This attempt is not charged."), "error");
			throw error;
		}
		setNotice(error instanceof Error ? error.message : String(error), "error");
		throw error;
	}
}

function ensureEdit(projectKey: string): boolean {
	if (lostProjects.has(projectKey)) return false;
	const result = claimEdit(projectKey);
	if (!result.ok) {
		setNotice(tr("另一标签页正在编辑此项目。可查看和复制，或使用“接管编辑”。", "Another tab is editing this project. You can view and copy, or take over editing."), "info");
		window.dispatchEvent(new Event("research-connected-project"));
		return false;
	}
	editingProject = projectKey;
	heartbeatStop?.();
	heartbeatStop = startHeartbeat(projectKey);
	return true;
}

function canMutate(): boolean {
	const task = readActiveTask(), own = readLocalTask();
	if (task && Date.now() - task.startedAt < 300000 && !(task.tabId === currentTabId() && own?.saved)
		&& (task.tabId === currentTabId() || task.projectKey === activeProjectKey)) return false;
	return !activeProjectKey || !lostProjects.has(activeProjectKey) && !ownedElsewhere(activeProjectKey);
}

function ownedElsewhere(key: string): boolean { const lock = readLock(key); return Boolean(lock && lock.tabId !== currentTabId()); }

async function cancelTask(takeover = false): Promise<void> {
	const active = readActiveTask();
	const reservationId = takeover ? active?.reservationId : readLocalTask()?.reservationId;
	if (!reservationId) return;
	if (!takeover || active?.tabId === currentTabId()) graphApp?.cancelPending();
	clearBrowserTask(reservationId, takeover);
	clearLocalTask(reservationId);
	if (taskExpiryTimer !== null) window.clearTimeout(taskExpiryTimer);
	try { await releaseQuota(reservationId, takeover); }
	catch { setNotice(tr("本地任务已取消；服务器名额会在到期后释放。", "Local task cancelled; the server reservation will expire automatically.")); }
	void refreshQuota();
}

const operationGate: NonNullable<AppDeps["operationGate"]> = {
	async reserve(action: QuotaAction) {
		try {
		await requireCompatibleClient();
		await ensureSession(true);
		const existing = readLocalTask();
		if (existing && taskStillValid(existing)) {
			setNotice(tr("当前标签页已有未完成的任务。", "This tab already has an unfinished task."), "error");
			return { blocked: "browser_busy" };
		}
		if (existing) clearLocalTask(existing.reservationId);
		const decision = await reserveQuota(action);
		if (!decision.ok || !decision.reservation_id) {
			setNotice(decision.message || tr("当前无法开始任务", "Cannot start a task right now"), "error");
			void refreshQuota();
			return { blocked: decision.reason || decision.code || decision.message };
		}
		if (!claimBrowserTask({ reservationId: decision.reservation_id, action, projectKey: editingProject ?? "global" })) {
			await releaseQuota(decision.reservation_id);
			setNotice(tr("同一浏览器已有建图、重建或深挖任务在进行。", "This browser already has a build, rebuild, or deep-dive task running."), "error");
			return { blocked: "browser_busy" };
		}
		if (taskExpiryTimer !== null) window.clearTimeout(taskExpiryTimer);
		const reservation = decision.reservation_id;
		taskExpiryTimer = window.setTimeout(() => {
			if (readLocalTask()?.reservationId !== reservation || readLocalTask()?.saved) return;
			void cancelTask();
			setNotice(tr("任务已超过有效期，已停止接收结果，原项目保留。", "Task expired. Late results are ignored; previous project retained."));
		}, Math.max(0, (decision.expires_at ?? 0) * 1000 - Date.now()));
		void refreshQuota();
		return { reservationId: decision.reservation_id };
		} catch (error) {
			setNotice(error instanceof Error ? error.message : tr("暂时无法开始任务，请重试。", "Cannot start the task. Try again."), "error");
			return { blocked: "start_failed" };
		}
	},
	async assertActive(reservationId: string) {
		const task = readLocalTask();
		const active = readActiveTask();
		if (!taskStillValid(task) || !task || task.reservationId !== reservationId || active?.reservationId !== reservationId || active.tabId !== currentTabId()
			|| activeProjectKey && (lostProjects.has(activeProjectKey) || ownedElsewhere(activeProjectKey))) {
			throw new Error(tr("任务已过期，迟到结果不会保存计次。", "The task expired; a late result is not saved or charged."));
		}
	},
	async confirm(reservationId: string) {
		const task = readLocalTask();
		if (!task || task.reservationId !== reservationId) {
			clearBrowserTask(reservationId);
			clearLocalTask(reservationId);
			setNotice(tr("结果已保存，但计次任务已失效；不会追扣。", "Result saved; quota confirmation expired and will not be charged later."));
			return;
		}
		if (taskExpiryTimer !== null) window.clearTimeout(taskExpiryTimer);
		writeLocalTask({ ...task, saved: true });
		void confirmQuota(reservationId).then(decision => {
			clearBrowserTask(reservationId);
			void refreshQuota();
			if (!decision.ok) setNotice(tr("成果已保存在本机，但未能确认次数；本次不追扣。", "Result saved locally; quota confirmation failed and will not be charged later."));
		});
	},
	async release(reservationId: string) {
		if (taskExpiryTimer !== null) window.clearTimeout(taskExpiryTimer);
		try { await releaseQuota(reservationId); } catch { /* Best-effort release. */ }
		clearBrowserTask(reservationId);
		clearLocalTask(reservationId);
		void refreshQuota();
	},
};


function paperExports(parent: HTMLElement, paper: PaperNode): void {
	const actions = el(parent, "div", "cpo-paper-actions");
	const fallback = el(parent, "pre", "cpo-export-text"); fallback.hidden = true; fallback.tabIndex = 0;
	for (const format of ["bibtex", "yaml", "markdown"] as const) {
		const button = el(actions, "button", "cpo-text-btn"); button.type = "button"; button.textContent = format === "bibtex" ? "BibTeX" : format === "yaml" ? "YAML" : "Markdown";
		button.onclick = () => {
			const text = decorateWebExport([paper], format === "bibtex" ? toBibTeX([paper]) : format === "yaml" ? toYamlList([paper]) : toMarkdownTable([paper]), format);
			void (async () => {
				try { await navigator.clipboard.writeText(text); button.textContent = tr("已复制", "Copied"); }
				catch { fallback.hidden = false; fallback.textContent = text; fallback.focus(); const range = document.createRange(); range.selectNodeContents(fallback); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
			})();
		};
	}
}
let mobilePage: { page: HTMLElement; detail: HTMLElement; parent: HTMLElement; view: ReturnType<GraphAppHandle["getViewState"]> } | null = null;
let restoringHistory = false;
function closeMobilePaper(): void {
	if (!mobilePage) return;
	const { page, detail, parent, view } = mobilePage; mobilePage = null;
	parent.append(detail); page.remove(); (root as HTMLElement).hidden = false; graphApp?.setViewState(view);
}
function openMobilePaper(paper: PaperNode, detail: HTMLElement): void {
	if (!window.matchMedia("(max-width: 640px)").matches || !graphApp) return;
	if (mobilePage) return;
	const parent = detail.parentElement; if (!parent) return;
	const page = el(document.body, "section", "cpo-web-detail cpo-surface"); page.id = "cpo-web-paper-page";
	mobilePage = { page, detail, parent, view: graphApp.getViewState() };
	const back = el(page, "button", "cpo-text-btn"); back.type = "button"; back.textContent = tr("返回图谱", "Back to graph"); back.onclick = () => history.back();
	const deep = el(page, "button", "cpo-text-btn cpo-web-deep"); deep.type = "button"; deep.textContent = tr("深挖此文献", "Explore this paper"); deep.disabled = !canMutate();
	deep.onclick = () => { history.back(); void graphApp?.expandPaper(paper.id).catch(error => setNotice(String(error), "error")); };
	paperExports(page, paper); page.append(detail); (root as HTMLElement).hidden = true;
	if (!restoringHistory) { const url = new URL(location.href); url.searchParams.set("paper", paper.id); url.searchParams.delete("doi"); history.pushState({}, "", url); }
}
window.addEventListener("popstate", () => {
	const id = new URLSearchParams(location.search).get("paper");
	if (!id) closeMobilePaper();
	else if (!mobilePage && graphApp) { restoringHistory = true; graphApp.selectPaper(id); restoringHistory = false; }
});

async function start(): Promise<void> {
	const host = root as HTMLElement;
	// Local rendering must never wait for a session, provider or quota request.
	void refreshQuota();
	if (detailId) {
		document.title = "文现 · Research Connected";
		host.replaceChildren();
		const panel = el(host, "section", "cpo-web-detail");
		const pending = el(panel, "p", "cpo-side-tip");
		pending.textContent = tr("正在查询文献…", "Looking up the paper…");
		try {
			const { OpenAlexClient, toPaper } = await import("../src/openalex");
			const { classifyQuery } = await import("../src/paper");
			const client = new OpenAlexClient(browserGetJson, { apiKey: "", contactEmail: "" });
			const parsed = classifyQuery(detailId);
			const local = webPaperRecords(settings).find(paper => paperHasId(paper, detailId) || Boolean(normalizeDoi(detailId) && normalizeDoi(paper.doiUrl ?? "") === normalizeDoi(detailId)));
			const raw = local ? null : parsed?.kind === "doi" ? await client.workByDoi(parsed.value)
				: parsed?.kind === "openalex" ? await client.workById(parsed.value) : null;
			const paper = local ? structuredClone(local) : raw ? toPaper(raw, "related") : null;
			panel.replaceChildren();
			if (!paper) {
				const missing = el(panel, "p", "cpo-side-tip");
				missing.textContent = tr("未找到该文献。打开此链接不会自动建图，也不携带原浏览器的收藏或排除状态。", "Paper not found. Opening this link does not build a graph or carry favorites or exclusions.");
				const backMissing = el(panel, "a");
				backMissing.href = "./";
				backMissing.textContent = tr("返回图谱", "Back to graph");
				return;
			}
			const quality = el(panel, "p", "cpo-side-tip"); quality.hidden = true;
			void checkWebMetadata(paper, browserGetJson).then(text => { if (text) { quality.textContent = text; quality.hidden = false; } }).catch(() => {});
			paintMetadataCard(panel, paper, null);
			const abstract = el(panel, "div");
			paintAbstractCard(abstract, paper, p => p.abstract || tr("暂无可用摘要", "No abstract available"));
			if (!paper.abstract) {
				const retry = el(panel, "button", "cpo-text-btn"); retry.type = "button"; retry.textContent = tr("重试获取摘要", "Retry abstract");
				retry.onclick = () => { void (async () => {
					retry.disabled = true;
					try {
						const { fallbackAbstract } = await import("../src/citation-sources");
						const result = await fallbackAbstract(browserGetJson, paper, { semanticScholarApiKey: "", contactEmail: "" });
						if (result.status === "found") { paper.abstract = result.text; paper.abstractSource = result.source; abstract.replaceChildren(); paintAbstractCard(abstract, paper, p => p.abstract); retry.hidden = true; }
						else retry.textContent = result.status === "error" ? result.error : tr("未取得可用摘要，可稍后重试", "No abstract found; try later");
					} catch (error) { retry.textContent = String(error); }
					finally { retry.disabled = false; }
				})(); };
			}
			paperExports(panel, paper);
			for (const url of [paper.doiUrl, `https://openalex.org/${paper.id}`].filter(Boolean)) {
				const safe = allowedExternalUrl(url!);
				if (safe) { const link = el(panel, "a"); link.href = safe; link.textContent = safe; link.rel = "noopener noreferrer"; link.target = "_blank"; }
			}
			el(panel, "p", "cpo-side-tip").textContent = tr("本页不自动重建原图谱；跨设备不携带原浏览器的个人整理状态。", "This page does not rebuild the original graph or transfer personal workflow state across devices.");
			const back = el(panel, "a");
			back.href = "./";
			back.textContent = tr("返回图谱", "Back to graph");
		} catch (error) {
			panel.replaceChildren();
			const failed = el(panel, "p", "cpo-side-tip");
			failed.textContent = error instanceof Error ? error.message : tr("查询失败", "Lookup failed");
			const backFail = el(panel, "a");
			backFail.href = "./";
			backFail.textContent = tr("返回图谱", "Back to graph");
		}
		return;
	}

	let review: Awaited<ReturnType<typeof revalidateWebSettings>> = null;

	const takeover = document.querySelector("#cpo-takeover");
	const cancel = document.querySelector("#cpo-cancel-task");
	if (cancel instanceof HTMLButtonElement) cancel.onclick = () => { void cancelTask(); };

	function syncTakeoverButton(): void {
		const task = readLocalTask();
		if (cancel instanceof HTMLButtonElement) cancel.hidden = !task || Boolean(task.saved) || !taskStillValid(task);
		const blocked = !canMutate();
		for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".cpo-paper-stage, .cpo-reading-trigger, .cpo-reading-option, .cpo-paper-exclude, .cpo-project-rename, .cpo-project-delete, .cpo-web-deep"))) {
			if (blocked && !button.disabled) { button.dataset.accessDisabled = "true"; button.disabled = true; }
			if (!blocked && button.dataset.accessDisabled) { button.disabled = false; delete button.dataset.accessDisabled; }
		}
		if (!(takeover instanceof HTMLButtonElement)) return;
		const projectKey = activeProjectKey;
		const foreign = Boolean(projectKey && (ownedElsewhere(projectKey) || lostProjects.has(projectKey)));
		takeover.hidden = !foreign;
		if (foreign && projectKey) {
			const lock = readLock(projectKey);
			const label = tr("接管编辑", "Take over editing");
			if (takeover.textContent !== label) takeover.textContent = label;
			takeover.setAttribute("aria-label", tr("另一标签页正在编辑此项目，点击接管编辑权", "Another tab is editing this project. Take over editing."));
			takeover.title = lock ? tr("另一标签页持有编辑锁", "Another tab holds the edit lock") : "";
		}
	}

	if (takeover instanceof HTMLButtonElement) {
		takeover.hidden = true;
		takeover.onclick = async () => {
			try {
			const projectKey = activeProjectKey;
			if (!projectKey) return;
			if (readActiveTask()?.projectKey === projectKey) await cancelTask(true);
			store.refresh(true);
			lostProjects.delete(projectKey);
			const result = claimEdit(projectKey, true);
			if (!result.ok) {
				setNotice(tr("未能接管编辑，请重试。", "Could not take over editing. Try again."), "error");
				syncTakeoverButton();
				return;
			}
			editingProject = projectKey;
			heartbeatStop?.();
			heartbeatStop = startHeartbeat(projectKey);
			syncTakeoverButton();
			window.dispatchEvent(new Event("research-connected-project"));
			setNotice(tr("已接管编辑。原标签页将变为只读，其进行中的任务结果将被忽略。", "Edit takeover complete. The previous tab becomes read-only and its in-flight results are ignored."));
			} catch (error) { setNotice(error instanceof Error ? error.message : String(error), "error"); }
		};
	}


	window.addEventListener("storage", (event) => {
		if (!event.key || event.key.startsWith("research-connected-edit-lock:")) {
			if (editingProject && readLock(editingProject)?.tabId !== currentTabId()) {
				lostProjects.add(editingProject);
				heartbeatStop?.();
				graphApp?.cancelPending();
				if (readLocalTask() && !readLocalTask()?.saved) void cancelTask();
			}
			syncTakeoverButton();
		}
		if (event.key === STORAGE_KEY) {
			try { if (store.refresh()) window.dispatchEvent(new Event("research-connected-project")); }
			catch { setNotice(tr("另一标签页的项目无法读取，已保留当前数据。", "Could not read the other tab's project; current data retained."), "error"); }
		}
		if (event.key === "research-connected-active-task" && readLocalTask() && !readLocalTask()?.saved && readActiveTask()?.reservationId !== readLocalTask()?.reservationId) graphApp?.cancelPending();
	});
	window.addEventListener("research-connected-project", () => syncTakeoverButton());
	window.setInterval(syncTakeoverButton, 2000);
	new MutationObserver(syncTakeoverButton).observe(host, { childList: true, subtree: true });
	syncTakeoverButton();

	const workflow = createReadingWorkflow({ getSettings: () => settings, persist: persistSettings });
	graphApp = mountGraphApp(host, {
		...workflow,
		readingOpened: paper => canMutate() ? workflow.readingOpened(paper) : Promise.resolve(),
		resolveReading: (...args) => canMutate() ? workflow.resolveReading(...args) : Promise.reject(new Error("Project is read-only or busy.")),
		retryReading: (...args) => canMutate() ? workflow.retryReading(...args) : Promise.reject(new Error("Project is read-only or busy.")),
		getSettings: () => settings,
		saveProject: async (project, projectKey) => {
			const key = projectKey ?? project.seedId;
			settings.researchProjects[key] = project;
			await persistSettings();
		},
		persistSettings,
		canMutate,
		onSelectPaper: openMobilePaper,
		onProjectChange: key => {
			if (key === activeProjectKey) return;
			if (editingProject) { heartbeatStop?.(); releaseEdit(editingProject); editingProject = null; }
			activeProjectKey = key;
			if (key) ensureEdit(key);
			syncTakeoverButton();
		},
		beforeProjectSwitch: async () => {
			const task = readLocalTask();
			if (task && !task.saved && taskStillValid(task)) {
				if (!window.confirm(tr("切换项目将取消当前任务，是否继续？", "Switching projects cancels the current task. Continue?"))) return false;
				await cancelTask();
			}
			return true;
		},
		loadSavedProject: () => Object.values(settings.researchProjects).filter((project) => project.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
		getJson: offline ? fixtureGet : browserGetJson,
		postJson: offline ? fixturePost : browserPostJson,
		prepareGraph: graph => [review?.notice, prepareWebGraph(graph)].filter(Boolean).join("\n") || null,
		decorateExport: (papers, text, format) => decorateWebExport(papers, text, format, review?.complete === false),
		checkMetadata: paper => checkWebMetadata(paper, browserGetJson),
		...(offline ? {} : { operationGate }),
		confirmChoice: async (message) => window.confirm(message),
		openExternal: (url) => {
			const safe = allowedExternalUrl(url);
			if (safe) window.open(safe, "_blank", "noopener,noreferrer");
		},
		initialDoi: offline && !Object.values(settings.researchProjects).some(project => project.snapshot) ? EXAMPLE_DOI : undefined,
	});

	const brand = host.querySelector(".cpo-brand");
	if (brand instanceof HTMLElement) { brand.replaceChildren(); const name = el(brand, "strong"); name.textContent = "文现"; brand.title = "文现 · Research Connected"; brand.setAttribute("aria-label", brand.title); }
	const chrome = document.querySelector("#cpo-web-chrome");
	const bar = host.querySelector(".cpo-bar");
	if (chrome instanceof HTMLElement && bar) bar.append(chrome);
	window.performance.mark("research-connected-ready");

	window.addEventListener("beforeunload", () => {
		if (editingProject) releaseEdit(editingProject);
	});
	void currentTabId();
	if (!offline) {
		// Review a copy after first paint; a stale result must never overwrite editing.
		window.requestAnimationFrame(() => window.setTimeout(() => {
			const baseline = JSON.stringify(settings);
			let stored: string | null;
			try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { return; }
			void revalidateWebSettings(structuredClone(settings), browserGetJson, async next => {
				const commit = (): void => {
				const task = readActiveTask();
				if (JSON.stringify(settings) !== baseline || window.localStorage.getItem(STORAGE_KEY) !== stored
					|| task && Date.now() - task.startedAt < 300000
					|| Object.keys(settings.researchProjects).some(key => ownedElsewhere(key))) {
					throw new Error(tr("项目正在使用或已发生修改，本轮来源核对未覆盖当前项目。", "The project is in use or has changed; the background review did not overwrite it."));
				}
				commitWebRevalidation(STORAGE_KEY, next);
				store.refresh(true);
				window.dispatchEvent(new Event("research-connected-project"));
				};
				if (navigator.locks) await navigator.locks.request("research-connected-project-write", commit);
				else commit();
			}).then(result => {
				review = result;
				if (result?.notice) setNotice(result.notice);
			}).catch(() => { /* Keep the locally rendered project on review failure. */ });
		}, 0));
	}
	// Re-assert tokens on the mounted surface and refresh the canvas palette.
	window.dispatchEvent(new Event("research-connected-theme"));
}

void start();


function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	parent.append(node);
	return node;
}
