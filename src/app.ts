import { DERIVATIVE_DEFINITION, PRIOR_DEFINITION, derivativeWorks, priorWorks } from "./aggregates";
import { EXAMPLE_DOI } from "./constants";
import { noteFilename, noteSkeleton, orderedForExport, toBibTeX, toMarkdownTable, toYamlList } from "./export-graph";
import { evidenceText } from "./graph-filter";
import { mountBottomSheet, mountGraphChrome, type ExportKind, type GraphChrome, type GraphTab } from "./graph-chrome";
import { SimilarityMap } from "./map-canvas";
import { loadNeighborhood, type LoadWarning, type SimilarityGraph } from "./neighborhood";
import { OpenAlexClient, type GetJson } from "./openalex";
import { classifyQuery, toSearchHit } from "./paper";
import { findEdge } from "./relation";
import { allowedExternalUrl } from "./safe-url";
import type { ConnectedPapersSettings } from "./settings";
import type { Origin, PaperNode, SearchHit } from "./types";
import { formatCount, snippet } from "./visual";

export interface AppDeps {
	getSettings: () => ConnectedPapersSettings;
	getJson: GetJson;
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

	const sheetHost = el(root, "section");
	const sheet = mountBottomSheet(sheetHost);
	const actionsHost = el(sheet.body, "div");
	const detail = el(sheet.body, "div", "cpo-detail");
	const listPanel = el(sheet.body, "div", "cpo-agg");
	listPanel.hidden = true;
	const map = new SimilarityMap(canvas, tooltip, stage);
	let graph: SimilarityGraph | null = null;
	let tab: GraphTab = "graph";
	let scrubYear: number | null = null;
	let chrome: GraphChrome | null = null;
	let selectedPaper: PaperNode | null = null;
	let generation = 0;
	let composing = false;

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

	chrome = mountGraphChrome(toolsHost, {
		layouts: ["force2d", "temporal", "radial"],
		layout: "force2d",
		color: "community",
		noteButton: Boolean(deps.createNote),
		actionsHost,
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
			sheet.setExpanded(true);
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
			if (link && from && to) el(detail, "p", "cpo-evidence", evidenceText(link, from, to));
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

	map.onSelect = (paper) => showDetail(paper);
	showDetail(null);

	const applyGraph = (next: SimilarityGraph): void => {
		graph = next;
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

	const observer = new ResizeObserver(() => {
		root.classList.toggle("is-narrow", root.clientWidth < 520);
		map.resize();
		if (!map.hasAdjusted()) map.fit();
	});
	observer.observe(root);
	requestAnimationFrame(() => map.resize());

	if (deps.initialDoi) {
		input.value = deps.initialDoi;
		void buildResolved({ kind: "doi", value: deps.initialDoi });
	}

	return () => {
		generation += 1;
		chrome?.destroy();
		sheet.destroy();
		observer.disconnect();
		root.removeEventListener("keydown", onKey);
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
