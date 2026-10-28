import { paperHasId, paperRecords, resolveWorkQuery } from "./work-identity";
import { isChinese, tr } from "./i18n";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, nodeMatchesFilter, nodeVisible, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, registerPopover, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { abstractCaption, choosePaperVersion, edgeSourcesText, ORIGIN_TEXT, paintAggregateCard, paintIdentityDecisionActions, paintJumpStrip, paintPaperDetail, paintPaperWorkflowState, paintRelationSection } from "./detail-cards";
import { paintPaperActions } from "./paper-actions";
import type { ReadingWorkflowDeps } from "./reading-workflow";
import { paintWorkflowLibrary } from "./workflow-library";
import { graphExportVersions, literatureFilename, literatureMarkdown, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import {
	EXPAND_CAP,
	graftNodes,
	applyWorkIdentityDecisions,
	refreshDerived,
} from "./graph-edit";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { mountGraphSurface, placeNodeMenu } from "./graph-surface";
import { mountWorkspaceFrame } from "./workspace-frame";
import { createGraphSession } from "./graph-session";
import {
	diagnoseCandidate,
	expandAround,
	loadNeighborhood,
	RetractedSeedError,
	restoreGraftedMembers,
	type LoadWarning,
	type SimilarityGraph,
} from "./neighborhood";
import { OpenAlexClient, toSearchHit, type GetJson } from "./openalex";
import { CrossrefClient, OpenCitationsClient, SemanticScholarClient, doisFromOpenCitation, fallbackAbstract } from "./citation-sources";
import {
	CitationEvidenceStore,
	edgeCitationPairs,
	edgeDetailStillCurrent,
	edgePairNeedingS2Context,
	mergeOpenCitation,
	mergeS2CitationsForPair,
} from "./citation-evidence";
import { buildNarrativeEvidence, type ResearchNarrative, type NarrativeEvidence } from "./narrative";
import { summarizeWithLlmPost } from "./llm";
import {
	DEFAULT_PATH_BUDGET,
	findBudgetedCitationPath,
	resolvePathEndpoint,
	type CitationPathResult,
} from "./doi-path";
import { classifyQuery, normalizeDoi, shortId } from "./paper";
import type { ConnectedPapersSettings } from "./settings";
import type { GraphEdge, PaperNode, SearchHit } from "./types";
import { citationCountText } from "./visual";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode, setDetailCover } from "./responsive";
import { displayStageSource } from "./staging";
import { commitSourceVersionRelations, matchingSeedProjects, acknowledgeIdentityStates, changeVersionExclusion, commitWorkIdentityDecision, composeProjectGraph, projectVersionGraph, projectVersionNode, projectVersionState, projectForSeed, projectWriteKey, reconcileProjectIdentity, resolveProjectPending, restoreGraphSnapshot, savedProjectForSeed, saveGraphSnapshot, updateProjectPaperState, type DeepDiveBatch, type ProjectPaperState, type ReadingStatus, type ResearchProject, type SavedView } from "./project-state";

export interface GraphAppHandle {
	destroy(): void;
	/** Command-palette DOI path search over already-fetched reference lists. */
	openDoiPathSearch(): void;
}

const projectRequests = new WeakMap<object, Map<string, number>>();
const projectDives = new WeakMap<object, Set<string>>();

export interface AppDeps extends Partial<ReadingWorkflowDeps> {
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<unknown>;
	openExternal: (url: string) => void;
	createNote?: (filename: string, markdown: string, folder?: string) => Promise<string | void>;
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; reading: ReadingStatus | null; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	syncLiteratureReading?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
	rememberLiteratureNote?: (paper: PaperNode, path: string, reading: ReadingStatus) => void;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	/** Persist settings (grafted members, staging, …). */
	persistSettings?: () => Promise<void> | void;
	loadSavedProject?: () => ResearchProject | null;
	saveProject?: (project: ResearchProject, projectKey?: string) => Promise<void> | void;
	initialDoi?: string;
	/** Seed to build immediately; wins over initialDoi when both are set. */
	initialTarget?: { kind: "doi" | "openalex"; value: string };
}

const STAGE_TEXT: Record<"resolving" | "fetching" | "scoring" | "searching", string> = {
	resolving: tr("正在解析种子论文…", "Resolving the seed paper…"),
	fetching: tr("正在读取参考文献、施引文献和相关作品…", "Loading references, citing papers, and related works…"),
	scoring: tr("正在计算参考文献重叠与共被引…", "Calculating shared references and co-citations…"),
	searching: tr("正在搜索 OpenAlex…", "Searching OpenAlex…"),
};

const WARNING_TEXT: Record<LoadWarning, string> = {
	references: tr("参考文献没有读到", "References could not be loaded"),
	citations: tr("施引文献没有读到", "Citing papers could not be loaded"),
	related: tr("相关作品没有读到", "Related works could not be loaded"),
	details: tr("部分参考文献列表没有读到，相似度只基于拿到的数据", "Some reference lists could not be loaded; similarity uses available data only"),
	crosscheck: tr("Semantic Scholar 交叉比对没有完成（额度或网络），图谱仍基于 OpenAlex", "Semantic Scholar cross-check did not finish (rate limit or network); the graph still uses OpenAlex"),
};

