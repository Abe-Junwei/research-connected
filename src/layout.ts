import type { GraphEdge } from "./types";
import { clamp } from "./visual";

export interface ForceNode {
	id: string;
	x: number;
	y: number;
	radius: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const COMMUNITY_PAD = 36;
/** Extra travel past packing before a group is reeled toward the seed (weak ≠ far-off-canvas). */
const FLY_SLACK = 80;

/**
 * Place the seed at the origin and other papers on a similarity spiral, then
 * relax springs (shorter when the score is higher), repulsion, and collision.
 * The seed stays pinned. Same-community edges shrink; members also pull
 * toward their community centroid so a group does not smear. After
 * relaxation, each community is compacted, overlapping disks are pushed
 * apart, and groups past packing+slack are pulled inward.
 */
export function runForceLayout(
	nodes: ForceNode[],
	edges: GraphEdge[],
	seedId: string,
	seedScore: Map<string, number>,
	iterations = 320,
	communities?: ReadonlyMap<string, number>,
): void {
	const index = new Map<string, number>();
	const others: ForceNode[] = [];
	for (const node of nodes) {
		index.set(node.id, index.size);
		if (node.id === seedId) {
			node.x = 0;
			node.y = 0;
		} else {
			others.push(node);
		}
	}
	others.sort(
		(a, b) =>
			(seedScore.get(b.id) ?? 0) - (seedScore.get(a.id) ?? 0) || a.id.localeCompare(b.id),
	);
	others.forEach((node, i) => {
		const similarity = clamp(seedScore.get(node.id) ?? 0, 0, 1);
		const ring = 120 + (1 - similarity) * 260;
		const angle = i * GOLDEN_ANGLE;
		node.x = Math.cos(angle) * ring;
		node.y = Math.sin(angle) * ring;
	});

	const velocityX = new Array<number>(nodes.length).fill(0);
	const velocityY = new Array<number>(nodes.length).fill(0);
	const restLength = new Map<string, number>();
	const springK = new Map<string, number>();
	for (const edge of edges) {
		const key = edgeKey(edge.source, edge.target);
		let rest = 88 + (1 - clamp(edge.weight, 0, 1)) * 200;
		let k = 0.025 + clamp(edge.weight, 0, 1) * 0.07;
		const community = communities?.get(edge.source);
		if (community !== undefined && community === communities?.get(edge.target)) {
			rest *= 0.32;
			k *= 2.8;
		}
		restLength.set(key, rest);
		springK.set(key, k);
	}

	for (let iter = 0; iter < iterations; iter++) {
		const alpha = 1 - iter / iterations;
		for (let i = 0; i < nodes.length; i++) velocityX[i] = 0;
		for (let i = 0; i < nodes.length; i++) velocityY[i] = 0;
		const centroids = communityCentroids(nodes, communities, seedId);

		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			if (!a) continue;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				if (!b) continue;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let dist2 = dx * dx + dy * dy;
				if (dist2 < 0.01) {
					dx = 0.15;
					dy = 0.1;
					dist2 = dx * dx + dy * dy;
				}
				const dist = Math.sqrt(dist2);
				const force = (alpha * 160 * (a.radius + b.radius)) / dist2;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				if (a.id !== seedId) {
					velocityX[i] = (velocityX[i] ?? 0) - fx;
					velocityY[i] = (velocityY[i] ?? 0) - fy;
				}
				if (b.id !== seedId) {
					velocityX[j] = (velocityX[j] ?? 0) + fx;
					velocityY[j] = (velocityY[j] ?? 0) + fy;
				}
			}
		}

		for (const edge of edges) {
			const ai = index.get(edge.source);
			const bi = index.get(edge.target);
			if (ai === undefined || bi === undefined) continue;
			const a = nodes[ai];
			const b = nodes[bi];
			if (!a || !b) continue;
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			const dist = Math.hypot(dx, dy) || 0.01;
			dx /= dist;
			dy /= dist;
			const key = edgeKey(edge.source, edge.target);
			const displacement = (dist - (restLength.get(key) ?? 180)) * (springK.get(key) ?? 0.04) * alpha;
			if (a.id !== seedId) {
				velocityX[ai] = (velocityX[ai] ?? 0) + dx * displacement;
				velocityY[ai] = (velocityY[ai] ?? 0) + dy * displacement;
			}
			if (b.id !== seedId) {
				velocityX[bi] = (velocityX[bi] ?? 0) - dx * displacement;
				velocityY[bi] = (velocityY[bi] ?? 0) - dy * displacement;
			}
		}

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node || node.id === seedId) continue;
			const pull = 0.04 * alpha;
			let vx = (velocityX[i] ?? 0) - node.x * pull;
			let vy = (velocityY[i] ?? 0) - node.y * pull;
			const community = communities?.get(node.id);
			const center = community === undefined ? undefined : centroids.get(community);
			if (center) {
				vx -= (node.x - center.x) * 0.14 * alpha;
				vy -= (node.y - center.y) * 0.14 * alpha;
			}
			vx *= 0.62;
			vy *= 0.62;
			const speed = Math.hypot(vx, vy);
			if (speed > 36) {
				vx = (vx / speed) * 36;
				vy = (vy / speed) * 36;
			}
			node.x = clamp(node.x + vx, -2400, 2400);
			node.y = clamp(node.y + vy, -2400, 2400);
		}

		separate(nodes, seedId);
	}
	if (communities) {
		compactCommunities(nodes, seedId, communities);
		for (let pass = 0; pass < 8; pass++) {
			reelInCommunities(nodes, seedId, communities);
			separateCommunities(nodes, seedId, communities);
			separate(nodes, seedId);
		}
	}
}

