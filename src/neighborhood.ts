import { tr } from "./i18n";
import {
	OpenAlexClient,
	OpenAlexError,
	toPaper,
	type RawWork,
	type SampledWorks,
} from "./openalex";
import { classifyQuery, normalizeDoi, reconstructAbstract, referenceIds, shortId, nonResearchLabel } from "./paper";
import { buildSimilarity } from "./similarity";
import { buildSemanticScorer } from "./text-similarity";
import { buildPairSimilarity } from "./diversity";
import { admissionText, assessAdmission } from "./admission";
import { embeddingCosine } from "./text-similarity";
import type { S2BatchStats } from "./s2-batch";
import { CitationEvidenceStore, directEvidence } from "./citation-evidence";
import { doiFromPaper, type S2Counts } from "./citation-sources";
import { applyWorkIdentityDecisions, chooseExpand, couplingFill, EXPAND_CAP, graftNodes, refreshDerived, type EditableGraph } from "./graph-edit";
import { paperHasId, paperRecords, resolveWorkQuery, sameWork, workIndex, type WorkIdentity } from "./work-identity";
import type { ConnectedPapersSettings, SampleDepth } from "./settings-model";
import type { GraphEdge, Origin, PaperNode } from "./types";

export type LoadStage = "resolving" | "fetching" | "scoring";
export type LoadWarning = "references" | "citations" | "related" | "details" | "crosscheck";

export const WARNING_TEXT: Record<LoadWarning, string> = {
	references: tr("参考文献未获取", "References could not be loaded"),
	citations: tr("施引文献未获取", "Citing papers could not be loaded"),
	related: tr("相关作品未获取", "Related works could not be loaded"),
	details: tr("部分文献详情或参考文献列表未获取；仅使用已有证据", "Some paper details or reference lists could not be loaded; available evidence is used"),
	crosscheck: tr("Semantic Scholar 增强未完成；缺失处使用已有证据", "Semantic Scholar enrichment is incomplete; available evidence is used where data is missing"),
};

export function samplingText(stats: { accepted: number; requests: number; pages: number; filtered: number; duplicates: number; partial: boolean }, label: string): string {
	return tr(`${label}：保留 ${stats.accepted} 篇 · ${stats.pages} 页 · ${stats.requests} 次请求${stats.filtered ? ` · 过滤 ${stats.filtered} 条` : ""}${stats.duplicates ? ` · 去重 ${stats.duplicates} 条` : ""}${stats.partial ? " · 未达目标" : ""}`, `${label}: ${stats.accepted} accepted · ${stats.pages} ${stats.pages === 1 ? "page" : "pages"} · ${stats.requests} ${stats.requests === 1 ? "request" : "requests"}${stats.filtered ? ` · ${stats.filtered} filtered` : ""}${stats.duplicates ? ` · ${stats.duplicates} duplicates` : ""}${stats.partial ? " · below target" : ""}`);
}

export interface CandidateAudit {
	id: string;
	doi: string | null;
	source: "reference" | "citation" | "related";
	rejection?: string;
}

/**
 * Sampling tiers. The numbers are accepted-work targets, not the HTTP page
 * size: OpenAlex caps a page at 100, and sampleWorks spreads a larger target
 * across cursor pages. Deep examines up to 1000 raw records per list and needs
 * an API key to leave page 1. Related works can use one extra page to replace
 * filtered records.
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
	researchProjection?: import("./graph-edit").ResearchProjection;
	workIdentity?: WorkIdentity;
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
	/** The citing-paper sample used for co-citation, retained across graph edits. */
	coCitationContextIds?: readonly string[];
	/** Raw external references retained even when they cannot be resolved into an OpenAlex node. */
	rawReferenceLists?: ReadonlyMap<string, readonly ExternalReference[]>;
	/** Titles we already fetched, including citers that did not become nodes. */
	catalog: readonly PaperNode[];
	citationEvidence?: CitationEvidenceStore;
	/** Book reviews, editorials, and other non-research records dropped from the sample. */
	skippedNonResearch: number;
	/** Retracted works removed because excludeRetracted was enabled. */
	skippedRetracted?: number;
	/** Deep sampling stayed on page 1 because no OpenAlex API key is configured. */
	pagingLimited?: boolean;
	/** Per-source sampling counters. Optional to keep offline fixtures backwards-compatible. */
	retrievalStats?: Readonly<Record<"references" | "citations" | "related", RetrievalStats>>;
	/** Retained candidates and filtered records from this build, for local diagnosis. */
	candidateAudit?: readonly CandidateAudit[];
	/** Papers explicitly removed from this graph; deep expansion must not re-add them. */
	excludedIds?: readonly string[];
	/** Per-node Semantic Scholar cross-check, when reconcile ran. Keyed by OpenAlex id. */
	crossCheck?: ReadonlyMap<string, CrossCheck>;
	/** 语义相似度（BM25+主题余弦，本地计算），键为节点 id；null = 信号缺失。 */
	semanticScores?: ReadonlyMap<string, number | null>;
	/** 语义通道来源：embedding = 已验证模型向量参与，local = 纯本地 BM25+主题。 */
	semanticMode?: "embedding" | "local";
	/** 向量模型名（随批量请求返回），用于识别向量空间漂移。 */
	semanticModel?: string | null;
	semanticVectorIds?: readonly string[];
	enhancement?: {
		candidates: number;
		openAlexRequested: number;
		openAlexAbstracts: number;
		abstractsAdded: number;
		compatibleVectors: number;
		s2: S2BatchStats;
	};
	/** 入选时的真实决策依据，随项目快照保存。 */
	selectionRank?: ReadonlyMap<string, SelectionRank>;
}

/** 候选入选时的分数快照；semantic 缺失保留 null（UI 显示「不可用」）。 */
export interface SelectionRank {
	authority: number;
	semantic: number | null;
	relevance: number;
	semanticChannel?: "embedding" | "local";
	semanticModel?: string;
}

/** MMR 多样性选项：sim 为对称可空的候选两两相似度，lambda 为相关性权重。 */
export interface MmrOptions {
	sim(a: PaperNode, b: PaperNode): number | null;
	lambda: number;
}

/** 标准 MMR 的相关性权重。合成邻域 sweep 在 0.6–0.8 几乎平坦，取区间中值。 */
export const MMR_LAMBDA = 0.7;

