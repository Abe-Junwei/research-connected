import { DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { EXAMPLE_DOI } from "./constants";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { evidenceText } from "./graph-filter";
import { mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { SimilarityMap } from "./map-canvas";
import { loadNeighborhood, type LoadWarning, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { OpenCitationsClient, SemanticScholarClient, doisFromOpenCitation } from "./citation-sources";
import { mergeOpenCitation, evidenceFromSemanticCitation, evidenceLabel } from "./citation-evidence";
import { drawFlows } from "./analysis-view";
import { buildNarrativeEvidence, type ResearchNarrative, type NarrativeEvidence } from "./narrative";
import { summarizeWithLlmPost } from "./llm";
import { classifyQuery, toSearchHit } from "./paper";
import { findEdge } from "./relation";
import { allowedExternalUrl } from "./safe-url";
import type { ConnectedPapersSettings } from "./settings";
import type { GraphEdge, Origin, PaperNode, SearchHit } from "./types";
import { formatCount, snippet } from "./visual";

export interface AppDeps {
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
	postJson?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<unknown>;
	openExternal: (url: string) => void;
	createNote?: (filename: string, markdown: string) => Promise<void>;
	initialDoi?: string;
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
};

const ORIGIN_TEXT: Record<Origin, string> = {
	seed: "种子论文",
	reference: "种子的参考文献",
	citation: "引用了种子",
	related: "OpenAlex 相关作品",
};

/** Pane UI shared by the Obsidian view and the browser preview. */
export function mountGraphApp(root: HTMLElement, deps: AppDeps): () => void {
	root.classList.add("cpo-root");
	root.replaceChildren();

	const bar = el(root, "header", "cpo-bar");
	const form = el(bar, "form", "cpo-form");
	const input = el(form, "input", "cpo-input") as HTMLInputElement;
	input.type = "text";
	input.placeholder = "DOI、OpenAlex ID 或论文标题";
	input.autocomplete = "off";
	input.spellcheck = false;
	input.setAttribute("aria-label", "种子论文");
	const submit = el(form, "button", "cpo-primary", "构建图谱") as HTMLButtonElement;
	submit.type = "submit";
	const example = el(bar, "button", "cpo-ghost", "示例 DOI") as HTMLButtonElement;
	example.type = "button";
	example.title = EXAMPLE_DOI;

	const status = el(bar, "p", "cpo-status", "从一篇种子论文开始。");
	status.setAttribute("role", "status");
	const results = el(bar, "div", "cpo-results");
	results.hidden = true;

	const banner = el(root, "div", "cpo-banner");
	banner.hidden = true;
	banner.setAttribute("role", "alert");

	const body = el(root, "div", "cpo-body");
	const rail = el(body, "aside", "cpo-rail");
	const filterButton = el(rail, "button", "cpo-rail-filter", "筛选") as HTMLButtonElement;
	filterButton.type = "button";
	filterButton.title = "筛选 / 图例";
	filterButton.setAttribute("aria-expanded", "false");
	const layoutHost = el(rail, "div");

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

	const drawer = el(stage, "div", "cpo-drawer");
	drawer.hidden = true;
	el(drawer, "p", "cpo-drawer-title", "筛选 / 图例");
	el(drawer, "p", "cpo-side-tip", "拖拽空白处平移，滚轮或右下角按钮缩放。点选节点后，题名在底部，展开可看证据。");
	const legend = el(drawer, "div", "cpo-legend");
	legend.hidden = true;
	const rampWrap = el(legend, "span", "cpo-ramp-wrap");
	rampWrap.hidden = true;
	el(rampWrap, "span", undefined, "较早");
	el(rampWrap, "span", "cpo-ramp");
	el(rampWrap, "span", undefined, "较新");
	el(legend, "span", undefined, "圆越大，被引越多");
	el(legend, "span", undefined, "双环是种子");
	const toolsHost = el(drawer, "div");
	filterButton.addEventListener("click", () => {
		const open = drawer.hidden;
		drawer.hidden = !open;
		filterButton.setAttribute("aria-expanded", open ? "true" : "false");
		filterButton.classList.toggle("is-on", open);
	});

	const zoom = el(stage, "div", "cpo-zoom");
	const zoomIn = el(zoom, "button", "cpo-icon", "+") as HTMLButtonElement;
	const zoomOut = el(zoom, "button", "cpo-icon", "−") as HTMLButtonElement;
	const fit = el(zoom, "button", "cpo-icon cpo-fit", "适配") as HTMLButtonElement;
	for (const button of [zoomIn, zoomOut, fit]) button.type = "button";
	zoomIn.setAttribute("aria-label", "放大");
	zoomOut.setAttribute("aria-label", "缩小");
	fit.setAttribute("aria-label", "适应窗口");

	const actionsBar = el(root, "div", "cpo-actions-bar");
	const sheetHost = el(root, "section");
	const sheet = mountBottomSheet(sheetHost);
	const detail = el(sheet.body, "div", "cpo-detail");
	const listPanel = el(sheet.body, "div", "cpo-agg");
	listPanel.hidden = true;
	const map = new SimilarityMap(canvas, tooltip, stage);
	let graph: SimilarityGraph | null = null;
	let tab: GraphTab = "graph";
	let narrative: ResearchNarrative | null = null;
	let narrativeInput: NarrativeEvidence | null = null;
	let narrativeMeta = "";
	let narrativeError = "";
	let analysisMode: "sankey" | "chord" = "sankey";
	let scrubYear: number | null = null;
	let chrome: GraphChrome | null = null;
	let selectedPaper: PaperNode | null = null;
	let generation = 0;
	let composing = false;
	let disposed = false;
	let narrativeBusy = false;
	let settingsRevision = 0;
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
		sheetHost.classList.toggle("cpo-sheet-analysis", tab === "analysis" || tab === "research");
		detail.hidden = tab !== "graph";
		if (tab === "research") {
			paintResearch();
			return;
		}
		if (tab === "analysis") {
			paintAnalysis();
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
		if (rows.length === 0) {
			const empty = document.createElement("p");
			empty.className = "cpo-agg-empty";
			empty.textContent = "当前子图里没有达到「经常」的文献（至少被数到 2 次）。采样到的引用列表可能不完整。";
			listPanel.append(empty);
			return;
		}
		const list = document.createElement("ol");
		list.className = "cpo-agg-list";
		for (const row of rows) {
			const item = document.createElement("li");
			const button = document.createElement("button");
			button.type = "button";
			button.className = "cpo-agg-item";
			button.textContent = `${row.paper.year ?? "—"} · ${row.paper.title} · ${noun} ${row.count} 次`;
			button.addEventListener("click", () => {
				if (graph?.nodes.some((node) => node.id === row.paper.id)) showDetail(row.paper);
			});
			item.append(button);
			list.append(item);
		}
		listPanel.append(list);
	};

	const paintAnalysis = (): void => {
		listPanel.hidden = false;
		listPanel.replaceChildren();
		el(listPanel, "h3", "cpo-kicker", "分析视图");
		el(listPanel, "p", "cpo-side-tip", "次要分析视图：只使用当前图谱和筛选结果，不会发起新的数据请求。");
		const controls = el(listPanel, "div", "cpo-tools cpo-tool-row");
		const sankey = el(controls, "button", "cpo-tool", "桑基") as HTMLButtonElement;
		const chord = el(controls, "button", "cpo-tool", "弦图") as HTMLButtonElement;
		sankey.classList.toggle("is-on", analysisMode === "sankey");
		chord.classList.toggle("is-on", analysisMode === "chord");
		sankey.addEventListener("click", () => { analysisMode = "sankey"; paintAnalysis(); });
		chord.addEventListener("click", () => { analysisMode = "chord"; paintAnalysis(); });
		if (!graph) return;
		const visible = shownNodes();
		const visibleIds = new Set(visible.map((node) => node.id));
		const pairs = new Map<string, GraphEdge>();
		const add = (source: string, target: string) => {
			if (!visibleIds.has(source) || !visibleIds.has(target) || source === target) return;
			pairs.set(source + "\0" + target, { source, target, weight: 0.1, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target" });
		};
		for (const [source, refs] of graph.referenceLists) for (const target of refs) add(source, target);
		for (const e of graph.citationEvidence?.entries() ?? []) add(e.citingId, e.citedId);
		const edges = [...pairs.values()];
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.classList.add("cpo-analysis-svg");
		svg.setAttribute("viewBox", "0 0 760 440");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", analysisMode === "sankey" ? "按年份聚合的引用流" : "按社区聚合的引用关系");
		listPanel.append(svg);
		const selection = el(listPanel, "div");
		drawFlows(svg, visible, edges, analysisMode, map.getCommunities(), papers => {
			selection.replaceChildren();
			for (const paper of papers) addLink(selection, paper.title, () => {
				showDetail(paper); detail.hidden = false;
			});
		});
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
			button.addEventListener("click", () => { if (paper) { showDetail(paper); detail.hidden = false; } });
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

	chrome = mountGraphChrome(toolsHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: "force2d",
		color: "community",
		noteButton: Boolean(deps.createNote),
		researchButton: llmReady(),
		analysisButton: true,
		actionsHost: actionsBar,
		layoutHost,
		onLayout: (mode) => map.setLayout(mode),
		onColor: (mode) => {
			map.setColorMode(mode);
			rampWrap.hidden = mode !== "year";
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

	const showDetail = (paper: PaperNode | null): void => {
		selectedPaper = paper;
		detail.replaceChildren();
		if (!paper || !graph) {
			map.setSelected(null);
			sheet.setSummary("点选节点查看论文", "");
			el(detail, "p", "cpo-side-tip", "点选节点查看题名、年份、作者和证据。");
			return;
		}
		map.setSelected(paper.id);
		const year = paper.year === null ? "年份不详" : String(paper.year);
		sheet.setSummary(paper.title, `${year} · 被引 ${formatCount(paper.citedByCount)}`);
		el(detail, "p", "cpo-meta", `${year} · 被引 ${formatCount(paper.citedByCount)} · ${ORIGIN_TEXT[paper.origin]}`);
		if (!paper.isSeed) {
			const score = graph.seedScore.get(paper.id);
			if (score !== undefined) {
				el(detail, "p", "cpo-score", `与种子相近程度 ${score.toFixed(2)}`);
			}
		}
		el(detail, "p", "cpo-authors", paper.authors);
		const facets = [
			paper.language ? `语言 ${paper.language}` : "",
			paper.workType ? `类型 ${paper.workType}` : "",
			paper.concepts.length > 0 ? `概念 ${paper.concepts.slice(0, 3).join("、")}` : "",
		].filter(Boolean);
		if (facets.length > 0) el(detail, "p", "cpo-meta", facets.join(" · "));
		const seedNode = graph.nodes.find((node) => node.isSeed) ?? null;
		if (seedNode && !paper.isSeed) {
			const link = findEdge(graph.edges, paper.id, seedNode.id);
			const from = link ? graph.nodes.find((node) => node.id === link.source) : undefined;
			const to = link ? graph.nodes.find((node) => node.id === link.target) : undefined;
			if (link && from && to) {
				el(detail, "p", "cpo-evidence", evidenceText(link, from, to, edgeSources(link)));
				const pairs = directPairs(link);
				for (const pair of pairs) {
					const evidence = graph.citationEvidence?.get(pair.citingId, pair.citedId) ?? null;
					if (evidence) {
						el(detail, "p", "cpo-evidence", `证据：${evidenceLabel(evidence)} · ${evidence.sources.join(" + ")}`);
						for (const context of evidence.contexts.slice(0, 5)) el(detail, "blockquote", "cpo-side-tip", context);
					}
				}
				if (pairs.length > 0) {
					const loaded = semanticLoaded(pairs);
					const semanticButton = el(detail, "button", "cpo-link", loaded ? "已加载引用语义" : "读取 Semantic Scholar 引用语义") as HTMLButtonElement;
					semanticButton.type = "button";
					semanticButton.disabled = loaded;
					if (!loaded) semanticButton.addEventListener("click", () => void loadSemanticEvidence(pairs, semanticButton));
				}
			}
		}
		el(detail, "h3", "cpo-kicker", "摘要");
		el(detail, "p", "cpo-abstract", paper.abstract ? snippet(paper.abstract) : "OpenAlex 没有提供摘要。");
		const openAlex = allowedExternalUrl(paper.openAlexUrl);
		if (openAlex) addLink(detail, "在 OpenAlex 中打开", () => deps.openExternal(openAlex));
		if (paper.doiUrl) {
			const doi = allowedExternalUrl(paper.doiUrl);
			if (doi) addLink(detail, "打开 DOI", () => deps.openExternal(doi));
		}
	};

	const loadSemanticEvidence = async (
		pairs: Array<{ citingId: string; citedId: string }>,
		button: HTMLButtonElement,
	): Promise<void> => {
		if (!graph) return;
		const requestGraph = graph, token = generation;
		button.disabled = true;
		button.textContent = "正在读取引用语义…";
		try {
			const settings = deps.getSettings();
			const client = new SemanticScholarClient(deps.getJson, settings.semanticScholarApiKey);
			let partial = false;
			for (const pair of pairs) {
				const citing = [...graph.nodes, ...graph.catalog].find((item) => item.id === pair.citingId);
				const cited = [...graph.nodes, ...graph.catalog].find((item) => item.id === pair.citedId);
				const citedDoi = doiOf(cited?.doiUrl);
				const citingDoi = doiOf(citing?.doiUrl);
				if (!citedDoi || !citingDoi) continue;
				const result = await client.referenceEvidence(citingDoi);
				if (disposed || graph !== requestGraph || token !== generation) return;
				partial = partial || result.partial;
				const row = result.data.find(item => doiOf(item.citedPaper?.externalIds?.DOI) === citedDoi);
				if (row) requestGraph.citationEvidence?.set(evidenceFromSemanticCitation(pair.citingId, pair.citedId, row));
				else { button.textContent = result.partial ? "已查 3000 条参考文献，未匹配（结果不完整）" : "未找到匹配的引用语义"; button.disabled = false; return; }
			}
			showDetail(selectedPaper);
			if (partial) el(detail, "p", "cpo-side-tip", "Semantic Scholar 只返回了前 3000 条参考文献，引用语义可能不完整。");
		} catch (error) {
			if (disposed || graph !== requestGraph || token !== generation) return;
			button.textContent = error instanceof Error ? error.message : "Semantic Scholar 请求失败";
			button.disabled = false;
		}
	};

	const directPairs = (edge: GraphEdge): Array<{ citingId: string; citedId: string }> => {
		if (edge.direct === "source-cites-target") return [{ citingId: edge.source, citedId: edge.target }];
		if (edge.direct === "target-cites-source") return [{ citingId: edge.target, citedId: edge.source }];
		if (edge.direct === "mutual") return [
			{ citingId: edge.source, citedId: edge.target },
			{ citingId: edge.target, citedId: edge.source },
		];
		return [];
	};
	const edgeSources = (edge: GraphEdge): string => {
		const sources = new Set(directPairs(edge).flatMap(p => graph?.citationEvidence?.get(p.citingId, p.citedId)?.sources ?? []));
		return sources.size ? [...sources].join(" + ") : "OpenAlex 采样";
	};
	const semanticLoaded = (pairs: Array<{ citingId: string; citedId: string }>): boolean =>
		pairs.every(pair => graph?.citationEvidence?.get(pair.citingId, pair.citedId)?.sources.includes("semantic-scholar"));

	map.onSelect = (paper) => showDetail(paper);
	map.onEdgeSelect = edge => {
		if (!graph) return;
		const a = graph.nodes.find(p => p.id === edge.source), b = graph.nodes.find(p => p.id === edge.target);
		if (!a || !b) return;
		detail.replaceChildren(); detail.hidden = false; sheet.setExpanded(true);
		sheet.setSummary("引用证据", "");
		el(detail, "p", "cpo-evidence", evidenceText(edge, a, b, edgeSources(edge)));
		for (const pair of directPairs(edge)) {
			const evidence = graph.citationEvidence?.get(pair.citingId, pair.citedId);
			if (evidence) {
				el(detail, "p", "cpo-evidence", evidence.sources.join(" + ") + " · " + evidenceLabel(evidence));
				for (const context of evidence.contexts.slice(0, 5)) el(detail, "blockquote", "cpo-side-tip", context);
			}
		}
		const pairs = directPairs(edge);
		if (pairs.length) {
			const loaded = semanticLoaded(pairs);
			const button = el(detail, "button", "cpo-link", loaded ? "已加载引用语义" : "读取 Semantic Scholar 引用语义");
			button.type = "button";
			button.disabled = loaded;
			if (!loaded) button.onclick = async () => {
				const current = graph;
				await loadSemanticEvidence(pairs, button);
				if (!disposed && current === graph && !button.isConnected) map.onEdgeSelect?.(edge);
			};
		}
	};
	showDetail(null);

	const applyGraph = (next: SimilarityGraph): void => {
		graph = next;
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		empty.hidden = true;
		legend.hidden = false;
		hideResults();
		const seed = next.nodes.find((node) => node.isSeed) ?? null;
		showDetail(seed);
		map.setGraph(next.nodes, next.edges, next.seedScore);
		const years = next.nodes.map((node) => node.year).filter((year): year is number => year !== null);
		if (years.length) chrome?.setYears(Math.min(...years), Math.max(...years));
		scrubYear = null;
		paintLists();
		const strategyNames = [
			next.strategies.references ? "参考文献" : "",
			next.strategies.citations ? "施引" : "",
			next.strategies.related ? "相关作品" : "",
		].filter(Boolean);
		const warning = next.warnings.map((item) => WARNING_TEXT[item]).join("；");
		status.textContent = `${next.nodes.length} 篇 · ${next.edges.length} 条关系 · ${strategyNames.join("、")}${
			warning ? ` · ${warning}` : ""
		}`;
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
		showDetail(selectedPaper);
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

	const buildResolved = async (target: { kind: "doi" | "openalex"; value: string }): Promise<void> => {
		const token = ++generation;
		setBusy(true);
		clearError();
		hideResults();
		status.textContent = STAGE_TEXT.resolving;
		try {
			const next = await loadNeighborhood(client(), target, deps.getSettings(), (stage) => {
				if (token !== generation) return;
				status.textContent = STAGE_TEXT[stage];
			});
			if (token !== generation) return;
			applyGraph(next);
		} catch (error) {
			if (token !== generation) return;
			showError(error instanceof Error ? error.message : "构建图谱失败。");
			status.textContent = graph ? status.textContent : "图谱还没有建起来。";
		} finally {
			if (token === generation) setBusy(false);
		}
	};

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
		if (event.key === "Escape") showDetail(null);
	};
	root.addEventListener("keydown", onKey);
	const onSettings = (): void => {
		settingsRevision++;
		chrome?.setResearchVisible(llmReady());
		narrative = null;
		narrativeInput = null;
		narrativeError = "";
		if (!llmReady() && tab === "research") {
			tab = "graph";
			listPanel.replaceChildren();
			listPanel.hidden = true;
		}
		paintLists();
	};
	window.addEventListener("research-connected-settings", onSettings);

	const observer = new ResizeObserver(() => {
		root.classList.toggle("is-narrow", root.clientWidth < 520);
		map.resize();
		if (!map.hasAdjusted()) map.fit();
	});
	observer.observe(root);
	observer.observe(stage);
	requestAnimationFrame(() => map.resize());

	if (deps.initialDoi) {
		input.value = deps.initialDoi;
		void buildResolved({ kind: "doi", value: deps.initialDoi });
	}

	return () => {
		disposed = true;
		generation += 1;
		chrome?.destroy();
		sheet.destroy();
		observer.disconnect();
		root.removeEventListener("keydown", onKey);
		window.removeEventListener("research-connected-settings", onSettings);
		map.destroy();
		root.replaceChildren();
		root.classList.remove("cpo-root", "is-narrow");
	};
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

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
	return document.createElementNS("http://www.w3.org/2000/svg", tag);
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
