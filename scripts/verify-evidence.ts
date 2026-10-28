import assert from "node:assert/strict";
import {
	CitationEvidenceStore,
	edgeDetailStillCurrent,
	edgePairNeedingS2Context,
	evidenceFromSemanticCitation,
	evidenceLabel,
	mergeOpenCitation,
	mergeS2CitationsForPair,
} from "../src/citation-evidence";
import { doisFromOpenCitation, SemanticScholarClient } from "../src/citation-sources";
import { SimilarityMap } from "../src/map-canvas";
import { buildNarrativeEvidence, validateNarrative } from "../src/narrative";
import { summarizeWithLlmPost } from "../src/llm";
import type { SimilarityGraph } from "../src/neighborhood";
import type { GraphEdge, PaperNode } from "../src/types";
import { normalizeDoi } from "../src/paper";
import { emptyFilter } from "../src/graph-filter";
import {
	groupStagedBySeed,
	normalizeStagedList,
	stageKey,
	stageSourceLabel,
	toggleStaged,
	wrapStagedList,
} from "../src/staging";
import { findBudgetedCitationPath, resolvePathEndpoint } from "../src/doi-path";
import { shortId } from "../src/paper";

export async function verifyEvidence(): Promise<void> {
	assert.equal(evidenceLabel(evidenceFromSemanticCitation("a", "b", {})), "");
	assert.ok(evidenceLabel(evidenceFromSemanticCitation("a", "b", { intents: ["method"] })));
	const paper = (id: string, seed = false): PaperNode => ({
		id, isSeed: seed, title: id, year: seed ? 2010 : 2020, authors: "Author", authorList: ["Author"],
		abstract: "private abstract", doiUrl: null, openAlexUrl: "https://openalex.org/" + id,
		origin: seed ? "seed" : "citation", citedByCount: 10, language: null, workType: null, venue: null, retracted: false, concepts: [],
	});
	const seed = paper("W1", true), prior = paper("W2"), later = paper("W3");
	const graph: SimilarityGraph = {
		nodes: [seed, prior, later], edges: [], seedScore: new Map(), warnings: [],
		strategies: { references: true, citations: true, related: false },
		catalog: [seed, prior, later], referenceLists: new Map([["W1", ["W2"]], ["W3", ["W1"]]]),
		citationEvidence: new CitationEvidenceStore(), skippedNonResearch: 0,
	};
	mergeOpenCitation(graph, "W1", "W2");
	assert.deepEqual(graph.citationEvidence!.get("W1", "W2")!.sources, ["openalex", "opencitations"]);
	const backfill = new CitationEvidenceStore();
	backfill.set(evidenceFromSemanticCitation("W1", "W2", {}));
	const backfillGraph: SimilarityGraph = {
		...graph, edges: [], citationEvidence: backfill, referenceLists: new Map([["W1", ["W2"]]]),
	};
	mergeOpenCitation(backfillGraph, "W1", "W2");
	const backfillSources = backfillGraph.citationEvidence!.get("W1", "W2")!.sources;
	assert.equal(backfillSources.includes("openalex"), false);
	assert.equal(backfillSources.includes("semantic-scholar"), true);
	assert.equal(backfillSources.includes("opencitations"), true);
	mergeOpenCitation(graph, "W2", "W1");
	assert.equal(graph.edges.length, 1);
	assert.equal(graph.edges[0]!.direct, "mutual");
	assert.deepEqual(graph.citationEvidence!.get("W2", "W1")!.sources, ["opencitations"]);
	mergeOpenCitation(graph, "W2", "W1"); assert.equal(graph.edges.length, 1);
	mergeOpenCitation(graph, "W99", "W1"); assert.equal(graph.edges.length, 1);
	const semantic = evidenceFromSemanticCitation("W2", "W1", { intents: ["method"], isInfluential: false, contexts: ["uses method"] });
	graph.citationEvidence!.set(semantic);
	mergeOpenCitation(graph, "W2", "W1");
	assert.equal(graph.citationEvidence!.get("W2", "W1")!.influential, false);
	assert.equal(graph.citationEvidence!.get("W2", "W1")!.relation, "method");
	assert.equal(evidenceFromSemanticCitation("a", "b", {}).influential, undefined);
	const staged = toggleStaged([], prior, seed.id, "种子引用了它 · OpenAlex");
	assert.equal(staged.length, 1);
	assert.equal(stageKey(staged[0]!), "W1\0W2");
	assert.equal(toggleStaged(staged, prior, seed.id, "种子引用了它 · OpenAlex").length, 0);
	const wrapped = wrapStagedList(staged);
	assert.equal(wrapped.version, 1);
	assert.equal(normalizeStagedList(wrapped).length, 1);
	assert.equal(normalizeStagedList(staged).length, 1, "legacy bare array still loads");
	assert.equal(normalizeStagedList(null).length, 0);
	const otherSeed = toggleStaged(staged, later, "W9", "它引用了种子 · OpenAlex");
	assert.deepEqual(groupStagedBySeed(otherSeed).map((g) => g.seedId), ["W1", "W9"]);
	const citeEdge: GraphEdge = {
		source: "W1", target: "W2", weight: 0.5, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target",
	};
	assert.equal(stageSourceLabel(prior, seed.id, citeEdge, null), "种子引用了它 · OpenAlex");
	assert.equal(
		stageSourceLabel(prior, seed.id, { ...citeEdge, direct: "none" }, null),
		"引用了种子 · OpenAlex",
	);
	assert.deepEqual(doisFromOpenCitation({ citing: "[index] => omid:1 doi:10.1/ABC; doi:10.2/DEF" }).citing, ["10.1/abc", "10.2/def"]);
	const evidence = buildNarrativeEvidence(graph, false);
	assert.equal(evidence.priorWorks[0]!.id, "W2");
	assert.ok(evidence.derivativeWorks.some(p => p.id === "W3"), "direct citer with only one reference must be included");
	assert.ok(!JSON.stringify(evidence).includes("private abstract"));
	assert.ok(JSON.stringify(buildNarrativeEvidence(graph, true)).includes("private abstract"));
	const excludedNarrative = buildNarrativeEvidence({
		...graph,
		nodes: [seed, later],
		catalog: [{ ...prior, abstract: "excluded abstract" }, seed, later],
		excludedIds: ["W2"],
	}, true);
	assert.equal(excludedNarrative.priorWorks.some((item) => item.id === "W2"), false);
	assert.equal(JSON.stringify(excludedNarrative).includes("excluded abstract"), false);
	assert.equal(excludedNarrative.derivativeWorks.some((item) => item.id === "W3"), true);
	assert.throws(() => validateNarrative({ basedOn: {} }, new Set(["W1"])));
	const response = { synthesis: "引用网络总结", basedOn: [], influenced: [], importantWorks: [], caveats: [] };
	assert.throws(() => validateNarrative({ ...response, basedOn: [{ paperId: "W99" }] }, new Set(["W1"])));
	let calls = 0;
	const post = async () => { calls++; return { choices: [{ message: { content: JSON.stringify(response) } }] }; };
	const options = { enabled: false, endpoint: "https://example.test/chat/completions", apiKey: "", model: "test" };
	await assert.rejects(summarizeWithLlmPost(post, options, evidence), /关闭/);
	assert.equal(calls, 0, "disabled LLM must never send requests");
	await assert.rejects(summarizeWithLlmPost(post, { ...options, enabled: true, endpoint: "http://example.test" }, evidence), /HTTPS/);
	assert.equal(calls, 0);
	assert.equal((await summarizeWithLlmPost(post, { ...options, enabled: true }, evidence)).synthesis, response.synthesis);
	assert.equal(calls, 1);
	const urls: string[] = [];
	const client = new SemanticScholarClient(async url => {
		urls.push(url);
		return urls.length === 1 ? { data: [], next: 1000 } : { data: [{ citedPaper: { externalIds: { DOI: "10.1/test" } }, intents: ["method"] }] };
	}, "fixture-key");
	const result = await client.referenceEvidence("10.1/fixture");
	assert.equal(result.partial, false); assert.equal(result.data.length, 1);
	assert.equal(new URL(urls[1]!).searchParams.get("offset"), "1000");
	await client.referenceEvidence("10.1/fixture"); assert.equal(urls.length, 2, "cache reuses pages");
	let malformed = 0;
	const retryClient = new SemanticScholarClient(async () => {
		malformed += 1;
		return malformed === 1 ? { message: "temporary malformed response" } : { data: [] };
	}, "retry-key");
	const retried = await retryClient.referenceEvidence("10.9/retry-format");
	assert.equal(malformed, 2, "a malformed 200 must not be reused by the retry");
	assert.equal(retried.data.length, 0);
	assert.equal(retried.partial, false, "an empty list is a finished result, not a failure");
	let pages = 0;
	const paged = new SemanticScholarClient(async (url) => {
		pages += 1;
		const offset = Number(new URL(url).searchParams.get("offset"));
		return { data: [{ citedPaper: { externalIds: { DOI: "10.1/page" } } }], next: offset + 1000 };
	}, "page-key");
	const capped = await paged.referenceEvidence("10.9/pages");
	assert.equal(pages, 3, "citation context stops after three pages");
	assert.equal(capped.partial, true);
	assert.equal(capped.data.length, 3);
	let stuck = 0;
	const stuckClient = new SemanticScholarClient(async () => {
		stuck += 1;
		return { data: [], next: 0 };
	}, "stuck-key");
	await assert.rejects(() => stuckClient.referenceEvidence("10.9/stuck"));
	assert.equal(stuck, 1, "a page that does not advance is not requested again");
	let failures = 0;
	const manual = new SemanticScholarClient(async () => {
		failures += 1;
		if (failures < 3) throw new Error("temporary");
		return { data: [] };
	}, "manual-key");
	await assert.rejects(() => manual.referenceEvidence("10.9/manual"));
	const recovered = await manual.referenceEvidence("10.9/manual");
	assert.equal(recovered.partial, false);
	assert.equal(recovered.data.length, 0);
	assert.ok(failures >= 3, "a failed request is not cached, so the next try reaches the network");
	const quiet = new CitationEvidenceStore();
	assert.equal(mergeS2CitationsForPair(quiet, "W3", "W1", "10.1/quiet", [{ citedPaper: { externalIds: { DOI: "10.1/quiet" } }, contexts: [], intents: [] }], normalizeDoi), true);
	assert.deepEqual(quiet.get("W3", "W1")?.intents, []);
	assert.deepEqual(quiet.get("W3", "W1")?.contexts, []);
	assert.deepEqual(quiet.get("W3", "W1")?.sources, ["semantic-scholar"]);

	// Lazy-load S2 context: directed edges only; reuse by citing DOI; stale selection ignored.
	const store = new CitationEvidenceStore();
	const getEv = (citingId: string, citedId: string) => store.get(citingId, citedId);
	const directed: GraphEdge = {
		source: "W3", target: "W1", weight: 0.4, coupling: 0, sharedRefs: 0, coCitation: 0, coCitedBy: 0, direct: "source-cites-target",
	};
	const similar: GraphEdge = { ...directed, direct: "none", sharedRefs: 3, coupling: 0.2 };
	assert.equal(edgePairNeedingS2Context(similar, getEv), null, "similarity edges must not request S2");
	assert.deepEqual(edgePairNeedingS2Context(directed, getEv), { citingId: "W3", citedId: "W1" });
	store.set(evidenceFromSemanticCitation("W3", "W1", { intents: ["method"], contexts: ["uses"] }));
	assert.equal(edgePairNeedingS2Context(directed, getEv), null, "already-filled pair skips fetch");
	const fresh = new CitationEvidenceStore();
	const rows = [
		{ citedPaper: { externalIds: { DOI: "10.1/OTHER" } }, intents: ["background"], contexts: ["nope"] },
		{ citedPaper: { externalIds: { DOI: "10.1038/nature14539" } }, intents: ["method"], contexts: ["uses method"] },
	];
	assert.equal(
		mergeS2CitationsForPair(fresh, "W3", "W1", "10.1038/nature14539", rows, normalizeDoi),
		true,
	);
	assert.deepEqual(fresh.get("W3", "W1")?.intents, ["method"]);
	assert.equal(mergeS2CitationsForPair(fresh, "W3", "W1", "10.9/missing", rows, normalizeDoi), false);
	assert.equal(edgeDetailStillCurrent(directed, directed, true), true);
	assert.equal(edgeDetailStillCurrent(similar, directed, true), false, "switching edges must not refresh the old detail");
	assert.equal(edgeDetailStillCurrent(directed, directed, false), false);
	const reused = new Map<string, Promise<unknown>>();
	const citingDoi = "10.1/citer";
	let fetches = 0;
	const fetchOnce = () => {
		let request = reused.get(citingDoi);
		if (!request) {
			fetches++;
			request = Promise.resolve(rows);
			reused.set(citingDoi, request);
		}
		return request;
	};
	await fetchOnce();
	await fetchOnce();
	assert.equal(fetches, 1, "same citing DOI reuses one in-flight request");

	// Budgeted DOI citation path over sampled reference lists.
	const lists = new Map<string, string[]>([
		["W1", ["W2", "W9"]],
		["W2", ["W3"]],
		["W4", ["W3"]],
	]);
	const path = findBudgetedCitationPath(lists, "W1", "W3", 50);
	assert.deepEqual(path.paths[0], ["W1", "W2", "W3"]);
	assert.equal(path.direction, "citing-to-cited");
	assert.equal(path.exhausted, false);
	const reverse = findBudgetedCitationPath(lists, "W3", "W1", 50);
	assert.deepEqual(reverse.paths[0], ["W3", "W2", "W1"]);
	assert.equal(reverse.direction, "cited-to-citing");
	const tight = findBudgetedCitationPath(lists, "W1", "W3", 1);
	assert.equal(tight.paths.length, 0);
	assert.equal(tight.exhausted, true, "tiny budget must report early exhaustion");
	assert.equal(
		resolvePathEndpoint("10.1038/nature14539", [{ id: "W1", doiUrl: "https://doi.org/10.1038/nature14539" }], normalizeDoi, shortId),
		"W1",
	);
	assert.equal(resolvePathEndpoint("W2", [{ id: "W2", doiUrl: null }], normalizeDoi, shortId), "W2");
	assert.equal(resolvePathEndpoint("10.9/missing", [{ id: "W1", doiUrl: null }], normalizeDoi, shortId), null);

	// updateGraphData (OpenCitations enrichment path) must keep the user's view state.
	// Headless: getContext returns null so draw/resize are no-ops; window is stubbed for listeners.
	(globalThis as unknown as { window: unknown }).window = {
		addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, setTimeout, clearTimeout,
	};
	const canvas = {
		addEventListener() {}, removeEventListener() {}, style: {}, width: 0, height: 0,
		getContext: () => null, getBoundingClientRect: () => ({ width: 800, height: 600 }),
	} as unknown as HTMLCanvasElement;
	const tooltip = { hidden: true, textContent: "", style: {} } as unknown as HTMLElement;
	const stage = { getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLElement;
	const map = new SimilarityMap(canvas, tooltip, stage);
	const mapGraph: SimilarityGraph = {
		nodes: [seed, prior, later], edges: [], seedScore: new Map(), warnings: [],
		strategies: { references: true, citations: true, related: false },
		catalog: [seed, prior, later], referenceLists: new Map(),
		citationEvidence: new CitationEvidenceStore(), skippedNonResearch: 0,
	};
	map.setGraph(mapGraph.nodes, mapGraph.edges, mapGraph.seedScore);
	map.setLayout("temporal");
	map.setScrubYear(2015);
	map.zoomBy(1.4);
	mergeOpenCitation(mapGraph, "W1", "W2");
	mergeOpenCitation(mapGraph, "W2", "W3");
	const internals = map as unknown as {
		layoutMode: string; scrubYear: number | null; k: number; tx: number; ty: number;
		edges: GraphEdge[]; communities: Map<string, number>;
	};
	const view = { k: internals.k, tx: internals.tx, ty: internals.ty };
	assert.notEqual(internals.communities.get("W1"), internals.communities.get("W3"));
	map.updateGraphData(mapGraph.edges);
	assert.equal(internals.layoutMode, "temporal", "enrichment must not reset layout mode");
	assert.equal(internals.scrubYear, 2015, "enrichment must not reset the scrub year");
	assert.deepEqual({ k: internals.k, tx: internals.tx, ty: internals.ty }, view, "enrichment must not refit the view");
	assert.equal(map.hasAdjusted(), true, "enrichment must not clear the user's pan/zoom flag");
	for (const zoom of [0.02, 0.25, 1, 4, 8, 16, 32]) {
		map.setViewState({ zoom, centerX: 0, centerY: 0, selectedId: "W2" });
		const restored = map.getViewState();
		assert.equal(restored.zoom, zoom);
		assert.equal(restored.selectedId, "W2");
	}
	map.setViewState({ zoom: 0, centerX: 0, centerY: 0, selectedId: null });
	assert.equal(map.getViewState().zoom, 0.02);
	map.setViewState({ zoom: 100, centerX: 0, centerY: 0, selectedId: null });
	assert.equal(map.getViewState().zoom, 32);
	const hitMap = map as unknown as {
		nodes: Array<{ id: string; x: number; y: number; radius: number; shown: boolean }>;
		k: number; tx: number; ty: number;
		hit: (x: number, y: number) => { id: string } | null;
	};
	const hitNode = hitMap.nodes.find((node) => node.id === "W2");
	assert.ok(hitNode);
	hitNode.x = 123;
	hitNode.y = 456;
	const zoomBeforeLocate = map.getViewState().zoom;
	map.focusPaper("W2");
	assert.deepEqual(map.getViewState(), { zoom: zoomBeforeLocate, centerX: 123, centerY: 456, selectedId: "W2" });
	const locatedView = map.getViewState();
	map.focusPaper("missing");
	assert.deepEqual(map.getViewState(), locatedView);
	assert.equal(internals.scrubYear, 2015, "locating alone must not change the current filters");
	hitNode.x = 0;
	hitNode.y = 0;
	hitNode.radius = 10;
	hitNode.shown = true;
	hitMap.k = 0.25;
	hitMap.tx = 100;
	hitMap.ty = 100;
	assert.equal(hitMap.hit(108, 100)?.id, "W2");
	hitMap.k = 4;
	assert.equal(hitMap.hit(140, 100), null);
	map.setContentFilter({ ...emptyFilter(), yearFrom: 2021, language: "fr" }, mapGraph.nodes);
	const shown = (map as unknown as { nodes: Array<{ id: string; shown: boolean }> }).nodes;
	assert.equal(shown.find((node) => node.id === "W2")?.shown, false);
	assert.equal(shown.find((node) => node.id === "W1")?.shown, true);
	map.setLabelMode("off");
	assert.equal(internals.edges, mapGraph.edges, "enriched edges are swapped in");
	assert.equal(internals.communities.get("W1"), internals.communities.get("W3"), "communities refresh with new edges");
}
