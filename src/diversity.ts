import { tokenize } from "./text-similarity";
import { topicSimilarity } from "./topic-similarity";
import type { PaperNode } from "./types";

/**
 * 候选两两之间的多样性相似度（proposal-5 Phase C，LIN-12 修正版）。
 * 与 seed 导向的 BM25 打分器不同：这里必须对称、落在 [0,1]、特征缺失时
 * 可空，并且与 query/corpus 无关——词项余弦（标题 + concepts + 摘要）
 * 与 OpenAlex 主题余弦按 0.6/0.4 合成，单侧缺失重归一，全缺返回 null。
 * 不请求任何外部服务（SPECTER2 不提前取回）。
 */

const LEXICAL_WEIGHT = 0.6;

type TermVector = Map<string, number>;

function termVector(paper: PaperNode): TermVector | null {
	const parts = [paper.title, paper.concepts.join(" ")];
	if (paper.abstract) parts.push(paper.abstract);
	const tokens = tokenize(parts.join(" "));
	if (tokens.length === 0) return null;
	const vector: TermVector = new Map();
	for (const token of tokens) vector.set(token, (vector.get(token) ?? 0) + 1);
	return vector;
}

function cosine(a: TermVector, b: TermVector): number | null {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (const count of a.values()) normA += count * count;
	for (const count of b.values()) normB += count * count;
	if (normA === 0 || normB === 0) return null;
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	for (const [token, count] of small) dot += count * (large.get(token) ?? 0);
	return dot / Math.sqrt(normA * normB);
}

/**
 * 对一组候选构建 memoized 的两两相似度函数。词向量只算一次，pair 结果
 * 按 id 对缓存；对称性由键的排序保证。
 */
export function buildPairSimilarity(papers: readonly PaperNode[]): (a: PaperNode, b: PaperNode) => number | null {
	const vectors = new Map<string, TermVector | null>();
	for (const paper of papers) vectors.set(paper.id, termVector(paper));
	const memo = new Map<string, number | null>();
	return (a, b) => {
		if (a.id === b.id) return 1;
		const key = a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`;
		const hit = memo.get(key);
		if (hit !== undefined || memo.has(key)) return hit ?? null;
		const va = vectors.get(a.id) ?? null;
		const vb = vectors.get(b.id) ?? null;
		const lexical = va && vb ? cosine(va, vb) : null;
		const topic = topicSimilarity(a.topicTags, b.topicTags);
		let value: number | null;
		if (lexical === null) value = topic;
		else if (topic === null) value = lexical;
		else value = LEXICAL_WEIGHT * lexical + (1 - LEXICAL_WEIGHT) * topic;
		memo.set(key, value);
		return value;
	};
}
