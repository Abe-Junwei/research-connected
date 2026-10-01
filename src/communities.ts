import type { GraphEdge } from "./types";

/**
 * Deterministic label propagation on the undirected similarity graph.
 * Returns a dense community index per node, largest community first.
 * Edge colors stay on the relation type; this map is only for nodes.
 */
export function detectCommunities(nodeIds: readonly string[], edges: readonly GraphEdge[]): Map<string, number> {
	const neighbors = new Map<string, string[]>();
	for (const id of nodeIds) neighbors.set(id, []);
	for (const edge of edges) {
		neighbors.get(edge.source)?.push(edge.target);
		neighbors.get(edge.target)?.push(edge.source);
	}
	const label = new Map<string, string>();
	for (const id of nodeIds) label.set(id, id);
	const order = [...nodeIds].sort((a, b) => a.localeCompare(b));
	for (let iter = 0; iter < 12; iter++) {
		for (const id of order) {
			const counts = new Map<string, number>();
			for (const next of neighbors.get(id) ?? []) {
				const assigned = label.get(next);
				if (!assigned) continue;
				counts.set(assigned, (counts.get(assigned) ?? 0) + 1);
			}
			if (counts.size === 0) continue;
			let best = label.get(id) ?? id;
			let bestCount = -1;
			for (const key of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
				const count = counts.get(key) ?? 0;
				if (count > bestCount) {
					bestCount = count;
					best = key;
				}
			}
			label.set(id, best);
		}
	}
	const size = new Map<string, number>();
	for (const assigned of label.values()) size.set(assigned, (size.get(assigned) ?? 0) + 1);
	const rank = [...size.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([id], index) => [id, index] as const);
	const indexOf = new Map(rank);
	const communities = new Map<string, number>();
	for (const id of nodeIds) communities.set(id, indexOf.get(label.get(id) ?? id) ?? 0);
	return communities;
}

/** Node palette. Kept off the gold / teal / indigo edge colors. */
const COMMUNITY_RGB: ReadonlyArray<readonly [number, number, number]> = [
	[227, 109, 109],
	[91, 141, 239],
	[192, 132, 252],
	[245, 158, 11],
	[244, 114, 182],
	[52, 211, 153],
	[251, 113, 133],
	[125, 211, 252],
];

export function communityColor(index: number): string {
	const channels = COMMUNITY_RGB[index % COMMUNITY_RGB.length] ?? COMMUNITY_RGB[0] ?? [227, 109, 109];
	return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}
