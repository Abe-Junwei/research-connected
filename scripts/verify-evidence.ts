import assert from "node:assert/strict";
import { CitationEvidenceStore, mergeOpenCitation, evidenceFromSemanticCitation } from "../src/citation-evidence";
import { doisFromOpenCitation, SemanticScholarClient } from "../src/citation-sources";
import { SimilarityMap } from "../src/map-canvas";
import { buildNarrativeEvidence, validateNarrative } from "../src/narrative";
import { summarizeWithLlmPost } from "../src/llm";
import type { SimilarityGraph } from "../src/neighborhood";
import type { GraphEdge, PaperNode } from "../src/types";

export async function verifyEvidence(): Promise<void> {
	const paper = (id: string, seed = false): PaperNode => ({
		id, isSeed: seed, title: id, year: seed ? 2010 : 2020, authors: "Author",
		abstract: "private abstract", doiUrl: null, openAlexUrl: "https://openalex.org/" + id,
		origin: seed ? "seed" : "citation", citedByCount: 10, language: null, workType: null, concepts: [],
	});
	const seed = paper("W1", true), prior = paper("W2"), later = paper("W3");
	const graph: SimilarityGraph = {
		nodes: [seed, prior, later], edges: [], seedScore: new Map(), warnings: [],
		strategies: { references: true, citations: true, related: false },
		catalog: [seed, prior, later], referenceLists: new Map([["W1", ["W2"]], ["W3", ["W1"]]]),
		citationEvidence: new CitationEvidenceStore(),
	};
	mergeOpenCitation(graph, "W1", "W2");
	assert.deepEqual(graph.citationEvidence!.get("W1", "W2")!.sources, ["openalex", "opencitations"]);
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
	assert.deepEqual(doisFromOpenCitation({ citing: "[index] => omid:1 doi:10.1/ABC; doi:10.2/DEF" }).citing, ["10.1/abc", "10.2/def"]);
	const evidence = buildNarrativeEvidence(graph, false);
	assert.equal(evidence.priorWorks[0]!.id, "W2");
	assert.ok(evidence.derivativeWorks.some(p => p.id === "W3"), "direct citer with only one reference must be included");
	assert.ok(!JSON.stringify(evidence).includes("private abstract"));
	assert.ok(JSON.stringify(buildNarrativeEvidence(graph, true)).includes("private abstract"));
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

	// updateGraphData (OpenCitations enrichment path) must keep the user's view state.
	// Headless: getContext returns null so draw/resize are no-ops; window is stubbed for listeners.
	(globalThis as unknown as { window: unknown }).window = {
		addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1,
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
		citationEvidence: new CitationEvidenceStore(),
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
	assert.equal(internals.edges, mapGraph.edges, "enriched edges are swapped in");
	assert.equal(internals.communities.get("W1"), internals.communities.get("W3"), "communities refresh with new edges");
}
