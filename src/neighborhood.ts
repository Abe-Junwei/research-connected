import {
	OpenAlexClient,
	OpenAlexError,
	type RawWork,
	type SampledWorks,
} from "./openalex";
import { reconstructAbstract, referenceIds, shortId, toPaper, nonResearchLabel } from "./paper";
import { buildSimilarity } from "./similarity";
import { CitationEvidenceStore, directEvidence } from "./citation-evidence";
import { doiFromPaper, type S2Counts } from "./citation-sources";
import type { ConnectedPapersSettings, SampleDepth } from "./settings-model";
import type { GraphEdge, Origin, PaperNode } from "./types";

export type LoadStage = "resolving" | "fetching" | "scoring";
export type LoadWarning = "references" | "citations" | "related" | "details" | "crosscheck";

/**
 * Sampling tiers. Standard matches the historical behavior. Extended pulls a
 * full 200-per-page list; deep cursor-pages references and citations up to
 * 1000 works each. Deep costs roughly 20 requests per map and wants an API key.
 * Related works are never paged (the list has no meaningful sort).
 */
export const SAMPLE_TIERS: Record<
	SampleDepth,
	{ references: number; citations: number; related: number; pages: number }
> = {
	standard: { references: 80, citations: 40, related: 20, pages: 2 },
	extended: { references: 200, citations: 200, related: 50, pages: 2 },
	deep: { references: 200, citations: 200, related: 100, pages: 5 },
};

/** Co-citation context (reference lists of citing papers) is capped so deep sampling stays within budget. */
const MAX_CONTEXT_CITERS = 400;

export interface SimilarityGraph {
	nodes: PaperNode[];
	edges: GraphEdge[];
	seedScore: Map<string, number>;
	warnings: LoadWarning[];
	strategies: {
		references: boolean;
		citations: boolean;
		related: boolean;
	};
	/** Reference lists for graph nodes and for citing papers kept as co-citation context. */
	referenceLists: ReadonlyMap<string, readonly string[]>;
	/** Titles we already fetched, including citers that did not become nodes. */
	catalog: readonly PaperNode[];
	citationEvidence?: CitationEvidenceStore;
	/** Book reviews, editorials, and other non-research records dropped from the sample. */
	skippedNonResearch: number;
	/** Per-source sampling counters. Optional to keep offline fixtures backwards-compatible. */
	retrievalStats?: Readonly<Record<"references" | "citations" | "related", RetrievalStats>>;
	/** Per-node Semantic Scholar cross-check, when reconcile ran. Keyed by OpenAlex id. */
	crossCheck?: ReadonlyMap<string, CrossCheck>;
}

export interface RetrievalStats {
	rawFetched: number;
	accepted: number;
	filtered: number;
	pages: number;
	exhausted: boolean;
	partial: boolean;
}

/** Semantic Scholar numbers for the same DOI, plus what backfill changed. */
export interface CrossCheck {
	s2Citations: number | null;
	s2References: number | null;
	/** Reference links to other graph nodes that came from the S2 backfill. */
	refsAdded: number;
	/** Reference links that came from Crossref after OpenAlex/S2 had no list. */
	crossrefRefsAdded?: number;
	/** True when the two sources disagree by an order of magnitude — usually a misattributed record. */
	mismatched: boolean;
}

/** What loadNeighborhood needs from Semantic Scholar for reconciliation. */
export interface ReconcileSource {
	bulkCounts(dois: string[]): Promise<Map<string, S2Counts>>;
	referenceDois(doi: string): Promise<string[]>;
}

export interface CrossrefReferenceSource {
	referenceDois(doi: string): Promise<string[]>;
}

/** Citation counts this far apart almost always mean a misattributed record (e.g. a review carrying the book's citations). */
export function countsMismatched(openAlexCitations: number, s2Citations: number | null): boolean {
	if (s2Citations === null) return false;
	const hi = Math.max(openAlexCitations, s2Citations);
	const lo = Math.min(openAlexCitations, s2Citations);
	return hi >= 50 && hi >= 10 * Math.max(lo, 1);
}

/** S2 rate limits are tight without a key, so backfill only the worst gaps. */
const MAX_RECONCILE_BACKFILL = 12;

