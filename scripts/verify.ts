import assert from "node:assert/strict";
import { verifyEvidence } from "./verify-evidence";
import { verifyUi } from "./verify-ui";
import { derivativeWorks, priorWorks } from "../src/aggregates";
import { detectCommunities } from "../src/communities";
import { buildCommunityRegions, communityTopicLabels } from "../src/community-regions";
import { parseEmbed } from "../src/embed-syntax";
import {
	edgeVisible,
	emptyFilter,
	evidenceText,
	focusNodes,
	nodeVisible,
	shortestPath,
	strengthTier,
	type GraphFilter,
} from "../src/graph-filter";
import { authorYear, shortAuthor } from "../src/labels";
import { placeLayout } from "../src/layout-modes";
import type { SimilarityGraph } from "../src/neighborhood";
import { explainRelation, relationKind } from "../src/relation";
import type { GraphEdge } from "../src/types";
import { runForceLayout } from "../src/layout";
import { runForceLayout3D } from "../src/layout-3d";
import { loadNeighborhood, selectNeighbors, countsMismatched, type CrossrefReferenceSource, type ReconcileSource } from "../src/neighborhood";
import { explainStatus, OpenAlexClient, OpenAlexError, type GetJson } from "../src/openalex";
import { classifyQuery, normalizeDoi, reconstructAbstract, toPaper } from "../src/paper";
import { paperStateBadges } from "../src/citation-evidence";
import { allowedExternalUrl } from "../src/safe-url";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { buildSimilarity, pairScore } from "../src/similarity";
import { buildSemanticScorer, tokenize } from "../src/text-similarity";
import { topicSimilarity, topicSimilarityColor } from "../src/topic-similarity";
import { CrossrefClient } from "../src/citation-sources";
import type { PaperNode } from "../src/types";

function weighted(source: string, target: string, weight: number): GraphEdge {
	return {
		source,
		target,
		weight,
		coupling: 0,
		sharedRefs: 0,
		coCitation: 0,
		coCitedBy: 0,
		direct: "none",
	};
}

function filterish(patch: Partial<GraphFilter> = {}): GraphFilter {
	return { ...emptyFilter(), ...patch, kinds: { ...emptyFilter().kinds, ...patch.kinds } };
}

function paper(id: string, origin: PaperNode["origin"], citedByCount: number): PaperNode {
	return {
		id,
		title: id,
		year: 2020,
		citedByCount,
		authors: "A",
		authorList: ["A"],
		abstract: "",
		doiUrl: null,
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: null,
		workType: null,
		venue: null,
		retracted: false,
		concepts: [],
	};
}

