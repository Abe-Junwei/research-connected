import { communityColor, communityRgba, detectCommunities } from "./communities";
import { buildCommunityRegions } from "./community-regions";
import { focusNodes, strengthTier } from "./graph-filter";
import { authorYear } from "./labels";
import type { ColorMode, LayoutMode } from "./layout-modes";
import { placeLayout } from "./layout-modes";
import { RELATION_COLOR, relationKind, type RelationKind } from "./relation";
import type { GraphEdge, PaperNode } from "./types";
import { clamp, yearColor } from "./visual";

interface DrawNode extends PaperNode {
	x: number;
	y: number;
	radius: number;
	color: string;
	shown: boolean;
}

type Drag =
	| { kind: "pan"; px: number; py: number; tx: number; ty: number }
	| { kind: "node"; id: string; dx: number; dy: number };

/**
 * Canvas similarity map: pan, zoom, drag, hover title, click to select.
 * Layout is computed up front; dragging moves one node and does not reheat the sim.
 */
export class SimilarityMap {
	onSelect: ((paper: PaperNode | null) => void) | null = null;
	onEdgeSelect: ((edge: GraphEdge) => void) | null = null;

	private ctx: CanvasRenderingContext2D | null = null;
	private nodes: DrawNode[] = [];
	private edges: GraphEdge[] = [];
	private maxWeight = 1;
	private tx = 0;
	private ty = 0;
	private k = 1;
	private cssWidth = 1;
	private cssHeight = 1;
	private selectedId: string | null = null;
	private hoverId: string | null = null;
	private focus: Set<string> | null = null;
	private focusPath = true;
	private kindVisible: Record<RelationKind, boolean> = { direct: true, cocitation: true, coupling: true, weak: false };
	private dragging: Drag | null = null;
	private moved = false;
	private downX = 0;
	private downY = 0;
	private fontFamily = "sans-serif";
	private alive = true;
	private adjusted = false;
	private pointers = new Map<number, { x: number; y: number }>();
	private pinch: { startDist: number; k: number; wx: number; wy: number } | null = null;
	private coarse: boolean | null = null;
	private bgStart = "#171c28";
	private bgEnd = "#0b0d12";
	private layoutMode: LayoutMode = "force2d";
	private colorMode: ColorMode = "community";
	private scrubYear: number | null = null;
	private seedScore = new Map<string, number>();
	private communities = new Map<string, number>();
	private minYear = 0;
	private maxYear = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly tooltip: HTMLElement,
		private readonly stage: HTMLElement,
	) {
		this.onPointerDown = this.onPointerDown.bind(this);
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
		this.onWheel = this.onWheel.bind(this);
		this.onPointerLeave = this.onPointerLeave.bind(this);
		this.onKeyDown = this.onKeyDown.bind(this);
		canvas.tabIndex = 0;
		// Optional-call: the headless verify script stubs a bare canvas object.
		canvas.setAttribute?.("role", "application");
		if (!canvas.getAttribute?.("aria-label")) {
			canvas.setAttribute?.("aria-label", "论文相似度图谱：方向键平移，+/- 缩放，0 或 F 适配");
		}
		canvas.addEventListener("pointerdown", this.onPointerDown);
		canvas.addEventListener("pointermove", this.onPointerMove);
		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		canvas.addEventListener("pointerleave", this.onPointerLeave);
		canvas.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("pointercancel", this.onPointerUp);
	}

	setGraph(nodes: PaperNode[], edges: GraphEdge[], seedScore: Map<string, number>): void {
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.layoutMode = "force2d";
		this.scrubYear = null;
		this.colorMode = "community";
		this.rebuild(nodes, true);
	}

	/**
	 * Swap in enriched edges (e.g. OpenCitations gap-filling) without touching
	 * layout mode, color mode, scrub year, node positions, or the view transform.
	 */
	updateGraphData(edges: GraphEdge[]): void {
		this.edges = edges;
		this.communities = detectCommunities(this.nodes.map((node) => node.id), edges);
		this.maxWeight = edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.recolor();
		this.refreshFocus();
		this.draw();
	}

	/** Edge-type visibility for the 2D panel. Weak links start hidden. */
	setKinds(kinds: Record<RelationKind, boolean>): void {
		this.kindVisible = { ...kinds };
		this.refreshFocus();
		this.draw();
	}

	setLayout(mode: LayoutMode): void {
		this.layoutMode = mode === "force3d" ? "force2d" : mode;
		this.stage.classList?.toggle("cpo-kumu-view", this.layoutMode === "kumu");
		const canvasStyles = typeof getComputedStyle === "function" ? getComputedStyle(this.canvas) : null;
		this.bgStart = this.layoutMode === "kumu" ? "#fbfaf7" : themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-start") ?? "", "#171c28");
		this.bgEnd = this.layoutMode === "kumu" ? "#f1eee8" : themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-end") ?? "", "#0b0d12");
		this.rebuild(this.nodes, false);
	}

	setColorMode(mode: ColorMode): void {
		this.colorMode = mode;
		this.recolor();
		this.draw();
	}

	setScrubYear(year: number | null): void {
		this.scrubYear = year;
		for (const node of this.nodes) node.shown = this.isShown(node);
		this.draw();
	}

	/** True after the user pans, zooms, or drags. Automatic resizes only refit before that. */
	hasAdjusted(): boolean {
		return this.adjusted;
	}

	/** Community assignment behind node colors; recomputed by setGraph and updateGraphData. */
	getCommunities(): ReadonlyMap<string, number> {
		return this.communities;
	}

	setSelected(id: string | null): void {
		this.selectedId = id;
		this.refreshFocus();
		this.draw();
	}

	/** Whether the focus highlight also keeps the shortest visible path to the seed. */
	setFocusPath(on: boolean): void {
		this.focusPath = on;
		this.refreshFocus();
		this.draw();
	}

	/** One-hop neighborhood of the hovered (else selected) node, plus the path to the seed when enabled. */
	private refreshFocus(): void {
		const id = this.hoverId ?? this.selectedId;
		const seedId = this.nodes.find((node) => node.isSeed)?.id ?? "";
		this.focus = id
			? focusNodes(id, seedId, this.edges, (edge) => this.kindVisible[relationKind(edge)], this.focusPath)
			: null;
	}

	resize(): void {
		const rect = this.stage.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, rect.width);
		const height = Math.max(1, rect.height);
		this.cssWidth = width;
		this.cssHeight = height;
		this.canvas.width = Math.round(width * dpr);
		this.canvas.height = Math.round(height * dpr);
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		this.ctx = ctx;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.fontFamily = getComputedStyle(this.stage).fontFamily || "sans-serif";
		const canvasStyles = getComputedStyle(this.canvas);
		this.bgStart = this.layoutMode === "kumu" ? "#fbfaf7" : themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-start"), "#171c28");
		this.bgEnd = this.layoutMode === "kumu" ? "#f1eee8" : themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-end"), "#0b0d12");
		this.draw();
	}

	zoomBy(factor: number): void {
		this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, factor);
	}

	fit(fromUser = false): void {
		if (fromUser) this.adjusted = false;
		if (this.nodes.length === 0) return;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const node of this.nodes) {
			minX = Math.min(minX, node.x - node.radius);
			minY = Math.min(minY, node.y - node.radius);
			maxX = Math.max(maxX, node.x + node.radius);
			maxY = Math.max(maxY, node.y + node.radius);
		}
		const boundsWidth = Math.max(1, maxX - minX);
		const boundsHeight = Math.max(1, maxY - minY);
		const padding = 64;
		this.k = clamp(
			Math.min((this.cssWidth - padding * 2) / boundsWidth, (this.cssHeight - padding * 2) / boundsHeight),
			0.2,
			2.4,
		);
		this.tx = this.cssWidth / 2 - ((minX + maxX) / 2) * this.k;
		this.ty = this.cssHeight / 2 - ((minY + maxY) / 2) * this.k;
		this.draw();
	}

	destroy(): void {
		this.alive = false;
		this.pointers.clear();
		this.pinch = null;
		this.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.canvas.removeEventListener("pointermove", this.onPointerMove);
		this.canvas.removeEventListener("wheel", this.onWheel);
		this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
		this.canvas.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("pointercancel", this.onPointerUp);
		this.hideTooltip();
	}

	private zoomAt(sx: number, sy: number, factor: number): void {
		this.adjusted = true;
		const next = clamp(this.k * factor, 0.25, 4);
		const world = this.screenToWorld(sx, sy);
		this.k = next;
		this.tx = sx - world.x * this.k;
		this.ty = sy - world.y * this.k;
		this.draw();
	}

	private onWheel(event: WheelEvent): void {
		if (!this.alive) return;
		event.preventDefault();
		const local = this.localPoint(event.clientX, event.clientY);
		const factor = Math.exp(-event.deltaY * 0.0012);
		this.zoomAt(local.x, local.y, factor);
	}

	private onPointerDown(event: PointerEvent): void {
		if (!this.alive) return;
		this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		try {
			this.canvas.setPointerCapture(event.pointerId);
		} catch {
			// The pointer can vanish before capture; dragging still tracks window pointerup.
		}
		if (this.pointers.size >= 2) {
			// Second finger down: pinch zoom takes over, single-pointer drag is cancelled.
			this.startPinch();
			this.dragging = null;
			this.moved = true;
			this.hideTooltip();
			return;
		}
		const local = this.localPoint(event.clientX, event.clientY);
		const hit = this.hit(local.x, local.y);
		this.moved = false;
		this.downX = event.clientX;
		this.downY = event.clientY;
		if (hit) {
			const world = this.screenToWorld(local.x, local.y);
			this.dragging = { kind: "node", id: hit.id, dx: hit.x - world.x, dy: hit.y - world.y };
		} else {
			this.dragging = { kind: "pan", px: local.x, py: local.y, tx: this.tx, ty: this.ty };
		}
	}

	private startPinch(): void {
		const points = [...this.pointers.values()];
		const a = points[0];
		const b = points[1];
		if (!a || !b) return;
		const mid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
		const world = this.screenToWorld(mid.x, mid.y);
		this.pinch = {
			startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
			k: this.k,
			wx: world.x,
			wy: world.y,
		};
	}

	private movePinch(): void {
		const pinch = this.pinch;
		if (!pinch) return;
		const points = [...this.pointers.values()];
		const a = points[0];
		const b = points[1];
		if (!a || !b) return;
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		if (dist <= 0) return;
		const mid = this.localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
		this.k = clamp(pinch.k * (dist / pinch.startDist), 0.25, 4);
		this.tx = mid.x - pinch.wx * this.k;
		this.ty = mid.y - pinch.wy * this.k;
		this.moved = true;
		this.adjusted = true;
		this.hideTooltip();
		this.draw();
	}

	private onPointerMove(event: PointerEvent): void {
		if (!this.alive) return;
		if (this.pointers.has(event.pointerId)) {
			this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (this.pinch) {
			this.movePinch();
			return;
		}
		const local = this.localPoint(event.clientX, event.clientY);
		const dragging = this.dragging;
		if (!dragging) {
			const hit = this.hit(local.x, local.y);
			const nextHover = hit?.id ?? null;
			if (nextHover !== this.hoverId) {
				this.hoverId = nextHover;
				this.refreshFocus();
				this.draw();
			}
			this.canvas.style.cursor = hit ? "pointer" : "grab";
			this.placeTooltip(hit, local.x, local.y);
			return;
		}
		if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 4) {
			this.moved = true;
			this.adjusted = true;
		}
		if (dragging.kind === "pan") {
			this.tx = dragging.tx + (local.x - dragging.px);
			this.ty = dragging.ty + (local.y - dragging.py);
			this.canvas.style.cursor = "grabbing";
		} else {
			const node = this.nodes.find((item) => item.id === dragging.id);
			if (node) {
				const world = this.screenToWorld(local.x, local.y);
				node.x = world.x + dragging.dx;
				node.y = world.y + dragging.dy;
			}
			this.canvas.style.cursor = "grabbing";
		}
		this.hideTooltip();
		this.draw();
	}

	private onPointerUp(event: PointerEvent): void {
		if (!this.alive) return;
		this.pointers.delete(event.pointerId);
		if (this.pinch) {
			if (this.pointers.size >= 2) return;
			this.pinch = null;
			this.canvas.style.cursor = "grab";
			// One finger still down: resume panning from its current spot, no click fires.
			const remaining = this.pointers.values().next().value;
			if (remaining) {
				const local = this.localPoint(remaining.x, remaining.y);
				this.dragging = { kind: "pan", px: local.x, py: local.y, tx: this.tx, ty: this.ty };
				this.downX = remaining.x;
				this.downY = remaining.y;
				this.moved = true;
			}
			return;
		}
		const dragging = this.dragging;
		const wasDrag = this.moved;
		this.dragging = null;
		if (!dragging || wasDrag) {
			this.canvas.style.cursor = "grab";
			return;
		}
		if (dragging.kind === "node") {
			const node = this.nodes.find((item) => item.id === dragging.id) ?? null;
			this.selectedId = node?.id ?? null;
			this.onSelect?.(node);
		} else {
			const local = this.localPoint(this.downX, this.downY);
			const p = this.screenToWorld(local.x, local.y);
			let closest: GraphEdge | null = null, distance = 7 / this.k;
			for (const edge of this.edges) {
				if (!this.kindVisible[relationKind(edge)]) continue;
				const a = this.nodes.find(n => n.id === edge.source), b = this.nodes.find(n => n.id === edge.target);
				if (!a || !b || (this.scrubYear !== null && (a.year === null || b.year === null || a.year > this.scrubYear || b.year > this.scrubYear))) continue;
				const dx = b.x-a.x, dy = b.y-a.y;
				const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
				const d = Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
				if (d < distance) { distance = d; closest = edge; }
			}
			if (closest && this.onEdgeSelect) { this.onEdgeSelect(closest); return; }
			this.selectedId = null;
			this.onSelect?.(null);
		}
		this.draw();
	}

	private onPointerLeave(): void {
		if (this.dragging) return;
		this.hoverId = null;
		this.refreshFocus();
		this.hideTooltip();
		this.draw();
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!this.alive) return;
		const panStep = 48;
		const key = event.key;
		if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
			event.preventDefault();
			this.tx += key === "ArrowLeft" ? panStep : key === "ArrowRight" ? -panStep : 0;
			this.ty += key === "ArrowUp" ? panStep : key === "ArrowDown" ? -panStep : 0;
			this.adjusted = true;
			this.draw();
			return;
		}
		if (key === "+" || key === "=") {
			event.preventDefault();
			this.zoomBy(1.2);
			return;
		}
		if (key === "-" || key === "_") {
			event.preventDefault();
			this.zoomBy(1 / 1.2);
			return;
		}
		if (key === "0" || key === "f" || key === "F") {
			event.preventDefault();
			this.fit(true);
		}
	}

	private placeTooltip(node: DrawNode | null, x: number, y: number): void {
		if (!node) {
			this.hideTooltip();
			return;
		}
		this.tooltip.hidden = false;
		this.tooltip.textContent = node.title;
		const width = this.tooltip.offsetWidth || 180;
		const height = this.tooltip.offsetHeight || 32;
		const left = x + width + 16 > this.cssWidth ? Math.max(8, x - width - 12) : x + 14;
		const top = y + height + 16 > this.cssHeight ? Math.max(8, y - height - 10) : y + 14;
		this.tooltip.style.left = `${left}px`;
		this.tooltip.style.top = `${top}px`;
	}

	private hideTooltip(): void {
		this.tooltip.hidden = true;
		this.tooltip.textContent = "";
	}

	private hit(sx: number, sy: number): DrawNode | null {
		const world = this.screenToWorld(sx, sy);
		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const node = this.nodes[i];
			if (!node || !node.shown) continue;
			const dx = world.x - node.x;
			const dy = world.y - node.y;
			const reach = node.radius + (this.isCoarsePointer() ? 12 : 4);
			if (dx * dx + dy * dy <= reach * reach) return node;
		}
		return null;
	}

	private isCoarsePointer(): boolean {
		if (this.coarse !== null) return this.coarse;
		try {
			this.coarse =
				typeof window !== "undefined" && typeof window.matchMedia === "function"
					? window.matchMedia("(pointer: coarse)").matches
					: false;
		} catch {
			this.coarse = false;
		}
		return this.coarse;
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return { x: (sx - this.tx) / this.k, y: (sy - this.ty) / this.k };
	}

	private localPoint(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	private draw(): void {
		const ctx = this.ctx;
		if (!ctx || !this.alive) return;
		const width = this.cssWidth;
		const height = this.cssHeight;
		const background = ctx.createRadialGradient(
			width / 2,
			height / 2,
			40,
			width / 2,
			height / 2,
			Math.max(width, height) * 0.72,
		);
		background.addColorStop(0, this.bgStart);
		background.addColorStop(1, this.bgEnd);
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, width, height);
		if (this.layoutMode === "kumu") this.drawCommunityRegions(ctx, false);

		const byId = new Map(this.nodes.map((node) => [node.id, node]));
		const focus = this.focus;
		ctx.lineCap = "round";
		for (const edge of this.edges) {
			const a = byId.get(edge.source);
			const b = byId.get(edge.target);
			if (!a || !b || !a.shown || !b.shown) continue;
			const kind = relationKind(edge);
			if (!this.kindVisible[kind]) continue;
			const tier = strengthTier(edge);
			let width = this.layoutMode === "kumu" ? 1 : tier === "strong" ? 2.8 : tier === "mid" ? 1.7 : 0.85;
			let alpha = this.layoutMode === "kumu" ? 0.3 : kind === "weak" ? 0.35 : 0.8;
			let dimmed = false;
			if (focus && !(focus.has(edge.source) && focus.has(edge.target))) {
				dimmed = true;
				alpha = 0.07;
				width *= 0.6;
			}
			const ax = a.x * this.k + this.tx;
			const ay = a.y * this.k + this.ty;
			const bx = b.x * this.k + this.tx;
			const by = b.y * this.k + this.ty;
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.strokeStyle = hexRgba(RELATION_COLOR[kind], alpha);
			ctx.lineWidth = width;
			ctx.stroke();
			if (kind !== "direct" || dimmed || this.layoutMode === "kumu") continue;
			ctx.fillStyle = hexRgba(RELATION_COLOR.direct, 0.95);
			if (edge.direct === "source-cites-target" || edge.direct === "mutual") strokeArrow(ctx, ax, ay, bx, by, b.radius * this.k);
			if (edge.direct === "target-cites-source" || edge.direct === "mutual") strokeArrow(ctx, bx, by, ax, ay, a.radius * this.k);
		}
		if (this.layoutMode === "kumu") this.drawCommunityRegions(ctx, true);

		const ordered = [...this.nodes].sort((a, b) => a.radius - b.radius || (a.isSeed ? 1 : 0) - (b.isSeed ? 1 : 0));
		for (const node of ordered) {
			if (node.shown) this.drawNode(ctx, node);
		}
		this.drawLabels(ctx);
	}

	private drawCommunityRegions(ctx: CanvasRenderingContext2D, labelsOnly: boolean): void {
		const regions = buildCommunityRegions(
			this.nodes.map((node) => ({
				id: node.id,
				community: this.communities.get(node.id) ?? 0,
				x: node.x * this.k + this.tx,
				y: node.y * this.k + this.ty,
				shown: node.shown,
			})),
			Math.max(18, Math.min(32, 24 * this.k)),
		);
		ctx.save();
		for (const region of regions) {
			if (region.points.length < 3) continue;
			const color = communityRgba(region.community, 1);
			if (!labelsOnly) {
				const first = region.points[0]!;
				const last = region.points[region.points.length - 1]!;
				ctx.beginPath();
				ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
				for (let i = 0; i < region.points.length; i++) {
					const point = region.points[i]!;
					const next = region.points[(i + 1) % region.points.length]!;
					ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
				}
				ctx.closePath();
				ctx.fillStyle = color.replace(", 1)", ", 0.07)");
				ctx.strokeStyle = color.replace(", 1)", ", 0.30)");
				ctx.lineWidth = 1.2;
				ctx.fill();
				ctx.stroke();
			}

			const label = `相似性社区 ${region.community + 1}`;
			ctx.font = `11px ${this.fontFamily}`;
			const labelWidth = ctx.measureText(label).width + 14;
			const x = Math.max(6, Math.min(this.cssWidth - labelWidth - 6, region.left + 6));
			const y = Math.max(8, Math.min(this.cssHeight - 22, region.top + 8));
			ctx.fillStyle = color.replace(", 1)", ", 0.16)");
			ctx.beginPath();
			ctx.moveTo(x + 7, y);
			ctx.lineTo(x + labelWidth - 7, y);
			ctx.quadraticCurveTo(x + labelWidth, y, x + labelWidth, y + 7);
			ctx.lineTo(x + labelWidth, y + 17);
			ctx.quadraticCurveTo(x + labelWidth, y + 24, x + labelWidth - 7, y + 24);
			ctx.lineTo(x + 7, y + 24);
			ctx.quadraticCurveTo(x, y + 24, x, y + 17);
			ctx.lineTo(x, y + 7);
			ctx.quadraticCurveTo(x, y, x + 7, y);
			ctx.fill();
			ctx.fillStyle = "rgba(239, 242, 247, 0.88)";
			ctx.textBaseline = "middle";
			ctx.fillText(label, x + 7, y + 12, labelWidth - 14);
		}
		ctx.restore();
	}

	private drawNode(ctx: CanvasRenderingContext2D, node: DrawNode): void {
		const x = node.x * this.k + this.tx;
		const y = node.y * this.k + this.ty;
		const radius = node.radius + (node.id === this.hoverId ? 1.6 : 0);
		const dimmed = this.focus !== null && !this.focus.has(node.id);
		if (dimmed) ctx.globalAlpha = 0.18;
		if (node.isSeed) {
			const glow = ctx.createRadialGradient(x, y, radius, x, y, radius + 22);
			glow.addColorStop(0, "rgba(255, 244, 214, 0.38)");
			glow.addColorStop(1, "rgba(255, 244, 214, 0)");
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius + 22, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fillStyle = node.color;
		ctx.fill();
		ctx.lineWidth = 1;
		ctx.strokeStyle = "rgba(8, 10, 14, 0.45)";
		ctx.stroke();
		if (node.isSeed) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = "rgba(255, 248, 230, 0.95)";
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
			ctx.lineWidth = 1;
			ctx.strokeStyle = "rgba(255, 248, 230, 0.45)";
			ctx.stroke();
		} else if (node.id === this.selectedId) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
			ctx.lineWidth = 1.75;
			ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
			ctx.stroke();
		}
		if (dimmed) ctx.globalAlpha = 1;
	}

	private rebuild(nodes: readonly PaperNode[], resetView: boolean): void {
		const mode = this.layoutMode === "force3d" ? "force2d" : this.layoutMode;
		const placed = new Map(placeLayout(mode, nodes, this.edges, this.seedScore).map((node) => [node.id, node]));
		this.nodes = nodes.map((node) => {
			const at = placed.get(node.id);
			return {
				...node,
				x: at?.x ?? 0,
				y: at?.y ?? 0,
				radius: at?.radius ?? 8,
				color: this.colorOf(node),
				shown: this.isShown(node),
			};
		});
		this.maxWeight = this.edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		if (resetView) {
			this.selectedId = this.nodes.find((node) => node.isSeed)?.id ?? null;
			this.hoverId = null;
			this.refreshFocus();
			this.adjusted = false;
			this.hideTooltip();
			this.resize();
			this.fit();
			return;
		}
		this.draw();
	}

	private recolor(): void {
		for (const node of this.nodes) node.color = this.colorOf(node);
	}

	private colorOf(node: PaperNode): string {
		if (this.colorMode === "community") return communityColor(this.communities.get(node.id) ?? 0);
		return yearColor(node.year, this.minYear, this.maxYear);
	}

	private isShown(node: PaperNode): boolean {
		return this.scrubYear === null || (node.year !== null && node.year <= this.scrubYear);
	}

	private drawLabels(ctx: CanvasRenderingContext2D): void {
		const ranked = [...this.nodes].sort((a, b) => b.citedByCount - a.citedByCount);
		const prominent = new Set<string>();
		const seed = this.nodes.find((node) => node.isSeed);
		if (seed) prominent.add(seed.id);
		if (this.selectedId) prominent.add(this.selectedId);
		if (this.hoverId) prominent.add(this.hoverId);
		for (const node of ranked.slice(0, this.layoutMode === "kumu" ? 18 : 8)) prominent.add(node.id);

		ctx.textBaseline = "middle";
		ctx.font = `${this.layoutMode === "kumu" ? 11 : 12}px ${this.fontFamily}`;
		const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
		const place = (node: DrawNode, maxWidth: number): void => {
			const x = node.x * this.k + this.tx + node.radius + (this.layoutMode === "kumu" ? 3 : 6);
			const y = node.y * this.k + this.ty;
			const text = fitText(ctx, authorYear(node), maxWidth);
			const width = ctx.measureText(text).width;
			const box = { x, y: y - 8, w: width, h: 16 };
			const must = node.isSeed || node.id === this.selectedId || node.id === this.hoverId;
			if (!must && overlaps(box, boxes)) return;
			boxes.push(box);
			const dimmed = this.focus !== null && !this.focus.has(node.id);
			if (dimmed) ctx.globalAlpha = 0.35;
			ctx.lineWidth = this.layoutMode === "kumu" ? 2 : 3;
			ctx.strokeStyle = this.layoutMode === "kumu" ? "rgba(251, 250, 247, 0.94)" : "rgba(11, 13, 18, 0.88)";
			ctx.strokeText(text, x, y);
			ctx.fillStyle = this.layoutMode === "kumu" ? (node.isSeed ? "#333943" : "#41464e") : node.isSeed ? "#fff8e8" : "#e7ebf4";
			ctx.fillText(text, x, y);
			if (dimmed) ctx.globalAlpha = 1;
		};

		for (const node of this.nodes) {
			if (node.shown && prominent.has(node.id)) place(node, 168);
		}
		if (this.k >= 1.35) {
			for (const node of this.nodes) {
				if (node.shown && !prominent.has(node.id)) place(node, 140);
			}
		}
	}
}

function themeColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	try {
		if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", trimmed)) {
			return fallback;
		}
	} catch {
		return fallback;
	}
	return trimmed;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const slice = `${text.slice(0, mid)}…`;
		if (ctx.measureText(slice).width <= maxWidth) low = mid;
		else high = mid - 1;
	}
	return `${text.slice(0, low)}…`;
}

function hexRgba(hex: number, alpha: number): string {
	const red = (hex >> 16) & 255;
	const green = (hex >> 8) & 255;
	const blue = hex & 255;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function strokeArrow(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	nodeRadius: number,
): void {
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const tipX = x2 - Math.cos(angle) * (nodeRadius + 2);
	const tipY = y2 - Math.sin(angle) * (nodeRadius + 2);
	const length = 9;
	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(tipX - length * Math.cos(angle - 0.4), tipY - length * Math.sin(angle - 0.4));
	ctx.lineTo(tipX - length * Math.cos(angle + 0.4), tipY - length * Math.sin(angle + 0.4));
	ctx.closePath();
	ctx.fill();
}

function overlaps(
	box: { x: number; y: number; w: number; h: number },
	boxes: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
	return boxes.some(
		(other) =>
			!(box.x + box.w < other.x || other.x + other.w < box.x || box.y + box.h < other.y || other.y + other.h < box.y),
	);
}
