import { communityColor, communityRgba, detectCommunities } from "./communities";
import { buildCommunityRegions, communityTopicLabels } from "./community-regions";
import { focusNodes } from "./graph-filter";
import { authorYear } from "./labels";
import type { ColorMode, LayoutMode } from "./layout-modes";
import { placeLayout } from "./layout-modes";
import { RELATION_COLOR, relationKind, type RelationKind } from "./relation";
import { topicSimilarity, topicSimilarityColor } from "./topic-similarity";
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
 * Layout is computed up front; dragging a node reheats a light physics
 * simmer so neighbors follow and the map settles on release (force layouts
 * only). Wheel zoom eases toward its target; pan and pinch stay immediate.
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
	private bgStart = "#ffffff";
	private bgEnd = "#f7f6f3";
	private graphNode = "#8a7fd8";
	private graphNodeFocused = "#4a90d9";
	private graphLine = "rgba(90, 96, 106, 0.28)";
	private graphText = "#4b5563";
	private layoutMode: LayoutMode = "temporal";
	private colorMode: ColorMode = "topic";
	private scrubYear: number | null = null;
	private seedScore = new Map<string, number>();
	private communities = new Map<string, number>();
	private communityLabels = new Map<number, string>();
	private minYear = 0;
	private maxYear = 0;
	/** Interactive simmer: reheats on node drag so neighbors follow, cools off after release. */
	private simAlpha = 0;
	private simFrame: number | null = null;
	/** Wheel zoom eases toward this target (pan and pinch stay immediate). */
	private zoomAnim: { k: number; tx: number; ty: number } | null = null;
	private zoomFrame: number | null = null;

	/** Headless verify stubs have no rAF; a timeout keeps the loops converging. */
	private raf(callback: () => void): number {
		return typeof requestAnimationFrame === "function"
			? requestAnimationFrame(callback)
			: (setTimeout(callback, 16) as unknown as number);
	}

	private caf(id: number): void {
		if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
		else clearTimeout(id);
	}

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
		this.simAlpha = 0;
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.communityLabels = communityTopicLabels(nodes, this.communities);
		// 不重置 layoutMode：布局由应用层（chrome 按钮）持有，建图后回灌。
		this.scrubYear = null;
		this.colorMode = "topic";
		this.rebuild(nodes, true);
	}

	/**
	 * Swap in enriched edges (e.g. OpenCitations gap-filling) without touching
	 * layout mode, color mode, scrub year, node positions, or the view transform.
	 */
	updateGraphData(edges: GraphEdge[]): void {
		this.edges = edges;
		this.communities = detectCommunities(this.nodes.map((node) => node.id), edges);
		this.communityLabels = communityTopicLabels(this.nodes, this.communities);
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
		this.simAlpha = 0;
		this.stage.classList?.toggle("cpo-kumu-view", this.layoutMode === "kumu");
		const canvasStyles = typeof getComputedStyle === "function" ? getComputedStyle(this.canvas) : null;
		this.bgStart = this.layoutMode === "kumu" ? "#ffffff" : themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-start") ?? "", "#ffffff");
		this.bgEnd = this.layoutMode === "kumu" ? "#ffffff" : themeColor(canvasStyles?.getPropertyValue("--cpo-canvas-bg-end") ?? "", "#f7f6f3");
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
		if (this.selectedId && !this.nodes.some((node) => node.id === this.selectedId && node.shown)) {
			this.selectedId = null;
			this.onSelect?.(null);
		}
		this.refreshFocus();
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
		this.bgStart = this.layoutMode === "kumu" ? "#ffffff" : themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-start"), "#ffffff");
		this.bgEnd = this.layoutMode === "kumu" ? "#ffffff" : themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-end"), "#f7f6f3");
		this.graphNode = themeColor(canvasStyles.getPropertyValue("--graph-node"), "#8a7fd8");
		this.graphNodeFocused = themeColor(canvasStyles.getPropertyValue("--graph-node-focused"), "#4a90d9");
		this.graphLine = themeColor(canvasStyles.getPropertyValue("--graph-line"), "rgba(90, 96, 106, 0.28)");
		this.graphText = themeColor(canvasStyles.getPropertyValue("--graph-text"), "#4b5563");
		this.recolor();
		this.draw();
	}

	zoomBy(factor: number): void {
		this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, factor);
	}

	fit(fromUser = false): void {
		if (fromUser) this.adjusted = false;
		if (this.nodes.length === 0) return;
		this.zoomAnim = null;
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

	/** Physics simmer only for force layouts; temporal/radial positions carry meaning. */
	private physicsOn(): boolean {
		return this.layoutMode === "force2d" || this.layoutMode === "kumu";
	}

	/**
	 * Reheat the interactive simulation (Obsidian-graph style): neighbors
	 * follow a dragged node elastically and the map settles after release.
	 * The loop stops when the alpha cools below the threshold, so an idle
	 * map costs nothing.
	 */
	private reheat(alpha: number): void {
		if (!this.physicsOn() || this.nodes.length > 350) return;
		this.simAlpha = Math.max(this.simAlpha, alpha);
		if (this.simFrame !== null) return;
		const step = (): void => {
			if (!this.alive || this.simAlpha < 0.02) {
				this.simFrame = null;
				this.simAlpha = 0;
				return;
			}
			this.tick(this.simAlpha);
			// A held node keeps the sim warm; after release it cools quickly.
			this.simAlpha *= this.dragging?.kind === "node" ? 0.99 : 0.96;
			this.draw();
			this.simFrame = this.raf(step);
		};
		this.simFrame = this.raf(step);
	}

	private tick(alpha: number): void {
		const nodes = this.nodes.filter((node) => node.shown);
		if (nodes.length < 2) return;
		const index = new Map(nodes.map((node, i) => [node.id, i] as const));
		const vx = new Array<number>(nodes.length).fill(0);
		const vy = new Array<number>(nodes.length).fill(0);
		const pinnedId = this.dragging?.kind === "node" ? this.dragging.id : null;
		const seedId = this.nodes.find((node) => node.isSeed)?.id ?? "";
		const mobile = (id: string): boolean => id !== pinnedId && id !== seedId;

		// Repulsion, same shaping as the upfront layout.
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
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
				if (mobile(a.id)) {
					vx[i]! -= fx;
					vy[i]! -= fy;
				}
				if (mobile(b.id)) {
					vx[j]! += fx;
					vy[j]! += fy;
				}
			}
		}
		// Springs over the visible edges.
		for (const edge of this.edges) {
			if (!this.kindVisible[relationKind(edge)]) continue;
			const ai = index.get(edge.source);
			const bi = index.get(edge.target);
			if (ai === undefined || bi === undefined) continue;
			const a = nodes[ai]!;
			const b = nodes[bi]!;
			const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
			const weight = clamp(edge.weight, 0, 1);
			const rest = 88 + (1 - weight) * 200;
			const spring = 0.025 + weight * 0.07;
			const disp = (dist - rest) * spring * alpha;
			const dx = ((b.x - a.x) / dist) * disp;
			const dy = ((b.y - a.y) / dist) * disp;
			if (mobile(a.id)) {
				vx[ai]! += dx;
				vy[ai]! += dy;
			}
			if (mobile(b.id)) {
				vx[bi]! -= dx;
				vy[bi]! -= dy;
			}
		}
		// Gentle centering, damping, and a step cap so reheats never explode.
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]!;
			if (!mobile(node.id)) continue;
			let mx = (vx[i]! - node.x * 0.01 * alpha) * 0.62;
			let my = (vy[i]! - node.y * 0.01 * alpha) * 0.62;
			const speed = Math.hypot(mx, my);
			const cap = 18 * alpha;
			if (speed > cap && speed > 0) {
				mx = (mx / speed) * cap;
				my = (my / speed) * cap;
			}
			node.x = clamp(node.x + mx, -1400, 1400);
			node.y = clamp(node.y + my, -1400, 1400);
		}
	}

	destroy(): void {
		this.alive = false;
		if (this.simFrame !== null) this.caf(this.simFrame);
		if (this.zoomFrame !== null) this.caf(this.zoomFrame);
		this.simFrame = null;
		this.zoomFrame = null;
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
		// Ease toward the target like the Obsidian graph; rapid wheel ticks just
		// move the target, and one rAF loop converges on it.
		this.zoomAnim = { k: next, tx: sx - world.x * next, ty: sy - world.y * next };
		if (this.zoomFrame !== null) return;
		const step = (): void => {
			const target = this.zoomAnim;
			if (!this.alive || !target) {
				this.zoomFrame = null;
				return;
			}
			const dk = target.k - this.k;
			const dtx = target.tx - this.tx;
			const dty = target.ty - this.ty;
			if (Math.abs(dk) < 0.002 && Math.abs(dtx) < 0.5 && Math.abs(dty) < 0.5) {
				this.k = target.k;
				this.tx = target.tx;
				this.ty = target.ty;
				this.zoomAnim = null;
				this.zoomFrame = null;
				this.draw();
				return;
			}
			this.k += dk * 0.3;
			this.tx += dtx * 0.3;
			this.ty += dty * 0.3;
			this.draw();
			this.zoomFrame = this.raf(step);
		};
		this.zoomFrame = this.raf(step);
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
		this.canvas.focus({ preventScroll: true });
		// Direct manipulation cancels any eased zoom still in flight.
		this.zoomAnim = null;
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
				// Neighbors follow elastically while the node is held.
				this.reheat(0.5);
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
			// Release after a drag: simmer so the map settles elastically.
			if (wasDrag && dragging?.kind === "node") this.reheat(0.35);
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
		if (key === "Escape") {
			event.preventDefault();
			this.selectedId = null;
			this.hoverId = null;
			this.refreshFocus();
			this.onSelect?.(null);
			this.draw();
			return;
		}
		if ((key === "Enter" || key === " ") && this.selectedId) {
			event.preventDefault();
			this.onSelect?.(this.nodes.find((node) => node.id === this.selectedId) ?? null);
			return;
		}
		if (event.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
			event.preventDefault();
			const current = this.nodes.find((node) => node.id === this.selectedId) ?? this.nodes.find((node) => node.isSeed);
			if (current) {
				const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
				const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
				const next = this.nodes
					.filter((node) => node.shown && node.id !== current.id)
					.map((node) => {
						const vx = node.x - current.x;
						const vy = node.y - current.y;
						const distance = Math.hypot(vx, vy);
						const forward = (vx * dx + vy * dy) / Math.max(1, distance);
						return { node, score: forward > 0 ? distance / forward : Number.POSITIVE_INFINITY };
					})
					.filter((item) => Number.isFinite(item.score))
					.sort((a, b) => a.score - b.score)[0]?.node;
				if (next) {
					this.selectedId = next.id;
					this.refreshFocus();
					this.onSelect?.(next);
					this.draw();
				}
			}
			return;
		}
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
		if (this.layoutMode === "temporal") this.drawYearAxis(ctx);
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
			const dimmed = focus !== null && !(focus.has(edge.source) && focus.has(edge.target));
			const focused = focus !== null && !dimmed;
			const ax = a.x * this.k + this.tx;
			const ay = a.y * this.k + this.ty;
			const bx = b.x * this.k + this.tx;
			const by = b.y * this.k + this.ty;
			// 默认对齐 Obsidian 图谱：细、浅、中性灰；聚焦时才按关系类型着色。
			const strokeStyle = dimmed
				? "rgba(90, 96, 106, 0.1)"
				: focused
					? hexRgba(RELATION_COLOR[kind], 0.85)
					: this.graphLine;
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.strokeStyle = strokeStyle;
			const relatedness = clamp(edge.structuralSimilarity === null ? 0 : edge.structuralSimilarity ?? edge.weight, 0, 1);
			ctx.lineWidth = clamp(0.8 + Math.sqrt(relatedness) * 2.1 + (focused ? 0.35 : 0), 0.8, 3.25);
			ctx.stroke();
			if (kind !== "direct") continue;
			ctx.fillStyle = strokeStyle;
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

	private drawYearAxis(ctx: CanvasRenderingContext2D): void {
		if (!this.nodes.some((node) => node.year !== null)) return;
		const width = 460;
		const yearSpan = this.maxYear - this.minYear;
		const span = Math.max(1, yearSpan);
		const bottom = this.cssHeight - 26;
		const top = 24;
		const ticks = [...new Set([this.minYear, Math.round((this.minYear + this.maxYear) / 2), this.maxYear])];
		ctx.save();
		ctx.font = `11px ${this.fontFamily}`;
		ctx.textBaseline = "bottom";
		for (const year of ticks) {
			const worldX = yearSpan === 0 ? 0 : ((year - this.minYear) / span - 0.5) * width;
			const x = worldX * this.k + this.tx;
			if (x < -20 || x > this.cssWidth + 20) continue;
			ctx.beginPath();
			ctx.moveTo(x, top);
			ctx.lineTo(x, bottom);
			ctx.strokeStyle = "rgba(105, 116, 128, 0.10)";
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.fillStyle = "rgba(95, 105, 116, 0.72)";
			ctx.textAlign = x < 42 ? "left" : x > this.cssWidth - 42 ? "right" : "center";
			ctx.fillText(String(year), x, this.cssHeight - 7);
		}
		const unknownX = (-width / 2 - 48) * this.k + this.tx;
		if (this.nodes.some((node) => node.year === null) && unknownX > 0 && unknownX < this.cssWidth) {
			ctx.fillStyle = "rgba(95, 105, 116, 0.72)";
			ctx.textAlign = "center";
			ctx.fillText("年份未知", unknownX, this.cssHeight - 7);
		}
		ctx.restore();
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
			3,
			10,
			this.communityLabels,
		);
		ctx.save();
		ctx.textAlign = "left";
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
				ctx.fillStyle = color.replace(", 1)", ", 0.04)");
				ctx.strokeStyle = color.replace(", 1)", ", 0.25)");
				ctx.lineWidth = 1;
				ctx.fill();
				ctx.stroke();
			}

			const label = region.label;
			ctx.font = `10px ${this.fontFamily}`;
			const labelWidth = ctx.measureText(label).width;
			const x = Math.max(6, Math.min(this.cssWidth - labelWidth - 6, region.left + 6));
			const y = Math.max(8, Math.min(this.cssHeight - 22, region.top + 8));
			ctx.fillStyle = "#9aa0a6";
			ctx.textBaseline = "middle";
			ctx.fillText(label, x, y + 12, labelWidth);
		}
		ctx.restore();
	}

	private drawNode(ctx: CanvasRenderingContext2D, node: DrawNode): void {
		const x = node.x * this.k + this.tx;
		const y = node.y * this.k + this.ty;
		const radius = node.radius + (node.id === this.hoverId ? 1.6 : 0);
		const dimmed = this.focus !== null && !this.focus.has(node.id);
		if (dimmed) ctx.globalAlpha = 0.25;
		if (node.isSeed) {
			const glow = ctx.createRadialGradient(x, y, radius, x, y, radius + 22);
			glow.addColorStop(0, "rgba(60, 64, 70, 0.16)");
			glow.addColorStop(1, "rgba(60, 64, 70, 0)");
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius + 22, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		const active = node.id === this.hoverId || node.id === this.selectedId;
		ctx.fillStyle = this.colorMode === "graph" && active ? this.graphNodeFocused : node.color;
		ctx.shadowColor = "rgba(60, 64, 70, 0.18)";
		ctx.shadowBlur = 5;
		ctx.fill();
		ctx.shadowColor = "rgba(0, 0, 0, 0)";
		ctx.shadowBlur = 0;
		ctx.lineWidth = 1;
		ctx.strokeStyle = shadeColor(node.color, 0.85);
		ctx.stroke();
		if (node.isSeed) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = "#333943";
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
			ctx.lineWidth = 1;
			ctx.strokeStyle = "rgba(51, 57, 67, 0.45)";
			ctx.stroke();
		} else if (node.id === this.selectedId) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
			ctx.lineWidth = 2;
			ctx.strokeStyle = this.graphNodeFocused;
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
		if (this.colorMode === "year") return yearColor(node.year, this.minYear, this.maxYear);
		if (this.colorMode === "topic") {
			const seed = this.nodes.find((candidate) => candidate.isSeed);
			return topicSimilarityColor(topicSimilarity(node.topicTags, seed?.topicTags));
		}
		return this.graphNode;
	}

	private isShown(node: PaperNode): boolean {
		return this.scrubYear === null || (node.year !== null && node.year <= this.scrubYear);
	}

	private drawLabels(ctx: CanvasRenderingContext2D): void {
		const kumu = this.layoutMode === "kumu";
		const ranked = [...this.nodes].sort((a, b) => b.citedByCount - a.citedByCount);
		const prominent = new Set<string>();
		const seed = this.nodes.find((node) => node.isSeed);
		if (seed) prominent.add(seed.id);
		if (this.selectedId) prominent.add(this.selectedId);
		if (this.hoverId) prominent.add(this.hoverId);
		for (const node of ranked.slice(0, 5)) prominent.add(node.id);

		ctx.textBaseline = "middle";
		ctx.font = `11px ${this.fontFamily}`;
		// Kumu 标签在节点正下方居中，其余布局在右侧。
		ctx.textAlign = kumu ? "center" : "left";
		const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
		const place = (node: DrawNode, maxWidth: number, alpha = 1): void => {
			const cx = node.x * this.k + this.tx;
			const cy = node.y * this.k + this.ty;
			const x = kumu ? cx : cx + node.radius + 6;
			const y = kumu ? cy + node.radius + 11 : cy;
			const text = fitText(ctx, authorYear(node), maxWidth);
			const width = ctx.measureText(text).width;
			const box = kumu
				? { x: x - width / 2, y: y - 8, w: width, h: 16 }
				: { x, y: y - 8, w: width, h: 16 };
			const must = node.isSeed || node.id === this.selectedId || node.id === this.hoverId;
			if (!must && overlaps(box, boxes)) return;
			boxes.push(box);
			const dimmed = this.focus !== null && !this.focus.has(node.id);
			ctx.globalAlpha = dimmed ? 0.35 * alpha : alpha;
			ctx.lineWidth = 2;
			ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
			ctx.strokeText(text, x, y);
			ctx.fillStyle = this.graphText;
			ctx.fillText(text, x, y);
			ctx.globalAlpha = 1;
		};

		for (const node of this.nodes) {
			if (node.shown && prominent.has(node.id)) place(node, 168);
		}
		// Full labels fade in across a zoom band instead of a hard cutoff.
		const labelAlpha = clamp((this.k - 1.1) / 0.5, 0, 1);
		if (labelAlpha > 0) {
			for (const node of this.nodes) {
				if (node.shown && !prominent.has(node.id)) place(node, 140, labelAlpha);
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

/** Kumu 节点描边：同色系加深一点，制造与画布的分离感。 */
function shadeColor(rgb: string, factor: number): string {
	const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return "rgba(58, 63, 69, 0.4)";
	const red = Math.round(Number(match[1]) * factor);
	const green = Math.round(Number(match[2]) * factor);
	const blue = Math.round(Number(match[3]) * factor);
	return `rgb(${red}, ${green}, ${blue})`;
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
	const length = 7;
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
