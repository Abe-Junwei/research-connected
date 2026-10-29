import { mountGraphSurface } from "../src/graph-surface";
import { SimilarityMap } from "../src/map-canvas";
import type { PaperNode } from "../src/types";
import { nicholsSnapshot } from "../preview/work-identity-fixture";

export async function verifyMapResizeBrowser(): Promise<void> {
	const host = document.createElement("div");
	host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:350px;display:flex";
	document.body.append(host);
	const surface = mountGraphSurface(host, { canvasLabel: "resize regression", title: "", hint: "" });
	const map = new SimilarityMap(surface.canvas, surface.tooltip, surface.stage);
	try {
		(map as unknown as { reducedMotion: boolean }).reducedMotion = true;
		const snapshot = nicholsSnapshot();
		map.setGraph(snapshot.nodes, snapshot.edges, new Map());
		map.setViewState({ zoom: 1.5, centerX: 37, centerY: -23, selectedId: snapshot.seedId });
		for (const [width, height] of [[960, 640], [420, 280], [420, 280]]) {
			const before = map.getViewState();
			map.zoomBy(1.2);
			host.style.width = `${width}px`;
			host.style.height = `${height}px`;
			map.resize();
			const targetZoom = before.zoom * 1.2;
			for (let frame = 0; frame < 120; frame++) {
				await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
				if (Math.abs(map.getViewState().zoom - targetZoom) < 0.00001) break;
			}
			const after = map.getViewState();
			if (Math.abs(after.zoom - targetZoom) >= 0.00001) throw new Error("resize interrupted the pending zoom");
			const offsetX = Math.abs(after.centerX - before.centerX) * after.zoom;
			const offsetY = Math.abs(after.centerY - before.centerY) * after.zoom;
			if (offsetX > 0.5 || offsetY > 0.5) {
				throw new Error(`resizing during zoom displaced the graph center by ${offsetX.toFixed(1)}, ${offsetY.toFixed(1)} pixels at ${width}x${height}`);
			}
			if (after.selectedId !== before.selectedId) throw new Error("resize changed the selected paper");
		}
	} finally {
		map.destroy();
		host.remove();
	}
}

function cameraPaper(id: string, year: number, cited: number, seed: boolean): PaperNode {
	return {
		id, title: id, year, citedByCount: cited, authors: "Author", authorList: ["Author"],
		abstract: "", doiUrl: null, openAlexUrl: `https://openalex.org/${id}`, isSeed: seed,
		origin: seed ? "seed" : "citation", language: null, workType: "article", venue: null,
		retracted: false, concepts: [],
	};
}

function circleInside(node: { x: number; y: number; radius: number }, zoom: number, centerX: number, centerY: number, width: number, height: number): boolean {
	const sx = width / 2 + (node.x - centerX) * zoom;
	const sy = height / 2 + (node.y - centerY) * zoom;
	const radius = node.radius * zoom;
	return sx - radius >= -1 && sy - radius >= -1 && sx + radius <= width + 1 && sy + radius <= height + 1;
}