function enhancementCandidates(seed: PaperNode, papers: readonly PaperNode[], limit: number): PaperNode[] {
	const uniquePapers = [...new Map(papers.map(paper => [paper.id, paper])).values()];
	const scorer = buildSemanticScorer(seed, uniquePapers);
	const ranked = uniquePapers.sort((a, b) => (scorer.score(b) ?? 0) - (scorer.score(a) ?? 0) || a.id.localeCompare(b.id));
	const uncertain = ranked.filter(paper => !paper.abstract && assessAdmission(seed, paper).status !== "matched");
	const chosen = new Map<string, PaperNode>();
	for (let i = 0; chosen.size < limit && i < ranked.length; i++) {
		for (const paper of [uncertain[i], ranked[i]]) {
			if (paper && chosen.size < limit) chosen.set(paper.id, paper);
		}
	}
	return [...chosen.values()];
}

export function enhancementText(graph: Pick<SimilarityGraph, "enhancement" | "semanticModel">): string {
	const value = graph.enhancement;
	if (!value) return "";
	const stats = value.s2;
	const coverage = tr(
		`S2 匹配 ${stats.found}/${stats.requested} · 请求 ${stats.requests} · 缓存 ${stats.cacheHits} · 未匹配 ${stats.notFound} · 未完成 ${stats.unresolved} · 补摘要 ${value.abstractsAdded} · 候选同模型向量 ${value.compatibleVectors}${graph.semanticModel ? ` (${graph.semanticModel})` : ""}`,
		`S2 matched ${stats.found}/${stats.requested} · requests ${stats.requests} · cached ${stats.cacheHits} · not matched ${stats.notFound} · unresolved ${stats.unresolved} · abstracts added ${value.abstractsAdded} · compatible candidate vectors ${value.compatibleVectors}${graph.semanticModel ? ` (${graph.semanticModel})` : ""}`,
	);
	return `${coverage}${stats.rateLimited ? tr(" · 发生限流", " · rate limited") : ""}${stats.embeddingFallback ? tr(" · 向量字段不可用，改取元数据", " · embeddings unavailable; metadata only") : ""}${stats.error ? tr(` · 部分增强未完成，缺失处使用本地证据：${stats.error}`, ` · enhancement incomplete; local evidence used where missing: ${stats.error}`) : ""}`;
}

export function graphStatusSummary(graph: Pick<SimilarityGraph, "nodes" | "edges" | "warnings" | "pagingLimited" | "enhancement">, incomplete = false): string {
	const partial = incomplete || graph.warnings.length > 0 || graph.pagingLimited || Boolean(graph.enhancement?.s2.error);
	return tr(`${graph.nodes.length} 篇文献 · ${graph.edges.length} 条连线`, `${graph.nodes.length} papers · ${graph.edges.length} links`) + (partial ? tr(" · 部分数据未获取", " · Some data could not be retrieved") : "");
}

export interface ExternalReference {
	source: "openalex" | "semantic-scholar" | "crossref";
	externalId: string;
	doi?: string;
}

