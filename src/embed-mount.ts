import { paperRecords, WORK_IDENTITY_VERSION } from "./work-identity";
import { isChinese, tr } from "./i18n";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks, type RankedWork } from "./aggregates";
import { CrossrefClient, SemanticScholarClient, OpenCitationsClient, doisFromOpenCitation, doiFromPaper, fallbackAbstract, type AbstractLookupResult, type PostJson } from "./citation-sources";
import { mergeOpenCitation } from "./citation-evidence";
import { abstractCaption, choosePaperVersion, ORIGIN_TEXT, paintAggregateCard, paintIdentityDecisionActions, paintPaperDetail, paintPaperWorkflowState } from "./detail-cards";
import { EMBED_HEIGHT_LIMIT, EMBED_WIDTH_LIMIT, embedViewStateKey, parseEmbed, type EmbedSpec } from "./embed-syntax";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, nodeVisible, visibleNodes, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { graphExportVersions, literatureFilename, literatureMarkdown, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { appendStatusDetail, mountGraphSurface, paintGraphStatus, placeNodeMenu } from "./graph-surface";
import { mountWorkspaceFrame } from "./workspace-frame";
import { createGraphSession } from "./graph-session";
import { applyWorkIdentityDecisions, graftNodes } from "./graph-edit";
import { diagnoseCandidate, enhancementText, expandSecondLayer, graphStatusSummary, loadNeighborhood, RetractedSeedError, samplingText, WARNING_TEXT, type LoadStage, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { paintPaperActions } from "./paper-actions";
import type { ConnectedPapersSettings } from "./settings-model";
import { commitSourceVersionRelations, acknowledgeIdentityStates, changeVersionExclusion, commitWorkIdentityDecision, projectVersionGraph, projectVersionState, reconcileProjectIdentity, resolveProjectPending, restoreGraphSnapshot, saveGraphSnapshot, updateProjectPaperState, type ReadingStatus } from "./project-state";
import type { ReadingWorkflowDeps } from "./reading-workflow";
import { paintWorkflowLibrary } from "./workflow-library";
import type { GraphEdge, PaperNode } from "./types";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode, setDetailCover } from "./responsive";

export interface EmbedDeps extends Partial<ReadingWorkflowDeps> {
	source: string;
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: PostJson;
	openExternal: (url: string) => void;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	persistAssociation?: (projectKey: string | null) => Promise<void>;
	createNote?: (filename: string, markdown: string, folder?: string) => Promise<string | void>;
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; reading: ReadingStatus | null; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	syncLiteratureReading?: (paper: PaperNode, reading: ReadingStatus) => Promise<void>;
	rememberLiteratureNote?: (paper: PaperNode, path: string, reading: ReadingStatus) => void;
	/** Open the full graph pane on this seed, when the host supports it. */
	openGraph?: (target: { kind: "doi" | "openalex"; value: string }) => void;
}

const STAGE_TEXT: Record<LoadStage, string> = {
	resolving: tr("正在解析种子文献…", "Resolving the seed paper…"),
	fetching: tr("正在读取参考文献、施引文献和相关作品…", "Loading references, citing papers, and related works…"),
	scoring: tr("正在计算相似度…", "Calculating similarity…"),
};

const cache = new Map<string, SimilarityGraph>();

/** Filter and layout remembered per block key across remounts. */
interface EmbedViewState {
	filter: GraphFilter;
	layout: LayoutMode;
}
const viewStates = new Map<string, EmbedViewState>();

/** Reading view and Live Preview share this DOM. It does not import Obsidian. */
export function mountEmbed(root: HTMLElement, deps: EmbedDeps): () => void {
	root.classList.add("cpo-embed-host");
	root.replaceChildren();
	const parsed = parseEmbed(deps.source);
	const shell = createDiv();
	shell.className = "cpo-embed cpo-surface";
	shell.lang = isChinese() ? "zh-CN" : "en";
	root.append(shell);

	const bar = createEl("header");
	bar.className = "cpo-bar";
	const topLine = createDiv();
	topLine.className = "cpo-topline";
	const brand = createDiv();
	brand.className = "cpo-brand";
	const brandMark = createSpan();
	brandMark.className = "cpo-brand-mark";
	brandMark.textContent = "R";
	const brandName = createEl("strong");
	brandName.textContent = "Research Connected";
	brand.append(brandMark, brandName);
	const status = createDiv();
	status.className = "cpo-status cpo-canvas-seed";
	status.setAttribute("role", "status");

	topLine.append(brand);
	bar.append(topLine);
	shell.append(bar);

	const tools = createDiv();
	tools.className = "cpo-workspace-tools";
	const actionsBar = createDiv();
	actionsBar.className = "cpo-actions-bar";
	tools.append(actionsBar);
	topLine.append(tools);
	const body = createDiv();
	body.className = "cpo-body";
	if (parsed.ok) body.style.height = `${parsed.spec.height}px`;
	shell.append(body);

	const iconNav = createEl("nav");
	iconNav.className = "cpo-icon-nav";
	iconNav.setAttribute("aria-label", tr("图谱导航", "Graph navigation"));
	const layoutHost = createDiv();
	layoutHost.className = "cpo-rail-layouts";
	iconNav.append(layoutHost);
	body.append(iconNav);
	const surface = mountGraphSurface(body, { canvasLabel: tr("论文相似度图谱", "Paper similarity graph"), title: "", hint: "", mutations: false });
	const { stage, canvas, empty: message, messageText, tooltip, nodeMenu, seedItem, zoom, zoomIn, zoomOut, fit: zoomFit, reload, yearHost } = surface;
	stage.append(status);
	const openGraphAction = createEl("button");
	openGraphAction.type = "button";
	openGraphAction.className = "cpo-ghost cpo-open-graph";
	openGraphAction.append(createChromeIcon("external"), document.createTextNode(tr("在工作台中打开", "Open in workbench")));
	topLine.append(openGraphAction);
	for (const button of [openGraphAction]) {
		button.hidden = true;
	}
	const sidebarResize = createDiv();
	sidebarResize.className = "cpo-sidebar-resizer";
	const sidebar = createEl("aside");
	sidebar.className = "cpo-evidence-sidebar";
	const sidebarToggle = createEl("button");
	sidebarToggle.type = "button";
	sidebarToggle.className = "cpo-panel-toggle is-right";
	sidebarToggle.append(createChromeIcon("chevronRight"));
	sidebarToggle.setAttribute("aria-label", tr("折叠右侧栏", "Collapse right sidebar"));
	sidebarToggle.setAttribute("aria-expanded", "false");
	sidebar.append(sidebarToggle);
	body.append(sidebarResize, sidebar);
	const evidenceHeader = createEl("header");
	evidenceHeader.className = "cpo-evidence-header";
	const evidenceTitle = createEl("h2");
	evidenceTitle.textContent = tr("论文详情", "Paper details");
	const returnToGraph = createEl("button");
	returnToGraph.type = "button";
	returnToGraph.className = "cpo-detail-return";
	returnToGraph.textContent = tr("返回图谱", "Back to graph");
	let detailReturn: { zoom: number; centerX: number; centerY: number; selectedId: string | null } | null = null;
	let detailReturnLocked = false;
	let coverDismissed = false;
	const freezeDetailReturn = (): void => {
		if (detailReturnLocked || !shell.classList.contains("is-detail-cover")) return;
		detailReturn = map.getViewState();
		detailReturnLocked = true;
	};
	returnToGraph.addEventListener("click", () => {
		const saved = detailReturn;
		detailReturn = null;
		detailReturnLocked = false;
		coverDismissed = true;
		shell.classList.remove("is-detail-cover");
		if (saved) map.setViewState(saved);
	});
	const evidenceTools = createDiv();
	evidenceTools.className = "cpo-evidence-tools";
	evidenceTools.setAttribute("role", "toolbar");
	evidenceTools.setAttribute("aria-label", tr("论文操作", "Paper actions"));
	const diagnoseButton = createEl("button");
	diagnoseButton.type = "button";
	diagnoseButton.className = "cpo-diagnose";
	diagnoseButton.append(createChromeIcon("diagnose"), document.createTextNode(tr("诊断候选", "Inspect")));
	diagnoseButton.setAttribute("aria-label", tr("诊断候选", "Inspect candidate"));
	diagnoseButton.disabled = true;
	evidenceTools.append(diagnoseButton);
	evidenceHeader.append(evidenceTitle, returnToGraph, evidenceTools);
	sidebar.append(evidenceHeader);
	const sheetHost = createEl("section");
	sidebar.append(sheetHost);
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = createDiv();
	detail.className = "cpo-detail";
	const listPanel = createDiv();
	listPanel.className = "cpo-agg";
	listPanel.hidden = true;
	sheet.body.append(detail, listPanel);
	const sidebarTabs = createDiv();
	sidebarTabs.className = "cpo-sidebar-tabs";
	sidebar.append(sidebarTabs);
	if (!parsed.ok) {
		shell.classList.add("is-error");
		status.textContent = tr("代码块还不能建图", "This code block cannot build a graph yet");
		messageText.textContent = parsed.error;
		reload.hidden = true;
		iconNav.hidden = true;
		tools.hidden = true;
		sidebar.hidden = true;
		sidebarResize.hidden = true;
		sheetHost.hidden = true;
		zoom.hidden = true;
		return () => {
			root.replaceChildren();
			root.classList.remove("cpo-embed-host");
		};
	}

	const spec = parsed.spec;
	const versionDialogs = new AbortController();
	let identityDecisions = deps.getSettings().workIdentityDecisions;
	let sourceRelations = deps.getSettings().sourceVersionRelations;
	let projectKey = spec.projectKey;
	let associationDialog: HTMLDialogElement | null = null;
	let cancelAssociation: (() => void) | null = null;
	const associatedProject = () => projectKey ? deps.getSettings().researchProjects[projectKey] : undefined;
	const chooseProject = (): Promise<string> => {
		if (associatedProject() && projectKey) return Promise.resolve(projectKey);
		if (associationDialog) return Promise.reject(new Error(tr("请先完成项目选择", "Finish choosing a project first")));
		return new Promise((resolve, reject) => {
			const dialog = createEl("dialog");
			associationDialog = dialog;
			dialog.className = "cpo-surface cpo-project-dialog";
			dialog.setAttribute("aria-label", tr("选择操作所属项目", "Choose a project for this action"));
			const title = createEl("h3"); title.textContent = tr("选择操作所属项目", "Choose a project for this action");
			const select = createEl("select"); select.setAttribute("aria-label", tr("研究项目", "Research project"));
			for (const [key, project] of Object.entries(deps.getSettings().researchProjects)) { const option = createEl("option"); option.value = key; option.textContent = `${project.name} (${key})`; select.append(option); }
			const create = createEl("option"); create.value = "new"; create.textContent = tr("新建项目", "Create project"); select.append(create);
			const label = createEl("label");
			const persistent = createEl("input"); persistent.type = "checkbox"; persistent.disabled = !deps.persistAssociation;
			label.append(persistent, document.createTextNode(tr("记住此代码块的项目关联", "Remember this block's project association")));
			const error = createEl("p"); error.setAttribute("role", "status");
			const confirm = createEl("button"); confirm.type = "button"; confirm.textContent = tr("选择", "Choose");
			const cancel = createEl("button"); cancel.type = "button"; cancel.textContent = tr("取消", "Cancel");
			const close = () => { dialog.close(); dialog.remove(); associationDialog = null; cancelAssociation = null; };
			cancelAssociation = () => { close(); reject(new Error(tr("已取消，未保存", "Cancelled; nothing saved"))); };
			cancel.onclick = () => cancelAssociation?.();
			dialog.addEventListener("cancel", event => { event.preventDefault(); cancelAssociation?.(); });
			confirm.onclick = async () => {
				confirm.disabled = true;
				let created: string | undefined;
				try {
					let key = select.value;
					if (key === "new") {
						const seed = sourceGraph?.nodes.find(node => node.isSeed);
						if (!seed || !deps.stagePaper) throw new Error(tr("当前环境无法保存项目", "Project save is unavailable"));
						key = `W${Date.now()}`;
						while (deps.getSettings().researchProjects[key]) key += "1";
						created = key;
						deps.getSettings().researchProjects[key] = { version: 1, seedId: seed.id, name: seed.title || seed.id, updatedAt: Date.now(), views: [], snapshot: saveGraphSnapshot(sourceGraph!) };
						try { await deps.stagePaper(seed, seed.id, "embed-project"); }
						catch (reason) { delete deps.getSettings().researchProjects[key]; throw reason; }
						created = undefined;
						const option = createEl("option"); option.value = key; option.textContent = seed.title || key; select.append(option); select.value = key;
					}
					if (persistent.checked) await deps.persistAssociation?.(key);
					if (persistent.checked) projectKey = key;
					close(); resolve(key);
				} catch (reason) {
					if (created) delete deps.getSettings().researchProjects[created];
					error.textContent = reason instanceof Error ? reason.message : String(reason);
					confirm.disabled = false;
				}
			};
			dialog.append(title, select, label, error, confirm, cancel); shell.append(dialog); dialog.showModal(); select.focus();
		});
	};
	canvas.classList.add("cpo-embed-canvas");
	const stateKey = embedViewStateKey(spec, spec.maxNodes ?? deps.getSettings().maxNodes);
	const saved = viewStates.get(stateKey);
	let viewFilter = saved?.filter ?? filterFromSpec(spec);
	openGraphAction.hidden = !deps.openGraph;
	openGraphAction.onclick = deps.openGraph ? () => deps.openGraph?.(spec.target) : null;
	const map = new SimilarityMap(canvas, tooltip, stage, { wheel: "modifier" });
	map.setLabelMode(spec.labels);
	const frame = mountWorkspaceFrame(shell, body, {
		embed: true,
		sidebar,
		rightToggle: sidebarToggle,
		onLayout: () => {
			map.resize();
			window.setTimeout(() => map.resize(), 240);
		},
		onCommit: () => {},
	});
	const applyFilter = (): void => {
		if (sourceGraph) {
			// Scrub only hides later papers. Removing them relayouts each new year onto the right edge.
			currentGraph = projectVersionGraph(sourceGraph, associatedProject(), { ...viewFilter, scrubYear: null });
			map.adoptGraph(currentGraph.nodes, currentGraph.edges, currentGraph.seedScore, undefined, false, currentGraph.referenceLists);
			graphKey.setStats(currentGraph.nodes, currentGraph.edges, currentGraph.referenceLists);
		}
		map.setContentFilter(viewFilter, currentGraph?.nodes ?? []);
	};
	let layoutMode: LayoutMode = saved?.layout ?? spec.layout;
	const graphKey = mountGraphKey(stage, () => viewFilter, (next) => {
		viewFilter = next;
		applyFilter();
		paintLists();
	});
	graphKey.paintColor(layoutMode);
	let tab: GraphTab = "graph";
	let currentGraph: SimilarityGraph | null = null;
	let sourceGraph: SimilarityGraph | null = null;
	let lastDepthNote = "";
	seedItem.textContent = tr("在工作台中打开", "Open in workbench");
	seedItem.hidden = !deps.openGraph;
	let selected: PaperNode | null = null;
	let selectedLink: GraphEdge | null = null;
	let chrome: GraphChrome | null = null;
	const session = createGraphSession();
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !currentGraph || !deps.openGraph) {
			nodeMenu.hidden = true;
			return;
		}
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		placeNodeMenu(stage, nodeMenu, x, y);
	};
	seedItem.addEventListener("click", () => {
		const paper = currentGraph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) deps.openGraph?.({ kind: "openalex", value: paper.id });
		nodeMenu.hidden = true;
	});
	const hideNodeMenu = (): void => {
		const restore = nodeMenu.contains(document.activeElement);
		nodeMenu.hidden = true;
		if (restore) canvas.focus({ preventScroll: true });
	};
	stage.addEventListener("pointerdown", (event) => {
		if (!nodeMenu.contains(event.target as Node)) hideNodeMenu();
	});
	const onMenuKey = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		if (!nodeMenu.hidden) {
			hideNodeMenu();
			event.preventDefault();
			return;
		}
		const openMenu = shell.querySelector("details[open]");
		if (openMenu) {
			openMenu.removeAttribute("open");
			event.preventDefault();
			return;
		}
		if (frame.dismissTemporary()) event.preventDefault();
	};
	window.addEventListener("keydown", onMenuKey);

	const tabTitles: Record<GraphTab, string> = {
		graph: tr("论文详情", "Paper details"),
		prior: tr("图内常引文献", "Frequently cited references"),
		derivative: tr("引用本图的文献", "Works citing this graph"),
		research: tr("研究脉络", "Research narrative"),
		staged: tr("收藏列表", "Saved papers"),
		excluded: tr("已排除论文", "Excluded papers"),
		pending: tr("待处理（全库）", "Pending (library)"),
	};
	const workflowState = (paper: PaperNode, seedId: string) => {
		const state = projectVersionState(associatedProject(), paper);
		const shared = deps.getReadingState?.(paper);
		return { ...state, reading: shared ? shared.reading ?? "unread" : state.reading, readingConflict: shared ? !shared.confirmed : false };
	};
	const commit = async (paper: PaperNode, seedId: string, patch: { reading?: ReadingStatus; staged?: boolean }): Promise<void> => {
		const key = patch.staged !== undefined ? await chooseProject() : projectKey;
		const selected = patch.staged !== undefined ? (await choosePaperVersion(paper, false, versionDialogs.signal)).paper : paper;
		if (deps.commitWorkflow) await deps.commitWorkflow(selected, key ? deps.getSettings().researchProjects[key]?.seedId ?? null : null, patch, key);
		else throw new Error(tr("阅读状态保存接口尚未接入", "Reading workflow is not connected"));
		paintLists();
	};
	const setExcluded = async (paper: PaperNode, excluded: boolean): Promise<void> => {
		const key = await chooseProject();
		const seedId = deps.getSettings().researchProjects[key]?.seedId;
		if (!seedId || !deps.stagePaper) throw new Error(tr("项目保存接口尚未接入", "Project save is not connected"));
		if (paper.id === seedId || paper.isSeed) return;
		const chosen = await choosePaperVersion(paper, excluded, versionDialogs.signal);
		const original = deps.getSettings().researchProjects[key]!;
		const updated = structuredClone(original);
		changeVersionExclusion(updated, chosen.paper, excluded, chosen.whole, paper);
		deps.getSettings().researchProjects[key] = updated;
		try { await deps.stagePaper(paper, seedId, "OpenAlex"); }
		catch (error) { if (deps.getSettings().researchProjects[key] === updated) deps.getSettings().researchProjects[key] = original; throw error; }
		if (sourceGraph) {
			if (!excluded && !sourceGraph.nodes.some(node => node.id === paper.id)) sourceGraph = graftNodes(sourceGraph, [paper], new Map());
			renderGraph(sourceGraph, lastDepthNote);
		}
		if (!excluded && !nodeVisible(paper, viewFilter)) {
			status.textContent = tr("已恢复，当前筛选下不可见", "Restored; hidden by the current filters");
			const button = createEl("button");
			button.type = "button";
			button.className = "cpo-text-btn";
			button.textContent = tr("定位论文", "Locate paper");
			button.onclick = () => locate(paper);
			status.append(button);
		}
	};
	const locate = (paper: PaperNode): void => {
		const node = currentGraph?.nodes.find(node => node.id === paper.id);
		if (!node) { status.textContent = tr("论文不在当前图中；可查看详情，恢复排除后再定位。", "This paper is outside the current graph. View its details or restore it before locating."); return; }
		if (!nodeVisible(node, viewFilter)) {
			viewFilter = { ...viewFilter, yearFrom: null, yearTo: null, language: null, workType: null, concept: null, scrubYear: null };
			applyFilter();
			const histogram = session.state().histogram;
			if (histogram) chrome?.setHistogram(histogram, null);
		}
		showDetail(node, currentGraph!, null, true);
		map.focusPaper(node.id);
	};

	const paintLists = (): void => {
		evidenceTitle.textContent = tabTitles[tab] ?? tabTitles.graph;
		detail.hidden = tab !== "graph";
		if (tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		if (tab === "staged" || tab === "excluded" || tab === "pending") {
			if (!deps.getReadingState || !deps.commitWorkflow || !deps.getReadingIssues || !deps.resolveReading || !deps.retryReading) return;
			paintWorkflowLibrary(listPanel, {
				tab, projectId: projectKey ?? null, projects: deps.getSettings().researchProjects,
				onResolvePending: (key, id, choice) => resolveProjectPending(deps.getSettings(), key, id, choice, () => deps.stagePaper?.(deps.getSettings().researchProjects[key]!.snapshot!.nodes[0]!, deps.getSettings().researchProjects[key]!.seedId, "pending")),
				workflow: { getReadingState: deps.getReadingState, commitWorkflow: deps.commitWorkflow, getReadingIssues: deps.getReadingIssues, resolveReading: deps.resolveReading, retryReading: deps.retryReading },
				onTab: next => { tab = next; chrome?.setTab(next); paintLists(); },
				onView: paper => { if (currentGraph) showDetail(paper, currentGraph, null, true); },
				onLocate: locate, onExclude: setExcluded, onRefresh: paintLists,
			});
			return;
		}
		if (!currentGraph) {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(visibleNodes(currentGraph.nodes, viewFilter).map((node) => node.id));
		const seed = currentGraph.nodes.find((node) => node.isSeed);
		const rows = (tab === "prior" ? priorWorks(currentGraph, visible) : derivativeWorks(currentGraph, visible))
			.filter((row) => !seed || !associatedProject()?.paperStates?.[row.paper.id]?.excluded);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? tr("被本图引用", "Cited by this graph") : tr("引用本图", "Cites this graph");
		fillAggregate(listPanel, definition, rows, noun, (paper) => {
			if (currentGraph) showDetail(paper, currentGraph, null, true);
		}, (card, paper) => {
			if (!seed) return;
			const state = workflowState(paper, seed.id);
			paintPaperWorkflowState(card, paper, state, reading => commit(paper, seed.id, { reading }), () => setExcluded(paper, true), () => setExcluded(paper, false));
			paintPaperActions(card, paper, seed.id, null, null, {
				getPaperState: (projectId) => workflowState(paper, projectId),
				setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
				persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
				commit: deps.commitWorkflow ? patch => commit(paper, seed.id, patch) : undefined,
				readingConflict: state.readingConflict,
				openExternal: deps.openExternal,
			});
		});
	};

	chrome = mountGraphChrome(layoutHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: layoutMode,
		noteButton: Boolean(deps.createNote),
		libraryTab: true,
		actionsHost: actionsBar,
		tabsHost: sidebarTabs,
		tabPanel: sheetHost,
		layoutHost,
		scrubHost: yearHost,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(layoutMode);
			map.setColorMode(defaultColorMode(layoutMode));
			graphKey.paintColor(layoutMode);
		},
		onScrub: (year) => {
			if (year === viewFilter.scrubYear) return;
			session.apply({ type: "scrub", year });
			viewFilter = { ...viewFilter, scrubYear: session.state().scrubYear };
			applyFilter();
			paintLists();
			const histogram = session.state().histogram;
			if (histogram) chrome?.setHistogram(histogram, viewFilter.scrubYear);
		},
		onTab: (next) => {
			tab = next;
			listPanel.hidden = next === "graph";
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
			frame.revealRight();
		},
		onExport: (kind) => {
			void exportView(kind);
		},
	});
	const exportView = async (kind: ExportKind): Promise<void> => {
		if (!currentGraph) {
			chrome?.setExportText(tr("请先构建图谱", "Build a graph first"));
			return;
		}
		if (kind === "note") {
			const chosen = selected ?? currentGraph.nodes.find((node) => node.isSeed) ?? null;
			if (!chosen) return;
			let paper: PaperNode;
			try { paper = (await choosePaperVersion(chosen, false, versionDialogs.signal)).paper; }
			catch (error) { chrome?.setExportText(error instanceof Error ? error.message : String(error)); return; }
			if (deps.lookupLiteratureNote?.(paper)) { showDetail(paper, currentGraph, selectedLink, true); chrome?.setExportText(tr("已找到文献笔记，请从详情中选择打开", "Literature notes found. Open one from the paper details.")); return; }
			const settings = deps.getSettings();
			const seedId = currentGraph.nodes.find((node) => node.isSeed)?.id ?? paper.id;
			const shared = deps.getReadingState?.(paper);
			if (shared && !shared.confirmed) {
				chrome?.setExportText(tr("请先确认阅读状态，再创建笔记", "Confirm reading status before creating a note"));
				return;
			}
			const fields = {
				project: associatedProject()?.name || seedId,
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
					if (currentGraph) showDetail(paper, currentGraph, selectedLink, true);
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				}
				return;
			}
			await chrome?.copyText(markdown, tr("笔记内容", "Note contents"));
			return;
		}
		const range = chrome?.exportOptions() ?? { mode: "one" as const, includeSeedException: false };
		const nodes = orderedForExport(graphExportVersions(currentGraph.nodes, associatedProject(), viewFilter, range.mode, range.includeSeedException));
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		await chrome?.copyText(text, kind === "bibtex" ? "BibTeX" : kind === "yaml" ? "YAML" : tr("表格", "Table"));
	};

	const anchor = placementAnchor(root);
	const clearPlacement = applyPlacement(root, anchor, spec);
	const stopResize = mountResizeHandle(body, anchor, () => map.resize());
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, {
		onResize: () => map.resize(),
	});
	const narrowObserver = observeResponsiveMode(shell, () => {
		frame.apply();
		map.resize();
		if (!coverDismissed && Boolean(selected) && !detail.hidden && shell.classList.contains("is-narrow")) frame.revealRight();
		if (setDetailCover(shell, !coverDismissed && Boolean(selected) && !detail.hidden)) {
			detailReturn = map.getViewState();
			detailReturnLocked = false;
		} else if (!shell.classList.contains("is-detail-cover")) {
			detailReturn = null;
			detailReturnLocked = false;
		}
	});
	narrowObserver.observe(stage);
	zoomIn.addEventListener("click", () => { freezeDetailReturn(); map.zoomBy(1.2); });
	zoomOut.addEventListener("click", () => { freezeDetailReturn(); map.zoomBy(1 / 1.2); });
	zoomFit.addEventListener("click", () => map.fit(true));
	let wheelHinted = false;
	stage.addEventListener(
		"wheel",
		(event) => {
			if (wheelHinted || event.ctrlKey || event.metaKey) return;
			wheelHinted = true;
			status.textContent += tr(" · 按住 ⌘/Ctrl 滚动可缩放", " · hold ⌘/Ctrl and scroll to zoom");
		},
		{ capture: true, passive: true },
	);
	let generation = 0;
	let alive = true;
	let associationPaused = false;
	const pauseExcludedSeed = (): boolean => {
		const seed = sourceGraph?.nodes.find(node => node.isSeed);
		const project = associatedProject();
		const excluded = seed && projectVersionState(project, seed).excluded;
		if (!excluded) { associationPaused = false; return false; }
		if (!associationPaused) generation++;
		associationPaused = true;
		reload.disabled = true;
		message.hidden = false;
		messageText.textContent = tr("关联项目已排除此起点，嵌入已暂停。", "The linked project excludes this seed. This embed is paused.");
		const restore = createEl("button"); restore.type = "button"; restore.textContent = tr("恢复此版本并继续", "Restore this version and continue");
		restore.onclick = async () => {
			if (!projectKey || !project || !seed || !deps.stagePaper) return;
			restore.disabled = true;
			const updated = structuredClone(project);
			changeVersionExclusion(updated, seed, false, false);
			deps.getSettings().researchProjects[projectKey] = updated;
			try { await deps.stagePaper(seed, project.seedId, "embed-restore"); associationPaused = false; reload.disabled = false; if (sourceGraph) renderGraph(sourceGraph, lastDepthNote); }
			catch (error) { if (deps.getSettings().researchProjects[projectKey] === updated) deps.getSettings().researchProjects[projectKey] = project; status.textContent = error instanceof Error ? error.message : String(error); restore.disabled = false; }
		};
		const unlink = createEl("button"); unlink.type = "button"; unlink.textContent = tr("解除关联并继续", "Unlink and continue");
		unlink.onclick = async () => {
			unlink.disabled = true;
			try { if (spec.projectKey) { if (!deps.persistAssociation) throw new Error(tr("当前环境无法修改持久项目关联", "Persistent association cannot be edited here")); await deps.persistAssociation(null); } projectKey = undefined; associationPaused = false; reload.disabled = false; if (sourceGraph) renderGraph(sourceGraph, lastDepthNote); }
			catch (error) { status.textContent = error instanceof Error ? error.message : String(error); unlink.disabled = false; }
		};
		messageText.append(restore, unlink);
		return true;
	};
	/** Abstract fallback: which source filled an abstract, or which DOI has no known abstract. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractFromCrossref = new Set<string>();
	const abstractMissing = new Set<string>();
	const abstractErrors = new Map<string, string>();
	const fetchedAbstracts = new Map<string, Extract<AbstractLookupResult, { status: "found" }>>();

	const embedAbstractText = (paper: PaperNode): string => {
		const cached = fetchedAbstracts.get(doiFromPaper(paper) ?? paper.id);
		if (!paper.abstract && cached) { paper.abstract = cached.text; paper.abstractSource = cached.source; }
		return abstractCaption(paper, { s2: abstractFromS2, crossref: abstractFromCrossref, missing: abstractMissing, errors: abstractErrors });
	};

	const placeDetailPlaceholder = (): void => {
		session.apply({ type: "select-paper", id: null, source: "refresh" });
		selected = null;
		selectedLink = null;
		detailReturn = null;
		detailReturnLocked = false;
		coverDismissed = false;
		setDetailCover(shell, false);
		detail.replaceChildren();
		const empty = createEl("p");
		empty.className = "cpo-side-tip";
		empty.textContent = tr("点选节点查看题名、年份、作者和证据。", "Select a node to view its title, year, authors, and evidence.");
		detail.append(empty);
		sheet.setSummary(tr("点选节点查看论文", "Select a node to view its paper"), "");
	};
	placeDetailPlaceholder();

	const showDetail = (paper: PaperNode | null, graph: SimilarityGraph, link: GraphEdge | null, reveal = false): void => {
		if (!paper) {
			placeDetailPlaceholder();
			return;
		}
		const abstractKey = doiFromPaper(paper) ?? paper.id;
		if (reveal) {
			void deps.readingOpened?.(paper).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : tr("阅读状态加载失败", "Could not load reading status"); });
			tab = "graph";
			chrome?.setTab("graph");
			evidenceTitle.textContent = tabTitles.graph;
			listPanel.hidden = true;
			detail.hidden = false;
			coverDismissed = false;
		}
		if (!coverDismissed && shell.classList.contains("is-narrow") && !shell.classList.contains("is-detail-cover") && !detail.hidden) {
			detailReturn = map.getViewState();
			detailReturnLocked = false;
		}
		setDetailCover(shell, !coverDismissed && !detail.hidden);
		map.setSelected(graph.nodes.some((node) => node.id === paper.id) ? paper.id : null);
		if (link) session.apply({ type: "select-edge", id: `${link.source}\0${link.target}`, paperId: paper.id, source: reveal ? "user" : "refresh" });
		else session.apply({ type: "select-paper", id: paper.id, source: reveal ? "user" : "refresh" });
		if (session.state().revealRight) frame.revealRight();
		selected = paper;
		selectedLink = link;
		detail.replaceChildren();
		const seed = graph.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seed?.id ?? paper.id;
		const project = associatedProject();
		const paperState = workflowState(paper, seedId);
		const noted = deps.lookupLiteratureNote?.(paper) ?? null;
		paintPaperDetail(detail, graph, paper, {
			isClassic: !!map.classicEvidence(paper.id),
			abstractText: embedAbstractText,
			onRetryAbstract: abstractErrors.has(abstractKey) ? () => {
				abstractErrors.delete(abstractKey);
				abstractRequested.delete(abstractKey);
				showDetail(paper, graph, link);
			} : undefined,
			openExternal: deps.openExternal,
			separate: () => {
				if (!currentGraph) return;
				void commitWorkIdentityDecision(deps.getSettings(), { ids: paperRecords(paper).map(record => record.id), kind: "separate", source: "manual", updatedAt: Date.now() }, () => deps.stagePaper?.(paper, seedId, "identity")).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); });
			},
			conflict: project?.identityConflicts?.includes(paper.id) ?? false,
			acknowledge: () => {
				if (!project) return;
				acknowledgeIdentityStates(project, paper);
				void deps.stagePaper?.(paper, seedId, "OpenAlex");
				showDetail(paper, graph, link);
			},
			workflow: paperState,
			onReading: reading => commit(paper, seedId, { reading }),
			onExclude: deps.stagePaper ? () => setExcluded(paper, true) : undefined,
			onRestore: deps.stagePaper ? () => setExcluded(paper, false) : undefined,
			literature: noted && deps.openLiteratureNote ? { path: noted.path, alternatives: noted.alternatives, open: deps.openLiteratureNote } : undefined,
			lookupLiteratureNote: deps.lookupLiteratureNote,
			openLiteratureNote: deps.openLiteratureNote,
			signal: versionDialogs.signal,
			actions: {
				getPaperState: (projectId) => workflowState(paper, projectId),
				setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
				persist: deps.stagePaper && seed ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
				commit: deps.commitWorkflow ? patch => commit(paper, seedId, patch) : undefined,
				readingConflict: paperState.readingConflict,
				openExternal: deps.openExternal,
			},
			onJump: (target) => {
				if (currentGraph) showDetail(target, currentGraph, null, true);
			},
			extraEdge: link,
		});
		paintIdentityDecisionActions(detail, paper, [...graph.catalog, ...Object.values(deps.getSettings().researchProjects).flatMap(project => project.snapshot?.catalog ?? project.snapshot?.nodes ?? [])], async (ids, kind) => {
			if (!deps.stagePaper) throw new Error(tr("当前环境无法保存项目", "Project persistence is unavailable"));
			await commitWorkIdentityDecision(deps.getSettings(), { ids, kind, source: "manual", updatedAt: Date.now() }, () => deps.stagePaper!(paper, seedId, "identity"));
		});
		if (!paperState.excluded && (!graph.nodes.some(node => node.id === paper.id) || !nodeVisible(paper, viewFilter))) {
			const hint = createEl("p");
			hint.className = "cpo-side-tip";
			hint.textContent = tr("论文当前不可见；恢复保留现有筛选。", "This paper is currently hidden. Restoring keeps the current filters.");
			const button = createEl("button");
			button.type = "button";
			button.className = "cpo-text-btn";
			button.textContent = tr("在图中定位", "Locate in graph");
			button.onclick = () => locate(paper);
			detail.append(hint, button);
		}
		if (!paper.abstract && !abstractMissing.has(abstractKey) && !abstractRequested.has(abstractKey)) {
			abstractRequested.add(abstractKey);
			void fallbackAbstract(deps.getJson, paper, {
				semanticScholarApiKey: deps.getSettings().semanticScholarApiKey,
				contactEmail: deps.getSettings().contactEmail,
			}).then((result) => {
				if (!alive) return;
				if (result.status === "found") {
					fetchedAbstracts.set(abstractKey, result);
					paper.abstract = result.text;
					paper.abstractSource = result.source;
					if (result.source === "s2") abstractFromS2.add(abstractKey);
					else abstractFromCrossref.add(abstractKey);
				} else if (result.status === "error") {
					abstractErrors.set(abstractKey, result.error);
				} else {
					abstractMissing.add(abstractKey);
				}
				if (selected && (doiFromPaper(selected) ?? selected.id) === abstractKey && currentGraph) showDetail(selected, currentGraph, null);
			});
		}
	};

	diagnoseButton.addEventListener("click", () => {
		if (!currentGraph) return;
		frame.revealRight();
		const returnPaper = selected;
		const returnLink = selectedLink;
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("候选诊断", "Candidate inspection"), tr("当前图谱的采样记录", "Sampling records for the current graph"));
		const back = createEl("button");
		back.type = "button";
		back.className = "cpo-diagnose-back";
		back.append(createChromeIcon("back"), document.createTextNode(tr("返回论文", "Back to paper")));
		back.disabled = !returnPaper;
		back.onclick = () => currentGraph && showDetail(returnPaper, currentGraph, returnLink, true);
		detail.append(back);
		const form = createEl("form");
		form.className = "cpo-diagnose-form";
		const query = createEl("input");
		query.placeholder = tr("DOI 或 OpenAlex ID", "DOI or OpenAlex ID");
		query.setAttribute("aria-label", tr("要诊断的论文", "Paper to inspect"));
		const submit = createEl("button");
		submit.type = "submit";
		submit.className = "cpo-primary";
		submit.textContent = tr("查询", "Search");
		form.append(query, submit);
		const result = createDiv();
		result.className = "cpo-diagnose-result";
		detail.append(form, result);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (!currentGraph) return;
			const finding = diagnoseCandidate(currentGraph, query.value, new Set(), viewFilter.scrubYear);
			result.replaceChildren();
			const title = createEl("strong");
			title.textContent = finding.title;
			const text = createEl("p");
			text.className = "cpo-side-tip";
			text.textContent = finding.detail;
			result.append(title, text);
			const paper = finding.paperId && currentGraph.nodes.find((item) => item.id === finding.paperId);
			if (paper) {
				const open = createEl("button");
				open.type = "button";
				open.className = "cpo-text-btn";
				open.textContent = tr("查看论文", "View paper");
				open.onclick = () => { if (currentGraph) showDetail(paper, currentGraph, null, true); };
				result.append(open);
			}
		});
		query.focus();
	});

	const snapshotView = (): void => {
		rememberViewState(stateKey, { filter: viewFilter, layout: layoutMode });
	};

	map.onSelect = (paper) => {
		if (paper && currentGraph) showDetail(paper, currentGraph, null, true);
		else placeDetailPlaceholder();
	};
	map.onEdgeSelect = (edge) => {
		if (!currentGraph || !edge) {
			placeDetailPlaceholder();
			return;
		}
		const from = currentGraph.nodes.find((node) => node.id === edge.source);
		showDetail(from ?? currentGraph.nodes.find((node) => node.id === edge.target) ?? null, currentGraph, edge, true);
	};

	const renderGraph = (graph: SimilarityGraph, depthNote: string): void => {
		const sameProject = sourceGraph?.nodes.find(node => node.isSeed)?.id === graph.nodes.find(node => node.isSeed)?.id;
		const previousSelection = selected;
		const previousLink = selectedLink;
		graph = applyWorkIdentityDecisions(graph, deps.getSettings().workIdentityDecisions, deps.getSettings().sourceVersionRelations);
		snapshotView();
		message.hidden = true;
		sourceGraph = graph;
		lastDepthNote = depthNote;
		if (pauseExcludedSeed()) return;
		const savedProject = associatedProject();
		if (savedProject) reconcileProjectIdentity(savedProject, graph);
		graph = projectVersionGraph(graph, savedProject);
		const excluded = Object.entries(savedProject?.versionStates ?? savedProject?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
		graph.excludedIds = excluded;
		currentGraph = graph;
		diagnoseButton.disabled = false;
		chrome?.setExportsEnabled(true);
		if (sameProject && currentGraph) map.adoptGraph(graph.nodes, graph.edges, graph.seedScore, undefined, false, graph.referenceLists);
		else map.setGraph(graph.nodes, graph.edges, graph.seedScore, graph.referenceLists);
		graphKey.setStats(graph.nodes, graph.edges, graph.referenceLists);
		graphKey.paintColor(layoutMode);
		if (!sameProject) map.setLayout(layoutMode);
		map.setColorMode(layoutMode === spec.layout ? spec.color : defaultColorMode(layoutMode));
		applyFilter();
		session.apply({ type: "sample", years: graph.nodes.map((node) => node.year), scrubYear: viewFilter.scrubYear });
		const histogram = session.state().histogram;
		if (histogram) chrome?.showSample(histogram, viewFilter.scrubYear);
		paintLists();
		const seed = graph.nodes.find((node) => node.isSeed);
		const fullStatus = tr(`${[seed?.title, seed?.authors, seed?.year].filter(Boolean).join(" · ") || tr("图谱", "Graph")} · ${graph.nodes.length} 篇${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · 滤除书评等 ${graph.skippedNonResearch} 条` : ""
		}${graph.pagingLimited ? " · 深度采样未翻页：没有 OpenAlex API 密钥，只取了第一页" : ""}`, `${[seed?.title, seed?.authors, seed?.year].filter(Boolean).join(" · ") || tr("图谱", "Graph")} · ${graph.nodes.length} papers${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · filtered ${graph.skippedNonResearch} reviews and other non-research records` : ""
		}${graph.pagingLimited ? " · deep sampling stayed on page 1 because no OpenAlex API key is set" : ""}`);
		const enhancementNote = enhancementText(graph);
		const samples = graph.retrievalStats ? [
			samplingText(graph.retrievalStats.references, tr("参考文献", "References")),
			samplingText(graph.retrievalStats.citations, tr("施引文献", "Citing papers")),
			samplingText(graph.retrievalStats.related, tr("相关作品", "Related works")),
		] : [];
		const diagnostics = [fullStatus, ...samples, ...graph.warnings.map(item => WARNING_TEXT[item]), enhancementNote].filter(Boolean).join("\n");
		paintGraphStatus(status, graphStatusSummary(graph), diagnostics);
		if (previousSelection) showDetail(graph.nodes.find(node => node.id === previousSelection.id) ?? previousSelection, graph, previousLink);
		else if (seed) showDetail(seed, graph, null);
	};

	/** OpenCitations pass: verify and add citation links between visible nodes, then re-render if edges changed. */
	const enrichOpenCitations = async (graph: SimilarityGraph, depthNote: string): Promise<void> => {
		const token = generation;
		const doiToId = new Map<string, string>();
		for (const paper of graph.nodes.flatMap(paperRecords)) {
			const doi = doiFromPaper(paper)?.toLowerCase();
			if (doi) doiToId.set(doi, paper.id);
		}
		if (doiToId.size === 0) return;
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		const papers = graph.nodes.flatMap(paperRecords).filter((paper) => doiFromPaper(paper)).slice(0, 10);
		const edgesBefore = graph.edges.length;
		let completed = 0, failed = 0;
		for (const paper of papers) {
			if (!alive || token !== generation || currentGraph !== graph) return;
			try {
				const rows = await client.references(doiFromPaper(paper)!);
				completed++;
				if (!alive || token !== generation || currentGraph !== graph) return;
				for (const row of rows) {
					const ids = doisFromOpenCitation(row);
					const citing = ids.citing.map((doi) => doiToId.get(doi)).find(Boolean);
					const cited = ids.cited.map((doi) => doiToId.get(doi)).find(Boolean);
					if (citing && cited) mergeOpenCitation(graph, citing, cited);
				}
			} catch { failed++; }
		}
		if (!alive || token !== generation || currentGraph !== graph) return;
		const added = graph.edges.length - edgesBefore;
		if (added > 0) {
			map.updateGraphData(graph.edges, graph.referenceLists);
			graphKey.setStats(graph.nodes, graph.edges, graph.referenceLists);
		}
		appendStatusDetail(status, tr(`OpenCitations 检查成功 ${completed}/${papers.length} 篇，失败 ${failed} 篇`, `OpenCitations checked ${completed}/${papers.length} papers successfully; ${failed} failed`), graphStatusSummary(graph, failed > 0));
		if (!deps.stagePaper) return;
		try {
			const settings = deps.getSettings();
			const reports = await new CrossrefClient(deps.getJson, settings.contactEmail).versionRelations(graph.catalog.flatMap(paperRecords), settings.sourceVersionRelations);
			if (alive && token === generation && currentGraph === graph) {
				const seed = graph.nodes.find(paper => paper.isSeed)!;
				await commitSourceVersionRelations(settings, reports, () => deps.stagePaper!(seed, seed.id, "source-version-relations"), graph.catalog);
			}
		} catch (error) { if (alive && token === generation) status.textContent = error instanceof Error ? error.message : tr("版本关系保存失败，请重新加载重试", "Version relation save failed. Reload to retry."); }
	};

	const load = async (bypassCache: boolean, allowRetractedSeed = false): Promise<void> => {
		if (pauseExcludedSeed()) return;
		const token = ++generation;
		placeDetailPlaceholder();
		tooltip.hidden = true;
		message.hidden = false;
		messageText.textContent = STAGE_TEXT.resolving;
		status.textContent = STAGE_TEXT.resolving;
		reload.disabled = true;
		const settings = { ...deps.getSettings() };
		const cap = spec.maxNodes ?? settings.maxNodes;
		const key = embedDataCacheKey(spec.target, cap, spec.depth, settings);
		try {
			let graph = bypassCache ? undefined : cache.get(key);
			if (graph) graph = cloneGraph(graph);
			let depthNote = "";
			if (!graph) {
				const firstCap = spec.depth === 2 ? Math.min(cap, Math.max(15, cap - 10)) : cap;
				graph = await loadNeighborhood(
					clientFor(deps, settings),
					spec.target,
					{ ...settings, maxNodes: firstCap, researchProjects: {} },
					(stage) => {
						if (token === generation) {
							messageText.textContent = STAGE_TEXT[stage];
							status.textContent = STAGE_TEXT[stage];
						}
					},
					reconcileFor(deps, settings),
					new CrossrefClient(deps.getJson, settings.contactEmail),
					{ savedSeed: sourceGraph?.nodes.find(node => node.isSeed), allowRetractedSeed },
				);
				if (spec.depth === 2) {
					const expanded = await expandSecondLayer(clientFor(deps, settings), graph, cap, settings.excludeRetracted);
					graph = expanded.graph;
					depthNote = expanded.note;
				}
				remember(key, graph);
			}
			if (!alive || token !== generation) return;
			renderGraph(graph, depthNote);
			if (currentGraph) void enrichOpenCitations(currentGraph, depthNote);
		} catch (error) {
			if (!alive || token !== generation) return;
			message.hidden = false;
			messageText.textContent = error instanceof Error ? error.message : tr("构建图谱失败。", "Could not build the graph.");
			if (error instanceof RetractedSeedError) { const proceed = createEl("button"); proceed.type = "button"; proceed.textContent = tr("保留撤稿起点并重建", "Keep retracted seed and rebuild"); proceed.onclick = () => { void load(true, true); }; messageText.append(proceed); }
			status.textContent = tr("图谱没有建起来", "The graph could not be built");
		} finally {
			if (token === generation) reload.disabled = false;
		}
	};

	reload.addEventListener("click", () => {
		const settings = { ...deps.getSettings() };
		cache.delete(embedDataCacheKey(spec.target, spec.maxNodes ?? settings.maxNodes, spec.depth, settings));
		void load(true);
	});
	void load(false);

	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);
	const onProject = (): void => {
		if (!sourceGraph || pauseExcludedSeed()) return;
		if (identityDecisions !== deps.getSettings().workIdentityDecisions || sourceRelations !== deps.getSettings().sourceVersionRelations) { identityDecisions = deps.getSettings().workIdentityDecisions; sourceRelations = deps.getSettings().sourceVersionRelations; renderGraph(sourceGraph, lastDepthNote); return; }
		if (!currentGraph) { renderGraph(sourceGraph, lastDepthNote); return; }
		const savedProject = associatedProject();
		if (savedProject) reconcileProjectIdentity(savedProject, sourceGraph);
		const excluded = Object.entries(savedProject?.versionStates ?? savedProject?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id);
		if (excluded.join("\0") !== (currentGraph.excludedIds ?? []).join("\0")) renderGraph(sourceGraph, lastDepthNote);
		else {
			paintLists();
			if (selected) showDetail(selected, currentGraph, selectedLink);
		}
	};
	window.addEventListener("research-connected-project", onProject);

	return () => {
		alive = false;
		versionDialogs.abort();
		cancelAssociation?.();
		session.destroy();
		generation += 1;
		snapshotView();
		window.removeEventListener("research-connected-theme", onTheme);
		window.removeEventListener("research-connected-project", onProject);
		window.removeEventListener("keydown", onMenuKey);
		map.destroy();
		chrome?.destroy();
		sheet.destroy();
		stopResize();
		stopSidebarResize();
		narrowObserver.disconnect();
		clearPlacement();
		root.replaceChildren();
		root.classList.remove("cpo-embed-host");
	};
}

