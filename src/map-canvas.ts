import { tr } from "./i18n";
import { classicCandidates, classicInfluence, type ClassicEvidence } from "./aggregates";
import { communityColor, detectCommunities } from "./communities";
import { edgeVisible, focusNodes, nodeVisible, type GraphFilter } from "./graph-filter";
import { citationLabelAlpha, nodeLabel, type LabelMode } from "./labels";
import { placeLayout, type ColorMode, type LayoutMode } from "./layout-modes";
import { RELATION_COLOR, relationKind, type RelationKind } from "./relation";
import { topicSimilarity, topicSimilarityColor } from "./topic-similarity";
import type { GraphEdge, PaperNode } from "./types";
import { channelsFromCss, clearThemeColorCache, rgba, type Rgb } from "./theme-color";
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, citationRadii, clamp, classicBreath, fitViewScale, yearColor } from "./visual";

const INTRO_SPREAD = 2250;
const INTRO_FADE = 750;
/** Default sample size. Its reveal stays three seconds; other sizes scale from here. */
const INTRO_REFERENCE_NODES = 50;

/** Fewer nodes finish sooner. More nodes take longer, up to three times the default. */
export function introTiming(count: number): { spread: number; fade: number } {
	const scale = clamp(Math.max(count, 2) / INTRO_REFERENCE_NODES, 0.45, 3);
	return { spread: Math.round(INTRO_SPREAD * scale), fade: INTRO_FADE };
}

/** Zoom follows one ease-out curve from the seed to the full graph. No per-node steps. */
export function introZoom(progress: number, kSeed: number, kFull: number): number {
	const u = clamp(progress, 0, 1);
	const s = 1 - (1 - u) * (1 - u);
	if (!(kSeed > 0) || !(kFull > 0)) return kFull;
	const radius = (1 - s) / kSeed + s / kFull;
	return 1 / radius;
}

/** Seed is fully visible immediately; farther nodes fade in across the reveal. */
export function introAlpha(elapsed: number, distance: number, span: number, spread = INTRO_SPREAD, fade = INTRO_FADE): number {
	if (elapsed >= spread + fade) return 1;
	if (span <= 0 || distance <= 0) return 1;
	return clamp((elapsed - (distance / span) * spread) / fade, 0, 1);
}

interface DrawNode extends PaperNode {
	x: number;
	y: number;
	homeX: number;
	homeY: number;
	radius: number;
	color: string;
	shown: boolean;
}

type Drag =
	| { kind: "pan"; px: number; py: number; tx: number; ty: number }
	| { kind: "node"; id: string; dx: number; dy: number };

/**
 * Canvas similarity map: pan, zoom, drag with a simmer that keeps the layout's
 * edge lengths and homes, hover title, click to select.
 * Wheel zoom eases toward its target; pan and pinch stay immediate.
 */
export class SimilarityMap {
	onSelect: ((paper: PaperNode | null) => void) | null = null;
	onEdgeSelect: ((edge: GraphEdge) => void) | null = null;
	onNodeMenu: ((paper: PaperNode | null, x: number, y: number) => void) | null = null;
	onEngage: ((engaged: boolean) => void) | null = null;
	onDeleteRequest: (() => void) | null = null;

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
	/** Dim unrelated nodes only after the user chooses one. The seed starts selected without this. */
	private engaged = false;
	private hoverId: string | null = null;
	private focus: Set<string> | null = null;
	private focusId: string | null = null;
	private focusStarted = 0;
	private kindVisible: Record<RelationKind, boolean> = { direct: true, cocitation: true, coupling: true, weak: false };
	private contentFilter: GraphFilter | null = null;
	private filterNodes = new Map<string, PaperNode>();
	private labelMode: LabelMode = "author-year";
	private labelOpacity = new Map<string, { value: number; at: number }>();
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
	private communityPrimary = communityColor(0);
	private graphNodeFocused = "#4a90d9";
	private labelMuted = "#6b7280";
	private ink: Rgb = { r: 90, g: 96, b: 106 };
	private accent: Rgb = { r: 51, g: 57, b: 67 };
	private night = false;
	private reducedMotion = false;
	private motionQuery: MediaQueryList | null = null;
	private onMotion: ((event: MediaQueryListEvent) => void) | null = null;
	private layoutMode: LayoutMode = "temporal";
	private colorMode: ColorMode = "community";
	private scrubYear: number | null = null;
	private seedScore = new Map<string, number>();
	private communities = new Map<string, number>();
	private classicGlow = new Map<string, number>();
	private minYear = 0;
	private maxYear = 0;
	private simAlpha = 0;
	private edgeRest = new Map<string, number>();
	/** Wheel zoom eases toward this target (pan and pinch stay immediate). */
	private zoomAnim: { k: number; tx: number; ty: number } | null = null;
	private pulsing = false;
	private tooltipSize: { width: number; height: number } | null = null;
	private drawFrame: number | null = null;
	private wheelNeedsModifier = false;
	/** performance.now() when a freshly built graph started revealing from the seed; 0 when idle. */
	private introAt = 0;
	/** True until the build turn finishes. Synchronous layout must not start the clock. */
	private introHold = false;
	private introQueued = false;
	private introSeedX = 0;
	private introSeedY = 0;
	private introSpan = 0;
	private introSpread = INTRO_SPREAD;
	private introFade = INTRO_FADE;

	private setCursor(cursor: "grab" | "grabbing" | "pointer"): void {
		this.canvas.classList.toggle("is-pointer", cursor === "pointer");
		this.canvas.classList.toggle("is-grabbing", cursor === "grabbing");
	}

	getViewState(): { zoom: number; centerX: number; centerY: number; selectedId: string | null } {
		return {
			zoom: this.k,
			centerX: (this.cssWidth / 2 - this.tx) / this.k,
			centerY: (this.cssHeight / 2 - this.ty) / this.k,
			selectedId: this.selectedId,
		};
	}

	setViewState(state: { zoom: number; centerX: number; centerY: number; selectedId: string | null }): void {
		this.zoomAnim = null;
		this.k = clamp(state.zoom, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		this.tx = this.cssWidth / 2 - state.centerX * this.k;
		this.ty = this.cssHeight / 2 - state.centerY * this.k;
		this.selectedId = this.nodes.some((node) => node.id === state.selectedId) ? state.selectedId : null;
		this.refreshFocus();
		this.draw();
	}

	/** Headless verify stubs have no rAF; a timeout keeps the loops converging. */
	private raf(callback: () => void): number {
		return typeof window.requestAnimationFrame === "function"
			? window.requestAnimationFrame(callback)
			: window.setTimeout(callback, 16);
	}

	private caf(id: number): void {
		if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(id);
		else window.clearTimeout(id);
	}

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly tooltip: HTMLElement,
		private readonly stage: HTMLElement,
		options?: { wheel?: "always" | "modifier" },
	) {
		this.wheelNeedsModifier = options?.wheel === "modifier";
		canvas.tabIndex = 0;
		// Optional-call: the headless verify script stubs a bare canvas object.
		canvas.setAttribute?.("role", "application");
		if (!canvas.getAttribute?.("aria-label")) {
			canvas.setAttribute?.("aria-label", tr("论文相似度图谱：方向键平移，+/- 缩放，0 或 F 适配", "Paper similarity graph: arrow keys to pan, +/- to zoom, 0 or F to fit"));
		}
		canvas.addEventListener("pointerdown", this.onPointerDown);
		canvas.addEventListener("pointermove", this.onPointerMove);
		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		canvas.addEventListener("pointerleave", this.onPointerLeave);
		canvas.addEventListener("keydown", this.onKeyDown);
		canvas.addEventListener("contextmenu", this.onContextMenu);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("pointercancel", this.onPointerUp);
		this.bindMotion();
	}

