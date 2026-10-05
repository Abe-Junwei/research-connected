import { topicSimilarity } from "./topic-similarity";
import type { PaperNode } from "./types";

/**
 * 本地语义相似度（proposal-5 Phase A）：BM25（标题 + 摘要 + concepts）
 * 与 OpenAlex 主题余弦的加权合成。纯本地计算，不发任何请求。
 *
 * 候选排序发生在摘要批量补取之前，那时 abstract 字段为空，同一套代码
 * 自动退化为「标题 + concepts」；建图完成后摘要已就位，再用同一函数
 * 得到展示用的完整分数。
 */

const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** BM25 与主题余弦都有时的 BM25 权重（主题占 0.4）。 */
const TEXT_WEIGHT = 0.6;
/** SPECTER2 向量与主题余弦都有时的向量权重（主题占 0.25）。 */
const EMBED_WEIGHT = 0.75;

/** SPECTER2 余弦，钳到 0–1（负值视为无信号）；维度不符或零向量返回 null。 */
export function embeddingCosine(a: readonly number[], b: readonly number[]): number | null {
	if (a.length === 0 || a.length !== b.length) return null;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i]!;
		const bi = b[i]!;
		dot += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}
	if (normA === 0 || normB === 0) return null;
	const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
	return Math.max(0, Math.min(1, cos));
}

const STOPWORDS = new Set([
	"the", "and", "for", "with", "from", "that", "this", "these", "those", "are", "was", "were", "has", "have", "had",
	"its", "his", "her", "our", "their", "not", "but", "into", "over", "under", "between", "among", "via", "using",
	"based", "study", "studies", "analysis", "approach", "results", "method", "methods", "model", "models", "data",
	"paper", "work", "new", "two", "can", "may", "also", "than", "then", "when", "which", "while", "such", "each",
	"研究", "基于", "分析", "方法", "结果", "模型", "数据", "本文", "影响", "应用", "问题", "及其", "中的", "下的",
]);

/** 英文按词（小写、去停用词、≥3 字符），中日韩按字 bigram。 */
export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	const words = text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [];
	for (const word of words) {
		if (word.length < 3 || STOPWORDS.has(word)) continue;
		tokens.push(word);
	}
	const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g) ?? [];
	for (let i = 0; i + 1 < cjk.length; i++) tokens.push(`${cjk[i]}${cjk[i + 1]}`);
	return tokens;
}

function docTokens(paper: PaperNode): string[] {
	const parts = [paper.title, paper.concepts.join(" ")];
	if (paper.abstract) parts.push(paper.abstract);
	return tokenize(parts.join(" "));
}

export interface SemanticScorer {
	/** 0–1；文本与主题信号都缺失时为 null（UI 显示「不可用」，不拿 0 冒充）。 */
	score(node: PaperNode): number | null;
}

/**
 * 以 seed 为查询、corpus 为文档集构建打分器；BM25 分数在语料内按最大值归一。
 * 传入 embeddings（SPECTER2，键为节点 id）时，seed 与节点都有向量的对改用
 * 0.75×向量余弦 + 0.25×主题余弦；单侧缺向量的节点自动退回本地 BM25 通道。
 */
export function buildSemanticScorer(
	seed: PaperNode,
	corpus: readonly PaperNode[],
	embeddings?: ReadonlyMap<string, readonly number[]>,
): SemanticScorer {
	const seedVec = embeddings?.get(seed.id);
	const embeddingScore = (node: PaperNode): number | null => {
		const nodeVec = seedVec ? embeddings?.get(node.id) : undefined;
		if (!seedVec || !nodeVec) return null;
		const cos = embeddingCosine(seedVec, nodeVec);
		if (cos === null) return null;
		const topic = topicSimilarity(seed.topicTags, node.topicTags);
		return topic === null ? cos : EMBED_WEIGHT * cos + (1 - EMBED_WEIGHT) * topic;
	};
	const docs = new Map<string, string[]>();
	for (const paper of [seed, ...corpus]) {
		const tokens = docTokens(paper);
		if (tokens.length > 0) docs.set(paper.id, tokens);
	}
	const seedTokens = docs.get(seed.id) ?? [];
	if (docs.size < 2 || seedTokens.length === 0) {
		const topicOnly = (node: PaperNode): number | null =>
			embeddingScore(node) ?? topicSimilarity(seed.topicTags, node.topicTags);
		return { score: topicOnly };
	}

	const docCount = docs.size;
	const freq = new Map<string, number>();
	for (const tokens of docs.values()) {
		for (const token of new Set(tokens)) freq.set(token, (freq.get(token) ?? 0) + 1);
	}
	const idf = (token: string): number => {
		const df = freq.get(token) ?? 0;
		return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
	};
	let totalLen = 0;
	for (const tokens of docs.values()) totalLen += tokens.length;
	const avgLen = Math.max(1, totalLen / docCount);

	const query = new Set(seedTokens);
	const raw = new Map<string, number>();
	for (const [id, tokens] of docs) {
		if (id === seed.id) continue;
		const counts = new Map<string, number>();
		for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
		let score = 0;
		for (const token of query) {
			const f = counts.get(token);
			if (!f) continue;
			score += idf(token) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * tokens.length) / avgLen)));
		}
		raw.set(id, score);
	}
	const max = Math.max(0, ...raw.values());

	return {
		score(node: PaperNode): number | null {
			const embedded = embeddingScore(node);
			if (embedded !== null) return embedded;
			const text = max > 0 ? (raw.get(node.id) ?? 0) / max : null;
			const topic = topicSimilarity(seed.topicTags, node.topicTags);
			if (text === null) return topic;
			if (topic === null) return text;
			return TEXT_WEIGHT * text + (1 - TEXT_WEIGHT) * topic;
		},
	};
}
