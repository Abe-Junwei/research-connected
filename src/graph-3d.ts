import {
	CircleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	InstancedMesh,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PerspectiveCamera,
	Plane,
	Raycaster,
	Scene,
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
import { buildCommunityRegions } from "./community-regions";
import {
	edgeVisible,
	evidenceText,
	focusNodes,
	nodeVisible,
	type GraphFilter,
} from "./graph-filter";
import type { LabelMode } from "./labels";
import { nodeLabel } from "./labels";
import { placeLayout, type ColorMode, type LayoutMode } from "./layout-modes";
import type { SimilarityGraph } from "./neighborhood";
import { RELATION_COLOR, relationKind } from "./relation";
import type { GraphEdge, PaperNode } from "./types";
import { yearColor } from "./visual";

export interface GraphCameraState {
	position: [number, number, number];
	target: [number, number, number];
}

export interface Graph3DHandle {
	destroy(): void;
	resize(): void;
	/** Factor above 1 moves the camera closer. */
	zoomBy(factor: number): void;
	frame(): void;
	setFilter(next: GraphFilter): void;
	setLayout(next: LayoutMode): void;
	setColorMode(next: ColorMode): void;
	getCamera(): GraphCameraState;
	setCamera(state: GraphCameraState): void;
}

export interface Graph3DOptions {
	labels: LabelMode;
	filter: GraphFilter;
	layout: LayoutMode;
	colorMode: ColorMode;
	/** WebGL 上下文丢失时由宿主重建图谱，避免嵌入画布黑屏。 */
	onContextLost?: () => void;
}

interface SphereEntry {
	id: string;
	mesh: Mesh;
	title: string;
	label: HTMLElement | null;
	cited: number;
	seed: boolean;
	dim: boolean;
	radius: number;
	color: number;
	material: MeshBasicMaterial;
	outline: MeshBasicMaterial;
	selectionRing: Mesh | null;
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
 * WebGL similarity cloud. A plain wheel scrolls the note; ⌘/Ctrl + wheel
 * (a trackpad pinch arrives as a ctrlKey wheel) zooms. Flat layouts pan on
 * left-drag and rotate on right-drag; the 3D layout rotates on left-drag and
 * pans on right-drag. Single-finger touch scrolls the page; two fingers zoom
 * and pan. A click that does not drag selects a paper or the nearer end of
 * an edge.
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
	const renderer = new WebGLRenderer({ antialias: true, alpha: true });
	if (!renderer.getContext()) {
		renderer.dispose();
		throw new Error("无法创建 WebGL，这段嵌入显示不了三维图谱。");
	}
	renderer.outputColorSpace = SRGBColorSpace;
	// 背景交给 CSS 径向渐变，对齐图谱面板；画布自身透明。
	renderer.setClearColor(0x000000, 0);
	const canvas = renderer.domElement;
	canvas.className = "cpo-embed-canvas";
	viewport.append(canvas);
	const communitySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	communitySvg.classList.add("cpo-community-overlay");
	communitySvg.style.display = "none";
	viewport.append(communitySvg);

	const labelLayer = document.createElement("div");
	labelLayer.className = "cpo-embed-labels";
	viewport.append(labelLayer);
	viewport.classList.toggle("cpo-kumu-view", layoutMode === "kumu");

	const scene = new Scene();

	const papers = new Map(graph.nodes.map((node) => [node.id, node]));
	const communities = detectCommunities(
		graph.nodes.map((node) => node.id),
		graph.edges,
	);
	const years = graph.nodes.map((node) => node.year).filter((year): year is number => year !== null);
	const minYear = years.length ? Math.min(...years) : 0;
	const maxYear = years.length ? Math.max(...years) : 0;
	const viewStyles = getComputedStyle(viewport);
	const readVar = (name: string, fallback: string): string =>
		viewStyles.getPropertyValue(name).trim() || fallback;
	const graphNodeColor = readVar("--graph-node", "rgb(138, 127, 216)");
	const graphNodeFocused = colorToHex(readVar("--graph-node-focused", "rgb(74, 144, 217)"));
	const nodeColor = (node: PaperNode): string => {
		if (colorMode === "community") return communityColor(communities.get(node.id) ?? 0);
		if (colorMode === "year") return yearColor(node.year, minYear, maxYear);
		return graphNodeColor;
	};
	let placed = placeLayout(layoutMode, graph.nodes, graph.edges, graph.seedScore);
	const byId = new Map(placed.map((node) => [node.id, node]));
	// 对齐图谱面板：所有布局都用平涂圆盘（每帧朝向相机），不再用光照球体。
	const circle = new CircleGeometry(1, 40);
	const outlineGeo = new CircleGeometry(1.08, 40);
	const seedGlowGeo = new CircleGeometry(2.05, 40);
	const seedRingGeoA = new TorusGeometry(1.42, 0.055, 8, 48);
	const seedRingGeoB = new TorusGeometry(1.78, 0.04, 8, 48);
	const selectionRingGeo = new TorusGeometry(1.32, 0.075, 8, 48);
	const entries: SphereEntry[] = [];
	const geometries: Array<CircleGeometry | CylinderGeometry | TorusGeometry | ConeGeometry> = [
		circle,
		outlineGeo,
		seedGlowGeo,
		seedRingGeoA,
		seedRingGeoB,
		selectionRingGeo,
	];
	const materials: Material[] = [];
	const noRaycast = (): void => undefined;
	const seedGlowMat = new MeshBasicMaterial({ color: 0x3c4046, transparent: true, opacity: 0.1, depthWrite: false });
	const seedRingMatA = new MeshBasicMaterial({ color: 0x333943 });
	const seedRingMatB = new MeshBasicMaterial({ color: 0x333943, transparent: true, opacity: 0.45 });
	const selectionRingMat = new MeshBasicMaterial({ color: graphNodeFocused });
	materials.push(seedGlowMat, seedRingMatA, seedRingMatB, selectionRingMat);

	for (const node of graph.nodes) {
		const at = byId.get(node.id);
		if (!at) continue;
		const baseColor = colorToHex(nodeColor(node));
		const material = new MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 });
		const outline = new MeshBasicMaterial({ color: shadeHex(baseColor, 0.85), transparent: true, opacity: 1 });
		materials.push(material, outline);
		const mesh = new Mesh(circle, material);
		mesh.position.set(at.x, at.y, at.z);
		mesh.scale.setScalar(at.radius);
		mesh.userData.paperId = node.id;
		mesh.userData.seed = node.isSeed;
		// 同色系加深一圈，对齐面板节点的 1px 深色描边。
		const rim = new Mesh(outlineGeo, outline);
		rim.position.z = -0.01;
		rim.raycast = noRaycast;
		mesh.add(rim);
		if (node.isSeed) {
			// 种子：柔光晕 + 双环，对齐面板样式。
			const glow = new Mesh(seedGlowGeo, seedGlowMat);
			glow.position.z = -0.02;
			glow.raycast = noRaycast;
			const ringA = new Mesh(seedRingGeoA, seedRingMatA);
			ringA.raycast = noRaycast;
			const ringB = new Mesh(seedRingGeoB, seedRingMatB);
			ringB.raycast = noRaycast;
			mesh.add(glow, ringA, ringB);
		}
		const selectionRing = new Mesh(selectionRingGeo, selectionRingMat);
		selectionRing.visible = false;
		selectionRing.raycast = noRaycast;
		mesh.add(selectionRing);
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
			radius: at.radius,
			color: baseColor,
			material,
			outline,
			selectionRing,
		});
	}

	const drawn = drawEdges(graph, byId, scene, geometries, materials);
	drawn.setKumuStyle();

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
		// One finger scrolls the note (touch-action: pan-y); two fingers zoom/pan.
		controls.touches.ONE = null;
		controls.touches.TWO = TOUCH.DOLLY_PAN;
	};
	applyPointerMode();

	let frameDistance = 1;
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
		frameDistance = camera.position.distanceTo(controls.target);
	};
	frameCamera();

	const raycaster = new Raycaster();
	const pointer = new Vector2();
	const projected = new Vector3();
	const dragPlane = new Plane(new Vector3(0, 0, 1), 0);
	const dragPoint = new Vector3();
	const dragOffset = new Vector3();
	let alive = true;
	let raf = 0;
	let running = false;
	let selectedId: string | null = graph.nodes.find((node) => node.isSeed)?.id ?? null;
	let hoverId: string | null = null;
	let downX = 0;
	let downY = 0;
	let moved = false;
	let dragNodeId: string | null = null;
	let simAlpha = 0;
	let simFrame: number | null = null;
	let zoomGoal: number | null = null;

	// 对齐图谱面板 drawNode：悬停微微放大，graph 着色模式下悬停/选中改填充色，
	// 选中套一圈聚焦色圆环，焦点之外的节点淡化到 0.25。
	const paint = (): void => {
		for (const entry of entries) {
			const active = entry.id === selectedId || entry.id === hoverId;
			entry.material.color.set(active && colorMode === "graph" ? graphNodeFocused : entry.color);
			entry.material.opacity = entry.dim ? 0.25 : 1;
			entry.material.depthWrite = !entry.dim;
			entry.outline.opacity = entry.dim ? 0.25 : 1;
			entry.outline.depthWrite = !entry.dim;
			entry.mesh.scale.setScalar(entry.radius * (entry.id === hoverId ? 1.18 : 1));
			if (entry.selectionRing) {
				entry.selectionRing.visible = entry.id === selectedId && !entry.seed && !entry.dim;
			}
		}
		schedule();
	};

	const currentPlacements = (): Map<string, { x: number; y: number; z: number; radius: number }> =>
		new Map(
			entries.map((entry) => [
				entry.id,
				{
					x: entry.mesh.position.x,
					y: entry.mesh.position.y,
					z: entry.mesh.position.z,
					radius: entry.radius,
				},
			]),
		);

	/** 物理 simmer 只对力导向布局启用；时间/放射布局的位置本身有意义。 */
	const physicsOn = (): boolean => layoutMode === "force2d" || layoutMode === "kumu";

	/**
	 * 对齐图谱面板的 Obsidian 式动态：拖动节点时邻居弹性跟随，松手后缓慢
	 * 收敛；alpha 冷却到阈值以下循环就停，静止的图不耗帧。
	 */
	const reheat = (alpha: number): void => {
		if (!physicsOn() || entries.length > 350) return;
		simAlpha = Math.max(simAlpha, alpha);
		if (simFrame !== null) return;
		const step = (): void => {
			simFrame = null;
			if (!alive || simAlpha < 0.02) {
				simAlpha = 0;
				return;
			}
			simTick(simAlpha);
			// 按住节点保持热度，松手后快速冷却。
			simAlpha *= dragNodeId ? 0.99 : 0.96;
			schedule();
			if (alive && simAlpha >= 0.02) simFrame = window.requestAnimationFrame(step);
			else simAlpha = 0;
		};
		simFrame = window.requestAnimationFrame(step);
	};

	const simTick = (alpha: number): void => {
		const nodes = entries.filter((entry) => entry.mesh.visible);
		if (nodes.length < 2) return;
		const index = new Map(nodes.map((entry, i) => [entry.id, i] as const));
		const vx = new Array<number>(nodes.length).fill(0);
		const vy = new Array<number>(nodes.length).fill(0);
		const seedId = graph.nodes.find((node) => node.isSeed)?.id ?? "";
		const mobile = (id: string): boolean => id !== dragNodeId && id !== seedId;

		// 斥力，与初始布局同一塑形。
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				let dx = b.mesh.position.x - a.mesh.position.x;
				let dy = b.mesh.position.y - a.mesh.position.y;
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
		// 沿可见边的弹簧。
		for (const edge of graph.edges) {
			if (!edgeVisible(edge, papers, filter)) continue;
			const ai = index.get(edge.source);
			const bi = index.get(edge.target);
			if (ai === undefined || bi === undefined) continue;
			const a = nodes[ai]!.mesh.position;
			const b = nodes[bi]!.mesh.position;
			const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
			const weight = Math.min(1, Math.max(0, edge.weight));
			const rest = 88 + (1 - weight) * 200;
			const spring = 0.025 + weight * 0.07;
			const disp = (dist - rest) * spring * alpha;
			const dx = ((b.x - a.x) / dist) * disp;
			const dy = ((b.y - a.y) / dist) * disp;
			if (mobile(edge.source)) {
				vx[ai]! += dx;
				vy[ai]! += dy;
			}
			if (mobile(edge.target)) {
				vx[bi]! -= dx;
				vy[bi]! -= dy;
			}
		}
		// 轻量向心 + 阻尼 + 步长上限，reheat 不会炸开。
		let changed = false;
		for (let i = 0; i < nodes.length; i++) {
			const entry = nodes[i]!;
			if (!mobile(entry.id)) continue;
			const at = entry.mesh.position;
			let mx = (vx[i]! - at.x * 0.01 * alpha) * 0.62;
			let my = (vy[i]! - at.y * 0.01 * alpha) * 0.62;
			const speed = Math.hypot(mx, my);
			const cap = 18 * alpha;
			if (speed > cap && speed > 0) {
				mx = (mx / speed) * cap;
				my = (my / speed) * cap;
			}
			const nx = Math.min(1400, Math.max(-1400, at.x + mx));
			const ny = Math.min(1400, Math.max(-1400, at.y + my));
			if (nx !== at.x || ny !== at.y) changed = true;
			at.x = nx;
			at.y = ny;
		}
		if (changed) drawn.relayout(currentPlacements());
	};

	const resize = (): void => {
		const width = Math.max(1, viewport.clientWidth);
		const height = Math.max(1, viewport.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(width, height, false);
		camera.aspect = width / Math.max(1, height);
		camera.updateProjectionMatrix();
		schedule();
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
		const width = viewport.clientWidth;
		const height = viewport.clientHeight;
		if (options.labels !== "off") {
		const gap = layoutMode === "kumu" ? 28 : options.labels === "both" ? 58 : 44;
		const ranked = [...entries].sort(
			(a, b) => Number(b.seed) - Number(a.seed) || b.cited - a.cited || a.id.localeCompare(b.id),
		);
		const kept: Array<{ x: number; y: number }> = [];
		let shown = 0;
		// 对齐面板：普通标签随放大淡入（缩放 1.1–1.6 区间），种子/选中/悬停恒显。
		const zoom = frameDistance / Math.max(1, camera.position.distanceTo(controls.target));
		const labelAlpha = Math.min(1, Math.max(0, (zoom - 1.1) / 0.5));
		for (const entry of ranked) {
			const el = entry.label;
			if (!el) continue;
			projected.copy(entry.mesh.position).project(camera);
			const force = entry.id === selectedId || entry.id === hoverId || entry.seed;
			// 对齐 Obsidian 图谱：默认只给最高被引的一小撮节点出标签。
			if (!force && shown >= 24) {
				el.hidden = true;
				continue;
			}
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
			if (!force && labelAlpha <= 0.02) {
				el.hidden = true;
				continue;
			}
			el.hidden = false;
			el.style.opacity = force ? "1" : labelAlpha.toFixed(2);
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
			kept.push({ x, y });
			if (!force) shown += 1;
		}
		}
		placeCommunityOverlay(width, height);
	};

	const placeCommunityOverlay = (width: number, height: number): void => {
		communitySvg.setAttribute("width", String(width));
		communitySvg.setAttribute("height", String(height));
		communitySvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		communitySvg.replaceChildren();
		communitySvg.style.display = layoutMode === "kumu" ? "block" : "none";
		if (layoutMode !== "kumu") return;
		const projectedPoints = entries.filter((entry) => entry.mesh.visible).map((entry) => {
			projected.copy(entry.mesh.position).project(camera);
			return {
				id: entry.id,
				community: communities.get(entry.id) ?? 0,
				x: (projected.x * 0.5 + 0.5) * width,
				y: (-projected.y * 0.5 + 0.5) * height,
				shown: projected.z <= 1 && projected.x >= -1.2 && projected.x <= 1.2 && projected.y >= -1.2 && projected.y <= 1.2,
			};
		});
		for (const region of buildCommunityRegions(projectedPoints, 22)) {
			if (region.points.length < 3) continue;
			const hue = communityColor(region.community).replace("rgb(", "").replace(")", "");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			const first = region.points[0]!;
			const last = region.points[region.points.length - 1]!;
			let d = `M ${(last.x + first.x) / 2} ${(last.y + first.y) / 2}`;
			for (let i = 0; i < region.points.length; i++) {
				const point = region.points[i]!;
				const next = region.points[(i + 1) % region.points.length]!;
				d += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
			}
			path.setAttribute("d", `${d} Z`);
			path.setAttribute("fill", `rgba(${hue}, 0.04)`);
			path.setAttribute("stroke", `rgba(${hue}, 0.25)`);
			path.setAttribute("stroke-width", "1");
			communitySvg.append(path);
			const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
			label.setAttribute("x", String(Math.max(6, region.left + 7)));
			label.setAttribute("y", String(Math.max(18, region.top + 16)));
			label.setAttribute("fill", "#9aa0a6");
			label.setAttribute("font-size", "10");
			label.textContent = `相似性社区 ${region.community + 1}`;
			communitySvg.append(label);
		}
	};

	// Render on demand: a frame is scheduled by control changes (drag, damped
	// settling, zoom) and by state changes (paint, filter, layout, resize).
	// While the camera settles, controls.update() keeps returning true and the
	// loop sustains itself; once still, no frames run until the next change.
	const schedule = (): void => {
		if (!alive || !running || raf) return;
		raf = window.requestAnimationFrame(tick);
	};
	const tick = (): void => {
		raf = 0;
		if (!alive || !running) return;
		const settling = controls.update();
		// 缩放按钮的缓动：向目标距离 lerp，贴近后停（对齐面板的 eased zoom）。
		if (zoomGoal !== null) {
			const offset = camera.position.clone().sub(controls.target);
			const distance = offset.length() || 1;
			let nextDistance = distance + (zoomGoal - distance) * 0.22;
			if (Math.abs(zoomGoal - nextDistance) < distance * 0.01) {
				nextDistance = zoomGoal;
				zoomGoal = null;
			}
			offset.multiplyScalar(nextDistance / distance);
			camera.position.copy(controls.target).add(offset);
		}
		// 圆盘与面板圆点一样始终正对相机，旋转视角时不变形。
		for (const entry of entries) entry.mesh.quaternion.copy(camera.quaternion);
		renderer.render(scene, camera);
		placeLabels();
		if (settling || zoomGoal !== null) schedule();
	};
	const start = (): void => {
		if (running || !alive) return;
		running = true;
		schedule();
	};
	const stop = (): void => {
		running = false;
		if (raf) window.cancelAnimationFrame(raf);
		raf = 0;
	};
	canvas.addEventListener("webglcontextlost", (event) => {
		event.preventDefault();
		if (!alive) return;
		stop();
		options.onContextLost?.();
	});
	controls.addEventListener("change", schedule);

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
		// 平面布局里左键按住节点直接拖动（对齐面板/Obsidian）；空白处仍是平移。
		// 触屏单指留给笔记滚动，不触发节点拖动。
		if (event.button === 0 && event.pointerType !== "touch" && layoutMode !== "force3d" && setPointer(event)) {
			const hit = pick(event);
			if (hit.node && hit.node.mesh.visible) {
				dragNodeId = hit.node.id;
				controls.enabled = false;
				try {
					canvas.setPointerCapture(event.pointerId);
				} catch {
					/* 指针捕获失败也不影响拖动 */
				}
				dragPlane.setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1), hit.node.mesh.position);
				if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
					dragOffset.copy(hit.node.mesh.position).sub(dragPoint);
				} else {
					dragOffset.set(0, 0, 0);
				}
			}
		}
	};
	const onPointerMove = (event: PointerEvent): void => {
		if (dragNodeId) {
			const entry = entries.find((item) => item.id === dragNodeId) ?? null;
			if (entry && setPointer(event) && raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
				if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) moved = true;
				if (moved) {
					const at = entry.mesh.position;
					at.x = dragPoint.x + dragOffset.x;
					at.y = dragPoint.y + dragOffset.y;
					// 邻居弹性跟随；非力导向布局只动节点本身，边也要跟着走。
					reheat(0.5);
					drawn.relayout(currentPlacements());
					schedule();
				}
			}
			tooltip.hidden = true;
			canvas.style.cursor = "grabbing";
			return;
		}
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
		if (dragNodeId) {
			const released = dragNodeId;
			const wasDrag = moved;
			dragNodeId = null;
			controls.enabled = true;
			try {
				canvas.releasePointerCapture(event.pointerId);
			} catch {
				/* 与按下时的捕获对应 */
			}
			canvas.style.cursor = "grab";
			// 拖动结束：simmer 让图谱弹性收敛。
			if (wasDrag) {
				reheat(0.35);
				return;
			}
			const paper = papers.get(released) ?? null;
			selectedId = paper?.id ?? null;
			onSelect(paper, null);
			syncView();
			return;
		}
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
		if (dragNodeId) return;
		hoverId = null;
		tooltip.hidden = true;
		canvas.style.cursor = "grab";
		paint();
	};
	// A plain wheel scrolls the note; only ⌘/Ctrl + wheel zooms (a trackpad
	// pinch arrives as a ctrlKey wheel). This capture listener sits on the
	// viewport so it runs before OrbitControls' own wheel listener on the
	// canvas; stopping propagation keeps plain wheels away from it.
	const onWheel = (event: WheelEvent): void => {
		if (event.ctrlKey || event.metaKey) return;
		event.stopImmediatePropagation();
	};

	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);
	canvas.addEventListener("pointerleave", onPointerLeave);
	viewport.addEventListener("wheel", onWheel, { capture: true });
	canvas.style.cursor = "grab";
	canvas.style.touchAction = "pan-y";

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
			if (!paper) continue;
			entry.color = colorToHex(nodeColor(paper));
			entry.outline.color.set(shadeHex(entry.color, 0.85));
		}
		paint();
	};

	const applyLayout = (mode: LayoutMode): void => {
		layoutMode = mode;
		const kumuStyle = mode === "kumu";
		simAlpha = 0;
		if (simFrame !== null) {
			window.cancelAnimationFrame(simFrame);
			simFrame = null;
		}
		dragNodeId = null;
		controls.enabled = true;
		zoomGoal = null;
		viewport.classList.toggle("cpo-kumu-view", kumuStyle);
		placed = placeLayout(mode, graph.nodes, graph.edges, graph.seedScore);
		const next = new Map(placed.map((node) => [node.id, node]));
		for (const entry of entries) {
			const at = next.get(entry.id);
			if (!at) continue;
			entry.radius = at.radius;
			entry.mesh.position.set(at.x, at.y, at.z);
		}
		drawn.setKumuStyle();
		drawn.relayout(next);
		applyPointerMode();
		frameCamera();
		paint();
	};

	const zoomBy = (factor: number): void => {
		if (!Number.isFinite(factor) || factor <= 0) return;
		const offset = camera.position.clone().sub(controls.target);
		const distance = offset.length();
		if (distance < 1e-3) return;
		// 不直接跳变，设目标距离交给 tick 逐帧 lerp（对齐面板的缓动缩放）。
		zoomGoal = Math.min(controls.maxDistance, Math.max(controls.minDistance, distance / factor));
		schedule();
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
		getCamera(): GraphCameraState {
			return {
				position: [camera.position.x, camera.position.y, camera.position.z],
				target: [controls.target.x, controls.target.y, controls.target.z],
			};
		},
		setCamera(state: GraphCameraState): void {
			camera.position.set(state.position[0], state.position[1], state.position[2]);
			controls.target.set(state.target[0], state.target[1], state.target[2]);
			controls.update();
		},
		destroy() {
			if (!alive) return;
			alive = false;
			stop();
			if (simFrame !== null) window.cancelAnimationFrame(simFrame);
			simFrame = null;
			dragNodeId = null;
			resizeObserver.disconnect();
			visibility.disconnect();
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUp);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			viewport.removeEventListener("wheel", onWheel, { capture: true });
			controls.dispose();
			for (const geometry of geometries) geometry.dispose();
			for (const material of materials) material.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
			canvas.remove();
			communitySvg.remove();
			labelLayer.remove();
			tooltip.hidden = true;
		},
	};
}

