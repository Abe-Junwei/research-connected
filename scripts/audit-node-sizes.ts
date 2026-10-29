import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { classicCandidates } from "../src/aggregates";
import { yearNormalizedCitations } from "../src/visual";
import type { GraphEdge, PaperNode } from "../src/types";

const citationRadius = (count: number, min: number, max: number, seed: boolean) => {
 const lo = Math.sqrt(Math.max(0, min)), hi = Math.sqrt(Math.max(max, min, 0));
 const t = hi === 0 ? 0 : hi - lo < 1e-9 ? 0.5 : Math.min(1, Math.max(0, (Math.sqrt(Math.max(0, count)) - lo) / (hi - lo)));
 return Math.max(seed ? 11 : 4, 4 + 10 * t);
};
const path = process.argv[2];
if (!path) throw new Error("Provide a sanitized graph snapshot path");
const graph = JSON.parse(readFileSync(path, "utf8")) as {
	nodes: PaperNode[]; edges: GraphEdge[]; referenceLists: Array<[string, string[]]>;
};
const nodes = graph.nodes;
if (!nodes.length || nodes.some(n => !Number.isFinite(n.citedByCount) || n.citedByCount < 0)) throw new Error("Snapshot needs nonnegative numeric citation counts");
const ordinary = nodes.filter(n => !n.isSeed);
const counts = ordinary.map(n => n.citedByCount).sort((a, b) => a - b);
const min = counts[0] ?? 0;
const max = counts.at(-1) ?? 0;
const p95 = counts.length >= 20 ? counts[Math.ceil(counts.length * 0.95) - 1]! : max;
const norms = nodes.map(n => yearNormalizedCitations(n.citedByCount, n.year, 2026));
const lo = Math.min(...norms), hi = Math.max(...norms);
const cumulativeRadius = (count: number, lower: number, upper: number, seed: boolean) => {
	const lowerLog = Math.log1p(lower), upperLog = Math.log1p(upper);
	const t = upperLog === 0 ? 0 : upperLog === lowerLog ? 0.5 : Math.min(1, Math.max(0, (Math.log1p(count) - lowerLog) / (upperLog - lowerLog)));
	return Math.max(seed ? 11 : 4, 4 + 10 * t);
};
assert.equal(cumulativeRadius(0, 0, 0, false), 4);
assert.equal(cumulativeRadius(100, 100, 100, false), 9);
assert.equal(cumulativeRadius(0, 0, 0, true), 11);
const classics = classicCandidates(nodes, graph.edges, 2026, new Map(graph.referenceLists));
const round = (n: number) => Math.round(n * 100) / 100;
const rows = nodes.map((node, i) => ({
	id: node.id, seed: node.isSeed, year: node.year, citations: node.citedByCount,
	annual: round(norms[i]!), annualRank: node.isSeed ? null : 1 + ordinary.filter(n => yearNormalizedCitations(n.citedByCount, n.year, 2026) > norms[i]!).length,
	citationRank: node.isSeed ? null : 1 + ordinary.filter(n => n.citedByCount > node.citedByCount).length,
	current: round(citationRadius(norms[i]!, lo, hi, node.isSeed)),
	log: round(cumulativeRadius(node.citedByCount, min, max, node.isSeed)),
	p95: round(cumulativeRadius(node.citedByCount, min, p95, node.isSeed)),
	classic: classics.get(node.id) ?? null,
}));
for (const a of rows.filter(row => !row.seed)) for (const b of rows.filter(row => !row.seed)) {
	if (a.citations > b.citations) assert.ok(a.log >= b.log && a.p95 >= b.p95, "cumulative sizes must be monotonic");
}
assert.ok(rows.every(row => [row.current, row.log, row.p95].every(Number.isFinite)), "all reported radii must be finite");
console.log(JSON.stringify({nodes: nodes.length, ordinary: ordinary.length, min, max, p95, p95Saturated: ordinary.filter(n => n.citedByCount >= p95).length, classicCount: classics.size, missingYear: nodes.filter(n => n.year === null).length, rows}, null, 2));
