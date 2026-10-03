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
				points: expanded,
				left: Math.min(...expanded.map((point) => point.x)),
				top: Math.min(...expanded.map((point) => point.y)),
			};
		});
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