function drawEdges(
	graph: SimilarityGraph,
	byId: ReadonlyMap<string, { x: number; y: number; z: number; radius: number }>,
	scene: Scene,
	geometries: Array<CircleGeometry | CylinderGeometry | TorusGeometry | ConeGeometry>,
	materials: Material[],
): {
	edges: DrawnEdge[];
	hitMesh: InstancedMesh | null;
	sync: (visible: (edge: GraphEdge) => boolean, focus: Set<string> | null) => void;
	relayout: (at: ReadonlyMap<string, { x: number; y: number; z: number; radius: number }>) => void;
	setKumuStyle: () => void;
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
		return { edges, hitMesh: null, sync: () => undefined, relayout: () => undefined, setKumuStyle: () => undefined };
	}

	const shaft = new CylinderGeometry(1, 1, 1, 6, 1);
	const head = new ConeGeometry(1, 1, 8);
	geometries.push(shaft, head);
	const visibleMaterial = new MeshBasicMaterial({ transparent: true, opacity: 1 });
	const hitMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
	const arrowMaterial = new MeshBasicMaterial({ transparent: true, opacity: 1 });
	materials.push(visibleMaterial, hitMaterial, arrowMaterial);
	const visibleMesh = new InstancedMesh(shaft, visibleMaterial, edges.length);
	const hitMesh = new InstancedMesh(shaft, hitMaterial, edges.length);
	const arrowMesh = new InstancedMesh(head, arrowMaterial, edges.length * 2);
	const dummy = new Object3D();
	const direction = new Vector3();
	const up = new Vector3(0, 1, 0);
	// 颜色按面板 --graph-line 在白底上的合成值预调：默认 rgba(90,96,106,0.28)，淡化 0.1。
	const edgeGray = new Color(0xd1d3d5);
	const edgeFaint = new Color(0xedeef0);

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
		// 对齐面板的小三角箭头：贴着节点边缘，尺寸收敛不抢视觉。
		const height = 9;
		dummy.quaternion.setFromUnitVectors(up, direction);
		dummy.position.set(
			x - direction.x * (radius + height / 2),
			y - direction.y * (radius + height / 2),
			z - direction.z * (radius + height / 2),
		);
		dummy.scale.set(2.6, height, 2.6);
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
			// 对齐 Obsidian 图谱：默认细浅中性灰，聚焦时才按关系类型着色。
			const focused = focus !== null && emphasized;
			const radius = focused ? 0.7 : 0.4;
			placeShaft(i, item, radius);
			const kind = relationKind(item.edge);
			visibleMesh.setColorAt(i, focused ? new Color(RELATION_COLOR[kind]) : emphasized ? edgeGray : edgeFaint);
			dummy.scale.set(Math.max(radius, 1.8), dummy.scale.y, Math.max(radius, 1.8));
			dummy.updateMatrix();
			hitMesh.setMatrixAt(i, dummy.matrix);
			if (kind !== "direct") continue;
			const arrowColor = focused ? new Color(RELATION_COLOR.direct) : edgeGray;
			const direct = item.edge.direct;
			if (direct === "source-cites-target" || direct === "mutual") {
				placeArrow(arrowSlot, item.bx, item.by, item.bz, item.bRadius, item.bx - item.ax, item.by - item.ay, item.bz - item.az);
				arrowMesh.setColorAt(arrowSlot, arrowColor);
				arrowSlot += 1;
			}
			if (direct === "target-cites-source" || direct === "mutual") {
				placeArrow(arrowSlot, item.ax, item.ay, item.az, item.aRadius, item.ax - item.bx, item.ay - item.by, item.az - item.bz);
				arrowMesh.setColorAt(arrowSlot, arrowColor);
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
	const setKumuStyle = (): void => {
		sync(lastVisible, lastFocus);
	};
	return { edges, hitMesh, sync, relayout, setKumuStyle };
}

function colorToHex(rgb: string): number {
	const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return 0x8ea0c8;
	const r = Number(match[1] ?? 0);
	const g = Number(match[2] ?? 0);
	const b = Number(match[3] ?? 0);
	return (r << 16) + (g << 8) + b;
}

/** 同色系加深一点，对齐面板节点的深色描边（shadeColor 的 hex 版）。 */
function shadeHex(hex: number, factor: number): number {
	const r = Math.round(((hex >> 16) & 255) * factor);
	const g = Math.round(((hex >> 8) & 255) * factor);
	const b = Math.round((hex & 255) * factor);
	return (Math.min(r, 255) << 16) + (Math.min(g, 255) << 8) + Math.min(b, 255);
}