function unit(): void {
	assert.deepEqual(classifyQuery("  10.1038/nature14539 "), {
		kind: "doi",
		value: "10.1038/nature14539",
	});
	assert.equal(normalizeDoi(" DOI:HTTPS://doi.org/10.1234/ABC). "), "10.1234/abc");
	assert.deepEqual(classifyQuery("https://doi.org/10.1038/nature14539"), {
		kind: "doi",
		value: "10.1038/nature14539",
	});
	assert.deepEqual(classifyQuery("https://openalex.org/W2919115771"), {
		kind: "openalex",
		value: "W2919115771",
	});
	assert.equal(classifyQuery("deep learning")?.kind, "search");
	assert.equal(classifyQuery("  "), null);

	assert.equal(
		reconstructAbstract({ Deep: [0], learning: [1], learns: [3], representations: [2] }),
		"Deep learning representations learns",
	);
	const topicPaper = toPaper({
		id: "https://openalex.org/W1",
		display_name: "Topic work",
		topics: [
			{ id: "https://openalex.org/T1", display_name: "Language", score: 0.9 },
			{ id: "https://openalex.org/T2", display_name: "Cognition", score: 0.4 },
		],
	}, "seed");
	assert.deepEqual(topicPaper?.topicTags?.map((topic) => topic.id), ["https://openalex.org/T1", "https://openalex.org/T2"]);
	assert.equal(topicPaper?.concepts[0], "Language");
	assert.equal(topicSimilarity(topicPaper?.topicTags, topicPaper?.topicTags), 1);
	assert.ok((topicSimilarity(topicPaper?.topicTags, [{ id: "https://openalex.org/T1", name: "Language", score: 1 }]) ?? 0) > 0);
	assert.equal(topicSimilarity(undefined, topicPaper?.topicTags), null);
	assert.notEqual(topicSimilarityColor(1), topicSimilarityColor(0));
	const topicGroups = communityTopicLabels([
		{ id: "a", topicTags: [{ name: "Language", score: 0.8 }, { name: "Syntax", score: 0.5 }] },
		{ id: "b", topicTags: [{ name: "Language", score: 0.7 }] },
		{ id: "c", topicTags: [{ name: "Syntax", score: 0.9 }] },
	], new Map([["a", 0], ["b", 0], ["c", 1]]));
	assert.equal(topicGroups.get(0), "Language · Syntax");
	assert.equal(topicGroups.get(1), "Syntax");
	const communityRegions = buildCommunityRegions([
		{ id: "a", community: 0, x: 0, y: 0, shown: true },
		{ id: "b", community: 0, x: 20, y: 0, shown: true },
		{ id: "c", community: 0, x: 10, y: 20, shown: true },
	], 10, 3, 10, topicGroups);
	assert.equal(communityRegions[0]?.label, "Language · Syntax");

	assert.equal(allowedExternalUrl("https://doi.org/10.1038/nature14539")?.startsWith("https://doi.org/"), true);
	assert.equal(allowedExternalUrl("https://evil.example/phish"), null);
	assert.equal(allowedExternalUrl("javascript:alert(1)"), null);

	assert.match(explainStatus(404), /没有找到/);
	assert.match(explainStatus(429), /额度/);

	const references = new Map<string, Set<string>>([
		["S", new Set(["A", "B", "C", "D"])],
		["P", new Set(["A", "B", "C", "Z"])],
		["Q", new Set(["X", "Y"])],
	]);
	const contexts = [new Set(["S", "P", "M"]), new Set(["S", "P"]), new Set(["S", "Q"])];
	assert.ok(pairScore("S", "P", references, contexts) > pairScore("S", "Q", references, contexts));

	const model = buildSimilarity({
		ids: ["S", "P", "Q"],
		seedId: "S",
		references,
		contexts,
	});
	assert.ok(model.edges.some((edge) => edge.source === "S" || edge.target === "S"));
	assert.ok((model.seedScore.get("P") ?? 0) > (model.seedScore.get("Q") ?? 0));
	const sp = model.edges.find(
		(edge) =>
			(edge.source === "S" && edge.target === "P") || (edge.source === "P" && edge.target === "S"),
	);
	assert.ok(sp, "expected an S–P edge");
	assert.ok((sp.structuralSimilarity ?? 0) > 0.7);
	assert.equal(sp.sharedRefs, 3);
	assert.equal(sp.coCitedBy, 2);
	assert.equal(sp.direct, "none");
	assert.equal(relationKind(sp), "cocitation");
	assert.match(explainRelation(sp, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共被引 2 次/);
	assert.match(explainRelation(sp, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共享参考文献 3 篇/);

	const cited = buildSimilarity({
		ids: ["S", "P"],
		seedId: "S",
		references: new Map([
			["S", new Set(["P", "A"])],
			["P", new Set(["A"])],
		]),
		contexts: [],
	});
	const citedEdge = cited.edges.find((edge) => edge.source !== edge.target);
	assert.ok(citedEdge);
	assert.equal(citedEdge.direct, citedEdge.source === "S" ? "source-cites-target" : "target-cites-source");
	assert.equal(relationKind(citedEdge), "direct");
	assert.match(
		explainRelation(citedEdge, { authors: "Yann LeCun", year: 2015 }, { authors: "David Rumelhart", year: 1986 }),
		/引用了/,
	);
	assert.equal(shortAuthor("Yann LeCun, Yoshua Bengio, Geoffrey E. Hinton"), "LeCun");
	assert.equal(shortAuthor("作者不详"), "佚名");
	assert.equal(authorYear({ authors: "Yann LeCun, Yoshua Bengio", year: 2015 }), "LeCun 2015");

	const weakEdge = weighted("S", "Q", 0.04);
	assert.equal(strengthTier(weakEdge), "weak");
	const midCite = { ...weighted("A", "B", 0.2), structuralSimilarity: 0.4, coCitedBy: 2, coCitation: 0.4 };
	assert.equal(relationKind(midCite), "cocitation");
	assert.equal(strengthTier(midCite), "mid");
	const strongCouple = { ...weighted("A", "B", 0.5), structuralSimilarity: 0.6, sharedRefs: 8, coupling: 0.4 };
	assert.equal(strengthTier(strongCouple), "strong");
	const mutual = { ...weighted("S", "P", 0.2), structuralSimilarity: 0, direct: "mutual" as const };
	assert.equal(strengthTier(mutual), "weak", "citation direction should not inflate similarity thickness");
	const sample = paper("S", "seed", 10);
	const older = { ...paper("A", "reference", 3), year: 1980, language: "en", workType: "article", concepts: ["Deep learning"] };
	const peer = paper("B", "citation", 4);
	const nodesById = new Map([
		[sample.id, sample],
		[older.id, older],
		[peer.id, peer],
	]);
	assert.equal(nodeVisible(older, { ...filterish(), yearFrom: 1990 }), false);
	assert.equal(nodeVisible(sample, { ...filterish(), yearFrom: 1990 }), true);
	assert.equal(nodeVisible(older, { ...filterish(), language: "en" }), true);
	assert.equal(nodeVisible(older, { ...filterish(), concept: "deep learning" }), true);
	assert.equal(edgeVisible(midCite, nodesById, { ...filterish(), minCoCitedBy: 3 }), false);
	assert.equal(edgeVisible(midCite, nodesById, { ...filterish(), kinds: { ...filterish().kinds, cocitation: false } }), false);
	const directSeen = { ...weighted("S", "A", 0.2), direct: "source-cites-target" as const, coCitedBy: 1 };
	assert.equal(edgeVisible(directSeen, nodesById, { ...filterish(), minCoCitedBy: 9 }), true);
	const path = shortestPath(new Map([["A", ["B"]], ["B", ["S"]]]), "A", "S");
	assert.deepEqual(path, ["A", "B", "S"]);
	const focus = focusNodes("A", "S", [weighted("A", "B", 0.2), weighted("B", "S", 0.2)], () => true, true);
	assert.equal(focus?.has("S"), true);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共享参考文献 0 篇/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /共被引 2 次/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /OpenAlex/);
	assert.match(evidenceText(midCite, { authors: "Ada Lovelace", year: 2015 }, { authors: "Grace Hopper", year: 1990 }), /不完整/);
	assert.equal(nodeVisible({ ...sample, year: 2015 }, { ...filterish(), scrubYear: 2010 }), false);

	const layoutNodes = [
		{ ...paper("S", "seed", 1000), year: 2015, title: "Seed paper" },
		{ ...paper("A", "reference", 10), year: 1990, title: "Early" },
		{ ...paper("B", "citation", 100), year: 2010, title: "Middle" },
	];
	const temporal = placeLayout("temporal", layoutNodes, [], new Map([["S", 1], ["A", 0.2], ["B", 0.5]]));
	const at = (id: string) => temporal.find((node) => node.id === id);
	assert.ok((at("A")?.x ?? 0) < (at("B")?.x ?? 0));
	assert.ok((at("B")?.x ?? 0) < (at("S")?.x ?? 0));
	assert.ok((at("A")?.y ?? 0) < (at("B")?.y ?? 0));
	const radial = placeLayout("radial", layoutNodes, [], new Map([["S", 1], ["A", 0.2], ["B", 0.8]]));
	const radialSeed = radial.find((node) => node.id === "S");
	assert.equal(radialSeed?.x, 0);
	assert.equal(radialSeed?.y, 0);
	const radialA = radial.find((node) => node.id === "A");
	const radialB = radial.find((node) => node.id === "B");
	assert.ok(Math.hypot(radialA?.x ?? 0, radialA?.y ?? 0) > Math.hypot(radialB?.x ?? 0, radialB?.y ?? 0));
	const kumu = placeLayout("kumu", layoutNodes, [weighted("S", "A", 0.7), weighted("A", "B", 0.7)], new Map());
	assert.ok(kumu.every((node) => node.z === 0 && node.radius <= 8), "Kumu 圈层布局是二维小节点地图");

	const communities = detectCommunities(
		["A", "B", "C", "D", "E", "F"],
		[weighted("A", "B", 1), weighted("B", "C", 1), weighted("C", "A", 1), weighted("D", "E", 1), weighted("E", "F", 1), weighted("F", "D", 1)]
			.map((edge) => ({ ...edge, sharedRefs: 4, coupling: 0.5 })),
	);
	assert.equal(communities.get("A"), communities.get("B"));
	assert.equal(communities.get("B"), communities.get("C"));
	assert.notEqual(communities.get("A"), communities.get("D"));
	const weakOnly = detectCommunities(["A", "B"], [weighted("A", "B", 1)]);
	assert.notEqual(weakOnly.get("A"), weakOnly.get("B"));

	const seedPaper = { ...paper("S", "seed", 10), year: 2015, title: "Seed paper", authors: "Yann LeCun", doiUrl: "https://doi.org/10.1038/nature14539" };
	const early = { ...paper("A", "reference", 50), year: 1986, title: "Backprop", authors: "David Rumelhart" };
	const later = { ...paper("B", "citation", 20), year: 2018, title: "Later work", authors: "Ian Goodfellow" };
	const survey = { ...paper("C", "citation", 5), year: 2020, title: "Survey", authors: "Ada Lovelace" };
	const rankedGraph: SimilarityGraph = {
		nodes: [seedPaper, early, later],
		edges: [],
		seedScore: new Map([["S", 1], ["A", 0.4], ["B", 0.2]]),
		warnings: [],
		strategies: { references: true, citations: true, related: false },
		referenceLists: new Map([
			["S", ["A"]],
			["B", ["A", "S"]],
			["A", []],
			["C", ["S", "A", "B"]],
		]),
		catalog: [seedPaper, early, later, survey],
		skippedNonResearch: 0,
	};
	const visible = new Set(["S", "A", "B"]);
	const priors = priorWorks(rankedGraph, visible);
	assert.equal(priors[0]?.paper.id, "A");
	assert.equal(priors[0]?.count, 2);
	assert.equal(priors.some((item) => item.paper.id === "S"), false);
	const derivatives = derivativeWorks(rankedGraph, visible);
	assert.equal(derivatives.find((item) => item.paper.id === "C")?.count, 3);
	assert.equal(derivatives.some((item) => item.paper.id === "B"), true);

	const picked = selectNeighbors(
		{ ...DEFAULT_SETTINGS, maxNodes: 20, includeRelated: false },
		{
			reference: [paper("W1", "reference", 10), paper("W2", "reference", 50)],
			citation: [paper("W3", "citation", 5), paper("W9", "citation", 100)],
			related: [paper("W4", "related", 1)],
		},
		"W0",
	);
	assert.ok(picked.length <= 19);
	assert.equal(picked.some((item) => item.id === "W4"), false);
	assert.equal(picked.some((item) => item.origin === "citation"), true);
	const duplicateReference = toPaper({ id: "W10", display_name: "Duplicate", doi: "10.1234/dup", publication_year: 2020 }, "reference");
	const duplicateCitation = toPaper({ id: "W11", display_name: "Duplicate", doi: "https://doi.org/10.1234/DUP.", publication_year: 2020 }, "citation");
	assert.ok(duplicateReference && duplicateCitation);
	const merged = selectNeighbors(
		{ ...DEFAULT_SETTINGS, maxNodes: 20, includeRelated: false },
		{ reference: [duplicateReference], citation: [duplicateCitation], related: [] },
		"W0",
	);
	assert.equal(merged.length, 1, "same DOI is one neighborhood candidate");

	const nodes = [
		{ id: "S", x: 0, y: 0, radius: 14 },
		{ id: "A", x: 0, y: 0, radius: 10 },
		{ id: "B", x: 0, y: 0, radius: 8 },
		{ id: "C", x: 0, y: 0, radius: 12 },
	];
	runForceLayout(
		nodes,
		[weighted("S", "A", 0.8), weighted("S", "B", 0.2), weighted("A", "C", 0.5)],
		"S",
		new Map([
			["S", 1],
			["A", 0.8],
			["B", 0.2],
			["C", 0.4],
		]),
	);
	const seed = nodes.find((node) => node.id === "S");
	assert.equal(seed?.x, 0);
	assert.equal(seed?.y, 0);
	for (const node of nodes) {
		assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
	}
	const xs = nodes.map((node) => node.x);
	assert.ok(Math.max(...xs) - Math.min(...xs) > 20);

	const parsed = parseEmbed(
		"doi: 10.1038/nature14539\n# note\nmaxNodes: 40\nheight: 100\ndepth: 2\n",
	);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.deepEqual(parsed.spec.target, { kind: "doi", value: "10.1038/nature14539" });
		assert.equal(parsed.spec.maxNodes, 40);
		assert.equal(parsed.spec.height, 280);
		assert.equal(parsed.spec.depth, 2);
		assert.equal(parsed.spec.position, "inline");
		assert.equal(parsed.spec.width, "100%");
		assert.equal(parsed.spec.align, "left");
		assert.equal(parsed.spec.labels, "author-year");
	}
	const placed = parseEmbed(
		"doi: 10.1038/nature14539\nposition: float-right\nwidth: 60%\nalign: center\nlabels: both\n",
	);
	assert.equal(placed.ok, true);
	if (placed.ok) {
		assert.equal(placed.spec.position, "float-right");
		assert.equal(placed.spec.width, "60%");
		assert.equal(placed.spec.align, "center");
		assert.equal(placed.spec.labels, "both");
	}
	const floated = parseEmbed("doi: 10.1038/nature14539\nposition: float-left\nlabels: off\nwidth: 100\n");
	assert.equal(floated.ok, true);
	if (floated.ok) {
		assert.equal(floated.spec.position, "float-left");
		assert.equal(floated.spec.labels, "off");
		assert.equal(floated.spec.width, "240px");
	}
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nposition: sidebar\n").ok, false);
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nlabels: authors\n").ok, false);
	const ranged = parseEmbed(
		"doi: 10.1038/nature14539\nyearFrom: 2010\nyearTo: 1990\nlanguage: EN\ntype: article\nconcept: Deep learning\nminCoCite: 2\n",
	);
	assert.equal(ranged.ok, true);
	if (ranged.ok) {
		assert.equal(ranged.spec.yearFrom, 1990);
		assert.equal(ranged.spec.yearTo, 2010);
		assert.equal(ranged.spec.language, "en");
		assert.equal(ranged.spec.workType, "article");
		assert.equal(ranged.spec.concept, "Deep learning");
		assert.equal(ranged.spec.minCoCite, 2);
		assert.equal(ranged.spec.layout, "temporal");
		assert.equal(ranged.spec.color, "topic");
	}
	const laidOut = parseEmbed("doi: 10.1038/nature14539\nlayout: force2d\ncolor: year\n");
	assert.equal(laidOut.ok, true);
	if (laidOut.ok) {
		assert.equal(laidOut.spec.layout, "force2d", "force layouts stay distinct");
		assert.equal(laidOut.spec.color, "year", "color: year selects year coloring");
	}
	const topicColor = parseEmbed("doi: 10.1038/nature14539\ncolor: topic\n");
	assert.equal(topicColor.ok, true);
	if (topicColor.ok) assert.equal(topicColor.spec.color, "topic");
	assert.equal(parseEmbed("doi: 10.1038/nature14539\nlayout: sidebar\n").ok, false);
	const kumuEmbed = parseEmbed("doi: 10.1038/nature14539\nlayout: kumu\n");
	assert.equal(kumuEmbed.ok, true, "笔记内嵌可显式切换到 Kumu 风格社区布局");
	if (kumuEmbed.ok) assert.equal(kumuEmbed.spec.layout, "kumu");
	const yearNodes = [
		{ ...paper("Y1", "seed", 1), year: 2000 },
		{ ...paper("Y2", "reference", 1), year: 2010 },
		{ ...paper("Y3", "citation", 1), year: 2020 },
	];
	const yearPlaced = placeLayout("temporal", yearNodes, [], new Map());
	assert.equal(yearPlaced[1]!.x - yearPlaced[0]!.x, yearPlaced[2]!.x - yearPlaced[1]!.x, "horizontal year distance is linear and not jittered");
	const bare = parseEmbed("  W2919115771  ");
	assert.equal(bare.ok, true);
	if (bare.ok) assert.deepEqual(bare.spec.target, { kind: "openalex", value: "W2919115771" });
	const tall = parseEmbed("doi: 10.1038/nature14539\nheight: 2000\nmaxNodes: 5\n");
	assert.equal(tall.ok, true);
	if (tall.ok) {
		assert.equal(tall.spec.height, 900);
		assert.equal(tall.spec.maxNodes, 20);
		assert.equal(tall.spec.depth, 1);
	}
	assert.equal(parseEmbed("deep learning").ok, false);
	assert.equal(parseEmbed("").ok, false);

	const nodes3 = [
		{ id: "S", x: 0, y: 0, z: 0, radius: 14 },
		{ id: "A", x: 0, y: 0, z: 0, radius: 10 },
		{ id: "B", x: 0, y: 0, z: 0, radius: 8 },
		{ id: "C", x: 0, y: 0, z: 0, radius: 12 },
	];
	runForceLayout3D(
		nodes3,
		[weighted("S", "A", 0.8), weighted("S", "B", 0.2), weighted("A", "C", 0.5)],
		"S",
		new Map([
			["S", 1],
			["A", 0.8],
			["B", 0.2],
			["C", 0.4],
		]),
	);
	const seed3 = nodes3.find((node) => node.id === "S");
	assert.equal(seed3?.x, 0);
	assert.equal(seed3?.y, 0);
	assert.equal(seed3?.z, 0);
	for (const node of nodes3) {
		assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z));
	}
	const zs = nodes3.map((node) => node.z);
	assert.ok(Math.max(...zs) - Math.min(...zs) > 20);
}

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

