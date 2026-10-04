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
	direct: "引用",
	cocitation: "共被引",
	coupling: "文献耦合",
	weak: "弱连线",
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
	if (edge.direct === "mutual") bits.push(`${from} 与 ${to} 互相引用`);
	else if (edge.direct === "source-cites-target") bits.push(`${from} 引用了 ${to}`);
	else if (edge.direct === "target-cites-source") bits.push(`${to} 引用了 ${from}`);
	if (edge.coCitedBy > 0) bits.push(`共被引 ${edge.coCitedBy} 次`);
	if (edge.sharedRefs > 0) bits.push(`共享参考文献 ${edge.sharedRefs} 篇`);
	if (bits.length === 0) bits.push("采样邻域里的弱连线");
	const scoreLabel = edge.structuralSimilarity === null
		? "结构相似度不可用（当前缺少可比较数据）"
		: edge.structuralSimilarity === undefined
			? `图谱相近度 ${edge.weight.toFixed(2)}`
			: `结构相似 ${edge.structuralSimilarity.toFixed(2)}`;
	return `${bits.join(" · ")} · ${scoreLabel}`;
}
