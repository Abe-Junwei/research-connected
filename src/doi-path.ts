/** Default node-visit budget for citation-path search on sampled reference lists. */
export const DEFAULT_PATH_BUDGET = 200;

export type PathDirection = "citing-to-cited" | "cited-to-citing";

export interface CitationPathResult {
	/** OpenAlex id chains (at most a few same-length alternatives). Empty when none within budget. */
	paths: string[][];
	checked: number;
	budget: number;
	exhausted: boolean;
	direction: PathDirection;
}

/**
 * Budgeted BFS over already-fetched reference lists (citing → cited).
 * Phrase results as「预算内找到的路径」— never claim a global shortest path.
 */
export function findBudgetedCitationPath(
	referenceLists: ReadonlyMap<string, readonly string[]>,
	startId: string,
	endId: string,
	budget = DEFAULT_PATH_BUDGET,
): CitationPathResult {
	if (startId === endId) {
		return { paths: [[startId]], checked: 0, budget, exhausted: false, direction: "citing-to-cited" };
	}
	const forward = search(referenceLists, startId, endId, budget, "citing-to-cited");
	if (forward.paths.length) return forward;
	const backward = search(invertReferenceLists(referenceLists), startId, endId, budget, "cited-to-citing");
	if (backward.paths.length) return backward;
	return forward.checked >= backward.checked ? forward : backward;
}

function search(
	lists: ReadonlyMap<string, readonly string[]>,
	startId: string,
	endId: string,
	budget: number,
	direction: PathDirection,
): CitationPathResult {
	const visited = new Set<string>([startId]);
	const parent = new Map<string, string | null>([[startId, null]]);
	const queue = [startId];
	let checked = 0;
	let head = 0;
	const paths: string[][] = [];
	let goalHops: number | null = null;

	while (head < queue.length) {
		if (checked >= budget) {
			return { paths, checked, budget, exhausted: paths.length === 0, direction };
		}
		const node = queue[head++]!;
		checked++;
		const hops = pathLength(parent, node);
		if (goalHops !== null && hops >= goalHops) continue;
		for (const next of lists.get(node) ?? []) {
			if (next === endId) {
				const path = [...rebuild(parent, node), endId];
				const nextHops = path.length - 1;
				if (goalHops === null) goalHops = nextHops;
				if (nextHops === goalHops) paths.push(path);
				if (paths.length >= 5) return { paths, checked, budget, exhausted: false, direction };
				continue;
			}
			if (visited.has(next)) continue;
			visited.add(next);
			parent.set(next, node);
			queue.push(next);
		}
	}
	return { paths, checked, budget, exhausted: false, direction };
}

function invertReferenceLists(lists: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
	const reverse = new Map<string, string[]>();
	for (const [citing, cited] of lists) {
		for (const id of cited) {
			const row = reverse.get(id);
			if (row) row.push(citing);
			else reverse.set(id, [citing]);
		}
	}
	return reverse;
}

function pathLength(parent: Map<string, string | null>, id: string): number {
	let length = 0;
	let cursor: string | null | undefined = id;
	while (cursor) {
		cursor = parent.get(cursor) ?? null;
		if (cursor) length++;
		if (length > 10_000) break;
	}
	return length;
}

function rebuild(parent: Map<string, string | null>, endId: string): string[] {
	const path: string[] = [];
	let cursor: string | null | undefined = endId;
	while (cursor) {
		path.push(cursor);
		cursor = parent.get(cursor) ?? null;
	}
	path.reverse();
	return path;
}

/** Resolve a DOI / OpenAlex id against nodes already in the sampled graph. */
export function resolvePathEndpoint(
	query: string,
	papers: Iterable<{ id: string; doiUrl: string | null }>,
	normalizeDoi: (value: string | null | undefined) => string | null,
	shortId: (value: string) => string,
): string | null {
	const trimmed = query.trim();
	if (!trimmed) return null;
	const asId = shortId(trimmed);
	if (/^W\d+$/i.test(asId)) {
		const upper = asId.toUpperCase();
		for (const paper of papers) if (paper.id === upper) return paper.id;
	}
	const doi = normalizeDoi(trimmed);
	if (!doi) return null;
	for (const paper of papers) {
		if (normalizeDoi(paper.doiUrl) === doi) return paper.id;
	}
	return null;
}
