import type { CitationEvidence } from "./citation-evidence";
import type { SimilarityGraph } from "./neighborhood";
import type { PaperNode } from "./types";

export type TimelineZone = "prior" | "seed" | "derivative";

export interface TimelineNode {
	id: string;
	/** Empty when the work was never fetched (missing). */
	title: string;
	year: number | null;
	citedByCount: number;
	zone: TimelineZone;
	/** 既被种子引用又引用种子，双向证据置信度相同时置于前置区并标记。 */
	mutual: boolean;
	/** 两个方向都有记录但置信度不同，按高置信方向归区并标记。 */
	conflict: boolean;
	/** 元数据没有取到（不在 catalog 里的 OpenAlex id）。 */
	missing: boolean;
	/** 是图节点，可在详情中打开。 */
	inGraph: boolean;
	evidence: CitationEvidence | null;
}

/** citingId 指向 citedId：与 evidenceText 的 source-cites-target 同向。 */
export interface TimelineLink {
	citingId: string;
	citedId: string;
}

export interface CitationTimeline {
	seed: TimelineNode | null;
	prior: TimelineNode[];
	derivative: TimelineNode[];
	links: TimelineLink[];
	/** 全部引用记录的来源，用于视图标注。 */
	sources: string[];
	empty: boolean;
}

export const TIMELINE_SCOPE_NOTE = "只含与种子的直接引用记录（参考文献列表与引用证据），不含相似关系。";
export const LIST_VS_TIMELINE_NOTE = "按图内互引频次统计；「引用脉络」只列种子的直接引用。";
export const TIMELINE_SAMPLING_NOTE = "参考文献可能不完整；施引论文按被引数排序采样且有上限（最多 400 篇上下文），施引一侧天然偏向高被引论文。";
export const TIMELINE_IMPACT_NOTE = "「引用了种子」不等于受种子实质影响。";
export const TIMELINE_EMPTY_TEXT = "当前采样范围内没有与种子的直接引用记录。参考文献可能不完整，或施引采样尚未覆盖。";
export const TIMELINE_META_NOTE = "参考文献元数据按需补取自 OpenAlex，上限 100 条。";
export const TIMELINE_LOADING_TEXT = "正在补取参考文献元数据…";
export const TIMELINE_MUTUAL_LABEL = "互引";
export const TIMELINE_CONFLICT_LABEL = "方向存疑";
export const TIMELINE_UNKNOWN_YEAR = "年份未知";
export const TIMELINE_MISSING_LABEL = "未收录";
export const TIMELINE_META_LIMIT = 100;

export function timelineOverflowNote(hidden: number): string {
	return `+${hidden} 篇（按被引排序未全部显示）`;
}

/** 种子参考文献里还缺元数据的 id，保持引用列表顺序，超上限的不再补取。 */
export function missingReferenceIds(
	graph: SimilarityGraph,
	extra: ReadonlyMap<string, PaperNode>,
	limit = TIMELINE_META_LIMIT,
): string[] {
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) return [];
	const known = new Set<string>([...graph.catalog.map((paper) => paper.id), ...graph.nodes.map((paper) => paper.id)]);
	const missing: string[] = [];
	for (const id of graph.referenceLists.get(seed.id) ?? []) {
		if (id === seed.id || known.has(id) || extra.has(id)) continue;
		known.add(id);
		missing.push(id);
		if (missing.length >= limit) break;
	}
	return missing;
}

const CONFIDENCE_RANK: Record<CitationEvidence["confidence"], number> = { high: 3, medium: 2, low: 1 };

/**
 * 只用原始引用记录（referenceLists + citationEvidence）构建种子引用脉络；
 * 不看 buildSimilarity 稀疏化后的图边，所以相似但无引用记录的节点不会出现。
 * extraMeta 是按需补取到的元数据（catalog 之外的参考文献）。
 */