async function live(): Promise<void> {
	const client = new OpenAlexClient(getJson, { apiKey: "", contactEmail: "" });
	const graph = await loadNeighborhood(
		client,
		{ kind: "doi", value: "10.1038/nature14539" },
		DEFAULT_SETTINGS,
	);
	const seed = graph.nodes.find((node) => node.isSeed);
	assert.ok(seed, "missing seed");
	assert.match(seed.title, /deep learning/i);
	assert.ok(seed.citedByCount > 1000);
	assert.equal(seed.openAlexUrl.startsWith("https://openalex.org/W"), true);
	assert.ok(graph.nodes.length > 8, `expected a neighborhood, got ${graph.nodes.length}`);
	assert.ok(graph.nodes.length <= DEFAULT_SETTINGS.maxNodes);
	assert.ok(graph.edges.length >= 5, `expected edges, got ${graph.edges.length}`);
	assert.ok(graph.edges.some((edge) => edge.source === seed.id || edge.target === seed.id));
	assert.ok(graph.referenceLists.has(seed.id));
	assert.ok(graph.catalog.some((node) => node.id === seed.id));
	const priors = priorWorks(graph, new Set(graph.nodes.map((node) => node.id)));
	assert.ok(priors.length > 0, "expected prior works from the sampled reference lists");
	assert.ok(priors.every((item) => item.count >= 2));
	assert.ok(
		graph.nodes.some((node) => /Long Short-Term Memory|Gradient-based learning/i.test(node.title)),
		"expected a highly cited reference of the seed in the map",
	);
	const titles = graph.nodes
		.slice()
		.sort((a, b) => b.citedByCount - a.citedByCount)
		.slice(0, 6)
		.map((node) => `${node.origin} ${node.year ?? "?"} ${node.title}`)
		.join("\n  ");
	console.log(
		`live map: ${graph.nodes.length} nodes, ${graph.edges.length} edges, warnings=${graph.warnings.join(",") || "none"}\n  ${titles}`,
	);
}

