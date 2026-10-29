import { tr } from "./i18n";
import { paintPaperActionFeedback } from "./paper-actions";
import type { ReadingWorkflowDeps } from "./reading-workflow";
import type { ResearchProject } from "./project-state";
import type { PaperNode } from "./types";

export type WorkflowLibraryTab = "staged" | "excluded" | "pending";

export interface WorkflowLibraryOptions {
	tab: WorkflowLibraryTab;
	projectId: string | null;
	projects: Record<string, ResearchProject>;
	workflow: ReadingWorkflowDeps;
	onTab: (tab: WorkflowLibraryTab) => void;
	onView: (paper: PaperNode) => void;
	onLocate: (paper: PaperNode) => void;
	onExclude: (paper: PaperNode, excluded: boolean) => Promise<void> | void;
	onRefresh: () => void;
	onResolvePending?: (projectKey: string, pendingId: string, choice: "merge" | "separate" | "version" | "whole" | "visible") => Promise<void>;
	onExtraHeader?: (header: HTMLElement, papers: PaperNode[]) => void;
}

/** Project lists share the same actions; reading issues always cover the whole library. */
export function paintWorkflowLibrary(host: HTMLElement, options: WorkflowLibraryOptions): void {
	host.hidden = false;
	host.replaceChildren();
	const append = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string, text = ""): HTMLElementTagNameMap[K] => {
		const element = createEl(tag);
		element.className = className;
		element.textContent = text;
		parent.append(element);
		return element;
	};
	const feedbackHost = host.closest<HTMLElement>(".cpo-evidence-sidebar") ?? host;
	const run = async (button: HTMLButtonElement, action: () => Promise<void> | void, success?: string): Promise<void> => {
		button.disabled = true;
		try { await action(); options.onRefresh(); if (success) paintPaperActionFeedback(feedbackHost, success); }
		catch (error) {
			const message = append(host, "p", "cpo-paper-action-error", error instanceof Error ? error.message : tr("保存失败，请重试", "Could not save. Try again."));
			message.setAttribute("role", "status");
		} finally { button.disabled = false; }
	};
	const action = (parent: HTMLElement, label: string, callback: () => Promise<void> | void, success?: string): void => {
		const button = append(parent, "button", "cpo-library-action", label);
		button.type = "button";
		button.onclick = () => { void run(button, callback, success); };
	};
	const tabs = append(host, "div", "cpo-library-switch");
	for (const [tab, title] of [["staged", tr("收藏", "Saved")], ["excluded", tr("排除", "Excluded")], ["pending", tr("待处理（全库）", "Pending (library)")]] as const) {
		const button = append(tabs, "button", "cpo-library-switch-item", title);
		button.type = "button";
		button.setAttribute("aria-pressed", String(options.tab === tab));
		button.onclick = () => options.onTab(tab);
	}
	const project = options.projectId ? options.projects[options.projectId] : undefined;
	if (options.tab === "pending") {
		const issues = options.workflow.getReadingIssues();
		const projectIssues = Object.entries(options.projects).flatMap(([key, project]) => (project.pending ?? []).map(item => ({ key, project, item })));
		if (!issues.length && !projectIssues.length) append(host, "p", "cpo-agg-empty", tr("没有待处理项", "Nothing needs attention"));
		for (const { key, project, item } of projectIssues) {
			const card = append(host, "div", "cpo-card cpo-library-card");
			append(card, "h3", "cpo-card-title", item.paper?.title ?? item.id);
			append(card, "p", "cpo-library-meta", `${project.name} · ${item.kind === "identity" ? tr("版本归属待确认", "Version identity needs confirmation") : tr("排除范围待确认", "Exclusion scope needs confirmation")}`);
			append(card, "p", "cpo-fact-note", `${item.sources?.join(" · ") ?? "legacy"} · ${JSON.stringify(item.raw) ?? "—"}`);
			const actions = append(card, "div", "cpo-library-actions");
			if (item.paper) action(actions, tr("查看详情", "View details"), () => options.onView(item.paper!));
			if (options.onResolvePending) for (const [choice, title] of item.kind === "identity" ? [["merge", tr("确认同一研究", "Confirm same research")], ["separate", tr("保持分开", "Keep separate")]] as const : [["version", tr("仅原版本排除", "Exclude original version")], ["whole", tr("整项研究排除", "Exclude whole research")], ["visible", tr("恢复可见", "Restore visibility")]] as const) action(actions, title, () => options.onResolvePending!(key, item.id, choice));
		}
		const labels = { unread: tr("未读", "Unread"), "to-read": tr("待读", "To read"), read: tr("已读", "Read") };
		for (const issue of issues) {
			const card = append(host, "div", "cpo-card cpo-library-card");
			append(card, "h3", "cpo-card-title", issue.paper.title || issue.paper.id);
			append(card, "p", "cpo-library-meta", issue.projects.map(project => `${project.name || project.id} (${project.id})`).join(" · ") || tr("未关联项目", "No linked project"));
			append(card, "p", "cpo-fact-note", issue.reading === null ? tr("阅读状态待确认", "Reading status needs confirmation") : tr(`共享阅读状态：${labels[issue.reading]}`, `Shared reading status: ${labels[issue.reading]}`));
			for (const source of issue.sources) append(card, "p", "cpo-library-meta", `${source.source} · ${source.reading === null ? JSON.stringify(source.raw) ?? "—" : labels[source.reading]}`);
			const actions = append(card, "div", "cpo-library-actions");
			action(actions, tr("查看详情", "View details"), () => options.onView(issue.paper));
			for (const reading of ["unread", "to-read", "read"] as const) action(actions, tr(`确认${labels[reading]}`, `Confirm ${labels[reading]}`), () => options.workflow.resolveReading(issue.paper, reading));
			for (const note of issue.notes) {
				append(card, "p", "cpo-library-meta", `${note.path} · ${JSON.stringify(note.raw) ?? "—"} · ${note.issue === "edited" ? tr("检测到新修改，已暂停", "New edit; sync paused") : note.issue === "invalid" ? tr("无效值，请在笔记中修正", "Invalid value; correct it in the note") : note.error ?? tr("同步失败", "Sync failed")} · ${tr(`已尝试 ${note.attempts} 次`, `${note.attempts} attempts`)}`);
				if (note.issue === "edited" && (note.raw === "unread" || note.raw === "to-read" || note.raw === "read")) {
					const reading = note.raw;
					action(actions, tr(`采用笔记值：${labels[reading]}`, `Use note value: ${labels[reading]}`), () => options.workflow.resolveReading(issue.paper, reading));
					if (issue.reading !== null) {
						const shared = issue.reading;
						action(actions, tr("采用共享阅读状态", "Use shared reading status"), () => options.workflow.resolveReading(issue.paper, shared));
					}
				}
			}
			if (issue.notes.some(note => note.issue === "failed")) action(actions, tr("重试同步", "Retry sync"), () => options.workflow.retryReading(issue.paper));
		}
		return;
	}
	const states = Object.values(project?.versionStates ?? project?.paperStates ?? {}).filter(state => options.tab === "staged" ? state.staged : state.excluded).sort((a, b) => b.updatedAt - a.updatedAt);
	if (!states.length) append(host, "p", "cpo-agg-empty", project ? tr("当前项目没有这类论文。", "No papers in this project list.") : tr("请先打开项目。", "Open a project first."));
	const list = append(host, "ol", "cpo-agg-list");
	for (const state of states) {
		const paper = state.paper;
		const item = append(list, "li", "cpo-agg-entry");
		const card = append(item, "div", "cpo-card cpo-library-card");
		append(card, "h3", "cpo-card-title", paper.title || paper.id);
		append(card, "p", "cpo-library-meta", [paper.year, paper.authors, state.source].filter(Boolean).join(" · "));
		if (state.staged && options.tab === "excluded") append(card, "span", "cpo-chip", tr("已收藏", "Saved"));
		const actions = append(card, "div", "cpo-library-actions");
		action(actions, tr("查看", "View"), () => options.onView(paper));
		if (!state.excluded) action(actions, tr("在图中定位", "Locate in graph"), () => options.onLocate(paper));
		if (options.tab === "excluded" && !paper.isSeed) action(actions, tr("恢复到图谱", "Restore to graph"), () => options.onExclude(paper, false), tr("已恢复到当前项目图谱", "Restored to this project's graph"));
		if (state.staged) action(actions, tr("取消收藏", "Remove from saved"), () => options.workflow.commitWorkflow(paper, project?.seedId ?? null, { staged: false }, options.projectId ?? undefined), tr("已取消收藏", "Removed from saved papers"));
	}
	if (options.onExtraHeader) {
		const footer = append(host, "div", "cpo-library-footer");
		options.onExtraHeader(footer, states.map(state => state.paper));
		if (!footer.childElementCount) footer.remove();
	}
}