const ORIGIN_RANK: Record<Origin, number> = {
	seed: 4,
	reference: 3,
	citation: 2,
	related: 1,
};

/**
 * Resolve a seed, sample its OpenAlex neighborhood, then score pairs.
 * Reference lists for coupling and co-citation come from a second batched fetch.
 */
export async function loadNeighborhood(
	client: OpenAlexClient,
	target: { kind: "doi" | "openalex"; value: string },
	settings: ConnectedPapersSettings,
	onStage?: (stage: LoadStage) => void,
	reconcile?: ReconcileSource | null,
	crossref?: CrossrefReferenceSource | null,
): Promise<SimilarityGraph> {
	if (!settings.includeReferences && !settings.includeCitations && !settings.includeRelated) {
		throw new OpenAlexError("请至少开启一种邻居策略（参考文献、施引或相关作品）。");
	}

	onStage?.("resolving");
	const seedRaw =
		target.kind === "doi" ? await client.workByDoi(target.value) : await client.workById(target.value);
	const seed = toPaper(seedRaw, "seed");
	if (!seed) throw new OpenAlexError("OpenAlex 返回的种子作品缺少标题或 ID。");

	onStage?.("fetching");
	const tier = SAMPLE_TIERS[settings.sampleDepth] ?? SAMPLE_TIERS.standard;
	const acceptsResearch = (work: RawWork): boolean => {
		const paper = toPaper(work, "related");
		return Boolean(paper && paper.id !== seed.id && !nonResearchLabel(paper));
	};
	const [references, citations, related] = await Promise.all([
		loadGroup(settings.includeReferences, () => client.sampleWorks(`cited_by:${seed.id}`, tier.references, tier.references, "cited_by_count:desc", tier.pages, acceptsResearch)),
		loadGroup(settings.includeCitations, () => client.sampleWorks(`cites:${seed.id}`, tier.citations, tier.citations, "cited_by_count:desc", tier.pages, acceptsResearch)),
		loadGroup(settings.includeRelated, () => client.sampleWorks(`related_to:${seed.id}`, tier.related, tier.related, undefined, 1, acceptsResearch)),
	]);

	const warnings: LoadWarning[] = [];
	if (references.error) warnings.push("references");
	if (citations.error) warnings.push("citations");
	if (related.error) warnings.push("related");
	const enabledCount = [settings.includeReferences, settings.includeCitations, settings.includeRelated].filter(
		Boolean,
	).length;
	if (warnings.length >= enabledCount) {
		throw new OpenAlexError("没有读到邻居作品。请检查网络、API 密钥或额度。");
	}

	const refAll = asPapers(references.works, "reference", seed.id);
	const citeAll = asPapers(citations.works, "citation", seed.id);
	const relatedAll = asPapers(related.works, "related", seed.id);
	// Reviews and editorials are dropped as nodes and as co-citation context:
	// their reference lists and citation counts belong to the reviewed work,
	// so keeping them bends the map toward the wrong record.
	const refPapers = researchOnly(refAll);
	const citePapers = researchOnly(citeAll);
	const relatedPapers = researchOnly(relatedAll);
	const skippedNonResearch =
		countNonResearch(references.sample.rejected, "reference", seed.id) +
		countNonResearch(citations.sample.rejected, "citation", seed.id) +
		countNonResearch(related.sample.rejected, "related", seed.id);
	const picked = selectNeighbors(
		settings,
		{
			reference: withoutSeedDuplicate(refPapers, seed),
			citation: withoutSeedDuplicate(citePapers, seed),
			related: withoutSeedDuplicate(relatedPapers, seed),
		},
		seed.id,
	);

	const refLists = new Map<string, string[]>();
	refLists.set(seed.id, referenceIds(seedRaw.referenced_works));
	const openAlexLinks = new Set(refLists.get(seed.id)!.map((id) => `${seed.id}\0${id}`));

	// Citing papers arrive most-cited first; the context cap bounds the batched
	// reference-list fetch when deep sampling returned hundreds of citers.
	const contextIds = citePapers.slice(0, MAX_CONTEXT_CITERS).map((paper) => paper.id);
	const batchIds = unique([seed.id, ...picked.map((paper) => paper.id), ...contextIds]);
	if (batchIds.length > 1 || !seed.abstract) {
		onStage?.("scoring");
		try {
			const detailed = await client.worksByIds(batchIds);
			const byId = new Map<string, PaperNode>([
				...citePapers.map((paper) => [paper.id, paper] as const),
				[seed.id, seed],
				...picked.map((paper) => [paper.id, paper] as const),
			]);
			for (const raw of detailed) {
				const id = raw.id ? shortId(raw.id) : "";
				if (!id) continue;
				const ids = referenceIds(raw.referenced_works);
				const previous = refLists.get(id);
				if (!previous || ids.length > 0) refLists.set(id, ids);
				for (const refId of ids) openAlexLinks.add(`${id}\0${refId}`);
				const paper = byId.get(id);
				const abstract = reconstructAbstract(raw.abstract_inverted_index);
				if (paper && abstract) paper.abstract = abstract;
			}
		} catch {
			warnings.push("details");
		}
	}

	// Cross-check against Semantic Scholar: one bulk POST compares citation and
	// reference counts per DOI, then reference lists that OpenAlex lacks are
	// backfilled from S2 (only links into this graph matter for scoring).
	const crossCheck = new Map<string, CrossCheck>();
	const s2Links = new Set<string>();
	if (reconcile && settings.s2Reconcile) {
		try {
			const doiToId = new Map<string, string>();
			for (const paper of [seed, ...picked]) {
				const doi = doiFromPaper(paper);
				if (doi) doiToId.set(doi.toLowerCase(), paper.id);
			}
			if (doiToId.size > 0) {
				const counts = await reconcile.bulkCounts([...doiToId.keys()]);
				const byId = new Map([seed, ...picked].map((paper) => [paper.id, paper] as const));
				for (const [doi, count] of counts) {
					const id = doiToId.get(doi);
					const paper = id ? byId.get(id) : undefined;
					if (!id || !paper) continue;
					crossCheck.set(id, {
						s2Citations: count.citationCount,
						s2References: count.referenceCount,
						refsAdded: 0,
						mismatched: countsMismatched(paper.citedByCount, count.citationCount),
					});
				}
				const gaps = [seed, ...picked]
					.filter((paper) => {
						const check = crossCheck.get(paper.id);
						return (
							doiFromPaper(paper) !== null &&
							(refLists.get(paper.id) ?? []).length === 0 &&
							(check?.s2References ?? 0) > 0
						);
					})
					.slice(0, MAX_RECONCILE_BACKFILL);
				for (const paper of gaps) {
					const doi = doiFromPaper(paper);
					if (!doi) continue;
					try {
						const refDois = await reconcile.referenceDois(doi);
						const hits = unique(
							refDois
								.map((ref) => doiToId.get(ref) ?? "")
								.filter((id) => id !== "" && id !== paper.id),
						);
						if (hits.length > 0) {
							refLists.set(paper.id, hits);
							for (const hit of hits) s2Links.add(`${paper.id}\0${hit}`);
							const check = crossCheck.get(paper.id);
							if (check) check.refsAdded = hits.length;
						}
					} catch {
						// One failed backfill is not a failed map.
					}
				}
			}
		} catch (error) {
			console.warn("[research-connected] Semantic Scholar 交叉比对未完成：", error instanceof Error ? error.message : error);
			warnings.push("crosscheck");
		}
	}

	// Crossref is a second, bounded fallback: only query graph nodes whose
	// reference list is still empty after OpenAlex and Semantic Scholar.
	const crossrefLinks = new Set<string>();
	if (crossref) {
		const doiToId = new Map<string, string>();
		for (const paper of [seed, ...picked]) {
			const doi = doiFromPaper(paper);
			if (doi) doiToId.set(doi.toLowerCase(), paper.id);
		}
		const gaps = [seed, ...picked]
			.filter((paper) => doiFromPaper(paper) !== null && (refLists.get(paper.id) ?? []).length === 0)
			.slice(0, MAX_RECONCILE_BACKFILL);
		for (const paper of gaps) {
			const doi = doiFromPaper(paper);
			if (!doi) continue;
			try {
				const refDois = await crossref.referenceDois(doi);
				const hits = unique(refDois.map((ref) => doiToId.get(ref.toLowerCase()) ?? "").filter((id) => id && id !== paper.id));
				if (hits.length > 0) {
					refLists.set(paper.id, unique([...(refLists.get(paper.id) ?? []), ...hits]));
					for (const hit of hits) crossrefLinks.add(`${paper.id}\0${hit}`);
					const check = crossCheck.get(paper.id) ?? { s2Citations: null, s2References: null, refsAdded: 0, mismatched: false };
					check.crossrefRefsAdded = hits.length;
					crossCheck.set(paper.id, check);
				}
			} catch {
				// A Crossref miss or transient failure must not fail map construction.
			}
		}
	}

	const referencesMap = new Map<string, Set<string>>();
	for (const paper of [seed, ...picked]) {
		referencesMap.set(paper.id, new Set(refLists.get(paper.id) ?? []));
	}
	const contexts = contextIds
		.map((id) => refLists.get(id))
		.filter((list): list is string[] => Array.isArray(list) && list.length > 0)
		.map((list) => new Set(list));

	const { edges, seedScore } = buildSimilarity({
		ids: [seed.id, ...picked.map((paper) => paper.id)],
		seedId: seed.id,
		references: referencesMap,
		contexts,
	});

	const referenceLists = new Map<string, readonly string[]>();
	for (const [id, ids] of refLists) referenceLists.set(id, ids);
	const catalog = new Map<string, PaperNode>();
	catalog.set(seed.id, seed);
	for (const paper of citePapers) catalog.set(paper.id, paper);
	for (const paper of [seed, ...picked]) catalog.set(paper.id, paper);
	const citationEvidence = new CitationEvidenceStore();
	for (const [id, refs] of referenceLists) {
		const source = catalog.get(id);
		if (!source) continue;
		for (const ref of refs) {
			const target = catalog.get(ref);
			if (!target) continue;
			const evidence = directEvidence(source, target, openAlexLinks.has(`${id}\0${ref}`), false);
			if (s2Links.has(`${id}\0${ref}`)) {
				// Backfilled link: OpenAlex never listed it, Semantic Scholar did.
				evidence.sources = ["semantic-scholar"];
			}
			if (crossrefLinks.has(`${id}\0${ref}`)) evidence.sources = [...new Set([...evidence.sources, "crossref" as const])];
			citationEvidence.set(evidence);
		}
	}

		return {
		nodes: [seed, ...picked],
		edges,
		seedScore,
		warnings,
		strategies: {
			references: settings.includeReferences,
			citations: settings.includeCitations,
			related: settings.includeRelated,
		},
		referenceLists,
		catalog: [...catalog.values()],
		citationEvidence,
		skippedNonResearch,
		retrievalStats: {
			references: statsFor(references.sample, refPapers.length, tier.references),
			citations: statsFor(citations.sample, citePapers.length, tier.citations),
			related: statsFor(related.sample, relatedPapers.length, tier.related),
		},
		crossCheck: crossCheck.size > 0 ? crossCheck : undefined,
	};
}