export function buildCitationTimeline(graph: SimilarityGraph, extraMeta?: ReadonlyMap<string, PaperNode>): CitationTimeline {
	const seedPaper = graph.nodes.find((node) => node.isSeed) ?? null;
	if (!seedPaper) return { seed: null, prior: [], derivative: [], links: [], sources: [], empty: true };
	const seedId = seedPaper.id;
	const byId = new Map<string, PaperNode>();
	for (const [id, paper] of extraMeta ?? []) byId.set(id, paper);
	for (const paper of graph.catalog) byId.set(paper.id, paper);
	for (const paper of graph.nodes) byId.set(paper.id, paper);
	const nodeIds = new Set(graph.nodes.map((node) => node.id));

	const seedRefs = new Set(graph.referenceLists.get(seedId) ?? []);
	const seedCitesEvidence = new Map<string, CitationEvidence>();
	const citesSeedEvidence = new Map<string, CitationEvidence>();
	for (const evidence of graph.citationEvidence?.entries() ?? []) {
		if (evidence.citingId === seedId && evidence.citedId !== seedId) seedCitesEvidence.set(evidence.citedId, evidence);
		if (evidence.citedId === seedId && evidence.citingId !== seedId) citesSeedEvidence.set(evidence.citingId, evidence);
	}
	const citesSeedIds = new Set(citesSeedEvidence.keys());
	const rawCitesSeedIds = new Set<string>();
	for (const [id, refs] of graph.referenceLists) {
		if (id === seedId) continue;
		if (refs.includes(seedId)) {
			citesSeedIds.add(id);
			rawCitesSeedIds.add(id);
		}
	}
	const seedCitesIds = new Set([...seedRefs, ...seedCitesEvidence.keys()]);

	const sources = new Set<string>();
	if (seedRefs.size > 0) sources.add(rawReferenceSource(seedId, graph));
	for (const [id, refs] of graph.referenceLists) {
		if (id !== seedId && refs.includes(seedId)) sources.add(rawReferenceSource(id, graph));
	}
	const prior: TimelineNode[] = [];
	const derivative: TimelineNode[] = [];
	const links: TimelineLink[] = [];

	const candidates = [...new Set([...seedCitesIds, ...citesSeedIds])].sort();
	for (const id of candidates) {
		const forward = seedCitesEvidence.get(id) ?? (seedRefs.has(id) ? recordedReferenceCitation(seedId, id, graph) : null);
		const backward = citesSeedEvidence.get(id) ?? (rawCitesSeedIds.has(id) ? recordedReferenceCitation(id, seedId, graph) : null);
		for (const evidence of [forward, backward]) {
			if (evidence) for (const source of evidence.sources) sources.add(source);
		}
		let zone: "prior" | "derivative";
		let mutual = false;
		let conflict = false;
		let evidence: CitationEvidence | null;
		if (seedCitesIds.has(id) && citesSeedIds.has(id)) {
			const rankForward = forward ? CONFIDENCE_RANK[forward.confidence] : 1;
			const rankBackward = backward ? CONFIDENCE_RANK[backward.confidence] : 1;
			if (rankForward === rankBackward) {
				zone = "prior";
				mutual = true;
				evidence = forward ?? backward;
			} else if (rankForward > rankBackward) {
				zone = "prior";
				conflict = true;
				evidence = forward;
			} else {
				zone = "derivative";
				conflict = true;
				evidence = backward;
			}
		} else if (seedCitesIds.has(id)) {
			zone = "prior";
			evidence = forward;
		} else {
			zone = "derivative";
			evidence = backward;
		}
		const paper = byId.get(id);
		const node: TimelineNode = {
			id,
			title: paper?.title ?? "",
			year: paper?.year ?? null,
			citedByCount: paper?.citedByCount ?? 0,
			zone,
			mutual,
			conflict,
			missing: !paper,
			inGraph: nodeIds.has(id),
			evidence,
		};
		(zone === "prior" ? prior : derivative).push(node);
		if (zone === "prior") links.push({ citingId: seedId, citedId: id });
		if (zone === "derivative" || mutual) links.push({ citingId: id, citedId: seedId });
	}
	sortZone(prior);
	sortZone(derivative);

	const seed: TimelineNode = {
		id: seedId,
		title: seedPaper.title,
		year: seedPaper.year,
		citedByCount: seedPaper.citedByCount,
		zone: "seed",
		mutual: false,
		conflict: false,
		missing: false,
		inGraph: true,
		evidence: null,
	};
	return { seed, prior, derivative, links, sources: [...sources].sort(), empty: prior.length === 0 && derivative.length === 0 };
}

/** 有年份在前按年份升序；无年份进「年份未知」区，按被引降序。 */
function sortZone(nodes: TimelineNode[]): void {
	nodes.sort((a, b) => {
		if ((a.year === null) !== (b.year === null)) return a.year === null ? 1 : -1;
		if (a.year !== null && b.year !== null && a.year !== b.year) return a.year - b.year;
		return b.citedByCount - a.citedByCount || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
	});
}

/** Recover the source for raw lists when the target metadata was not fetched. */
function recordedReferenceCitation(citingId: string, citedId: string, graph: SimilarityGraph): CitationEvidence {
	return {
		citingId,
		citedId,
		sources: [rawReferenceSource(citingId, graph)],
		intents: [],
		contexts: [],
		relation: "unclear",
		evidenceQuotes: [],
		confidence: "medium",
	};
}

function rawReferenceSource(citingId: string, graph: SimilarityGraph): "openalex" | "semantic-scholar" {
	return (graph.crossCheck?.get(citingId)?.refsAdded ?? 0) > 0 ? "semantic-scholar" : "openalex";
}
