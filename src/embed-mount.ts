import { DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks, type RankedWork } from "./aggregates";
import { drawFlows } from "./analysis-view";
import { semanticAbstract } from "./citation-sources";
import { detectCommunities } from "./communities";
import { EMBED_HEIGHT_LIMIT, EMBED_WIDTH_LIMIT, parseEmbed, type EmbedSpec } from "./embed-syntax";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { buildFilters, buildLegend } from "./filter-controls";
import { emptyFilter, evidenceText, visibleNodes, type GraphFilter } from "./graph-filter";
import { mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { mountGraph3D, type Graph3DHandle, type GraphCameraState } from "./graph-3d";
import type { ColorMode, LayoutMode } from "./layout-modes";
import { loadNeighborhood, type LoadStage, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { nonResearchLabel, reconstructAbstract, referenceIds, shortId, toPaper } from "./paper";
import { findEdge } from "./relation";
import { allowedExternalUrl } from "./safe-url";
import type { ConnectedPapersSettings } from "./settings-model";
import { buildSimilarity } from "./similarity";
import type { GraphEdge, PaperNode } from "./types";
import { formatCount, snippet } from "./visual";

export interface EmbedDeps {
	source: string;
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
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

/** Camera, filter, and layout remembered per block key across remounts. */
interface EmbedViewState {
	camera: GraphCameraState;
	filter: GraphFilter;
	layout: LayoutMode;
	color: ColorMode;
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

	const bar = document.createElement("div");
	bar.className = "cpo-embed-bar";
	const status = document.createElement("p");
	status.className = "cpo-embed-status";
	status.setAttribute("role", "status");
	const reload = document.createElement("button");
	reload.type = "button";
	reload.className = "cpo-embed-reload";
	reload.textContent = "重新加载";
	bar.append(status, reload);
	shell.append(bar);

	const body = document.createElement("div");
	body.className = "cpo-embed-body";
	if (parsed.ok) body.style.height = `${parsed.spec.height}px`;
	shell.append(body);

	const rail = document.createElement("aside");
	rail.className = "cpo-rail";
	const filterButton = document.createElement("button");
	filterButton.type = "button";
	filterButton.className = "cpo-rail-filter";
	filterButton.textContent = "筛选";
	filterButton.title = "筛选 / 图例";
	filterButton.setAttribute("aria-expanded", "false");
	const layoutHost = document.createElement("div");
	rail.append(filterButton, layoutHost);

	const stage = document.createElement("div");
	stage.className = "cpo-embed-stage";
	const message = document.createElement("p");
	message.className = "cpo-embed-message";
	const tooltip = document.createElement("div");
	tooltip.className = "cpo-embed-tooltip";
	tooltip.hidden = true;
	const zoom = document.createElement("div");
	zoom.className = "cpo-zoom";
	const zoomIn = zoomButton("+", "放大");
	const zoomOut = zoomButton("−", "缩小");
	const zoomFit = zoomButton("适配", "适应窗口");
	zoom.append(zoomIn, zoomOut, zoomFit);
	const drawer = document.createElement("div");
	drawer.className = "cpo-drawer";
	drawer.hidden = true;
	const drawerTitle = document.createElement("p");
	drawerTitle.className = "cpo-drawer-title";
	drawerTitle.textContent = "筛选 / 图例";
	const tip = document.createElement("p");
	tip.className = "cpo-side-tip";
	tip.textContent = "拖拽移动图谱，按住 ⌘/Ctrl 滚动或用右下角按钮缩放。三维布局下拖拽是旋转，右键平移。嵌入图谱里节点位置固定，不能拖动。";
	const legend = document.createElement("div");
	legend.className = "cpo-embed-legend";
	const filters = document.createElement("div");
	filters.className = "cpo-embed-filters";
	const tools = document.createElement("div");
	drawer.append(drawerTitle, tip, legend, filters, tools);
	stage.append(message, tooltip, zoom, drawer);
	body.append(rail, stage);

	const actionsBar = document.createElement("div");
	actionsBar.className = "cpo-actions-bar";
	shell.append(actionsBar);

	const sheetHost = document.createElement("section");
	shell.append(sheetHost);
	const sheet = mountBottomSheet(sheetHost);
	const detail = document.createElement("div");
	detail.className = "cpo-embed-detail";
	const listPanel = document.createElement("div");
	listPanel.className = "cpo-agg";
	listPanel.hidden = true;
	sheet.body.append(detail, listPanel);
	filterButton.addEventListener("click", () => {
		const open = drawer.hidden;
		drawer.hidden = !open;
		filterButton.setAttribute("aria-expanded", open ? "true" : "false");
		filterButton.classList.toggle("is-on", open);
	});

	if (!parsed.ok) {
		shell.classList.add("is-error");
		status.textContent = "代码块还不能建图";
		message.textContent = parsed.error;
		reload.hidden = true;
		rail.hidden = true;
		sheetHost.hidden = true;
		zoom.hidden = true;
		return () => {
			root.replaceChildren();
			root.classList.remove("cpo-embed-host");
		};
	}

	const spec = parsed.spec;
	const stateKey = cacheKey(spec.target, spec.maxNodes ?? deps.getSettings().maxNodes, spec.depth, deps.getSettings());
	const saved = viewStates.get(stateKey);
	let viewFilter = saved?.filter ?? filterFromSpec(spec);
	buildLegend(legend, () => viewFilter, (next) => {
		viewFilter = next;
		graphView?.setFilter(viewFilter);
		paintLists();
	});
	const facetControls = buildFilters(filters, () => viewFilter, (next) => {
		viewFilter = next;
		graphView?.setFilter(viewFilter);
		paintLists();
	});
	let tab: GraphTab = "graph";
	let layoutMode: LayoutMode = saved?.layout ?? spec.layout;
	let colorMode: ColorMode = saved?.color ?? spec.color;
	let analysisMode: "sankey" | "chord" = "sankey";
	let currentGraph: SimilarityGraph | null = null;
	let selected: PaperNode | null = null;
	let chrome: GraphChrome | null = null;

	const paintLists = (): void => {
		sheetHost.classList.toggle("cpo-sheet-analysis", tab === "analysis");
		if (!currentGraph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		if (tab === "analysis") {
			paintAnalysis();
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

	/** Sankey by decade / chord by community over the visible direct citations. No new requests. */
	const paintAnalysis = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		const heading = document.createElement("h3");
		heading.className = "cpo-kicker";
		heading.textContent = "分析视图";
		const tip = document.createElement("p");
		tip.className = "cpo-side-tip";
		tip.textContent = "次要分析视图：只使用当前图谱和筛选结果，不会发起新的数据请求。";
		const controls = document.createElement("div");
		controls.className = "cpo-tools cpo-tool-row";
		const sankey = document.createElement("button");
		sankey.type = "button";
		sankey.className = analysisMode === "sankey" ? "cpo-tool is-on" : "cpo-tool";
		sankey.textContent = "桑基";
		const chord = document.createElement("button");
		chord.type = "button";
		chord.className = analysisMode === "chord" ? "cpo-tool is-on" : "cpo-tool";
		chord.textContent = "弦图";
		sankey.addEventListener("click", () => { analysisMode = "sankey"; paintAnalysis(); });
		chord.addEventListener("click", () => { analysisMode = "chord"; paintAnalysis(); });
		controls.append(sankey, chord);
		listPanel.append(heading, tip, controls);
		if (!currentGraph) return;
		const visible = visibleNodes(currentGraph.nodes, viewFilter);
		const visibleIds = new Set(visible.map((node) => node.id));
		const pairs = new Map<string, GraphEdge>();
		const add = (source: string, target: string): void => {
			if (!visibleIds.has(source) || !visibleIds.has(target) || source === target) return;
			pairs.set(source + "\0" + target, { source, target, weight: 0.1, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target" });
		};
		for (const [source, refs] of currentGraph.referenceLists) for (const target of refs) add(source, target);
		for (const e of currentGraph.citationEvidence?.entries() ?? []) add(e.citingId, e.citedId);
		const edges = [...pairs.values()];
		const communities = detectCommunities(
			visible.map((node) => node.id),
			currentGraph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
		);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.classList.add("cpo-analysis-svg");
		svg.setAttribute("viewBox", "0 0 760 440");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", analysisMode === "sankey" ? "按年份聚合的引用流" : "按社区聚合的引用关系");
		listPanel.append(svg);
		const selection = document.createElement("div");
		listPanel.append(selection);
		drawFlows(svg, visible, edges, analysisMode, communities, (papers) => {
			selection.replaceChildren();
			for (const paper of papers) addLink(selection, paper.title, () => {
				if (currentGraph) showDetail(paper, currentGraph, null);
			});
		});
	};

	chrome = mountGraphChrome(tools, {
		layouts: ["temporal", "radial", "force2d", "force3d"],
		layout: layoutMode,
		color: colorMode,
		noteButton: Boolean(deps.createNote),
		analysisButton: true,
		actionsHost: actionsBar,
		layoutHost,
		onLayout: (mode) => {
			layoutMode = mode;
			graphView?.setLayout(mode);
		},
		onColor: (mode) => {
			colorMode = mode;
			graphView?.setColorMode(mode);
		},
		onScrub: (year) => {
			viewFilter = { ...viewFilter, scrubYear: year };
			graphView?.setFilter(viewFilter);
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
	const stopResize = mountResizeHandle(body, anchor, () => graphView?.resize());
	const narrowObserver = new ResizeObserver(() => {
		shell.classList.toggle("is-narrow", shell.clientWidth < 520);
	});
	narrowObserver.observe(shell);
	zoomIn.addEventListener("click", () => graphView?.zoomBy(1.2));
	zoomOut.addEventListener("click", () => graphView?.zoomBy(1 / 1.2));
	zoomFit.addEventListener("click", () => graphView?.frame());
	let wheelHinted = false;
	stage.addEventListener(
		"wheel",
		(event) => {
			if (wheelHinted || event.ctrlKey || event.metaKey || !graphView) return;
			wheelHinted = true;
			status.textContent += " · 按住 ⌘/Ctrl 滚动可缩放";
		},
		{ capture: true, passive: true },
	);
	let generation = 0;
	let graphView: Graph3DHandle | null = null;
	let alive = true;
	/** Abstract fallback: ids already asked, ids Semantic Scholar filled, ids both sources lack. */
	const abstractRequested = new Set<string>();
	const abstractFromS2 = new Set<string>();
	const abstractMissing = new Set<string>();

	const embedAbstractText = (paper: PaperNode): string => {
		if (paper.abstract) {
			return paper.abstract + (abstractFromS2.has(paper.id) ? "（摘要来源：Semantic Scholar）" : "");
		}
		if (abstractMissing.has(paper.id)) return "OpenAlex 和 Semantic Scholar 都没有这篇的摘要。";
		return "OpenAlex 没有摘要，正在询问 Semantic Scholar…";
	};

	const placeDetailPlaceholder = (): void => {
		selected = null;
		detail.replaceChildren();
		const empty = document.createElement("p");
		empty.className = "cpo-embed-detail-empty";
		empty.textContent = "点选节点查看题名、年份、作者和证据。";
		detail.append(empty);
		if (deps.openGraph) addLink(detail, "在图谱面板中打开此图", () => deps.openGraph?.(spec.target));
		sheet.setSummary("点选节点查看论文", "");
	};
	placeDetailPlaceholder();

	const showDetail = (paper: PaperNode | null, graph: SimilarityGraph, link: GraphEdge | null): void => {
		if (!paper) {
			placeDetailPlaceholder();
			return;
		}
		selected = paper;
		detail.replaceChildren();
		// The sheet strip already carries the title; the body starts at the meta line.
		const meta = document.createElement("p");
		meta.className = "cpo-embed-detail-meta";
		const year = paper.year === null ? "年份不详" : String(paper.year);
		meta.textContent = `${year} · 被引 ${formatCount(paper.citedByCount)} · ${paper.authors}`;
		detail.append(meta);
		sheet.setSummary(paper.title, `${year} · 被引 ${formatCount(paper.citedByCount)}`);
		if (paper.retracted) {
			const note = document.createElement("p");
			note.className = "cpo-side-tip";
			note.textContent = "⚠ OpenAlex 将这篇作品标记为已撤稿（is_retracted）。引用它之前请先核实撤稿原因。";
			detail.append(note);
		}
		const flagged = nonResearchLabel(paper);
		if (flagged) {
			const note = document.createElement("p");
			note.className = "cpo-side-tip";
			note.textContent = `OpenAlex 将这条记录标记为「${flagged}」。书评的题名里嵌着原书信息，指向它的引用往往属于原书——这是 OpenAlex 的数据特点。`;
			detail.append(note);
		}
		const seed = graph.nodes.find((node) => node.isSeed) ?? null;
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		if (!paper.isSeed && seed) {
			const toSeed = findEdge(graph.edges, paper.id, seed.id);
			const line = document.createElement("p");
			line.className = "cpo-embed-detail-rel";
			if (toSeed) {
				const from = byId.get(toSeed.source);
				const to = byId.get(toSeed.target);
				line.textContent = from && to ? evidenceText(toSeed, from, to) : "与种子相连";
			} else {
				const score = graph.seedScore.get(paper.id);
				line.textContent =
					score === undefined ? "与种子没有直接连线" : `与种子没有直接连线 · 相近 ${score.toFixed(2)}`;
			}
			detail.append(line);
		}
		if (link && seed && !samePair(link, paper.id, seed.id)) {
			const from = byId.get(link.source);
			const to = byId.get(link.target);
			if (from && to) {
				const line = document.createElement("p");
				line.className = "cpo-embed-detail-rel";
				line.textContent = evidenceText(link, from, to);
				detail.append(line);
			}
		}
	const abstract = document.createElement("p");
		abstract.className = "cpo-embed-detail-abstract";
		if (!paper.abstract && !abstractMissing.has(paper.id) && !abstractRequested.has(paper.id)) {
			abstractRequested.add(paper.id);
			const token = generation;
			void semanticAbstract(deps.getJson, deps.getSettings().semanticScholarApiKey, paper).then((text) => {
				if (!alive || token !== generation) return;
				if (text) {
					paper.abstract = text;
					abstractFromS2.add(paper.id);
				} else {
					abstractMissing.add(paper.id);
				}
				if (selected === paper && currentGraph) showDetail(paper, currentGraph, null);
			});
		}
		abstract.textContent = embedAbstractText(paper);
		detail.append(abstract);
		const openAlex = allowedExternalUrl(paper.openAlexUrl);
		if (openAlex) addLink(detail, "在 OpenAlex 中打开", () => deps.openExternal(openAlex));
		if (paper.doiUrl) {
			const doi = allowedExternalUrl(paper.doiUrl);
			if (doi) addLink(detail, "打开 DOI", () => deps.openExternal(doi));
		}
		if (deps.openGraph) addLink(detail, "在图谱面板中打开此图", () => deps.openGraph?.(spec.target));
	};

	const snapshotView = (): void => {
		if (!graphView) return;
		rememberViewState(stateKey, { camera: graphView.getCamera(), filter: viewFilter, layout: layoutMode, color: colorMode });
	};

	const renderGraph = (graph: SimilarityGraph, depthNote: string): void => {
		snapshotView();
		graphView?.destroy();
		graphView = null;
		message.hidden = true;
		try {
			graphView = mountGraph3D(
				stage,
				tooltip,
				graph,
				(paper, link) => showDetail(paper, graph, link),
				{ labels: spec.labels, filter: viewFilter, layout: layoutMode, colorMode },
			);
			const remembered = viewStates.get(stateKey);
			if (remembered) graphView.setCamera(remembered.camera);
			facetControls.fill(graph.nodes);
			currentGraph = graph;
			chrome?.setYears(...yearSpan(graph.nodes));
			paintLists();
		} catch (error) {
			message.hidden = false;
			message.textContent = error instanceof Error ? error.message : "三维图谱没有建起来。";
			return;
		}
		const seed = graph.nodes.find((node) => node.isSeed);
		status.textContent = `${seed?.title ?? "图谱"} · ${graph.nodes.length} 篇${depthNote ? ` · ${depthNote}` : ""}${
			graph.skippedNonResearch ? ` · 滤除书评等 ${graph.skippedNonResearch} 条` : ""
		}`;
	};

	const load = async (bypassCache: boolean): Promise<void> => {
		const token = ++generation;
		graphView?.destroy();
		graphView = null;
		placeDetailPlaceholder();
		tooltip.hidden = true;
		message.hidden = false;
		message.textContent = STAGE_TEXT.resolving;
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
						if (token === generation) message.textContent = STAGE_TEXT[stage];
					},
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
		} catch (error) {
			if (!alive || token !== generation) return;
			message.hidden = false;
			message.textContent = error instanceof Error ? error.message : "构建图谱失败。";
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

	return () => {
		alive = false;
		generation += 1;
		snapshotView();
		graphView?.destroy();
		chrome?.destroy();
		sheet.destroy();
		stopResize();
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

function zoomButton(label: string, aria: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-zoom-btn";
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
		settings.apiKey.trim() ? "keyed" : "anon",
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
		empty.textContent = "当前子图里没有达到「经常」的文献（至少被数到 2 次）。采样到的引用列表可能不完整。";
		host.append(empty);
		return;
	}
	const list = document.createElement("ol");
	list.className = "cpo-agg-list";
	for (const row of rows) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cpo-agg-item";
		const title = document.createElement("span");
		title.className = "cpo-agg-title";
		title.textContent = row.paper.title;
		const meta = document.createElement("span");
		meta.className = "cpo-agg-meta";
		const year = row.paper.year === null ? "年份不详" : String(row.paper.year);
		meta.textContent = `${year} · ${row.paper.authors} · ${noun} ${row.count} 次`;
		button.append(title, meta);
		button.addEventListener("click", () => onPick(row.paper));
		item.append(button);
		list.append(item);
	}
	host.append(list);
}

function yearSpan(nodes: readonly PaperNode[]): [number, number] {
	const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
	if (years.length === 0) return [1990, 1990];
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
	button.className = "cpo-embed-link";
	button.textContent = label;
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	parent.append(button);
}