/** The reveal opens on the seed and finishes with every node inside the padded frame. */
export async function verifyIntroCamera(): Promise<void> {
	const host = document.createElement("div");
	host.style.cssText = "position:fixed;left:0;top:0;width:800px;height:500px;display:flex";
	document.body.append(host);
	const surface = mountGraphSurface(host, { canvasLabel: "intro camera", title: "", hint: "" });
	const map = new SimilarityMap(surface.canvas, surface.tooltip, surface.stage);
	const clock = map as unknown as { reducedMotion: boolean; introAt: number; introSpread: number; nodes: Array<{ id: string; x: number; y: number; radius: number; isSeed: boolean }> };
	try {
		clock.reducedMotion = false;
		map.setGraph([
			cameraPaper("W1", 2010, 80, true),
			cameraPaper("W2", 1990, 40, false),
			cameraPaper("W3", 2000, 20, false),
			cameraPaper("W4", 2024, 10, false),
		], [], new Map([["W1", 1]]));
		const width = surface.canvas.clientWidth;
		const height = surface.canvas.clientHeight;
		if (width < 200 || height < 200) throw new Error(`intro canvas is ${width}x${height}`);
		const fitted = map.getViewState();
		await Promise.resolve();
		const opened = map.getViewState();
		if (!(opened.zoom > fitted.zoom * 1.2)) throw new Error(`intro should open tighter than the full graph: ${opened.zoom} vs ${fitted.zoom}`);
		const far = clock.nodes.find((node) => node.id === "W2");
		const seed = clock.nodes.find((node) => node.isSeed);
		if (!far || !seed) throw new Error("intro fixture lost a node");
		if (circleInside(far, opened.zoom, opened.centerX, opened.centerY, width, height)) throw new Error("the farthest node should still be outside the opening frame");
		if (!circleInside(seed, opened.zoom, opened.centerX, opened.centerY, width, height)) throw new Error("the seed should fill the opening frame");
		if (Math.abs(opened.centerX - seed.x) > 1 || Math.abs(opened.centerY - seed.y) > 1) throw new Error("the opening frame should center the seed");
		const at = (fraction: number) => {
			clock.introAt = performance.now() - clock.introSpread * fraction;
			map.resize();
			return map.getViewState();
		};
		const early = at(0.2);
		const earlyNext = at(0.24);
		const mid = at(0.55);
		if (!(opened.zoom > early.zoom && early.zoom > earlyNext.zoom && earlyNext.zoom > mid.zoom)) throw new Error(`zoom is not a smooth zoom-out: ${opened.zoom} ${early.zoom} ${earlyNext.zoom} ${mid.zoom}`);
		const nearStep = Math.abs(Math.log(early.zoom / earlyNext.zoom));
		const longStep = Math.abs(Math.log(early.zoom / mid.zoom));
		if (!(nearStep < longStep)) throw new Error("a short interval changed the zoom as much as a long one");
		for (const view of [early, earlyNext, mid]) {
			if (Math.abs(view.centerX - seed.x) > 1 || Math.abs(view.centerY - seed.y) > 1) throw new Error("zooming moved the seed off center");
		}
		clock.introAt = performance.now() - (clock.introSpread + 800);
		map.resize();
		const ended = map.getViewState();
		if (Math.abs(ended.centerX - seed.x) > 1 || Math.abs(ended.centerY - seed.y) > 1) throw new Error("the seed should still be centered when the intro finishes");
		for (const node of clock.nodes) {
			if (!circleInside(node, ended.zoom, ended.centerX, ended.centerY, width, height)) throw new Error(`${node.id} is clipped after the intro`);
		}
	} finally {
		map.destroy();
		host.remove();
	}

	const heldHost = document.createElement("div");
	heldHost.style.cssText = "position:fixed;left:0;top:0;width:800px;height:500px;display:flex";
	document.body.append(heldHost);
	const heldSurface = mountGraphSurface(heldHost, { canvasLabel: "intro camera held", title: "", hint: "" });
	const held = new SimilarityMap(heldSurface.canvas, heldSurface.tooltip, heldSurface.stage);
	try {
		(held as unknown as { reducedMotion: boolean }).reducedMotion = false;
		held.setGraph([cameraPaper("W1", 2010, 80, true), cameraPaper("W2", 1990, 40, false)], [], new Map([["W1", 1]]));
		const restored = held.getViewState();
		const keptNodes = held as unknown as { introAt: number; nodes: Array<{ x: number; y: number; isSeed: boolean }> };
		const keptSeed = keptNodes.nodes.find((node) => node.isSeed);
		held.setViewState({ ...restored, zoom: 1, centerX: 0, centerY: 0 });
		await Promise.resolve();
		const opened = held.getViewState();
		if (!(opened.zoom > restored.zoom * 1.2)) throw new Error(`the placeholder zoom must not freeze the intro: ${opened.zoom} vs ${restored.zoom}`);
		if (!keptSeed || Math.abs(opened.centerX - keptSeed.x) > 1 || Math.abs(opened.centerY - keptSeed.y) > 1) throw new Error("placeholder zoom should still open on the seed");
		keptNodes.introAt = performance.now() - 4000;
		held.resize();
		const kept = held.getViewState();
		if (!keptSeed || Math.abs(kept.centerX - keptSeed.x) > 1 || Math.abs(kept.centerY - keptSeed.y) > 1) throw new Error("the seed should stay centered after the placeholder zoom");
	} finally {
		held.destroy();
		heldHost.remove();
	}
}