const PLACEMENT_CLASSES = [
	"cpo-embed-anchor",
	"cpo-pos-inline",
	"cpo-pos-float-left",
	"cpo-pos-float-right",
	"cpo-pos-full",
	"cpo-align-left",
	"cpo-align-center",
	"cpo-align-right",
	"cpo-span",
	"cpo-user-resized",
];

function placementAnchor(root: HTMLElement): HTMLElement {
	const parent = root.parentElement;
	const widget = parent?.closest(".cm-embed-block, .cm-preview-code-block");
	return widget instanceof HTMLElement ? widget : root;
}

/** Float or widen the fence element (and the Live Preview widget, when present). */
function applyPlacement(root: HTMLElement, anchor: HTMLElement, spec: EmbedSpec): () => void {
	const previousWidth = anchor.style.width;
	const previousMaxWidth = anchor.style.maxWidth;
	const span = spec.position === "full" && spec.width === "100%";
	const classes = [`cpo-pos-${spec.position}`, `cpo-align-${spec.align}`, ...(span ? ["cpo-span"] : [])];
	anchor.classList.add("cpo-embed-anchor", ...classes);
	anchor.style.width = span ? "" : spec.width;
	return () => {
		anchor.classList.remove(...PLACEMENT_CLASSES);
		anchor.style.width = previousWidth;
		anchor.style.maxWidth = previousMaxWidth;
	};
}

