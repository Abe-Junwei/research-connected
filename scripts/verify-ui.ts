import assert from "node:assert/strict";
import { derivativeWorks, priorWorks } from "../src/aggregates";
import { directCitationEdges, EMPTY_FLOWS_TEXT } from "../src/analysis-view";
import { CitationEvidenceStore, directEvidence, edgeCitationPairs, evidenceBadges } from "../src/citation-evidence";
import {
	buildCitationTimeline,
	TIMELINE_EMPTY_TEXT,
	TIMELINE_IMPACT_NOTE,
	TIMELINE_META_LIMIT,
	TIMELINE_SAMPLING_NOTE,
	TIMELINE_SCOPE_NOTE,
	missingReferenceIds,
} from "../src/citation-timeline";
import { evidenceText, focusNodes, SIMILARITY_NOT_CITATION } from "../src/graph-filter";
import { buildCommunityRegions } from "../src/community-regions";
import type { SimilarityGraph } from "../src/neighborhood";
import { explainRelation } from "../src/relation";
import { layoutTimeline, TIMELINE_MIN_WIDTH, UNKNOWN_LIMIT, ZONE_LIMIT } from "../src/timeline-view";
import { placeLayout } from "../src/layout-modes";
import { clampSidebarWidth } from "../src/sidebar-resize";
import type { GraphEdge, PaperNode } from "../src/types";
import { syntheticGraph } from "./perf-fixture";

function edge(patch: Partial<GraphEdge>): GraphEdge {
	return {
		source: "A",
		target: "B",
		weight: 0.2,
		coupling: 0,
		sharedRefs: 0,
		coCitation: 0,
		coCitedBy: 0,
		direct: "none",
		...patch,
	};
}

function paper(id: string, origin: PaperNode["origin"]): PaperNode {
	return {
		id,
		title: `Title ${id}`,
		year: 2010,
		citedByCount: 10,
		authors: "A",
		abstract: "",
		doiUrl: null,
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: null,
		workType: null,
		concepts: [],
		retracted: false,
	};
}

const ada = { authors: "Ada Lovelace", year: 2015 };
const grace = { authors: "Grace Hopper", year: 1990 };

/** Detail and edge evidence copy: source labels and the four relation kinds. */
function evidenceCopy(): void {
	const direct = edge({ direct: "source-cites-target", weight: 0.42 });
	assert.match(explainRelation(direct, ada, grace), /Lovelace 2015 引用了 Hopper 1990/);
	assert.match(explainRelation(direct, ada, grace), /相近 0\.42/);
	assert.match(explainRelation(edge({ direct: "target-cites-source" }), ada, grace), /Hopper 1990 引用了 Lovelace 2015/);
	assert.match(explainRelation(edge({ direct: "mutual" }), ada, grace), /互相引用/);
	const cocitation = edge({ coCitedBy: 3, coCitation: 0.5 });
	assert.match(explainRelation(cocitation, ada, grace), /共被引 3 次/);
	assert.doesNotMatch(explainRelation(cocitation, ada, grace), /引用了/);
	assert.match(explainRelation(edge({ sharedRefs: 4, coupling: 0.3 }), ada, grace), /共享参考文献 4 篇/);
	assert.match(explainRelation(edge({}), ada, grace), /弱连线/);

	assert.match(evidenceText(direct, ada, grace, "openalex + opencitations"), /来源：openalex \+ opencitations/);
	assert.match(evidenceText(direct, ada, grace, "opencitations"), /来源：opencitations/);
	assert.match(evidenceText(direct, ada, grace), /来源：OpenAlex 采样/);
	for (const sources of ["openalex + opencitations", "opencitations", undefined] as const) {
		const text = sources === undefined ? evidenceText(direct, ada, grace) : evidenceText(direct, ada, grace, sources);
		assert.match(text, /强度/);
		assert.match(text, /共享参考文献 0 篇/);
		assert.match(text, /共被引 0 次/);
		assert.match(text, /引用列表可能不完整/);
	}

	assert.match(evidenceText(cocitation, ada, grace), new RegExp(SIMILARITY_NOT_CITATION), "无直接引用证据时标注相似关系");
	assert.match(evidenceText(edge({ sharedRefs: 4, coupling: 0.3 }), ada, grace), new RegExp(SIMILARITY_NOT_CITATION));
	assert.match(evidenceText(edge({}), ada, grace), new RegExp(SIMILARITY_NOT_CITATION));
	assert.doesNotMatch(evidenceText(direct, ada, grace, "openalex + opencitations"), new RegExp(SIMILARITY_NOT_CITATION), "有直接引用证据时不标注");
	assert.doesNotMatch(evidenceText(edge({ direct: "mutual" }), ada, grace), new RegExp(SIMILARITY_NOT_CITATION));
}

