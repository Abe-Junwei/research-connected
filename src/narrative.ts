import { derivativeWorks, priorWorks } from "./aggregates";
import type { CitationEvidence } from "./citation-evidence";
import type { SimilarityGraph } from "./neighborhood";
import type { PaperNode } from "./types";

export interface NarrativeEvidencePaper {
	id: string;
	title: string;
	year: number | null;
	authors: string;
	abstract?: string;
	openAlexUrl: string;
}

export interface NarrativeEvidence {
	seed: NarrativeEvidencePaper;
	priorWorks: Array<NarrativeEvidencePaper & { count: number; directlyCited: boolean }>;
	derivativeWorks: Array<NarrativeEvidencePaper & { count: number; directlyCitesSeed: boolean }>;
	citations: CitationEvidence[];
	caveats: string[];
}

export interface NarrativeItem {
	paperId: string;
	role: string;
	claim: string;
	evidence: string[];
	confidence: "high" | "medium" | "low";
}

export interface ResearchNarrative {
	synthesis: string;
	basedOn: NarrativeItem[];
	influenced: NarrativeItem[];
	importantWorks: NarrativeItem[];
	caveats: string[];
}

export function buildNarrativeEvidence(graph: SimilarityGraph, sendAbstracts: boolean): NarrativeEvidence {
	const nodes = new Map(graph.nodes.map((paper) => [paper.id, paper]));
	const allKnown = new Map([...graph.catalog, ...graph.nodes].map((paper) => [paper.id, paper]));
	const visible = new Set(graph.nodes.map((paper) => paper.id));
	const seed = graph.nodes.find((paper) => paper.isSeed) ?? graph.nodes[0];
	if (!seed) throw new Error("当前图谱没有种子论文。");
	const seedRefs = new Set(graph.referenceLists?.get(seed.id) ?? []);
	const make = (paper: PaperNode): NarrativeEvidencePaper => ({
		id: paper.id,
		title: paper.title,
		year: paper.year,
		authors: paper.authors,
		...(sendAbstracts && paper.abstract ? { abstract: paper.abstract.slice(0, 1200) } : {}),
		openAlexUrl: paper.openAlexUrl,
	});
	const cites = (a: string, b: string): boolean =>
		(graph.referenceLists.get(a)?.includes(b) ?? false) || Boolean(graph.citationEvidence?.get(a, b));
	const candidates = [...allKnown.values()].filter(p => p.id !== seed.id);
	const priorCounts = new Map(priorWorks(graph, visible).map(p => [p.paper.id, p.count]));
	const derivativeCounts = new Map(derivativeWorks(graph, visible).map(p => [p.paper.id, p.count]));
	const prior = candidates.filter(p => cites(seed.id, p.id))
		.sort((a, b) => (priorCounts.get(b.id) ?? 0) - (priorCounts.get(a.id) ?? 0) || b.citedByCount - a.citedByCount)
		.slice(0, 8).map(p => ({ ...make(p), count: priorCounts.get(p.id) ?? 1, directlyCited: true }));
	const derivatives = candidates.filter(p => cites(p.id, seed.id))
		.sort((a, b) => (derivativeCounts.get(b.id) ?? 0) - (derivativeCounts.get(a.id) ?? 0) || b.citedByCount - a.citedByCount)
		.slice(0, 8).map(p => ({ ...make(p), count: derivativeCounts.get(p.id) ?? 1, directlyCitesSeed: true }));
	const selected = new Set([seed.id, ...prior.map(p => p.id), ...derivatives.map(p => p.id)]);
	const citations = (graph.citationEvidence?.entries() ?? [])
		.filter(e => selected.has(e.citingId) && selected.has(e.citedId))
		.slice(0, 80).map(e => ({ ...e, contexts: e.contexts.slice(0, 3).map(s => s.slice(0, 1500)),
			evidenceQuotes: e.evidenceQuotes.slice(0, 3).map(s => s.slice(0, 1500)) }));
	return {
		seed: make(seed),
		priorWorks: prior,
		derivativeWorks: derivatives,
		citations,
		caveats: [
			"当前总结基于 OpenAlex 采样到的图谱，引用列表可能不完整。",
			"引用关系不等同于真实学术影响；Influential 或方法继承需要可用的引用上下文支持。",
			allKnown.size > graph.nodes.length ? "部分施引论文只作为引用上下文存在，没有进入主图谱。" : "",
		].filter(Boolean),
	};
}

export function validateNarrative(value: unknown, allowedIds: ReadonlySet<string>): ResearchNarrative {
	if (!value || typeof value !== "object") throw new Error("LLM 返回的研究脉络不是对象。");
	const input = value as Record<string, unknown>;
	if (typeof input.synthesis !== "string" || input.synthesis.length > 8000 ||
		!["basedOn", "influenced", "importantWorks", "caveats"].every(key => Array.isArray(input[key]))) {
		throw new Error("研究脉络结构不完整，请重新生成。");
	}
	const items = (input.basedOn ?? []) as unknown[];
	const influenced = (input.influenced ?? []) as unknown[];
	const important = (input.importantWorks ?? []) as unknown[];
	const parse = (list: unknown[]): NarrativeItem[] => list.slice(0, 12).flatMap((raw) => {
		if (!raw || typeof raw !== "object") return [];
		const item = raw as Record<string, unknown>;
		if (typeof item.paperId !== "string" || !allowedIds.has(item.paperId)) throw new Error("模型引用了证据包之外的论文，结果已拒绝。");
		if (typeof item.claim !== "string" || item.claim.length > 4000 || !Array.isArray(item.evidence) || !item.evidence.length ||
			!item.evidence.every(e => typeof e === "string" && e.length <= 2000)) throw new Error("模型条目缺少有效证据。");
		return [{
			paperId: item.paperId,
			role: typeof item.role === "string" ? item.role : "unclear",
			claim: typeof item.claim === "string" ? item.claim : "证据不足，无法总结。",
			evidence: Array.isArray(item.evidence) ? item.evidence.filter((x): x is string => typeof x === "string").slice(0, 4) : [],
			confidence: item.confidence === "high" || item.confidence === "medium" ? item.confidence : "low",
		}];
	});
	return {
		synthesis: typeof input.synthesis === "string" ? input.synthesis : "模型没有提供总体总结。",
		basedOn: parse(items),
		influenced: parse(influenced),
		importantWorks: parse(important),
		caveats: Array.isArray(input.caveats) ? input.caveats.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
	};
}

export function narrativePrompt(evidence: NarrativeEvidence): string {
	return `你是学术文献综述助手。只能使用下面 JSON 中的论文和证据。不要补造论文、作者、年份、方法或影响关系。引用关系不等于学术影响；证据不足时必须明确说明。只返回 JSON，字段为 synthesis、basedOn、influenced、importantWorks、caveats。每个条目的 paperId 必须来自输入，claim 必须由 evidence 支持，confidence 只能是 high、medium 或 low。\n\n${JSON.stringify(evidence)}`;
}