function mountResizeHandle(graphArea: HTMLElement, anchor: HTMLElement, onResize: () => void): () => void {
	const grip = createDiv();
	grip.className = "cpo-resize";
	grip.setAttribute("role", "button");
	grip.tabIndex = 0;
	grip.setAttribute("aria-label", tr("调整图谱大小：拖动，或用方向键（Shift 加速）", "Resize graph: drag or use arrow keys (Shift for faster movement)"));
	graphArea.append(grip);
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let startW = 0;
	let startH = 0;

	const applySize = (width: number, height: number): void => {
		const clampedWidth = Math.min(EMBED_WIDTH_LIMIT.max, Math.max(EMBED_WIDTH_LIMIT.min, Math.round(width)));
		const clampedHeight = Math.min(EMBED_HEIGHT_LIMIT.max, Math.max(EMBED_HEIGHT_LIMIT.min, Math.round(height)));
		anchor.classList.add("cpo-user-resized");
		anchor.style.width = `${clampedWidth}px`;
		graphArea.style.height = `${clampedHeight}px`;
		onResize();
	};

	const onPointerDown = (event: PointerEvent): void => {
		dragging = true;
		startX = event.clientX;
		startY = event.clientY;
		startW = anchor.getBoundingClientRect().width;
		startH = graphArea.getBoundingClientRect().height;
		try {
			grip.setPointerCapture(event.pointerId);
		} catch {
			// A pointer id that is not active cannot be captured.
		}
		event.preventDefault();
		event.stopPropagation();
	};
	const onPointerMove = (event: PointerEvent): void => {
		if (!dragging) return;
		applySize(startW + (event.clientX - startX), startH + (event.clientY - startY));
	};
	const onPointerUp = (event: PointerEvent): void => {
		if (!dragging) return;
		dragging = false;
		try {
			if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
		} catch {
			// The pointer was never captured.
		}
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		const step = event.shiftKey ? 160 : 40;
		const width = anchor.getBoundingClientRect().width;
		const height = graphArea.getBoundingClientRect().height;
		if (event.key === "ArrowLeft") applySize(width - step, height);
		else if (event.key === "ArrowRight") applySize(width + step, height);
		else if (event.key === "ArrowUp") applySize(width, height - step);
		else if (event.key === "ArrowDown") applySize(width, height + step);
		else return;
		event.preventDefault();
		event.stopPropagation();
	};
	grip.addEventListener("pointerdown", onPointerDown);
	grip.addEventListener("pointermove", onPointerMove);
	grip.addEventListener("pointerup", onPointerUp);
	grip.addEventListener("pointercancel", onPointerUp);
	grip.addEventListener("keydown", onKeyDown);
	return () => {
		grip.removeEventListener("pointerdown", onPointerDown);
		grip.removeEventListener("pointermove", onPointerMove);
		grip.removeEventListener("pointerup", onPointerUp);
		grip.removeEventListener("pointercancel", onPointerUp);
		grip.removeEventListener("keydown", onKeyDown);
		grip.remove();
	};
}