export interface RetrievalStats {
	requests: number;
	rawFetched: number;
	accepted: number;
	filtered: number;
	duplicates: number;
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
	bulkCounts(dois: string[], opts?: { embedding?: boolean }): Promise<Map<string, S2Counts>>;
	referenceDois(doi: string): Promise<string[]>;
	/** Model name of the embeddings from the last bulkCounts call, when provided. */
	readonly embeddingModel?: string | null;
	readonly batchStats?: S2BatchStats;
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
export class RetractedSeedError extends Error {
	constructor(readonly paper: PaperNode) { super(tr("已保存起点现已撤稿，重建已暂停；原图保持可用。", "The saved seed is now retracted. Rebuild paused; the previous graph remains available.")); }
}

export async function loadNeighborhood(
	client: OpenAlexClient,
	target: { kind: "doi" | "openalex"; value: string },
	settings: ConnectedPapersSettings,
	onStage?: (stage: LoadStage) => void,
	reconcile?: ReconcileSource | null,
	crossref?: CrossrefReferenceSource | null,
	options?: { savedSeed?: PaperNode; allowRetractedSeed?: boolean },
): Promise<SimilarityGraph> {
	if (!settings.includeReferences && !settings.includeCitations && !settings.includeRelated) {
		throw new OpenAlexError(tr("请至少开启一种邻居策略（参考文献、施引或相关作品）。", "Enable at least one neighbor source: references, citing papers, or related works."));
	}

	onStage?.("resolving");
	let seedRaw =
		target.kind === "doi" ? await client.workByDoi(target.value) : await client.workById(target.value);
	let seed = toPaper(seedRaw, "seed");
	if (!seed) throw new OpenAlexError(tr("OpenAlex 返回的种子作品缺少标题或 ID。", "The seed work from OpenAlex has no title or ID."));
	if (seed.retracted && options?.savedSeed && !options.allowRetractedSeed) throw new RetractedSeedError(seed);
	const exactProject = settings.researchProjects?.[seed.id];
	const matchingProjects = Object.values(settings.researchProjects ?? {}).filter((project) => project.snapshot?.nodes.some((paper) => paper.isSeed && paperRecords(paper).every((record) => sameWork(record, seed!))));
	const existingProject = exactProject ?? (matchingProjects.length === 1 ? matchingProjects[0] : undefined);
	const originalSeed = { ...seed, isSeed: false, origin: "related" as const };
	if (existingProject && existingProject.seedId !== seed.id) {
		seedRaw = await client.workById(existingProject.seedId);
		seed = toPaper(seedRaw, "seed");
		if (!seed) throw new OpenAlexError(tr("已保存项目的种子记录暂时不可用", "The saved project's seed record is currently unavailable"));
	}
	const seedAliases = [...(existingProject?.snapshot?.nodes.find((paper) => paper.isSeed)?.records ?? []), originalSeed]
		.filter((record) => record.id !== seed.id).map((record) => ({ ...record, isSeed: false }));

	onStage?.("fetching");
	const tier = SAMPLE_TIERS[settings.sampleDepth] ?? SAMPLE_TIERS.standard;
	const pagingLimited = settings.sampleDepth === "deep" && settings.apiKey.trim() === "";
	const listPages = pagingLimited ? 1 : tier.pages;
	const acceptsResearch = (work: RawWork): boolean => {
		return candidateExclusion(work, seed, settings.excludeRetracted, false) === null;
	};
	const [references, citations, related] = await Promise.all([
		loadGroup(settings.includeReferences, () => client.sampleWorks(`cited_by:${seed.id}`, tier.references, tier.references, "cited_by_count:desc", listPages, acceptsResearch)),
		loadGroup(settings.includeCitations, () => client.sampleWorks(`cites:${seed.id}`, tier.citations, tier.citations, "cited_by_count:desc", listPages, acceptsResearch)),
		loadGroup(settings.includeRelated, () => client.sampleWorks(`related_to:${seed.id}`, tier.related, tier.related, undefined, pagingLimited ? 1 : 2, acceptsResearch)),
	]);

	const warnings: LoadWarning[] = [];
	if (references.error) warnings.push("references");
	if (citations.error) warnings.push("citations");
	if (related.error) warnings.push("related");
	const enabledCount = [settings.includeReferences, settings.includeCitations, settings.includeRelated].filter(
		Boolean,
	).length;
	if (warnings.length >= enabledCount) {
		throw new OpenAlexError(tr("没有读到邻居作品。请检查网络、API 密钥或额度。", "No neighboring works were loaded. Check network access, API key, and rate limit."));
	}

	const refAll = asPapers(references.works, "reference", seed.id);
	const citeAll = asPapers(citations.works, "citation", seed.id);
	const relatedAll = asPapers(related.works, "related", seed.id);
	for (const paper of [...refAll, ...citeAll, ...relatedAll]) paper.admission = assessAdmission(seed, paper);
	// Reviews and editorials are dropped as nodes and as co-citation context:
	// their reference lists and citation counts belong to the reviewed work,
	// so keeping them bends the map toward the wrong record.
	const saved = settings.researchProjects?.[seed.id]?.snapshot;
	const separatedIds = saved?.workIdentity?.separatedIds ?? [];
	const candidates = workIndex([seed, ...seedAliases, ...researchOnly(refAll), ...researchOnly(citeAll), ...researchOnly(relatedAll)], [seed.id, ...(saved?.nodes.map((paper) => paper.id) ?? [])], separatedIds);
	const group = (papers: PaperNode[]) => [...new Set(papers.map((paper) => candidates.ids.get(paper.id) ?? paper.id))].map((id) => candidates.papers.find((paper) => paper.id === id)!).filter((paper) => paper && paper.id !== seed.id);
	const refPapers = group(researchOnly(refAll));
	const citePapers = group(researchOnly(citeAll));
	const relatedPapers = group(researchOnly(relatedAll));
	const seedGroup = candidates.papers.find((paper) => paper.id === seed.id)!;
	Object.assign(seed, seedGroup);
	const skippedNonResearch =
		countNonResearch(references.sample.rejected, "reference", seed.id) +
		countNonResearch(citations.sample.rejected, "citation", seed.id) +
		countNonResearch(related.sample.rejected, "related", seed.id);
	const skippedRetracted = settings.excludeRetracted
		? [references, citations, related].reduce((count, group) => count + group.sample.rejected.filter((work) => work.is_retracted === true).length, 0)
		: 0;
	const candidateAudit: CandidateAudit[] = ([
		["reference", references], ["citation", citations], ["related", related],
	] as const).flatMap(([source, group]) => [
		...group.works.map((work) => auditCandidate(work, source)),
		...group.sample.rejected.map((work) => auditCandidate(work, source, candidateExclusion(work, seed, settings.excludeRetracted) ?? tr("已过滤", "Filtered"))),
	]).filter((item) => item.id || item.doi);
	const allCandidates = [...new Map([...refPapers, ...citePapers, ...relatedPapers].map(paper => [paper.id, paper])).values()];
	const shortlist = enhancementCandidates(seed, allCandidates, Math.min(160, Math.max(80, settings.maxNodes * 2)));
	const refLists = new Map<string, string[]>();
	const rawReferenceLists = new Map<string, ExternalReference[]>();
	const seedReferenceIds = referenceIds(seedRaw.referenced_works);
	refLists.set(seed.id, seedReferenceIds);
	rawReferenceLists.set(seed.id, seedReferenceIds.map(id => ({ source: "openalex", externalId: id })));
	const openAlexLinks = new Set(seedReferenceIds.map(id => `${seed.id}\0${id}`));
	const byId = new Map([seed, ...allCandidates].map(paper => [paper.id, paper]));
	const readDetails = async (ids: string[]): Promise<number> => {
		let abstracts = 0;
		try {
			for (const raw of await client.worksByIds(ids)) {
				const id = raw.id ? shortId(raw.id) : "";
				if (!id) continue;
				const refs = referenceIds(raw.referenced_works);
				rawReferenceLists.set(id, refs.map(refId => ({ source: "openalex", externalId: refId })));
				if (!refLists.has(id) || refs.length) refLists.set(id, refs);
				for (const ref of refs) openAlexLinks.add(`${id}\0${ref}`);
				const paper = byId.get(id);
				const abstract = reconstructAbstract(raw.abstract_inverted_index);
				if (paper && abstract && !paper.abstract) { paper.abstract = abstract; paper.abstractSource = "openalex"; abstracts += 1; }
			}
		} catch {
			if (!warnings.includes("details")) warnings.push("details");
		}
		return abstracts;
	};
	onStage?.("scoring");
	const preDetailIds = unique([seed.id, ...shortlist.map(paper => paper.id)]);
	const openAlexAbstracts = await readDetails(preDetailIds);
	const s2Candidates = enhancementCandidates(seed, shortlist.filter(paper => doiFromPaper(paper) !== null), 120);
	const s2Papers = [seed, ...s2Candidates];
	const doiToCandidates = new Map<string, PaperNode[]>();
	for (const paper of s2Papers) {
		const doi = doiFromPaper(paper);
		if (doi) doiToCandidates.set(doi, [...(doiToCandidates.get(doi) ?? []), paper]);
	}
	let counts = new Map<string, S2Counts>();
	let s2: S2BatchStats = {
		requested: settings.s2Reconcile ? doiToCandidates.size : 0, cacheHits: 0, requests: 0, found: 0, notFound: 0,
		unresolved: settings.s2Reconcile ? doiToCandidates.size : 0, rateLimited: false, embeddingFallback: false,
	};
	if (settings.s2Reconcile && doiToCandidates.size > 0) {
		if (reconcile) {
			try {
				counts = await reconcile.bulkCounts([...doiToCandidates.keys()], { embedding: settings.semanticEmbedding });
				s2 = reconcile.batchStats ? { ...reconcile.batchStats } : { ...s2, found: counts.size, unresolved: Math.max(0, doiToCandidates.size - counts.size) };
			} catch (error) {
				s2.error = error instanceof Error ? error.message : tr("Semantic Scholar 候选增强失败", "Semantic Scholar candidate enhancement failed");
				console.warn("[research-connected] Semantic Scholar:", s2.error);
			}
		} else s2.error = tr("Semantic Scholar 批量传输不可用", "Semantic Scholar batch transport unavailable");
		if (s2.error) warnings.push("crosscheck");
	}
	let abstractsAdded = 0;
	for (const [doi, count] of counts) for (const paper of doiToCandidates.get(doi) ?? []) {
		if (!paper.abstract && count.abstract) { paper.abstract = count.abstract; paper.abstractSource = "s2"; abstractsAdded += 1; }
	}
	const embeddings = new Map<string, number[]>();
	const seedData = counts.get(doiFromPaper(seed) ?? "");
	const semanticModel = settings.semanticEmbedding ? seedData?.embeddingModel?.trim() || null : null;
	if (semanticModel && seedData?.embedding && embeddingCosine(seedData.embedding, seedData.embedding) !== null) {
		embeddings.set(seed.id, seedData.embedding);
		for (const [doi, count] of counts) {
			if (count.embeddingModel !== semanticModel || !count.embedding || embeddingCosine(seedData.embedding, count.embedding) === null) continue;
			for (const paper of doiToCandidates.get(doi) ?? []) embeddings.set(paper.id, count.embedding);
		}
	}
	for (const paper of allCandidates) paper.admission = assessAdmission(seed, paper);
	const eligible = new Set(allCandidates.filter(paper => paper.admission?.status !== "excluded").map(paper => paper.id));
	for (const item of candidateAudit) {
		if (!item.rejection && !eligible.has(candidates.ids.get(item.id) ?? item.id)) item.rejection = admissionText({ status: "excluded", reason: "discipline-mismatch" });
	}
	const rankPool = allCandidates.filter(paper => eligible.has(paper.id));
	const preSemantic = buildSemanticScorer(seed, rankPool, embeddings);
	const maxImpact = Math.max(1e-9, ...rankPool.map((paper) => impactScore(paper)));
	const rankCandidate = (paper: PaperNode): number => {
		const authority = impactScore(paper) / maxImpact;
		const semantic = preSemantic.score(paper);
		const relevance = semantic === null ? authority : 0.5 * authority + 0.5 * semantic;
		return paper.retracted ? relevance * 0.1 : relevance;
	};
	// MMR 多样性（Phase C）：候选两两相似度用对称的词项/主题余弦，不请求向量。
	const mmr: MmrOptions = { sim: buildPairSimilarity(rankPool), lambda: MMR_LAMBDA };
	const picked = selectNeighbors(
		settings,
		{
			reference: withoutSeedDuplicate(refPapers, seed).filter(paper => eligible.has(paper.id)),
			citation: withoutSeedDuplicate(citePapers, seed).filter(paper => eligible.has(paper.id)),
			related: withoutSeedDuplicate(relatedPapers, seed).filter(paper => eligible.has(paper.id)),
		},
		seed.id,
		rankCandidate,
		mmr,
	);
	// 入选原因（C2）：保存选择时的真实分数，semantic 缺失保留 null。
	const selectionRank = new Map<string, SelectionRank>();
	for (const paper of picked) {
		selectionRank.set(paper.id, {
			authority: impactScore(paper) / maxImpact,
			semantic: preSemantic.score(paper),
			relevance: rankCandidate(paper),
			semanticChannel: embeddings.has(paper.id) ? "embedding" : "local",
			semanticModel: embeddings.has(paper.id) && semanticModel ? semanticModel : undefined,
		});
	}

	// Citing papers arrive most-cited first; the context cap bounds the batched
	// reference-list fetch when deep sampling returned hundreds of citers.
	const contextIds = citePapers.slice(0, MAX_CONTEXT_CITERS).map((paper) => paper.id);
	const allDetailIds = unique([seed.id, ...picked.map((paper) => paper.id), ...[seed, ...picked].flatMap((paper) => paperRecords(paper).map((record) => record.id)), ...contextIds]);
	const batchIds = allDetailIds.filter(id => !refLists.has(id)).slice(0, settings.maxNodes + MAX_CONTEXT_CITERS);
	if (allDetailIds.filter(id => !refLists.has(id)).length > batchIds.length) warnings.push("details");
	if (batchIds.length > 0) {
		onStage?.("scoring");
		await readDetails(batchIds);
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
						const normalizedDois = refDois.map(normalizeDoi).filter((ref): ref is string => Boolean(ref));
						mergeRawReferences(rawReferenceLists, paper.id, "semantic-scholar", normalizedDois);
						const hits = unique(
							normalizedDois
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
			console.warn(tr("[research-connected] Semantic Scholar 交叉比对未完成：", "[research-connected] Semantic Scholar cross-check did not finish:"), error instanceof Error ? error.message : error);
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
					const normalizedDois = refDois.map(normalizeDoi).filter((ref): ref is string => Boolean(ref));
					mergeRawReferences(rawReferenceLists, paper.id, "crossref", normalizedDois);
					const hits = unique(normalizedDois.map((ref) => doiToId.get(ref) ?? "").filter((id) => id && id !== paper.id));
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

	// 展示用完整语义分（摘要已就位）：图谱综合分 = 0.55 结构 + 0.45 语义；
	// 语义缺失的节点保持原结构分。放射布局的距离编码跟着 seedScore 走。
	const semanticVectorIds = picked.filter(paper => embeddings.has(paper.id)).map(paper => paper.id);
	const semanticMode: "embedding" | "local" = semanticVectorIds.length > 0 ? "embedding" : "local";
	const semanticScorer = buildSemanticScorer(seed, picked, embeddings.size > 0 ? embeddings : undefined);
	const semanticScores = new Map<string, number | null>();
	for (const paper of picked) semanticScores.set(paper.id, semanticScorer.score(paper));
	for (const [id, score] of seedScore) {
		if (id === seed.id) continue;
		const semantic = semanticScores.get(id);
		if (semantic !== null && semantic !== undefined) {
			seedScore.set(id, Math.min(1, 0.55 * score + 0.45 * semantic));
		}
	}

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

	return applyWorkIdentityDecisions({
		workIdentity: { version: 1, records: [], referenceLists: [], evidence: [], directEdges: [], canonicalIds: [], separatedIds },
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
		coCitationContextIds: contextIds,
		rawReferenceLists,
		catalog: [...catalog.values()],
		citationEvidence,
		skippedNonResearch,
		skippedRetracted,
		pagingLimited,
		retrievalStats: {
			references: statsFor(references.sample, refPapers.length, tier.references),
			citations: statsFor(citations.sample, citePapers.length, tier.citations),
			related: statsFor(related.sample, relatedPapers.length, tier.related),
		},
		candidateAudit,
		crossCheck: crossCheck.size > 0 ? crossCheck : undefined,
		semanticScores,
		semanticMode,
		semanticModel: semanticMode === "embedding" ? semanticModel : null,
		semanticVectorIds,
		enhancement: settings.s2Reconcile ? {
			candidates: allCandidates.length, openAlexRequested: preDetailIds.length, openAlexAbstracts,
			abstractsAdded, compatibleVectors: [...embeddings.keys()].filter(id => id !== seed.id).length, s2,
		} : undefined,
		selectionRank,
	}, settings.workIdentityDecisions, settings.sourceVersionRelations);
}

/** Fetch up to EXPAND_CAP new neighbors of `from`, skipping graph members and hidden ids. */
export async function expandAround(
	client: OpenAlexClient,
	graph: EditableGraph,
	from: PaperNode,
	hidden: ReadonlySet<string>,
	settings: ConnectedPapersSettings,
	slots: number,
): Promise<{
		papers: PaperNode[];
		aliases: PaperNode[];
		lists: Map<string, readonly string[]>;
	references: number;
	citations: number;
	alreadyPresent: number;
	alreadyExcluded: number;
	filtered: number;
	overlaps: number;
	warnings: string[];
	noMore: boolean;
}> {
	const cap = Math.min(EXPAND_CAP, Math.max(0, slots));
	if (cap <= 0) return { papers: [], aliases: [], lists: new Map(), references: 0, citations: 0, alreadyPresent: 0, alreadyExcluded: 0, filtered: 0, overlaps: 0, warnings: [], noMore: false };
	const present = new Set(graph.nodes.map((node) => node.id));
	const aliases = new Map<string, PaperNode>();
	const separated = new Set(graph.workIdentity?.separatedIds ?? []);
	const matches = (node: PaperNode, paper: PaperNode) => paperHasId(node, paper.id) || !separated.has(paper.id) && !node.recordsSeparated && paperRecords(node).every((record) => sameWork(record, paper));
	let alreadyPresent = 0, alreadyExcluded = 0, filtered = 0;
	const fetchN = Math.min(40, Math.max(12, cap * 4));
	const accept = (work: RawWork): boolean => {
		const paper = toPaper(work, "related");
		if (!paper || paper.id === from.id || nonResearchLabel(paper) || settings.excludeRetracted && paper.retracted) { filtered += 1; return false; }
		if (graph.nodes.some((node) => matches(node, paper))) { alreadyPresent += 1; if (!graph.nodes.some((node) => paperHasId(node, paper.id))) aliases.set(paper.id, paper); return false; }
		if (hidden.has(paper.id) || graph.catalog.some((node) => hidden.has(node.id) && matches(node, paper))) { alreadyExcluded += 1; return false; }
		return true;
	};
	const [references, citations] = await Promise.all([
		loadGroup(settings.includeReferences, () =>
			client.sampleWorks(`cited_by:${from.id}`, fetchN, fetchN, "cited_by_count:desc", 2, accept),
		),
		loadGroup(settings.includeCitations, () =>
			client.sampleWorks(`cites:${from.id}`, fetchN, fetchN, "cited_by_count:desc", 2, accept),
		),
	]);
	const picked = chooseExpand(present, hidden, cap, {
		reference: researchOnly(asPapers(references.works, "reference", from.id)),
		citation: researchOnly(asPapers(citations.works, "citation", from.id)),
	});
	const citingRecordIds = new Set([...citations.works, ...citations.sample.rejected].map((work) => shortId(work.id ?? "")));
	for (const paper of aliases.values()) paper.origin = citingRecordIds.has(paper.id) ? "citation" : "reference";
	const warnings = [
		references.error ? tr(`参考文献查询失败：${references.error}`, `Reference query failed: ${references.error}`) : "",
		citations.error ? tr(`施引文献查询失败：${citations.error}`, `Citing-paper query failed: ${citations.error}`) : "",
	].filter(Boolean);
	const have = new Set([...present, ...picked.map((paper) => paper.id)]);
	const blocked = settings.excludeRetracted
		? new Set([...hidden, ...graph.catalog.filter((paper) => paper.retracted).map((paper) => paper.id)])
		: hidden;
	const papers = picked.length < cap
		? [...picked, ...couplingFill(graph, from.id, have, blocked, cap - picked.length)]
		: picked;
	const seed = graph.nodes.find((paper) => paper.isSeed) ?? from;
	for (const paper of papers) {
		const decision = assessAdmission(seed, paper);
		paper.admission = decision.status === "excluded" ? { ...decision, status: "manual" } : decision;
	}
	const crossDisciplinary = papers.filter((paper) => paper.admission?.status === "manual" || paper.admission?.status === "cross-disciplinary").length;
	if (crossDisciplinary) warnings.push(tr(`主动扩展保留了 ${crossDisciplinary} 篇跨学科候选，请在详情中核对相关性。`, `Explicit expansion retained ${crossDisciplinary} cross-disciplinary candidates. Review relevance in their details.`));
	const lists = new Map<string, readonly string[]>();
	const noMore = (!settings.includeReferences || references.sample.exhausted) && (!settings.includeCitations || citations.sample.exhausted);
	const citationIds = new Set(citations.works.map((work) => work.id));
	const overlaps = references.works.filter((work) => citationIds.has(work.id)).length;
	if (papers.length === 0 && aliases.size === 0) return {
		papers, aliases: [], lists, references: 0, citations: 0, alreadyPresent, alreadyExcluded, filtered,
		overlaps,
		warnings, noMore,
	};
	let detailsFailed = false;
	try {
		const detailed = await client.worksByIds([...papers, ...aliases.values()].flatMap((paper) => paperRecords(paper).map((record) => record.id)));
		for (const raw of detailed) {
			const id = raw.id ? shortId(raw.id) : "";
			if (id) lists.set(id, referenceIds(raw.referenced_works));
		}
	} catch {
		detailsFailed = true;
	}
	if (detailsFailed) warnings.push(tr("部分新增论文的参考文献没有读取到，关系暂不完整", "Some new papers have missing reference lists, so links are incomplete"));
	return {
		papers,
		aliases: [...aliases.values()],
		lists,
		references: picked.filter((paper) => paper.origin === "reference").length,
		citations: picked.filter((paper) => paper.origin === "citation").length,
		alreadyPresent,
		alreadyExcluded,
		filtered,
		overlaps,
		warnings,
		noMore,
	};
}

/** Embed depth 2: references of the two hubs closest to the seed, grafted under the node cap. */
export async function expandSecondLayer(
	client: OpenAlexClient, graph: SimilarityGraph, cap: number, excludeRetracted = false,
): Promise<{ graph: SimilarityGraph; note: string }> {
	const hubs = graph.nodes.filter((node) => !node.isSeed)
		.sort((a, b) => (graph.seedScore.get(b.id) ?? 0) - (graph.seedScore.get(a.id) ?? 0)).slice(0, 2);
	const room = cap - graph.nodes.length;
	if (room <= 0) return { graph, note: tr("已到节点上限", "Node limit reached") };
	const extra: PaperNode[] = [];
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) throw new OpenAlexError(tr("研究项目缺少种子文献", "Research project has no seed paper"));
	const seen = new Set(graph.nodes.flatMap((paper) => paperRecords(paper).map((record) => record.id)));
	let failed = false;
	let added = 0;
	let filtered = 0;
	for (const hub of hubs) {
		try {
			for (const raw of await client.referencedBySeed(hub.id, 12)) {
				const paper = toPaper(raw, "reference");
				if (!paper || seen.has(paper.id) || nonResearchLabel(paper) || (excludeRetracted && paper.retracted)) continue;
				paper.admission = assessAdmission(seed, paper);
				if (paper.admission.status === "excluded") { filtered += 1; continue; }
				const index = workIndex([...graph.nodes, ...extra, paper], graph.nodes.map((node) => node.id), graph.workIdentity?.separatedIds);
				const nextAdded = index.papers.length - graph.nodes.length;
				if (nextAdded > room) continue;
				seen.add(paper.id); extra.push(paper); added = nextAdded;
			}
		} catch { failed = true; }
	}
	const filterNote = filtered ? tr(`按起点学科准入规则过滤了 ${filtered} 篇第二层候选`, `${filtered} second-layer candidates filtered by seed-discipline eligibility`) : "";
	if (!extra.length) return { graph, note: [failed ? tr("第二层没有读到", "The second layer could not be loaded") : "", filterNote].filter(Boolean).join(tr("；", "; ")) };
	const lists = new Map<string, readonly string[]>();
	try {
		for (const raw of await client.worksByIds(extra.flatMap((paper) => paperRecords(paper).map((record) => record.id)))) {
			const id = shortId(raw.id ?? "");
			if (id) lists.set(id, referenceIds(raw.referenced_works));
		}
	} catch { failed = true; }
	return {
		graph: graftNodes(graph, extra, lists),
		note: [tr(`含第二层 ${added} 篇${failed ? "；部分来源未读取" : ""}`, `Includes ${added} second-layer papers${failed ? "; some source data could not be loaded" : ""}`), filterNote].filter(Boolean).join(tr("；", "; ")),
	};
}

/** Re-fetch and graft previously deep-dug members after a fresh seed build. */
export async function restoreGraftedMembers<T extends EditableGraph>(
	client: OpenAlexClient,
	graph: T,
	ids: readonly string[],
	settings: ConnectedPapersSettings,
	hidden: ReadonlySet<string> = new Set(),
	origins: ReadonlyMap<string, PaperNode["origin"]> = new Map(),
): Promise<{ graph: T; added: number; displaced: number; omitted: number; failed: number }> {
	const identityIds = new Map(graph.workIdentity?.canonicalIds ?? []);
	const requested = [...new Set(ids.filter((id) => /^W\d+$/i.test(id)).map((id) => identityIds.get(id.toUpperCase()) ?? id.toUpperCase()))].filter((id) => !hidden.has(id));
	const pinned = requested;
	const omitted = 0;
	const present = new Set(graph.nodes.map((node) => node.id));
	const want = pinned.filter((id) => !present.has(id));
	if (want.length === 0) return { graph, added: 0, displaced: 0, omitted, failed: 0 };
	const papers: PaperNode[] = [];
	const lists = new Map<string, readonly string[]>();
	const seed = graph.nodes.find((paper) => paper.isSeed);
	try {
		const detailed = await client.papersByIds(want);
		for (const raw of detailed) {
			const paper = toPaper(raw, origins.get(shortId(raw.id ?? "")) ?? "related");
			if (!paper || present.has(paper.id) || paper.isSeed || nonResearchLabel(paper) || (settings.excludeRetracted && paper.retracted)) continue;
			if (seed) {
				const decision = assessAdmission(seed, paper);
				paper.admission = decision.status === "excluded" ? { ...decision, status: "manual" } : decision;
			}
			papers.push(paper);
			lists.set(paper.id, referenceIds(raw.referenced_works));
			present.add(paper.id);
		}
	} catch {
		return { graph, added: 0, displaced: 0, omitted, failed: want.length };
	}
	if (papers.length === 0) return { graph, added: 0, displaced: 0, omitted, failed: want.length };
	const next = refreshDerived(graftNodes(graph, papers, lists));
	const added = next.nodes.length - graph.nodes.length;
	return { graph: next, added, displaced: 0, omitted, failed: want.length - papers.length };
}

export function selectNeighbors(
	settings: Pick<
		ConnectedPapersSettings,
		"maxNodes" | "includeReferences" | "includeCitations" | "includeRelated"
	>,
	groups: { reference: PaperNode[]; citation: PaperNode[]; related: PaperNode[] },
	seedId: string,
	rank?: (paper: PaperNode) => number,
	mmr?: MmrOptions,
): PaperNode[] {
	const maxNodes = clampInt(settings.maxNodes, 20, 300);
	const slots = maxNodes - 1;
	const relevanceOf = rank ?? impactScore;
	const byRank = (a: PaperNode, b: PaperNode): number => relevanceOf(b) - relevanceOf(a) || byImpact(a, b);
	const pools = {
		reference: settings.includeReferences ? dedupe(groups.reference, seedId, byRank) : [],
		citation: settings.includeCitations ? dedupe(groups.citation, seedId, byRank) : [],
		related: settings.includeRelated ? dedupe(groups.related, seedId, byRank) : [],
	};
	const chosen = new Map<string, PaperNode>();
	// MMR 已选序列：多样性惩罚对所有已选节点取最大值，与池无关。
	const chosenList: PaperNode[] = [];
	const structuralEnabled = settings.includeReferences || settings.includeCitations;
	const relatedCap = structuralEnabled ? Math.floor(slots * 0.22) : slots;
	let relatedChosen = 0;

	// MMR 惩罚增量缓存：每个候选只与「新增」的已选节点补算相似度，
	// 摊还后每次挑选是 O(剩余候选)，deep 档 500 池 × 300 名额也可承受。
	const penaltyCache = new Map<string, { value: number; version: number }>();
	const penaltyOf = (paper: PaperNode): number => {
		if (!mmr) return 0;
		const entry = penaltyCache.get(paper.id);
		let value = entry?.value ?? 0;
		const from = entry?.version ?? 0;
		for (let k = from; k < chosenList.length; k++) {
			const sim = mmr.sim(paper, chosenList[k]!);
			if (sim !== null && sim > value) value = sim;
		}
		penaltyCache.set(paper.id, { value, version: chosenList.length });
		return value;
	};

	// MMR 贪心：每次取 λ×相关性 − (1−λ)×与已选最大相似度 最高者；
	// 平局按相关性再按 id，保证确定性。null 相似度按 0 惩罚处理。
	const take = (list: PaperNode[], count: number): void => {
		let got = 0;
		const remaining = [...list];
		while (got < count && chosen.size < slots && remaining.length > 0) {
			for (let i = remaining.length - 1; i >= 0; i--) {
				if (remaining[i]!.origin === "related" && relatedChosen >= relatedCap) remaining.splice(i, 1);
			}
			if (remaining.length === 0) break;
			let bestIndex = 0;
			let bestScore = -Infinity;
			let bestRelevance = -Infinity;
			for (let i = 0; i < remaining.length; i++) {
				const paper = remaining[i]!;
				const relevance = relevanceOf(paper);
				const score = mmr && chosenList.length > 0
					? mmr.lambda * relevance - (1 - mmr.lambda) * penaltyOf(paper)
					: relevance;
				const current = remaining[bestIndex]!;
				const better =
					score > bestScore + 1e-12 ||
					(Math.abs(score - bestScore) <= 1e-12 &&
						(relevance > bestRelevance + 1e-12 ||
							(Math.abs(relevance - bestRelevance) <= 1e-12 && paper.id < current.id)));
				if (better) {
					bestScore = score;
					bestRelevance = relevance;
					bestIndex = i;
				}
			}
			const next = remaining.splice(bestIndex, 1)[0]!;
			const key = identityKey(next);
			const prev = chosen.get(key);
			if (prev) {
				if (ORIGIN_RANK[next.origin] > ORIGIN_RANK[prev.origin]) chosen.set(key, next);
				continue;
			}
			chosen.set(key, next);
			chosenList.push(next);
			if (next.origin === "related") relatedChosen += 1;
			got += 1;
		}
	};

	take(dedupe([...pools.reference, ...pools.citation, ...pools.related], seedId, byRank), slots);

	return [...chosen.values()].sort(byRank);
}

async function loadGroup(
	enabled: boolean,
	run: () => Promise<SampledWorks>,
): Promise<{ works: RawWork[]; sample: SampledWorks; error?: string }> {
	if (!enabled) return { works: [], sample: { works: [], rejected: [], rawFetched: 0, filtered: 0, duplicates: 0, requests: 0, pages: 0, exhausted: true } };
	try {
		const sample = await run();
		return { works: [...sample.works, ...(sample.duplicateWorks ?? [])], sample, error: sample.error };
	} catch (error) {
		return { works: [], sample: { works: [], rejected: [], rawFetched: 0, filtered: 0, duplicates: 0, requests: 1, pages: 0, exhausted: false }, error: error instanceof Error ? error.message : tr("请求失败", "Request failed") };
	}
}

function statsFor(
	sample: { requests: number; rawFetched: number; filtered: number; duplicates: number; pages: number; exhausted: boolean; error?: string },
	accepted: number,
	target: number,
): RetrievalStats {
	return {
		requests: sample.requests,
		rawFetched: sample.rawFetched,
		accepted,
		filtered: sample.filtered,
		duplicates: sample.duplicates,
		pages: sample.pages,
		exhausted: sample.exhausted,
		partial: Boolean(sample.error) || sample.pages > 0 && accepted < target,
	};
}

function candidateExclusion(work: RawWork, seed: PaperNode, excludeRetracted: boolean, admission = true): string | null {
	const paper = toPaper(work, "related");
	if (!paper) return tr("记录缺少有效标题或 OpenAlex ID", "Record lacks a valid title or OpenAlex ID");
	if (paper.id === seed.id) return tr("这篇是种子文献", "This is the seed paper");
	const kind = nonResearchLabel(paper);
	if (kind) return tr(`OpenAlex 将其归为「${kind}」`, `OpenAlex classifies it as “${kind}”`);
	if (excludeRetracted && paper.retracted) return tr("构建时开启了排除已撤稿作品", "Retracted works were excluded during graph building");
	const decision = assessAdmission(seed, paper);
	if (admission && decision.status === "excluded") return admissionText(decision);
	return null;
}

function auditCandidate(work: RawWork, source: CandidateAudit["source"], rejection?: string): CandidateAudit {
	return { id: work.id ? shortId(work.id) : "", doi: normalizeDoi(work.doi), source, rejection };
}

/** Explain only what the retained sample proves; an absent record has no inferred global rank. */
export function diagnoseCandidate(
	graph: SimilarityGraph,
	query: string,
	excludedIds: ReadonlySet<string> = new Set(graph.excludedIds ?? []),
	scrubYear: number | null = null,
): { title: string; detail: string; paperId?: string } {
	const parsed = classifyQuery(query);
	if (!parsed || parsed.kind === "search") return { title: tr("请输入 DOI 或 OpenAlex ID", "Enter a DOI or OpenAlex ID"), detail: tr("诊断只查当前图谱保存的采样记录。", "Inspection uses sampling records saved with the current graph only.") };
	const matches = (id: string, doi: string | null): boolean => parsed.kind === "openalex" ? id === parsed.value : doi === parsed.value;
	const foundId = resolveWorkQuery(graph.nodes, query);
	const found = graph.nodes.find((paper) => paper.id === foundId);
	if (found) {
		if (!found.isSeed && scrubYear !== null && (found.year === null || found.year > scrubYear)) {
			return { title: tr("已在图谱中，当前年份范围将其隐藏", "Already in graph, hidden by the current year range"), detail: tr(`论文 ${found.id} · 调整时间视图的年份范围即可看到。`, `Paper ${found.id} · adjust the timeline year range to show it.`), paperId: found.id };
		}
		return { title: found.isSeed ? tr("当前种子文献", "Current seed paper") : tr("已在当前图谱中", "Already in current graph"), detail: `${found.title} · ${found.id}`, paperId: found.id };
	}
	const resolved = resolveWorkQuery(graph.catalog, query);
	const removed = [...excludedIds].find((id) => id === resolved || matches(id, graph.candidateAudit?.find((item) => item.id === id)?.doi ?? normalizeDoi(graph.catalog.find((paper) => paper.id === id)?.doiUrl)));
	if (removed) return { title: tr("已从当前图谱删除", "Removed from current graph"), detail: tr(`论文 ${removed} 已被排除；重新构建图谱可重新采样。`, `Paper ${removed} was excluded; rebuilding can sample it again.`) };
	const records = (graph.candidateAudit ?? []).filter((item) => matches(item.id, item.doi));
	const retained = records.filter((item) => !item.rejection);
	const sources = [...new Set(retained.map((item) => ({ reference: tr("参考文献", "References"), citation: tr("施引", "Citing"), related: tr("相关作品", "Related works") })[item.source]))].join(tr("、", ", "));
	if (retained.length) return {
		title: tr("已采样，未入选图谱节点", "Sampled but not selected as a graph node"),
		detail: tr(`进入了${sources}候选池；节点上限、来源上限和多样性选择后未入选。现有记录不能确定单一落选因素。`, `Entered the ${sources} candidate pool but was not selected under the node limit, source cap, and diversity criteria. The records do not identify a single reason.`),
	};
	if (records.length) return { title: tr("候选筛选时被过滤", "Filtered during candidate screening"), detail: [...new Set(records.map((item) => displayCandidateReason(item.rejection)))].join(tr("；", "; ")) };
	const contextId = resolveWorkQuery(graph.catalog, query);
	const context = graph.catalog.find((paper) => paper.id === contextId);
	if (context) return { title: tr("已抓取为引用上下文，未入选节点", "Fetched as citation context but not selected as a node"), detail: `${context.title} · ${context.id}` };
	const incomplete = Object.values(graph.retrievalStats ?? {}).some((stats) => stats.partial);
	const sampled = graph.retrievalStats
		? tr(`本轮保留参考 ${graph.retrievalStats.references.accepted}、施引 ${graph.retrievalStats.citations.accepted}、相关 ${graph.retrievalStats.related.accepted} 条。`, `This round retained ${graph.retrievalStats.references.accepted} references, ${graph.retrievalStats.citations.accepted} citing papers, and ${graph.retrievalStats.related.accepted} related works.`)
		: "";
	return {
		title: tr("当前候选记录中没有这篇论文", "Paper is absent from current candidate records"),
		detail: graph.candidateAudit
			? tr(`${sampled}它未进入本轮保留的候选池或过滤记录；${incomplete ? "部分采样未满或请求失败，" : ""}采样范围和来源设置可能限制了结果，无法据此判断论文不存在。`, `${sampled}It is absent from the retained candidates and filter records. ${incomplete ? "Some samples were incomplete or requests failed. " : ""}The sample scope and source settings may limit results; this does not prove the paper does not exist.`)
			: tr("这个项目快照没有逐篇采样记录。重新构建图谱后可诊断过滤与落选原因。", "This project snapshot has no per-paper sampling records. Rebuild the graph to inspect filtering and selection."),
	};
}

function displayCandidateReason(reason: string | undefined): string {
	if (!reason) return "";
	const known: Array<[string, string]> = [
		["记录缺少有效标题或 OpenAlex ID", "Record lacks a valid title or OpenAlex ID"],
		["这篇是种子文献", "This is the seed paper"],
		["构建时开启了排除已撤稿作品", "Retracted works were excluded during graph building"],
		["与起点学科不同，且没有共同主题、子领域或具体词组证据", "Different seed discipline without a shared topic, subfield, or specific phrase"],
	];
	const match = known.find(([zh, en]) => reason === zh || reason === en);
	if (match) return tr(match[0], match[1]);
	const kind = reason.match(/^OpenAlex 将其归为「(.+)」$/)?.[1] ?? reason.match(/^OpenAlex classifies it as “(.+)”$/)?.[1];
	if (!kind) return reason;
	const kinds: Array<[string, string]> = [
		["书评", "Book review"], ["编者语", "Editorial"], ["更正", "Correction"],
		["读者来信", "Letter"], ["撤稿", "Retraction"],
		["评审记录", "Peer-review record"], ["附属内容", "Paratext"],
	];
	const label = kinds.find(([zh, en]) => kind === zh || kind === en);
	return tr(`OpenAlex 将其归为「${label ? label[0] : kind}」`, `OpenAlex classifies it as “${label ? label[1] : kind}”`);
}

function countNonResearch(works: RawWork[], origin: Origin, seedId: string): number {
	return asPapers(works, origin, seedId).filter((paper) => Boolean(nonResearchLabel(paper))).length;
}

function mergeRawReferences(
	lists: Map<string, ExternalReference[]>,
	workId: string,
	source: ExternalReference["source"],
	dois: string[],
): void {
	const current = lists.get(workId) ?? [];
	const seen = new Set(current.map((ref) => `${ref.source}\0${ref.externalId}`));
	for (const doi of dois) {
		const key = `${source}\0${doi}`;
		if (seen.has(key)) continue;
		seen.add(key);
		current.push({ source, externalId: doi, doi });
	}
	lists.set(workId, current);
}

function withoutSeedDuplicate(papers: PaperNode[], seed: PaperNode): PaperNode[] {
	return papers.filter((paper) => !paperHasId(seed, paper.id));
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

function dedupe(list: PaperNode[], seedId: string, byRank: (a: PaperNode, b: PaperNode) => number = byImpact): PaperNode[] {
	const map = new Map<string, PaperNode>();
	for (const paper of list) {
		if (paper.id === seedId) continue;
		const key = identityKey(paper);
		const prev = map.get(key);
		if (!prev || ORIGIN_RANK[paper.origin] > ORIGIN_RANK[prev.origin]) map.set(key, paper);
	}
	return [...map.values()].sort(byRank);
}

function identityKey(paper: PaperNode): string {
	if (paper.recordsSeparated) return `openalex:${paper.id}`;
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
