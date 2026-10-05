import { tokenize } from "./text-similarity";

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
	cx: number;
	cy: number;
	left: number;
	top: number;
}

export interface CommunityCircle {
	community: number;
	members: number;
	label: string;
	cx: number;
	cy: number;
	radius: number;
}

export function compactPack(
	members: readonly { x: number; y: number }[],
	padding = 0,
): { cx: number; cy: number; radius: number } {
	let pts = [...members];
	for (let round = 0; round < 2 && pts.length > 3; round++) {
		const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
		const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
		const ranked = [...pts].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
		pts = ranked.slice(0, Math.max(3, Math.ceil(pts.length * 0.8)));
	}
	const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
	const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
	const radius = pts.reduce((max, point) => Math.max(max, Math.hypot(point.x - cx, point.y - cy)), 0);
	return { cx, cy, radius: radius + padding };
}

export function buildCommunityCircles(
	points: readonly CommunityPoint[],
	padding = 24,
	minimumMembers = 3,
	maximumRegions = 10,
	labels: ReadonlyMap<number, string> = new Map(),
): CommunityCircle[] {
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
			const pack = compactPack(members, padding);
			return {
				community,
				members: members.length,
				label: labels.get(community)?.trim() || `社区 ${community + 1}`,
				cx: pack.cx,
				cy: pack.cy,
				radius: pack.radius,
			};
		});
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
				cx: center.x,
				cy: center.y,
				left: Math.min(...expanded.map((point) => point.x)),
				top: Math.min(...expanded.map((point) => point.y)),
			};
		});
}

export function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i]!;
		const b = points[j]!;
		if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1) + a.x) inside = !inside;
	}
	return inside;
}

/** Smallest containing hull wins when packs overlap. */
export function hitCommunityRegion(
	x: number,
	y: number,
	regions: readonly CommunityRegion[],
): CommunityRegion | undefined {
	for (const region of [...regions].reverse()) {
		if (pointInPolygon(x, y, region.points)) return region;
	}
	return undefined;
}

export function hitCommunityCircle(
	x: number,
	y: number,
	circles: readonly CommunityCircle[],
): CommunityCircle | undefined {
	let best: CommunityCircle | undefined;
	for (const circle of circles) {
		if (Math.hypot(x - circle.cx, y - circle.cy) > circle.radius) continue;
		if (!best || circle.radius < best.radius) best = circle;
	}
	return best;
}

/** Distinctive title token per community: common inside, rare outside, unique on the map. */
const LABEL_STOP = new Set([
	"always", "never", "often", "usually", "really", "simply", "highly", "recent", "current",
	"general", "special", "important", "different", "various", "several", "certain", "possible",
	"related", "specific", "other", "another", "about", "like", "just", "only", "more", "most",
	"some", "any", "all", "very", "same", "both", "many", "much", "what", "how", "why", "who",
	"will", "would", "could", "should", "been", "being", "does", "did", "done",
	"notes", "note", "marking", "overview",
]);

export function communityTopicLabels(
	nodes: readonly { id: string; title?: string; abstract?: string; concepts?: readonly string[] }[],
	communities: ReadonlyMap<string, number>,
	maxLabels = 3,
): Map<number, string> {
	const counts = new Map<number, Map<string, { count: number; name: string; keyword: boolean }>>();
	for (const node of nodes) {
		const community = communities.get(node.id);
		if (community === undefined) continue;
		const seen = new Set<string>();
		const group = counts.get(community) ?? new Map();
		const add = (token: string, name: string, keyword: boolean): void => {
			if (seen.has(token) || LABEL_STOP.has(token) || token.length < 4) return;
			seen.add(token);
			const value = group.get(token) ?? { count: 0, name, keyword };
			value.count++;
			if (keyword) value.keyword = true;
			group.set(token, value);
		};
		for (const concept of node.concepts ?? []) {
			const raw = concept.trim();
			if (!raw) continue;
			add(raw.toLowerCase(), raw, true);
		}
		for (const token of tokenize(`${node.title ?? ""} ${node.abstract ?? ""}`)) add(token, displayToken(token), false);
		if (group.size) counts.set(community, group);
	}
	const df = new Map<string, number>();
	for (const tokens of counts.values()) {
		for (const key of tokens.keys()) df.set(key, (df.get(key) ?? 0) + 1);
	}
	const used = new Set<string>();
	const labels = new Map<number, string>();
	const limit = Math.max(1, maxLabels);
	const rank = (left: [string, { count: number; name: string; keyword: boolean }], right: [string, { count: number; name: string; keyword: boolean }]): number => {
		const dfA = df.get(left[0]) ?? 1;
		const dfB = df.get(right[0]) ?? 1;
		return Number(right[1].keyword) - Number(left[1].keyword) || right[1].count / dfB - left[1].count / dfA || dfA - dfB || right[1].count - left[1].count || right[1].name.length - left[1].name.length || left[1].name.localeCompare(right[1].name);
	};
	const pickFrom = (pool: Array<[string, { count: number; name: string; keyword: boolean }]>, picked: string[], fillHapax: boolean): void => {
		const unique = pool.filter(([key]) => (df.get(key) ?? 1) === 1);
		const source = unique.length ? unique : pool;
		const repeated = source.filter(([, value]) => value.count >= 2);
		const order = repeated.length ? (fillHapax ? [...repeated, ...source.filter((item) => item[1].count < 2)] : repeated) : source;
		for (const [key, value] of order) {
			if (used.has(key) || picked.length >= limit) continue;
			used.add(key);
			picked.push(value.name);
		}
	};
	for (const community of [...counts.keys()].sort((a, b) => a - b)) {
		const ranked = [...(counts.get(community)?.entries() ?? [])].sort(rank);
		const picked: string[] = [];
		pickFrom(ranked.filter(([, value]) => value.keyword), picked, true);
		if (!picked.length) pickFrom(ranked.filter(([, value]) => !value.keyword), picked, false);
		if (picked.length) labels.set(community, picked.join(" · "));
	}
	return labels;
}

function displayToken(token: string): string {
	return /^[a-z]/.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token;
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
