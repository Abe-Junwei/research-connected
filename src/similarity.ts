import type { DirectLink, GraphEdge } from "./types";

/**
 * Connected Papers-style approximation from a sampled OpenAlex neighborhood.
 *
 * score(A, B) = 0.55 * bibliographic coupling
 *             + 0.35 * co-citation
 *             + 0.10 * direct citation
 *
 * Coupling is the cosine of the two reference sets. Co-citation uses the
 * reference lists of papers that cite the seed as contexts (how often A and B
 * are cited together in that sample). Direct citation is 1 when either work
 * lists the other.
 *
 * The seed keeps its top SEED_LINKS neighbors. Every other node keeps up to
 * PEER_LINKS neighbors above MIN_SCORE. Isolates still get their single best
 * link so the map stays connected. Edge weight is the raw score.
 */
export const COUPLING_WEIGHT = 0.55;
export const COCITATION_WEIGHT = 0.35;
export const DIRECT_WEIGHT = 0.1;
export const SEED_LINKS = 7;
export const PEER_LINKS = 2;
export const MIN_SCORE = 0.07;

export interface SimilarityInput {
	ids: string[];
	seedId: string;
	references: Map<string, Set<string>>;
	contexts: ReadonlyArray<ReadonlySet<string>>;
}

export interface SimilarityModel {
	edges: GraphEdge[];
	seedScore: Map<string, number>;
}

export function pairScore(
	a: string,
	b: string,
	references: Map<string, Set<string>>,
	contexts: ReadonlyArray<ReadonlySet<string>>,
): number {
	return pairParts(a, b, references, contexts).weight;
}

export function buildSimilarity(input: SimilarityInput): SimilarityModel {
	const ids = input.ids;
	const partsOf = new Map<string, PairParts>();
	for (let i = 0; i < ids.length; i++) {
		const a = ids[i];
		if (!a) continue;
		for (let j = i + 1; j < ids.length; j++) {
			const b = ids[j];
			if (!b) continue;
			partsOf.set(pairKey(a, b), pairParts(a, b, input.references, input.contexts));
		}
	}

	const score = (a: string, b: string): number => partsOf.get(pairKey(a, b))?.weight ?? 0;
	const seedScore = new Map<string, number>();
	seedScore.set(input.seedId, 1);
	for (const id of ids) {
		if (id !== input.seedId) seedScore.set(id, score(input.seedId, id));
	}

	return { edges: connect(ids, input.seedId, score, partsOf), seedScore };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function connect(
	ids: string[],
	seedId: string,
	score: (a: string, b: string) => number,
	partsOf: Map<string, PairParts>,
): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const seen = new Set<string>();

	const add = (a: string, b: string, weight: number): void => {
		if (a === b || weight <= 0) return;
		const key = pairKey(a, b);
		if (seen.has(key)) return;
		seen.add(key);
		const parts = partsOf.get(key);
		edges.push({
			source: a,
			target: b,
			weight: Math.min(1, weight),
			coupling: parts?.coupling ?? 0,
			sharedRefs: parts?.sharedRefs ?? 0,
			coCitation: parts?.coCitation ?? 0,
			coCitedBy: parts?.coCitedBy ?? 0,
			direct: parts ? directLink(a, b, parts) : "none",
		});
	};

	const others = ids.filter((id) => id !== seedId);
	const seedRanked = others
		.map((id) => ({ id, weight: score(seedId, id) }))
		.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

	for (const item of seedRanked.slice(0, SEED_LINKS)) add(seedId, item.id, item.weight);
	if (edges.length === 0) {
		for (const item of seedRanked.slice(0, Math.min(4, seedRanked.length))) {
			add(seedId, item.id, Math.max(item.weight, 0.05));
		}
	}

	for (const id of others) {
		const ranked = others
			.filter((other) => other !== id)
			.map((other) => ({ id: other, weight: score(id, other) }))
			.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
		let kept = 0;
		for (const item of ranked) {
			if (item.weight < MIN_SCORE) break;
			add(id, item.id, item.weight);
			kept += 1;
			if (kept >= PEER_LINKS) break;
		}
	}

	const degree = new Map<string, number>();
	for (const id of ids) degree.set(id, 0);
	for (const edge of edges) {
		degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
		degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
	}

	for (const id of others) {
		if ((degree.get(id) ?? 0) > 0) continue;
		let best = seedId;
		let bestWeight = score(id, seedId);
		for (const other of others) {
			if (other === id) continue;
			const weight = score(id, other);
			if (weight > bestWeight) {
				best = other;
				bestWeight = weight;
			}
		}
		add(id, best, Math.max(bestWeight, 0.04));
	}

	return edges;
}

interface PairParts {
	weight: number;
	coupling: number;
	sharedRefs: number;
	coCitation: number;
	coCitedBy: number;
	/** Lexicographically smaller id lists the larger id. */
	lowCitesHigh: boolean;
	highCitesLow: boolean;
}

function pairParts(
	a: string,
	b: string,
	references: Map<string, Set<string>>,
	contexts: ReadonlyArray<ReadonlySet<string>>,
): PairParts {
	const aRefs = references.get(a) ?? EMPTY_SET;
	const bRefs = references.get(b) ?? EMPTY_SET;
	const overlapped = cosineOverlap(aRefs, bRefs);
	const cited = coCitation(a, b, contexts);
	const low = a < b ? a : b;
	const high = a < b ? b : a;
	const lowRefs = a < b ? aRefs : bRefs;
	const highRefs = a < b ? bRefs : aRefs;
	const lowCitesHigh = lowRefs.has(high);
	const highCitesLow = highRefs.has(low);
	const direct = lowCitesHigh || highCitesLow ? 1 : 0;
	return {
		weight: Math.min(
			1,
			COUPLING_WEIGHT * overlapped.cosine + COCITATION_WEIGHT * cited.score + DIRECT_WEIGHT * direct,
		),
		coupling: overlapped.cosine,
		sharedRefs: overlapped.shared,
		coCitation: cited.score,
		coCitedBy: cited.both,
		lowCitesHigh,
		highCitesLow,
	};
}

function directLink(source: string, target: string, parts: PairParts): DirectLink {
	const sourceIsLow = source < target;
	const sourceCitesTarget = sourceIsLow ? parts.lowCitesHigh : parts.highCitesLow;
	const targetCitesSource = sourceIsLow ? parts.highCitesLow : parts.lowCitesHigh;
	if (sourceCitesTarget && targetCitesSource) return "mutual";
	if (sourceCitesTarget) return "source-cites-target";
	if (targetCitesSource) return "target-cites-source";
	return "none";
}

function cosineOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): { cosine: number; shared: number } {
	if (a.size === 0 || b.size === 0) return { cosine: 0, shared: 0 };
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	let shared = 0;
	for (const id of small) {
		if (large.has(id)) shared += 1;
	}
	if (shared === 0) return { cosine: 0, shared: 0 };
	return { cosine: shared / Math.sqrt(a.size * b.size), shared };
}

function coCitation(
	a: string,
	b: string,
	contexts: ReadonlyArray<ReadonlySet<string>>,
): { score: number; both: number } {
	let both = 0;
	let countA = 0;
	let countB = 0;
	for (const context of contexts) {
		const hasA = context.has(a);
		const hasB = context.has(b);
		if (hasA) countA += 1;
		if (hasB) countB += 1;
		if (hasA && hasB) both += 1;
	}
	if (both === 0 || countA === 0 || countB === 0) return { score: 0, both: 0 };
	return { score: both / Math.sqrt(countA * countB), both };
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