	private referenceLists: ReadonlyMap<string, readonly string[]> | undefined;

	classicEvidence(id: string): ClassicEvidence | undefined {
		return classicCandidates(this.nodes, this.edges, undefined, this.referenceLists).get(id);
	}

	setGraph(nodes: PaperNode[], edges: GraphEdge[], seedScore: Map<string, number>, referenceLists?: ReadonlyMap<string, readonly string[]>): void {
		this.referenceLists = referenceLists;
		this.simAlpha = 0;
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(nodes, edges, undefined, this.referenceLists);
		// 不重置 layoutMode：布局由应用层（chrome 按钮）持有，建图后回灌。
		this.scrubYear = null;
		// 列表和详情还在这次调用栈里同步绘制。时钟若现在开始，等浏览器真正露出画布时展开已经结束。
		this.introAt = 0;
		this.introSpread = INTRO_SPREAD;
		this.introFade = INTRO_FADE;
		this.introHold = !this.reducedMotion && nodes.length >= 2;
		this.rebuild(nodes, true);
		if (this.introHold) this.armIntro();
		this.ensurePulse();
	}

	/** Keep existing coordinates by default; reflow and fit after removals/restores when requested. */
	adoptGraph(nodes: PaperNode[], edges: GraphEdge[], seedScore: Map<string, number>, nearId?: string, reflow = false, referenceLists?: ReadonlyMap<string, readonly string[]>): void {
		this.referenceLists = referenceLists;
		const prev = new Map(this.nodes.map((node) => [node.id, node]));
		const years = nodes.map((node) => node.year).filter((year): year is number => year !== null);
		this.minYear = years.length ? Math.min(...years) : 0;
		this.maxYear = years.length ? Math.max(...years) : 0;
		this.seedScore = seedScore;
		this.edges = edges;
		this.communities = detectCommunities(nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(nodes, edges, undefined, this.referenceLists);
		const host = nearId ? prev.get(nearId) : null;
		const placed = reflow || !host && nodes.some(node => !prev.has(node.id))
			? new Map(placeLayout(this.layoutMode, nodes, edges, seedScore).map((node) => [node.id, node]))
			: null;
		const radii = citationRadii(nodes);
		this.nodes = nodes.map((node, index) => {
			const old = prev.get(node.id);
			const at = placed?.get(node.id);
			const parked = host && !old ? parkNear(host.x, host.y, node.id) : null;
			const x = reflow ? at?.x ?? 0 : old?.x ?? parked?.x ?? at?.x ?? 0;
			const y = reflow ? at?.y ?? 0 : old?.y ?? parked?.y ?? at?.y ?? 0;
			return {
				...node,
				x,
				y,
				homeX: x,
				homeY: y,
				radius: at?.radius ?? radii[index]!,
				color: this.colorOf(node),
				shown: this.isShown(node),
			};
		});
		this.maxWeight = edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.ensurePulse();
		this.captureStructure();
		if (this.selectedId && !this.nodes.some((node) => node.id === this.selectedId)) {
			this.selectedId = this.nodes.find((node) => node.isSeed)?.id ?? null;
			this.onSelect?.(this.nodes.find((node) => node.id === this.selectedId) ?? null);
		}
		this.refreshFocus();
		if (reflow) this.fit(true);
		else {
			this.reheat(0.28);
			this.draw();
		}
	}

	/**
	 * Swap in enriched edges (e.g. OpenCitations gap-filling) without touching
	 * layout mode, color mode, scrub year, node positions, or the view transform.
	 */
	updateGraphData(edges: GraphEdge[], referenceLists = this.referenceLists): void {
		this.referenceLists = referenceLists;
		this.edges = edges;
		this.communities = detectCommunities(this.nodes.map((node) => node.id), edges);
		this.classicGlow = classicInfluence(this.nodes, edges, undefined, this.referenceLists);
		this.ensurePulse();
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
		this.simAlpha = 0;
		this.layoutMode = mode;
		this.readTheme();
		this.rebuild(this.nodes, false);
		this.fit(true);
	}

	setColorMode(mode: ColorMode): void {
		this.colorMode = mode;
		this.recolor();
		this.draw();
	}

	/** Full embed filter: year, language, type, concept, and relation thresholds, plus the scrub. */
	setContentFilter(filter: GraphFilter, nodes: readonly PaperNode[]): void {
		this.contentFilter = filter;
		this.filterNodes = new Map(nodes.map((node) => [node.id, node]));
		this.kindVisible = { ...filter.kinds };
		this.scrubYear = filter.scrubYear;
		for (const node of this.nodes) node.shown = this.isShown(node);
		if (this.selectedId && !this.nodes.some((node) => node.id === this.selectedId && node.shown)) {
			this.selectedId = null;
			this.onSelect?.(null);
		}
		this.refreshFocus();
		this.draw();
	}

	setLabelMode(mode: LabelMode): void {
		this.labelMode = mode;
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

	/** Drop the selection dim and show every node again. The seed marker stays. */
	clearFocus(): void {
		this.hoverId = null;
		this.setEngaged(false);
		this.draw();
	}

	focusPaper(id: string): void {
		const node = this.nodes.find((item) => item.id === id);
		if (!node) return;
		this.adjusted = true;
		this.setViewState({ ...this.getViewState(), centerX: node.x, centerY: node.y, selectedId: id });
	}

	private setEngaged(value: boolean): void {
		const changed = this.engaged !== value;
		this.engaged = value;
		this.refreshFocus();
		if (changed) this.onEngage?.(value);
	}

	private refreshFocus(): void {
		const id = this.hoverId ?? (this.engaged ? this.selectedId : null);
		if (id !== this.focusId) {
			this.focusId = id;
			this.focusStarted = performance.now();
		}
		this.focus = id
			? focusNodes(id, this.edges, (edge) => this.edgeShown(edge))
			: null;
	}

	resize(): void {
		this.tooltipSize = null;
		const stageRect = this.stage.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(stageRect.width));
		const height = Math.max(1, Math.round(stageRect.height));
		// Keep world point at the old center; do not refit — panel collapse must not rezoom.
		const cx = (this.cssWidth / 2 - this.tx) / this.k;
		const cy = (this.cssHeight / 2 - this.ty) / this.k;
		if (this.zoomAnim) {
			this.zoomAnim.tx += (width - this.cssWidth) / 2;
			this.zoomAnim.ty += (height - this.cssHeight) / 2;
		}
		this.cssWidth = width;
		this.cssHeight = height;
		this.tx = width / 2 - cx * this.k;
		this.ty = height / 2 - cy * this.k;
		const bw = Math.round(width * dpr);
		const bh = Math.round(height * dpr);
		if (this.canvas.width !== bw || this.canvas.height !== bh) {
			this.canvas.width = bw;
			this.canvas.height = bh;
		}
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		this.ctx = ctx;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.fontFamily = getComputedStyle(this.stage).fontFamily || "sans-serif";
		this.readTheme();
		this.draw();
		if (this.introHold) this.armIntro();
	}

	zoomBy(factor: number): void {
		this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, factor);
	}

