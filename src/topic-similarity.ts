export interface TopicScore {
	id: string;
	name: string;
	score: number;
}

/** Cosine similarity over OpenAlex topic scores; null means one side has no topic metadata. */
export function topicSimilarity(a: readonly TopicScore[] | undefined, b: readonly TopicScore[] | undefined): number | null {
	if (!a?.length || !b?.length) return null;
	const left = vector(a);
	const right = vector(b);
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (const value of left.values()) leftNorm += value * value;
	for (const value of right.values()) rightNorm += value * value;
	for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
	if (!leftNorm || !rightNorm) return null;
	return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

/** Perceptually simple low-to-high ramp: unrelated gray-blue → close vivid teal. */
export function topicSimilarityColor(score: number | null): string {
	if (score === null || !Number.isFinite(score)) return "#c8cdd2";
	const t = Math.max(0, Math.min(1, score));
	const low = [190, 205, 219] as const;
	const high = [25, 157, 133] as const;
	const channels = low.map((value, index) => Math.round(value + ((high[index] ?? value) - value) * t));
	return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function vector(topics: readonly TopicScore[]): Map<string, number> {
	const result = new Map<string, number>();
	for (const topic of topics) {
		const key = topic.id.trim() || `name:${topic.name.trim().toLocaleLowerCase()}`;
		if (!key) continue;
		const score = Number.isFinite(topic.score) ? Math.max(0, topic.score) : 0;
		result.set(key, Math.max(result.get(key) ?? 0, score));
	}
	return result;
}
