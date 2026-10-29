import "../src/host-language";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { OpenAlexClient, OpenAlexError, retryAfterMs, toPaper, type RawWork, type GetJson } from "../src/openalex";
import { loadNeighborhood, type SimilarityGraph, type ReconcileSource } from "../src/neighborhood";
import { SemanticScholarClient, type PostJson, type S2Counts } from "../src/citation-sources";
import type { S2BatchStats } from "../src/s2-batch";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { classifyQuery, normalizeDoi, shortId } from "../src/paper";
import { placeLayout, type PlacedNode } from "../src/layout-modes";

if (typeof window === "undefined") Object.assign(globalThis, { window: { setTimeout, clearTimeout } });

const CAPS = [30, 50, 80, 120];
const ROUNDS = 5;
const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const directory = option("--out");
if (!directory) throw new Error("Provide --out=/absolute/evaluation-directory; use --capture to fetch public fixtures.");
const out = resolve(directory);
mkdirSync(out, { recursive: true });

interface Fixture {
	version: 1;
	capturedAt: string;
	query: string;
	seed: RawWork;
	groups: Record<"reference" | "citation" | "related", RawWork[]>;
	sourceStats: Record<string, unknown>;
	s2?: { data: Array<[string, S2Counts]>; stats?: S2BatchStats; requestedDois?: string[] };
}
interface Annotation {
	seedId: string;
	paperId: string;
	label: "relevant" | "cross-disciplinary" | "irrelevant" | "uncertain" | null;
	core: boolean | null;
	title: string;
	doi: string | null;
}

const get: GetJson = async (url, init) => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(30000) });
		if (!response.ok) {
			if (attempt === 0 && response.status >= 500) continue;
			throw new OpenAlexError(`Public API HTTP ${response.status}`, response.status, retryAfterMs({ "retry-after": response.headers.get("retry-after") ?? "" }));
		}
		return response.json();
	}
	throw new Error("HTTP retry exhausted");
};
const post: PostJson = async (url, init) => {
	const response = await fetch(url, { method: "POST", ...init, signal: AbortSignal.timeout(30000) });
	if (!response.ok) throw new OpenAlexError(`S2 HTTP ${response.status}`, response.status, retryAfterMs({ "retry-after": response.headers.get("retry-after") ?? "" }));
	return response.json();
};

async function capture(query: string): Promise<Fixture> {
	const parsed = classifyQuery(query);
	if (!parsed || parsed.kind === "search") throw new Error(`Use exact DOI/OpenAlex ID: ${query}`);
	// Capture full metadata once; all configurations replay the identical, hashed records.
	const client = new OpenAlexClient(async (url, init) => {
		const request = new URL(url);
		const select = request.searchParams.get("select");
		if (select) request.searchParams.set("select", [...new Set([...select.split(","), "abstract_inverted_index", "referenced_works"])].join(","));
		return get(request.toString(), init);
	}, { apiKey: "", contactEmail: "" });
	const seed = parsed.kind === "doi" ? await client.workByDoi(parsed.value) : await client.workById(parsed.value);
	if (!seed.id || !seed.display_name) throw new Error(`Invalid seed metadata for ${query}`);
	const seedId = shortId(seed.id);
	const fixture: Fixture = { version: 1, capturedAt: new Date().toISOString(), query, seed, groups: { reference: [], citation: [], related: [] }, sourceStats: {} };
	for (const [source, filter, target, sort] of [
		["reference", `cited_by:${seedId}`, 200, "cited_by_count:desc"],
		["citation", `cites:${seedId}`, 200, "cited_by_count:desc"],
		["related", `related_to:${seedId}`, 50, undefined],
	] as const) {
		const sample = await client.sampleWorks(filter, target, 100, sort, 2, () => true);
		fixture.groups[source] = sample.works;
		const { works: _works, rejected: _rejected, duplicateWorks: _duplicates, ...stats } = sample;
		fixture.sourceStats[source] = stats;
		console.log(JSON.stringify({ seedId, source, records: sample.works.length, error: sample.error ?? null }));
	}
	if (!Object.values(fixture.groups).some(group => group.length)) throw new Error(`No candidates captured for ${seedId}`);
	if (args.includes("--s2")) {
		const s2 = new SemanticScholarClient(get, "", post);
		const dois = [seed, ...Object.values(fixture.groups).flat()].flatMap(raw => {
			const paper = toPaper(raw, "related");
			return paper?.doiUrl ? [paper.doiUrl] : [];
		});
		const data = await s2.bulkCounts(dois, { embedding: true });
		fixture.s2 = { data: [...data], stats: s2.batchStats, requestedDois: [...new Set(dois.map(normalizeDoi).filter((doi): doi is string => Boolean(doi)))] };
	}
	return fixture;
}

