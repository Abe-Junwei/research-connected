import { SimilarityMap } from "../src/map-canvas";
import { mountGraphSurface } from "../src/graph-surface";
import { syntheticGraph } from "./perf-fixture";

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };

/** Count expensive operations rather than asserting machine-dependent wall time. */
export function verifyMapInteractionBrowser(): void {
	const host = document.createElement("div");
	host.style.cssText = "width:1000px;height:700px;display:flex";
	document.body.append(host);
	const surface = mountGraphSurface(host, { canvasLabel: "performance", title: "", hint: "" });
	const map = new SimilarityMap(surface.canvas, surface.tooltip, surface.stage);
	const internal = map as unknown as {
		nodes: Array<{ id: string; x: number; y: number; radius: number; isSeed: boolean }>;
		night: boolean; reducedMotion: boolean; introAt: number; introHold: boolean;
		classicGlow: Map<string, number>;
		simAlpha: number;
		tick(alpha: number): void;
		drawNode(ctx: CanvasRenderingContext2D, node: unknown): void;
		drawLabels(ctx: CanvasRenderingContext2D): void;
		drawStarCore(ctx: CanvasRenderingContext2D, node: unknown, x: number, y: number, radius: number, color: string): void;
		paintStarCore(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void;
	};
	try {
		map.setLayout("radial");
		const graph = syntheticGraph(300);
		map.setGraph(graph.nodes, [], graph.seedScore);
		internal.night = true; internal.reducedMotion = false; internal.introAt = 0; internal.introHold = false;
		internal.classicGlow.clear();
		map.setViewState({ zoom: 1.5, centerX: 0, centerY: 0, selectedId: null });
		const node = internal.nodes.find(node => !node.isSeed)!;
		node.x = 0; node.y = 0;
		map.setLayout("force2d");
		internal.simAlpha = 0;
		const positions = internal.nodes.map(node => [node.id, node.x, node.y]);
		map.adoptGraph(graph.nodes.map(node => ({ ...node })), [], graph.seedScore);
		check(internal.simAlpha === 0, "metadata/view refresh must not restart node physics");
		map.resize();
		map.setViewState({ zoom: 1.4, centerX: 30, centerY: 20, selectedId: null });
		check(JSON.stringify(internal.nodes.map(node => [node.id, node.x, node.y])) === JSON.stringify(positions), "resizing/panning changes the camera, not node positions");
		const ctx = surface.canvas.getContext("2d")!;
		internal.drawNode(ctx, node);
		const radial = ctx.createRadialGradient.bind(ctx);
		let gradients = 0;
		ctx.createRadialGradient = (...args) => { gradients++; return radial(...args); };
		try { internal.drawNode(ctx, node); }
		finally { ctx.createRadialGradient = radial; }
		check(gradients <= 1, `warm star reuses its core while its halo stays dynamic: ${gradients} gradients`);
		const expected = document.createElement("canvas"), actual = document.createElement("canvas");
		const dpr = Math.max(1, surface.canvas.width / surface.stage.clientWidth);
		expected.width = expected.height = actual.width = actual.height = Math.ceil(32 * dpr);
		const reference = expected.getContext("2d")!, cached = actual.getContext("2d")!;
		reference.scale(dpr, dpr); cached.scale(dpr, dpr);
		for (const [radius, color] of [[5, "#58a6df"], [6.6, "#58a6df"], [6.6, "#df8858"]] as const) {
			reference.clearRect(0, 0, 32, 32); cached.clearRect(0, 0, 32, 32);
			internal.paintStarCore(reference, 16, 16, radius, color);
			internal.drawStarCore(cached, node, 16, 16, radius, color);
			const before = reference.getImageData(0, 0, expected.width, expected.height).data;
			const after = cached.getImageData(0, 0, actual.width, actual.height).data;
			const error = before.reduce((sum, value, index) => sum + Math.abs(value - after[index]!), 0) / before.length;
			check(error < 2, `cached core preserves appearance after radius/color changes: mean channel error ${error}`);
		}
		// Far-apart nodes do not need pairwise square roots during a drag tick.
		internal.nodes.forEach((node, index) => { node.x = index * 100; node.y = 0; });
		const hypot = Math.hypot;
		let distances = 0;
		Math.hypot = (...args) => { distances++; return hypot(...args); };
		try { internal.tick(0.55); }
		finally { Math.hypot = hypot; }
		check(distances < 3000, `sparse drag tick skips distant pair distances: ${distances}`);
		check(internal.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)), "drag tick keeps finite coordinates");
		const editedBook = { ...graph.nodes[0]!, authorList: [], authors: "Author unknown", editorList: ["FirstExtremelyLongSurname", "SecondExtremelyLongSurname", "Third Editor"], year: 2017 };
		map.setGraph([editedBook], [], new Map());
		map.setViewState({ zoom: 1.5, centerX: 0, centerY: 0, selectedId: null });
		const drawn: string[] = [];
		const fillText = ctx.fillText.bind(ctx);
		ctx.fillText = (text, x, y, maxWidth) => { drawn.push(text); if (maxWidth === undefined) fillText(text, x, y); else fillText(text, x, y, maxWidth); };
		try { internal.drawLabels(ctx); } finally { ctx.fillText = fillText; }
		check(drawn.some(text => text.startsWith("First")) && drawn.some(text => text.startsWith("Second")), "long multi-editor labels retain both people on separate lines");
		check(drawn.some(text => /等（编） 2017|et al\. \(eds\.\) 2017/.test(text)), "label truncation must preserve the additional-contributor and editor markers");
		internal.simAlpha = 0;
		map.adoptGraph([editedBook, { ...graph.nodes[1]!, id: "W999999999", isSeed: false }], [], new Map(), editedBook.id);
		check(internal.simAlpha > 0, "adding a node still relaxes the new neighborhood");
	} finally { map.destroy(); host.remove(); }
}
