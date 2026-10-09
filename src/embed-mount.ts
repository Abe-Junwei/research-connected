import { isChinese, tr } from "./i18n";
import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks, type RankedWork } from "./aggregates";
import { CrossrefClient, crossrefAbstract, semanticAbstract, SemanticScholarClient, OpenCitationsClient, doisFromOpenCitation, doiFromPaper, type PostJson } from "./citation-sources";
import { mergeOpenCitation } from "./citation-evidence";
import { edgeSourcesText, paintAbstractCard, paintAggregateCard, paintJumpStrip, paintMetadataCard, paintMeter, paintPaperWorkflowState, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { EMBED_HEIGHT_LIMIT, EMBED_WIDTH_LIMIT, parseEmbed, type EmbedSpec } from "./embed-syntax";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, visibleNodes, type GraphFilter } from "./graph-filter";
import { createChromeIcon, mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { mountGraphSurface, placeNodeMenu } from "./graph-surface";
import { EXPAND_CAP, graftNodes, omitNode, refreshDerived } from "./graph-edit";
import { beginDeepDive, diagnoseCandidate, endDeepDive, expandAround, loadNeighborhood, type LoadStage, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { reconstructAbstract, referenceIds, shortId, toPaper } from "./paper";
import { findEdge } from "./relation";
import { paintPaperActions } from "./paper-actions";
import type { ConnectedPapersSettings } from "./settings-model";
import { restoreGraphSnapshot, saveGraphSnapshot, updateProjectPaperState, type DeepDiveBatch, type ResearchProject } from "./project-state";
import { buildSimilarity } from "./similarity";
import type { GraphEdge, PaperNode } from "./types";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode } from "./responsive";

export interface EmbedDeps {
	source: string;
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: PostJson;
	openExternal: (url: string) => void;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	createNote?: (filename: string, markdown: string) => Promise<void>;
	/** Open the full graph pane on this seed, when the host supports it. */
	openGraph?: (target: { kind: "doi" | "openalex"; value: string }) => void;
}

const STAGE_TEXT: Record<LoadStage, string> = {
	resolving: tr("正在解析种子论文…", "Resolving the seed paper…"),
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
	const shell = document.createElement("div");
	shell.className = "cpo-embed";
	shell.lang = isChinese() ? "zh-CN" : "en";
	root.append(shell);

	const bar = document.createElement("header");
	bar.className = "cpo-bar";
	const topLine = document.createElement("div");
	topLine.className = "cpo-topline";
	const brand = document.createElement("div");
	brand.className = "cpo-brand";
	const brandMark = document.createElement("span");
	brandMark.className = "cpo-brand-mark";
	brandMark.textContent = "R";
	const brandName = document.createElement("strong");
	brandName.textContent = "Research Connected";
	brand.append(brandMark, brandName);
	const status = document.createElement("p");
	status.className = "cpo-status";
	status.setAttribute("role", "status");

	topLine.append(brand, status);
	bar.append(topLine);
	shell.append(bar);

	const body = document.createElement("div");
	body.className = "cpo-body is-rail-collapsed";
	if (parsed.ok) body.style.height = `${parsed.spec.height}px`;
	shell.append(body);

	const rail = document.createElement("aside");
	rail.className = "cpo-rail";
	const layoutHost = document.createElement("div");
	layoutHost.className = "cpo-rail-layouts";
	const scrubHost = document.createElement("div");
	scrubHost.className = "cpo-rail-scrub";
	const railToggle = document.createElement("button");
	railToggle.type = "button";
	railToggle.className = "cpo-panel-toggle is-left";
	railToggle.textContent = "›";
	railToggle.setAttribute("aria-label", tr("展开左侧栏", "Expand left sidebar"));
	railToggle.setAttribute("aria-expanded", "false");
	rail.append(layoutHost, scrubHost, railToggle);

	body.append(rail);
	const surface = mountGraphSurface(body, { canvasLabel: tr("论文相似度图谱", "Paper similarity graph"), title: "", hint: "" });
	const { stage, canvas, empty: message, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, readingActions, zoom, zoomIn, zoomOut, fit: zoomFit, reload } = surface;
	const openGraphAction = document.createElement("button");
	openGraphAction.type = "button";
	openGraphAction.className = "cpo-ghost cpo-open-graph";
	openGraphAction.append(createChromeIcon("external"), document.createTextNode(tr("在图谱中打开", "Open in graph")));
	topLine.append(openGraphAction);
	for (const button of [openGraphAction]) {
		button.hidden = true;
	}
	const sidebarResize = document.createElement("div");
	sidebarResize.className = "cpo-sidebar-resizer";
	const sidebar = document.createElement("aside");
	sidebar.className = "cpo-evidence-sidebar";
	const sidebarToggle = document.createElement("button");
	sidebarToggle.type = "button";
	sidebarToggle.className = "cpo-panel-toggle is-right";
	sidebarToggle.textContent = "›";
	sidebarToggle.setAttribute("aria-label", tr("折叠右侧栏", "Collapse right sidebar"));
	sidebarToggle.setAttribute("aria-expanded", "true");
	sidebar.append(sidebarToggle);
	body.append(sidebarResize, sidebar);
	const evidenceHeader = document.createElement("header");
	evidenceHeader.className = "cpo-evidence-header";
	const evidenceTitle = document.createElement("h2");
	evidenceTitle.textContent = tr("论文详情与关联依据", "Paper details & evidence");
	const evidenceTools = document.createElement("div");
	evidenceTools.className = "cpo-evidence-tools";
	evidenceTools.setAttribute("role", "toolbar");
	evidenceTools.setAttribute("aria-label", tr("论文操作", "Paper actions"));
	const diagnoseButton = document.createElement("button");
	diagnoseButton.type = "button";
	diagnoseButton.className = "cpo-diagnose";
	diagnoseButton.append(createChromeIcon("diagnose"), document.createTextNode(tr("诊断候选", "Inspect")));
	diagnoseButton.setAttribute("aria-label", tr("诊断候选", "Inspect candidate"));
	diagnoseButton.disabled = true;
	evidenceTools.append(diagnoseButton);
	evidenceHeader.append(evidenceTitle, evidenceTools);
	sidebar.append(evidenceHeader);
	const sheetHost = document.createElement("section");
	sidebar.append(sheetHost);
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = document.createElement("div");
	detail.className = "cpo-detail";
	const listPanel = document.createElement("div");
	listPanel.className = "cpo-agg";
	listPanel.hidden = true;
	sheet.body.append(detail, listPanel);
	const actionsBar = document.createElement("div");
	actionsBar.className = "cpo-actions-bar";
	sidebar.append(actionsBar);

	if (!parsed.ok) {
		shell.classList.add("is-error");
		status.textContent = tr("代码块还不能建图", "This code block cannot build a graph yet");
		messageText.textContent = parsed.error;
		reload.hidden = true;
		rail.hidden = true;
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
	canvas.classList.add("cpo-embed-canvas");
	const stateKey = cacheKey(spec.target, spec.maxNodes ?? deps.getSettings().maxNodes, spec.depth, deps.getSettings());
	const saved = viewStates.get(stateKey);
	let viewFilter = saved?.filter ?? filterFromSpec(spec);
	openGraphAction.hidden = !deps.openGraph;
	openGraphAction.onclick = deps.openGraph ? () => deps.openGraph?.(spec.target) : null;
	const map = new SimilarityMap(canvas, tooltip, stage, { wheel: "modifier" });
	const afterPanelToggle = (): void => {
		map.resize();
		window.setTimeout(() => map.resize(), 240);
	};
	railToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-rail-collapsed");
		railToggle.textContent = on ? "›" : "‹";
		railToggle.setAttribute("aria-expanded", on ? "false" : "true");
		railToggle.setAttribute("aria-label", on ? tr("展开左侧栏", "Expand left sidebar") : tr("折叠左侧栏", "Collapse left sidebar"));
		afterPanelToggle();
	});
	sidebarToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-sidebar-collapsed");
		sidebarToggle.textContent = on ? "‹" : "›";
		sidebarToggle.setAttribute("aria-expanded", on ? "false" : "true");
		sidebarToggle.setAttribute("aria-label", on ? tr("展开右侧栏", "Expand right sidebar") : tr("折叠右侧栏", "Collapse right sidebar"));
		afterPanelToggle();
	});
	const applyFilter = (): void => {
		map.setKinds(viewFilter.kinds);
		map.setScrubYear(viewFilter.scrubYear);
	};
	let layoutMode: LayoutMode = saved?.layout ?? spec.layout;
	const graphKey = mountGraphKey(rail, () => viewFilter, (next) => {
		viewFilter = next;
		applyFilter();
		paintLists();
	});
	graphKey.paintColor(layoutMode);
	let tab: GraphTab = "graph";
	let currentGraph: SimilarityGraph | null = null;
	let sourceGraph: SimilarityGraph | null = null;
	let lastDepthNote = "";
	let expanding = false;
	seedItem.textContent = tr("在图谱中设为种子", "Set as seed in graph");
	seedItem.hidden = !deps.openGraph;
	let selected: PaperNode | null = null;
	let selectedLink: GraphEdge | null = null;
	let chrome: GraphChrome | null = null;
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !currentGraph) {
			nodeMenu.hidden = true;
			return;
		}
		const seedId = currentGraph.nodes.find((node) => node.isSeed)?.id;
		const reading = seedId ? deps.getSettings().researchProjects[seedId]?.paperStates?.[paper.id]?.reading ?? "unread" : "unread";
		for (const [value, button] of readingActions) button.hidden = value === reading;
		deleteItem.disabled = paper.isSeed || !deps.stagePaper;
		deleteItem.title = paper.isSeed ? tr("种子论文不能排除", "The seed paper cannot be excluded") : tr("从当前项目排除", "Exclude from this project");
		expandItem.disabled = expanding || !deps.stagePaper;
		seedItem.disabled = paper.isSeed;
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		placeNodeMenu(stage, nodeMenu, x, y);
	};
	deleteItem.addEventListener("click", async () => {
		const paper = currentGraph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		const seedId = currentGraph?.nodes.find((node) => node.isSeed)?.id;
		if (!paper || paper.isSeed || !seedId || !deps.stagePaper) return;
		const projects = deps.getSettings().researchProjects;
		const previous = projects[seedId]?.paperStates?.[paper.id]?.excluded ?? false;
		const source = projects[seedId]?.paperStates?.[paper.id]?.source ?? "OpenAlex";
		updateProjectPaperState(projects, seedId, paper, { excluded: true });
		deleteItem.disabled = true;
		try {
			await deps.stagePaper(paper, seedId, source);
			nodeMenu.hidden = true;
			if (sourceGraph) renderGraph(sourceGraph, lastDepthNote);
			status.textContent = tr(`已排除「${paper.title}」`, `Excluded “${paper.title}”`);
		} catch {
			updateProjectPaperState(projects, seedId, paper, { excluded: previous });
			status.textContent = tr("排除状态保存失败，请重试", "Could not save exclusion state. Try again.");
			deleteItem.disabled = false;
		}
	});
	seedItem.addEventListener("click", () => {
		const paper = currentGraph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper && !paper.isSeed) deps.openGraph?.({ kind: "openalex", value: paper.id });
		nodeMenu.hidden = true;
	});
	expandItem.addEventListener("click", async () => {
		const host = currentGraph;
		const paper = host?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		const seedId = host?.nodes.find((node) => node.isSeed)?.id;
		if (!host || !paper || !seedId || expanding || !deps.stagePaper) return;
		const settings = deps.getSettings();
		const projects = settings.researchProjects;
		const prior = projects[seedId];
		const savedGraph = restoreGraphSnapshot(prior?.snapshot);
		if (prior?.snapshot && (!savedGraph || !savedGraph.nodes.some((node) => node.isSeed && node.id === seedId))) {
			nodeMenu.hidden = true;
			status.textContent = tr("研究项目快照无法读取，请先在图谱页处理", "Cannot read the project snapshot. Open the graph view first.");
			return;
		}
		const base = savedGraph?.nodes.some((node) => node.isSeed && node.id === seedId) ? savedGraph : host;
		const slots = Math.min(EXPAND_CAP, (spec.maxNodes ?? settings.maxNodes) - host.nodes.length, settings.maxNodes - base.nodes.length);
		nodeMenu.hidden = true;
		if (slots <= 0) {
			status.textContent = tr("已到节点上限，请在图谱页移除论文后继续深挖", "Node limit reached. Remove a paper in the graph view before continuing the deep dive.");
			return;
		}
		if (!beginDeepDive(seedId)) {
			status.textContent = tr("这张图已有一轮深挖在进行，请稍后重试", "A deep dive is already running for this graph. Try again later.");
			return;
		}
		const token = generation;
		expanding = true;
		expandItem.disabled = true;
		status.textContent = tr(`正在从「${paper.title.slice(0, 24)}」扩展…`, `Expanding from “${paper.title.slice(0, 24)}”…`);
		try {
			const hidden = new Set([...host.excludedIds ?? [], ...Object.entries(prior?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id)]);
			const oa = clientFor(deps, settings);
			const result = await expandAround(oa, host, paper, hidden, settings, slots);
			if (!alive || token !== generation || currentGraph !== host) return;
			const latest = projects[seedId];
			const latestSaved = restoreGraphSnapshot(latest?.snapshot);
			if (latest?.snapshot && (!latestSaved || !latestSaved.nodes.some((node) => node.isSeed && node.id === seedId))) throw new Error(tr("研究项目快照已变化，请重试深挖", "Project snapshot changed. Try the deep dive again."));
			const latestBase = latestSaved?.nodes.some((node) => node.isSeed && node.id === seedId) ? latestSaved : host;
			const newToProject = result.papers.filter((item) => !latestBase.nodes.some((node) => node.id === item.id));
			if (latestBase.nodes.length + newToProject.length > settings.maxNodes) throw new Error(tr("项目节点上限已变化，请重试深挖", "Project node limit changed. Try the deep dive again."));
			const updated = result.papers.length ? refreshDerived(graftNodes(host, result.papers, result.lists)) : host;
			const full = latestBase === host ? updated : refreshDerived(graftNodes(latestBase, result.papers, result.lists));
			const batch: DeepDiveBatch = {
				id: `${Date.now()}`, parentId: paper.id, createdAt: Date.now(),
				references: result.references, citations: result.citations,
				additions: result.papers.map((item) => ({ paperId: item.id, source: item.origin === "reference" ? "reference" : item.origin === "citation" ? "citation" : "shared-reference" })),
				noMore: result.noMore, warnings: result.warnings,
			};
			const project: ResearchProject = {
				version: 1, seedId, name: latest?.name ?? host.nodes.find((node) => node.isSeed)?.title ?? seedId,
				updatedAt: Date.now(), snapshot: saveGraphSnapshot(full),
				views: latest?.views ?? [], currentView: latest?.currentView,
				paperStates: latest?.paperStates ?? {}, deepDives: [...(latest?.deepDives ?? []), batch].slice(-100),
			};
			projects[seedId] = project;
			try { await deps.stagePaper(paper, seedId, "OpenAlex"); }
			catch (error) {
				if (latest) projects[seedId] = latest;
				else delete projects[seedId];
				throw error;
			}
			if (!alive || token !== generation || currentGraph !== host) return;
			if (result.papers.length) {
				remember(stateKey, updated);
				renderGraph(updated, lastDepthNote);
				if (currentGraph) showDetail(paper, currentGraph, null);
			}
			status.textContent = result.warnings.length ? result.warnings.join(tr("；", "; ")) : result.papers.length ? tr(`已并入 ${result.papers.length} 篇 · 当前 ${updated.nodes.length} 篇`, `Added ${result.papers.length} papers · ${updated.nodes.length} total`) : result.noMore ? tr("已读完当前可访问候选，没有更多文献", "All accessible candidates have been read; no more papers are available") : tr("本轮没有新增文献，可继续深挖", "No papers added in this round; you can continue the deep dive");
		} catch (error) {
			if (alive && token === generation) status.textContent = error instanceof Error ? error.message : tr("深挖失败", "Deep dive failed");
		} finally {
			endDeepDive(seedId);
			expanding = false;
			expandItem.disabled = false;
		}
	});
	for (const [reading, button] of readingActions) button.addEventListener("click", async () => {
		const paper = currentGraph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		const seedId = currentGraph?.nodes.find((node) => node.isSeed)?.id;
		if (!paper || !seedId) return;
		const projects = deps.getSettings().researchProjects;
		const previous = projects[seedId]?.paperStates?.[paper.id]?.reading ?? "unread";
		const source = projects[seedId]?.paperStates?.[paper.id]?.source ?? "OpenAlex";
		updateProjectPaperState(projects, seedId, paper, { reading });
		button.disabled = true;
		try {
			await deps.stagePaper?.(paper, seedId, source);
			nodeMenu.hidden = true;
			if (currentGraph) showDetail(paper, currentGraph, null);
		} catch {
			updateProjectPaperState(projects, seedId, paper, { reading: previous });
			status.textContent = tr("阅读状态保存失败，请重试", "Could not save reading status. Try again.");
		} finally {
			button.disabled = false;
		}
	});
	stage.addEventListener("pointerdown", (event) => {
		if (!nodeMenu.contains(event.target as Node)) nodeMenu.hidden = true;
	});

	const paintLists = (): void => {
		detail.hidden = tab !== "graph";
		if (!currentGraph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(visibleNodes(currentGraph.nodes, viewFilter).map((node) => node.id));
		const seed = currentGraph.nodes.find((node) => node.isSeed);
		const rows = (tab === "prior" ? priorWorks(currentGraph, visible) : derivativeWorks(currentGraph, visible))
			.filter((row) => !seed || !deps.getSettings().researchProjects[seed.id]?.paperStates?.[row.paper.id]?.excluded);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? tr("被本图引用", "Cited by this graph") : tr("引用本图", "Cites this graph");
		fillAggregate(listPanel, definition, rows, noun, (paper) => {
			const inGraph = currentGraph?.nodes.some((node) => node.id === paper.id) ?? false;
			if (inGraph && currentGraph) showDetail(paper, currentGraph, null);
		}, (card, paper) => {
			if (!seed) return;
			const settings = deps.getSettings();
			const state = settings.researchProjects[seed.id]?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
			paintPaperWorkflowState(card, paper, state, async (reading, previous) => {
				updateProjectPaperState(settings.researchProjects, seed.id, paper, { reading });
				try { await deps.stagePaper?.(paper, seed.id, state.source); }
				catch (error) {
					updateProjectPaperState(settings.researchProjects, seed.id, paper, { reading: previous });
					throw error;
				}
			}, async () => {
				updateProjectPaperState(settings.researchProjects, seed.id, paper, { excluded: true });
				try {
					await deps.stagePaper?.(paper, seed.id, state.source);
					if (currentGraph?.nodes.some((node) => node.id === paper.id) && sourceGraph) renderGraph(sourceGraph, lastDepthNote);
					else paintLists();
				} catch {
					updateProjectPaperState(settings.researchProjects, seed.id, paper, { excluded: false });
					card.querySelector<HTMLElement>(".cpo-paper-action-error")?.remove();
					const error = document.createElement("span");
					error.className = "cpo-paper-action-error";
					error.setAttribute("role", "status");
					error.textContent = tr("保存失败，请重试", "Could not save. Try again.");
					card.append(error);
				}
			});
			paintPaperActions(card, paper, seed.id, null, null, {
				getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
				setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
				persist: deps.stagePaper ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
				openExternal: deps.openExternal,
			});
		});
	};

	chrome = mountGraphChrome(layoutHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: layoutMode,
		noteButton: Boolean(deps.createNote),
		actionsHost: actionsBar,
		layoutHost,
		scrubHost,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(layoutMode);
			map.setColorMode(defaultColorMode(layoutMode));
			graphKey.paintColor(layoutMode);
		},
		onScrub: (year) => {
			viewFilter = { ...viewFilter, scrubYear: year };
			applyFilter();
			paintLists();
		},
		onTab: (next) => {
			tab = next;
			listPanel.hidden = next === "graph";
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
		},
		onExport: (kind) => {
			void exportView(kind);
		},
	});
	const exportView = async (kind: ExportKind): Promise<void> => {
		if (!currentGraph) return;
		if (kind === "note") {
			const paper = selected ?? currentGraph.nodes.find((node) => node.isSeed) ?? null;
			if (!paper) return;
			const markdown = noteSkeleton(paper);
			if (deps.createNote) {
				try {
					await deps.createNote(noteFilename(paper), markdown);
					chrome?.setExportText(tr(`已写入笔记：${noteFilename(paper)}`, `Written to note: ${noteFilename(paper)}`));
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : tr("笔记没有写成。", "Could not write the note."));
				}
				return;
			}
			await chrome?.copyText(markdown, tr("笔记内容", "Note contents"));
			return;
		}
		const nodes = orderedForExport(visibleNodes(currentGraph.nodes, viewFilter));
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		await chrome?.copyText(text, kind === "bibtex" ? "BibTeX" : kind === "yaml" ? "YAML" : tr("表格", "Table"));
	};

	const anchor = placementAnchor(root);
	const clearPlacement = applyPlacement(root, anchor, spec);
	const stopResize = mountResizeHandle(body, anchor, () => map.resize());
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, {
		defaultWidth: 260,
		onResize: () => map.resize(),
	});
	const narrowObserver = observeResponsiveMode(shell, () => {
		if (shell.classList.contains("is-narrow")) sidebar.style.width = "100%";
		else sidebar.style.removeProperty("width");
		map.resize();
	});
	zoomIn.addEventListener("click", () => map.zoomBy(1.2));
	zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
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
	/** Abstract fallback: which source filled an abstract, or which DOI has no known abstract. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractFromCrossref = new Set<string>();
	const abstractMissing = new Set<string>();

	const embedAbstractText = (paper: PaperNode): string => {
		if (paper.abstract) {
			const source = abstractFromS2.has(paper.id) ? "Semantic Scholar" : abstractFromCrossref.has(paper.id) ? "Crossref" : "";
			return paper.abstract + (source ? tr(`（摘要来源：${source}）`, ` (abstract source: ${source})`) : "");
		}
		if (abstractMissing.has(paper.id)) return tr("OpenAlex、Semantic Scholar 和 Crossref 都没有这篇的摘要。", "No abstract is available from OpenAlex, Semantic Scholar, or Crossref.");
		return tr("OpenAlex 没有摘要，正在查询 Semantic Scholar / Crossref…", "No OpenAlex abstract; checking Semantic Scholar and Crossref…");
	};

	const placeDetailPlaceholder = (): void => {
		selected = null;
		selectedLink = null;
		detail.replaceChildren();
		const empty = document.createElement("p");
		empty.className = "cpo-side-tip";
		empty.textContent = tr("点选节点查看题名、年份、作者和证据。", "Select a node to view its title, year, authors, and evidence.");
		detail.append(empty);
		sheet.setSummary(tr("点选节点查看论文", "Select a node to view its paper"), "");
	};
	placeDetailPlaceholder();

	const showDetail = (paper: PaperNode | null, graph: SimilarityGraph, link: GraphEdge | null): void => {
		if (!paper) {
			placeDetailPlaceholder();
			return;
		}
		selected = paper;
		selectedLink = link;
		detail.replaceChildren();
		paintMetadataCard(detail, paper, graph.crossCheck?.get(paper.id));
		const seed = graph.nodes.find((node) => node.isSeed) ?? null;
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		const seedId = seed?.id ?? paper.id;
		const project = deps.getSettings().researchProjects[seedId];
		const paperState = project?.paperStates?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: Date.now() };
		paintPaperWorkflowState(detail, paper, paperState, async (reading, previous) => {
			updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading });
			try { await deps.stagePaper?.(paper, seedId, paperState.source); }
			catch (error) {
				updateProjectPaperState(deps.getSettings().researchProjects, seedId, paper, { reading: previous });
				throw error;
			}
		});
		const getEvidence = (citingId: string, citedId: string) => graph.citationEvidence?.get(citingId, citedId) ?? null;
		const stageEdge = seed && !paper.isSeed ? findEdge(graph.edges, paper.id, seed.id) : null;
		const stageEvidence = seed && !paper.isSeed ? getEvidence(paper.id, seed.id) ?? getEvidence(seed.id, paper.id) : null;
		paintPaperActions(detail, paper, seed?.id ?? null, stageEdge, stageEvidence, {
			getPaperState: (projectId, paperId) => deps.getSettings().researchProjects[projectId]?.paperStates?.[paperId],
			setStaged: (target, projectId, staged, source) => { updateProjectPaperState(deps.getSettings().researchProjects, projectId, target, { staged, source }); },
			persist: deps.stagePaper && seed ? (source) => deps.stagePaper!(paper, seed.id, source) : undefined,
			openExternal: deps.openExternal,
		});
		if (!paper.isSeed && seed) {
			const toSeed = findEdge(graph.edges, paper.id, seed.id);
			if (toSeed) {
				const from = byId.get(toSeed.source);
				const to = byId.get(toSeed.target);
				if (from && to) {
					paintRelationSection(detail, toSeed, from, to, {
						sources: edgeSourcesText(toSeed, getEvidence),
						getEvidence,
						seedScore: graph.seedScore.get(paper.id),
						semanticScore: graph.semanticScores?.get(paper.id),
						semanticHint: semanticHintFor(graph.semanticMode),
					});
				}
			} else {
				const score = graph.seedScore.get(paper.id);
				const card = document.createElement("section");
				card.className = "cpo-card";
				if (score !== undefined) paintMeter(card, tr("图谱综合相似度", "Overall graph similarity"), score, tr("结构 + 语义信号", "Structure and semantic signals"));
				const semantic = graph.semanticScores?.get(paper.id);
				if (semantic !== undefined) paintMeter(card, tr("文本相似度", "Text similarity"), semantic, semanticHintFor(graph.semanticMode), true);
				const note = document.createElement("p");
				note.className = "cpo-fact-note";
				note.textContent = score === undefined ? tr("与种子没有直接连线", "No direct link to the seed") : tr(`与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`, `No direct citation to the seed recorded · ${SIMILARITY_NOT_CITATION}`);
				card.append(note);
				detail.append(card);
			}
			const rankInfo = graph.selectionRank?.get(paper.id);
			if (rankInfo) paintSelectionReasons(detail, rankInfo, graph.seedScore.get(paper.id));
			paintJumpStrip(detail, seed, (target) => {
				if (currentGraph) showDetail(target, currentGraph, null);
			});
		}
		if (link && seed && !samePair(link, paper.id, seed.id)) {
			const from = byId.get(link.source);
			const to = byId.get(link.target);
			if (from && to) {
				paintRelationSection(detail, link, from, to, { sources: edgeSourcesText(link, getEvidence), getEvidence });
			}
		}
		if (!paper.abstract && !abstractMissing.has(paper.id) && !abstractRequested.has(paper.id)) {
			abstractRequested.add(paper.id);
			const token = generation;
			void (async () => {
				const s2Text = await semanticAbstract(deps.getJson, deps.getSettings().semanticScholarApiKey, paper);
				if (s2Text) return { text: s2Text, source: "s2" as const };
				const crossrefText = await crossrefAbstract(deps.getJson, deps.getSettings().contactEmail, paper);
				return crossrefText ? { text: crossrefText, source: "crossref" as const } : null;
			})().then((result) => {
				if (!alive || token !== generation) return;
				if (result) {
					paper.abstract = result.text;
					if (result.source === "s2") abstractFromS2.add(paper.id);
					else abstractFromCrossref.add(paper.id);
				} else {
					abstractMissing.add(paper.id);
				}
				if (selected === paper && currentGraph) showDetail(paper, currentGraph, null);
			});
		}
		paintAbstractCard(detail, paper, embedAbstractText);
	};

	diagnoseButton.addEventListener("click", () => {
		if (!currentGraph) return;
		const returnPaper = selected;
		const returnLink = selectedLink;
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
		detail.replaceChildren();
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary(tr("候选诊断", "Candidate inspection"), tr("当前图谱的采样记录", "Sampling records for the current graph"));
		const back = document.createElement("button");
		back.type = "button";
		back.className = "cpo-diagnose-back";
		back.textContent = tr("‹ 返回论文", "‹ Back to paper");
		back.disabled = !returnPaper;
		back.onclick = () => currentGraph && showDetail(returnPaper, currentGraph, returnLink);
		detail.append(back);
		const form = document.createElement("form");
		form.className = "cpo-diagnose-form";
		const query = document.createElement("input");
		query.placeholder = tr("DOI 或 OpenAlex ID", "DOI or OpenAlex ID");
		query.setAttribute("aria-label", tr("要诊断的论文", "Paper to inspect"));
		const submit = document.createElement("button");
		submit.type = "submit";
		submit.className = "cpo-primary";
		submit.textContent = tr("查询", "Search");
		form.append(query, submit);
		const result = document.createElement("div");
		result.className = "cpo-diagnose-result";
		detail.append(form, result);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (!currentGraph) return;
			const finding = diagnoseCandidate(currentGraph, query.value, new Set(), viewFilter.scrubYear);
			result.replaceChildren();
			const title = document.createElement("strong");
			title.textContent = finding.title;
			const text = document.createElement("p");
			text.className = "cpo-side-tip";
			text.textContent = finding.detail;
			result.append(title, text);
			const paper = finding.paperId && currentGraph.nodes.find((item) => item.id === finding.paperId);
			if (paper) {
				const open = document.createElement("button");
				open.type = "button";
				open.className = "cpo-text-btn";
				open.textContent = tr("查看论文", "View paper");
				open.onclick = () => { if (currentGraph) showDetail(paper, currentGraph, null); };
				result.append(open);
			}
		});
		query.focus();
	});

	const snapshotView = (): void => {
		rememberViewState(stateKey, { filter: viewFilter, layout: layoutMode });
	};

	map.onSelect = (paper) => {
		if (paper && currentGraph) showDetail(paper, currentGraph, null);
		else placeDetailPlaceholder();
	};
	map.onEdgeSelect = (edge) => {
		if (!currentGraph || !edge) {
			placeDetailPlaceholder();
			return;
		}
		const from = currentGraph.nodes.find((node) => node.id === edge.source);
		showDetail(from ?? currentGraph.nodes.find((node) => node.id === edge.target) ?? null, currentGraph, edge);
	};

	const renderGraph = (graph: SimilarityGraph, depthNote: string): void => {
		snapshotView();
		message.hidden = true;
		sourceGraph = graph;
		lastDepthNote = depthNote;
		const seedId = graph.nodes.find((node) => node.isSeed)?.id;
		const excluded = seedId ? Object.entries(deps.getSettings().researchProjects[seedId]?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id) : [];
		for (const id of excluded) graph = omitNode(graph, id) ?? graph;
		graph.excludedIds = excluded;
		currentGraph = graph;
		diagnoseButton.disabled = false;
		map.setGraph(graph.nodes, graph.edges, graph.seedScore);
		graphKey.setStats(graph.nodes, graph.edges);
		graphKey.paintColor(layoutMode);
		map.setLayout(layoutMode);
		map.setColorMode(layoutMode === spec.layout ? spec.color : defaultColorMode(layoutMode));
		applyFilter();
		const span = yearSpan(graph.nodes);
		if (span) chrome?.setYears(...span);
		else chrome?.clearYears();
		paintLists();
		const seed = graph.nodes.find((node) => node.isSeed);
		status.textContent = tr(`${[seed?.title, seed?.authors, seed?.year].filter(Boolean).join(" · ") || tr("图谱", "Graph")} · ${graph.nodes.length} 篇${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · 滤除书评等 ${graph.skippedNonResearch} 条` : ""
		}`, `${[seed?.title, seed?.authors, seed?.year].filter(Boolean).join(" · ") || tr("图谱", "Graph")} · ${graph.nodes.length} papers${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · filtered ${graph.skippedNonResearch} reviews and other non-research records` : ""
		}`);
		if (seed) showDetail(seed, graph, null);
	};

	/** OpenCitations pass: verify and add citation links between visible nodes, then re-render if edges changed. */
	const enrichOpenCitations = async (graph: SimilarityGraph, depthNote: string): Promise<void> => {
		const token = generation;
		const doiToId = new Map<string, string>();
		for (const paper of graph.nodes) {
			const doi = doiFromPaper(paper)?.toLowerCase();
			if (doi) doiToId.set(doi, paper.id);
		}
		if (doiToId.size === 0) return;
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		const papers = graph.nodes.filter((paper) => doiFromPaper(paper)).slice(0, 10);
		const edgesBefore = graph.edges.length;
		for (const paper of papers) {
			if (!alive || token !== generation || currentGraph !== graph) return;
			try {
				const rows = await client.references(doiFromPaper(paper)!);
				if (!alive || token !== generation || currentGraph !== graph) return;
				for (const row of rows) {
					const ids = doisFromOpenCitation(row);
					const citing = ids.citing.map((doi) => doiToId.get(doi)).find(Boolean);
					const cited = ids.cited.map((doi) => doiToId.get(doi)).find(Boolean);
					if (citing && cited) mergeOpenCitation(graph, citing, cited);
				}
			} catch {
				// A failed lookup skips that paper; the map is already complete without it.
			}
		}
		if (!alive || token !== generation || currentGraph !== graph) return;
		const added = graph.edges.length - edgesBefore;
		if (added > 0) {
			map.updateGraphData(graph.edges);
			graphKey.setStats(graph.nodes, graph.edges);
		}
	};

	const load = async (bypassCache: boolean): Promise<void> => {
		const token = ++generation;
		placeDetailPlaceholder();
		tooltip.hidden = true;
		message.hidden = false;
		messageText.textContent = STAGE_TEXT.resolving;
		status.textContent = STAGE_TEXT.resolving;
		reload.disabled = true;
		const settings = { ...deps.getSettings() };
		const cap = spec.maxNodes ?? settings.maxNodes;
		const key = cacheKey(spec.target, cap, spec.depth, settings);
		try {
			let graph = bypassCache ? undefined : cache.get(key);
			let depthNote = "";
			if (!graph) {
				const firstCap = spec.depth === 2 ? Math.min(cap, Math.max(15, cap - 10)) : cap;
				graph = await loadNeighborhood(
					clientFor(deps, settings),
					spec.target,
					{ ...settings, maxNodes: firstCap },
					(stage) => {
						if (token === generation) {
							messageText.textContent = STAGE_TEXT[stage];
							status.textContent = STAGE_TEXT[stage];
						}
					},
					reconcileFor(deps, settings),
					new CrossrefClient(deps.getJson, settings.contactEmail),
				);
				if (spec.depth === 2) {
					const expanded = await expandDepth(clientFor(deps, settings), graph, cap);
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
			status.textContent = tr("图谱没有建起来", "The graph could not be built");
		} finally {
			if (token === generation) reload.disabled = false;
		}
	};

	reload.addEventListener("click", () => {
		const settings = { ...deps.getSettings() };
		cache.delete(cacheKey(spec.target, spec.maxNodes ?? settings.maxNodes, spec.depth, settings));
		void load(true);
	});
	void load(false);

	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);
	const onProject = (): void => {
		if (!sourceGraph || !currentGraph) return;
		const seedId = sourceGraph.nodes.find((node) => node.isSeed)?.id;
		const excluded = seedId ? Object.entries(deps.getSettings().researchProjects[seedId]?.paperStates ?? {}).filter(([, state]) => state.excluded).map(([id]) => id) : [];
		if (excluded.join("\0") !== (currentGraph.excludedIds ?? []).join("\0")) renderGraph(sourceGraph, lastDepthNote);
	};
	window.addEventListener("research-connected-project", onProject);

	return () => {
		alive = false;
		generation += 1;
		snapshotView();
		window.removeEventListener("research-connected-theme", onTheme);
		window.removeEventListener("research-connected-project", onProject);
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
	if (anchor !== root) root.style.width = "100%";
	return () => {
		anchor.classList.remove(...PLACEMENT_CLASSES);
		anchor.style.width = previousWidth;
		anchor.style.maxWidth = previousMaxWidth;
		if (anchor !== root) root.style.width = "";
	};
}

function mountResizeHandle(graphArea: HTMLElement, anchor: HTMLElement, onResize: () => void): () => void {
	const grip = document.createElement("div");
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
		anchor.style.maxWidth = "none";
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

function samePair(edge: GraphEdge, a: string, b: string): boolean {
	return (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);
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

async function expandDepth(
	client: OpenAlexClient,
	graph: SimilarityGraph,
	cap: number,
): Promise<{ graph: SimilarityGraph; note: string }> {
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) return { graph, note: "" };
	const hubs = graph.nodes
		.filter((node) => !node.isSeed)
		.sort((a, b) => (graph.seedScore.get(b.id) ?? 0) - (graph.seedScore.get(a.id) ?? 0))
		.slice(0, 2);
	const seen = new Set(graph.nodes.map((node) => node.id));
	const extra: PaperNode[] = [];
	const room = cap - graph.nodes.length;
	if (room <= 0 || hubs.length === 0) return { graph, note: tr("已到节点上限", "Node limit reached") };
	let failed = false;
	for (const hub of hubs) {
		try {
			const works = await client.referencedBySeed(hub.id, 12);
			for (const raw of works) {
				const paper = toPaper(raw, "reference");
				if (!paper || seen.has(paper.id)) continue;
				seen.add(paper.id);
				extra.push(paper);
				if (extra.length >= room) break;
			}
		} catch {
			failed = true;
		}
		if (extra.length >= room) break;
	}
	if (extra.length === 0) {
		return { graph, note: failed ? tr("第二层没有读到", "The second layer could not be loaded") : "" };
	}
	const nodes = [...graph.nodes, ...extra];
	try {
		const detailed = await client.worksByIds(nodes.map((node) => node.id));
		const refLists = new Map<string, Set<string>>();
		for (const raw of detailed) {
			const id = shortId(raw.id ?? "");
			if (!id) continue;
			refLists.set(id, new Set(referenceIds(raw.referenced_works)));
			const paper = nodes.find((item) => item.id === id);
			const abstract = reconstructAbstract(raw.abstract_inverted_index);
			if (paper && abstract) paper.abstract = abstract;
		}
		for (const node of nodes) {
			if (!refLists.has(node.id)) refLists.set(node.id, new Set());
		}
		const contexts = nodes
			.filter((node) => node.origin === "citation")
			.map((node) => refLists.get(node.id))
			.filter((list): list is Set<string> => Boolean(list && list.size > 0));
		const scored = buildSimilarity({
			ids: nodes.map((node) => node.id),
			seedId: seed.id,
			references: refLists,
			contexts,
		});
		const referenceLists = new Map(graph.referenceLists);
		for (const [id, ids] of refLists) referenceLists.set(id, [...ids]);
		const catalog = new Map(graph.catalog.map((paper) => [paper.id, paper]));
		for (const paper of nodes) catalog.set(paper.id, paper);
		return {
			graph: {
				...graph,
				nodes,
				edges: scored.edges,
				seedScore: scored.seedScore,
				referenceLists,
				catalog: [...catalog.values()],
			},
			note: tr(`含第二层 ${extra.length} 篇`, `Includes ${extra.length} second-layer papers`),
		};
	} catch {
		return { graph, note: tr("第二层没有读到", "The second layer could not be loaded") };
	}
}

function cacheKey(
	target: { kind: string; value: string },
	maxNodes: number,
	depth: number,
	settings: ConnectedPapersSettings,
): string {
	return [
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
	].join("|");
}

function remember(key: string, graph: SimilarityGraph): void {
	if (cache.size >= 12) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(key, graph);
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
	const copy = document.createElement("p");
	copy.className = "cpo-agg-def";
	copy.textContent = definition;
	host.append(copy);
	if (rows.length === 0) {
		const empty = document.createElement("p");
		empty.className = "cpo-agg-empty";
		empty.textContent = AGGREGATE_EMPTY_TEXT;
		host.append(empty);
		return;
	}
	const list = document.createElement("ol");
	list.className = "cpo-agg-list";
	for (const row of rows) paintAggregateCard(list, row, noun, onPick, onActions);
	host.append(list);
}

function yearSpan(nodes: readonly PaperNode[]): [number, number] | null {
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	if (years.length === 0) return null;
	return [Math.min(...years), Math.max(...years)];
}

function addLink(parent: HTMLElement, label: string, onClick: () => void): void {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-link";
	button.textContent = label;
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	parent.append(button);
}