/** 徽章判定：双源确认 / 单源记录 / 数据缺失 / 采样有限。 */
function badges(): void {
	assert.deepEqual(evidenceBadges(null), [{ label: "数据缺失", tone: "warn" }]);
	const single = { ...directEvidence(paper("A", "reference"), paper("B", "citation"), true, false) };
	assert.deepEqual(evidenceBadges(single), [{ label: "单源记录", tone: "plain" }]);
	const dual = { ...directEvidence(paper("A", "reference"), paper("B", "citation"), true, true) };
	assert.deepEqual(evidenceBadges(dual), [{ label: "双源确认", tone: "strong" }]);
	assert.deepEqual(evidenceBadges({ ...dual, confidence: "low" }), [
		{ label: "双源确认", tone: "strong" },
		{ label: "采样有限", tone: "warn" },
	]);
	assert.deepEqual(evidenceBadges({ ...single, sources: [] }), [{ label: "数据缺失", tone: "warn" }]);
	assert.deepEqual(edgeCitationPairs(edge({ direct: "source-cites-target" })), [{ citingId: "A", citedId: "B" }]);
	assert.deepEqual(edgeCitationPairs(edge({ direct: "target-cites-source" })), [{ citingId: "B", citedId: "A" }]);
	assert.equal(edgeCitationPairs(edge({ direct: "mutual" })).length, 2);
	assert.deepEqual(edgeCitationPairs(edge({})), []);
}

/** 到种子的路径高亮：开关的纯函数部分。 */
function focusPath(): void {
	const edges = [
		edge({ source: "A", target: "B", sharedRefs: 4, coupling: 0.3 }),
		edge({ source: "B", target: "S", sharedRefs: 4, coupling: 0.3 }),
	];
	const visible = () => true;
	const withPath = focusNodes("A", "S", edges, visible, true);
	assert.ok(withPath?.has("S"), "开关打开时保留到种子的路径");
	const withoutPath = focusNodes("A", "S", edges, visible, false);
	assert.equal(withoutPath?.has("S"), false, "开关关闭时只有一跳邻域");
	assert.ok(withoutPath?.has("B"));
}

/** Kumu-inspired enclosures remain geometric groupings, never inferred topic labels. */
function communityRegions(): void {
	const regions = buildCommunityRegions([
		{ id: "a", community: 0, x: 10, y: 10, shown: true },
		{ id: "b", community: 0, x: 30, y: 10, shown: true },
		{ id: "c", community: 0, x: 20, y: 30, shown: true },
		{ id: "hidden", community: 0, x: 25, y: 20, shown: false },
		{ id: "d", community: 1, x: 90, y: 90, shown: true },
	]);
	assert.equal(regions.length, 1, "只为至少三个可见成员的社区绘制圈层");
	assert.equal(regions[0]?.community, 0);
	assert.equal(regions[0]?.members, 3, "年份过滤后的隐藏点不计入边界");
	assert.ok((regions[0]?.points.length ?? 0) >= 3, "圈层由凸包形成");
	assert.ok((regions[0]?.left ?? 0) < 10, "圈层边界包含柔和留白");
}

/** 圈层布局：种子社区居中，整体紧凑，不随社区数平方根式外扩。 */
function compactCommunityLayout(): void {
	const nodes = [
		paper("S", "seed"), paper("A1", "reference"), paper("A2", "reference"),
		paper("B1", "citation"), paper("B2", "citation"), paper("B3", "citation"),
		paper("C1", "related"), paper("C2", "related"), paper("C3", "related"),
	];
	const edges = [
		edge({ source: "S", target: "A1", weight: 0.8 }),
		edge({ source: "A1", target: "A2", weight: 0.8 }),
		edge({ source: "A2", target: "S", weight: 0.8 }),
		edge({ source: "B1", target: "B2", weight: 0.8 }),
		edge({ source: "B2", target: "B3", weight: 0.8 }),
		edge({ source: "B3", target: "B1", weight: 0.8 }),
		edge({ source: "C1", target: "C2", weight: 0.8 }),
		edge({ source: "C2", target: "C3", weight: 0.8 }),
		edge({ source: "C3", target: "C1", weight: 0.8 }),
	];
	const placed = placeLayout("kumu", nodes, edges, new Map([["S", 1]]));
	const byId = new Map(placed.map((node) => [node.id, node]));
	const seed = byId.get("S")!;
	assert.ok(Math.hypot(seed.x, seed.y) < 1, "种子论文固定在圈层布局中心");
	const width = Math.max(...placed.map((node) => node.x)) - Math.min(...placed.map((node) => node.x));
	const height = Math.max(...placed.map((node) => node.y)) - Math.min(...placed.map((node) => node.y));
	assert.ok(width < 360 && height < 360, "多个社区的默认包围盒保持紧凑");
}

