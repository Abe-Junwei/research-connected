export interface CommunityPoint {
	id: string;
	community: number;
	x: number;
	y: number;
	shown: boolean;
}

export interface CommunityRegion {
	community: number;
	members: number;
	label: string;
	points: Array<{ x: number; y: number }>;
	left: number;
	top: number;
}

/** Build gently padded convex regions for the largest visible communities. */
export function buildCommunityRegions(
	points: readonly CommunityPoint[],
	padding = 24,
	minimumMembers = 3,
	maximumRegions = 10,
	labels: ReadonlyMap<number, string> = new Map(),
): CommunityRegion[] {
	const groups = new Map<number, Array<{ x: number; y: number }>>();
	for (const point of points) {
		if (!point.shown) continue;
		const group = groups.get(point.community) ?? [];
		group.push({ x: point.x, y: point.y });
		groups.set(point.community, group);
	}
	return [...groups.entries()]
		.filter(([, members]) => members.length >= minimumMembers)
		.sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
		.slice(0, maximumRegions)
		.map(([community, members]) => {
			const hull = convexHull(members);
			const center = hull.reduce((sum, point) => ({ x: sum.x + point.x / hull.length, y: sum.y + point.y / hull.length }), { x: 0, y: 0 });
			const expanded = hull.map((point) => {
				const dx = point.x - center.x;
				const dy = point.y - center.y;
				const length = Math.hypot(dx, dy) || 1;
				return { x: point.x + (dx / length) * padding, y: point.y + (dy / length) * padding };
			});
			return {
				community,
				members: members.length,
				label: labels.get(community)?.trim() || `社区 ${community + 1}`,
				points: expanded,
				left: Math.min(...expanded.map((point) => point.x)),
				top: Math.min(...expanded.map((point) => point.y)),
			};
		});
}

/** Pick the most frequent OpenAlex topic labels among each graph community. */
export function communityTopicLabels(
	nodes: readonly { id: string; topicTags?: readonly { name: string; score: number }[]; concepts?: readonly string[] }[],
	communities: ReadonlyMap<string, number>,
): Map<number, string> {
	const counts = new Map<number, Map<string, { count: number; score: number; name: string }>>();
	for (const node of nodes) {
		const community = communities.get(node.id);
		if (community === undefined) continue;
		const topics = node.topicTags?.length ? node.topicTags.map((topic) => ({ name: topic.name, score: topic.score }))
			: (node.concepts ?? []).map((name) => ({ name, score: 1 }));
		const seen = new Set<string>();
		for (const topic of topics) {
			const name = topic.name.trim();
			const key = name.toLocaleLowerCase();
			if (!name || seen.has(key)) continue;
			seen.add(key);
			const group = counts.get(community) ?? new Map();
			const value = group.get(key) ?? { count: 0, score: 0, name };
			value.count++;
			value.score += Number.isFinite(topic.score) ? topic.score : 0;
			group.set(key, value);
			counts.set(community, group);
		}
	}
	const labels = new Map<number, string>();
	for (const [community, topics] of counts) {
		const ranked = [...topics.values()].sort((a, b) => b.count - a.count || b.score - a.score || a.name.localeCompare(b.name));
		if (ranked.length) labels.set(community, ranked.slice(0, 2).map((topic) => topic.name).join(" · "));
	}
	return labels;
}

function convexHull(points: readonly { x: number; y: number }[]): Array<{ x: number; y: number }> {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length <= 2) return sorted;
	const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Array<{ x: number; y: number }> = [];
	for (const point of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
		lower.push(point);
	}
	const upper: Array<{ x: number; y: number }> = [];
	for (const point of [...sorted].reverse()) {
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
		upper.push(point);
	}
	lower.pop();
	upper.pop();
	return [...lower, ...upper];
}
