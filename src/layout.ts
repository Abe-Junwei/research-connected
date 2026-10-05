import type { GraphEdge } from "./types";
import { clamp } from "./visual";
import { compactPack } from "./community-regions";

export interface ForceNode {
	id: string;
	x: number;
	y: number;
	radius: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Place the seed at the origin and other papers on a similarity spiral, then
 * relax springs (shorter when the score is higher), repulsion, and collision.
 * The seed stays pinned for the simulation so the map remains centered on it.
 * When `communities` is given, same-community springs tighten and different
 * community packs are pushed apart so their enclosing circles stay separated.
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
		// 同社区边更短更紧：让检测出的群落在平面上保持可分辨的团聚。
		const communityA = communities?.get(edge.source);
		if (communityA !== undefined && communityA === communities?.get(edge.target)) {
			rest *= 0.45;
			k *= 2.2;
		}
		restLength.set(key, rest);
		springK.set(key, k);
	}

	for (let iter = 0; iter < iterations; iter++) {
		const alpha = 1 - iter / iterations;
		for (let i = 0; i < nodes.length; i++) velocityX[i] = 0;
		for (let i = 0; i < nodes.length; i++) velocityY[i] = 0;

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
			const pull = 0.01 * alpha;
			let vx = (velocityX[i] ?? 0) - node.x * pull;
			let vy = (velocityY[i] ?? 0) - node.y * pull;
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
		if (communities && communities.size > 1) separateCommunities(nodes, seedId, communities);
	}
	if (communities && communities.size > 1) {
		for (let n = 0; n < 32; n++) separateCommunities(nodes, seedId, communities);
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

/** 社区外接圆互斥：不同圈子的质心至少相距 r1+r2+gap，对应旧圈层的社区间距。 */
export function separateCommunities(
	nodes: ForceNode[],
	seedId: string,
	communities: ReadonlyMap<string, number>,
	gap = 96,
): void {
	const groups = new Map<number, ForceNode[]>();
	for (const node of nodes) {
		const community = communities.get(node.id);
		if (community === undefined) continue;
		const group = groups.get(community) ?? [];
		group.push(node);
		groups.set(community, group);
	}
	if (groups.size < 2) return;
	const packs = [...groups.values()].map((members) => {
		const pack = compactPack(members, 24);
		const extra = members.reduce((max, node) => Math.max(max, node.radius), 0);
		return { members, cx: pack.cx, cy: pack.cy, radius: pack.radius + extra, mobile: members.filter((node) => node.id !== seedId) };
	});
	for (let i = 0; i < packs.length; i++) {
		const a = packs[i]!;
		for (let j = i + 1; j < packs.length; j++) {
			const b = packs[j]!;
			let dx = b.cx - a.cx;
			let dy = b.cy - a.cy;
			const dist = Math.hypot(dx, dy) || 0.01;
			const min = a.radius + b.radius + gap;
			if (dist >= min) continue;
			dx /= dist;
			dy /= dist;
			const overlap = min - dist;
			const pushA = a.mobile.length ? (b.mobile.length ? overlap / 2 : overlap) : 0;
			const pushB = b.mobile.length ? (a.mobile.length ? overlap / 2 : overlap) : 0;
			for (const node of a.mobile) {
				node.x -= dx * pushA;
				node.y -= dy * pushA;
			}
			for (const node of b.mobile) {
				node.x += dx * pushB;
				node.y += dy * pushB;
			}
			a.cx -= dx * pushA;
			a.cy -= dy * pushA;
			b.cx += dx * pushB;
			b.cy += dy * pushB;
		}
	}
}

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
