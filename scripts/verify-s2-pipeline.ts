import assert from "node:assert/strict";
import { fallbackAbstract, SemanticScholarClient, type PostJson } from "../src/citation-sources";
import { loadNeighborhood, enhancementText, type ReconcileSource } from "../src/neighborhood";
import { OpenAlexClient, OpenAlexError, retryAfterMs, type RawWork } from "../src/openalex";
import { embeddingCosine } from "../src/text-similarity";
import { abstractCaption, semanticHintFor } from "../src/detail-cards";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { restoreGraphSnapshot, saveGraphSnapshot } from "../src/project-state";
import { fixturePost } from "../preview/fixture";

export async function verifyS2Pipeline(): Promise<void> {
	const options = { semanticScholarApiKey: "", contactEmail: "" };
	let abstractRequests = 0;
	assert.deepEqual(await fallbackAbstract(async () => { abstractRequests++; throw new Error("unexpected request"); }, { doiUrl: null }, options), { status: "no-doi" });
	assert.equal(abstractRequests, 0, "missing DOI is not presented as three providers lacking an abstract");
	const emptyAbstract = await fallbackAbstract(async url => url.includes("semanticscholar") ? { abstract: null } : { message: {} }, { doiUrl: "https://doi.org/10.1234/abstract-empty" }, options);
	assert.deepEqual(emptyAbstract, { status: "unavailable" }, "completed empty requests are distinct from transport errors");
	let fail = true;
	const retryGet = async (url: string): Promise<unknown> => {
		if (url.includes("semanticscholar")) {
			if (fail) throw new Error("HTTP 429");
			return { abstract: "Recovered abstract" };
		}
		return { message: {} };
	};
	const retryPaper = { doiUrl: "https://doi.org/10.1234/abstract-retry" };
	const failedAbstract = await fallbackAbstract(retryGet, retryPaper, options);
	assert.equal(failedAbstract.status, "error", "rate limiting must not become a permanent abstract miss");
	if (failedAbstract.status === "error") assert.match(failedAbstract.error, /Semantic Scholar.*429/);
	fail = false;
	assert.deepEqual(await fallbackAbstract(retryGet, retryPaper, options), { status: "found", text: "Recovered abstract", source: "s2" }, "failed requests can be retried");
	const crossrefFallback = await fallbackAbstract(async url => {
		if (url.includes("semanticscholar")) throw new Error("offline");
		return { message: { abstract: "<p>Crossref abstract</p>" } };
	}, { doiUrl: "https://doi.org/10.1234/abstract-crossref" }, options);
	assert.deepEqual(crossrefFallback, { status: "found", text: "Crossref abstract", source: "crossref" }, "one provider failure does not block the other");
	let malformedCalls = 0;
	const malformedGet = async (url: string): Promise<unknown> => {
		if (!url.includes("semanticscholar")) return { message: {} };
		malformedCalls++;
		return malformedCalls === 1 ? { error: "bad response" } : { abstract: "Valid retry" };
	};
	const malformedPaper = { doiUrl: "https://doi.org/10.1234/abstract-malformed" };
	assert.equal((await fallbackAbstract(malformedGet, malformedPaper, options)).status, "error", "HTTP 200 error payloads are not empty abstracts");
	assert.equal((await fallbackAbstract(malformedGet, malformedPaper, options)).status, "found", "invalid payloads are evicted before retry");
	assert.equal(malformedCalls, 2);
	const previewS2 = new SemanticScholarClient(async () => ({}), "", fixturePost);
	assert.equal((await previewS2.bulkCounts(["10.1234/seed"])).get("10.1234/seed")?.citationCount, 100, "offline preview supplies the same batch response shape");
	assert.equal(retryAfterMs({ "Retry-After": "30" }), 30000);
	assert.equal(retryAfterMs({ "retry-after": "Thu, 01 Jan 1970 00:01:00 GMT" }, 10000), 50000);
	assert.equal(retryAfterMs({ "Retry-After": "invalid" }), undefined);
	assert.equal(embeddingCosine([Infinity, 1], [1, 1]), null);
	assert.equal(embeddingCosine([NaN], [1]), null);
	assert.equal(embeddingCosine([Number.MAX_VALUE], [Number.MAX_VALUE]), null);

	let requests = 0;
	const post: PostJson = async (_url, init) => {
		requests += 1;
		const ids = (JSON.parse(init.body) as { ids: string[] }).ids;
		assert.equal(ids.length, 2, "normalize and deduplicate DOI requests");
		return [
			{ paperId: "a", citationCount: 7, referenceCount: 3, abstract: "Speech perception evidence", embedding: { model: "specter_v1", vector: [1, 0] } },
			null,
		];
	};
	const client = new SemanticScholarClient(async () => ({}), "", post);
	const data = await client.bulkCounts(["10.1234/ABC", "https://doi.org/10.1234/abc", "10.1234/missing"], { embedding: true });
	assert.equal(data.size, 1);
	assert.equal(data.get("10.1234/abc")?.embeddingModel, "specter_v1");
	assert.equal(data.get("10.1234/abc")?.abstract, "Speech perception evidence");
	const cached = new SemanticScholarClient(async () => ({}), "", post);
	await Promise.all([
		cached.bulkCounts(["10.1234/abc", "10.1234/missing"], { embedding: true }),
		client.bulkCounts(["10.1234/abc"], { embedding: true }),
	]);
	assert.equal(requests, 1, "cache persists across client instances and concurrent builds");
	assert.equal(cached.batchStats?.cacheHits, 2, "explicit null misses are cached separately from errors");
	assert.equal(cached.batchStats?.notFound, 1);
	const differentAccount = new SemanticScholarClient(async () => ({}), "test-account", post);
	await differentAccount.bulkCounts(["10.1234/abc", "10.1234/missing"], { embedding: true });
	assert.equal(requests, 2, "credentials isolate caches");
	let ttlCalls = 0;
	const ttlClient = new SemanticScholarClient(async () => ({}), "", async () => {
		ttlCalls += 1;
		return [null];
	});
	await ttlClient.bulkCounts(["10.1234/ttl"]);
	const realNow = Date.now;
	try {
		Date.now = () => realNow() + 6 * 60000;
		await ttlClient.bulkCounts(["10.1234/ttl"]);
		assert.equal(ttlCalls, 2, "explicit misses expire rather than becoming permanent");
	} finally { Date.now = realNow; }
	let limitedRequests = 0;
	const limitedPost: PostJson = async () => {
		limitedRequests += 1;
		throw new OpenAlexError("rate limited", 429, 60000);
	};
	const limited = new SemanticScholarClient(async () => ({}), "", limitedPost);
	assert.equal((await limited.bulkCounts(["10.1234/x"], { embedding: true })).size, 0);
	assert.equal(limited.batchStats?.notFound, 0, "429 is not a permanent paper miss");
	assert.equal(limited.batchStats?.unresolved, 1);
	assert.equal(limited.batchStats?.rateLimited, true);
	const cooling = new SemanticScholarClient(async () => ({}), "", limitedPost);
	await cooling.bulkCounts(["10.1234/y"]);
	assert.equal(limitedRequests, 1, "long Retry-After stops retries and subsequent builds");
	assert.ok(cooling.batchStats?.error);
	const noTransport = new SemanticScholarClient(async () => ({}), "");
	await noTransport.bulkCounts(["10.1234/x"]);
	assert.ok(noTransport.batchStats?.error, "unavailable transport is explicitly reported");
	let recoveryCalls = 0;
	const recovery = new SemanticScholarClient(async () => ({}), "", async () => {
		if (++recoveryCalls === 1) throw new OpenAlexError("short rate limit", 429, 0);
		return [{ citationCount: 1, referenceCount: 0 }];
	});
	assert.equal((await recovery.bulkCounts(["10.1234/recovered"])).size, 1, "short rate limits receive at most one bounded retry");
	assert.equal(recoveryCalls, 2);
	assert.equal(recovery.batchStats?.error, undefined);
	assert.equal(recovery.batchStats?.rateLimited, true);

	let failureCalls = 0;
	const failingPost: PostJson = async () => {
		failureCalls += 1;
		if (failureCalls <= 2) throw new Error("temporary network failure");
		return [{ citationCount: 2, referenceCount: 1 }];
	};
	const failing = new SemanticScholarClient(async () => ({}), "", failingPost);
	await failing.bulkCounts(["10.1234/retry"]);
	assert.equal(failing.batchStats?.notFound, 0);
	await failing.bulkCounts(["10.1234/retry"]);
	assert.equal(failureCalls, 3, "transient failures are not cached as missing");

	const fields: string[] = [];
	const fallback = new SemanticScholarClient(async () => ({}), "", async url => {
		const value = new URL(url).searchParams.get("fields")!;
		fields.push(value);
		if (value.includes("embedding")) throw new OpenAlexError("unsupported embedding field", 400);
		return [{ citationCount: 4, referenceCount: 1, abstract: "Recovered abstract" }];
	});
	assert.equal((await fallback.bulkCounts(["10.1234/fallback"], { embedding: true })).size, 1);
	assert.equal(fields.length, 2);
	assert.equal(fallback.batchStats?.embeddingFallback, true);
	assert.ok(!fields[1]!.includes("embedding"));
	const malformed = new SemanticScholarClient(async () => ({}), "", async () => [{ message: "not paper metadata" }]);
	assert.equal((await malformed.bulkCounts(["10.1234/malformed"])).size, 0);
	assert.ok(malformed.batchStats?.error, "malformed responses must not look like successful metadata");
	assert.equal(malformed.batchStats?.notFound, 0);
	const invalid = new SemanticScholarClient(async () => ({}), "", async () => [
		{ embedding: { model: "specter_v1", vector: [0, 0] } },
		{ embedding: { model: "", vector: [1, 0] } },
		{ embedding: { model: "specter_v1", vector: [NaN, 0] } },
	]);
	assert.ok([...(await invalid.bulkCounts(["10.1234/a", "10.1234/b", "10.1234/c"], { embedding: true })).values()].every(item => item.embedding === null));

	const rawSeed: RawWork = { id: "W1", display_name: "Speech perception", doi: "10.1234/seed", referenced_works: [] };
	const candidates: RawWork[] = Array.from({ length: 24 }, (_, i) => ({
		id: `W${i + 2}`, display_name: `Candidate ${i}`, doi: `10.1234/c${i}`,
		cited_by_count: i === 23 ? 1 : 100, type: "article",
	}));
	let detailsBeforeS2 = false;
	const oa = new OpenAlexClient(async url => {
		const request = new URL(url);
		if (request.pathname === "/works/W1") return rawSeed;
		const filter = request.searchParams.get("filter") ?? "";
		if (filter.startsWith("cited_by:")) return { results: candidates, meta: { next_cursor: null } };
		detailsBeforeS2 = true;
		return { results: filter.slice(9).split("|").map(id => ({ id, referenced_works: [] })) };
	}, { apiKey: "", contactEmail: "" });
	let batchCalls = 0;
	const reconcile: ReconcileSource = {
		async bulkCounts(dois, opts) {
			batchCalls += 1;
			assert.ok(detailsBeforeS2, "OpenAlex details are requested before S2");
			assert.ok(dois.includes("10.1234/c23"), "low-citation candidates are also enhanced");
			return new Map(dois.map(doi => [doi, {
				citationCount: 1, referenceCount: 0,
				abstract: doi === "10.1234/c23" ? "Speech perception" : null,
				embedding: opts?.embedding ? doi.endsWith("/seed") || doi.endsWith("/c23") ? [1, 0] : [0, 1] : null,
				embeddingModel: "specter_v1",
			}]));
		},
		referenceDois: async () => [],
	};
	const settings = { ...DEFAULT_SETTINGS, maxNodes: 20, includeCitations: false, includeRelated: false };
	const baseline = await loadNeighborhood(oa, { kind: "openalex", value: "W1" }, { ...settings, s2Reconcile: false });
	assert.ok(!baseline.nodes.some(paper => paper.id === "W25"), "low-citation candidate is not selected without semantic enhancement");
	const graph = await loadNeighborhood(oa, { kind: "openalex", value: "W1" }, settings, undefined, reconcile);
	assert.equal(batchCalls, 1, "do not request the same records again after selection");
	assert.ok(graph.nodes.some(paper => paper.id === "W25"), "preselection semantic evidence can admit a low-citation candidate");
	assert.equal(graph.selectionRank?.get("W25")?.semantic, 1, "selection-time score uses remote vectors");
	assert.equal(graph.selectionRank?.get("W25")?.semanticChannel, "embedding");
	assert.equal(graph.selectionRank?.get("W25")?.semanticModel, "specter_v1");
	assert.equal(graph.semanticModel, "specter_v1", "never assume SPECTER2");
	assert.equal(graph.enhancement?.abstractsAdded, 1);
	const enrichedPaper = graph.nodes.find(paper => paper.id === "W25")!;
	assert.match(abstractCaption(enrichedPaper, { s2: new Set(), crossref: new Set(), missing: new Set() }), /Semantic Scholar/, "prefetched abstract retains its source without transient UI state");
	assert.match(enhancementText(graph), /25\/25/);
	assert.match(semanticHintFor("embedding", graph.semanticModel), /specter_v1/);
	const restored = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph))));
	assert.deepEqual(restored?.enhancement, graph.enhancement, "coverage survives reopening");
	assert.deepEqual(restored?.semanticVectorIds, graph.semanticVectorIds);
	assert.deepEqual(restored?.selectionRank?.get("W25"), graph.selectionRank?.get("W25"), "historical semantic provenance survives JSON snapshots");
	assert.equal(restored?.nodes.find(paper => paper.id === "W25")?.abstractSource, "s2");
	const captionSources = { s2: new Set<string>(), crossref: new Set<string>(), missing: new Set<string>(), errors: new Map([[enrichedPaper.id, "HTTP 429"]]) };
	const noAbstract = { ...enrichedPaper, abstract: "" };
	assert.match(abstractCaption(noAbstract, captionSources), /429/, "request failure is visible in abstract caption");
	assert.doesNotMatch(abstractCaption(noAbstract, captionSources), /都没有|No abstract is available/, "failure does not claim providers lack the abstract");
	assert.equal(restoreGraphSnapshot({ ...saveGraphSnapshot(graph), enhancement: { s2: null } }), null, "malformed enhancement snapshots do not reach UI rendering");

	const mixed: ReconcileSource = {
		async bulkCounts(dois) {
			return new Map(dois.map(doi => [doi, {
				citationCount: 1, referenceCount: 0,
				embedding: doi === "10.1234/c1" ? [1, 0, 0] : [1, 0],
				embeddingModel: doi === "10.1234/c0" ? "other-model" : "specter_v1",
			}]));
		}, referenceDois: async () => [],
	};
	const mixedGraph = await loadNeighborhood(oa, { kind: "openalex", value: "W1" }, settings, undefined, mixed);
	assert.ok(!mixedGraph.semanticVectorIds?.includes("W2"), "different model must not be compared");
	assert.ok(!mixedGraph.semanticVectorIds?.includes("W3"), "different dimensions must not be compared");
	const noSeed: ReconcileSource = {
		async bulkCounts(dois) {
			return new Map(dois.filter(doi => doi !== "10.1234/seed").map(doi => [doi, {
				citationCount: 1, referenceCount: 0, embedding: [1, 0], embeddingModel: "specter_v1",
			}]));
		}, referenceDois: async () => [],
	};
	assert.equal((await loadNeighborhood(oa, { kind: "openalex", value: "W1" }, settings, undefined, noSeed)).semanticMode, "local");
	const failed: ReconcileSource = { bulkCounts: async () => { throw new Error("offline"); }, referenceDois: async () => [] };
	const local = await loadNeighborhood(oa, { kind: "openalex", value: "W1" }, settings, undefined, failed);
	assert.ok(local.nodes.length > 1, "S2 failure never prevents local graph construction");
	assert.ok(local.warnings.includes("crosscheck"));
	assert.equal(local.enhancement?.s2.unresolved, 25);
	const lingTopic = { id: "T1", display_name: "Phonology", score: 1, field: { id: "F1", display_name: "Linguistics" } };
	const managementTopic = { id: "T2", display_name: "Management", score: 1, field: { id: "F2", display_name: "Business" } };
	const disciplineSeed = { ...rawSeed, topics: [lingTopic], primary_topic: lingTopic };
	const disciplineCandidate = { ...candidates[0]!, topics: [managementTopic], primary_topic: managementTopic };
	const admissionOA = new OpenAlexClient(async url => {
		const request = new URL(url);
		if (request.pathname === "/works/W1") return disciplineSeed;
		if (request.searchParams.get("filter")?.startsWith("cited_by:")) return { results: [disciplineCandidate], meta: { next_cursor: null } };
		return { results: [] };
	}, { apiKey: "", contactEmail: "" });
	const abstractSource: ReconcileSource = {
		bulkCounts: async () => new Map([["10.1234/c0", { citationCount: 1, referenceCount: 0, abstract: "Speech perception in workplaces" }]]),
		referenceDois: async () => [],
	};
	const rescued = await loadNeighborhood(admissionOA, { kind: "openalex", value: "W1" }, settings, undefined, abstractSource);
	assert.equal(rescued.nodes.find(paper => paper.id === "W2")?.admission?.status, "cross-disciplinary", "candidate abstract is evaluated before final discipline admission");
	assert.ok(!rescued.candidateAudit?.find(item => item.id === "W2")?.rejection);
	const withoutAbstract = await loadNeighborhood(admissionOA, { kind: "openalex", value: "W1" }, { ...settings, s2Reconcile: false });
	assert.ok(!withoutAbstract.nodes.some(paper => paper.id === "W2"), "absence of corroborating content preserves conservative exclusion");
	const manyCandidates = Array.from({ length: 200 }, (_, i) => ({
		...candidates[0]!, id: `W${100 + i}`, doi: `10.1234/budget${i}`,
	}));
	let earlyDetailCount = 0;
	const budgetOA = new OpenAlexClient(async url => {
		const request = new URL(url);
		if (request.pathname === "/works/W1") return rawSeed;
		if (request.searchParams.get("filter")?.startsWith("cited_by:")) return { results: manyCandidates, meta: { next_cursor: null } };
		earlyDetailCount += (request.searchParams.get("filter") ?? "").split("|").length;
		return { results: [] };
	}, { apiKey: "", contactEmail: "" });
	const budgetS2: ReconcileSource = {
		bulkCounts: async dois => {
			assert.ok(earlyDetailCount <= 161, "OpenAlex preselection request budget is bounded");
			assert.ok(dois.length <= 121, "S2 candidate budget is bounded including seed");
			return new Map();
		}, referenceDois: async () => [],
	};
	await loadNeighborhood(budgetOA, { kind: "openalex", value: "W1" }, { ...settings, maxNodes: 300, sampleDepth: "extended" }, undefined, budgetS2);
	console.log("S2 pipeline checks passed");
}