function evidenceSidebarSizing(): void {
	assert.equal(clampSidebarWidth(320), 320, "默认证据栏宽度保持紧凑");
	assert.equal(clampSidebarWidth(100), 260, "拖拽不会把证据栏缩到不可读");
	assert.equal(clampSidebarWidth(900), 480, "拖拽不会让证据栏重新挤占图谱");
	assert.equal(clampSidebarWidth(245.6, 220, 380), 246, "嵌入式使用自己的宽度边界");
}

/** Analysis view data: visible-node direct citation pairs from raw records. */
function analysisPairs(): void {
	const seedNode = paper("S", "seed");
	const a = paper("A", "reference");
	const b = paper("B", "citation");
	const c = paper("C", "citation");
	const d = paper("D", "citation");
	const evidence = new CitationEvidenceStore();
	evidence.set(directEvidence(a, b, false, true));
	evidence.set(directEvidence(d, a, true, false));
	const records = {
		referenceLists: new Map<string, readonly string[]>([
			["A", ["B", "S"]],
			["B", ["A", "A"]],
			["C", ["A"]],
			["S", ["A"]],
		]),
		citationEvidence: evidence,
	};

	const visible = new Set(["S", "A", "B"]);
	const edges = directCitationEdges(records, visible);
	const keys = edges.map((item) => `${item.source}->${item.target}`).sort();
	assert.deepEqual(keys, ["A->B", "A->S", "B->A", "S->A"], "both directions, evidence deduped into the same pair");
	for (const item of edges) {
		assert.equal(item.direct, "source-cites-target", "source is always the citing paper");
		assert.ok(visible.has(item.source) && visible.has(item.target), "pairs stay inside the visible set");
	}
	assert.equal(directCitationEdges(records, new Set(["A"])).length, 0, "no pair with only one endpoint visible");
	assert.equal(directCitationEdges({ referenceLists: new Map() }, visible).length, 0, "empty records, no requests, no pairs");

	const synthetic = syntheticGraph(60, 7);
	const syntheticVisible = new Set(synthetic.nodes.map((node) => node.id));
	const flowEdges = directCitationEdges(synthetic, syntheticVisible);
	assert.ok(flowEdges.length > 0, "synthetic fixture carries direct citations");
	const expected = new Set<string>();
	for (const [citing, refs] of synthetic.referenceLists) {
		for (const cited of refs) {
			if (syntheticVisible.has(citing) && syntheticVisible.has(cited) && citing !== cited) expected.add(`${citing}->${cited}`);
		}
	}
	assert.equal(flowEdges.length, expected.size, "one flow edge per visible reference-list pair");
}

/** Aggregates: exact counts, the >=2 threshold, and the 15-row cap. */
function aggregates(): void {
	const seedNode = paper("S", "seed");
	const prior = paper("P", "reference");
	const visibleCiter = paper("Q", "citation");
	const rare = paper("R", "reference");
	const deriver = paper("D", "citation");
	const seldom = paper("E", "citation");
	const graph: SimilarityGraph = {
		nodes: [seedNode, prior, visibleCiter],
		edges: [],
		seedScore: new Map([["S", 1]]),
		warnings: [],
		strategies: { references: true, citations: true, related: false },
		referenceLists: new Map([
			["S", ["P", "R", "OUT"]],
			["P", ["S"]],
			["Q", ["P", "S"]],
			["R", []],
			["D", ["S", "P", "Q"]],
			["E", ["S"]],
		]),
		catalog: [seedNode, prior, visibleCiter, rare, deriver, seldom],
		skippedNonResearch: 0,
	};
	const visible = new Set(["S", "P", "Q"]);
	assert.deepEqual(
		priorWorks(graph, visible).map((item) => [item.paper.id, item.count]),
		[["P", 2]],
		"prior: visible-subgraph citation frequency, seed excluded, count 1 excluded, unknown refs skipped",
	);
	assert.deepEqual(
		derivativeWorks(graph, visible).map((item) => [item.paper.id, item.count]),
		[["D", 3], ["Q", 2]],
		"derivative: catalog citers ranked by hits into the visible subgraph, count 1 excluded",
	);

	const many: PaperNode[] = [seedNode, prior];
	const catalog: PaperNode[] = [seedNode, prior];
	const referenceLists = new Map<string, readonly string[]>([["S", ["P"]], ["P", []]]);
	for (let i = 0; i < 20; i++) {
		const citer = paper(`C${i}`, "citation");
		catalog.push(citer);
		referenceLists.set(citer.id, ["S", "P"]);
	}
	const capped: SimilarityGraph = {
		...graph,
		nodes: many,
		referenceLists,
		catalog,
	};
	assert.equal(derivativeWorks(capped, new Set(["S", "P"])).length, 15, "derivative list is capped at 15");

	const synthetic = syntheticGraph(60, 7);
	const syntheticVisible = new Set(synthetic.nodes.map((node) => node.id));
	for (const item of priorWorks(synthetic, syntheticVisible)) {
		assert.ok(item.count >= 2, "synthetic priors respect the >=2 threshold");
	}
	assert.ok(priorWorks(synthetic, syntheticVisible).length <= 15);
	assert.ok(derivativeWorks(synthetic, syntheticVisible).length <= 15);
}

