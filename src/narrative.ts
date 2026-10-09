import { tr } from "./i18n";
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
	if (!seed) throw new Error(tr("当前图谱没有种子论文。", "The current graph has no seed paper."));
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
			tr("当前总结基于 OpenAlex 采样到的图谱，引用列表可能不完整。", "This summary uses an OpenAlex sample; reference lists may be incomplete."),
			tr("引用关系不等同于真实学术影响；Influential 或方法继承需要可用的引用上下文支持。", "A citation does not prove scholarly influence; Influential labels or method inheritance require citation context."),
			allKnown.size > graph.nodes.length ? tr("部分施引论文只作为引用上下文存在，没有进入主图谱。", "Some citing papers provide citation context but are not shown in the main graph.") : "",
		].filter(Boolean),
	};
}

export function validateNarrative(value: unknown, allowedIds: ReadonlySet<string>): ResearchNarrative {
	if (!value || typeof value !== "object") throw new Error(tr("LLM 返回的研究脉络不是对象。", "The LLM research narrative is not an object."));
	const input = value as Record<string, unknown>;
	if (typeof input.synthesis !== "string" || input.synthesis.length > 8000 ||
		!["basedOn", "influenced", "importantWorks", "caveats"].every(key => Array.isArray(input[key]))) {
		throw new Error(tr("研究脉络结构不完整，请重新生成。", "The research narrative is incomplete. Generate it again."));
	}
	const items = (input.basedOn ?? []) as unknown[];
	const influenced = (input.influenced ?? []) as unknown[];
	const important = (input.importantWorks ?? []) as unknown[];
	const parse = (list: unknown[]): NarrativeItem[] => list.slice(0, 12).flatMap((raw) => {
		if (!raw || typeof raw !== "object") return [];
		const item = raw as Record<string, unknown>;
		if (typeof item.paperId !== "string" || !allowedIds.has(item.paperId)) throw new Error(tr("模型引用了证据包之外的论文，结果已拒绝。", "The model cited a paper outside the evidence set; the result was rejected."));
		if (typeof item.claim !== "string" || item.claim.length > 4000 || !Array.isArray(item.evidence) || !item.evidence.length ||
			!item.evidence.every(e => typeof e === "string" && e.length <= 2000)) throw new Error(tr("模型条目缺少有效证据。", "A model entry lacks valid evidence."));
		return [{
			paperId: item.paperId,
			role: typeof item.role === "string" ? item.role : "unclear",
			claim: typeof item.claim === "string" ? item.claim : tr("证据不足，无法总结。", "Insufficient evidence to summarize."),
			evidence: Array.isArray(item.evidence) ? item.evidence.filter((x): x is string => typeof x === "string").slice(0, 4) : [],
			confidence: item.confidence === "high" || item.confidence === "medium" ? item.confidence : "low",
		}];
	});
	return {
		synthesis: typeof input.synthesis === "string" ? input.synthesis : tr("模型没有提供总体总结。", "The model did not provide an overview."),
		basedOn: parse(items),
		influenced: parse(influenced),
		importantWorks: parse(important),
		caveats: Array.isArray(input.caveats) ? input.caveats.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
	};
}

export function narrativePrompt(evidence: NarrativeEvidence): string {
	return tr(`你是学术文献综述助手。只能使用下面 JSON 中的论文和证据。不要补造论文、作者、年份、方法或影响关系。引用关系不等于学术影响；证据不足时必须明确说明。只返回 JSON，字段为 synthesis、basedOn、influenced、importantWorks、caveats。每个条目的 paperId 必须来自输入，claim 必须由 evidence 支持，confidence 只能是 high、medium 或 low。自然语言字段使用简体中文。\n\n${JSON.stringify(evidence)}`, `You are an academic literature review assistant. Use only the papers and evidence in the JSON below. Do not invent papers, authors, years, methods, or influence relationships. A citation does not by itself prove scholarly influence; state clearly when evidence is insufficient. Return JSON only, with synthesis, basedOn, influenced, importantWorks, and caveats. Each entry's paperId must occur in the input, its claim must be supported by evidence, and confidence must be high, medium, or low. Write natural-language values in English.\n\n${JSON.stringify(evidence)}`);
}