function filterFromSpec(spec: EmbedSpec): GraphFilter {
	return {
		...emptyFilter(),
		minCoCitedBy: spec.minCoCite,
		minSharedRefs: spec.minShared,
		yearFrom: spec.yearFrom,
		yearTo: spec.yearTo,
		language: spec.language,
		workType: spec.workType,
		concept: spec.concept,
	};
}

function clientFor(deps: EmbedDeps, settings: ConnectedPapersSettings): OpenAlexClient {
	return new OpenAlexClient(deps.getJson, {
		apiKey: settings.apiKey,
		contactEmail: settings.contactEmail,
	});
}

function reconcileFor(deps: EmbedDeps, settings: ConnectedPapersSettings): SemanticScholarClient | null {
	if (!deps.postJson || !settings.s2Reconcile) return null;
	return new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
}

export function embedDataCacheKey(
	target: { kind: string; value: string },
	maxNodes: number,
	depth: number,
	settings: ConnectedPapersSettings,
): string {
	return [
		`identity-${WORK_IDENTITY_VERSION}`,
		JSON.stringify(settings.sourceVersionRelations ?? []),
		JSON.stringify(Object.values(settings.researchProjects).map((project) => [project.seedId, project.snapshot?.workIdentity?.separatedIds ?? []])),
		target.kind,
		target.value,
		maxNodes,
		depth,
		settings.includeReferences ? "1" : "0",
		settings.includeCitations ? "1" : "0",
		settings.includeRelated ? "1" : "0",
		// 会改变候选采样与评分语义的设置必须进 key，避免展示陈旧解释。
		settings.sampleDepth,
		settings.s2Reconcile ? "s2" : "nos2",
		settings.semanticEmbedding ? "emb" : "noemb",
		settings.apiKey.trim() ? "keyed" : "anon",
		settings.semanticScholarApiKey.trim() ? "s2k" : "s2anon",
		settings.excludeRetracted ? "retracted-out" : "retracted-in",
	].join("|");
}