/** 语义通道（proposal-5 Phase A）：分词、BM25 排序、缺失降级。 */
function semanticChecks(): void {
	const tokens = tokenize("The Role of Tone in 声调系统 Grammar");
	assert.ok(tokens.includes("role") && tokens.includes("tone") && tokens.includes("grammar"), "英文词干入词表");
	assert.ok(tokens.includes("声调") && tokens.includes("系统"), "中文走字 bigram");
	assert.ok(!tokens.includes("the"), "停用词过滤");

	const seed = {
		...paper("S", "seed", 100),
		title: "Evidentiality and epistemic modality",
		concepts: ["Linguistics"],
		abstract: "How languages encode information source.",
	};
	const near = {
		...paper("A", "reference", 10),
		title: "Epistemic modality and evidential markers",
		concepts: ["Linguistics"],
		abstract: "Markers of information source in grammar.",
	};
	const far = {
		...paper("B", "reference", 10),
		title: "Quantum chromodynamics lattice",
		concepts: ["Physics"],
		abstract: "Gauge fields on discrete lattices.",
	};
	const scorer = buildSemanticScorer(seed, [near, far]);
	const nearScore = scorer.score(near);
	const farScore = scorer.score(far);
	assert.ok(nearScore !== null && farScore !== null);
	assert.ok(nearScore > farScore, "语义相关论文分数更高");
	assert.ok(nearScore <= 1 && farScore >= 0);

	const blankSeed = { ...paper("S2", "seed", 1), title: "", concepts: [] };
	const blankNode = { ...paper("C", "reference", 1), title: "", concepts: [] };
	assert.equal(buildSemanticScorer(blankSeed, [blankNode]).score(blankNode), null, "无文本无主题时不可用");

	const topicSeed = { ...paper("S3", "seed", 1), title: "", concepts: [], topicTags: [{ id: "T1", name: "Syntax", score: 0.9 }] };
	const topicNode = { ...paper("D", "reference", 1), title: "", concepts: [], topicTags: [{ id: "T1", name: "Syntax", score: 0.8 }] };
	const topicScore = buildSemanticScorer(topicSeed, [topicNode]).score(topicNode);
	assert.ok(topicScore !== null && topicScore > 0.9, "文本缺失时主题余弦兜底");
}

