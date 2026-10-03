import {
	OpenAlexClient,
	OpenAlexError,
	type RawWork,
} from "./openalex";
import { reconstructAbstract, referenceIds, shortId, toPaper, nonResearchLabel } from "./paper";
import { buildSimilarity } from "./similarity";
import { CitationEvidenceStore, directEvidence } from "./citation-evidence";
import type { ConnectedPapersSettings } from "./settings-model";
import type { GraphEdge, Origin, PaperNode } from "./types";

export type LoadStage = "resolving" | "fetching" | "scoring";
export type LoadWarning = "references" | "citations" | "related" | "details";

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
}

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
	const [references, citations, related] = await Promise.all([
		loadGroup(settings.includeReferences, () => client.referencedBySeed(seed.id, 80)),
		loadGroup(settings.includeCitations, () => client.citingSeed(seed.id, 40)),
		loadGroup(settings.includeRelated, () => client.relatedTo(seed.id, 20)),
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
		refAll.length - refPapers.length + (citeAll.length - citePapers.length) + (relatedAll.length - relatedPapers.length);
	const picked = selectNeighbors(
		settings,
		{ reference: refPapers, citation: citePapers, related: relatedPapers },
		seed.id,
	);

	const refLists = new Map<string, string[]>();
	refLists.set(seed.id, referenceIds(seedRaw.referenced_works));

	const contextIds = citePapers.map((paper) => paper.id);
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
				const paper = byId.get(id);
				const abstract = reconstructAbstract(raw.abstract_inverted_index);
				if (paper && abstract) paper.abstract = abstract;
			}
		} catch {
			warnings.push("details");
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
			if (target) citationEvidence.set(directEvidence(source, target, true, false));
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
	const maxNodes = clampInt(settings.maxNodes, 20, 80);
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
			const prev = chosen.get(paper.id);
			if (prev) {
				if (ORIGIN_RANK[paper.origin] > ORIGIN_RANK[prev.origin]) chosen.set(paper.id, paper);
				continue;
			}
			chosen.set(paper.id, paper);
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
	run: () => Promise<RawWork[]>,
): Promise<{ works: RawWork[]; error?: string }> {
	if (!enabled) return { works: [] };
	try {
		return { works: await run() };
	} catch (error) {
		return { works: [], error: error instanceof Error ? error.message : "请求失败" };
	}
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
		const prev = map.get(paper.id);
		if (!prev || ORIGIN_RANK[paper.origin] > ORIGIN_RANK[prev.origin]) map.set(paper.id, paper);
	}
	return [...map.values()].sort(byImpact);
}

function byImpact(a: PaperNode, b: PaperNode): number {
	return b.citedByCount - a.citedByCount || a.id.localeCompare(b.id);
}

function unique(ids: string[]): string[] {
	return [...new Set(ids.filter((id) => /^W\d+$/.test(id)))];
}

function clampInt(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.round(value)));
}