function replay(fixture: Fixture, count: { calls: number; details: number }): OpenAlexClient {
	const records = new Map([fixture.seed, ...Object.values(fixture.groups).flat()].map(raw => [shortId(raw.id ?? ""), raw]));
	return new OpenAlexClient(async url => {
		count.calls += 1;
		const request = new URL(url);
		if (request.pathname !== "/works") return fixture.seed;
		const filter = request.searchParams.get("filter") ?? "";
		if (filter.startsWith("openalex:")) {
			const ids = filter.slice(9).split("|");
			count.details += ids.length;
			return { results: ids.map(id => records.get(id)).filter(Boolean) };
		}
		const source = filter.startsWith("cited_by:") ? "reference" : filter.startsWith("cites:") ? "citation" : "related";
		const offset = Number(request.searchParams.get("cursor")) || 0;
		const size = Number(request.searchParams.get("per_page")) || 100;
		const rows = fixture.groups[source].slice(offset, offset + size).map(raw => {
			const { abstract_inverted_index: _abstract, referenced_works: _refs, ...list } = raw;
			return list;
		});
		return { results: rows, meta: { next_cursor: offset + size < fixture.groups[source].length ? String(offset + size) : null } };
	}, { apiKey: "", contactEmail: "" });
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (value: number): number => Math.round(value * 1000) / 1000;
function pairOverlaps(nodes: readonly PlacedNode[]): number {
	let count = 0;
	for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
		const a = nodes[i]!, b = nodes[j]!;
		if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) count += 1;
	}
	return count;
}
function neighbors(nodes: readonly PlacedNode[], id: string, common: Set<string>): Set<string> {
	const node = nodes.find(item => item.id === id)!;
	return new Set(nodes.filter(item => item.id !== id && common.has(item.id))
		.sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y) || a.id.localeCompare(b.id))
		.slice(0, 5).map(item => item.id));
}
function stability(previous: readonly PlacedNode[], next: readonly PlacedNode[]): number | null {
	const common = new Set(previous.map(node => node.id).filter(id => next.some(node => node.id === id)));
	if (common.size < 2) return null;
	const k = Math.min(5, common.size - 1);
	return round([...common].reduce((sum, id) => {
		const left = neighbors(previous, id, common), right = neighbors(next, id, common);
		return sum + [...left].filter(other => right.has(other)).length / k;
	}, 0) / common.size);
}