export function selectNeighbors(
	settings: Pick<
		ConnectedPapersSettings,
		"maxNodes" | "includeReferences" | "includeCitations" | "includeRelated"
	>,
	groups: { reference: PaperNode[]; citation: PaperNode[]; related: PaperNode[] },
	seedId: string,
): PaperNode[] {
	const maxNodes = clampInt(settings.maxNodes, 20, 300);
	const slots = maxNodes - 1;
	const pools = {
		reference: settings.includeReferences ? dedupe(groups.reference, seedId) : [],
		citation: settings.includeCitations ? dedupe(groups.citation, seedId) : [],
		related: settings.includeRelated ? dedupe(groups.related, seedId) : [],
	};
	const chosen = new Map<string, PaperNode>();

	const take = (list: PaperNode[], count: number): void => {
		let got = 0;
		for (const paper of list) {
			if (got >= count || chosen.size >= slots) return;
			const key = identityKey(paper);
			const prev = chosen.get(key);
			if (prev) {
				if (ORIGIN_RANK[paper.origin] > ORIGIN_RANK[prev.origin]) chosen.set(key, paper);
				continue;
			}
			chosen.set(key, paper);
			got += 1;
		}
	};

	if (settings.includeRelated) {
		const cap = Math.min(pools.related.length, slots, Math.max(6, Math.round(slots * 0.22)));
		take(pools.related, cap);
	}

	const structural: Array<"reference" | "citation"> = [];
	if (settings.includeReferences) structural.push("reference");
	if (settings.includeCitations) structural.push("citation");
	const remaining = slots - chosen.size;
	if (structural.length === 0) {
		take(pools.related, slots - chosen.size);
	} else {
		const base = Math.floor(remaining / structural.length);
		let extra = remaining - base * structural.length;
		for (const key of structural) {
			const count = base + (extra > 0 ? 1 : 0);
			if (extra > 0) extra -= 1;
			take(pools[key], count);
		}
		if (chosen.size < slots) {
			const rest = [...pools.reference, ...pools.citation, ...pools.related].sort(byImpact);
			take(rest, slots - chosen.size);
		}
	}

	return [...chosen.values()].sort(byImpact);
}

