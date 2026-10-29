import { syntheticGraph } from './perf-fixture';
import { readFileSync } from 'node:fs';
import { placeLayout, type LayoutMode } from '../src/layout-modes';
import { detectCommunities } from '../src/communities';
import { buildSimilarity } from '../src/similarity';
import type { GraphEdge, PaperNode } from '../src/types';
const path = process.argv[2];
const saved = path ? JSON.parse(readFileSync(path, 'utf8')) as {
  nodes: PaperNode[]; edges: GraphEdge[]; seedScore: Array<[string, number]>;
  catalog: PaperNode[]; referenceLists: Array<[string, string[]]>; coCitationContextIds: string[];
} : null;
const graph = saved ? { ...saved, seedScore: new Map(saved.seedScore) } : syntheticGraph(50, 42);
const nodes = graph.nodes, edges = graph.edges;
const victim = nodes.filter(n => !n.isSeed).map(n => n.id).sort()[0]!;
const missingNode = nodes.filter(n => n.id !== victim);
const cases = [
  { name: '原图重算', nodes, edges },
  { name: '移除每第十条边', nodes, edges: edges.filter((_, i) => (i + 1) % 10 !== 0) },
  { name: `移除节点 ${victim}`, nodes: missingNode, edges: edges.filter(e => e.source !== victim && e.target !== victim) },
];
if (saved) {
  const added = saved.catalog.filter(n => !nodes.some(p => p.id === n.id) && !n.isSeed).sort((a, b) => a.id.localeCompare(b.id))[0];
  const seed = nodes.find(n => n.isSeed);
  if (added && seed) {
    const references = new Map(saved.referenceLists.map(([id, refs]) => [id, new Set(refs)]));
    const candidate = buildSimilarity({ ids: [...nodes.map(n => n.id), added.id], seedId: seed.id, references, contexts: saved.coCitationContextIds.map(id => references.get(id) ?? new Set<string>()) });
    // This isolates one new node; it does not claim to reproduce a new retrieval.
    cases.push({ name: `加入目录节点 ${added.id}`, nodes: [...nodes, added], edges: [...edges, ...candidate.edges.filter(e => e.source === added.id || e.target === added.id)] });
    graph.seedScore.set(added.id, candidate.seedScore.get(added.id) ?? 0);
  }
}
function partitionDifference(a: Map<string, number>, b: Map<string, number>, ids: string[]): number {
  let changed = 0, total = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = ids[i]!, y = ids[j]!;
    total++;
    if ((a.get(x) === a.get(y)) !== (b.get(x) === b.get(y))) changed++;
  }
  return changed / total;
}
function nearest(placed: ReturnType<typeof placeLayout>, id: string, ids: Set<string>): Set<string> {
  const p = placed.find(n => n.id === id)!;
  return new Set(placed.filter(n => n.id !== id && ids.has(n.id))
    .sort((a, b) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(p.x - b.x, p.y - b.y) || a.id.localeCompare(b.id))
    .slice(0, 5).map(n => n.id));
}
function overlaps(placed: ReturnType<typeof placeLayout>): number {
  let count = 0;
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i]!, b = placed[j]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) count++;
  }
  return count;
}
function layout(mode: LayoutMode, n: PaperNode[], e: GraphEdge[]) {
  const at = performance.now();
  const placed = placeLayout(mode, n, e, graph.seedScore, 2026);
  return { placed, ms: performance.now() - at };
}
const groups = detectCommunities(nodes.map(n => n.id), edges);
const result = [];
for (const mode of ['force2d', 'temporal', 'radial'] as const) {
  const base = layout(mode, nodes, edges);
  for (const c of cases) {
    const next = layout(mode, c.nodes, c.edges);
    const original = new Set(nodes.map(n => n.id));
    const ids = c.nodes.map(n => n.id).filter(id => original.has(id)), eligible = new Set(ids);
    let shared = 0;
    for (const id of ids) {
      const a = nearest(base.placed, id, eligible), b = nearest(next.placed, id, eligible);
      shared += [...a].filter(v => b.has(v)).length / 5;
    }
    const g = detectCommunities(ids, c.edges);
    result.push({
      mode, case: c.name, nodes: c.nodes.length, comparedNodes: ids.length, edges: c.edges.length,
      neighborOverlap: +(shared / ids.length).toFixed(3),
      communityPairChange: +partitionDifference(groups, g, ids).toFixed(3),
      overlaps: overlaps(next.placed), baseOverlaps: overlaps(base.placed),
      ms: +next.ms.toFixed(1),
      sameCoordinates: next.placed.every(p => {
        const previous = base.placed.find(item => item.id === p.id);
        return previous?.x === p.x && previous.y === p.y;
      }),
    });
  }
}
if (result.some(row => row.case === '原图重算' && (!row.sameCoordinates || row.neighborOverlap !== 1 || row.communityPairChange !== 0))) throw new Error('identical input was not deterministic');
console.log(JSON.stringify({fixture:path ?? 'syntheticGraph(50, 42)',results:result}));