/** Pane UI shared by the Obsidian view and the browser preview. */
export function mountGraphApp(root: HTMLElement, deps: AppDeps): GraphAppHandle {
	root.classList.add("cpo-root", "cpo-surface");
	root.lang = isChinese() ? "zh-CN" : "en";
	root.replaceChildren();

	const bar = el(root, "header", "cpo-bar");
	const topLine = el(bar, "div", "cpo-topline");
	const brand = el(topLine, "div", "cpo-brand");
	el(brand, "span", "cpo-brand-mark", "R");
	el(brand, "strong", undefined, "Research Connected");
	const form = el(topLine, "form", "cpo-form");
	form.append(createChromeIcon("diagnose"));
	const input = el(form, "input", "cpo-input");
	input.type = "text";
	input.placeholder = tr("DOI、OpenAlex ID 或论文标题", "DOI, OpenAlex ID, or paper title");
	input.autocomplete = "off";
	input.spellcheck = false;
	input.setAttribute("aria-label", tr("种子论文", "Seed paper"));
	const submit = el(form, "button", "cpo-primary", tr("构建", "Build"));
	submit.type = "submit";
	const projectTools = el(bar, "div", "cpo-project-tools");
	const projectGroup = el(projectTools, "div", "cpo-project-group");
	const projectMenu = el(projectGroup, "details", "cpo-menu cpo-project-menu is-disabled");
	const projectSummary = el(projectMenu, "summary");
	projectSummary.setAttribute("aria-label", tr("研究项目", "Research project"));
	const projectName = el(projectSummary, "span", "cpo-menu-name", tr("研究项目", "Research project"));
	projectSummary.append(createChromeIcon("chevronDown"));
	const projectItems = el(projectMenu, "div", "cpo-menu-items");
	registerPopover(projectMenu);
	const saveProjectButton = el(projectGroup, "button", "cpo-ghost cpo-project-save");
	saveProjectButton.type = "button";
	saveProjectButton.disabled = true;
	const saveLabel = document.createTextNode(tr("保存项目", "Save project"));
	saveProjectButton.replaceChildren(createChromeIcon("save"), saveLabel);
	saveProjectButton.setAttribute("aria-label", tr("保存项目", "Save project"));
	saveProjectButton.setAttribute("aria-live", "polite");
	let activeProjectId: string | null = null;
	const versionDialogs = new AbortController();
	const requests = projectRequests.get(deps.getSettings()) ?? new Map<string, number>();
	projectRequests.set(deps.getSettings(), requests);
	const dives = projectDives.get(deps.getSettings()) ?? new Set<string>();
	projectDives.set(deps.getSettings(), dives);
	const currentProject = (seedId: string): ResearchProject | undefined => {
		const projects = deps.getSettings().researchProjects;
		return activeProjectId && projects[activeProjectId]?.seedId === seedId ? projects[activeProjectId] : projectForSeed(projects, seedId);
	};

	const status = createEl("p");
	status.className = "cpo-status";
	status.textContent = tr("从一篇种子论文开始。", "Start with a seed paper.");
	status.setAttribute("role", "status");
	const seedSummary = el(root, "div", "cpo-seed-summary cpo-canvas-seed");
	seedSummary.hidden = true;
	el(seedSummary, "span", "cpo-seed-mark", "");
	const seedTitle = el(seedSummary, "strong", "cpo-seed-title");
	const seedMeta = el(seedSummary, "span", "cpo-seed-meta");
	const results = el(bar, "div", "cpo-results");
	results.hidden = true;

	const banner = el(root, "div", "cpo-banner");
	banner.hidden = true;
	banner.setAttribute("role", "alert");

	const tools = el(projectGroup, "div", "cpo-workspace-tools");
	const actionsBar = el(tools, "div", "cpo-actions-bar");
	const body = el(root, "div", "cpo-body");
	const statusBar = el(root, "footer", "cpo-statusbar");
	statusBar.append(status);
	const iconNav = el(body, "nav", "cpo-icon-nav");
	iconNav.setAttribute("aria-label", tr("图谱导航", "Graph navigation"));
	const layoutHost = el(iconNav, "div", "cpo-rail-layouts");
	const surface = mountGraphSurface(body, {
		canvasLabel: tr("论文相似度图谱", "Paper similarity graph"),
		title: tr("从一篇种子论文开始", "Start with a seed paper"),
		hint: tr("输入 DOI、OpenAlex 链接或作品 ID，也可以按标题搜索后点选。圆点按参考文献重叠和共被引聚在一起，不是引用列表。", "Enter a DOI, OpenAlex URL, or work ID, or search by title and select a result. Nodes cluster by shared references and co-citations; this is not a citation list."),
	});
	const { stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, zoomIn, zoomOut, fit, reload, yearHost } = surface;
	stage.append(seedSummary);

	const sidebar = el(body, "aside", "cpo-evidence-sidebar");
	const sidebarToggle = el(sidebar, "button", "cpo-panel-toggle is-right");
	sidebarToggle.append(createChromeIcon("chevronRight"));
	sidebarToggle.type = "button";
	sidebarToggle.setAttribute("aria-label", tr("折叠右侧栏", "Collapse right sidebar"));
	sidebarToggle.setAttribute("aria-expanded", "true");
	const sidebarResize = el(body, "div", "cpo-sidebar-resizer");
	body.insertBefore(sidebarResize, sidebar);
	const evidenceHeader = el(sidebar, "header", "cpo-evidence-header");
	const evidenceHeading = el(evidenceHeader, "h2", undefined, tr("论文详情", "Paper details"));
	const returnToGraph = el(evidenceHeader, "button", "cpo-detail-return", tr("返回图谱", "Back to graph"));
	returnToGraph.type = "button";
	let detailReturn: { zoom: number; centerX: number; centerY: number; selectedId: string | null } | null = null;
	let coverDismissed = false;
	returnToGraph.addEventListener("click", () => {
		const saved = detailReturn;
		detailReturn = null;
		coverDismissed = true;
		root.classList.remove("is-detail-cover");
		if (saved) map.setViewState(saved);
	});
	const evidenceTools = el(evidenceHeader, "div", "cpo-evidence-tools");
	evidenceTools.setAttribute("role", "toolbar");
	evidenceTools.setAttribute("aria-label", tr("论文操作", "Paper actions"));
	const diagnoseButton = el(evidenceTools, "button", "cpo-diagnose", "");
	diagnoseButton.append(createChromeIcon("diagnose"), document.createTextNode(tr("诊断候选", "Inspect")));
	diagnoseButton.setAttribute("aria-label", tr("诊断候选", "Inspect candidate"));
	diagnoseButton.type = "button";
	diagnoseButton.disabled = true;
	const sheetHost = el(sidebar, "section");
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = el(sheet.body, "div", "cpo-detail");
	const listPanel = el(sheet.body, "div", "cpo-agg");
	listPanel.hidden = true;
	const sidebarTabs = el(sidebar, "div", "cpo-sidebar-tabs");
	const map = new SimilarityMap(canvas, tooltip, stage);
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, { onResize: () => map.resize() });
	let mapFilter: GraphFilter = emptyFilter();
	map.setKinds(mapFilter.kinds);
	const graphKey = mountGraphKey(stage, () => mapFilter, (next) => {
		mapFilter = next;
		map.setKinds(next.kinds);
		applyVersionFilter();
	});
	graphKey.paintColor("force2d");
	let graph: SimilarityGraph | null = null;
	function applyVersionFilter(): void {
		if (!graph) return;
		const seedId = graph.nodes.find(node => node.isSeed)?.id;
		const shown = projectVersionGraph(graph, seedId ? currentProject(seedId) : undefined, { ...mapFilter, scrubYear });
		map.adoptGraph(shown.nodes, shown.edges, shown.seedScore, undefined, false, shown.referenceLists);
		map.setContentFilter(mapFilter, shown.nodes);
		graphKey.setStats(shown.nodes, shown.edges, shown.referenceLists);
	}
	let lastProjectSnapshot: ResearchProject["snapshot"];
	let lastVersionStates: ResearchProject["versionStates"];
	let lastExclusionScopes: ResearchProject["exclusionScopes"];
	let deepDiveBatches: DeepDiveBatch[] = [];
	let expanding = false;
	let projectSaveTimer: number | null = null;
	let saveRevision = 0;
	let saveState: "idle" | "pending" | "saving" | "saved" | "error" = "idle";
	const paintSaveState = (state: typeof saveState): void => {
		saveState = state;
		const label = state === "idle" ? tr("保存项目", "Save project") : state === "pending" ? tr("待保存", "Pending save") : state === "saving" ? tr("保存中…", "Saving…") : state === "error" ? tr("重试保存", "Retry save") : tr("已保存", "Saved");
		saveLabel.data = label;
		saveProjectButton.setAttribute("aria-label", label);
		saveProjectButton.title = label;
		saveProjectButton.disabled = !graph || state === "idle" || state === "saving" || state === "saved";
	};
	let applyingNotice = false;
	const removedSeeds = new Set<string>();
	let persistProjectNow: (current: SimilarityGraph) => void = () => {};
	const scheduleProjectSave = (): void => {
		if (applyingNotice) return;
		saveRevision++;
		paintSaveState("pending");
		if (projectSaveTimer !== null) window.clearTimeout(projectSaveTimer);
		projectSaveTimer = window.setTimeout(() => {
			projectSaveTimer = null;
			if (graph) persistProjectNow(graph);
		}, 500);
	};
	const frame = mountWorkspaceFrame(root, body, {
		embed: false,
		sidebar,
		rightToggle: sidebarToggle,
		onLayout: () => {
			map.resize();
			window.setTimeout(() => map.resize(), 240);
		},
		onCommit: () => scheduleProjectSave(),
	});
	let tab: GraphTab = "graph";
	let narrative: ResearchNarrative | null = null;
	let narrativeInput: NarrativeEvidence | null = null;
	let narrativeMeta = "";
	let narrativeError = "";
	let scrubYear: number | null = null;
	const session = createGraphSession();
	const rememberSample = (nodes: readonly { year: number | null }[], cutoff?: number | null): void => {
		session.apply({
			type: "sample",
			years: nodes.map((node) => node.year),
			...(cutoff !== undefined ? { scrubYear: cutoff } : {}),
		});
		const next = session.state();
		scrubYear = next.scrubYear;
		if (next.histogram) chrome?.showSample(next.histogram, next.scrubYear);
	};
	let chrome: GraphChrome | null = null;
	let selectedPaper: PaperNode | null = null;
	let selectedEdge: GraphEdge | null = null;
	const s2EvidenceRequests = new Map<string, Promise<{ data: import("./citation-sources").SemanticCitation[]; partial: boolean }>>();
	/** 轨道按钮持有的布局；建图后回灌给画布，保持按钮与实际渲染一致。 */
	let layoutMode: LayoutMode = "force2d";
	let generation = 0;
	let hiddenIds = new Set<string>();
	let composing = false;
	let disposed = false;
	let narrativeBusy = false;
	let settingsRevision = 0;
	/** Abstract fallback: which source filled an abstract, or which DOI has no known abstract. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractFromCrossref = new Set<string>();
	const abstractMissing = new Set<string>();
	const llmReady = (): boolean => {
		const s = deps.getSettings();
		return Boolean(s.llmEnabled && s.llmEndpoint.trim() && s.llmModel.trim() && deps.postJson);
	};

	const showError = (message: string): void => {
		banner.hidden = false;
		banner.textContent = message;
	};
	const clearError = (): void => {
		banner.hidden = true;
		banner.textContent = "";
	};
	const hideResults = (): void => {
		results.hidden = true;
		results.replaceChildren();
	};
	const setBusy = (busy: boolean): void => {
		input.disabled = busy;
		submit.disabled = busy;
		reload.disabled = busy || !graph;
		submit.textContent = busy ? tr("正在构建…", "Building…") : tr("构建", "Build");
	};

	const shownNodes = (): PaperNode[] => {
		if (!graph) return [];
		const seedId = graph.nodes.find(node => node.isSeed)?.id;
		const project = seedId ? currentProject(seedId) : undefined;
		const filter = { ...mapFilter, scrubYear };
		return graph.nodes.flatMap(node => {
			const shown = projectVersionNode(node, project, filter);
			return shown && nodeMatchesFilter(shown, filter) ? [shown] : [];
		});
	};
	const workflowState = (paper: PaperNode, seedId: string): ProjectPaperState & { readingConflict?: boolean } => {
		const state = projectVersionState(currentProject(seedId), paper);
		const shared = deps.getReadingState?.(paper);
		return shared ? { ...state, reading: shared.reading ?? state.reading, readingConflict: !shared.confirmed } : state;
	};
	const commitWorkflow = async (paper: PaperNode, seedId: string, patch: { staged?: boolean; reading?: ReadingStatus }, source = "OpenAlex"): Promise<void> => {
		if (deps.commitWorkflow) {
			const selected = patch.staged !== undefined ? (await choosePaperVersion(paper, false, versionDialogs.signal)).paper : paper;
			await deps.commitWorkflow(selected, seedId, patch, activeProjectId ?? undefined);
			paintLists();
			if (selectedPaper?.id === paper.id) showDetail(paper);
			return;
		}
		throw new Error(tr(`当前环境无法保存阅读状态（${source}）`, `Reading workflow is unavailable (${source})`));
	};

	const tabTitles: Record<GraphTab, string> = {
		graph: tr("论文详情", "Paper details"),
		prior: tr("先验工作", "Prior works"),
		derivative: tr("衍生工作", "Derivative works"),
		research: tr("研究脉络", "Research narrative"),
		staged: tr("收藏列表", "Saved papers"),
		excluded: tr("已排除论文", "Excluded papers"),
		pending: tr("待处理（全库）", "Pending (library)"),
	};

	const paintLists = (): void => {
		evidenceHeading.textContent = tabTitles[tab] ?? tabTitles.graph;
		sheetHost.classList.toggle("cpo-sheet-analysis", tab === "research");
		detail.hidden = tab !== "graph";
		if (tab === "research") {
			paintResearch();
			return;
		}
		if (tab === "staged" || tab === "excluded" || tab === "pending") {
			paintLibrary();
			return;
		}
		if (!graph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(shownNodes().map((node) => node.id));
		const seed = graph.nodes.find((node) => node.isSeed);
		const rows = (tab === "prior" ? priorWorks(graph, visible) : derivativeWorks(graph, visible))
			.filter((row) => !seed || !projectVersionState(currentProject(seed.id), row.paper).excluded);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? tr("被本图引用", "Cited by this graph") : tr("引用本图", "Cites this graph");
		listPanel.hidden = false;
		listPanel.replaceChildren();
		const copy = createEl("p");
		copy.className = "cpo-agg-def";
		copy.textContent = definition;
		listPanel.append(copy);
		if (rows.length === 0) {
			const empty = createEl("p");
			empty.className = "cpo-agg-empty";
			empty.textContent = AGGREGATE_EMPTY_TEXT;
			listPanel.append(empty);
			return;
		}
		const list = createEl("ol");
		list.className = "cpo-agg-list";
		for (const row of rows) {
			paintAggregateCard(list, row, noun, (paper) => {
				showDetail(paper, true);
			}, (card, paper) => {
				if (!seed) return;
				const state = workflowState(paper, seed.id);
				paintPaperWorkflowState(card, paper, state, (reading) => commitWorkflow(paper, seed.id, { reading }), () => removePaper(paper));
				paintPaperActions(card, paper, seed.id, null, null, {
					getPaperState: (projectId) => workflowState(paper, projectId),
					setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
					persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
					commit: (patch, source) => commitWorkflow(paper, seed.id, patch, source),
					readingConflict: state.readingConflict,
					openExternal: deps.openExternal,
				});
			});
		}
		listPanel.append(list);
	};

	const paintLibrary = (): void => {
		if (!deps.getReadingState || !deps.commitWorkflow || !deps.getReadingIssues || !deps.resolveReading || !deps.retryReading) {
			listPanel.hidden = false;
			listPanel.replaceChildren();
			el(listPanel, "p", "cpo-side-tip", tr("当前环境尚未接通阅读工作流", "Reading workflow is unavailable in this environment"));
			return;
		}
		paintWorkflowLibrary(listPanel, {
			tab: tab === "excluded" || tab === "pending" ? tab : "staged",
			projectId: activeProjectId,
			onResolvePending: (key, id, choice) => resolveProjectPending(deps.getSettings(), key, id, choice, () => deps.persistSettings?.()),
			projects: deps.getSettings().researchProjects,
			workflow: { getReadingState: deps.getReadingState, commitWorkflow: deps.commitWorkflow, getReadingIssues: deps.getReadingIssues, resolveReading: deps.resolveReading, retryReading: deps.retryReading },
			onTab: (next) => { tab = next; chrome?.setTab(next); paintLists(); },
			onView: (paper) => showDetail(paper, true),
			onLocate: locatePaper,
			onExclude: (paper, excluded) => changeExclusion(paper, excluded),
			onRefresh: () => { paintLists(); if (selectedPaper) showDetail(selectedPaper); },
			onExtraHeader: (libraryHeader, papers) => {
				if (tab !== "staged" || !papers.length) return;
				const seedId = currentSeedId() ?? "";
				const items = papers.map(paper => ({ paper, seedId, source: workflowState(paper, seedId).source, reading: workflowState(paper, seedId).reading }));
				const actionMenu = el(libraryHeader, "details", "cpo-library-menu");
				const actionTrigger = el(actionMenu, "summary", "cpo-ghost cpo-library-menu-trigger");
				actionTrigger.setAttribute("aria-label", tr("清单操作", "List actions"));
				actionTrigger.append(createChromeIcon("export"), document.createTextNode(tr("清单操作", "List actions")), createChromeIcon("chevronDown"));
				registerPopover(actionMenu);
				const actionItems = el(actionMenu, "div", "cpo-library-menu-items");
				const copyTable = el(actionItems, "button", "cpo-library-menu-item", tr("复制表格", "Copy table"));
				copyTable.prepend(createChromeIcon("table"));
				copyTable.type = "button";
				copyTable.onclick = () => {
					const text = toMarkdownTable(orderedForExport(items.map((item) => item.paper)));
					void chrome?.copyText(text, tr("表格", "Table"));
				};
				const copyBib = el(actionItems, "button", "cpo-library-menu-item", tr("复制 BibTeX", "Copy BibTeX"));
				copyBib.prepend(createChromeIcon("copy"));
				copyBib.type = "button";
				copyBib.onclick = () => {
					const text = toBibTeX(orderedForExport(items.map((item) => item.paper)));
					void chrome?.copyText(text, "BibTeX");
				};
				if (deps.createNote) {
					const divider = el(actionItems, "span", "cpo-library-menu-divider");
					divider.setAttribute("role", "separator");
					const noteBtn = el(actionItems, "button", "cpo-library-menu-item", tr("写入清单笔记", "Write list to note"));
					noteBtn.prepend(createChromeIcon("note"));
					noteBtn.type = "button";
					noteBtn.onclick = () => {
						const lines = [tr("# 收藏文献清单", "# Saved papers"), ""];
						{
							lines.push(tr(`## 种子 ${seedId}`, `## Seed ${seedId}`), "");
							for (const item of items) {
								lines.push(tr(`- ${item.paper.title || item.paper.id}（${item.paper.year ?? tr("年份不详", "Year unknown")}）· ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`, `- ${item.paper.title || item.paper.id} (${item.paper.year ?? tr("年份不详", "Year unknown")}) · ${displayStageSource(item.source)} · ${item.reading === "read" ? tr("已读", "Read") : item.reading === "to-read" ? tr("待读", "To read") : tr("未读", "Unread")}`));
								if (item.paper.doiUrl) lines.push(`  - DOI: ${item.paper.doiUrl}`);
								lines.push(`  - ${item.paper.openAlexUrl}`);
							}
							lines.push("");
						}
						void deps.createNote!(tr("收藏文献清单.md", "Saved papers.md"), lines.join("\n")).then(() => {
							chrome?.setExportText(tr("已写入笔记：收藏文献清单.md", "Written to note: Saved papers.md"));
						}).catch((error) => {
							chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
						});
					};
				}
			},
		});
	};

	const paintResearch = (): void => {
		listPanel.replaceChildren();
		listPanel.hidden = !llmReady();
		if (!llmReady()) { narrative = null; return; }
		el(listPanel, "h3", "cpo-kicker", tr("研究脉络", "Research narrative"));
		const tip = el(listPanel, "p", "cpo-side-tip", narrativeError || (narrativeBusy ? tr("正在请求模型…", "Requesting the model…") : tr("手动生成：向已配置服务发送当前种子的论文元数据、引用关系和已获取的引用上下文。摘要由设置控制。结果覆盖整张采样图，不随年份滑块变化。", "Generate manually: send the current seed's paper metadata, citation links, and available citation context to the configured service. Abstracts are controlled in settings. The result covers the sampled graph and does not change with the year slider.")));
		const generate = el(listPanel, "button", "cpo-primary", narrative ? tr("重新生成", "Regenerate") : tr("生成研究脉络", "Generate research narrative"));
		generate.type = "button";
		generate.disabled = narrativeBusy || !graph;
		generate.addEventListener("click", () => void generateResearch(generate, tip));
		if (!narrative) return;
		const exportText = () => {
			if (!narrative || !llmReady()) return "";
			return [
				tr("# 研究脉络", "# Research narrative"), narrativeMeta,
				narrative.synthesis,
				...(["basedOn", "influenced", "importantWorks"] as const).flatMap(key => narrative![key].map(item => {
					const paper = [...(graph?.nodes ?? []), ...(graph?.catalog ?? [])].find(p => p.id === item.paperId);
					return tr(`- ${item.claim}\n  论文：${paper?.title ?? item.paperId} — https://openalex.org/${encodeURIComponent(item.paperId)}\n  证据：${item.evidence.join("；")}`, `- ${item.claim}\n  Paper: ${paper?.title ?? item.paperId} — https://openalex.org/${encodeURIComponent(item.paperId)}\n  Evidence: ${item.evidence.join("; ")}`);
				})), ...narrative.caveats.map(c => "- " + c),
			].join("\n\n");
		};
		addLink(listPanel, tr("复制总结", "Copy summary"), () => { const text = exportText(); if (text) void chrome?.copyText(text, tr("研究脉络总结", "Research narrative summary")); });
		if (deps.createNote) addLink(listPanel, tr("写入总结笔记", "Write summary to note"), () => {
			const text = exportText(), id = graph?.nodes.find(p => p.isSeed)?.id;
			if (text && id) void deps.createNote!(tr(`研究脉络-${id}.md`, `Research narrative-${id}.md`), text).then(() => { tip.textContent = tr("已写入总结笔记。", "Summary written to note."); }).catch(() => { tip.textContent = tr("笔记写入失败。", "Could not write the note."); });
		});
		const evidenceDetails = el(listPanel, "details");
		el(evidenceDetails, "summary", undefined, tr("查看使用的论文和证据", "View source papers and evidence"));
		el(evidenceDetails, "pre", "cpo-export-text", JSON.stringify(narrativeInput, null, 2));
		el(listPanel, "h4", "cpo-kicker", tr("总体总结", "Overview"));
		el(listPanel, "p", "cpo-abstract", narrative.synthesis);
		paintNarrativeSection(tr("基于的研究", "Prior research"), narrative.basedOn);
		paintNarrativeSection(tr("后续影响", "Later developments"), narrative.influenced);
		paintNarrativeSection(tr("重要工作", "Key works"), narrative.importantWorks);
		if (narrative.caveats.length) {
			el(listPanel, "h4", "cpo-kicker", tr("限制", "Limitations"));
			for (const caveat of narrative.caveats) el(listPanel, "p", "cpo-side-tip", caveat);
		}
	};

	const paintNarrativeSection = (title: string, items: ResearchNarrative["basedOn"]): void => {
		if (!items.length) return;
		el(listPanel, "h4", "cpo-kicker", title);
		for (const item of items) {
			const paper = graph?.nodes.find((node) => node.id === item.paperId) ?? graph?.catalog.find((node) => node.id === item.paperId);
			const button = el(listPanel, "button", "cpo-agg-item");
			button.type = "button";
			button.textContent = tr(`${paper?.year ?? "—"} · ${paper?.title ?? item.paperId} · 模型自评 ${item.confidence}`, `${paper?.year ?? "—"} · ${paper?.title ?? item.paperId} · Model confidence ${item.confidence}`);
			button.addEventListener("click", () => { if (paper) { activateGraphTab(); showDetail(paper, true); } });
			el(listPanel, "p", "cpo-side-tip", item.claim);
			if (item.evidence.length) el(listPanel, "p", "cpo-evidence", item.evidence.join("；"));
		}
	};

	const generateResearch = async (button: HTMLButtonElement, tip: HTMLElement): Promise<void> => {
		if (!llmReady() || narrativeBusy || !graph || !deps.postJson) {
			tip.textContent = tr("LLM 尚未配置，或当前运行环境不支持 POST 请求。", "The LLM is not configured, or POST requests are unavailable in this environment.");
			return;
		}
		const settings = deps.getSettings();
		const requestGraph = graph;
		const requestGeneration = generation;
		const revision = settingsRevision;
		narrativeBusy = true;
		narrativeError = "";
		button.disabled = true;
		tip.textContent = tr("正在整理引用证据并请求 LLM…", "Preparing citation evidence and requesting the LLM…");
		try {
			const evidence = buildNarrativeEvidence(graph, settings.llmSendAbstracts);
			const result = await summarizeWithLlmPost(deps.postJson, {
				enabled: settings.llmEnabled,
				endpoint: settings.llmEndpoint,
				apiKey: settings.llmApiKey,
				model: settings.llmModel,
			}, evidence);
			if (disposed || requestGraph !== graph || requestGeneration !== generation || revision !== settingsRevision || !llmReady()) return;
			narrative = { ...result, caveats: [...new Set([...evidence.caveats, ...result.caveats])] };
			narrativeInput = evidence;
			narrativeMeta = tr(`生成时间：${new Date().toISOString()}；模型：${settings.llmModel}；种子：${evidence.seed.title} (${evidence.seed.id})`, `Generated: ${new Date().toISOString()}; model: ${settings.llmModel}; seed: ${evidence.seed.title} (${evidence.seed.id})`);
			if (tab === "research") paintResearch();
		} catch (error) {
			if (disposed || requestGraph !== graph || requestGeneration !== generation || revision !== settingsRevision || !llmReady()) return;
			narrativeError = error instanceof Error ? error.message : tr("LLM 总结失败。", "LLM summary failed.");
			tip.textContent = narrativeError;
			button.disabled = false;
		} finally {
			narrativeBusy = false;
			if (!disposed && tab === "research" && llmReady()) paintResearch();
		}
	};

	chrome = mountGraphChrome(layoutHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: "force2d",
		noteButton: Boolean(deps.createNote),
		researchButton: llmReady(),
		libraryTab: true,
		actionsHost: actionsBar,
		tabsHost: sidebarTabs,
		tabPanel: sheetHost,
		layoutHost,
		scrubHost: yearHost,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(mode);
			map.setColorMode(defaultColorMode(mode));
			scheduleProjectSave();
			graphKey.paintColor(mode);
		},
		onScrub: (year) => {
			if (year === scrubYear) return;
			session.apply({ type: "scrub", year });
			scrubYear = session.state().scrubYear;
			mapFilter = { ...mapFilter, scrubYear };
			map.setScrubYear(scrubYear);
			applyVersionFilter();
			const histogram = session.state().histogram;
			if (histogram) chrome?.setHistogram(histogram, scrubYear);
			scheduleProjectSave();
			paintLists();
		},
		onTab: (next) => {
			tab = next;
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
			frame.revealRight();
		},
		onExport: (kind) => {
			void exportPane(kind);
		},
	});

	/** 切回「图谱」页签并同步按钮高亮，供各列表里的详情链接统一调用。 */
	const activateGraphTab = (): void => {
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
	};

	diagnoseButton.addEventListener("click", () => {
		if (!graph) return;
		frame.revealRight();
		const returnPaper = selectedPaper;
		const returnEdge = selectedEdge;
		activateGraphTab();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("候选诊断", "Candidate inspection"), tr("当前图谱的采样记录", "Sampling records for the current graph"));
		const back = el(detail, "button", "cpo-diagnose-back", tr("返回论文", "Back to paper"));
		back.prepend(createChromeIcon("back"));
		back.type = "button";
		back.disabled = !returnPaper;
		back.onclick = () => returnEdge ? showEdgeDetail(returnEdge, true) : showDetail(returnPaper, true);
		const form = el(detail, "form", "cpo-diagnose-form");
		const query = el(form, "input");
		query.type = "text";
		query.placeholder = tr("DOI 或 OpenAlex ID", "DOI or OpenAlex ID");
		query.setAttribute("aria-label", tr("要诊断的论文", "Paper to inspect"));
		const check = el(form, "button", "cpo-primary", tr("查询", "Search"));
		check.type = "submit";
		const result = el(detail, "div", "cpo-diagnose-result");
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (!graph) return;
			const finding = diagnoseCandidate(graph, query.value, hiddenIds, scrubYear);
			result.replaceChildren();
			el(result, "strong", undefined, finding.title);
			el(result, "p", "cpo-side-tip", finding.detail);
			const paper = finding.paperId && graph.nodes.find((item) => item.id === finding.paperId);
			if (paper) {
				const open = el(result, "button", "cpo-text-btn", tr("查看论文", "View paper"));
				open.type = "button";
				open.onclick = () => showDetail(paper, true);
			}
		});
		query.focus();
	});

	const exportPane = async (kind: ExportKind): Promise<void> => {
		if (!graph) {
			chrome?.setExportText(tr("请先构建图谱", "Build a graph first"));
			return;
		}
		if (kind === "note") {
			const selected = selectedPaper ?? graph.nodes.find((node) => node.isSeed);
			if (!selected) return;
			let paper: PaperNode;
			try { paper = (await choosePaperVersion(selected, false, versionDialogs.signal)).paper; }
			catch (error) { chrome?.setExportText(error instanceof Error ? error.message : String(error)); return; }
			if (deps.lookupLiteratureNote?.(paper)) { showDetail(paper, true); chrome?.setExportText(tr("已找到文献笔记，请从详情中选择打开", "Literature notes found. Open one from the paper details.")); return; }
			const settings = deps.getSettings();
			const seedId = graph.nodes.find((node) => node.isSeed)?.id ?? paper.id;
			const shared = deps.getReadingState?.(paper);
			if (shared && !shared.confirmed) {
				chrome?.setExportText(tr("请先确认阅读进度，再创建笔记", "Confirm reading progress before creating a note"));
				return;
			}
			const fields = {
				project: currentProject(seedId)?.name || seedId,
				relation: ORIGIN_TEXT[paper.origin],
				status: workflowState(paper, seedId).reading,
			};
			const filename = literatureFilename(paper, settings.literatureFilename, fields);
			const markdown = literatureMarkdown(paper, settings.literatureTemplate, fields);
			if (deps.createNote) {
				try {
					const path = await deps.createNote(filename, markdown, settings.literatureFolder);
					deps.rememberLiteratureNote?.(paper, typeof path === "string" ? path : filename, fields.status);
					chrome?.setExportText(tr(`已写入笔记：${filename}`, `Written to note: ${filename}`));
					showDetail(paper, true);
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				}
				return;
			}
			await chrome?.copyText(markdown, tr("笔记内容", "Note contents"));
			return;
		}
		const range = chrome?.exportOptions() ?? { mode: "one" as const, includeSeedException: false };
		const nodes = orderedForExport(graphExportVersions(graph.nodes, currentSeedId() ? currentProject(currentSeedId()!) : undefined, { ...mapFilter, scrubYear }, range.mode, range.includeSeedException));
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		await chrome?.copyText(text, kind === "bibtex" ? "BibTeX" : kind === "yaml" ? "YAML" : tr("表格", "Table"));
	};

	const abstractText = (paper: PaperNode): string => abstractCaption(paper, { s2: abstractFromS2, crossref: abstractFromCrossref, missing: abstractMissing });

	const getEvidence = (citingId: string, citedId: string) => graph?.citationEvidence?.get(citingId, citedId) ?? null;
	const edgeSources = (edge: GraphEdge): string => edgeSourcesText(edge, getEvidence);

	const showDetail = (paper: PaperNode | null, reveal = false): void => {
		if (reveal && paper) {
			void deps.readingOpened?.(paper).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : tr("阅读进度加载失败", "Could not load reading progress"); });
			tab = "graph";
			chrome?.setTab("graph");
			evidenceHeading.textContent = tabTitles.graph;
			listPanel.hidden = true;
			detail.hidden = false;
			coverDismissed = false;
		}
		session.apply({ type: "select-paper", id: paper?.id ?? null, source: reveal && paper ? "user" : "refresh" });
		if (session.state().revealRight) frame.revealRight();
		selectedPaper = paper;
		selectedEdge = null;
		detail.replaceChildren();
		if (!paper || !graph) {
			detailReturn = null;
			coverDismissed = false;
			setDetailCover(root, false);
			map.setSelected(null);
			sheet.setSummary(tr("点选节点查看论文", "Select a node to view its paper"), "");
			el(detail, "p", "cpo-side-tip", tr("点选节点查看题名、年份、作者和证据。", "Select a node to view its title, year, authors, and evidence."));
			return;
		}
		const seedIdForDisplay = graph.nodes.find(node => node.isSeed)?.id;
		paper = projectVersionNode(graph.nodes.find(node => node.id === paper?.id) ?? paper, seedIdForDisplay ? currentProject(seedIdForDisplay) : undefined, { ...mapFilter, scrubYear }) ?? paper;
		if (!coverDismissed && root.classList.contains("is-narrow") && !root.classList.contains("is-detail-cover") && !detail.hidden) detailReturn = map.getViewState();
		setDetailCover(root, !coverDismissed && !detail.hidden);
		map.setSelected(graph.nodes.some((node) => node.id === paper.id) ? paper.id : null);
		const year = paper.year === null ? tr("年份不详", "Year unknown") : String(paper.year);
		sheet.setSummary(paper.title, tr(`${year} · 被引 ${citationCountText(paper)}`, `${year} · cited ${citationCountText(paper)} times`), { lang: paper.language });
		const seedNode = graph.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seedNode?.id ?? paper.id;
		const project = currentProject(seedId);
		let state = workflowState(paper, seedId);
		const noted = deps.lookupLiteratureNote?.(paper) ?? null;
		if (!applyingNotice && !deps.getReadingState && noted?.reading && noted.reading !== state.reading) {
			state = { ...state, reading: updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: noted.reading }).reading };
			void (deps.persistSettings ? deps.persistSettings() : deps.stagePaper?.(paper, seedId, state.source));
		}
		let diveIndex = -1;
		for (let index = 0; index < deepDiveBatches.length; index += 1) if (deepDiveBatches[index]!.additions.some((item) => item.paperId === paper.id)) diveIndex = index;
		let diveNote: string | undefined;
		if (diveIndex >= 0) {
			const batch = deepDiveBatches[diveIndex]!;
			const parent = graph.nodes.find((node) => node.id === batch.parentId) ?? graph.catalog.find((node) => node.id === batch.parentId);
			const sources = [...new Set(batch.additions.filter((item) => item.paperId === paper.id).map((item) => ({ reference: tr("参考文献", "References"), citation: tr("施引文献", "Citing papers"), "shared-reference": tr("共享参考文献候选", "Shared-reference candidate"), legacy: tr("既有深挖记录", "Earlier deep-dive record") })[item.source]))].join("、");
			diveNote = tr(`第 ${diveIndex + 1} 轮深挖 · ${parent?.title ?? batch.parentId} · ${sources}`, `Deep dive ${diveIndex + 1} · ${parent?.title ?? batch.parentId} · ${sources}`);
		}
		paintPaperDetail(detail, graph, paper, {
			isClassic: !!map.classicEvidence(paper.id),
			abstractText,
			openExternal: deps.openExternal,
			separate: () => {
				if (!graph) return;
				void commitWorkIdentityDecision(deps.getSettings(), { ids: paperRecords(paper).map(record => record.id), kind: "separate", source: "manual", updatedAt: Date.now() }, () => deps.persistSettings?.()).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); });
			},
			conflict: project?.identityConflicts?.includes(paper.id) ?? false,
			acknowledge: () => {
				if (!project) return;
				acknowledgeIdentityStates(project, paper);
				void deps.persistSettings?.();
				showDetail(paper);
			},
			workflow: state,
			onReading: (reading) => commitWorkflow(paper, seedId, { reading }),
			onExclude: !paper.isSeed ? () => removePaper(paper) : undefined,
			onRestore: () => changeExclusion(paper, false),
			literature: noted && deps.openLiteratureNote ? { path: noted.path, alternatives: noted.alternatives, open: deps.openLiteratureNote } : undefined,
			lookupLiteratureNote: deps.lookupLiteratureNote,
			openLiteratureNote: deps.openLiteratureNote,
			signal: versionDialogs.signal,
			diveNote,
			actions: {
				getPaperState: (projectId) => workflowState(paper, projectId),
				setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
				persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seedNode!.id, source) : undefined,
				commit: (patch, source) => commitWorkflow(paper, seedId, patch, source),
				readingConflict: state.readingConflict,
				openExternal: deps.openExternal,
			},
			onJump: (target) => showDetail(target, true),
		});
		paintIdentityDecisionActions(detail, paper, [...graph.catalog, ...Object.values(deps.getSettings().researchProjects).flatMap(project => project.snapshot?.catalog ?? project.snapshot?.nodes ?? [])], async (ids, kind) => {
			if (!deps.persistSettings) throw new Error(tr("当前环境无法保存项目", "Project persistence is unavailable"));
			await commitWorkIdentityDecision(deps.getSettings(), { ids, kind, source: "manual", updatedAt: Date.now() }, deps.persistSettings);
		});
		if (!paper.abstract && !abstractMissing.has(paper.id) && !abstractRequested.has(paper.id)) {
			abstractRequested.add(paper.id);
			const token = generation;
			void fallbackAbstract(deps.getJson, paper, {
				semanticScholarApiKey: deps.getSettings().semanticScholarApiKey,
				contactEmail: deps.getSettings().contactEmail,
			}).then((result) => {
				if (disposed || token !== generation) return;
				if (result) {
					paper.abstract = result.text;
					if (result.source === "s2") abstractFromS2.add(paper.id);
					else abstractFromCrossref.add(paper.id);
				} else {
					abstractMissing.add(paper.id);
				}
				if (selectedPaper === paper && tab === "graph") showDetail(paper);
			});
		}
	};

	map.onSelect = (paper) => { showDetail(paper, paper !== null); scheduleProjectSave(); };
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !graph) {
			nodeMenu.hidden = true;
			return;
		}
		deleteItem.disabled = paper.isSeed;
		deleteItem.title = paper.isSeed ? tr("种子不能排除", "The seed paper cannot be excluded") : tr("从当前项目排除", "Exclude from this project");
		seedItem.disabled = paper.isSeed;
		seedItem.title = paper.isSeed ? tr("已是种子", "Already the seed") : tr("以这篇重建整图", "Rebuild graph with this paper as seed");
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		placeNodeMenu(stage, nodeMenu, x, y);
	};
	map.onDeleteRequest = () => {
		if (selectedPaper) void removePaper(selectedPaper).catch((error: unknown) => {
			status.textContent = error instanceof Error ? error.message : tr("排除失败，请重试", "Could not exclude. Try again.");
		});
	};
	const paintEdgeDetail = (edge: GraphEdge, a: PaperNode, b: PaperNode): void => {
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("引用证据", "Citation evidence"), "");
		paintRelationSection(detail, edge, a, b, { sources: edgeSources(edge), getEvidence });
		paintJumpStrip(detail, a, (target) => showDetail(target, true));
		paintJumpStrip(detail, b, (target) => showDetail(target, true));
	};
	const showEdgeDetail = (edge: GraphEdge, reveal = false): void => {
		session.apply({ type: "select-edge", id: `${edge.source}\0${edge.target}`, paperId: null, source: reveal ? "user" : "refresh" });
		if (session.state().revealRight) frame.revealRight();
		if (!graph) return;
		const a = graph.nodes.find(p => p.id === edge.source), b = graph.nodes.find(p => p.id === edge.target);
		if (!a || !b) return;
		paintEdgeDetail(edge, a, b);
		void loadSelectedEdgeEvidence(edge, a, b);
	};

	const loadSelectedEdgeEvidence = async (edge: GraphEdge, a: PaperNode, b: PaperNode, force = false): Promise<void> => {
		const current = graph;
		const settings = deps.getSettings();
		if (!current || !settings.s2Reconcile || !deps.postJson) return;
		const pair = edgePairNeedingS2Context(edge, getEvidence) ?? edgeCitationPairs(edge).find(pair => force || s2EvidenceRequests.has(normalizeDoi(current.nodes.find(node => node.id === pair.citingId)?.doiUrl) ?? ""));
		if (!pair) return;
		const citing = current.nodes.find((p) => p.id === pair.citingId);
		const cited = current.nodes.find((p) => p.id === pair.citedId);
		const citingDoi = normalizeDoi(citing?.doiUrl);
		const citedDoi = normalizeDoi(cited?.doiUrl);
		if (!citing || !cited || !citingDoi || !citedDoi) return;
		let request = s2EvidenceRequests.get(citingDoi);
		if (!request) {
			const client = new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
			request = client.referenceEvidence(citingDoi);
			s2EvidenceRequests.set(citingDoi, request);
		}
		let result;
		try {
			result = await request;
		} catch {
			if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) {
				el(detail, "p", "cpo-fact-note", tr("Semantic Scholar 引用语境暂时不可用。", "Semantic Scholar citation context is currently unavailable."));
				const retry = el(detail, "button", "cpo-text-btn", tr("重试语境", "Retry context"));
				retry.type = "button";
				retry.onclick = () => { s2EvidenceRequests.delete(citingDoi); showEdgeDetail(edge); };
			}
			return;
		}
		current.citationEvidence ??= new CitationEvidenceStore();
		const applied = mergeS2CitationsForPair(current.citationEvidence, citing.id, cited.id, citedDoi, result.data, normalizeDoi);
		if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) {
			if (applied) paintEdgeDetail(edge, a, b);
			el(detail, "p", "cpo-fact-note", result.partial ? tr("语境仅获取部分结果，可重试补全。", "Context results are partial; retry to complete.") : result.data.length ? tr("语境查询已完成。", "Context lookup complete.") : tr("语境查询已完成，未返回记录。", "Context lookup complete; no records returned."));
			if (result.partial) {
				const retry = el(detail, "button", "cpo-text-btn", tr("重新获取语境", "Reload context"));
				retry.type = "button";
				retry.onclick = () => { s2EvidenceRequests.delete(citingDoi); void loadSelectedEdgeEvidence(edge, a, b, true); };
			}
		}
	};
	map.onEdgeSelect = (edge) => {
		selectedEdge = edge;
		selectedPaper = null;
		showEdgeDetail(edge, true);
	};
	showDetail(null);

	const hideNodeMenu = (): void => {
		const restore = nodeMenu.contains(document.activeElement);
		nodeMenu.hidden = true;
		delete nodeMenu.dataset.paperId;
		if (restore) canvas.focus({ preventScroll: true });
	};

	const persistProject = async (current: SimilarityGraph, patch: Partial<ResearchProject> = {}): Promise<boolean> => {
		const seed = current.nodes.find((node) => node.isSeed);
		if (!seed || !deps.saveProject || applyingNotice || removedSeeds.has(seed.id)) return false;
		const revision = saveRevision;
		const projectId = activeProjectId;
		paintSaveState("saving");
		const prior = activeProjectId ? deps.getSettings().researchProjects[activeProjectId] : projectForSeed(deps.getSettings().researchProjects, seed.id);
		if (prior && prior.seedId !== seed.id && patch.seedId !== seed.id) { paintSaveState("pending"); return false; }
		const project: ResearchProject = {
			...prior,
			...patch,
			version: 1,
			seedId: seed.id,
			name: prior?.name || seed.title || seed.id,
			updatedAt: Date.now(),
			snapshot: saveGraphSnapshot(current),
			currentView: patch.currentView ?? { name: tr("当前视图", "Current view"), layout: layoutMode, scrubYear, ...map.getViewState(), updatedAt: Date.now(), filter: JSON.parse(JSON.stringify(mapFilter)) as GraphFilter, ...frame.collapsed() },
			views: prior?.views ?? [],
			deepDives: deepDiveBatches,
			paperStates: prior?.paperStates ?? {},
		};
		const previousSnapshot = lastProjectSnapshot;
		lastProjectSnapshot = project.snapshot;
		try { await deps.saveProject(project, activeProjectId ?? undefined); }
		catch (error) {
			lastProjectSnapshot = previousSnapshot;
			if (graph === current && activeProjectId === projectId) paintSaveState(revision === saveRevision ? "error" : "pending");
			status.textContent = error instanceof Error ? tr(`项目保存失败：${error.message}`, `Could not save project: ${error.message}`) : tr("项目保存失败", "Could not save the project");
			return false;
		}
		if (graph === current && activeProjectId === projectId) {
			refreshProjectSelect(activeProjectId ?? projectWriteKey(deps.getSettings().researchProjects, seed.id));
			paintSaveState(revision === saveRevision ? "saved" : "pending");
		}
		return true;
	};
	persistProjectNow = current => { void persistProject(current); };
	const saveCurrentViewOnGesture = (): void => scheduleProjectSave();
	canvas.addEventListener("pointerup", saveCurrentViewOnGesture);
	canvas.addEventListener("wheel", saveCurrentViewOnGesture, { passive: true });
	canvas.addEventListener("keyup", saveCurrentViewOnGesture);

	saveProjectButton.onclick = async () => {
		if (!graph || (saveState !== "pending" && saveState !== "error")) return;
		if (projectSaveTimer !== null) { window.clearTimeout(projectSaveTimer); projectSaveTimer = null; }
		const saved = await persistProject(graph);
		if (!saved) return;
		const name = activeProjectId ? deps.getSettings().researchProjects[activeProjectId]?.name : projectName.textContent;
		status.textContent = tr(`已保存研究项目「${name}」`, `Saved research project “${name}”`);
	};

	const refreshProjectSelect = (selectedId = activeProjectId ?? currentSeedId()): void => {
		const projects = Object.entries(deps.getSettings().researchProjects ?? {}).filter(([, project]) => project.snapshot).map(([key, project]) => ({ ...project, key })).sort((a, b) => b.updatedAt - a.updatedAt);
		if (projectItems.querySelector("input")) {
			const current = projects.find((project) => project.key === (selectedId ?? activeProjectId));
			if (current) projectName.textContent = current.name;
			return;
		}
		projectItems.replaceChildren();
		if (projects.length === 0) {
			activeProjectId = null;
			projectName.textContent = tr("研究项目", "Research project");
			projectMenu.classList.add("is-disabled");
			projectMenu.open = false;
			paintSaveState(graph ? saveState : "idle");
			return;
		}
		const openId = graph ? selectedId : null;
		const selected = openId && projects.some((project) => project.key === openId) ? openId : null;
		activeProjectId = selected;
		projectName.textContent = selected ? projects.find((project) => project.key === selected)!.name : tr("研究项目", "Research project");
		projectMenu.classList.remove("is-disabled");
		paintSaveState(saveState === "idle" ? "saved" : saveState);
		for (const project of projects) {
			const currentRow = project.key === selected;
			const row = el(projectItems, "div", currentRow ? "cpo-menu-row is-current" : "cpo-menu-row");
			const open = el(row, "button", "cpo-menu-switch", project.name);
			open.type = "button";
			open.addEventListener("click", () => { if (project.key !== activeProjectId) void switchProject(project.key); });
			const actions = el(row, "div", "cpo-menu-actions");
			const rename = el(actions, "button", "cpo-row-action cpo-project-rename");
			rename.type = "button";
			rename.append(createChromeIcon("edit"));
			rename.title = tr("重命名", "Rename");
			rename.setAttribute("aria-label", tr(`重命名「${project.name}」`, `Rename “${project.name}”`));
			rename.addEventListener("click", (event) => {
				event.stopPropagation();
				beginRename(row, project.key);
			});
			const remove = el(actions, "button", "cpo-row-action cpo-project-delete");
			remove.type = "button";
			remove.append(createChromeIcon("trash"));
			remove.title = tr("删除", "Delete");
			remove.setAttribute("aria-label", tr(`删除项目「${project.name}」`, `Delete project “${project.name}”`));
			remove.addEventListener("click", (event) => {
				event.stopPropagation();
				const open = row.querySelector(".cpo-project-confirm");
				for (const button of Array.from(projectItems.querySelectorAll(".cpo-project-confirm"))) button.remove();
				if (open) return;
				const confirm = el(actions, "button", "cpo-project-confirm", tr("确认", "Confirm"));
				confirm.type = "button";
				confirm.title = tr("确认删除", "Confirm delete");
				actions.insertBefore(confirm, remove);
				confirm.addEventListener("click", (click) => {
					click.stopPropagation();
					void deleteProject(project.key);
				});
			});
		}
	};

	function beginRename(row: HTMLElement, seedId: string): void {
		const project = deps.getSettings().researchProjects[seedId];
		const nameButton = row.querySelector(".cpo-menu-switch");
		if (!project || !nameButton) return;
		const input = createEl("input");
		input.className = "cpo-row-rename";
		input.value = project.name;
		input.setAttribute("aria-label", tr("项目名称", "Project name"));
		nameButton.replaceWith(input);
		input.focus();
		input.select();
		let done = false;
		const finish = async (commit: boolean): Promise<void> => {
			if (done) return;
			done = true;
			const previousName = project.name;
			const name = input.value.trim();
			input.remove();
			if (commit && name && name !== previousName) {
				project.name = name.slice(0, 120);
				project.updatedAt = Date.now();
				try {
					await deps.saveProject?.(project);
					status.textContent = tr(`项目已重命名为「${project.name}」`, `Project renamed to “${project.name}”`);
				} catch (error) {
					project.name = previousName;
					status.textContent = error instanceof Error ? error.message : tr("项目名称保存失败", "Could not save the project name");
				}
			}
			refreshProjectSelect(activeProjectId ?? seedId);
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); void finish(true); }
			if (event.key === "Escape") { event.stopPropagation(); void finish(false); }
		});
		input.addEventListener("blur", () => { void finish(true); });
	}

	async function deleteProject(seedId: string): Promise<void> {
		const settings = deps.getSettings();
		let key: string;
		try { key = seedId; if (!settings.researchProjects[key]) return; }
		catch (error) {
			status.textContent = error instanceof Error ? error.message : tr("项目删除失败", "Could not delete the project");
			return;
		}
		const project = settings.researchProjects[key];
		if (!project) return;
		removedSeeds.add(seedId);
		removedSeeds.add(key);
		generation += 1;
		if (projectSaveTimer !== null) { window.clearTimeout(projectSaveTimer); projectSaveTimer = null; }
		delete settings.researchProjects[key];
		try {
			await deps.persistSettings?.();
		} catch (error) {
			removedSeeds.delete(seedId);
			removedSeeds.delete(key);
			settings.researchProjects[key] = project;
			status.textContent = error instanceof Error ? error.message : tr("项目删除失败", "Could not delete the project");
			return;
		}
		const next = Object.values(settings.researchProjects).filter((item) => item.snapshot).sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (seedId === activeProjectId) {
			if (next) {
				await switchProject(Object.entries(settings.researchProjects).find(([, project]) => project === next)![0]);
				status.textContent = tr(`已删除研究项目「${project.name}」，已打开「${next.name}」`, `Deleted research project “${project.name}” and opened “${next.name}”`);
			} else clearOpenProject(project.name);
		} else {
			refreshProjectSelect(activeProjectId ?? undefined);
			status.textContent = tr(`已删除研究项目「${project.name}」`, `Deleted research project “${project.name}”`);
		}
	}

	function clearOpenProject(deletedName: string): void {
		graph = null;
		activeProjectId = null;
		deepDiveBatches = [];
		hiddenIds = new Set();
		map.setGraph([], [], new Map());
		seedSummary.hidden = true;
		empty.hidden = false;
		emptyTitle.hidden = false;
		messageText.textContent = tr("输入 DOI、OpenAlex 链接或作品 ID，也可以按标题搜索后点选。", "Enter a DOI, OpenAlex URL, or work ID, or search by title and choose a result.");
		diagnoseButton.disabled = true;
		chrome?.setExportsEnabled(false);
		hideNodeMenu();
		showDetail(null);
		graphKey.setStats([], []);
		chrome?.clearYears();
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
		projectMenu.open = false;
		refreshProjectSelect();
		status.textContent = tr(`已删除研究项目「${deletedName}」`, `Deleted research project “${deletedName}”`);
	}

	const flushProjectSave = async (): Promise<boolean> => {
		if (projectSaveTimer === null || !graph) return true;
		window.clearTimeout(projectSaveTimer);
		projectSaveTimer = null;
		return !deps.saveProject || await persistProject(graph);
	};
	async function switchProject(seedId: string): Promise<boolean> {
		const token = ++generation;
		if (!await flushProjectSave() || disposed || token !== generation) return false;
		const project = deps.getSettings().researchProjects[seedId];
		if (!project?.snapshot) return false;
		const saved = restoreGraphSnapshot(project.snapshot);
		if (!saved) return false;
		activeProjectId = seedId;
		input.value = project.seedId;
		deepDiveBatches = project.deepDives ?? [];
		applyGraph(saved, project.currentView, false, false);
		refreshProjectSelect(seedId);
		paintSaveState("saved");
		setBusy(false);
		return true;
	}

	const applyEdit = async (next: SimilarityGraph, note: string, nearId?: string, reflow = false, persist = true): Promise<void> => {
		if (persist && !await persistProject(next)) throw new Error(tr("项目保存失败，原图已保留", "Project save failed; the previous graph was retained"));
		graph = next;
		map.adoptGraph(next.nodes, next.edges, next.seedScore, nearId, reflow, next.referenceLists);
		graphKey.setStats(next.nodes, next.edges, next.referenceLists);
		graphKey.paintColor(layoutMode);
		rememberSample(next.nodes);
		paintLists();
		const selectedId = selectedPaper?.id;
		const keep = selectedId && next.nodes.some((node) => node.id === selectedId);
		if (!keep) {
			const seed = next.nodes.find((node) => node.isSeed) ?? null;
			selectedPaper = seed;
			selectedEdge = null;
			showDetail(seed);
		} else showDetail(next.nodes.find((node) => node.id === selectedId) ?? null);
		status.textContent = tr(`${note} · ${next.nodes.length} 篇 · ${next.edges.length} 条关系`, `${note} · ${next.nodes.length} papers · ${next.edges.length} links`);
	};
	const currentSeedId = (): string | null => graph?.nodes.find((node) => node.isSeed)?.id ?? null;

	let exclusionBusy = false;
	const changeExclusion = async (paper: PaperNode, excluded: boolean): Promise<void> => {
		const host = graph;
		const seedId = currentSeedId();
		if (!host || !seedId || paper.isSeed || exclusionBusy) return;
		const chosen = await choosePaperVersion(paper, excluded, versionDialogs.signal);
		const projects = deps.getSettings().researchProjects;
		const key = activeProjectId ?? projectWriteKey(projects, seedId);
		const original = projects[key];
		if (!original || graph !== host) throw new Error(tr("项目已变更，请重试", "Project changed; retry the action"));
		const stored = structuredClone(original);
		changeVersionExclusion(stored, chosen.paper, excluded, chosen.whole, paper);
		const base = !excluded && !host.nodes.some(node => paperHasId(node, chosen.paper.id)) ? graftNodes(host, [chosen.paper], host.referenceLists) : host;
		const updated = projectVersionGraph(base, stored);
		updated.excludedIds = Object.values(stored.versionStates ?? {}).filter(state => state.excluded).map(state => state.paper.id);
		const snapshot = saveGraphSnapshot(updated);
		if (projectSaveTimer !== null) { window.clearTimeout(projectSaveTimer); projectSaveTimer = null; }
		exclusionBusy = true;
		hideNodeMenu();
		try {
			stored.snapshot = snapshot;
			projects[key] = stored;
			if (deps.persistSettings) await deps.persistSettings();
			else if (deps.stagePaper) await deps.stagePaper(paper, seedId, "OpenAlex");
			else throw new Error(tr("当前环境不支持保存", "Saving is unavailable"));
			if (disposed || graph !== host || currentSeedId() !== seedId) return;
			await applyEdit(updated, excluded ? tr("已从当前项目排除", "Excluded from this project") : tr("已恢复到图谱", "Restored to graph"), undefined, false, false);
			hiddenIds = new Set(updated.excludedIds);
			showDetail(paper, true);
			if (!excluded && !nodeVisible(paper, { ...mapFilter, scrubYear })) {
				status.textContent = tr("已恢复，当前筛选下不可见", "Restored; hidden by the current filters");
				const locate = el(status, "button", "cpo-text-btn", tr("定位论文", "Locate paper"));
				locate.type = "button";
				locate.onclick = () => locatePaper(paper);
			}
		} catch (error) {
			if (projects[key] === stored) projects[key] = original;
			throw error;
		} finally { exclusionBusy = false; }
	};
	const locatePaper = (paper: PaperNode): void => {
		mapFilter = { ...mapFilter, yearFrom: null, yearTo: null, scrubYear: null, language: null, workType: null, concept: null };
		scrubYear = null;
		session.apply({ type: "scrub", year: null });
		map.setContentFilter(mapFilter, graph?.nodes ?? []);
		applyVersionFilter();
		map.setScrubYear(null);
		const histogram = session.state().histogram;
		if (histogram) chrome?.setHistogram(histogram, null);
		showDetail(paper, true);
		map.focusPaper(paper.id);
		scheduleProjectSave();
	};
	const removePaper = (paper: PaperNode): Promise<void> => changeExclusion(paper, true);

	const expandPaper = async (paper: PaperNode): Promise<void> => {
		if (!graph || expanding) return;
		hideNodeMenu();
		const settings = deps.getSettings();
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		if (!seedId) return;
		const slots = EXPAND_CAP;
		const projectKey = activeProjectId ?? seedId;
		if (dives.has(projectKey) || !session.beginDive(seedId)) {
			status.textContent = tr("这张图已有一轮深挖在进行，请稍后重试", "A deep dive is already running for this graph. Try again later.");
			return;
		}
		dives.add(projectKey);
		const request = (requests.get(projectKey) ?? 0) + 1;
		requests.set(projectKey, request);
		const token = generation;
		const host = graph;
		const previousBatches = deepDiveBatches;
		expanding = true;
		expandItem.disabled = true;
		status.textContent = tr(`正在从「${paper.title.slice(0, 24)}」扩展…`, `Expanding from “${paper.title.slice(0, 24)}”…`);
		try {
			const oa = new OpenAlexClient(deps.getJson, { apiKey: settings.apiKey, contactEmail: settings.contactEmail });
			const result = await expandAround(oa, host, paper, hiddenIds, settings, slots);
			const { papers, aliases, lists } = result;
			if (disposed || token !== generation || graph !== host || requests.get(projectKey) !== request) return;
			if (papers.length === 0) {
				const batch: DeepDiveBatch = { id: `${Date.now()}`, parentId: paper.id, createdAt: Date.now(), references: 0, citations: 0, additions: [], noMore: result.noMore, warnings: result.warnings };
				deepDiveBatches = [...deepDiveBatches, batch].slice(-100);
				if (aliases.length) await applyEdit(graftNodes(host, aliases, lists), tr(`已补充 ${aliases.length} 条同作品来源记录`, `Added ${aliases.length} source records for existing works`));
				else if (!await persistProject(host)) throw new Error(tr("深挖记录保存失败", "Could not save deep-dive records"));
				const reasons = [
					result.alreadyPresent ? tr(`${result.alreadyPresent} 篇已在图中`, `${result.alreadyPresent} already in the graph`) : "",
					result.alreadyExcluded ? tr(`${result.alreadyExcluded} 篇已排除`, `${result.alreadyExcluded} excluded`) : "",
					result.filtered ? tr(`${result.filtered} 篇不符合筛选条件`, `${result.filtered} do not meet the filters`) : "",
					result.overlaps ? tr(`${result.overlaps} 篇同时出现在参考与施引候选中`, `${result.overlaps} appear in both reference and citation candidates`) : "",
				].filter(Boolean);
				status.textContent = result.warnings.length ? result.warnings.join(tr("；", "; ")) : result.noMore ? tr("已读完当前可访问候选，没有更多文献", "All accessible candidates have been read; no more papers are available") : tr(`本轮没有新增文献${reasons.length ? `：${reasons.join("；")}` : "；候选页仍可继续读取"}`, `No papers added in this round${reasons.length ? `: ${reasons.join("; ")}` : "; more candidate pages can still be read"}`);
				return;
			}
			const directions = [tr(`参考 ${result.references}`, `References ${result.references}`), tr(`施引 ${result.citations}`, `Citing ${result.citations}`)];
			const batch: DeepDiveBatch = {
				id: `${Date.now()}`,
				parentId: paper.id,
				createdAt: Date.now(),
				references: result.references,
				citations: result.citations,
				additions: papers.map((item) => ({ paperId: item.id, source: item.origin === "reference" ? "reference" : item.origin === "citation" ? "citation" : "shared-reference" })),
				noMore: result.noMore,
				warnings: result.warnings,
			};
			deepDiveBatches = [...deepDiveBatches, batch].slice(-100);
			await applyEdit(refreshDerived(graftNodes(host, [...papers, ...aliases], lists)), tr(`已并入 ${papers.length} 篇（${directions.join(" · ")}）${result.noMore ? " · 已到候选末尾" : ""}${result.warnings.length ? ` · ${result.warnings.join("；")}` : ""}`, `Added ${papers.length} papers (${directions.join(" · ")})${result.noMore ? " · end of candidates" : ""}${result.warnings.length ? ` · ${result.warnings.join("; ")}` : ""}`), paper.id);
		} catch (error) {
			if (disposed || token !== generation || graph !== host) return;
			deepDiveBatches = previousBatches;
			status.textContent = error instanceof Error ? error.message : tr("深挖失败。", "Deep dive failed.");
		} finally {
			dives.delete(projectKey);
			session.endDive(seedId);
			expanding = false;
			expandItem.disabled = false;
		}
	};

	deleteItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) void removePaper(paper).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : tr("排除失败，请重试", "Could not exclude. Try again."); });
	});
	expandItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) void expandPaper(paper);
	});

	const applyGraph = (next: SimilarityGraph, restoreView?: SavedView, enrich = true, persist = true): void => {
		const wasApplying = applyingNotice;
		applyingNotice = true;
		try {
		next = applyWorkIdentityDecisions(next, deps.getSettings().workIdentityDecisions, deps.getSettings().sourceVersionRelations);
		const seedId = next.nodes.find((node) => node.isSeed)?.id;
		const savedProject = seedId ? currentProject(seedId) : undefined;
		lastProjectSnapshot = savedProject?.snapshot;
		lastVersionStates = savedProject?.versionStates;
		lastExclusionScopes = savedProject?.exclusionScopes;
		if (savedProject) reconcileProjectIdentity(savedProject, next);
		if (savedProject) next = composeProjectGraph(next, savedProject, deps.getSettings().maxNodes);
		next = projectVersionGraph(next, savedProject);
		const persistedExcluded = Object.entries(savedProject?.versionStates ?? savedProject?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
		hiddenIds = new Set([...(next.excludedIds ?? []), ...persistedExcluded]);
		graph = next;
		next.excludedIds = [...hiddenIds];
		diagnoseButton.disabled = false;
		chrome?.setExportsEnabled(true);
		hideNodeMenu();
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		empty.hidden = true;
		hideResults();
		const seed = next.nodes.find((node) => node.isSeed) ?? null;
		if (seed) {
			seedSummary.hidden = false;
			seedTitle.textContent = seed.title || seed.id;
			seedTitle.title = seedTitle.textContent;
			seedMeta.textContent = [seed.authors, seed.year ?? tr("年份不详", "Year unknown"), tr("种子论文", "Seed paper")].filter(Boolean).join(" · ");
			seedMeta.title = seedMeta.textContent;
		}
		showDetail(seed);
		map.setGraph(next.nodes, next.edges, next.seedScore, next.referenceLists);
		graphKey.setStats(next.nodes, next.edges, next.referenceLists);
		graphKey.paintColor(layoutMode);
		// setGraph 不再重置布局；把轨道按钮当前选中的布局回灌给画布。
		map.setLayout(layoutMode);
		map.setColorMode(defaultColorMode(layoutMode));
		rememberSample(next.nodes, restoreView?.scrubYear ?? null);
		if (restoreView) {
			layoutMode = restoreView.layout;
			chrome?.setLayout(layoutMode);
			scrubYear = restoreView.scrubYear;
			if (!chrome) map.setLayout(layoutMode);
			if (restoreView.filter) {
				mapFilter = { ...restoreView.filter, scrubYear };
				map.setKinds(mapFilter.kinds);
				graphKey.setKinds(mapFilter.kinds);
			}
			map.setScrubYear(scrubYear);
			const histogram = session.state().histogram;
			if (histogram) chrome?.setHistogram(histogram, scrubYear);
			map.setViewState({ ...restoreView, selectedId: restoreView.selectedId ? resolveWorkQuery(next.nodes, restoreView.selectedId) : null });
			frame.setCollapsed(restoreView.rightCollapsed);
			selectedPaper = next.nodes.find((node) => paperHasId(node, restoreView.selectedId ?? "")) ?? seed;
			if (selectedPaper) showDetail(selectedPaper);
		}
		if (root.classList.contains("is-detail-cover")) detailReturn = map.getViewState();
		applyVersionFilter();
		paintLists();
		const strategyNames = [
			next.strategies.references ? tr("参考文献", "References") : "",
			next.strategies.citations ? tr("施引", "Citing") : "",
			next.strategies.related ? tr("相关作品", "Related works") : "",
		].filter(Boolean);
		const warning = next.warnings.map((item) => WARNING_TEXT[item]).join(tr("；", "; "));
		const sampleNote = next.retrievalStats
			? ` · ${tr("采样 ", "sampled ")}${[
				samplingText(next.retrievalStats.references, tr("参考", "References")),
				samplingText(next.retrievalStats.citations, tr("施引", "Citing")),
				samplingText(next.retrievalStats.related, tr("相关", "Related")),
			].join(tr("/", " / "))}`
			: "";
		status.textContent = tr(`${next.nodes.length} 篇 · ${next.edges.length} 条关系 · ${strategyNames.join("、")}${
			next.skippedNonResearch ? ` · 滤除书评等非研究记录 ${next.skippedNonResearch} 条` : ""
		}${next.skippedRetracted ? ` · 排除已撤稿作品 ${next.skippedRetracted} 条` : ""}${next.pagingLimited ? " · 深度采样未翻页：没有 OpenAlex API 密钥，只取了第一页" : ""}${sampleNote}${warning ? ` · ${warning}` : ""}`, `${next.nodes.length} papers · ${next.edges.length} links · ${strategyNames.join(", ")}${
			next.skippedNonResearch ? ` · filtered ${next.skippedNonResearch} non-research records` : ""
		}${next.skippedRetracted ? ` · excluded ${next.skippedRetracted} retracted works` : ""}${next.pagingLimited ? " · deep sampling stayed on page 1 because no OpenAlex API key is set" : ""}${sampleNote}${warning ? ` · ${warning}` : ""}`);
		status.title = status.textContent;
		if (next.nodes.length > deps.getSettings().maxNodes) status.textContent += tr(` · 明确保留超出采样上限 ${next.nodes.length - deps.getSettings().maxNodes} 篇`, ` · ${next.nodes.length - deps.getSettings().maxNodes} explicitly retained beyond the sample cap`);
		} finally { applyingNotice = wasApplying; }
		if (persist) {
			const id = next.nodes.find((node) => node.isSeed)?.id;
			if (id) removedSeeds.delete(id);
			void persistProject(next);
		}
		refreshProjectSelect(activeProjectId ?? next.nodes.find(node => node.isSeed)?.id);
		if (enrich) void enrichOpenCitations(next);
	};

	const enrichOpenCitations = async (next: SimilarityGraph): Promise<void> => {
		const token = generation;
		const key = activeProjectId, request = key ? requests.get(key) : undefined;
		const current = (): boolean => !disposed && graph === next && token === generation && key === activeProjectId && (!key || requests.get(key) === request);
		const doiToId = new Map(next.nodes.flatMap((paper) => paperRecords(paper).flatMap((record) => { const doi = doiOf(record.doiUrl); return doi ? [[doi, record.id] as const] : []; })));
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		// Bounded sequential outgoing lookups; no unbounded high-citation responses.
		const papers = next.nodes.flatMap(paperRecords).filter(p => doiOf(p.doiUrl)).slice(0, 20);
		let completed = 0, failed = 0;
		for (const paper of papers) {
			if (!current()) return;
			try {
				const rows = await client.references(doiOf(paper.doiUrl)!);
				if (!current()) return;
				completed++;
				for (const row of rows) {
					const pids = doisFromOpenCitation(row);
					const a = pids.citing.map(d => doiToId.get(d)).find(Boolean);
					const b = pids.cited.map(d => doiToId.get(d)).find(Boolean);
					if (a && b) mergeOpenCitation(next, a, b);
				}
			} catch { failed++; }
		}
		if (!current()) return;
		map.updateGraphData(next.edges, next.referenceLists);
		graphKey.setStats(next.nodes, next.edges, next.referenceLists);
		if (selectedEdge) showEdgeDetail(selectedEdge);
		else showDetail(selectedPaper);
		paintLists();
		status.textContent += tr(` · OpenCitations 检查 ${completed}/${papers.length} 篇，失败 ${failed}；当前 ${next.edges.length} 条关系`, ` · OpenCitations checked ${completed}/${papers.length} papers; ${failed} failed; ${next.edges.length} links now`);
		if (!await persistProject(next)) return;
		if (!current() || !deps.persistSettings) return;
		try {
			const settings = deps.getSettings();
			const reports = await new CrossrefClient(deps.getJson, settings.contactEmail).versionRelations(next.catalog.flatMap(paperRecords), settings.sourceVersionRelations);
			if (current()) await commitSourceVersionRelations(settings, reports, deps.persistSettings, next.catalog);
		} catch (error) { if (current()) status.textContent = error instanceof Error ? error.message : tr("版本关系保存失败，请重新加载重试", "Version relation save failed. Reload to retry."); }
	};
	const client = (): OpenAlexClient => {
		const settings = deps.getSettings();
		return new OpenAlexClient(deps.getJson, {
			apiKey: settings.apiKey,
			contactEmail: settings.contactEmail,
		});
	};
	const reconcileSource = (): SemanticScholarClient | null => {
		if (!deps.postJson) return null;
		const settings = deps.getSettings();
		if (!settings.s2Reconcile) return null;
		return new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
	};

	const buildResolved = async (target: { kind: "doi" | "openalex"; value: string }, refresh = false, restoreView?: SavedView, allowRetractedSeed = false): Promise<void> => {
		if (!refresh) {
			const matches = matchingSeedProjects(deps.getSettings().researchProjects, target);
			if (matches.length > 1) {
				generation++;
				setBusy(false);
				status.textContent = tr(`这篇作品有 ${matches.length} 个独立研究项目，请从项目列表选择：${matches.map((project) => project.name).join("、")}`, `This work has ${matches.length} independent research projects. Choose from the project list: ${matches.map((project) => project.name).join(", ")}`);
				projectMenu.open = true;
				projectSummary.focus(); return;
			}
			const project = savedProjectForSeed(deps.getSettings().researchProjects, target);
			const snapshot = project && restoreGraphSnapshot(project.snapshot);
			if (snapshot) {
				const key = Object.entries(deps.getSettings().researchProjects).find(([, candidate]) => candidate === project)?.[0];
				if (!key) return;
				clearError();
				hideResults();
				if ((activeProjectId !== key || currentSeedId() !== project.seedId) && !await switchProject(key)) return;
				setBusy(false);
				status.textContent = tr(`已打开研究项目「${project.name}」；需要更新数据请使用重新加载`, `Opened research project “${project.name}”; use Reload to update data`);
				return;
			}
		}
		const previousInput = currentSeedId();
		const targetProject = refresh && activeProjectId ? deps.getSettings().researchProjects[activeProjectId] : undefined;
		const requestKey = targetProject ? activeProjectId! : `${target.kind}:${target.value}`;
		const request = (requests.get(requestKey) ?? 0) + 1;
		requests.set(requestKey, request);
		const token = ++generation;
		setBusy(true);
		clearError();
		hideResults();
		if (refresh && graph) {
			map.setGraph([], [], new Map());
			graphKey.setStats([], []);
			empty.hidden = false;
			emptyTitle.hidden = true;
			messageText.textContent = STAGE_TEXT.resolving;
		} else if (!graph) {
			empty.hidden = false;
			emptyTitle.hidden = true;
			messageText.textContent = STAGE_TEXT.resolving;
		}
		status.textContent = STAGE_TEXT.resolving;
		try {
			const settings = deps.getSettings();
			const oa = client();
			const next = await loadNeighborhood(
				oa,
				target,
				{ ...settings, researchProjects: {} },
				(stage) => {
					if (token !== generation) return;
					messageText.textContent = status.textContent = STAGE_TEXT[stage];
				},
				reconcileSource(),
				new CrossrefClient(deps.getJson, settings.contactEmail),
				{ savedSeed: targetProject?.snapshot?.nodes.find(node => node.isSeed), allowRetractedSeed },
			);
			if (disposed || token !== generation || requests.get(requestKey) !== request) return;
			const seed = next.nodes.find((node) => node.isSeed);
			const project = targetProject ? settings.researchProjects[activeProjectId ?? ""] : seed ? projectForSeed(settings.researchProjects, seed.id) : undefined;
			const projectKey = project ? Object.entries(settings.researchProjects).find(([, candidate]) => candidate === project)?.[0] : undefined;
			const excludedIds = Object.entries(project?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
			next.excludedIds = [...new Set([...(next.excludedIds ?? []), ...excludedIds])];
			const excluded = new Set(excludedIds);
			const origins = new Map((project?.deepDives ?? []).flatMap((batch) => batch.additions.map((item) => [item.paperId, item.source === "reference" || item.source === "citation" ? item.source : "related"] as const)));
			for (const paper of project?.manualPapers ?? []) origins.set(paper.id, "related");
			const extras = [...origins.keys()].filter((id) => !excluded.has(id) && (!(project?.retractedBatchIds?.length) || project?.manualPapers?.some(paper => paper.id === id) || project?.deepDives?.some(batch => !project.retractedBatchIds?.includes(batch.id) && batch.additions.some(item => item.paperId === id))));
			const restored = extras.length ? await restoreGraftedMembers(oa, next, extras, settings, excluded, origins) : { graph: next, failed: 0 };
			if (disposed || token !== generation || requests.get(requestKey) !== request) return;
			if (restored.failed) throw new Error(tr(`更新未完成：${restored.failed} 篇保留论文读取失败，原图未替换`, `Update incomplete: ${restored.failed} retained papers could not be loaded; previous graph retained`));
			if (!refresh && projectKey) { await switchProject(projectKey); return; }
			if (!refresh) {
				if (!seed || !deps.saveProject) throw new Error(tr("无法保存新项目", "Could not save the new project"));
				if (!await flushProjectSave() || disposed || token !== generation || requests.get(requestKey) !== request) return;
				const view: SavedView = { name: tr("当前视图", "Current view"), layout: "force2d", scrubYear: null, selectedId: null, zoom: 1, centerX: 0, centerY: 0, updatedAt: Date.now(), filter: emptyFilter(), leftCollapsed: false, rightCollapsed: false };
				const created: ResearchProject = { version: 1, seedId: seed.id, name: seed.title || seed.id, updatedAt: Date.now(), snapshot: saveGraphSnapshot(restored.graph), sampleIds: next.nodes.map(node => node.id), currentView: view, views: [] };
				await deps.saveProject(created);
				if (disposed || token !== generation || requests.get(requestKey) !== request) return;
				activeProjectId = projectWriteKey(deps.getSettings().researchProjects, seed.id);
				deepDiveBatches = [];
				applyGraph(restored.graph, view, false, false);
				input.value = seed.id;
				refreshProjectSelect(activeProjectId);
				paintSaveState("saved");
				window.dispatchEvent(new Event("research-connected-project"));
				if (graph) void enrichOpenCitations(graph);
				return;
			}
			if (!await persistProject(restored.graph, { sampleIds: next.nodes.map(node => node.id), seedId: seed?.id })) return;
			if (disposed || token !== generation || requests.get(requestKey) !== request) return;
			applyGraph(restored.graph, restoreView, false, false);
			window.dispatchEvent(new Event("research-connected-project"));
			if (graph) void enrichOpenCitations(graph);
		} catch (error) {
			if (token !== generation) return;
			if (error instanceof RetractedSeedError) {
				showError(error.message);
				const proceed = el(banner, "button", "cpo-text-btn", tr("保留撤稿起点并重建", "Keep retracted seed and rebuild"));
				proceed.type = "button";
				proceed.onclick = () => { void buildResolved(target, refresh, restoreView, true); };
			}
			const message = error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph.");
			if (!(error instanceof RetractedSeedError)) showError(message);
			if (graph) {
				if (!refresh && previousInput) input.value = previousInput;
				empty.hidden = true;
				map.setGraph(graph.nodes, graph.edges, graph.seedScore, graph.referenceLists);
				graphKey.setStats(graph.nodes, graph.edges, graph.referenceLists);
				status.textContent = message;
			} else {
				empty.hidden = false;
				messageText.textContent = message;
				status.textContent = tr("图谱还没有建起来。", "The graph has not been built yet.");
			}
		} finally {
			if (token === generation) setBusy(false);
		}
	};

	seedItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (!paper || paper.isSeed) return;
		hideNodeMenu();
		void buildResolved({ kind: "openalex", value: paper.id });
	});

	const showHits = (hits: SearchHit[]): void => {
		results.replaceChildren();
		if (hits.length === 0) {
			results.hidden = true;
			showError(tr("没有匹配的作品。换一个标题，或直接粘贴 DOI。", "No matching works. Try another title or paste a DOI."));
			return;
		}
		clearError();
		el(results, "p", "cpo-results-label", tr("选择种子论文", "Select a seed paper"));
		for (const hit of hits) {
			const button = el(results, "button", "cpo-hit");
			button.type = "button";
			el(button, "span", "cpo-hit-title", hit.title);
			const year = hit.year === null ? tr("年份不详", "Year unknown") : String(hit.year);
			el(button, "span", "cpo-hit-meta", tr(`${year} · ${hit.authors} · 被引 ${citationCountText(hit)}`, `${year} · ${hit.authors} · cited ${citationCountText(hit)} times`));
			button.addEventListener("click", () => {
				input.value = hit.title;
				void buildResolved({ kind: "openalex", value: hit.id });
			});
		}
		results.hidden = false;
	};

	const submitQuery = async (): Promise<void> => {
		const parsed = classifyQuery(input.value);
		if (!parsed) {
			showError(tr("请输入 DOI、OpenAlex ID，或至少两个字的标题。", "Enter a DOI, OpenAlex ID, or a title of at least two characters."));
			return;
		}
		if (parsed.kind === "search") {
			const token = ++generation;
			setBusy(true);
			clearError();
			status.textContent = STAGE_TEXT.searching;
			try {
				const raw = await client().searchWorks(parsed.value);
				if (token !== generation) return;
				const hits: SearchHit[] = [];
				for (const work of raw) {
					const hit = toSearchHit(work);
					if (hit) hits.push(hit);
				}
				showHits(hits);
				status.textContent = hits.length ? tr(`找到 ${hits.length} 篇，点选种子论文。`, `Found ${hits.length} papers. Select a seed.`) : tr("没有匹配的作品。", "No matching works.");
			} catch (error) {
				if (token !== generation) return;
				showError(error instanceof Error ? error.message : tr("搜索失败。", "Search failed."));
			} finally {
				if (token === generation) setBusy(false);
			}
			return;
		}
		await buildResolved(parsed);
	};

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (composing) return;
		void submitQuery();
	});
	input.addEventListener("compositionstart", () => {
		composing = true;
	});
	input.addEventListener("compositionend", () => {
		composing = false;
	});
	zoomIn.addEventListener("click", () => map.zoomBy(1.2));
	zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
	fit.addEventListener("click", () => map.fit(true));
	reload.addEventListener("click", () => {
		const seedId = currentSeedId();
		if (!seedId || reload.disabled) return;
		input.value = seedId;
		void buildResolved({ kind: "openalex", value: seedId }, true);
	});

	const onKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			if (!nodeMenu.hidden) { hideNodeMenu(); return; }
			showDetail(null);
		}
	};
	root.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		if (event.target instanceof Element && event.target.closest(".cpo-row-rename, .cpo-paper-save-menu")) return;
		if (!nodeMenu.hidden) {
			hideNodeMenu();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		const openMenu = root.querySelector("details[open]");
		if (openMenu) {
			openMenu.removeAttribute("open");
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (frame.dismissTemporary()) {
			event.preventDefault();
			event.stopPropagation();
		}
	}, true);
	root.addEventListener("keydown", onKey);
	const onPointerDown = (event: PointerEvent): void => {
		if (!nodeMenu.hidden && !nodeMenu.contains(event.target as Node)) hideNodeMenu();
	};
	window.addEventListener("pointerdown", onPointerDown);
	const onSettings = (): void => {
		if (applyingNotice) return;
		applyingNotice = true;
		try {
		settingsRevision++;
		chrome?.setResearchVisible(llmReady());
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		if (!llmReady() && tab === "research") {
			tab = "graph";
			chrome?.setTab("graph");
			listPanel.replaceChildren();
			listPanel.hidden = true;
		}
		paintLists();
		} finally { applyingNotice = false; }
	};
	window.addEventListener("research-connected-settings", onSettings);
	const onProject = (): void => {
		if (applyingNotice || !graph || exclusionBusy) return;
		applyingNotice = true;
		try {
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		const project = activeProjectId ? deps.getSettings().researchProjects[activeProjectId] : seedId ? currentProject(seedId) : undefined;
		if (project?.snapshot && (project.snapshot !== lastProjectSnapshot || project.versionStates !== lastVersionStates || project.exclusionScopes !== lastExclusionScopes)) {
			lastProjectSnapshot = project.snapshot;
			lastVersionStates = project.versionStates;
			lastExclusionScopes = project.exclusionScopes;
			deepDiveBatches = project.deepDives ?? [];
			const saved = restoreGraphSnapshot(project.snapshot);
			if (saved) {
				const view = map.getViewState();
				graph = projectVersionGraph(composeProjectGraph(saved, project, deps.getSettings().maxNodes), project);
				const sharedSeed = saved.nodes.find(node => node.isSeed);
				if (sharedSeed) {
					input.value = sharedSeed.id; seedTitle.textContent = sharedSeed.title; seedTitle.title = sharedSeed.title;
					seedMeta.textContent = [sharedSeed.authors, sharedSeed.year ?? tr("年份不详", "Year unknown"), tr("种子论文", "Seed paper")].filter(Boolean).join(" · ");
					seedMeta.title = seedMeta.textContent;
				}
				hiddenIds = new Set(saved.excludedIds ?? []);
				map.adoptGraph(graph.nodes, graph.edges, graph.seedScore, undefined, false, graph.referenceLists);
				map.setViewState(view);
				applyVersionFilter();
				graphKey.setStats(graph.nodes, graph.edges, graph.referenceLists);
				paintLists();
				if (selectedEdge) showEdgeDetail(selectedEdge);
				else if (selectedPaper) showDetail(saved.nodes.find(node => node.id === selectedPaper?.id) ?? selectedPaper);
				return;
			}
		}
		paintLists();
		if (selectedPaper) showDetail(selectedPaper);
		} finally { applyingNotice = false; }
	};
	window.addEventListener("research-connected-project", onProject);
	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);

	const observer = observeResponsiveMode(root, () => {
		frame.apply();
		map.resize();
		if (!coverDismissed && Boolean(selectedPaper) && !detail.hidden && root.classList.contains("is-narrow")) frame.revealRight();
		if (setDetailCover(root, !coverDismissed && Boolean(selectedPaper) && !detail.hidden)) detailReturn = map.getViewState();
		else if (!root.classList.contains("is-detail-cover")) detailReturn = null;
	});
	observer.observe(stage);
	window.requestAnimationFrame(() => map.resize());

	const initial = deps.initialTarget ?? (deps.initialDoi ? { kind: "doi" as const, value: deps.initialDoi } : null);
	const saved = initial ? null : deps.loadSavedProject?.() ?? null;
	const restored = saved ? restoreGraphSnapshot(saved.snapshot) : null;
	if (restored) {
		activeProjectId = Object.entries(deps.getSettings().researchProjects).find(([, project]) => project === saved)?.[0] ?? null;
		deepDiveBatches = saved?.deepDives ?? [];
		applyGraph(restored, saved?.currentView, false, false);
		setBusy(false);
		status.textContent = tr(`已恢复本地研究项目「${saved?.name ?? tr("未命名", "Untitled")}」 · ${restored.nodes.length} 篇 · 可随时更新数据`, `Restored local research project “${saved?.name ?? tr("未命名", "Untitled")}” · ${restored.nodes.length} papers · refresh data anytime`);
	} else if (initial) {
		input.value = initial.value;
		refreshProjectSelect();
		void buildResolved(initial);
	} else {
		refreshProjectSelect();
	}

	let pathResult: CitationPathResult | null = null;
	let pathIndex = 0;

	const paperById = (id: string): PaperNode | undefined =>
		graph?.nodes.find((paper) => paper.id === id) ?? graph?.catalog.find((paper) => paper.id === id);

	const paintDoiPath = (): void => {
		if (!pathResult) return;
		selectedPaper = null;
		selectedEdge = null;
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		const path = pathResult.paths[pathIndex];
		sheet.setSummary(tr("DOI 引用路径", "DOI citation path"), path ? tr(`${path.length - 1} 步 · 预算内`, `${path.length - 1} steps · within budget`) : tr("未找到", "Not found"));
		el(detail, "p", "cpo-fact-note", tr("预算内在已抓取引用列表上搜索的结果，不是全局最短路径。", "This result searches fetched reference lists within the request budget; it is not a global shortest path."));
		el(
			detail,
			"p",
			"cpo-meta",
			tr(`方向：${pathResult.direction === "citing-to-cited" ? "施引 → 被引" : "被引 → 施引"} · 检查 ${pathResult.checked}/${pathResult.budget} 个节点${pathResult.exhausted ? " · 预算提前耗尽" : ""}`, `Direction: ${pathResult.direction === "citing-to-cited" ? "citing → cited" : "cited → citing"} · checked ${pathResult.checked}/${pathResult.budget} nodes${pathResult.exhausted ? " · budget exhausted early" : ""}`),
		);
		if (!path) {
			el(detail, "p", "cpo-agg-empty", tr("当前采样范围内没有连通路径。可加深采样后再试。", "No path was found in the current sample. Try a deeper sample."));
			return;
		}
		if (pathResult.paths.length > 1) {
			const nav = el(detail, "div", "cpo-tool-row");
			const label = el(nav, "span", "cpo-meta", tr(`同长路径 ${pathIndex + 1}/${pathResult.paths.length}`, `Equal-length path ${pathIndex + 1}/${pathResult.paths.length}`));
			const prev = el(nav, "button", "cpo-text-btn", tr("上一条", "Previous"));
			prev.type = "button";
			prev.disabled = pathIndex <= 0;
			prev.onclick = () => { pathIndex -= 1; paintDoiPath(); };
			const next = el(nav, "button", "cpo-text-btn", tr("下一条", "Next"));
			next.type = "button";
			next.disabled = pathIndex >= pathResult.paths.length - 1;
			next.onclick = () => { pathIndex += 1; paintDoiPath(); };
			void label;
		}
		const list = el(detail, "ol", "cpo-agg-list");
		for (let i = 0; i < path.length; i++) {
			const id = path[i]!;
			const paper = paperById(id);
			const row = el(list, "li", "cpo-agg-item");
			el(row, "strong", undefined, paper?.title || id);
			const doi = normalizeDoi(paper?.doiUrl) ?? tr("无 DOI", "No DOI");
			el(row, "p", "cpo-meta", `${id} · ${doi}${i < path.length - 1 ? " →" : ""}`);
			if (paper && graph?.nodes.some((node) => node.id === paper.id)) {
				const open = el(row, "button", "cpo-text-btn", tr("查看", "View"));
				open.type = "button";
				open.onclick = () => { activateGraphTab(); showDetail(paper, true); };
			}
		}
	};

	const openDoiPathSearch = (): void => {
		if (!graph) {
			showError(tr("请先构建图谱。DOI 路径只在已抓取的引用列表上搜索。", "Build a graph first. DOI path search uses fetched reference lists only."));
			return;
		}
		activateGraphTab();
		frame.revealRight();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("DOI 引用路径", "DOI citation path"), "");
		const form = el(detail, "form", "cpo-path-search");
		const label = el(form, "label", "cpo-meta", tr("起点与终点（DOI 或 OpenAlex ID，用空格或 → 分隔）", "Start and end (DOI or OpenAlex ID, separated by a space or →)"));
		const endpoints = el(label, "input");
		endpoints.type = "text";
		endpoints.required = true;
		endpoints.placeholder = "10.1/a → 10.2/b";
		const submitPath = el(form, "button", "cpo-text-btn", tr("查找路径", "Find path"));
		submitPath.type = "submit";
		endpoints.focus();
		form.onsubmit = (event) => {
			event.preventDefault();
			if (!graph) return;
			const raw = endpoints.value;
			const parts = raw.split(/\s*(?:→|->|\s)\s*/).map((part) => part.trim()).filter(Boolean);
			if (parts.length < 2) {
				showError(tr("请提供两个端点，例如：10.1/a → 10.2/b", "Provide two endpoints, for example: 10.1/a → 10.2/b"));
				return;
			}
			const pool = [...graph.nodes, ...graph.catalog];
			const start = resolvePathEndpoint(parts[0]!, pool, normalizeDoi, shortId);
			const end = resolvePathEndpoint(parts[1]!, pool, normalizeDoi, shortId);
			if (!start || !end) {
				showError(tr("端点必须是当前图谱已抓取的论文（DOI 或 OpenAlex ID）。", "Both endpoints must be papers fetched for the current graph (DOI or OpenAlex ID)."));
				return;
			}
			clearError();
			pathResult = findBudgetedCitationPath(graph.referenceLists, start, end, DEFAULT_PATH_BUDGET);
			pathIndex = 0;
			status.textContent = pathResult.paths.length
				? tr(`预算内找到 ${pathResult.paths.length} 条路径（检查 ${pathResult.checked}/${pathResult.budget}）`, `Found ${pathResult.paths.length} paths within budget (${pathResult.checked}/${pathResult.budget} checked)`)
				: tr(`预算内未找到路径（检查 ${pathResult.checked}/${pathResult.budget}${pathResult.exhausted ? "，提前耗尽" : ""}）`, `No path found within budget (${pathResult.checked}/${pathResult.budget} checked${pathResult.exhausted ? "; exhausted early" : ""})`);
			paintDoiPath();
		};
	};

	return {
		openDoiPathSearch,
		destroy: () => {
			disposed = true;
			versionDialogs.abort();
			session.destroy();
			generation += 1;
			if (projectSaveTimer !== null) window.clearTimeout(projectSaveTimer);
			canvas.removeEventListener("pointerup", saveCurrentViewOnGesture);
			canvas.removeEventListener("wheel", saveCurrentViewOnGesture);
			canvas.removeEventListener("keyup", saveCurrentViewOnGesture);
			chrome?.destroy();
			sheet.destroy();
			stopSidebarResize();
			observer.disconnect();
			root.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("research-connected-settings", onSettings);
			window.removeEventListener("research-connected-project", onProject);
			window.removeEventListener("research-connected-theme", onTheme);
			map.destroy();
			root.replaceChildren();
			root.classList.remove("cpo-root", "cpo-surface", "is-narrow");
		},
	};
}

function samplingText(stats: { accepted: number; requests: number; pages: number; filtered: number; duplicates: number; partial: boolean }, label: string): string {
	return tr(`${label}${stats.accepted}/${stats.pages}页·${stats.requests}次${stats.filtered ? `·滤${stats.filtered}` : ""}${stats.duplicates ? `·重${stats.duplicates}` : ""}${stats.partial ? "·未满" : ""}`, `${label}: ${stats.accepted} accepted · ${stats.pages} ${stats.pages === 1 ? "page" : "pages"} · ${stats.requests} ${stats.requests === 1 ? "request" : "requests"}${stats.filtered ? ` · ${stats.filtered} filtered` : ""}${stats.duplicates ? ` · ${stats.duplicates} duplicates` : ""}${stats.partial ? " · below target" : ""}`);
}

function addLink(parent: HTMLElement, label: string, onClick: () => void): void {
	const button = el(parent, "button", "cpo-link", label);
	button.type = "button";
	button.addEventListener("click", onClick);
}

function doiOf(value: string | null | undefined): string | null {
	if (!value) return null;
	const raw = value.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:/i, "").trim().toLowerCase();
	return raw || null;
}

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = createEl(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