async function loadGroup(
	enabled: boolean,
	run: () => Promise<SampledWorks>,
): Promise<{ works: RawWork[]; sample: SampledWorks; error?: string }> {
	if (!enabled) return { works: [], sample: { works: [], rejected: [], rawFetched: 0, filtered: 0, pages: 0, exhausted: true } };
	try {
		const sample = await run();
		return { works: sample.works, sample };
	} catch (error) {
		return { works: [], sample: { works: [], rejected: [], rawFetched: 0, filtered: 0, pages: 0, exhausted: false }, error: error instanceof Error ? error.message : "请求失败" };
	}
}

function statsFor(
	sample: { rawFetched: number; filtered: number; pages: number; exhausted: boolean },
	accepted: number,
	target: number,
): RetrievalStats {
	return {
		rawFetched: sample.rawFetched,
		accepted,
		filtered: sample.filtered,
		pages: sample.pages,
		exhausted: sample.exhausted,
		partial: sample.pages > 0 && accepted < target,
	};
}

function countNonResearch(works: RawWork[], origin: Origin, seedId: string): number {
	return asPapers(works, origin, seedId).filter((paper) => Boolean(nonResearchLabel(paper))).length;
}

function withoutSeedDuplicate(papers: PaperNode[], seed: PaperNode): PaperNode[] {
	const seedDoi = doiFromPaper(seed);
	return papers.filter((paper) => paper.id !== seed.id && (!seedDoi || doiFromPaper(paper) !== seedDoi));
}

