import type { GraphEdge, PaperNode } from "./types";
import { detectCommunities } from "./communities";

const ns = "http://www.w3.org/2000/svg";
function shape<K extends keyof SVGElementTagNameMap>(svg: SVGSVGElement, tag: K, attrs: Record<string, string | number>, title?: string): SVGElementTagNameMap[K] {
	const node = document.createElementNS(ns, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	if (title) { const t = document.createElementNS(ns, "title"); t.textContent = title; node.append(t); }
	svg.append(node); return node;
}
function label(svg: SVGSVGElement, x: number, y: number, text: string, anchor = "start"): void {
	shape(svg, "text", { x, y, "text-anchor": anchor, fill: "currentColor", "font-size": 12 }).textContent = text;
}

/** Input edges have been normalized: source cites target; one entry per direction. */
export function drawFlows(svg: SVGSVGElement, nodes: PaperNode[], edges: GraphEdge[], mode: "sankey" | "chord", onPick: (papers: PaperNode[]) => void): void {
	if (!edges.length) { label(svg, 30, 60, "当前范围没有已确认的直接引用。"); return; }
	const byId = new Map(nodes.map(n => [n.id, n]));
	const communities = detectCommunities(nodes.map(n => n.id), edges);
	const group = (id: string): string => mode === "sankey"
		? (byId.get(id)?.year == null ? "年份未知" : `${Math.floor(byId.get(id)!.year! / 10) * 10}年代`)
		: `社区 ${Math.min(communities.get(id) ?? 0, 11) + 1}`;
	const matrix = new Map<string, { a: string; b: string; count: number; ids: Set<string> }>();
	for (const edge of edges) {
		let a = group(edge.source), b = group(edge.target);
		if (mode === "chord" && a > b) [a, b] = [b, a];
		const key = a + "\0" + b;
		const row = matrix.get(key) ?? { a, b, count: 0, ids: new Set<string>() };
		row.count++; row.ids.add(edge.source); row.ids.add(edge.target); matrix.set(key, row);
	}
	const rows = [...matrix.values()];
	const choose = (element: SVGElement, ids: Set<string>): void => {
		element.style.cursor = "pointer";
		element.setAttribute("tabindex", "0");
		element.setAttribute("role", "button");
		const run = () => onPick(nodes.filter(n => ids.has(n.id)));
		element.addEventListener("click", run);
		element.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); } });
	};
	if (mode === "sankey") {
		label(svg, 25, 25, "施引论文 → 被引用论文（带宽 = 引用数）");
		const left = [...new Set(rows.map(r => r.a))].sort(), right = [...new Set(rows.map(r => r.b))].sort();
		const scale = (340 - Math.max(left.length, right.length) * 8) / edges.length;
		const positions = (groups: string[], side: "a" | "b", x: number) => {
			let y = 55; const result = new Map<string, number>();
			for (const g of groups) {
				const count = rows.filter(r => r[side] === g).reduce((n, r) => n + r.count, 0);
				result.set(g, y); shape(svg, "rect", { x, y, width: 12, height: count * scale, fill: "#6970d8" }, `${g}：${count} 条引用`);
				label(svg, side === "a" ? x - 5 : x + 18, y + count * scale / 2 + 4, g, side === "a" ? "end" : "start");
				y += count * scale + 8;
			} return result;
		};
		const l = positions(left, "a", 120), r = positions(right, "b", 610);
		for (const row of rows) {
			const y1 = l.get(row.a)!, y2 = r.get(row.b)!, h = row.count * scale;
			const band = shape(svg, "path", { d: `M132,${y1} C330,${y1} 430,${y2} 610,${y2} L610,${y2+h} C430,${y2+h} 330,${y1+h} 132,${y1+h} Z`, fill: "#b99850", opacity: 0.55 }, `${row.a} → ${row.b}：${row.count} 条引用，点击查看论文`);
			choose(band, row.ids); l.set(row.a, y1 + h); r.set(row.b, y2 + h);
		}
	} else {
		label(svg, 25, 25, "社区引用关系（弦宽 = 引用数，合并两个方向）");
		const groups = [...new Set(rows.flatMap(r => [r.a, r.b]))].sort();
		const gap = 0.07, unit = (2 * Math.PI - groups.length * gap) / (edges.length * 2);
		const at = (angle: number) => `${380 + Math.cos(angle) * 150},${225 + Math.sin(angle) * 150}`;
		const cursor = new Map<string, number>(); let angle = -Math.PI / 2;
		for (const g of groups) {
			const size = rows.reduce((n, r) => n + (r.a === g ? r.count : 0) + (r.b === g ? r.count : 0), 0);
			cursor.set(g, angle); const end = angle + size * unit;
			shape(svg, "path", { d: `M${at(angle)} A150,150 0 ${end-angle > Math.PI ? 1 : 0},1 ${at(end)}`, fill: "none", stroke: "#6970d8", "stroke-width": 12 }, g);
			const mid = (angle + end) / 2; label(svg, 380 + Math.cos(mid) * 190, 225 + Math.sin(mid) * 175, g, "middle");
			angle = end + gap;
		}
		for (const row of rows) {
			const a = cursor.get(row.a)!, ae = a + row.count * unit; cursor.set(row.a, ae);
			const b = cursor.get(row.b)!, be = b + row.count * unit; cursor.set(row.b, be);
			const ribbon = shape(svg, "path", { d: `M${at(a)} A150,150 0 ${ae-a > Math.PI ? 1 : 0},1 ${at(ae)} Q380,225 ${at(b)} A150,150 0 ${be-b > Math.PI ? 1 : 0},1 ${at(be)} Q380,225 ${at(a)} Z`, fill: "#5c9e9b", opacity: 0.5 }, `${row.a} ↔ ${row.b}：${row.count} 条引用`);
			choose(ribbon, row.ids);
		}
	}
}