function cloneGraph(graph: SimilarityGraph): SimilarityGraph {
	return restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph)))) ?? graph;
}

function remember(key: string, graph: SimilarityGraph): void {
	if (cache.size >= 12) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(key, cloneGraph(graph));
}

function rememberViewState(key: string, state: EmbedViewState): void {
	if (viewStates.size >= 12) {
		const oldest = viewStates.keys().next().value;
		if (oldest) viewStates.delete(oldest);
	}
	viewStates.set(key, state);
}

function fillAggregate(
	host: HTMLElement,
	definition: string,
	rows: readonly RankedWork[],
	noun: string,
	onPick: (paper: PaperNode) => void,
	onActions: (card: HTMLElement, paper: PaperNode) => void,
): void {
	host.hidden = false;
	host.replaceChildren();
	const copy = createEl("p");
	copy.className = "cpo-agg-def";
	copy.textContent = definition;
	host.append(copy);
	if (rows.length === 0) {
		const empty = createEl("p");
		empty.className = "cpo-agg-empty";
		empty.textContent = AGGREGATE_EMPTY_TEXT;
		host.append(empty);
		return;
	}
	const list = createEl("ol");
	list.className = "cpo-agg-list";
	for (const row of rows) paintAggregateCard(list, row, noun, onPick, onActions);
	host.append(list);
}