async function evaluate(fixture: Fixture, annotations: Annotation[]) {
	const results = [];
	let previousGraph: SimilarityGraph | undefined;
	let previousLayout: PlacedNode[] | undefined;
	const review = new Map<string, Annotation>();
	const seedId = shortId(fixture.seed.id!);
	const labels = annotations.filter(item => item.seedId === seedId);
	for (const source of ["reference", "citation", "related"] as const) {
		for (const raw of fixture.groups[source]) {
			const paper = toPaper(raw, source);
			if (paper && paper.id !== seedId) review.set(paper.id, labels.find(item => item.paperId === paper.id) ?? {
				seedId, paperId: paper.id, label: null, core: null, title: paper.title, doi: paper.doiUrl,
			});
		}
	}
	// A fixed non-monotone order avoids always running the smallest cap on a cold engine.
	const order = [80, 30, 120, 50];
	const builds = new Map<number, { graph: SimilarityGraph; times: number[]; layouts: number[]; placed: PlacedNode[]; count: { calls: number; details: number } }>();
	let replayStats: S2BatchStats | undefined;
	const capturedDois = new Set(fixture.s2?.requestedDois ?? [fixture.seed, ...Object.values(fixture.groups).flat()]
		.map(raw => normalizeDoi(raw.doi)).filter((doi): doi is string => Boolean(doi)));
	const reconcile: ReconcileSource | undefined = fixture.s2 ? {
		bulkCounts: async dois => {
			const data = new Map(fixture.s2!.data.filter(([doi]) => dois.includes(doi)));
			const notFound = fixture.s2?.stats?.unresolved === 0
				? dois.filter(doi => capturedDois.has(doi) && !data.has(doi)).length : 0;
			replayStats = {
				requested: dois.length, found: data.size, notFound, unresolved: dois.length - data.size - notFound,
				cacheHits: 0, requests: 0, rateLimited: fixture.s2?.stats?.rateLimited ?? false,
				embeddingFallback: fixture.s2?.stats?.embeddingFallback ?? false, error: fixture.s2?.stats?.error,
			};
			return data;
		},
		get batchStats() { return replayStats; },
		referenceDois: async () => [],
	} : undefined;
	for (const cap of order) {
		const times: number[] = [], layouts: number[] = [];
		let graph: SimilarityGraph | undefined;
		let placed: PlacedNode[] = [];
		let count = { calls: 0, details: 0 };
		let signature = "";
		for (let run = 0; run <= ROUNDS; run++) {
			count = { calls: 0, details: 0 };
			const start = performance.now();
			graph = await loadNeighborhood(replay(fixture, count), { kind: "openalex", value: shortId(fixture.seed.id!) },
				{ ...DEFAULT_SETTINGS, maxNodes: cap, sampleDepth: "extended", s2Reconcile: Boolean(fixture.s2) }, undefined, reconcile);
			assert.ok(graph.nodes.length <= cap, "automatic replay cannot exceed its node cap");
			const elapsed = performance.now() - start;
			const layoutStart = performance.now();
			placed = placeLayout("force2d", graph.nodes, graph.edges, graph.seedScore);
			const layoutElapsed = performance.now() - layoutStart;
			const current = JSON.stringify({ ids: graph.nodes.map(node => node.id), edges: graph.edges, placed });
			if (run) { assert.equal(current, signature, "fixed fixture replay must be deterministic"); times.push(elapsed); layouts.push(layoutElapsed); }
			signature = current;
		}
		builds.set(cap, { graph: graph!, times, layouts, placed, count });
	}
	for (const cap of CAPS) {
		const { graph, times, layouts, placed, count } = builds.get(cap)!;
		const previousIds = new Set(previousGraph?.nodes.map(node => node.id) ?? []);
		const nonSeed = graph.nodes.filter(node => !node.isSeed);
		const added = nonSeed.filter(node => !previousIds.has(node.id));
		const topicIds = new Set(previousGraph?.nodes.flatMap(node => node.topicTags?.map(topic => topic.id) ?? []) ?? []);
		const newTopics = new Set(added.flatMap(node => node.topicTags?.map(topic => topic.id) ?? []).filter(id => !topicIds.has(id)));
		for (const node of nonSeed) review.set(node.id, labels.find(item => item.paperId === node.id) ?? {
			seedId, paperId: node.id, label: null, core: null, title: node.title, doi: node.doiUrl,
		});
		const judged = nonSeed.map(node => labels.find(item => item.paperId === node.id)).filter((item): item is Annotation => Boolean(item?.label && item.label !== "uncertain"));
		const core = labels.filter(item => item.core === true);
		results.push({
			cap, nodes: graph.nodes.length, edges: graph.edges.length,
			addedNodes: added.length, removedNodes: previousGraph ? previousGraph.nodes.filter(node => !graph.nodes.some(other => other.id === node.id)).length : 0,
			newTopicIds: newTopics.size, unknownDiscipline: nonSeed.filter(node => node.admission?.status === "uncertain").length,
			crossDisciplinary: nonSeed.filter(node => node.admission?.status === "cross-disciplinary").length,
			replayMsMedian: round(median(times)), layoutMsMedian: round(median(layouts)),
			logicalOpenAlexCalls: count.calls, detailIdsRequested: count.details,
			circleOverlapPairs: pairOverlaps(placed), neighborRetentionAt5: previousLayout ? stability(previousLayout, placed) : null,
			labelCoverage: nonSeed.length ? judged.length / nonSeed.length : 0,
			irrelevantRateAmongJudged: judged.length ? judged.filter(item => item.label === "irrelevant").length / judged.length : null,
			coreRecallWithinAnnotatedPool: core.length ? core.filter(item => graph.nodes.some(node => node.id === item.paperId)).length / core.length : null,
			enhancement: graph.enhancement ?? null, warnings: graph.warnings,
			selectedSameModelVectors: graph.semanticVectorIds?.length ?? 0,
			model: graph.semanticModel ?? null,
			selectedIds: graph.nodes.map(node => node.id),
		});
		previousGraph = graph; previousLayout = placed;
	}
	return { seedId: shortId(fixture.seed.id!), title: fixture.seed.display_name, capturedAt: fixture.capturedAt,
		sourceStats: fixture.sourceStats, s2Capture: fixture.s2?.stats ?? null, results, review: [...review.values()] };
}