	fit(fromUser = false): void {
		if (fromUser) this.adjusted = false;
		if (this.nodes.length === 0 || this.cssWidth < 2 || this.cssHeight < 2) return;
		this.zoomAnim = null;
		const bounds = this.contentBounds();
		this.k = fitViewScale(this.cssWidth, this.cssHeight, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
		this.tx = this.cssWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * this.k;
		this.ty = this.cssHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * this.k;
		this.draw();
	}

	private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const node of this.nodes) {
			if (!node.shown) continue;
			minX = Math.min(minX, node.x - node.radius);
			minY = Math.min(minY, node.y - node.radius);
			maxX = Math.max(maxX, node.x + node.radius);
			maxY = Math.max(maxY, node.y + node.radius);
		}
		if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
		return { minX, minY, maxX, maxY };
	}

	/** Zoom around the seed. The scale follows the reveal, and the seed stays centered. */
	private frameRevealed(): void {
		if (this.adjusted || this.cssWidth < 2 || this.cssHeight < 2) return;
		this.zoomAnim = null;
		const seed = this.nodes.find((node) => node.isSeed);
		const cx = seed?.x ?? this.introSeedX;
		const cy = seed?.y ?? this.introSeedY;
		let span = 0;
		let maxRadius = seed?.radius ?? 8;
		for (const node of this.nodes) {
			if (!node.shown) continue;
			maxRadius = Math.max(maxRadius, node.radius);
			span = Math.max(span, Math.hypot(node.x - cx, node.y - cy));
		}
		const seedRadius = Math.max(seed?.radius ?? 8, 1);
		const kSeed = fitViewScale(this.cssWidth, this.cssHeight, seedRadius * 2, seedRadius * 2);
		const kFull = fitViewScale(this.cssWidth, this.cssHeight, Math.max(seedRadius, span + maxRadius) * 2, Math.max(seedRadius, span + maxRadius) * 2);
		const elapsed = this.introAt ? performance.now() - this.introAt : this.introSpread;
		const progress = elapsed / Math.max(1, this.introSpread);
		this.k = introZoom(progress, kSeed, kFull);
		this.tx = this.cssWidth / 2 - cx * this.k;
		this.ty = this.cssHeight / 2 - cy * this.k;
	}

	private physicsOn(): boolean {
		return this.layoutMode === "force2d";
	}

	private reheat(alpha: number): void {
		if (!this.physicsOn() || this.nodes.length > 350) return;
		this.simAlpha = Math.max(this.simAlpha, alpha);
		this.requestDraw();
	}

	private captureStructure(): void {
		for (const node of this.nodes) {
			node.homeX = node.x;
			node.homeY = node.y;
		}
		this.edgeRest.clear();
		for (const edge of this.edges) {
			const a = this.nodes.find((node) => node.id === edge.source);
			const b = this.nodes.find((node) => node.id === edge.target);
			if (!a || !b) continue;
			this.edgeRest.set(pairKey(a.id, b.id), Math.max(8, Math.hypot(b.x - a.x, b.y - a.y)));
		}
	}

	private tick(alpha: number): void {
		const nodes = this.nodes.filter((node) => node.shown);
		if (nodes.length < 2) return;
		const index = new Map(nodes.map((node, i) => [node.id, i] as const));
		const vx = new Array<number>(nodes.length).fill(0);
		const vy = new Array<number>(nodes.length).fill(0);
		const pinnedId = this.dragging?.kind === "node" ? this.dragging.id : null;
		const seed = this.nodes.find((node) => node.isSeed) ?? null;
		const seedId = seed?.id ?? "";
		const seedCommunity = seed ? this.communities.get(seed.id) : undefined;
		const mobile = (id: string): boolean => id !== pinnedId && id !== seedId;
		const pulled = new Set<string>();
		if (pinnedId) {
			for (const edge of this.edges) {
				if (edge.source === pinnedId) pulled.add(edge.target);
				if (edge.target === pinnedId) pulled.add(edge.source);
			}
		}
		const centers = new Map<number, { x: number; y: number }>();
		const sums = new Map<number, { x: number; y: number; n: number }>();
		for (const node of nodes) {
			const cid = this.communities.get(node.id);
			if (cid === undefined) continue;
			const acc = sums.get(cid) ?? { x: 0, y: 0, n: 0 };
			acc.x += node.x;
			acc.y += node.y;
			acc.n += 1;
			sums.set(cid, acc);
		}
		for (const [cid, acc] of sums) centers.set(cid, { x: acc.x / acc.n, y: acc.y / acc.n });
		if (seed && seedCommunity !== undefined) centers.set(seedCommunity, { x: seed.x, y: seed.y });

		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				const min = a.radius + b.radius + 10;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 0.01;
				if (dist >= min) continue;
				dx /= dist;
				dy /= dist;
				const push = ((min - dist) / 2) * alpha;
				if (mobile(a.id)) {
					vx[i]! -= dx * push;
					vy[i]! -= dy * push;
				}
				if (mobile(b.id)) {
					vx[j]! += dx * push;
					vy[j]! += dy * push;
				}
			}
		}
		for (const edge of this.edges) {
			if (!this.edgeShown(edge)) continue;
			const ai = index.get(edge.source);
			const bi = index.get(edge.target);
			if (ai === undefined || bi === undefined) continue;
			const a = nodes[ai]!;
			const b = nodes[bi]!;
			const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
			const rest = this.edgeRest.get(pairKey(a.id, b.id)) ?? dist;
			const weight = clamp(edge.weight, 0, 1);
			const spring = 0.04 + weight * 0.08;
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
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]!;
			if (!mobile(node.id)) continue;
			const cid = this.communities.get(node.id);
			const center = cid === undefined ? undefined : centers.get(cid);
			const homeK = pulled.has(node.id) ? 0.04 : 0.12;
			let mx = vx[i]! - node.x * 0.02 * alpha + (node.homeX - node.x) * homeK * alpha;
			let my = vy[i]! - node.y * 0.02 * alpha + (node.homeY - node.y) * homeK * alpha;
			if (center) {
				mx -= (node.x - center.x) * 0.1 * alpha;
				my -= (node.y - center.y) * 0.1 * alpha;
			}
			mx *= 0.62;
			my *= 0.62;
			const speed = Math.hypot(mx, my);
			const cap = 16 * alpha;
			if (speed > cap && speed > 0) {
				mx = (mx / speed) * cap;
				my = (my / speed) * cap;
			}
			node.x = clamp(node.x + mx, -2400, 2400);
			node.y = clamp(node.y + my, -2400, 2400);
		}
	}

	private bindMotion(): void {
		if (typeof window.matchMedia !== "function") return;
		this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		this.reducedMotion = this.motionQuery.matches;
		this.onMotion = (event) => {
			this.reducedMotion = event.matches;
			if (this.reducedMotion) this.stopPulse();
			else this.ensurePulse();
			this.draw();
		};
		this.motionQuery.addEventListener("change", this.onMotion);
	}

	private stopPulse(): void {
		this.pulsing = false;
	}

	private readTheme(): void {
		if (typeof getComputedStyle !== "function") return;
		clearThemeColorCache();
		const canvasStyles = getComputedStyle(this.canvas);
		const text = canvasStyles.getPropertyValue("--text-normal") || canvasStyles.color;
		const accent = canvasStyles.getPropertyValue("--interactive-accent");
		this.ink = channelsFromCss(text, this.ink);
		this.accent = channelsFromCss(accent, this.accent);
		this.bgStart = themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-start"), "#ffffff");
		this.bgEnd = themeColor(canvasStyles.getPropertyValue("--cpo-canvas-bg-end"), "#f7f6f3");
		const paper = channelsFromCss(canvasStyles.getPropertyValue("--background-primary"), { r: 255, g: 255, b: 255 });
		const paperLum = (paper.r * 299 + paper.g * 587 + paper.b * 114) / 1000;
		this.night = paperLum < 140;
		this.canvas.closest(".cpo-surface")?.classList.toggle("is-night-canvas", this.night);
		this.communityPrimary = themeColor(canvasStyles.getPropertyValue("--cpo-community-primary"), communityColor(0));
		this.graphNode = themeColor(canvasStyles.getPropertyValue("--graph-node"), rgba(this.ink, 1));
		this.graphNodeFocused = themeColor(canvasStyles.getPropertyValue("--graph-node-focused") || accent, rgba(this.accent, 1));
		this.labelMuted = themeColor(canvasStyles.getPropertyValue("--text-muted"), "#6b7280");
		this.recolor();
		this.ensurePulse();
	}

	private ensurePulse(): void {
		this.pulsing = !this.reducedMotion && this.nodes.some(node => this.night || this.classicGlow.has(node.id));
		if (this.pulsing) this.requestDraw();
	}

	destroy(): void {
		this.alive = false;
		this.pulsing = false;
		if (this.drawFrame !== null) this.caf(this.drawFrame);
		this.drawFrame = null;
		if (this.motionQuery && this.onMotion) this.motionQuery.removeEventListener("change", this.onMotion);
		this.motionQuery = null;
		this.onMotion = null;
		this.pointers.clear();
		this.pinch = null;
		this.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.canvas.removeEventListener("pointermove", this.onPointerMove);
		this.canvas.removeEventListener("wheel", this.onWheel);
		this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
		this.canvas.removeEventListener("keydown", this.onKeyDown);
		this.canvas.removeEventListener("contextmenu", this.onContextMenu);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("pointercancel", this.onPointerUp);
		this.hideTooltip();
	}

	private zoomAt(sx: number, sy: number, factor: number): void {
		this.adjusted = true;
		const base = this.zoomAnim ?? { k: this.k, tx: this.tx, ty: this.ty };
		const next = clamp(base.k * factor, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		const world = { x: (sx - base.tx) / base.k, y: (sy - base.ty) / base.k };
		// Ease toward the target like the Obsidian graph; rapid wheel ticks just
		// move the target, and one rAF loop converges on it.
		this.zoomAnim = { k: next, tx: sx - world.x * next, ty: sy - world.y * next };
		this.requestDraw();
	}

	private onWheel = (event: WheelEvent): void => {
		if (!this.alive) return;
		if (this.wheelNeedsModifier && !event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		const local = this.localPoint(event.clientX, event.clientY);
		const factor = Math.exp(-event.deltaY * 0.0012);
		this.zoomAt(local.x, local.y, factor);
	};

	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
		if (!this.alive) return;
		const keyboard = event.button === 0 && !event.ctrlKey && !event.metaKey;
		const local = this.localPoint(event.clientX, event.clientY);
		const hit = keyboard ? this.nodes.find((node) => node.id === this.selectedId) ?? null : this.hit(local.x, local.y);
		this.openNodeMenu(hit, keyboard, event.clientX, event.clientY);
	};

	private openNodeMenu(node: DrawNode | null, keyboard: boolean, clientX = 0, clientY = 0): void {
		if (!node) {
			this.onNodeMenu?.(null, clientX, clientY);
			return;
		}
		if (!keyboard) {
			this.onNodeMenu?.(node, clientX, clientY);
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		this.onNodeMenu?.(node, rect.left + node.x * this.k + this.tx, rect.top + node.y * this.k + this.ty);
	};

	private onPointerDown = (event: PointerEvent): void => {
		if (!this.alive) return;
		this.canvas.focus({ preventScroll: true });
		if (event.button !== 0) return;
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
		if (hit && !hit.isSeed) {
			const world = this.screenToWorld(local.x, local.y);
			this.dragging = { kind: "node", id: hit.id, dx: hit.x - world.x, dy: hit.y - world.y };
		} else {
			this.dragging = { kind: "pan", px: local.x, py: local.y, tx: this.tx, ty: this.ty };
		}
	};

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
		this.k = clamp(pinch.k * (dist / pinch.startDist), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		this.tx = mid.x - pinch.wx * this.k;
		this.ty = mid.y - pinch.wy * this.k;
		this.moved = true;
		this.adjusted = true;
		this.hideTooltip();
		this.requestDraw();
	}

	private onPointerMove = (event: PointerEvent): void => {
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
				this.requestDraw();
			}
			this.setCursor(hit ? "pointer" : "grab");
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
			this.setCursor("grabbing");
		} else {
			const node = this.nodes.find((item) => item.id === dragging.id);
			if (node) {
				const world = this.screenToWorld(local.x, local.y);
				node.x = world.x + dragging.dx;
				node.y = world.y + dragging.dy;
				this.reheat(0.55);
			}
			this.setCursor("grabbing");
		}
		this.hideTooltip();
		this.requestDraw();
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (!this.alive) return;
		this.pointers.delete(event.pointerId);
		if (this.pinch) {
			if (this.pointers.size >= 2) return;
			this.pinch = null;
			this.setCursor("grab");
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
			this.setCursor("grab");
			if (wasDrag && dragging?.kind === "node") this.reheat(0.32);
			return;
		}
		if (dragging.kind === "node") {
			const node = this.nodes.find((item) => item.id === dragging.id) ?? null;
			this.selectedId = node?.id ?? null;
			this.setEngaged(node !== null);
			this.onSelect?.(node);
		} else {
			const local = this.localPoint(this.downX, this.downY);
			const node = this.hit(local.x, local.y);
			if (node) {
				this.selectedId = node.id;
				this.setEngaged(true);
				this.onSelect?.(node);
				this.draw();
				return;
			}
			const p = this.screenToWorld(local.x, local.y);
			let closest: GraphEdge | null = null, distance = 7 / this.k;
			for (const edge of this.edges) {
				if (!this.edgeShown(edge)) continue;
				const a = this.nodes.find(n => n.id === edge.source), b = this.nodes.find(n => n.id === edge.target);
				if (!a || !b || !this.isShown(a) || !this.isShown(b) || this.introOf(a) <= 0 || this.introOf(b) <= 0) continue;
				const dx = b.x-a.x, dy = b.y-a.y;
				const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
				const d = Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
				if (d < distance) { distance = d; closest = edge; }
			}
			if (closest && this.onEdgeSelect) { this.onEdgeSelect(closest); return; }
			this.selectedId = null;
			this.setEngaged(false);
			this.onSelect?.(null);
		}
		this.draw();
	};

	private onPointerLeave = (): void => {
		if (this.dragging) return;
		this.hoverId = null;
		this.refreshFocus();
		this.hideTooltip();
		this.draw();
	};

	private onKeyDown = (event: KeyboardEvent): void => {
		if (!this.alive) return;
		const panStep = 48;
		const key = event.key;
		if (key === "Delete") {
			event.preventDefault();
			this.onDeleteRequest?.();
			return;
		}
		if (key === "Escape") {
			event.preventDefault();
			// 阻止冒泡：app 层 root 上还有一个 Escape 监听，避免 showDetail(null) 跑两次。
			event.stopPropagation();
			this.selectedId = null;
			this.hoverId = null;
			this.setEngaged(false);
			this.onSelect?.(null);
			this.draw();
			return;
		}
		if ((key === "Enter" || key === " ") && this.selectedId) {
			event.preventDefault();
			this.onSelect?.(this.nodes.find((node) => node.id === this.selectedId) ?? null);
			return;
		}
		if (key === "ContextMenu" || (event.shiftKey && key === "F10")) {
			event.preventDefault();
			this.openNodeMenu(this.nodes.find((node) => node.id === this.selectedId) ?? null, true);
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
					this.setEngaged(true);
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
	};

	private placeTooltip(node: DrawNode | null, x: number, y: number): void {
		if (!node) {
			this.hideTooltip();
			return;
		}
		this.tooltip.hidden = false;
		if (this.tooltip.textContent !== node.title) {
			this.tooltip.textContent = node.title;
			this.tooltipSize = null;
		}
		this.tooltipSize ??= { width: this.tooltip.offsetWidth || 180, height: this.tooltip.offsetHeight || 32 };
		const { width, height } = this.tooltipSize;
		const left = x + width + 16 > this.cssWidth ? Math.max(8, x - width - 12) : x + 14;
		const top = y + height + 16 > this.cssHeight ? Math.max(8, y - height - 10) : y + 14;
		this.tooltip.style.left = `${left}px`;
		this.tooltip.style.top = `${top}px`;
	}

	private hideTooltip(): void {
		if (this.tooltip.hidden) return;
		this.tooltip.hidden = true;
		this.tooltip.textContent = "";
		this.tooltipSize = null;
	}

	private hit(sx: number, sy: number): DrawNode | null {
		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const node = this.nodes[i];
			if (!node || !node.shown || this.introOf(node) <= 0) continue;
			const x = node.x * this.k + this.tx;
			const y = node.y * this.k + this.ty;
			const dx = sx - x;
			const dy = sy - y;
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

	/** Coalesce pointer, zoom, physics and twinkle updates into one paint per frame. */
	private requestDraw(): void {
		if (!this.alive || this.drawFrame !== null) return;
		this.drawFrame = this.raf(() => {
			this.drawFrame = null;
			const target = this.zoomAnim;
			if (target) {
				const dk = target.k - this.k, dtx = target.tx - this.tx, dty = target.ty - this.ty;
				if (Math.abs(dk) < 0.002 && Math.abs(dtx) < 0.5 && Math.abs(dty) < 0.5) {
					this.k = target.k; this.tx = target.tx; this.ty = target.ty;
					this.zoomAnim = null;
				} else {
					this.k += dk * 0.3; this.tx += dtx * 0.3; this.ty += dty * 0.3;
				}
			}
			if (this.simAlpha > 0) {
				if (this.simAlpha < 0.02) {
					this.simAlpha = 0;
					this.captureStructure();
				} else {
					this.tick(this.simAlpha);
					this.simAlpha *= this.dragging?.kind === "node" ? 0.985 : 0.94;
				}
			}
			this.draw();
			if (this.pulsing || this.zoomAnim || this.simAlpha > 0 || this.introAt) this.requestDraw();
		});
	}

	private draw(): void {
		if (this.alive) this.syncIntro();
		const data = this.canvas.dataset;
		if (data) {
			data.zoom = this.k.toFixed(3);
			data.selected = this.selectedId ?? "";
			data.focus = this.focus ? "1" : "";
		}
		const ctx = this.ctx;
		if (!ctx || !this.alive) return;
		const width = this.cssWidth;
		const height = this.cssHeight;
		ctx.clearRect(0, 0, width, height);
		if (!this.night) {
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
		}
		if (this.layoutMode === "temporal") this.drawYearAxis(ctx);
		const byId = new Map(this.nodes.map((node) => [node.id, node]));
		const focus = this.focus;
		const focusEdges = this.night && focus !== null ? this.edges.filter(edge =>
			(edge.source === this.focusId || edge.target === this.focusId) &&
			byId.get(edge.source)?.shown && byId.get(edge.target)?.shown && this.edgeShown(edge),
		).length : 0;
		const glowAlpha = 0.13 * Math.sqrt(8 / Math.max(8, focusEdges));
		const reveal = this.reducedMotion ? 1 : clamp((performance.now() - this.focusStarted) / 180, 0, 1);
		ctx.lineCap = "round";
		for (const edge of this.edges) {
			const a = byId.get(edge.source);
			const b = byId.get(edge.target);
			if (!a || !b || !a.shown || !b.shown) continue;
			const appear = Math.min(this.introOf(a), this.introOf(b));
			if (appear <= 0) continue;
			const kind = relationKind(edge);
			if (!this.edgeShown(edge)) continue;
			const dimmed = focus !== null && !(focus.has(edge.source) && focus.has(edge.target));
			const focused = focus !== null && !dimmed && (!this.night || edge.source === this.focusId || edge.target === this.focusId);
			const ax = a.x * this.k + this.tx;
			const ay = a.y * this.k + this.ty;
			const bx = b.x * this.k + this.tx;
			const by = b.y * this.k + this.ty;
			const distance = Math.hypot(bx - ax, by - ay);
			const clearance = this.night && distance > 0 ? Math.min(0.65, distance * 0.9 / (a.radius + b.radius)) : 0;
			const ux = distance > 0 ? (bx - ax) / distance : 0;
			const uy = distance > 0 ? (by - ay) / distance : 0;
			// Dark constellation outlines stay below stars; focus retains relationship colors.
			const sameCommunity = this.communities.get(edge.source) === this.communities.get(edge.target);
			const relatedness = clamp(edge.structuralSimilarity === null ? 0 : edge.structuralSimilarity ?? edge.weight, 0, 1);
			const strokeStyle = dimmed
				? rgba(this.ink, this.night ? 0.035 : 0.08)
				: focused
					? hexRgba(RELATION_COLOR[kind], this.night ? 0.72 : 0.85)
					: this.night
						? rgba({ r: 155, g: 177, b: 215 }, (sameCommunity ? 0.24 : 0.14) + 0.12 * Math.sqrt(relatedness))
						: sameCommunity
						? rgba(this.ink, 0.28)
						: rgba(this.ink, 0.14);
			ctx.beginPath();
			ctx.moveTo(ax + ux * a.radius * clearance, ay + uy * a.radius * clearance);
			ctx.lineTo(bx - ux * b.radius * clearance, by - uy * b.radius * clearance);
			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = this.night
				? focused ? 1 + Math.sqrt(relatedness) * 0.3 : 0.5 + Math.sqrt(relatedness) * 0.5
				: clamp(0.55 + Math.sqrt(relatedness) * 1.4 + (focused ? 0.35 : 0), 0.55, 2.2);
			if (this.night && focused) {
				const tint = channelsFromCss(strokeStyle, this.ink);
				const pale = { r: tint.r * 0.65 + 220 * 0.35, g: tint.g * 0.65 + 230 * 0.35, b: tint.b * 0.65 + 250 * 0.35 };
				const outline = ctx.createLinearGradient(ax, ay, bx, by);
				outline.addColorStop(0, rgba(pale, 0.18));
				outline.addColorStop(0.2, rgba(pale, 0.82));
				outline.addColorStop(0.8, rgba(pale, 0.82));
				outline.addColorStop(1, rgba(pale, 0.18));
				ctx.strokeStyle = outline;
				const coreWidth = ctx.lineWidth;
				ctx.globalAlpha = glowAlpha * reveal * appear;
				ctx.lineWidth = 3;
				ctx.stroke();
				ctx.lineWidth = coreWidth;
				ctx.globalAlpha = (0.35 + 0.65 * reveal) * appear;
			} else ctx.globalAlpha = appear;
			ctx.stroke();
			ctx.globalAlpha = appear;
			if (kind !== "direct") continue;
			ctx.fillStyle = strokeStyle;
			if (edge.direct === "source-cites-target" || edge.direct === "mutual") strokeArrow(ctx, ax, ay, bx, by, b.radius * (this.night ? 1 : this.k), this.night, focused);
			if (edge.direct === "target-cites-source" || edge.direct === "mutual") strokeArrow(ctx, bx, by, ax, ay, a.radius * (this.night ? 1 : this.k), this.night, focused);
		}

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
		const yearBand = this.stage.parentElement?.querySelector<HTMLElement>(".cpo-year-band:not([hidden])");
		const bars = yearBand?.querySelector<HTMLElement>(".cpo-year-bars");
		const labelY = yearBand
			? Math.min(this.cssHeight - 7, yearBand.getBoundingClientRect().top - this.canvas.getBoundingClientRect().top - 6)
			: this.cssHeight - 7;
		if (bars) {
			const offset = bars.getBoundingClientRect().left - this.canvas.getBoundingClientRect().left;
			bars.style.setProperty("--year-origin", `${(yearSpan === 0 ? 0 : -width / 2) * this.k + this.tx - offset}px`);
			bars.style.setProperty("--year-step", `${yearSpan === 0 ? 0 : width / span * this.k}px`);
			bars.style.setProperty("--year-min", String(this.minYear));
		}

		const bottom = labelY - 19;
		const top = 24;
		const onScreen = (year: number): boolean => {
			const worldX = yearSpan === 0 ? 0 : ((year - this.minYear) / span - 0.5) * width;
			const x = worldX * this.k + this.tx;
			return x >= -20 && x <= this.cssWidth + 20;
		};
		const visible: number[] = [];
		for (let year = this.minYear; year <= this.maxYear; year += 1) {
			if (onScreen(year)) visible.push(year);
		}
		const ticks = visible.length <= 3
			? visible
			: [visible[0]!, visible[Math.floor((visible.length - 1) / 2)]!, visible[visible.length - 1]!];
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
			ctx.strokeStyle = rgba(this.ink, 0.16);
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.fillStyle = rgba(this.ink, 0.72);
			ctx.textAlign = x < 42 ? "left" : x > this.cssWidth - 42 ? "right" : "center";
			ctx.fillText(String(year), x, labelY);
		}
		const unknownX = (-width / 2 - 48) * this.k + this.tx;
		if (this.nodes.some((node) => node.year === null) && unknownX > 0 && unknownX < this.cssWidth) {
			ctx.fillStyle = rgba(this.ink, 0.72);
			ctx.textAlign = "center";
			ctx.fillText(tr("年份未知", "Year unknown"), unknownX, labelY);
		}
		ctx.restore();
	}

	private drawNode(ctx: CanvasRenderingContext2D, node: DrawNode): void {
		const x = node.x * this.k + this.tx;
		const y = node.y * this.k + this.ty;
		const radius = node.radius + (node.id === this.hoverId ? 1.6 : 0);
		const extent = radius + 32; // Include the longest rays, halos and selection rings.
		if (x + extent < 0 || y + extent < 0 || x - extent > this.cssWidth || y - extent > this.cssHeight) return;
		const dimmed = this.focus !== null && !this.focus.has(node.id);
		const active = node.id === this.hoverId || node.id === this.selectedId;
		const classic = this.classicGlow.has(node.id) && !node.isSeed;
		const importance = node.isSeed ? 1 : this.classicGlow.get(node.id) ?? 0;
		const moving = !this.reducedMotion;
		const detail = this.night ? active || classic ? 1 : clamp((this.k - 0.25) / 1.25, 0.15, 1) : 1;
		const beat = (classic || this.night && node.isSeed) && moving ? classicBreath(node.id, performance.now() * (this.night ? classic ? 0.7 : 0.45 : 1)) : 0;
		const twinkleFloor = classic ? 0.6 : 0.3;
		const twinkle = this.night && moving ? twinkleFloor + (1 - twinkleFloor) * classicBreath(node.id, performance.now() * 0.5) : 1;
		const color = this.colorMode === "graph" && active ? this.graphNodeFocused : node.color;
		const appear = this.introOf(node);
		if (appear <= 0) return;
		ctx.globalAlpha = (dimmed ? 0.25 : 1) * twinkle * appear;
		if (this.night) {
			const halo = (node.isSeed ? 10 + 2 * beat : classic ? 4 + 3 * beat : 3) * detail;
			const glow = ctx.createRadialGradient(x, y, 0, x, y, radius + halo);
			glow.addColorStop(0, withAlpha(color, (node.isSeed ? 0.5 : classic ? 0.3 + 0.08 * beat : 0.24) * detail));
			glow.addColorStop(0.45, withAlpha(color, 0.12 * detail));
			glow.addColorStop(1, withAlpha(color, 0));
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius + halo, 0, Math.PI * 2);
			ctx.fill();
		} else if (node.isSeed) {
			const glow = ctx.createRadialGradient(x, y, radius, x, y, radius + 22);
			glow.addColorStop(0, rgba(this.accent, 0.22));
			glow.addColorStop(1, rgba(this.accent, 0));
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius + 22, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		if (this.night) {
			const tint = channelsFromCss(color, this.accent);
			// Artistic warm/cool tint, not a temperature inferred from paper data.
			const warmth = clamp((tint.r - tint.b) / 160, -1, 1);
			const stellar = warmth < 0
				? { r: 255 + 95 * warmth, g: 245 + 45 * warmth, b: 235 - 20 * warmth }
				: { r: 255, g: 245 - 65 * warmth, b: 235 - 115 * warmth };
			const violet = clamp((Math.min(tint.r, tint.b) - tint.g) / 60, 0, 1);
			stellar.r += (207 - stellar.r) * violet;
			stellar.g += (164 - stellar.g) * violet;
			stellar.b += (255 - stellar.b) * violet;
			const core = ctx.createRadialGradient(x, y, 0, x, y, radius);
			const nucleus = clamp(1.2 / radius, 0.05, 0.24);
			core.addColorStop(0, rgba({ r: 235 + stellar.r * 0.08, g: 235 + stellar.g * 0.08, b: 235 + stellar.b * 0.08 }, 1));
			core.addColorStop(nucleus * 0.5, rgba(stellar, 1));
			core.addColorStop(nucleus, rgba({ r: stellar.r * 0.55 + tint.r * 0.45, g: stellar.g * 0.55 + tint.g * 0.45, b: stellar.b * 0.55 + tint.b * 0.45 }, 1));
			core.addColorStop(0.35, withAlpha(color, 0.85));
			core.addColorStop(0.7, withAlpha(color, 0.25));
			core.addColorStop(1, withAlpha(color, 0));
			ctx.fillStyle = core;
		} else ctx.fillStyle = color;
		ctx.fill();
		if (this.night && node.isSeed) {
			// Optical diffraction detail belongs to bright stars, not every data point.
			const axes = importance >= 0.7 ? 4 : 2;
			for (let axis = 0; axis < axes; axis++) {
				const angle = 0.25 + axis * Math.PI / axes;
				const reach = (radius + (4 + importance * 12) * detail) * (0.9 + 0.1 * beat) * (axis % 2 ? 0.65 : 1);
				const dx = Math.cos(angle) * reach;
				const dy = Math.sin(angle) * reach;
				const ray = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
				ray.addColorStop(0, withAlpha(color, 0));
				ray.addColorStop(0.5, withAlpha(color, (0.3 + 0.3 * importance + 0.12 * beat) * detail));
				ray.addColorStop(1, withAlpha(color, 0));
				ctx.beginPath();
				ctx.moveTo(x - dx, y - dy);
				ctx.lineTo(x + dx, y + dy);
				ctx.strokeStyle = ray;
				ctx.lineWidth = 0.6 + importance * 0.7;
				ctx.stroke();
			}
		}
		if (this.night && classic) {
			const axes = importance >= 0.7 ? 4 : 2;
			const tint = channelsFromCss(color, this.accent);
			const rayColor = { r: (tint.r + 255) / 2, g: (tint.g + 255) / 2, b: (tint.b + 255) / 2 };
			for (let axis = 0; axis < axes; axis++) {
				const angle = 0.25 + axis * Math.PI / axes;
				const reach = (radius + 9 + importance * 5 + 4 * beat) * (axis % 2 ? 0.8 : 1);
				const dx = Math.cos(angle) * reach;
				const dy = Math.sin(angle) * reach;
				const ray = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
				ray.addColorStop(0, rgba(rayColor, 0));
				ray.addColorStop(0.3, rgba(rayColor, 0.16 + 0.06 * beat));
				ray.addColorStop(0.5, rgba(rayColor, 0.7 + 0.2 * beat));
				ray.addColorStop(0.7, rgba(rayColor, 0.16 + 0.06 * beat));
				ray.addColorStop(1, rgba(rayColor, 0));
				ctx.beginPath();
				ctx.moveTo(x - dx, y - dy);
				ctx.lineTo(x + dx, y + dy);
				ctx.strokeStyle = ray;
				ctx.lineWidth = 3;
				const alpha = ctx.globalAlpha;
				ctx.globalAlpha *= 0.22;
				ctx.stroke();
				ctx.globalAlpha = alpha;
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		}
		// 峰值时淡化描边，让光晕从盘缘融出去。普通圆点不加外圈。
		if (classic && !this.night) {
			ctx.lineWidth = 1;
			ctx.strokeStyle = withAlpha(shadeColor(node.color, 0.85), Math.max(0.08, 1 - 0.92 * beat));
			ctx.stroke();
		}
		if (classic && !this.night) {
			drawClassicSelfGlow(ctx, x, y, radius, node.color, beat, this.classicGlow.get(node.id) ?? 0);
		}
		ctx.globalAlpha = (dimmed ? 0.25 : 1) * appear;
		if (node.isSeed) {
			ctx.beginPath();
			ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = rgba(this.accent, 1);
			ctx.stroke();
		}
		if (node.id === this.selectedId && (!node.isSeed || this.night) || this.night && node.id === this.hoverId) {
			ctx.beginPath();
			ctx.arc(x, y, radius + (node.isSeed ? 7 : 4), 0, Math.PI * 2);
			ctx.lineWidth = node.id === this.selectedId ? 2.4 : 1.2;
			ctx.strokeStyle = rgba(this.accent, 1);
			ctx.stroke();
		}
		if (dimmed) ctx.globalAlpha = 1;
	}

	private rebuild(nodes: readonly PaperNode[], resetView: boolean): void {
		const placed = new Map(placeLayout(this.layoutMode, nodes, this.edges, this.seedScore).map((node) => [node.id, node]));
		this.nodes = nodes.map((node) => {
			const at = placed.get(node.id);
			return {
				...node,
				x: at?.x ?? 0,
				y: at?.y ?? 0,
				homeX: at?.x ?? 0,
				homeY: at?.y ?? 0,
				radius: at?.radius ?? 8,
				color: this.colorOf(node),
				shown: this.isShown(node),
			};
		});
		this.maxWeight = this.edges.reduce((max, edge) => Math.max(max, edge.weight), 0.001);
		this.captureStructure();
		if (resetView) {
			this.selectedId = this.nodes.find((node) => node.isSeed)?.id ?? null;
			this.hoverId = null;
			this.setEngaged(false);
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
		if (this.colorMode === "community") {
			const community = this.communities.get(node.id) ?? 0;
			return community === 0 ? this.communityPrimary : communityColor(community);
		}
		if (this.colorMode === "year") return yearColor(node.year, this.minYear, this.maxYear);
		if (this.colorMode === "topic") {
			const seed = this.nodes.find((candidate) => candidate.isSeed);
			return topicSimilarityColor(topicSimilarity(node.topicTags, seed?.topicTags));
		}
		return this.graphNode;
	}

	private armIntro(): void {
		if (this.introQueued || !this.introHold) return;
		this.introQueued = true;
		queueMicrotask(() => {
			this.introQueued = false;
			this.startIntro();
		});
	}

	private startIntro(): void {
		if (!this.introHold) return;
		if (this.cssWidth < 2 || this.cssHeight < 2) return;
		this.introHold = false;
		if (this.reducedMotion || this.nodes.length < 2) {
			this.draw();
			return;
		}
		const visible = this.nodes.reduce((count, node) => count + (node.shown ? 1 : 0), 0);
		const timing = introTiming(visible);
		this.introSpread = timing.spread;
		this.introFade = timing.fade;
		this.introAt = performance.now();
		this.draw();
		this.requestDraw();
	}

	private syncIntro(): void {
		if (!this.introAt) return;
		const elapsed = performance.now() - this.introAt;
		if (this.reducedMotion || elapsed >= this.introSpread + this.introFade) {
			this.introAt = 0;
			this.frameRevealed();
			return;
		}
		const seed = this.nodes.find((node) => node.isSeed);
		if (!seed) {
			this.introAt = 0;
			return;
		}
		this.introSeedX = seed.x;
		this.introSeedY = seed.y;
		let span = 0;
		for (const node of this.nodes) {
			if (!node.shown) continue;
			span = Math.max(span, Math.hypot(node.x - seed.x, node.y - seed.y));
		}
		this.introSpan = span;
		this.frameRevealed();
	}

	private introOf(node: DrawNode): number {
		if (this.reducedMotion || !this.nodes.includes(node)) return 1;
		if (this.introHold) return node.isSeed ? 1 : 0;
		if (!this.introAt) return 1;
		const elapsed = performance.now() - this.introAt;
		if (elapsed < 0) return 1;
		return introAlpha(elapsed, Math.hypot(node.x - this.introSeedX, node.y - this.introSeedY), this.introSpan, this.introSpread, this.introFade);
	}

	private isShown(node: PaperNode): boolean {
		if (this.contentFilter) return nodeVisible(node, this.contentFilter);
		return node.isSeed || this.scrubYear === null || (node.year !== null && node.year <= this.scrubYear);
	}

	private edgeShown(edge: GraphEdge): boolean {
		if (!this.kindVisible[relationKind(edge)]) return false;
		if (!this.contentFilter) return true;
		return edgeVisible(edge, this.filterNodes, this.contentFilter);
	}

	private drawLabels(ctx: CanvasRenderingContext2D): void {
		const ranked = [...this.nodes].sort((a, b) => b.citedByCount - a.citedByCount || a.id.localeCompare(b.id));
		const rankOf = new Map(ranked.map((node, index) => [node.id, index]));
		const priority = (node: DrawNode): number => node.id === this.hoverId ? 5 : node.id === this.selectedId ? 4 : node.isSeed ? 3 : this.classicGlow.has(node.id) ? 2 : 1;
		const ordered = [...ranked].sort((a, b) => priority(b) - priority(a));
		const now = performance.now();
		const obstacles = this.nodes.filter(node => node.shown).map(node => ({ x: node.x * this.k + this.tx - node.radius - 4, y: node.y * this.k + this.ty - node.radius - 4, w: (node.radius + 4) * 2, h: (node.radius + 4) * 2 }));
		const byId = new Map(this.nodes.map(node => [node.id, node]));
		for (const edge of this.edges) {
			if (relationKind(edge) !== "direct" || !this.edgeShown(edge)) continue;
			const a = byId.get(edge.source), b = byId.get(edge.target);
			if (!a?.shown || !b?.shown) continue;
			const reserveArrow = (from: DrawNode, to: DrawNode): void => {
				const angle = Math.atan2(to.y - from.y, to.x - from.x);
				const offset = to.radius * (this.night ? 1 : this.k) + 5;
				obstacles.push({ x: to.x * this.k + this.tx - Math.cos(angle) * offset - 5, y: to.y * this.k + this.ty - Math.sin(angle) * offset - 5, w: 10, h: 10 });
			};
			if (edge.direct === "source-cites-target" || edge.direct === "mutual") reserveArrow(a, b);
			if (edge.direct === "target-cites-source" || edge.direct === "mutual") reserveArrow(b, a);
		}
		ctx.textBaseline = "middle";
		ctx.font = `11.5px ${this.fontFamily}`;
		ctx.textAlign = "left";
		const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const node of ordered) {
			if (!node.shown) { this.labelOpacity.delete(node.id); continue; }
			const appear = this.introOf(node);
			if (appear <= 0) continue;
			const strong = node.isSeed || node.id === this.selectedId || node.id === this.hoverId;
			const target = strong ? 1 : citationLabelAlpha(rankOf.get(node.id) ?? 99, this.k);
			const previous = this.labelOpacity.get(node.id);
			const alpha = !this.night || this.reducedMotion || strong ? target : previous
				? previous.value + (target - previous.value) * clamp((now - previous.at) / 140, 0, 1)
				: Math.min(0.15, target);
			this.labelOpacity.set(node.id, { value: alpha, at: now });
			if (alpha <= 0.02) continue;
			const maxWidth = Math.min(strong || (rankOf.get(node.id) ?? 99) <= 7 ? 168 : 140, this.cssWidth - 16);
			if (maxWidth < 20) continue;
			const lines = nodeLabel(node, this.labelMode).split("\n").filter(Boolean).map(text => fitText(ctx, text, maxWidth));
			if (!lines.length) continue;
			const cx = node.x * this.k + this.tx;
			const cy = node.y * this.k + this.ty;
			const w = Math.max(...lines.map(text => ctx.measureText(text).width)) + 6;
			const h = lines.length * 14 + 4;
			const gap = node.radius + (node.id === this.selectedId || node.id === this.hoverId ? 12 : 8);
			const candidates = [
				{ x: cx + gap, y: cy - 9, w, h },
				{ x: cx - gap - w, y: cy - 9, w, h },
				{ x: cx - w / 2, y: cy - gap - h, w, h },
				{ x: cx - w / 2, y: cy + gap, w, h },
			];
			const box = candidates.find(box => box.x >= 4 && box.y >= 4 && box.x + w <= this.cssWidth - 4 && box.y + h <= this.cssHeight - 4 && !overlaps(box, boxes) && !overlaps(box, obstacles));
			if (!box) { this.labelOpacity.delete(node.id); continue; }
			boxes.push(box);
			const dimmed = this.focus !== null && !this.focus.has(node.id);
			ctx.globalAlpha = (dimmed ? 0.35 * alpha : alpha) * appear;
			ctx.lineWidth = 3;
			ctx.strokeStyle = this.night ? "#0b1018" : this.bgEnd;
			ctx.fillStyle = strong ? rgba(this.ink, 1) : this.labelMuted;
			lines.forEach((text, index) => {
				ctx.strokeText(text, box.x + 3, box.y + 9 + index * 14);
				ctx.fillText(text, box.x + 3, box.y + 9 + index * 14);
			});
			ctx.globalAlpha = 1;
		}
		for (const id of this.labelOpacity.keys()) if (!byId.has(id)) this.labelOpacity.delete(id);
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
function shadeColor(color: string, factor: number): string {
	const base = channelsFromCss(color, { r: 58, g: 63, b: 69 });
	return `rgb(${Math.round(base.r * factor)}, ${Math.round(base.g * factor)}, ${Math.round(base.b * factor)})`;
}

/** Pure self-color breath: centroid falloff, bright at center → soft fade to outer edge. */
function drawClassicSelfGlow(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	color: string,
	beat: number,
	influence: number,
): void {
	const channels = parsedChannels(color);
	if (!channels) return;
	const { r: red, g: green, b: blue } = channels;
	const power = 0.4 + 0.6 * influence;
	const halo = (8 + 16 * beat) * power;
	const peak = (0.32 + 0.48 * beat) * power;
	const outer = radius + halo;
	// 质心最亮，经盘缘到外晕平滑减淡（多档色停避免断层）
	const glow = ctx.createRadialGradient(x, y, 0, x, y, outer);
	const rim = clamp(radius / Math.max(outer, 1), 0.15, 0.85);
	glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${peak})`);
	glow.addColorStop(rim * 0.45, `rgba(${red}, ${green}, ${blue}, ${peak * 0.78})`);
	glow.addColorStop(rim, `rgba(${red}, ${green}, ${blue}, ${peak * 0.42})`);
	glow.addColorStop(rim + (1 - rim) * 0.45, `rgba(${red}, ${green}, ${blue}, ${peak * 0.16})`);
	glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(x, y, outer, 0, Math.PI * 2);
	ctx.fill();
}

function parsedChannels(color: string): Rgb | null {
	const fallback: Rgb = { r: -1, g: -1, b: -1 };
	const channels = channelsFromCss(color, fallback);
	if (channels === fallback || channels.r < 0) return null;
	return channels;
}

function withAlpha(color: string, alpha: number): string {
	const channels = parsedChannels(color);
	if (!channels) return color;
	return rgba(channels, clamp(alpha, 0, 1));
}

function strokeArrow(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	nodeRadius: number,
	open = false,
	focused = false,
): void {
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const tipX = x2 - Math.cos(angle) * (nodeRadius + 2);
	const tipY = y2 - Math.sin(angle) * (nodeRadius + 2);
	const length = open ? 5 : 7;
	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(tipX - length * Math.cos(angle - 0.4), tipY - length * Math.sin(angle - 0.4));
	if (open) ctx.moveTo(tipX, tipY);
	ctx.lineTo(tipX - length * Math.cos(angle + 0.4), tipY - length * Math.sin(angle + 0.4));
	if (open) {
		ctx.save();
		ctx.strokeStyle = ctx.fillStyle;
		ctx.lineWidth = focused ? 1.1 : 0.7;
		ctx.globalAlpha = focused ? 1 : 0.6;
		ctx.stroke();
		ctx.restore();
		return;
	}
	ctx.closePath();
	ctx.fill();
}

function parkNear(x: number, y: number, id: string): { x: number; y: number } {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
	const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
	return { x: x + Math.cos(angle) * 36, y: y + Math.sin(angle) * 36 };
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
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