/** 引用脉络：成员资格只来自 referenceLists/evidence，不看相似边；互引、方向冲突、缺年份、未收录、空态。 */
function timeline(): void {
	const seedNode = { ...paper("S", "seed"), year: 2015 };
	const priorOld = { ...paper("P", "reference"), year: 1990 };
	const undated = { ...paper("U", "reference"), year: null, citedByCount: 50 };
	const mutual = { ...paper("M", "citation"), year: 2018 };
	const conflicted = { ...paper("C", "citation"), year: 2020 };
	const deriver = { ...paper("D", "citation"), year: 2022 };
	const similarOnly = { ...paper("X", "related"), year: 2021 };
	const evidence = new CitationEvidenceStore();
	evidence.set(directEvidence(seedNode, priorOld, true, true));
	evidence.set(directEvidence(seedNode, mutual, true, false));
	evidence.set(directEvidence(mutual, seedNode, true, false));
	evidence.set(directEvidence(seedNode, conflicted, true, false));
	evidence.set({ ...directEvidence(conflicted, seedNode, false, true), confidence: "low" });
	evidence.set(directEvidence(deriver, seedNode, true, false));
	const graph: SimilarityGraph = {
		nodes: [seedNode, priorOld, undated, mutual, conflicted, deriver, similarOnly],
		edges: [edge({ source: "S", target: "X", weight: 0.9 })],
		seedScore: new Map([["S", 1], ["X", 0.9]]),
		warnings: [],
		strategies: { references: true, citations: true, related: true },
		referenceLists: new Map([
			["S", ["P", "U", "V", "M", "C"]],
			["M", ["S"]],
			["C", ["S"]],
			["D", ["S"]],
			["X", []],
		]),
		catalog: [seedNode, priorOld, undated, mutual, conflicted, deriver, similarOnly],
		citationEvidence: evidence,
		skippedNonResearch: 0,
	};
	const view = buildCitationTimeline(graph);
	assert.equal(view.seed?.id, "S");
	assert.deepEqual(
		view.prior.map((node) => node.id),
		["P", "M", "C", "U", "V"],
		"前置区按年份升序，无年份在后",
	);
	assert.deepEqual(view.derivative.map((node) => node.id), ["D"], "右区只有采样到且记录引用种子的论文");
	const all = [...view.prior, ...view.derivative];
	assert.equal(all.some((node) => node.id === "X"), false, "相似但无引用记录的节点不出现");
	const m = view.prior.find((node) => node.id === "M");
	assert.equal(m?.mutual, true, "双向记录且置信度相同 → 互引，置于前置区");
	const c = view.prior.find((node) => node.id === "C");
	assert.equal(c?.conflict, true, "双向记录置信度不同 → 按高置信归区并标记");
	assert.equal(c?.zone, "prior");
	const v = view.prior.find((node) => node.id === "V");
	assert.equal(v?.missing, true, "catalog 外的参考文献 id 标记未收录");
	assert.equal(v?.title, "");
	assert.equal(v?.year, null);
	assert.deepEqual(v?.evidence?.sources, ["openalex"], "未收录论文仍保留已确认引用记录的来源");
	assert.equal(view.prior.find((node) => node.id === "U")?.year, null, "无年份进年份未知区");
	const links = view.links.map((link) => `${link.citingId}->${link.citedId}`);
	for (const expected of ["S->P", "S->U", "S->V", "S->M", "M->S", "S->C", "D->S"]) {
		assert.ok(links.includes(expected), `缺少箭头 ${expected}`);
	}
	assert.equal(links.includes("C->S"), false, "方向冲突时不画低置信方向的箭头");
	assert.deepEqual(view.sources, ["openalex", "opencitations"], "来源按证据动态汇总");
	assert.equal(view.empty, false);
	const laidOut = layoutTimeline(view, 260);
	assert.equal(laidOut.width, TIMELINE_MIN_WIDTH, "窄面板保持可读最小画布宽度");
	assert.equal(laidOut.unknownRows[0]?.node.id, "U", "无年份节点也获得可连线坐标");
	assert.ok(laidOut.points.every((point) => point.x >= 0 && point.x <= laidOut.width), "年份节点不会溢出画布");
	const completed = { ...graph, referenceLists: new Map([["S", Array.from({ length: 150 }, (_, i) => `W${i + 1}`)]]) };
	assert.equal(missingReferenceIds(completed, new Map()).length, TIMELINE_META_LIMIT, "补取元数据有 100 条硬上限");
	const withExtra = buildCitationTimeline(graph, new Map([["V", { ...paper("V", "reference"), title: "Recovered title", year: 2001 }]]));
	assert.equal(withExtra.prior.find((node) => node.id === "V")?.title, "Recovered title", "补取元数据进入脉络节点");
	assert.equal(missingReferenceIds(graph, new Map([["V", paper("V", "reference")]])).includes("V"), false);
	const s2Backfill = buildCitationTimeline({
		...graph,
		referenceLists: new Map([["S", ["V"]]]),
		catalog: [seedNode],
		crossCheck: new Map([["S", { s2Citations: null, s2References: 1, refsAdded: 1, mismatched: false }]]),
		citationEvidence: new CitationEvidenceStore(),
	});
	assert.deepEqual(s2Backfill.prior[0]?.evidence?.sources, ["semantic-scholar"], "未收录的回填参考文献保留正确来源");
	assert.deepEqual(s2Backfill.sources, ["semantic-scholar"]);

	const emptyGraph: SimilarityGraph = { ...graph, referenceLists: new Map([["S", []]]), citationEvidence: new CitationEvidenceStore() };
	const emptyView = buildCitationTimeline(emptyGraph);
	assert.equal(emptyView.empty, true, "没有任何直接引用证据时是空态");
	assert.equal(emptyView.prior.length + emptyView.derivative.length, 0);
	assert.match(TIMELINE_EMPTY_TEXT, /没有与种子的直接引用记录/);
	assert.match(TIMELINE_SCOPE_NOTE, /不含相似关系/);
	assert.match(TIMELINE_SAMPLING_NOTE, /高被引/);
	assert.match(TIMELINE_IMPACT_NOTE, /不等于受种子实质影响/);

	const synthetic = syntheticGraph(60, 7);
	const syntheticView = buildCitationTimeline(synthetic);
	const syntheticIds = new Set([...syntheticView.prior, ...syntheticView.derivative].map((node) => node.id));
	const seedRefs = new Set(synthetic.referenceLists.get(syntheticView.seed?.id ?? "") ?? []);
	const backRefs = new Set<string>();
	for (const [id, refs] of synthetic.referenceLists) {
		if (refs.includes(syntheticView.seed?.id ?? "")) backRefs.add(id);
	}
	for (const id of syntheticIds) {
		assert.ok(seedRefs.has(id) || backRefs.has(id), "合成图上每个脉络成员都有原始引用记录");
	}
	const crowded = buildCitationTimeline({
		...synthetic,
		nodes: synthetic.nodes.map((node) => node.isSeed ? node : { ...node, year: null }),
		catalog: synthetic.catalog.map((node) => node.isSeed ? node : { ...node, year: null }),
	});
	const compact = layoutTimeline(crowded, 700);
	assert.ok(compact.unknownRows.length <= UNKNOWN_LIMIT, "年份未知区限制可见行数");
	assert.ok(compact.points.length <= ZONE_LIMIT * 2, "有年份节点分区限量展示");
}

export function verifyUi(): void {
	evidenceCopy();
	badges();
	focusPath();
	communityRegions();
	compactCommunityLayout();
	evidenceSidebarSizing();
	analysisPairs();
	aggregates();
	timeline();
	assert.match(EMPTY_FLOWS_TEXT, /无可绘制关系/, "分析页空状态文案");
	console.log("ui checks passed");
}
