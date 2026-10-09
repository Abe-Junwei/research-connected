import { tr } from "./i18n";
import { authorYear } from "./labels";
import type { GraphEdge, PaperNode } from "./types";

/** Color priority: a direct citation, else co-citation, else shared references. */
export type RelationKind = "direct" | "cocitation" | "coupling" | "weak";

export const RELATION_COLOR: Record<RelationKind, number> = {
	direct: 0xd4a24a,
	cocitation: 0x2bb39a,
	coupling: 0x6f7ee0,
	weak: 0x7b8499,
};

export const RELATION_LABEL: Record<RelationKind, string> = {
	direct: tr("引用", "Citation"),
	cocitation: tr("共被引", "Co-citations"),
	coupling: tr("文献耦合", "Bibliographic coupling"),
	weak: tr("弱连线", "Weak link"),
};

export function relationKind(edge: GraphEdge): RelationKind {
	if (edge.direct !== "none") return "direct";
	if (edge.coCitedBy > 0) return "cocitation";
	if (edge.sharedRefs > 0 || edge.coupling > 0) return "coupling";
	return "weak";
}

export function findEdge(edges: readonly GraphEdge[], a: string, b: string): GraphEdge | null {
	for (const edge of edges) {
		if ((edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)) return edge;
	}
	return null;
}

/**
 * Why this edge exists. Citation direction uses author + year.
 * Every measured signal is included; the line color is only the sharpest one.
 */
export function explainRelation(
	edge: GraphEdge,
	source: Pick<PaperNode, "authors" | "year">,
	target: Pick<PaperNode, "authors" | "year">,
): string {
	const bits: string[] = [];
	const from = authorYear(source);
	const to = authorYear(target);
	if (edge.direct === "mutual") bits.push(tr(`${from} 与 ${to} 互相引用`, `${from} and ${to} cite each other`));
	else if (edge.direct === "source-cites-target") bits.push(tr(`${from} 引用了 ${to}`, `${from} cites ${to}`));
	else if (edge.direct === "target-cites-source") bits.push(tr(`${to} 引用了 ${from}`, `${to} cites ${from}`));
	if (edge.coCitedBy > 0) bits.push(tr(`共被引 ${edge.coCitedBy} 次`, `Co-cited ${edge.coCitedBy} times`));
	if (edge.sharedRefs > 0) bits.push(tr(`共享参考文献 ${edge.sharedRefs} 篇`, `Shared references: ${edge.sharedRefs} papers`));
	if (bits.length === 0) bits.push(tr("采样邻域里的弱连线", "Weak link within the sampled neighborhood"));
	const scoreLabel = edge.structuralSimilarity === null
		? tr("结构相似度不可用（当前缺少可比较数据）", "Structural similarity unavailable (no comparable data)")
		: edge.structuralSimilarity === undefined
			? tr(`图谱相近度 ${edge.weight.toFixed(2)}`, `Graph similarity ${edge.weight.toFixed(2)}`)
			: tr(`结构相似 ${edge.structuralSimilarity.toFixed(2)}`, `Structural similarity ${edge.structuralSimilarity.toFixed(2)}`);
	return `${bits.join(" · ")} · ${scoreLabel}`;
}