async function main(): Promise<void> {
	const queries = (option("--seeds") ?? "W1532553368,W2741809807,10.18653/v1/N16-1180").split(",");
	const manifestPath = join(out, "fixtures.json");
	let fixtures: Fixture[];
	if (args.includes("--capture")) {
		fixtures = [];
		for (const query of queries) {
			const fixture = await capture(query);
			fixtures.push(fixture);
			writeFileSync(manifestPath, JSON.stringify(fixtures));
		}
	} else fixtures = JSON.parse(readFileSync(manifestPath, "utf8")) as Fixture[];
	assert.ok(fixtures.length > 0 && fixtures.every(fixture => fixture.version === 1), "valid frozen fixtures required");
	const labelPath = option("--labels");
	const annotations = labelPath ? JSON.parse(readFileSync(labelPath, "utf8")) as Annotation[] : [];
	assert.ok(Array.isArray(annotations) && annotations.every(item => item && typeof item.seedId === "string" && typeof item.paperId === "string"
		&& [null, "relevant", "cross-disciplinary", "irrelevant", "uncertain"].includes(item.label)
		&& (item.core === null || typeof item.core === "boolean")), "invalid annotation file");
	assert.equal(new Set(annotations.map(item => `${item.seedId}\0${item.paperId}`)).size, annotations.length, "duplicate annotation rows");
	const results = [];
	for (const fixture of fixtures) results.push(await evaluate(fixture, annotations));
	const report = {
		createdAt: new Date().toISOString(), fixtureSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
		implementationSha256: createHash("sha256").update(readFileSync(process.argv[1]!)).digest("hex"),
		environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform, scoringYear: new Date().getFullYear() },
		design: {
			caps: CAPS, measuredRounds: ROUNDS, warmupRounds: 1, processingOrder: [80, 30, 120, 50],
			unit: "seed paper; repeated timings are not independent literature samples",
			comparison: "paired frozen-pool comparison of production configurations, including cap-dependent enrichment budgets",
			sampling: "extended, fixed source pools; anonymous public capture, no credential persisted",
			notMeasured: ["human relevance without labels", "global literature recall", "network latency in replay", "browser frame rate", "rendered label occlusion", "human-perceived information gain"],
			proxies: "new topic IDs, circle overlaps and neighborhood retention are structural diagnostics, not relevance or UX validation",
			s2: "frozen optional bulk metadata; reference-list backfill not captured and therefore disabled; replay stats have zero network requests, live capture stats are reported separately",
			sourceCompleteness: "sourceStats preserve capture failures such as anonymous cursor HTTP 401; replay warnings alone do not describe source completeness",
			conclusion: "Do not change defaults based only on this pilot. Human annotation and browser/host validation remain required.",
		},
		seeds: results.map(({ review: _review, ...result }) => result),
	};
	writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2));
	// Never overwrite completed annotations; this is a separate, blank review queue.
	writeFileSync(join(out, "annotation-template.json"), JSON.stringify(results.flatMap(result => result.review), null, 2));
	console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