function asPapers(works: RawWork[], origin: Origin, seedId: string): PaperNode[] {
	const papers: PaperNode[] = [];
	for (const work of works) {
		const paper = toPaper(work, origin);
		if (paper && paper.id !== seedId) papers.push(paper);
	}
	return papers;
}

function researchOnly(papers: PaperNode[]): PaperNode[] {
	return papers.filter((paper) => !nonResearchLabel(paper));
}

function dedupe(list: PaperNode[], seedId: string): PaperNode[] {
	const map = new Map<string, PaperNode>();
	for (const paper of list) {
		if (paper.id === seedId) continue;
		const key = identityKey(paper);
		const prev = map.get(key);
		if (!prev || ORIGIN_RANK[paper.origin] > ORIGIN_RANK[prev.origin]) map.set(key, paper);
	}
	return [...map.values()].sort(byImpact);
}

function identityKey(paper: PaperNode): string {
	return doiFromPaper(paper) ?? `openalex:${paper.id}`;
}

function byImpact(a: PaperNode, b: PaperNode): number {
	return impactScore(b) - impactScore(a) || a.id.localeCompare(b.id);
}

function impactScore(paper: Pick<PaperNode, "citedByCount" | "year" | "retracted">): number {
	const citations = Math.log1p(Math.max(0, paper.citedByCount));
	const currentYear = new Date().getFullYear();
	const recentYears = paper.year === null ? 0 : Math.max(0, paper.year - (currentYear - 20));
	const recencyBoost = 1 + Math.min(1, recentYears / 20) * 0.35;
	return citations * recencyBoost * (paper.retracted ? 0.1 : 1);
}

function unique(ids: string[]): string[] {
	return [...new Set(ids.filter((id) => /^W\d+$/.test(id)))];
}

function clampInt(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.round(value)));
}
