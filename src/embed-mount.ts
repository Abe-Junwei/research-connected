import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks, type RankedWork } from "./aggregates";
import { CrossrefClient, crossrefAbstract, semanticAbstract, SemanticScholarClient, OpenCitationsClient, doisFromOpenCitation, doiFromPaper, type PostJson } from "./citation-sources";
import { mergeOpenCitation } from "./citation-evidence";
import { edgeSourcesText, paintAbstractCard, paintAggregateCard, paintJumpStrip, paintMetadataCard, paintMeter, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { EMBED_HEIGHT_LIMIT, EMBED_WIDTH_LIMIT, parseEmbed, type EmbedSpec } from "./embed-syntax";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, visibleNodes, type GraphFilter } from "./graph-filter";
import { mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import { diagnoseCandidate, loadNeighborhood, type LoadStage, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { reconstructAbstract, referenceIds, shortId, toPaper } from "./paper";
import { findEdge } from "./relation";
import { allowedExternalUrl } from "./safe-url";
import type { ConnectedPapersSettings } from "./settings-model";
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
	createNote?: (filename: string, markdown: string) => Promise<void>;
	/** Open the full graph pane on this seed, when the host supports it. */
	openGraph?: (target: { kind: "doi" | "openalex"; value: string }) => void;
}

const STAGE_TEXT: Record<LoadStage, string> = {
	resolving: "正在解析种子论文…",
	fetching: "正在读取参考文献、施引文献和相关作品…",
	scoring: "正在计算相似度…",
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
	const reload = document.createElement("button");
	reload.type = "button";
	reload.className = "cpo-ghost";
	reload.textContent = "重新加载";
	topLine.append(brand, reload);
	const status = document.createElement("p");
	status.className = "cpo-status";
	status.setAttribute("role", "status");

	topLine.append(status);
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
	railToggle.setAttribute("aria-label", "展开左侧栏");
	railToggle.setAttribute("aria-expanded", "false");
	rail.append(layoutHost, scrubHost, railToggle);

	const stage = document.createElement("div");
	stage.className = "cpo-stage";
	const message = document.createElement("div");
	message.className = "cpo-empty";
	const messageText = document.createElement("p");
	message.append(messageText);
	const tooltip = document.createElement("div");
	tooltip.className = "cpo-tooltip";
	tooltip.hidden = true;
	const zoom = document.createElement("div");
	zoom.className = "cpo-zoom";
	const zoomIn = iconButton("+", "放大");
	const zoomOut = iconButton("−", "缩小");
	const zoomFit = iconButton("适配", "适应窗口");
	zoom.append(zoomIn, zoomOut, zoomFit);
	const graphActions = document.createElement("div");
	graphActions.className = "cpo-graph-actions";
	const sourceActions = document.createElement("div");
	sourceActions.className = "cpo-source-actions cpo-detail-source-actions";
	const openAlexAction = document.createElement("button");
	openAlexAction.className = "cpo-action-link";
	openAlexAction.textContent = "OpenAlex ↗";
	const doiAction = document.createElement("button");
	doiAction.className = "cpo-action-link";
	doiAction.textContent = "DOI ↗";
	const openGraphAction = document.createElement("button");
	openGraphAction.className = "cpo-action-link";
	openGraphAction.textContent = "在图谱中打开";
	for (const button of [openAlexAction, doiAction, openGraphAction]) {
		button.type = "button";
		button.hidden = true;
	}
	sourceActions.append(openAlexAction, doiAction);
	const graphActionSpacer = document.createElement("span");
	graphActionSpacer.className = "cpo-graph-action-spacer";
	graphActions.append(graphActionSpacer, openGraphAction);
	stage.append(message, tooltip, graphActions, zoom);
	body.append(rail, stage);
	const sidebarResize = document.createElement("div");
	sidebarResize.className = "cpo-sidebar-resizer";
	const sidebar = document.createElement("aside");
	sidebar.className = "cpo-evidence-sidebar";
	const sidebarToggle = document.createElement("button");
	sidebarToggle.type = "button";
	sidebarToggle.className = "cpo-panel-toggle is-right";
	sidebarToggle.textContent = "›";
	sidebarToggle.setAttribute("aria-label", "折叠右侧栏");
	sidebarToggle.setAttribute("aria-expanded", "true");
	sidebar.append(sidebarToggle);
	body.append(sidebarResize, sidebar);
	const evidenceHeader = document.createElement("header");
	evidenceHeader.className = "cpo-evidence-header";
	const evidenceTitle = document.createElement("h2");
	evidenceTitle.textContent = "论文与关系证据";
	const evidenceHint = document.createElement("p");
	evidenceHint.textContent = "点选节点查看来源、关系与摘要；拖动左侧边缘调整宽度。";
	evidenceHeader.append(evidenceTitle, evidenceHint);
	const diagnoseButton = document.createElement("button");
	diagnoseButton.type = "button";
	diagnoseButton.className = "cpo-text-btn cpo-diagnose";
	diagnoseButton.textContent = "诊断候选";
	diagnoseButton.disabled = true;
	evidenceHeader.append(diagnoseButton);
	sidebar.append(evidenceHeader);
	const sheetHost = document.createElement("section");
	sidebar.append(sheetHost);
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = document.createElement("div");
	detail.className = "cpo-detail";
	detail.append(sourceActions);
	const listPanel = document.createElement("div");
	listPanel.className = "cpo-agg";
	listPanel.hidden = true;
	sheet.body.append(detail, listPanel);
	const actionsBar = document.createElement("div");
	actionsBar.className = "cpo-actions-bar";
	sidebar.append(actionsBar);

	if (!parsed.ok) {
		shell.classList.add("is-error");
		status.textContent = "代码块还不能建图";
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
	const canvas = document.createElement("canvas");
	canvas.className = "cpo-embed-canvas";
	stage.prepend(canvas);
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
		layoutHost.classList.toggle("is-icon-only", on);
		for (const button of Array.from(layoutHost.querySelectorAll(".cpo-tool"))) {
			const icon = button.querySelector(".cpo-layout-icon") as HTMLElement | null;
			const label = button.querySelector(".cpo-layout-label") as HTMLElement | null;
			if (icon) icon.style.display = on ? "inline" : "none";
			if (label) label.style.display = on ? "none" : "";
		}
		railToggle.textContent = on ? "›" : "‹";
		railToggle.setAttribute("aria-expanded", on ? "false" : "true");
		railToggle.setAttribute("aria-label", on ? "展开左侧栏" : "折叠左侧栏");
		afterPanelToggle();
	});
	sidebarToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-sidebar-collapsed");
		sidebarToggle.textContent = on ? "‹" : "›";
		sidebarToggle.setAttribute("aria-expanded", on ? "false" : "true");
		sidebarToggle.setAttribute("aria-label", on ? "展开右侧栏" : "折叠右侧栏");
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
	let selected: PaperNode | null = null;
	let chrome: GraphChrome | null = null;

	const paintLists = (): void => {
		detail.hidden = tab !== "graph";
		if (!currentGraph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(visibleNodes(currentGraph.nodes, viewFilter).map((node) => node.id));
		const rows = tab === "prior" ? priorWorks(currentGraph, visible) : derivativeWorks(currentGraph, visible);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? "被本图引用" : "引用本图";
		fillAggregate(listPanel, definition, rows, noun, (paper) => {
			const inGraph = currentGraph?.nodes.some((node) => node.id === paper.id) ?? false;
			if (inGraph && currentGraph) showDetail(paper, currentGraph, null);
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
	layoutHost.classList.add("is-icon-only");
	for (const button of Array.from(layoutHost.querySelectorAll(".cpo-tool"))) {
		const icon = button.querySelector(".cpo-layout-icon") as HTMLElement | null;
		const label = button.querySelector(".cpo-layout-label") as HTMLElement | null;
		if (icon) icon.style.display = "inline";
		if (label) label.style.display = "none";
	}

	const exportView = async (kind: ExportKind): Promise<void> => {
		if (!currentGraph) return;
		if (kind === "note") {
			const paper = selected ?? currentGraph.nodes.find((node) => node.isSeed) ?? null;
			if (!paper) return;
			const markdown = noteSkeleton(paper);
			if (deps.createNote) {
				try {
					await deps.createNote(noteFilename(paper), markdown);
					chrome?.setExportText(`已写入笔记：${noteFilename(paper)}`);
				} catch (error) {
					chrome?.setExportText(error instanceof Error ? error.message : "笔记没有写成。");
				}
				return;
			}
			chrome?.setExportText(markdown);
			await copyText(markdown);
			return;
		}
		const nodes = orderedForExport(visibleNodes(currentGraph.nodes, viewFilter));
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		chrome?.setExportText(text);
		await copyText(text);
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
			status.textContent += " · 按住 ⌘/Ctrl 滚动可缩放";
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
			return paper.abstract + (source ? `（摘要来源：${source}）` : "");
		}
		if (abstractMissing.has(paper.id)) return "OpenAlex、Semantic Scholar 和 Crossref 都没有这篇的摘要。";
		return "OpenAlex 没有摘要，正在查询 Semantic Scholar / Crossref…";
	};

	const placeDetailPlaceholder = (): void => {
		selected = null;
		openAlexAction.hidden = true;
		doiAction.hidden = true;
		detail.replaceChildren();
		detail.append(sourceActions);
		const empty = document.createElement("p");
		empty.className = "cpo-side-tip";
		empty.textContent = "点选节点查看题名、年份、作者和证据。";
		detail.append(empty);
		sheet.setSummary("点选节点查看论文", "");
	};
	placeDetailPlaceholder();

	const showDetail = (paper: PaperNode | null, graph: SimilarityGraph, link: GraphEdge | null): void => {
		if (!paper) {
			placeDetailPlaceholder();
			return;
		}
		selected = paper;
		const openAlex = allowedExternalUrl(paper.openAlexUrl);
		openAlexAction.hidden = !openAlex;
		openAlexAction.onclick = openAlex ? () => deps.openExternal(openAlex) : null;
		const doi = paper.doiUrl ? allowedExternalUrl(paper.doiUrl) : null;
		doiAction.hidden = !doi;
		doiAction.onclick = doi ? () => deps.openExternal(doi) : null;
		detail.replaceChildren();
		detail.append(sourceActions);
		paintMetadataCard(detail, paper, graph.crossCheck?.get(paper.id));
		const seed = graph.nodes.find((node) => node.isSeed) ?? null;
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		const getEvidence = (citingId: string, citedId: string) => graph.citationEvidence?.get(citingId, citedId) ?? null;
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
				if (score !== undefined) paintMeter(card, "图谱综合相似度", score, "结构 + 语义信号");
				const semantic = graph.semanticScores?.get(paper.id);
				if (semantic !== undefined) paintMeter(card, "文本相似度", semantic, semanticHintFor(graph.semanticMode), true);
				const note = document.createElement("p");
				note.className = "cpo-fact-note";
				note.textContent = score === undefined ? "与种子没有直接连线" : `与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`;
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
		tab = "graph";
		chrome?.setTab("graph");
		paintLists();
		selected = null;
		map.setSelected(null);
		detail.replaceChildren(sourceActions);
		detail.hidden = false;
		sheet.setExpanded(true);
		sheet.setSummary("候选诊断", "当前图谱的采样记录");
		const tip = document.createElement("p");
		tip.className = "cpo-side-tip";
		tip.textContent = "输入 DOI 或 OpenAlex ID，查看它在本轮采样中的状态。";
		const form = document.createElement("form");
		form.className = "cpo-diagnose-form";
		const query = document.createElement("input");
		query.placeholder = "DOI 或 OpenAlex ID";
		query.setAttribute("aria-label", "要诊断的论文");
		const submit = document.createElement("button");
		submit.type = "submit";
		submit.className = "cpo-primary";
		submit.textContent = "查询";
		form.append(query, submit);
		const result = document.createElement("div");
		result.className = "cpo-diagnose-result";
		detail.append(tip, form, result);
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
				open.textContent = "查看论文";
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
		status.textContent = `${[seed?.title, seed?.authors, seed?.year].filter(Boolean).join(" · ") || "图谱"} · ${graph.nodes.length} 篇${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · 滤除书评等 ${graph.skippedNonResearch} 条` : ""
		}`;
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
			status.textContent += ` · OpenCitations 补充 ${added} 条引用`;
		}
	};

	const load = async (bypassCache: boolean): Promise<void> => {
		const token = ++generation;
		placeDetailPlaceholder();
		tooltip.hidden = true;
		message.hidden = false;
		messageText.textContent = STAGE_TEXT.resolving;
		status.textContent = "正在向 OpenAlex 读取…";
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
						if (token === generation) messageText.textContent = STAGE_TEXT[stage];
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
			void enrichOpenCitations(graph, depthNote);
		} catch (error) {
			if (!alive || token !== generation) return;
			message.hidden = false;
			messageText.textContent = error instanceof Error ? error.message : "构建图谱失败。";
			status.textContent = "图谱没有建起来";
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

	return () => {
		alive = false;
		generation += 1;
		snapshotView();
		window.removeEventListener("research-connected-theme", onTheme);
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
	grip.setAttribute("aria-label", "调整图谱大小：拖动，或用方向键（Shift 加速）");
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

function iconButton(label: string, aria: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-icon";
	button.textContent = label;
	button.setAttribute("aria-label", aria);
	return button;
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
	if (room <= 0 || hubs.length === 0) return { graph, note: "已到节点上限" };
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
		return { graph, note: failed ? "第二层没有读到" : "" };
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
			note: `含第二层 ${extra.length} 篇`,
		};
	} catch {
		return { graph, note: "第二层没有读到" };
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
	for (const row of rows) paintAggregateCard(list, row, noun, onPick);
	host.append(list);
}

function yearSpan(nodes: readonly PaperNode[]): [number, number] | null {
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	if (years.length === 0) return null;
	return [Math.min(...years), Math.max(...years)];
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// The export panel still shows the text when the clipboard is blocked.
	}
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
