import { AGGREGATE_EMPTY_TEXT, DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { EXAMPLE_DOI } from "./constants";
import { mountGraphKey } from "./filter-controls";
import { emptyFilter, SIMILARITY_NOT_CITATION, type GraphFilter } from "./graph-filter";
import { mountBottomSheet, mountGraphChrome, paintEvidenceBadges, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { edgeSourcesText, paintAbstractCard, paintAggregateCard, paintJumpStrip, paintMetadataCard, paintMeter, paintRelationSection, paintSelectionReasons, semanticHintFor } from "./detail-cards";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import {
	EXPAND_CAP,
	forgetGrafted,
	graftedFor,
	graftNodes,
	omitNode,
	refreshDerived,
	rememberGrafted,
} from "./graph-edit";
import { defaultColorMode, type LayoutMode } from "./layout-modes";
import { SimilarityMap } from "./map-canvas";
import {
	expandAround,
	loadNeighborhood,
	restoreGraftedMembers,
	type LoadWarning,
	type SimilarityGraph,
} from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { CrossrefClient, OpenCitationsClient, SemanticScholarClient, crossrefAbstract, doisFromOpenCitation, semanticAbstract } from "./citation-sources";
import {
	CitationEvidenceStore,
	edgeDetailStillCurrent,
	edgePairNeedingS2Context,
	mergeOpenCitation,
	mergeS2CitationsForPair,
	SOURCE_TEXT,
} from "./citation-evidence";
import {
	buildCitationTimeline,
	LIST_VS_TIMELINE_NOTE,
	TIMELINE_IMPACT_NOTE,
	TIMELINE_LOADING_TEXT,
	TIMELINE_META_LIMIT,
	TIMELINE_META_NOTE,
	TIMELINE_SAMPLING_NOTE,
	TIMELINE_SCOPE_NOTE,
	missingReferenceIds,
} from "./citation-timeline";
import { drawTimeline } from "./timeline-view";
import { buildNarrativeEvidence, type ResearchNarrative, type NarrativeEvidence } from "./narrative";
import { summarizeWithLlmPost } from "./llm";
import {
	DEFAULT_PATH_BUDGET,
	findBudgetedCitationPath,
	resolvePathEndpoint,
	type CitationPathResult,
} from "./doi-path";
import { classifyQuery, nonResearchLabel, normalizeDoi, shortId, toPaper, toSearchHit } from "./paper";
import { findEdge } from "./relation";
import { allowedExternalUrl } from "./safe-url";
import type { ConnectedPapersSettings } from "./settings";
import type { GraphEdge, PaperNode, SearchHit } from "./types";
import { formatCount, snippet } from "./visual";
import { mountSidebarResize } from "./sidebar-resize";
import { observeResponsiveMode } from "./responsive";
import { groupStagedBySeed, stageKey, stageSourceLabel, toggleStaged } from "./staging";

export interface GraphAppHandle {
	destroy(): void;
	/** Command-palette DOI path search over already-fetched reference lists. */
	openDoiPathSearch(): void;
}

export interface AppDeps {
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<unknown>;
	openExternal: (url: string) => void;
	createNote?: (filename: string, markdown: string) => Promise<void>;
	stagePaper?: (paper: PaperNode, seedId: string, source: string) => Promise<void> | void;
	/** Persist settings (grafted members, staging, …). */
	persistSettings?: () => Promise<void> | void;
	initialDoi?: string;
	/** Seed to build immediately; wins over initialDoi when both are set. */
	initialTarget?: { kind: "doi" | "openalex"; value: string };
}

const STAGE_TEXT: Record<"resolving" | "fetching" | "scoring" | "searching", string> = {
	resolving: "正在解析种子论文…",
	fetching: "正在读取参考文献、施引文献和相关作品…",
	scoring: "正在计算参考文献重叠与共被引…",
	searching: "正在搜索 OpenAlex…",
};

const WARNING_TEXT: Record<LoadWarning, string> = {
	references: "参考文献没有读到",
	citations: "施引文献没有读到",
	related: "相关作品没有读到",
	details: "部分参考文献列表没有读到，相似度只基于拿到的数据",
	crosscheck: "Semantic Scholar 交叉比对没有完成（额度或网络），图谱仍基于 OpenAlex",
};

/** Pane UI shared by the Obsidian view and the browser preview. */
export function mountGraphApp(root: HTMLElement, deps: AppDeps): GraphAppHandle {
	root.classList.add("cpo-root");
	root.replaceChildren();

	const bar = el(root, "header", "cpo-bar");
	const topLine = el(bar, "div", "cpo-topline");
	const brand = el(topLine, "div", "cpo-brand");
	el(brand, "span", "cpo-brand-mark", "R");
	el(brand, "strong", undefined, "Research Connected");
	const form = el(topLine, "form", "cpo-form");
	const input = el(form, "input", "cpo-input") as HTMLInputElement;
	input.type = "text";
	input.placeholder = "DOI、OpenAlex ID 或论文标题";
	input.autocomplete = "off";
	input.spellcheck = false;
	input.setAttribute("aria-label", "种子论文");
	const submit = el(form, "button", "cpo-primary", "构建图谱") as HTMLButtonElement;
	submit.type = "submit";
	const example = el(topLine, "button", "cpo-ghost", "示例") as HTMLButtonElement;
	example.type = "button";
	example.title = EXAMPLE_DOI;

	const status = el(bar, "p", "cpo-status", "从一篇种子论文开始。");
	status.setAttribute("role", "status");
	const seedSummary = el(root, "div", "cpo-seed-summary");
	seedSummary.hidden = true;
	el(seedSummary, "span", "cpo-seed-mark", "");
	const seedTitle = el(seedSummary, "strong", "cpo-seed-title");
	const seedMeta = el(seedSummary, "span", "cpo-seed-meta");
	const results = el(bar, "div", "cpo-results");
	results.hidden = true;

	const banner = el(root, "div", "cpo-banner");
	banner.hidden = true;
	banner.setAttribute("role", "alert");

	const body = el(root, "div", "cpo-body");
	const rail = el(body, "aside", "cpo-rail");
	const layoutHost = el(rail, "div");
	const railToggle = el(rail, "button", "cpo-panel-toggle is-left", "‹") as HTMLButtonElement;
	railToggle.type = "button";
	railToggle.setAttribute("aria-label", "折叠左侧栏");
	railToggle.setAttribute("aria-expanded", "true");

	const stage = el(body, "div", "cpo-stage");
	const canvas = el(stage, "canvas");
	canvas.setAttribute("aria-label", "论文相似度图谱");
	const empty = el(stage, "div", "cpo-empty");
	const emptyTitle = el(empty, "h2", undefined, "从一篇种子论文开始");
	emptyTitle.className = "cpo-empty-title";
	el(
		empty,
		"p",
		undefined,
		"输入 DOI、OpenAlex 链接或作品 ID，也可以按标题搜索后点选。圆点按参考文献重叠和共被引聚在一起，不是引用列表。",
	);
	const tooltip = el(stage, "div", "cpo-tooltip");
	tooltip.hidden = true;
	const nodeMenu = el(stage, "div", "cpo-node-menu");
	nodeMenu.hidden = true;
	nodeMenu.setAttribute("role", "menu");
	const deleteItem = el(nodeMenu, "button", undefined, "删除") as HTMLButtonElement;
	const expandItem = el(nodeMenu, "button", undefined, "深挖") as HTMLButtonElement;
	const seedItem = el(nodeMenu, "button", undefined, "设为种子") as HTMLButtonElement;
	for (const item of [deleteItem, expandItem, seedItem]) {
		item.type = "button";
		item.setAttribute("role", "menuitem");
	}

	const graphActions = el(stage, "div", "cpo-graph-actions");
	const graphActionSpacer = el(graphActions, "span", "cpo-graph-action-spacer");
	const sourceActions = el(graphActions, "div", "cpo-source-actions");
	const openAlexAction = el(sourceActions, "button", "cpo-action-link", "OpenAlex ↗") as HTMLButtonElement;
	const doiAction = el(sourceActions, "button", "cpo-action-link", "DOI ↗") as HTMLButtonElement;
	const zoom = el(stage, "div", "cpo-zoom");
	const zoomIn = el(zoom, "button", "cpo-icon", "+") as HTMLButtonElement;
	const zoomOut = el(zoom, "button", "cpo-icon", "−") as HTMLButtonElement;
	const fit = el(zoom, "button", "cpo-icon", "适配") as HTMLButtonElement;
	for (const button of [zoomIn, zoomOut, fit]) button.type = "button";
	zoomIn.setAttribute("aria-label", "放大");
	zoomOut.setAttribute("aria-label", "缩小");
	fit.setAttribute("aria-label", "适应窗口");
	for (const button of [openAlexAction, doiAction]) {
		button.type = "button";
		button.hidden = true;
	}

	const sidebar = el(body, "aside", "cpo-evidence-sidebar");
	const sidebarToggle = el(sidebar, "button", "cpo-panel-toggle is-right", "›") as HTMLButtonElement;
	sidebarToggle.type = "button";
	sidebarToggle.setAttribute("aria-label", "折叠右侧栏");
	sidebarToggle.setAttribute("aria-expanded", "true");
	const sidebarResize = el(body, "div", "cpo-sidebar-resizer");
	body.insertBefore(sidebarResize, sidebar);
	const evidenceHeader = el(sidebar, "header", "cpo-evidence-header");
	el(evidenceHeader, "h2", undefined, "论文与关系证据");
	el(evidenceHeader, "p", undefined, "点选节点查看来源、关系与摘要；拖动左侧边缘调整宽度。");
	const sheetHost = el(sidebar, "section");
	const sheet = mountBottomSheet(sheetHost, { collapsible: false });
	sheet.setExpanded(true);
	const detail = el(sheet.body, "div", "cpo-detail");
	const listPanel = el(sheet.body, "div", "cpo-agg");
	listPanel.hidden = true;
	const actionsBar = el(sidebar, "div", "cpo-actions-bar");
	const map = new SimilarityMap(canvas, tooltip, stage);
	const stopSidebarResize = mountSidebarResize(sidebarResize, sidebar, { onResize: () => map.resize() });
	let mapFilter: GraphFilter = emptyFilter();
	map.setKinds(mapFilter.kinds);
	const graphKey = mountGraphKey(rail, () => mapFilter, (next) => {
		mapFilter = next;
		map.setKinds(next.kinds);
	});
	graphKey.paintColor("force2d");
	let graph: SimilarityGraph | null = null;
	let tab: GraphTab = "graph";
	let narrative: ResearchNarrative | null = null;
	let narrativeInput: NarrativeEvidence | null = null;
	let narrativeMeta = "";
	let narrativeError = "";
	let scrubYear: number | null = null;
	let chrome: GraphChrome | null = null;
	let selectedPaper: PaperNode | null = null;
	let selectedEdge: GraphEdge | null = null;
	const s2EvidenceRequests = new Map<string, Promise<import("./citation-sources").SemanticCitation[]>>();
	/** 轨道按钮持有的布局；建图后回灌给画布，保持按钮与实际渲染一致。 */
	let layoutMode: LayoutMode = "force2d";
	let timelineMetaGraph: SimilarityGraph | null = null;
	let timelineMetaRequested = false;
	let timelineMetaLoading = false;
	let timelineMetaError = "";
	const timelineExtraMeta = new Map<string, PaperNode>();
	/** 脉络里被点过的未收录节点，避免同一篇重复单篇补取。 */
	const timelinePickedMeta = new Set<string>();
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
		example.disabled = busy;
		submit.textContent = busy ? "正在构建…" : "构建图谱";
	};

	const shownNodes = (): PaperNode[] => {
		if (!graph) return [];
		return graph.nodes.filter((node) => scrubYear === null || (node.year !== null && node.year <= scrubYear));
	};

	const paintLists = (): void => {
		sheetHost.classList.toggle("cpo-sheet-analysis", tab === "research" || tab === "timeline");
		detail.hidden = tab !== "graph";
		if (tab === "research") {
			paintResearch();
			return;
		}
		if (tab === "timeline") {
			paintTimeline();
			return;
		}
		if (tab === "staged") {
			paintStaged();
			return;
		}
		if (!graph || tab === "graph") {
			listPanel.hidden = true;
			listPanel.replaceChildren();
			return;
		}
		const visible = new Set(shownNodes().map((node) => node.id));
		const rows = tab === "prior" ? priorWorks(graph, visible) : derivativeWorks(graph, visible);
		const definition = tab === "prior" ? PRIOR_DEFINITION : DERIVATIVE_DEFINITION;
		const noun = tab === "prior" ? "被本图引用" : "引用本图";
		listPanel.hidden = false;
		listPanel.replaceChildren();
		const copy = document.createElement("p");
		copy.className = "cpo-agg-def";
		copy.textContent = definition;
		listPanel.append(copy);
		el(listPanel, "p", "cpo-side-tip", LIST_VS_TIMELINE_NOTE);
		if (rows.length === 0) {
			const empty = document.createElement("p");
			empty.className = "cpo-agg-empty";
			empty.textContent = AGGREGATE_EMPTY_TEXT;
			listPanel.append(empty);
			return;
		}
		const list = document.createElement("ol");
		list.className = "cpo-agg-list";
		for (const row of rows) {
			paintAggregateCard(list, row, noun, (paper) => {
				if (graph?.nodes.some((node) => node.id === paper.id)) showDetail(paper);
			});
		}
		listPanel.append(list);
	};

	/** 引用脉络：只用原始引用记录，不用相似图边。 */
	const paintTimeline = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		el(listPanel, "h3", "cpo-kicker", "引用脉络");
		el(listPanel, "p", "cpo-side-tip", TIMELINE_SCOPE_NOTE);
		if (!graph) return;
		if (timelineMetaGraph !== graph) {
			timelineMetaGraph = graph;
			timelineMetaRequested = false;
			timelineMetaLoading = false;
			timelineMetaError = "";
			timelineExtraMeta.clear();
			timelinePickedMeta.clear();
		}
		const timeline = buildCitationTimeline(graph, timelineExtraMeta);
		const sourceNames = timeline.sources.map((source) => SOURCE_TEXT[source as keyof typeof SOURCE_TEXT] ?? source);
		el(
			listPanel,
			"p",
			"cpo-side-tip",
			`引用关系来源：${sourceNames.join(" + ") || "OpenAlex 采样"} · 当前采样 ${graph.nodes.length} 篇节点`,
		);
		el(listPanel, "p", "cpo-side-tip", `${TIMELINE_SAMPLING_NOTE}${TIMELINE_IMPACT_NOTE}`);
		const missingCount = missingReferenceIds(graph, timelineExtraMeta, Number.MAX_SAFE_INTEGER).length;
		el(listPanel, "p", "cpo-side-tip", `${TIMELINE_META_NOTE}${missingCount > TIMELINE_META_LIMIT ? ` 当前缺少 ${missingCount} 条，先补取前 ${TIMELINE_META_LIMIT} 条。` : ""}`);
		if (timelineMetaLoading) el(listPanel, "p", "cpo-side-tip", TIMELINE_LOADING_TEXT);
		if (timelineMetaError) el(listPanel, "p", "cpo-side-tip", `元数据补取失败：${timelineMetaError}；仍显示已有引用记录。`);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "种子论文的引用脉络");
		const scroll = el(listPanel, "div", "cpo-timeline-scroll");
		scroll.append(svg);
		const selection = el(listPanel, "div");
		drawTimeline(svg, timeline, { width: Math.max(320, scroll.clientWidth), onPick: (node) => {
			selection.replaceChildren();
			el(selection, "p", "cpo-meta", `${node.title || node.id} · ${node.year ?? "年份不详"}`);
			paintEvidenceBadges(selection, node.evidence);
			const paper = graph?.nodes.find((item) => item.id === node.id);
			if (paper) {
				addLink(selection, "在详情中查看", () => {
					activateGraphTab();
					showDetail(paper);
				});
				return;
			}
			// 未收录节点（超出批量补取上限的参考文献）：点击时单篇补取元数据。
			if (node.missing && graph && !timelinePickedMeta.has(node.id)) {
				timelinePickedMeta.add(node.id);
				const picking = graph;
				el(selection, "p", "cpo-side-tip", TIMELINE_LOADING_TEXT);
				void (async () => {
					try {
						const works = await client().workSummaries([node.id]);
						if (disposed || graph !== picking) return;
						const meta = works.map((raw) => toPaper(raw, "reference")).find((item) => item?.id === node.id);
						if (meta) timelineExtraMeta.set(meta.id, meta);
					} catch {
						timelinePickedMeta.delete(node.id);
					} finally {
						if (!disposed && graph === picking && tab === "timeline") paintTimeline();
					}
				})();
			}
		} });
		if (!timelineMetaRequested && missingCount > 0) {
			timelineMetaRequested = true;
			timelineMetaLoading = true;
			void (async () => {
				try {
					const ids = missingReferenceIds(graph!, timelineExtraMeta, TIMELINE_META_LIMIT);
					const works = await client().workSummaries(ids);
					if (disposed || graph !== timelineMetaGraph) return;
					for (const raw of works) {
						const paper = toPaper(raw, "reference");
						if (paper) timelineExtraMeta.set(paper.id, paper);
					}
					timelineMetaError = "";
				} catch (error) {
					if (graph === timelineMetaGraph) timelineMetaError = error instanceof Error ? error.message : "请求未完成";
				} finally {
					if (graph === timelineMetaGraph) {
						timelineMetaLoading = false;
						if (!disposed && tab === "timeline") paintTimeline();
					}
				}
			})();
		}
	};

	const paintStaged = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		el(listPanel, "h3", "cpo-kicker", "暂存列表");
		const items = deps.getSettings().stagedPapers ?? [];
		if (items.length === 0) { el(listPanel, "p", "cpo-agg-empty", "还没有暂存论文。"); return; }
		const exportRow = el(listPanel, "div", "cpo-tool-row");
		const copyTable = el(exportRow, "button", "cpo-text-btn", "复制表格") as HTMLButtonElement;
		copyTable.type = "button";
		copyTable.onclick = () => {
			const text = toMarkdownTable(orderedForExport(items.map((item) => item.paper)));
			chrome?.setExportText(text);
			void copyPane(text);
		};
		const copyBib = el(exportRow, "button", "cpo-text-btn", "复制 BibTeX") as HTMLButtonElement;
		copyBib.type = "button";
		copyBib.onclick = () => {
			const text = toBibTeX(orderedForExport(items.map((item) => item.paper)));
			chrome?.setExportText(text);
			void copyPane(text);
		};
		if (deps.createNote) {
			const noteBtn = el(exportRow, "button", "cpo-text-btn", "写入清单笔记") as HTMLButtonElement;
			noteBtn.type = "button";
			noteBtn.onclick = () => {
				const lines = ["# 暂存文献清单", ""];
				for (const group of groupStagedBySeed(items)) {
					lines.push(`## 种子 ${group.seedId}`, "");
					for (const item of group.items) {
						lines.push(`- ${item.paper.title || item.paper.id}（${item.paper.year ?? "年份不详"}）· ${item.source}${item.read ? " · 已读" : ""}`);
						if (item.paper.doiUrl) lines.push(`  - DOI: ${item.paper.doiUrl}`);
						lines.push(`  - ${item.paper.openAlexUrl}`);
					}
					lines.push("");
				}
				void deps.createNote!("暂存文献清单.md", lines.join("\n")).then(() => {
					chrome?.setExportText("已写入笔记：暂存文献清单.md");
				}).catch((error) => {
					chrome?.setExportText(error instanceof Error ? error.message : "笔记没有写成。");
				});
			};
		}
		for (const group of groupStagedBySeed(items)) {
			const seedTitle = graph?.nodes.find((node) => node.id === group.seedId)?.title;
			el(listPanel, "h4", "cpo-kicker", seedTitle ? `种子 · ${seedTitle}` : `种子 · ${group.seedId}`);
			const list = el(listPanel, "ol", "cpo-agg-list");
			for (const item of group.items) {
				const row = el(list, "li", "cpo-agg-item");
				el(row, "strong", undefined, item.paper.title || item.paper.id);
				el(row, "p", "cpo-meta", `${item.paper.year ?? "年份不详"} · ${item.source}${item.read ? " · 已读" : ""}`);
				const open = el(row, "button", "cpo-text-btn", "查看") as HTMLButtonElement;
				open.type = "button";
				open.onclick = () => { if (graph?.nodes.some((node) => node.id === item.paper.id)) { activateGraphTab(); showDetail(item.paper); } };
				const read = el(row, "button", "cpo-text-btn", item.read ? "标为未读" : "标为已读") as HTMLButtonElement;
				read.type = "button";
				read.onclick = async () => { item.read = !item.read; await deps.stagePaper?.(item.paper, item.seedId, item.source); paintStaged(); };
				const remove = el(row, "button", "cpo-text-btn", "移除") as HTMLButtonElement;
				remove.type = "button";
				remove.onclick = async () => {
					deps.getSettings().stagedPapers = items.filter((other) => stageKey(other) !== stageKey(item));
					await deps.stagePaper?.(item.paper, item.seedId, item.source);
					paintStaged();
				};
			}
		}
	};

	const paintResearch = (): void => {
		listPanel.replaceChildren();
		listPanel.hidden = !llmReady();
		if (!llmReady()) { narrative = null; return; }
		el(listPanel, "h3", "cpo-kicker", "研究脉络");
		const tip = el(listPanel, "p", "cpo-side-tip", narrativeError || (narrativeBusy ? "正在请求模型…" : "手动生成：向已配置服务发送当前种子的论文元数据、引用关系和已获取的引用上下文。摘要由设置控制。结果覆盖整张采样图，不随年份滑块变化。"));
		const generate = el(listPanel, "button", "cpo-primary", narrative ? "重新生成" : "生成研究脉络") as HTMLButtonElement;
		generate.type = "button";
		generate.disabled = narrativeBusy || !graph;
		generate.addEventListener("click", () => void generateResearch(generate, tip));
		if (!narrative) return;
		const exportText = () => {
			if (!narrative || !llmReady()) return "";
			return [
				"# 研究脉络", narrativeMeta,
				narrative.synthesis,
				...(["basedOn", "influenced", "importantWorks"] as const).flatMap(key => narrative![key].map(item => {
					const paper = [...(graph?.nodes ?? []), ...(graph?.catalog ?? [])].find(p => p.id === item.paperId);
					return `- ${item.claim}\n  论文：${paper?.title ?? item.paperId} — https://openalex.org/${encodeURIComponent(item.paperId)}\n  证据：${item.evidence.join("；")}`;
				})), ...narrative.caveats.map(c => "- " + c),
			].join("\n\n");
		};
		addLink(listPanel, "复制总结", () => { const text = exportText(); if (text) void copyPane(text); });
		if (deps.createNote) addLink(listPanel, "写入总结笔记", () => {
			const text = exportText(), id = graph?.nodes.find(p => p.isSeed)?.id;
			if (text && id) void deps.createNote!(`研究脉络-${id}.md`, text).then(() => { tip.textContent = "已写入总结笔记。"; }).catch(() => { tip.textContent = "笔记写入失败。"; });
		});
		const evidenceDetails = el(listPanel, "details");
		el(evidenceDetails, "summary", undefined, "查看使用的论文和证据");
		el(evidenceDetails, "pre", "cpo-export-text", JSON.stringify(narrativeInput, null, 2));
		el(listPanel, "h4", "cpo-kicker", "总体总结");
		el(listPanel, "p", "cpo-abstract", narrative.synthesis);
		paintNarrativeSection("基于的研究", narrative.basedOn);
		paintNarrativeSection("后续影响", narrative.influenced);
		paintNarrativeSection("重要工作", narrative.importantWorks);
		if (narrative.caveats.length) {
			el(listPanel, "h4", "cpo-kicker", "限制");
			for (const caveat of narrative.caveats) el(listPanel, "p", "cpo-side-tip", caveat);
		}
	};

	const paintNarrativeSection = (title: string, items: ResearchNarrative["basedOn"]): void => {
		if (!items.length) return;
		el(listPanel, "h4", "cpo-kicker", title);
		for (const item of items) {
			const paper = graph?.nodes.find((node) => node.id === item.paperId) ?? graph?.catalog.find((node) => node.id === item.paperId);
			const button = el(listPanel, "button", "cpo-agg-item") as HTMLButtonElement;
			button.type = "button";
			button.textContent = `${paper?.year ?? "—"} · ${paper?.title ?? item.paperId} · 模型自评 ${item.confidence}`;
			button.addEventListener("click", () => { if (paper) { activateGraphTab(); showDetail(paper); } });
			el(listPanel, "p", "cpo-side-tip", item.claim);
			if (item.evidence.length) el(listPanel, "p", "cpo-evidence", item.evidence.join("；"));
		}
	};

	const generateResearch = async (button: HTMLButtonElement, tip: HTMLElement): Promise<void> => {
		if (!llmReady() || narrativeBusy || !graph || !deps.postJson) {
			tip.textContent = "LLM 尚未配置，或当前运行环境不支持 POST 请求。";
			return;
		}
		const settings = deps.getSettings();
		const requestGraph = graph;
		const requestGeneration = generation;
		const revision = settingsRevision;
		narrativeBusy = true;
		narrativeError = "";
		button.disabled = true;
		tip.textContent = "正在整理引用证据并请求 LLM…";
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
			narrativeMeta = `生成时间：${new Date().toISOString()}；模型：${settings.llmModel}；种子：${evidence.seed.title} (${evidence.seed.id})`;
			if (tab === "research") paintResearch();
		} catch (error) {
			if (disposed || requestGraph !== graph || requestGeneration !== generation || revision !== settingsRevision || !llmReady()) return;
			narrativeError = error instanceof Error ? error.message : "LLM 总结失败。";
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
		stagingButton: Boolean(deps.stagePaper),
		timelineButton: true,
		actionsHost: actionsBar,
		layoutHost,
		scrubHost: graphActions,
		onLayout: (mode) => {
			layoutMode = mode;
			map.setLayout(mode);
			map.setColorMode(defaultColorMode(mode));
			graphKey.paintColor(mode);
		},
		onScrub: (year) => {
			scrubYear = year;
			map.setScrubYear(year);
			paintLists();
		},
		onTab: (next) => {
			tab = next;
			if (next !== "graph") sheet.setExpanded(true);
			paintLists();
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

	const exportPane = async (kind: ExportKind): Promise<void> => {
		if (!graph) return;
		if (kind === "note") {
			const paper = selectedPaper ?? graph.nodes.find((node) => node.isSeed);
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
			await copyPane(markdown);
			return;
		}
		const nodes = orderedForExport(shownNodes());
		const text = kind === "bibtex" ? toBibTeX(nodes) : kind === "yaml" ? toYamlList(nodes) : toMarkdownTable(nodes);
		chrome?.setExportText(text);
		await copyPane(text);
	};

	const abstractText = (paper: PaperNode): string => {
		if (paper.abstract) {
			const source = abstractFromS2.has(paper.id) ? "Semantic Scholar" : abstractFromCrossref.has(paper.id) ? "Crossref" : "";
			return paper.abstract + (source ? `（摘要来源：${source}）` : "");
		}
		if (abstractMissing.has(paper.id)) return "OpenAlex、Semantic Scholar 和 Crossref 都没有这篇的摘要。";
		return "OpenAlex 没有摘要，正在查询 Semantic Scholar / Crossref…";
	};

	const getEvidence = (citingId: string, citedId: string) => graph?.citationEvidence?.get(citingId, citedId) ?? null;
	const edgeSources = (edge: GraphEdge): string => edgeSourcesText(edge, getEvidence);

	const showDetail = (paper: PaperNode | null): void => {
		selectedPaper = paper;
		selectedEdge = null;
		detail.replaceChildren();
		if (!paper || !graph) {
			map.setSelected(null);
			sheet.setSummary("点选节点查看论文", "");
			openAlexAction.hidden = true;
			doiAction.hidden = true;
			el(detail, "p", "cpo-side-tip", "点选节点查看题名、年份、作者和证据。");
			return;
		}
		map.setSelected(paper.id);
		const year = paper.year === null ? "年份不详" : String(paper.year);
		sheet.setSummary(paper.title, `${year} · 被引 ${formatCount(paper.citedByCount)}`, { lang: paper.language });
		paintMetadataCard(detail, paper, graph.crossCheck?.get(paper.id));
		if (deps.stagePaper && !paper.isSeed) {
			const seedId = graph.nodes.find((node) => node.isSeed)?.id;
			if (seedId) {
				const staged = deps.getSettings().stagedPapers.some((item) => stageKey(item) === `${seedId}\0${paper.id}`);
				const button = el(detail, "button", "cpo-text-btn", staged ? "从暂存列表移除" : "加入暂存列表") as HTMLButtonElement;
				button.type = "button";
				button.onclick = async () => {
					const link = findEdge(graph!.edges, paper.id, seedId);
					const evidence = graph!.citationEvidence?.get(paper.id, seedId) ?? graph!.citationEvidence?.get(seedId, paper.id) ?? null;
					const source = stageSourceLabel(paper, seedId, link, evidence);
					deps.getSettings().stagedPapers = toggleStaged(deps.getSettings().stagedPapers, paper, seedId, source);
					await deps.stagePaper?.(paper, seedId, source);
					showDetail(paper);
				};
			}
		}
		const seedNode = graph.nodes.find((node) => node.isSeed) ?? null;
		if (seedNode && !paper.isSeed) {
			const link = findEdge(graph.edges, paper.id, seedNode.id);
			const from = link ? graph.nodes.find((node) => node.id === link.source) : undefined;
			const to = link ? graph.nodes.find((node) => node.id === link.target) : undefined;
			const score = graph.seedScore.get(paper.id);
			if (link && from && to) {
				paintRelationSection(detail, link, from, to, { sources: edgeSources(link), getEvidence, seedScore: score, semanticScore: graph.semanticScores?.get(paper.id), semanticHint: semanticHintFor(graph.semanticMode) });
			} else {
				const recorded =
					graph.citationEvidence?.get(paper.id, seedNode.id) ?? graph.citationEvidence?.get(seedNode.id, paper.id);
				if (score !== undefined || !recorded) {
					const card = el(detail, "section", "cpo-card");
					if (score !== undefined) paintMeter(card, "图谱综合相似度", score, "结构 + 语义信号");
					const semantic = graph.semanticScores?.get(paper.id);
					if (semantic !== undefined) paintMeter(card, "文本相似度", semantic, semanticHintFor(graph.semanticMode), true);
					if (!recorded) el(card, "p", "cpo-fact-note", `与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`);
				}
			}
			const rankInfo = graph.selectionRank?.get(paper.id);
			if (rankInfo) paintSelectionReasons(detail, rankInfo, score);
			paintJumpStrip(detail, seedNode, (target) => showDetail(target));
		}
		paintAbstractCard(detail, paper, abstractText);
		if (!paper.abstract && !abstractMissing.has(paper.id) && !abstractRequested.has(paper.id)) {
			abstractRequested.add(paper.id);
			const token = generation;
			void (async () => {
				const s2Text = await semanticAbstract(deps.getJson, deps.getSettings().semanticScholarApiKey, paper);
				if (s2Text) return { text: s2Text, source: "s2" as const };
				const crossrefText = await crossrefAbstract(deps.getJson, deps.getSettings().contactEmail, paper);
				return crossrefText ? { text: crossrefText, source: "crossref" as const } : null;
			})().then((result) => {
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
		const openAlex = allowedExternalUrl(paper.openAlexUrl);
		openAlexAction.hidden = !openAlex;
		openAlexAction.onclick = openAlex ? () => deps.openExternal(openAlex) : null;
		const doi = paper.doiUrl ? allowedExternalUrl(paper.doiUrl) : null;
		doiAction.hidden = !doi;
		doiAction.onclick = doi ? () => deps.openExternal(doi) : null;
	};

	map.onSelect = (paper) => showDetail(paper);
	map.onNodeMenu = (paper, x, y) => {
		if (!paper || !graph) {
			nodeMenu.hidden = true;
			return;
		}
		deleteItem.disabled = paper.isSeed;
		deleteItem.title = paper.isSeed ? "种子不能删除" : "从当前图中去掉";
		seedItem.disabled = paper.isSeed;
		seedItem.title = paper.isSeed ? "已是种子" : "以这篇重建整图";
		nodeMenu.dataset.paperId = paper.id;
		nodeMenu.hidden = false;
		const rect = stage.getBoundingClientRect();
		const pad = 8;
		const mw = Math.max(nodeMenu.offsetWidth, 108);
		const mh = Math.max(nodeMenu.offsetHeight, 96);
		const left = Math.min(Math.max(pad, x - rect.left), Math.max(pad, rect.width - mw - pad));
		const top = Math.min(Math.max(pad, y - rect.top), Math.max(pad, rect.height - mh - pad));
		nodeMenu.style.left = `${left}px`;
		nodeMenu.style.top = `${top}px`;
	};
	const afterPanelToggle = (): void => {
		map.resize();
		window.setTimeout(() => map.resize(), 240);
	};
	railToggle.addEventListener("click", () => {
		const on = body.classList.toggle("is-rail-collapsed");
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
	map.onDeleteRequest = () => {
		if (selectedPaper) removePaper(selectedPaper);
	};
	const showEdgeDetail = (edge: GraphEdge): void => {
		if (!graph) return;
		const a = graph.nodes.find(p => p.id === edge.source), b = graph.nodes.find(p => p.id === edge.target);
		if (!a || !b) return;
		openAlexAction.hidden = true;
		doiAction.hidden = true;
		detail.replaceChildren(); detail.hidden = false; sheet.setExpanded(true);
		sheet.setSummary("引用证据", "");
		paintRelationSection(detail, edge, a, b, { sources: edgeSources(edge), getEvidence });
		paintJumpStrip(detail, a, (target) => showDetail(target));
		paintJumpStrip(detail, b, (target) => showDetail(target));
		void loadSelectedEdgeEvidence(edge, a, b);
	};

	const loadSelectedEdgeEvidence = async (edge: GraphEdge, a: PaperNode, b: PaperNode): Promise<void> => {
		const current = graph;
		const settings = deps.getSettings();
		if (!current || !settings.s2Reconcile || !deps.postJson) return;
		const pair = edgePairNeedingS2Context(edge, getEvidence);
		if (!pair) return;
		const citing = current.nodes.find((p) => p.id === pair.citingId);
		const cited = current.nodes.find((p) => p.id === pair.citedId);
		const citingDoi = normalizeDoi(citing?.doiUrl);
		const citedDoi = normalizeDoi(cited?.doiUrl);
		if (!citing || !cited || !citingDoi || !citedDoi) return;
		let request = s2EvidenceRequests.get(citingDoi);
		if (!request) {
			const client = new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey, deps.postJson);
			request = client.referenceEvidence(citingDoi).then(({ data }) => data);
			request.catch(() => s2EvidenceRequests.delete(citingDoi));
			s2EvidenceRequests.set(citingDoi, request);
		}
		let citations;
		try {
			citations = await request;
		} catch {
			if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) {
				el(detail, "p", "cpo-fact-note", "Semantic Scholar 引用语境暂时不可用。");
			}
			return;
		}
		current.citationEvidence ??= new CitationEvidenceStore();
		mergeS2CitationsForPair(current.citationEvidence, citing.id, cited.id, citedDoi, citations, normalizeDoi);
		if (edgeDetailStillCurrent(selectedEdge, edge, !disposed && graph === current)) showEdgeDetail(edge);
	};
	map.onEdgeSelect = (edge) => {
		selectedEdge = edge;
		selectedPaper = null;
		showEdgeDetail(edge);
	};
	showDetail(null);

	const hideNodeMenu = (): void => {
		nodeMenu.hidden = true;
		delete nodeMenu.dataset.paperId;
	};

	const applyEdit = (next: SimilarityGraph, note: string, nearId?: string): void => {
		graph = next;
		map.adoptGraph(next.nodes, next.edges, next.seedScore, nearId);
		graphKey.setStats(next.nodes, next.edges);
		graphKey.paintColor(layoutMode);
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		else chrome?.clearYears();
		paintLists();
		const selectedId = selectedPaper?.id;
		const keep = selectedId && next.nodes.some((node) => node.id === selectedId);
		if (!keep) {
			const seed = next.nodes.find((node) => node.isSeed) ?? null;
			selectedPaper = seed;
			selectedEdge = null;
			showDetail(seed);
		}
		status.textContent = `${note} · ${next.nodes.length} 篇 · ${next.edges.length} 条关系`;
	};

	const currentSeedId = (): string | null => graph?.nodes.find((node) => node.isSeed)?.id ?? null;

	const persistGrafted = async (store: Record<string, string[]>): Promise<void> => {
		deps.getSettings().graftedBySeed = store;
		await deps.persistSettings?.();
	};

	const removePaper = (paper: PaperNode): void => {
		if (!graph || paper.isSeed) return;
		hideNodeMenu();
		const next = omitNode(graph, paper.id);
		if (!next) return;
		hiddenIds.add(paper.id);
		const seedId = currentSeedId();
		if (seedId) void persistGrafted(forgetGrafted(deps.getSettings().graftedBySeed ?? {}, seedId, paper.id));
		applyEdit(refreshDerived(next), "已去掉 1 篇");
	};

	const expandPaper = async (paper: PaperNode): Promise<void> => {
		if (!graph) return;
		hideNodeMenu();
		const settings = deps.getSettings();
		const slots = Math.min(EXPAND_CAP, settings.maxNodes - graph.nodes.length);
		if (slots <= 0) {
			status.textContent = `已到上限（${settings.maxNodes} 篇），先删几点再深挖`;
			return;
		}
		const token = generation;
		const host = graph;
		const seedId = currentSeedId();
		status.textContent = `正在从「${paper.title.slice(0, 24)}」扩展…`;
		try {
			const oa = new OpenAlexClient(deps.getJson, { apiKey: settings.apiKey, contactEmail: settings.contactEmail });
			const { papers, lists } = await expandAround(oa, host, paper, hiddenIds, settings, slots);
			if (disposed || token !== generation || graph !== host) return;
			if (papers.length === 0) {
				status.textContent = "没有可并入的新文献";
				return;
			}
			applyEdit(refreshDerived(graftNodes(host, papers, lists)), `已并入 ${papers.length} 篇`, paper.id);
			if (seedId) {
				void persistGrafted(rememberGrafted(settings.graftedBySeed ?? {}, seedId, papers.map((item) => item.id)));
			}
		} catch (error) {
			if (disposed || token !== generation || graph !== host) return;
			status.textContent = error instanceof Error ? error.message : "深挖失败。";
		}
	};

	deleteItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) removePaper(paper);
	});
	expandItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (paper) void expandPaper(paper);
	});

	const applyGraph = (next: SimilarityGraph): void => {
		graph = next;
		hiddenIds = new Set();
		hideNodeMenu();
		timelineMetaGraph = null;
		timelineMetaRequested = false;
		timelineMetaLoading = false;
		timelineMetaError = "";
		timelineExtraMeta.clear();
		timelinePickedMeta.clear();
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		empty.hidden = true;
		hideResults();
		const seed = next.nodes.find((node) => node.isSeed) ?? null;
		if (seed) {
			seedSummary.hidden = false;
			seedTitle.textContent = seed.title || seed.id;
			seedMeta.textContent = [seed.authors, seed.year ?? "年份不详", "种子论文"].filter(Boolean).join(" · ");
		}
		showDetail(seed);
		map.setGraph(next.nodes, next.edges, next.seedScore);
		graphKey.setStats(next.nodes, next.edges);
		graphKey.paintColor(layoutMode);
		// setGraph 不再重置布局；把轨道按钮当前选中的布局回灌给画布。
		map.setLayout(layoutMode);
		map.setColorMode(defaultColorMode(layoutMode));
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		else chrome?.clearYears();
		scrubYear = null;
		paintLists();
		const strategyNames = [
			next.strategies.references ? "参考文献" : "",
			next.strategies.citations ? "施引" : "",
			next.strategies.related ? "相关作品" : "",
		].filter(Boolean);
		const warning = next.warnings.map((item) => WARNING_TEXT[item]).join("；");
		const sampleNote = next.retrievalStats
			? ` · 采样 ${samplingText(next.retrievalStats.references, "参考")}/${samplingText(next.retrievalStats.citations, "施引")}/${samplingText(next.retrievalStats.related, "相关")}`
			: "";
		status.textContent = `${next.nodes.length} 篇 · ${next.edges.length} 条关系 · ${strategyNames.join("、")}${
			next.skippedNonResearch ? ` · 滤除书评等非研究记录 ${next.skippedNonResearch} 条` : ""
		}${sampleNote}${warning ? ` · ${warning}` : ""}`;
		void enrichOpenCitations(next);
	};

	const enrichOpenCitations = async (next: SimilarityGraph): Promise<void> => {
		const token = generation;
		const doiToId = new Map(next.nodes.flatMap(p => {
			const doi = doiOf(p.doiUrl); return doi ? [[doi, p.id] as const] : [];
		}));
		const client = new OpenCitationsClient(deps.getJson, deps.getSettings().openCitationsToken);
		// Bounded sequential outgoing lookups; no unbounded high-citation responses.
		const papers = next.nodes.filter(p => doiOf(p.doiUrl)).slice(0, 20);
		let completed = 0, failed = 0;
		for (const paper of papers) {
			if (disposed || graph !== next || token !== generation) return;
			try {
				const rows = await client.references(doiOf(paper.doiUrl)!);
				if (disposed || graph !== next || token !== generation) return;
				completed++;
				for (const row of rows) {
					const pids = doisFromOpenCitation(row);
					const a = pids.citing.map(d => doiToId.get(d)).find(Boolean);
					const b = pids.cited.map(d => doiToId.get(d)).find(Boolean);
					if (a && b) mergeOpenCitation(next, a, b);
				}
			} catch { failed++; }
		}
		if (disposed || graph !== next || token !== generation) return;
		map.updateGraphData(next.edges);
		graphKey.setStats(next.nodes, next.edges);
		if (selectedEdge) showEdgeDetail(selectedEdge);
		else showDetail(selectedPaper);
		paintLists();
		status.textContent += ` · OpenCitations 检查 ${completed}/${papers.length} 篇，失败 ${failed}；当前 ${next.edges.length} 条关系`;
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

	const buildResolved = async (target: { kind: "doi" | "openalex"; value: string }): Promise<void> => {
		const token = ++generation;
		setBusy(true);
		clearError();
		hideResults();
		status.textContent = STAGE_TEXT.resolving;
		try {
			const settings = deps.getSettings();
			const oa = client();
			const next = await loadNeighborhood(
				oa,
				target,
				settings,
				(stage) => {
					if (token !== generation) return;
					status.textContent = STAGE_TEXT[stage];
				},
				reconcileSource(),
				new CrossrefClient(deps.getJson, settings.contactEmail),
			);
			if (disposed || token !== generation) return;
			applyGraph(next);
			const seed = next.nodes.find((node) => node.isSeed);
			const extras = seed ? graftedFor(settings.graftedBySeed ?? {}, seed.id) : [];
			if (extras.length === 0) return;
			status.textContent = "正在恢复深挖并入的文献…";
			const restored = await restoreGraftedMembers(oa, next, extras, settings);
			if (disposed || token !== generation || graph !== next) return;
			const added = restored.nodes.length - next.nodes.length;
			if (added <= 0) return;
			applyEdit(restored, `已恢复 ${added} 篇深挖文献`);
		} catch (error) {
			if (token !== generation) return;
			showError(error instanceof Error ? error.message : "构建图谱失败。");
			status.textContent = graph ? status.textContent : "图谱还没有建起来。";
		} finally {
			if (token === generation) setBusy(false);
		}
	};

	seedItem.addEventListener("click", () => {
		const paper = graph?.nodes.find((node) => node.id === nodeMenu.dataset.paperId);
		if (!paper || paper.isSeed) return;
		hideNodeMenu();
		input.value = paper.id;
		void buildResolved({ kind: "openalex", value: paper.id });
	});

	const showHits = (hits: SearchHit[]): void => {
		results.replaceChildren();
		if (hits.length === 0) {
			results.hidden = true;
			showError("没有匹配的作品。换一个标题，或直接粘贴 DOI。");
			return;
		}
		clearError();
		el(results, "p", "cpo-results-label", "选择种子论文");
		for (const hit of hits) {
			const button = el(results, "button", "cpo-hit") as HTMLButtonElement;
			button.type = "button";
			el(button, "span", "cpo-hit-title", hit.title);
			const year = hit.year === null ? "年份不详" : String(hit.year);
			el(button, "span", "cpo-hit-meta", `${year} · ${hit.authors} · 被引 ${formatCount(hit.citedByCount)}`);
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
			showError("请输入 DOI、OpenAlex ID，或至少两个字的标题。");
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
				status.textContent = hits.length ? `找到 ${hits.length} 篇，点选种子论文。` : "没有匹配的作品。";
			} catch (error) {
				if (token !== generation) return;
				showError(error instanceof Error ? error.message : "搜索失败。");
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
	example.addEventListener("click", () => {
		input.value = EXAMPLE_DOI;
		void buildResolved({ kind: "doi", value: EXAMPLE_DOI });
	});
	zoomIn.addEventListener("click", () => map.zoomBy(1.2));
	zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.2));
	fit.addEventListener("click", () => map.fit(true));

	const onKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			hideNodeMenu();
			showDetail(null);
		}
	};
	root.addEventListener("keydown", onKey);
	const onPointerDown = (event: PointerEvent): void => {
		if (!nodeMenu.hidden && !nodeMenu.contains(event.target as Node)) hideNodeMenu();
	};
	window.addEventListener("pointerdown", onPointerDown);
	const onSettings = (): void => {
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
	};
	window.addEventListener("research-connected-settings", onSettings);
	const onTheme = (): void => {
		map.resize();
	};
	window.addEventListener("research-connected-theme", onTheme);

	const observer = observeResponsiveMode(root, () => {
		map.resize();
	});
	observer.observe(stage);
	requestAnimationFrame(() => map.resize());

	const initial = deps.initialTarget ?? (deps.initialDoi ? { kind: "doi" as const, value: deps.initialDoi } : null);
	if (initial) {
		input.value = initial.value;
		void buildResolved(initial);
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
		sheet.setSummary("DOI 引用路径", path ? `${path.length - 1} 步 · 预算内` : "未找到");
		el(detail, "p", "cpo-fact-note", "预算内在已抓取引用列表上搜索的结果，不是全局最短路径。");
		el(
			detail,
			"p",
			"cpo-meta",
			`方向：${pathResult.direction === "citing-to-cited" ? "施引 → 被引" : "被引 → 施引"} · 检查 ${pathResult.checked}/${pathResult.budget} 个节点${pathResult.exhausted ? " · 预算提前耗尽" : ""}`,
		);
		if (!path) {
			el(detail, "p", "cpo-agg-empty", "当前采样范围内没有连通路径。可加深采样后再试。");
			return;
		}
		if (pathResult.paths.length > 1) {
			const nav = el(detail, "div", "cpo-tool-row");
			const label = el(nav, "span", "cpo-meta", `同长路径 ${pathIndex + 1}/${pathResult.paths.length}`);
			const prev = el(nav, "button", "cpo-text-btn", "上一条") as HTMLButtonElement;
			prev.type = "button";
			prev.disabled = pathIndex <= 0;
			prev.onclick = () => { pathIndex -= 1; paintDoiPath(); };
			const next = el(nav, "button", "cpo-text-btn", "下一条") as HTMLButtonElement;
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
			const doi = normalizeDoi(paper?.doiUrl) ?? "无 DOI";
			el(row, "p", "cpo-meta", `${id} · ${doi}${i < path.length - 1 ? " →" : ""}`);
			if (paper && graph?.nodes.some((node) => node.id === paper.id)) {
				const open = el(row, "button", "cpo-text-btn", "查看") as HTMLButtonElement;
				open.type = "button";
				open.onclick = () => { activateGraphTab(); showDetail(paper); };
			}
		}
	};

	const openDoiPathSearch = (): void => {
		if (!graph) {
			showError("请先构建图谱。DOI 路径只在已抓取的引用列表上搜索。");
			return;
		}
		const raw = window.prompt("起点与终点（DOI 或 OpenAlex ID，用空格或 → 分隔）");
		if (raw === null) return;
		const parts = raw.split(/\s*(?:→|->|\s)\s*/).map((part) => part.trim()).filter(Boolean);
		if (parts.length < 2) {
			showError("请提供两个端点，例如：10.1/a → 10.2/b");
			return;
		}
		const pool = [...graph.nodes, ...graph.catalog];
		const start = resolvePathEndpoint(parts[0]!, pool, normalizeDoi, shortId);
		const end = resolvePathEndpoint(parts[1]!, pool, normalizeDoi, shortId);
		if (!start || !end) {
			showError("端点必须是当前图谱已抓取的论文（DOI 或 OpenAlex ID）。");
			return;
		}
		clearError();
		pathResult = findBudgetedCitationPath(graph.referenceLists, start, end, DEFAULT_PATH_BUDGET);
		pathIndex = 0;
		status.textContent = pathResult.paths.length
			? `预算内找到 ${pathResult.paths.length} 条路径（检查 ${pathResult.checked}/${pathResult.budget}）`
			: `预算内未找到路径（检查 ${pathResult.checked}/${pathResult.budget}${pathResult.exhausted ? "，提前耗尽" : ""}）`;
		paintDoiPath();
	};

	return {
		openDoiPathSearch,
		destroy: () => {
			disposed = true;
			generation += 1;
			chrome?.destroy();
			sheet.destroy();
			stopSidebarResize();
			observer.disconnect();
			root.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("research-connected-settings", onSettings);
			window.removeEventListener("research-connected-theme", onTheme);
			map.destroy();
			root.replaceChildren();
			root.classList.remove("cpo-root", "is-narrow");
		},
	};
}

function samplingText(stats: { accepted: number; pages: number; partial: boolean }, label: string): string {
	return `${label}${stats.accepted}${stats.partial ? `/${stats.pages}页` : ""}`;
}

async function copyPane(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// The export panel still shows the text when the clipboard is blocked.
	}
}

function addLink(parent: HTMLElement, label: string, onClick: () => void): void {
	const button = el(parent, "button", "cpo-link", label) as HTMLButtonElement;
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
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