function separate(nodes: ForceNode[], seedId: string): void {
	for (let i = 0; i < nodes.length; i++) {
		const a = nodes[i];
		if (!a) continue;
		for (let j = i + 1; j < nodes.length; j++) {
			const b = nodes[j];
			if (!b) continue;
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			const dist = Math.hypot(dx, dy) || 0.01;
			const min = a.radius + b.radius + 12;
			if (dist >= min) continue;
			dx /= dist;
			dy /= dist;
			const push = (min - dist) / 2;
			if (a.id !== seedId) {
				a.x -= dx * (b.id === seedId ? push * 2 : push);
				a.y -= dy * (b.id === seedId ? push * 2 : push);
			}
			if (b.id !== seedId) {
				b.x += dx * (a.id === seedId ? push * 2 : push);
				b.y += dy * (a.id === seedId ? push * 2 : push);
			}
		}
	}
}

function communityCentroids(
	nodes: ForceNode[],
	communities: ReadonlyMap<string, number> | undefined,
	seedId: string,
): Map<number, { x: number; y: number }> {
	const sums = new Map<number, { x: number; y: number; n: number }>();
	if (!communities) return new Map();
	let seed: ForceNode | undefined;
	for (const node of nodes) {
		if (node.id === seedId) seed = node;
		const id = communities.get(node.id);
		if (id === undefined) continue;
		const acc = sums.get(id) ?? { x: 0, y: 0, n: 0 };
		acc.x += node.x;
		acc.y += node.y;
		acc.n += 1;
		sums.set(id, acc);
	}
	const out = new Map<number, { x: number; y: number }>();
	for (const [id, acc] of sums) out.set(id, { x: acc.x / acc.n, y: acc.y / acc.n });
	const seedCommunity = communities.get(seedId);
	if (seed && seedCommunity !== undefined) out.set(seedCommunity, { x: seed.x, y: seed.y });
	return out;
}

function compactCommunities(
	nodes: ForceNode[],
	seedId: string,
	communities: ReadonlyMap<string, number>,
): void {
	for (const pack of communityPacks(nodes, communities)) {
		const seed = pack.members.find((node) => node.id === seedId);
		const cx = seed?.x ?? pack.cx;
		const cy = seed?.y ?? pack.cy;
		const span = pack.members.reduce(
			(max, node) => Math.max(max, Math.hypot(node.x - cx, node.y - cy) + node.radius),
			0,
		);
		const target = Math.max(40, Math.sqrt(pack.members.length) * 16);
		if (span <= target) continue;
		const s = target / span;
		for (const node of pack.members) {
			if (node.id === seedId) continue;
			node.x = clamp(cx + (node.x - cx) * s, -2400, 2400);
			node.y = clamp(cy + (node.y - cy) * s, -2400, 2400);
		}
	}
}

function communityPacks(nodes: ForceNode[], communities: ReadonlyMap<string, number>): Array<{
	members: ForceNode[];
	cx: number;
	cy: number;
	radius: number;
}> {
	const groups = new Map<number, ForceNode[]>();
	for (const node of nodes) {
		const community = communities.get(node.id);
		if (community === undefined) continue;
		const group = groups.get(community) ?? [];
		group.push(node);
		groups.set(community, group);
	}
	return [...groups.values()]
		.filter((members) => members.length >= 2)
		.map((members) => {
			const cx = members.reduce((sum, node) => sum + node.x, 0) / members.length;
			const cy = members.reduce((sum, node) => sum + node.y, 0) / members.length;
			const radius = members.reduce((max, node) => Math.max(max, Math.hypot(node.x - cx, node.y - cy) + node.radius), 0);
			return { members, cx, cy, radius: radius + COMMUNITY_PAD };
		});
}

function separateCommunities(
	nodes: ForceNode[],
	seedId: string,
	communities: ReadonlyMap<string, number>,
): void {
	const packs = communityPacks(nodes, communities);
	for (let i = 0; i < packs.length; i++) {
		const a = packs[i]!;
		for (let j = i + 1; j < packs.length; j++) {
			const b = packs[j]!;
			let dx = b.cx - a.cx;
			let dy = b.cy - a.cy;
			const dist = Math.hypot(dx, dy) || 0.01;
			const min = a.radius + b.radius;
			if (dist >= min) continue;
			dx /= dist;
			dy /= dist;
			const push = (min - dist) / 2;
			shiftGroup(a.members, seedId, -dx * push, -dy * push);
			shiftGroup(b.members, seedId, dx * push, dy * push);
		}
	}
}

/** Pull groups that drifted past packing toward the seed; leave nearer groups alone. */
function reelInCommunities(
	nodes: ForceNode[],
	seedId: string,
	communities: ReadonlyMap<string, number>,
): void {
	const seedCommunity = communities.get(seedId);
	let core = 48;
	for (const node of nodes) {
		if (seedCommunity === undefined || communities.get(node.id) !== seedCommunity) continue;
		core = Math.max(core, Math.hypot(node.x, node.y) + node.radius);
	}
	for (const pack of communityPacks(nodes, communities)) {
		if (pack.members.some((node) => node.id === seedId)) continue;
		const dist = Math.hypot(pack.cx, pack.cy) || 0.01;
		const limit = core + pack.radius + FLY_SLACK;
		if (dist <= limit) continue;
		const scale = limit / dist - 1;
		shiftGroup(pack.members, seedId, pack.cx * scale, pack.cy * scale);
	}
}

function shiftGroup(members: readonly ForceNode[], seedId: string, dx: number, dy: number): void {
	for (const node of members) {
		if (node.id === seedId) continue;
		node.x = clamp(node.x + dx, -2400, 2400);
		node.y = clamp(node.y + dy, -2400, 2400);
	}
}

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
