import {
	AmbientLight,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PerspectiveCamera,
	Raycaster,
	Scene,
	SphereGeometry,
	MOUSE,
	SRGBColorSpace,
	TOUCH,
	TorusGeometry,
	Vector2,
	Vector3,
	WebGLRenderer,
	type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { communityColor, detectCommunities } from "./communities";
import {
	edgeVisible,
	evidenceText,
	focusNodes,
	nodeVisible,
	strengthTier,
	TIER_RADIUS,
	type GraphFilter,
} from "./graph-filter";
import type { LabelMode } from "./labels";
import { nodeLabel } from "./labels";
import { placeLayout, type ColorMode, type LayoutMode } from "./layout-modes";
import type { SimilarityGraph } from "./neighborhood";
import { RELATION_COLOR, relationKind } from "./relation";
import type { GraphEdge, PaperNode } from "./types";
import { yearColor } from "./visual";

export interface Graph3DHandle {
	destroy(): void;
	resize(): void;
	/** Factor above 1 moves the camera closer. */
	zoomBy(factor: number): void;
	frame(): void;
	setFilter(next: GraphFilter): void;
	setLayout(next: LayoutMode): void;
	setColorMode(next: ColorMode): void;
}

export interface Graph3DOptions {
	labels: LabelMode;
	filter: GraphFilter;
	layout: LayoutMode;
	colorMode: ColorMode;
}

interface SphereEntry {
	id: string;
	mesh: Mesh;
	title: string;
	label: HTMLElement | null;
	cited: number;
	seed: boolean;
	dim: boolean;
}

interface DrawnEdge {
	edge: GraphEdge;
	ax: number;
	ay: number;
	az: number;
	bx: number;
	by: number;
	bz: number;
	aRadius: number;
	bRadius: number;
}

/**
 * WebGL similarity cloud. Wheel zooms. Flat layouts pan on left-drag and
 * rotate on right-drag; the 3D layout rotates on left-drag and pans on right-drag.
 * A click that does not drag selects a paper or the nearer end of an edge.
 */
export function mountGraph3D(
	viewport: HTMLElement,
	tooltip: HTMLElement,
	graph: SimilarityGraph,
	onSelect: (paper: PaperNode | null, link: GraphEdge | null) => void,
	options: Graph3DOptions,
): Graph3DHandle {
	let filter = options.filter;
	let layoutMode = options.layout;
	let colorMode = options.colorMode;
	const renderer = new WebGLRenderer({ antialias: true, alpha: false });
	if (!renderer.getContext()) {
		renderer.dispose();
		throw new Error("无法创建 WebGL，这段嵌入显示不了三维图谱。");
	}
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.setClearColor(0x0c0e13, 1);
	const canvas = renderer.domElement;
	canvas.className = "cpo-embed-canvas";
	viewport.append(canvas);

	const labelLayer = document.createElement("div");
	labelLayer.className = "cpo-embed-labels";
	viewport.append(labelLayer);

	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 0.7));
	const key = new DirectionalLight(0xffffff, 1.15);
	key.position.set(120, 180, 80);
	scene.add(key);

	const papers = new Map(graph.nodes.map((node) => [node.id, node]));
	const communities = detectCommunities(
		graph.nodes.map((node) => node.id),
		graph.edges,
	);
	const years = graph.nodes.map((node) => node.year).filter((year): year is number => year !== null);
	const minYear = years.length ? Math.min(...years) : 0;
	const maxYear = years.length ? Math.max(...years) : 0;
	const nodeColor = (node: PaperNode): string => {
		if (colorMode === "community") return communityColor(communities.get(node.id) ?? 0);
		return yearColor(node.year, minYear, maxYear);
	};
	let placed = placeLayout(layoutMode, graph.nodes, graph.edges, graph.seedScore);
	const byId = new Map(placed.map((node) => [node.id, node]));
	const sphere = new SphereGeometry(1, 22, 16);
	const entries: SphereEntry[] = [];
	const geometries: Array<SphereGeometry | CylinderGeometry | TorusGeometry | ConeGeometry> = [sphere];
	const materials: Material[] = [];

	for (const node of graph.nodes) {
		const at = byId.get(node.id);
		if (!at) continue;
		const material = new MeshStandardMaterial({
			color: colorToHex(nodeColor(node)),
			roughness: 0.42,
			metalness: 0.08,
			emissive: node.isSeed ? 0xfff1cc : 0x000000,
			emissiveIntensity: node.isSeed ? 0.4 : 0,
			transparent: true,
			opacity: 1,
		});
		materials.push(material);
		const mesh = new Mesh(sphere, material);
		mesh.position.set(at.x, at.y, at.z);
		mesh.scale.setScalar(at.radius);
		mesh.userData.paperId = node.id;
		mesh.userData.seed = node.isSeed;
		if (node.isSeed) {
			const ringMaterial = new MeshBasicMaterial({ color: 0xfff8e6 });
			materials.push(ringMaterial);
			const torus = new TorusGeometry(1.42, 0.05, 8, 40);
			geometries.push(torus);
			const ringA = new Mesh(torus, ringMaterial);
			const ringB = new Mesh(torus, ringMaterial);
			ringB.rotation.x = Math.PI / 2;
			mesh.add(ringA, ringB);
		}
		scene.add(mesh);
		const text = nodeLabel(node, options.labels);
		let label: HTMLElement | null = null;
		if (text) {
			label = document.createElement("div");
			label.className = options.labels === "both" ? "cpo-embed-label is-both" : "cpo-embed-label";
			label.textContent = text;
			labelLayer.append(label);
		}
		entries.push({
			id: node.id,
			mesh,
			title: node.title,
			label,
			cited: node.citedByCount,
			seed: node.isSeed,
			dim: false,
		});
	}

	const drawn = drawEdges(graph, byId, scene, geometries, materials);

	const camera = new PerspectiveCamera(45, 1, 0.1, 4000);
	const controls = new OrbitControls(camera, canvas);
	controls.target.set(0, 0, 0);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.enablePan = true;
	controls.screenSpacePanning = true;

	const applyPointerMode = (): void => {
		const flat = layoutMode !== "force3d";
		controls.mouseButtons.LEFT = flat ? MOUSE.PAN : MOUSE.ROTATE;
		controls.mouseButtons.MIDDLE = MOUSE.DOLLY;
		controls.mouseButtons.RIGHT = flat ? MOUSE.ROTATE : MOUSE.PAN;
		controls.touches.ONE = flat ? TOUCH.PAN : TOUCH.ROTATE;
		controls.touches.TWO = TOUCH.DOLLY_PAN;
	};
	applyPointerMode();

	const frameCamera = (): void => {
		let maxReach = 80;
		for (const entry of entries) {
			const at = entry.mesh.position;
			maxReach = Math.max(maxReach, Math.hypot(at.x, at.y, at.z) + 24);
		}
		controls.minDistance = Math.max(30, maxReach * 0.25);
		controls.maxDistance = maxReach * 5;
		if (layoutMode === "force3d") camera.position.set(maxReach * 0.2, maxReach * 0.35, maxReach * 1.45);
		else camera.position.set(0, maxReach * 0.08, maxReach * 1.65);
		controls.target.set(0, 0, 0);
		controls.update();
	};
	frameCamera();

	const raycaster = new Raycaster();
	const pointer = new Vector2();
	const projected = new Vector3();
	let alive = true;
	let raf = 0;
	let running = false;
	let selectedId: string | null = graph.nodes.find((node) => node.isSeed)?.id ?? null;
	let hoverId: string | null = null;
	let downX = 0;
	let downY = 0;
	let moved = false;

	const paint = (): void => {
		for (const entry of entries) {
			const material = entry.mesh.material;
			if (!(material instanceof MeshStandardMaterial)) continue;
			if (entry.id === selectedId) {
				material.emissive.set(0xfff4d0);
				material.emissiveIntensity = 0.62;
			} else if (entry.id === hoverId) {
				material.emissive.set(0xffffff);
				material.emissiveIntensity = 0.28;
			} else if (entry.seed) {
				material.emissive.set(0xfff1cc);
				material.emissiveIntensity = 0.4;
			} else {
				material.emissive.set(0x000000);
				material.emissiveIntensity = 0;
			}
			material.opacity = entry.dim ? 0.16 : 1;
			material.depthWrite = !entry.dim;
		}
	};

	const resize = (): void => {
		const width = Math.max(1, viewport.clientWidth);
		const height = Math.max(1, viewport.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(width, height, false);
		camera.aspect = width / Math.max(1, height);
		camera.updateProjectionMatrix();
	};

	const showTooltip = (text: string, x: number, y: number): void => {
		const width = viewport.clientWidth;
		tooltip.hidden = false;
		tooltip.style.whiteSpace = text.includes("\n") ? "pre-line" : "normal";
		tooltip.textContent = text;
		const tipWidth = tooltip.offsetWidth || 180;
		const left = x + tipWidth + 16 > width ? Math.max(8, x - tipWidth - 12) : x + 12;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${Math.max(8, y + 12)}px`;
	};

	const placeTooltipAtNode = (entry: SphereEntry): void => {
		projected.copy(entry.mesh.position).project(camera);
		if (projected.z > 1) {
			tooltip.hidden = true;
			return;
		}
		const width = viewport.clientWidth;
		const height = viewport.clientHeight;
		const x = (projected.x * 0.5 + 0.5) * width;
		const y = (-projected.y * 0.5 + 0.5) * height;
		showTooltip(entry.title, x, y);
	};

	const setPointer = (event: PointerEvent): boolean => {
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return false;
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);
		return true;
	};

	const pick = (event: PointerEvent): { node: SphereEntry | null; edge: DrawnEdge | null } => {
		if (!setPointer(event)) return { node: null, edge: null };
		const nodeHits = raycaster.intersectObjects(
			entries.map((entry) => entry.mesh),
			true,
		);
		let node: SphereEntry | null = null;
		let nodeDistance = Infinity;
		let current: Object3D | null = nodeHits[0]?.object ?? null;
		nodeDistance = nodeHits[0]?.distance ?? Infinity;
		while (current) {
			const id = current.userData.paperId;
			if (typeof id === "string") {
				node = entries.find((item) => item.id === id) ?? null;
				break;
			}
			current = current.parent;
		}
		const edgeHits = drawn.hitMesh
			? raycaster.intersectObject(drawn.hitMesh, false)
			: [];
		const edgeHit = edgeHits[0];
		const edge =
			edgeHit && typeof edgeHit.instanceId === "number" ? drawn.edges[edgeHit.instanceId] ?? null : null;
		if (node && edgeHit && nodeDistance <= edgeHit.distance + 2) return { node, edge: null };
		if (edge && edgeHit && (!node || edgeHit.distance + 2 < nodeDistance)) return { node: null, edge };
		return { node, edge: null };
	};

	const placeLabels = (): void => {
		if (options.labels === "off") return;
		const width = viewport.clientWidth;
		const height = viewport.clientHeight;
		const gap = options.labels === "both" ? 58 : 44;
		const ranked = [...entries].sort(
			(a, b) => Number(b.seed) - Number(a.seed) || b.cited - a.cited || a.id.localeCompare(b.id),
		);
		const kept: Array<{ x: number; y: number }> = [];
		for (const entry of ranked) {
			const el = entry.label;
			if (!el) continue;
			projected.copy(entry.mesh.position).project(camera);
			const force = entry.id === selectedId || entry.id === hoverId || entry.seed;
			if (projected.z > 1) {
				el.hidden = true;
				continue;
			}
			const x = (projected.x * 0.5 + 0.5) * width;
			const y = (-projected.y * 0.5 + 0.5) * height;
			const crowded = kept.some((spot) => Math.hypot(spot.x - x, spot.y - y) < gap);
			if (!entry.mesh.visible || entry.dim) {
				el.hidden = true;
				continue;
			}
			if (!force && (crowded || x < -20 || y < -20 || x > width + 20 || y > height + 20)) {
				el.hidden = true;
				continue;
			}
			el.hidden = false;
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
			kept.push({ x, y });
		}
	};

	const frame = (): void => {
		if (!alive || !running) return;
		raf = window.requestAnimationFrame(frame);
		controls.update();
		renderer.render(scene, camera);
		placeLabels();
	};
	const start = (): void => {
		if (running || !alive) return;
		running = true;
		frame();
	};
	const stop = (): void => {
		running = false;
		if (raf) window.cancelAnimationFrame(raf);
		raf = 0;
	};

	const syncView = (): void => {
		const seedId = graph.nodes.find((node) => node.isSeed)?.id ?? "";
		const active =
			selectedId && selectedId !== seedId
				? focusNodes(
						selectedId,
						seedId,
						graph.edges,
						(edge) => edgeVisible(edge, papers, filter),
						filter.focusPath,
					)
				: null;
		for (const entry of entries) {
			const paper = papers.get(entry.id);
			const shown = paper ? nodeVisible(paper, filter) : false;
			entry.mesh.visible = shown;
			entry.dim = Boolean(shown && active && !active.has(entry.id));
		}
		drawn.sync((edge) => edgeVisible(edge, papers, filter), active);
		paint();
	};

	const endpoint = (edge: GraphEdge): PaperNode | null => {
		const a = papers.get(edge.source) ?? null;
		const b = papers.get(edge.target) ?? null;
		if (!a || !b) return a ?? b;
		if (a.isSeed) return b;
		if (b.isSeed) return a;
		if (selectedId === a.id) return b;
		if (selectedId === b.id) return a;
		return (graph.seedScore.get(b.id) ?? 0) > (graph.seedScore.get(a.id) ?? 0) ? b : a;
	};

	const onPointerDown = (event: PointerEvent): void => {
		downX = event.clientX;
		downY = event.clientY;
		moved = false;
	};
	const onPointerMove = (event: PointerEvent): void => {
		if (event.buttons && Math.hypot(event.clientX - downX, event.clientY - downY) > 4) {
			moved = true;
			tooltip.hidden = true;
			canvas.style.cursor = "grabbing";
			return;
		}
		const hit = pick(event);
		const next = hit.node?.id ?? null;
		if (next !== hoverId) {
			hoverId = next;
			paint();
		}
		canvas.style.cursor = hit.node || hit.edge ? "pointer" : "grab";
		if (hit.node) {
			placeTooltipAtNode(hit.node);
			return;
		}
		if (hit.edge) {
			const source = papers.get(hit.edge.edge.source);
			const target = papers.get(hit.edge.edge.target);
			if (source && target) {
				const rect = viewport.getBoundingClientRect();
				showTooltip(evidenceText(hit.edge.edge, source, target), event.clientX - rect.left, event.clientY - rect.top);
				return;
			}
		}
		tooltip.hidden = true;
	};
	const onPointerUp = (event: PointerEvent): void => {
		if (moved) {
			canvas.style.cursor = "grab";
			return;
		}
		const hit = pick(event);
		if (hit.edge && !hit.node) {
			const paper = endpoint(hit.edge.edge);
			selectedId = paper?.id ?? null;
			hoverId = selectedId;
			paint();
			onSelect(paper, hit.edge.edge);
			syncView();
			return;
		}
		selectedId = hit.node?.id ?? null;
		const paper = hit.node ? papers.get(hit.node.id) ?? null : null;
		onSelect(paper, null);
		syncView();
	};
	const onPointerLeave = (): void => {
		hoverId = null;
		tooltip.hidden = true;
		canvas.style.cursor = "grab";
		paint();
	};
	const onWheel = (event: WheelEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);
	canvas.addEventListener("pointerleave", onPointerLeave);
	canvas.addEventListener("wheel", onWheel, { passive: false });
	canvas.style.cursor = "grab";
	canvas.style.touchAction = "none";

	const resizeObserver = new ResizeObserver(() => resize());
	resizeObserver.observe(viewport);
	const visibility = new IntersectionObserver((records) => {
		const visible = records.some((record) => record.isIntersecting);
		if (visible) start();
		else stop();
	});
	visibility.observe(viewport);

	resize();
	paint();
	start();
	syncView();
	const seed = graph.nodes.find((node) => node.isSeed) ?? null;
	if (seed) onSelect(seed, null);

	const applyColors = (): void => {
		for (const entry of entries) {
			const paper = papers.get(entry.id);
			const material = entry.mesh.material;
			if (!paper || !(material instanceof MeshStandardMaterial)) continue;
			material.color.set(colorToHex(nodeColor(paper)));
		}
	};

	const applyLayout = (mode: LayoutMode): void => {
		layoutMode = mode;
		placed = placeLayout(mode, graph.nodes, graph.edges, graph.seedScore);
		const next = new Map(placed.map((node) => [node.id, node]));
		for (const entry of entries) {
			const at = next.get(entry.id);
			if (!at) continue;
			entry.mesh.position.set(at.x, at.y, at.z);
		}
		drawn.relayout(next);
		applyPointerMode();
		frameCamera();
	};

	const zoomBy = (factor: number): void => {
		if (!Number.isFinite(factor) || factor <= 0) return;
		const offset = camera.position.clone().sub(controls.target);
		const distance = offset.length();
		if (distance < 1e-3) return;
		const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, distance / factor));
		offset.multiplyScalar(next / distance);
		camera.position.copy(controls.target).add(offset);
		controls.update();
	};

	return {
		resize,
		zoomBy,
		frame: frameCamera,
		setFilter(next: GraphFilter): void {
			filter = next;
			syncView();
		},
		setLayout(next: LayoutMode): void {
			applyLayout(next);
		},
		setColorMode(next: ColorMode): void {
			colorMode = next;
			applyColors();
		},
		destroy() {
			if (!alive) return;
			alive = false;
			stop();
			resizeObserver.disconnect();
			visibility.disconnect();
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUp);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			canvas.removeEventListener("wheel", onWheel);
			controls.dispose();
			for (const geometry of geometries) geometry.dispose();
			for (const material of materials) material.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
			canvas.remove();
			labelLayer.remove();
			tooltip.hidden = true;
		},
	};
}

function drawEdges(
	graph: SimilarityGraph,
	byId: ReadonlyMap<string, { x: number; y: number; z: number; radius: number }>,
	scene: Scene,
	geometries: Array<SphereGeometry | CylinderGeometry | TorusGeometry | ConeGeometry>,
	materials: Material[],
): {
	edges: DrawnEdge[];
	hitMesh: InstancedMesh | null;
	sync: (visible: (edge: GraphEdge) => boolean, focus: Set<string> | null) => void;
	relayout: (at: ReadonlyMap<string, { x: number; y: number; z: number; radius: number }>) => void;
} {
	const edges: DrawnEdge[] = [];
	for (const edge of graph.edges) {
		const a = byId.get(edge.source);
		const b = byId.get(edge.target);
		if (!a || !b) continue;
		if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 0.5) continue;
		edges.push({
			edge,
			ax: a.x,
			ay: a.y,
			az: a.z,
			bx: b.x,
			by: b.y,
			bz: b.z,
			aRadius: a.radius,
			bRadius: b.radius,
		});
	}
	if (edges.length === 0) {
		return { edges, hitMesh: null, sync: () => undefined, relayout: () => undefined };
	}

	const shaft = new CylinderGeometry(1, 1, 1, 6, 1);
	const head = new ConeGeometry(1, 1, 8);
	geometries.push(shaft, head);
	const visibleMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.92 });
	const hitMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
	const arrowMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.95 });
	materials.push(visibleMaterial, hitMaterial, arrowMaterial);
	const visibleMesh = new InstancedMesh(shaft, visibleMaterial, edges.length);
	const hitMesh = new InstancedMesh(shaft, hitMaterial, edges.length);
	const arrowMesh = new InstancedMesh(head, arrowMaterial, edges.length * 2);
	const dummy = new Object3D();
	const direction = new Vector3();
	const up = new Vector3(0, 1, 0);
	const dim = new Color(0x3a4154);

	const hide = (): void => {
		dummy.position.set(0, -100000, 0);
		dummy.quaternion.identity();
		dummy.scale.set(0.001, 0.001, 0.001);
		dummy.updateMatrix();
	};

	const placeShaft = (index: number, item: DrawnEdge, radius: number): void => {
		const length = Math.hypot(item.bx - item.ax, item.by - item.ay, item.bz - item.az) || 0.5;
		direction.set(item.bx - item.ax, item.by - item.ay, item.bz - item.az).multiplyScalar(1 / length);
		dummy.position.set((item.ax + item.bx) / 2, (item.ay + item.by) / 2, (item.az + item.bz) / 2);
		dummy.quaternion.setFromUnitVectors(up, direction);
		dummy.scale.set(radius, length, radius);
		dummy.updateMatrix();
		visibleMesh.setMatrixAt(index, dummy.matrix);
	};

	const placeArrow = (slot: number, x: number, y: number, z: number, radius: number, towardX: number, towardY: number, towardZ: number): void => {
		direction.set(towardX, towardY, towardZ);
		const span = direction.length() || 1;
		direction.multiplyScalar(1 / span);
		const height = 16;
		dummy.quaternion.setFromUnitVectors(up, direction);
		dummy.position.set(
			x - direction.x * (radius + height / 2),
			y - direction.y * (radius + height / 2),
			z - direction.z * (radius + height / 2),
		);
		dummy.scale.set(4.4, height, 4.4);
		dummy.updateMatrix();
		arrowMesh.setMatrixAt(slot, dummy.matrix);
	};

	let lastVisible: (edge: GraphEdge) => boolean = () => true;
	let lastFocus: Set<string> | null = null;
	const sync = (visible: (edge: GraphEdge) => boolean, focus: Set<string> | null): void => {
		lastVisible = visible;
		lastFocus = focus;
		let arrowSlot = 0;
		for (let i = 0; i < edges.length; i++) {
			const item = edges[i];
			if (!item) continue;
			const shown = visible(item.edge);
			const emphasized = !focus || (focus.has(item.edge.source) && focus.has(item.edge.target));
			if (!shown) {
				hide();
				visibleMesh.setMatrixAt(i, dummy.matrix);
				hitMesh.setMatrixAt(i, dummy.matrix);
				continue;
			}
			const tier = strengthTier(item.edge);
			const radius = emphasized ? TIER_RADIUS[tier] : TIER_RADIUS.weak * 0.7;
			placeShaft(i, item, radius);
			visibleMesh.setColorAt(i, emphasized ? new Color(RELATION_COLOR[relationKind(item.edge)]) : dim);
			dummy.scale.set(Math.max(radius, 1.8), dummy.scale.y, Math.max(radius, 1.8));
			dummy.updateMatrix();
			hitMesh.setMatrixAt(i, dummy.matrix);
			if (!emphasized || relationKind(item.edge) !== "direct") continue;
			const kind = item.edge.direct;
			if (kind === "source-cites-target" || kind === "mutual") {
				placeArrow(arrowSlot, item.bx, item.by, item.bz, item.bRadius, item.bx - item.ax, item.by - item.ay, item.bz - item.az);
				arrowMesh.setColorAt(arrowSlot, new Color(RELATION_COLOR.direct));
				arrowSlot += 1;
			}
			if (kind === "target-cites-source" || kind === "mutual") {
				placeArrow(arrowSlot, item.ax, item.ay, item.az, item.aRadius, item.ax - item.bx, item.ay - item.by, item.az - item.bz);
				arrowMesh.setColorAt(arrowSlot, new Color(RELATION_COLOR.direct));
				arrowSlot += 1;
			}
		}
		for (let slot = arrowSlot; slot < edges.length * 2; slot++) {
			hide();
			arrowMesh.setMatrixAt(slot, dummy.matrix);
		}
		visibleMesh.instanceMatrix.needsUpdate = true;
		hitMesh.instanceMatrix.needsUpdate = true;
		arrowMesh.instanceMatrix.needsUpdate = true;
		if (visibleMesh.instanceColor) visibleMesh.instanceColor.needsUpdate = true;
		if (arrowMesh.instanceColor) arrowMesh.instanceColor.needsUpdate = true;
	};

	scene.add(visibleMesh);
	scene.add(hitMesh);
	scene.add(arrowMesh);
	const relayout = (at: ReadonlyMap<string, { x: number; y: number; z: number; radius: number }>): void => {
		for (const item of edges) {
			const a = at.get(item.edge.source);
			const b = at.get(item.edge.target);
			if (!a || !b) continue;
			item.ax = a.x;
			item.ay = a.y;
			item.az = a.z;
			item.bx = b.x;
			item.by = b.y;
			item.bz = b.z;
			item.aRadius = a.radius;
			item.bRadius = b.radius;
		}
		sync(lastVisible, lastFocus);
	};
	sync(() => true, null);
	return { edges, hitMesh, sync, relayout };
}

function colorToHex(rgb: string): number {
	const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return 0x8ea0c8;
	const r = Number(match[1] ?? 0);
	const g = Number(match[2] ?? 0);
	const b = Number(match[3] ?? 0);
	return (r << 16) + (g << 8) + b;
}
