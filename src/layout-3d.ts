import type { GraphEdge } from "./types";
import { clamp } from "./visual";

export interface ForceNode3D {
	id: string;
	x: number;
	y: number;
	z: number;
	radius: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Same similarity springs as the 2D map, relaxed in three dimensions.
 * The seed stays at the origin. Other papers start on a Fibonacci sphere
 * whose radius shrinks as similarity to the seed grows.
 */
export function runForceLayout3D(
	nodes: ForceNode3D[],
	edges: GraphEdge[],
	seedId: string,
	seedScore: Map<string, number>,
	iterations = 260,
): void {
	const index = new Map<string, number>();
	const others: ForceNode3D[] = [];
	for (const node of nodes) {
		index.set(node.id, index.size);
		if (node.id === seedId) {
			node.x = 0;
			node.y = 0;
			node.z = 0;
		} else {
			others.push(node);
		}
	}
	others.sort(
		(a, b) => (seedScore.get(b.id) ?? 0) - (seedScore.get(a.id) ?? 0) || a.id.localeCompare(b.id),
	);
	const count = Math.max(1, others.length);
	others.forEach((node, i) => {
		const similarity = clamp(seedScore.get(node.id) ?? 0, 0, 1);
		const ring = 90 + (1 - similarity) * 170;
		const yUnit = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
		const radial = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
		const theta = i * GOLDEN_ANGLE;
		node.x = Math.cos(theta) * radial * ring;
		node.y = yUnit * ring;
		node.z = Math.sin(theta) * radial * ring;
	});

	const velocityX = new Array<number>(nodes.length).fill(0);
	const velocityY = new Array<number>(nodes.length).fill(0);
	const velocityZ = new Array<number>(nodes.length).fill(0);
	const restLength = new Map<string, number>();
	const springK = new Map<string, number>();
	for (const edge of edges) {
		const key = edgeKey(edge.source, edge.target);
		restLength.set(key, 70 + (1 - clamp(edge.weight, 0, 1)) * 150);
		springK.set(key, 0.03 + clamp(edge.weight, 0, 1) * 0.08);
	}

	for (let iter = 0; iter < iterations; iter++) {
		const alpha = 1 - iter / iterations;
		velocityX.fill(0);
		velocityY.fill(0);
		velocityZ.fill(0);

		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			if (!a) continue;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				if (!b) continue;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let dz = b.z - a.z;
				let dist2 = dx * dx + dy * dy + dz * dz;
				if (dist2 < 0.01) {
					dx = 0.2;
					dy = 0.1;
					dz = 0.15;
					dist2 = dx * dx + dy * dy + dz * dz;
				}
				const dist = Math.sqrt(dist2);
				const force = (alpha * 140 * (a.radius + b.radius)) / dist2;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				const fz = (dz / dist) * force;
				if (a.id !== seedId) {
					velocityX[i] = (velocityX[i] ?? 0) - fx;
					velocityY[i] = (velocityY[i] ?? 0) - fy;
					velocityZ[i] = (velocityZ[i] ?? 0) - fz;
				}
				if (b.id !== seedId) {
					velocityX[j] = (velocityX[j] ?? 0) + fx;
					velocityY[j] = (velocityY[j] ?? 0) + fy;
					velocityZ[j] = (velocityZ[j] ?? 0) + fz;
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
			let dz = b.z - a.z;
			const dist = Math.hypot(dx, dy, dz) || 0.01;
			dx /= dist;
			dy /= dist;
			dz /= dist;
			const key = edgeKey(edge.source, edge.target);
			const displacement = (dist - (restLength.get(key) ?? 140)) * (springK.get(key) ?? 0.05) * alpha;
			if (a.id !== seedId) {
				velocityX[ai] = (velocityX[ai] ?? 0) + dx * displacement;
				velocityY[ai] = (velocityY[ai] ?? 0) + dy * displacement;
				velocityZ[ai] = (velocityZ[ai] ?? 0) + dz * displacement;
			}
			if (b.id !== seedId) {
				velocityX[bi] = (velocityX[bi] ?? 0) - dx * displacement;
				velocityY[bi] = (velocityY[bi] ?? 0) - dy * displacement;
				velocityZ[bi] = (velocityZ[bi] ?? 0) - dz * displacement;
			}
		}

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node || node.id === seedId) continue;
			const pull = 0.012 * alpha;
			let vx = ((velocityX[i] ?? 0) - node.x * pull) * 0.62;
			let vy = ((velocityY[i] ?? 0) - node.y * pull) * 0.62;
			let vz = ((velocityZ[i] ?? 0) - node.z * pull) * 0.62;
			const speed = Math.hypot(vx, vy, vz);
			if (speed > 32) {
				vx = (vx / speed) * 32;
				vy = (vy / speed) * 32;
				vz = (vz / speed) * 32;
			}
			node.x = clamp(node.x + vx, -900, 900);
			node.y = clamp(node.y + vy, -900, 900);
			node.z = clamp(node.z + vz, -900, 900);
		}
		separate(nodes, seedId);
	}
}

function separate(nodes: ForceNode3D[], seedId: string): void {
	for (let i = 0; i < nodes.length; i++) {
		const a = nodes[i];
		if (!a) continue;
		for (let j = i + 1; j < nodes.length; j++) {
			const b = nodes[j];
			if (!b) continue;
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			let dz = b.z - a.z;
			const dist = Math.hypot(dx, dy, dz) || 0.01;
			const min = a.radius + b.radius + 8;
			if (dist >= min) continue;
			dx /= dist;
			dy /= dist;
			dz /= dist;
			const push = (min - dist) / 2;
			if (a.id !== seedId) {
				const scale = b.id === seedId ? 2 : 1;
				a.x -= dx * push * scale;
				a.y -= dy * push * scale;
				a.z -= dz * push * scale;
			}
			if (b.id !== seedId) {
				const scale = a.id === seedId ? 2 : 1;
				b.x += dx * push * scale;
				b.y += dy * push * scale;
				b.z += dz * push * scale;
			}
		}
	}
}

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