async function main(): Promise<void> {
	unit();
	semanticChecks();
	await verifyEvidence();
	verifyUi();
	await cursorPaging();
	await reconcileOffline();
	console.log("unit checks passed");
	if (process.argv.includes("--offline")) return;
	try {
		await live();
	} catch (error) {
		console.warn("live OpenAlex check failed once, retrying", error);
		await live();
	}
	console.log("verify passed");
}

/** Reconcile: S2 counts flag a mismatch, and a missing reference list is backfilled into an edge. */
async function reconcileOffline(): Promise<void> {
	assert.equal(countsMismatched(1328, 2), true, "book review vs book-scale citations mismatch");
	assert.equal(countsMismatched(60, 6), true);
	assert.equal(countsMismatched(49, 1), false, "small counts are too noisy to flag");
	assert.equal(countsMismatched(100, null), false, "no S2 record is not a mismatch");
	assert.equal(countsMismatched(100, 60), false);

	// Unified node-state badges: severity order, clean node paints nothing.
	const badges = paperStateBadges(
		{ retracted: true, workType: "book-review" },
		{ mismatched: true, refsAdded: 3 },
	);
	assert.deepEqual(
		badges.map((badge) => badge.label),
		["⚠ 已撤稿", "书评", "⚠ 数据源差异", "S2 回填 3 条"],
	);
	assert.ok(badges.slice(0, 3).every((badge) => badge.tone === "warn"));
	assert.equal(paperStateBadges({ retracted: false, workType: "article" }, null).length, 0);
	assert.equal(paperStateBadges({ workType: "review" }, { mismatched: false, refsAdded: 0 }).length, 0, "综述是研究内容，不进徽章");

	const seedWork = {
		id: "https://openalex.org/W1",
		display_name: "Seed paper",
		doi: "https://doi.org/10.1/seed",
		referenced_works: [],
		authorships: [],
		type: "article",
	};
	const neighborWork = {
		id: "https://openalex.org/W2",
		display_name: "Neighbor paper",
		doi: "https://doi.org/10.1/neighbor",
		publication_year: 2020,
		cited_by_count: 500,
		authorships: [],
		type: "article",
	};
	const mock: GetJson = async (url) => {
		const parsed = new URL(url);
		if (parsed.pathname === "/works/W1") return seedWork;
		const filter = parsed.searchParams.get("filter") ?? "";
		if (filter === "cited_by:W1") return { results: [neighborWork] };
		if (filter.startsWith("openalex:")) {
			return { results: [{ id: neighborWork.id, referenced_works: [], abstract_inverted_index: null }] };
		}
		return { results: [] };
	};
	const client = new OpenAlexClient(mock, { apiKey: "", contactEmail: "" });
	const reconcile: ReconcileSource = {
		bulkCounts: async () => new Map([["10.1/neighbor", { citationCount: 5, referenceCount: 30 }]]),
		referenceDois: async () => ["10.1/seed"],
	};
	const crossref: CrossrefReferenceSource = {
		referenceDois: async (doi) => doi === "10.1/seed" ? ["10.1/neighbor"] : [],
	};
	const graph = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, maxNodes: 20 },
		undefined,
		reconcile,
		crossref,
	);
	const check = graph.crossCheck?.get("W2");
	assert.ok(check, "cross-check recorded for the neighbor");
	assert.equal(check.mismatched, true, "500 vs 5 is an order-of-magnitude mismatch");
	assert.equal(check.refsAdded, 1, "one backfilled link into the graph");
	assert.ok(graph.rawReferenceLists?.get("W2")?.some((ref) => ref.source === "semantic-scholar" && ref.doi === "10.1/seed"));
	const edge = graph.edges.find(
		(item) =>
			(item.source === "W2" && item.target === "W1") || (item.source === "W1" && item.target === "W2"),
	);
	assert.ok(edge && edge.direct !== "none", "backfilled reference creates a direct edge");
	const evidence = graph.citationEvidence?.get("W2", "W1");
	assert.ok(evidence?.sources.includes("semantic-scholar"), "backfilled edge credits Semantic Scholar");
	assert.ok(!evidence?.sources.includes("openalex"), "backfilled edge is not credited to OpenAlex");
	const crossrefEvidence = graph.citationEvidence?.get("W1", "W2");
	assert.ok(crossrefEvidence?.sources.includes("crossref"), "Crossref-only reference credits Crossref");
	assert.ok(!crossrefEvidence?.sources.includes("openalex"), "Crossref backfill is not misattributed to OpenAlex");
	assert.equal(graph.crossCheck?.get("W1")?.crossrefRefsAdded, 1);
	assert.ok(graph.rawReferenceLists?.get("W1")?.some((ref) => ref.source === "crossref" && ref.doi === "10.1/neighbor"));

	// Toggle off: no cross-check, no backfill.
	const off = await loadNeighborhood(
		client,
		{ kind: "openalex", value: "W1" },
		{ ...DEFAULT_SETTINGS, includeCitations: false, includeRelated: false, s2Reconcile: false, maxNodes: 20 },
		undefined,
		reconcile,
	);
	assert.equal(off.crossCheck, undefined);
	const crossrefClient = new CrossrefClient(async (url) => {
		assert.match(url, /api\.crossref\.org\/works\/10\.1\/test/);
		return { message: { abstract: "<jats:p>Uses &amp; tests</jats:p>", reference: [{ DOI: "10.1/ref" }, { unstructured: "No DOI" }] } };
	}, "test@example.org");
	assert.equal(await crossrefClient.abstract("10.1/test"), "Uses & tests");
	assert.deepEqual(await crossrefClient.referenceDois("10.1/test"), ["10.1/ref"]);
}
async function cursorPaging(): Promise<void> {
	const requested: string[] = [];
	const pages: Record<string, { results: Array<{ id: string }>; next: string | null }> = {
		"*": { results: [{ id: "W1" }, { id: "W2" }], next: "p2" },
		p2: { results: [{ id: "W3" }], next: "p3" },
		p3: { results: [], next: null },
	};
	const mock: GetJson = async (url) => {
		requested.push(url);
		const cursor = new URL(url).searchParams.get("cursor") ?? "*";
		const page = pages[cursor];
		if (!page) throw new Error(`unexpected cursor ${cursor}`);
		return { results: page.results, meta: { next_cursor: page.next } };
	};
	const client = new OpenAlexClient(mock, { apiKey: "", contactEmail: "" });
	const works = await client.citingSeed("W0", 200, 5);
	assert.deepEqual(works.map((work) => work.id), ["W1", "W2", "W3"]);
	assert.equal(requested.length, 3, "stops when a page comes back empty");
	assert.ok(new URL(requested[0] ?? "").searchParams.get("cursor") === "*");
	assert.ok(new URL(requested[1] ?? "").searchParams.get("cursor") === "p2");

	const single = await client.referencedBySeed("W0", 80);
	assert.equal(single.length, 2, "single-page mode ignores cursors");
	assert.equal(new URL(requested[3] ?? "").searchParams.get("cursor"), null);

	const sampled = await client.sampleWorks(
		"cites:W0",
		2,
		2,
		"cited_by_count:desc",
		2,
		(work) => work.id !== "W1",
	);
	assert.deepEqual(sampled.works.map((work) => work.id), ["W2", "W3"]);
	assert.deepEqual(sampled.rejected.map((work) => work.id), ["W1"]);
	assert.equal(sampled.rawFetched, 3, "filtered sampling reads the next page");
	assert.equal(sampled.filtered, 1);
	assert.equal(sampled.pages, 2);
	const partialClient = new OpenAlexClient(async (url) => {
		const cursor = new URL(url).searchParams.get("cursor");
		if (cursor === "*") return { results: [{ id: "W4" }], meta: { next_cursor: "failed-page" } };
		throw new OpenAlexError("page two unavailable");
	}, { apiKey: "", contactEmail: "" });
	const partial = await partialClient.sampleWorks("cites:W0", 2, 1, undefined, 2, () => true);
	assert.deepEqual(partial.works.map((work) => work.id), ["W4"], "keep successful pages if a later page fails");
	assert.equal(partial.error, "page two unavailable");
	assert.equal(partial.exhausted, false);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
