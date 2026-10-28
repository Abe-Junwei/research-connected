import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";

export interface GraphSurface {
	stage: HTMLDivElement;
	canvas: HTMLCanvasElement;
	empty: HTMLDivElement;
	emptyTitle: HTMLHeadingElement;
	messageText: HTMLParagraphElement;
	tooltip: HTMLDivElement;
	nodeMenu: HTMLDivElement;
	deleteItem: HTMLButtonElement;
	expandItem: HTMLButtonElement;
	seedItem: HTMLButtonElement;
	zoom: HTMLDivElement;
	zoomIn: HTMLButtonElement;
	zoomOut: HTMLButtonElement;
	fit: HTMLButtonElement;
	reload: HTMLButtonElement;
	yearHost: HTMLDivElement;
}

export function placeNodeMenu(stage: HTMLElement, menu: HTMLElement, x: number, y: number): void {
	const rect = stage.getBoundingClientRect();
	const pad = 8;
	menu.style.left = `${Math.min(Math.max(pad, x - rect.left), Math.max(pad, rect.width - menu.offsetWidth - pad))}px`;
	menu.style.top = `${Math.min(Math.max(pad, y - rect.top), Math.max(pad, rect.height - menu.offsetHeight - pad))}px`;
	const item = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find((button) => !button.disabled && !button.hidden);
	item?.focus({ preventScroll: true });
}

/** Shared graph canvas shell; graph pane and note embeds supply only their host-specific content/actions. */
export function mountGraphSurface(parent: HTMLElement, options: { canvasLabel: string; title: string; hint: string; mutations?: boolean }): GraphSurface {
	const stage = createDiv();
	stage.className = "cpo-stage";
	const canvas = createEl("canvas");
	canvas.setAttribute("aria-label", options.canvasLabel);
	const empty = createDiv();
	empty.className = "cpo-empty";
	const emptyTitle = createEl("h2");
	emptyTitle.className = "cpo-empty-title";
	emptyTitle.textContent = options.title;
	if (!options.title) emptyTitle.hidden = true;
	const messageText = createEl("p");
	messageText.textContent = options.hint;
	empty.append(emptyTitle, messageText);
	const tooltip = createDiv();
	tooltip.className = "cpo-tooltip";
	tooltip.hidden = true;
	const nodeMenu = createDiv();
	nodeMenu.className = "cpo-node-menu";
	nodeMenu.hidden = true;
	nodeMenu.setAttribute("role", "menu");
	const deleteItem = menuButton(tr("排除", "Exclude"));
	deleteItem.classList.add("is-danger");
	const expandItem = menuButton(tr("深挖", "Deep dive"));
	const seedItem = menuButton(tr("设为种子", "Set as seed"));
	if (options.mutations === false) nodeMenu.append(seedItem);
	else {
		const dangerSep = createSpan();
		dangerSep.className = "cpo-node-menu-sep";
		dangerSep.setAttribute("role", "separator");
		nodeMenu.append(expandItem, seedItem, dangerSep, deleteItem);
	}
	const zoom = createDiv();
	zoom.className = "cpo-zoom";
	const zoomIn = iconButton("", tr("放大", "Zoom in"));
	zoomIn.append(createChromeIcon("plus"));
	const zoomOut = iconButton("", tr("缩小", "Zoom out"));
	zoomOut.append(createChromeIcon("minus"));
	const fit = iconButton("", tr("适应窗口", "Fit to view"));
	fit.title = tr("适应窗口", "Fit to view");
	fit.append(createChromeIcon("fit"));
	const reload = iconButton("", tr("重新加载", "Reload"));
	reload.title = tr("重新加载", "Reload");
	reload.disabled = true;
	reload.append(createChromeIcon("refresh"));
	zoom.append(fit, zoomIn, zoomOut, reload);
	const pause = mountStarfield(stage);
	stage.append(canvas, empty, tooltip, nodeMenu, zoom, pause);
	const column = createDiv();
	column.className = "cpo-graph-column";
	const yearHost = createDiv();
	yearHost.className = "cpo-year-band";
	yearHost.hidden = true;
	column.append(stage, yearHost);
	parent.append(column);
	return { stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, zoom, zoomIn, zoomOut, fit, reload, yearHost };
}

function mountStarfield(stage: HTMLElement): HTMLButtonElement {
	const nebula = createDiv();
	nebula.className = "cpo-nebula";
	nebula.setAttribute("aria-hidden", "true");
	const stars = createSvg("svg");
	stars.classList.add("cpo-stars");
	stars.setAttribute("viewBox", "0 0 1000 1000");
	stars.setAttribute("preserveAspectRatio", "xMidYMid slice");
	stars.setAttribute("aria-hidden", "true");
	let seed = 0x5eed;
	const rand = (): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	for (let i = 0; i < 240; i++) {
		const circle = createSvg("circle");
		circle.setAttribute("cx", (rand() * 1000).toFixed(1));
		circle.setAttribute("cy", (rand() * 1000).toFixed(1));
		circle.setAttribute("r", rand() < 0.08 ? "1.6" : rand() < 0.3 ? "1.1" : "0.6");
		circle.style.setProperty("--dim", (0.35 + rand() * 0.65).toFixed(2));
		circle.style.setProperty("--mid", (0.12 + rand() * 0.28).toFixed(2));
		circle.style.setProperty("--twinkle", `${(2.4 + rand() * 4.8).toFixed(2)}s`);
		circle.style.setProperty("--phase", `${(-rand() * 6).toFixed(2)}s`);
		stars.append(circle);
	}
	stage.append(nebula, stars);
	const pause = createEl("button");
	pause.type = "button";
	pause.className = "cpo-icon cpo-star-pause";
	const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduced) {
		stage.classList.add("is-stars-paused");
		pause.disabled = true;
	}
	const sync = (): void => {
		const paused = stage.classList.contains("is-stars-paused");
		const label = reduced
			? tr("系统减少动态，星空已静止", "Motion is reduced; the starfield is still")
			: paused
				? tr("继续星空动效", "Resume starfield motion")
				: tr("暂停星空动效", "Pause starfield motion");
		pause.setAttribute("aria-pressed", String(paused));
		pause.setAttribute("aria-label", label);
		pause.title = label;
		pause.replaceChildren(createChromeIcon(paused ? "play" : "pause"));
	};
	pause.addEventListener("click", () => {
		if (pause.disabled) return;
		stage.classList.toggle("is-stars-paused");
		sync();
	});
	sync();
	return pause;
}

function menuButton(label: string): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.setAttribute("role", "menuitem");
	button.textContent = label;
	return button;
}

function iconButton(label: string, aria: string): HTMLButtonElement {
	const button = createEl("button");
	button.type = "button";
	button.className = "cpo-icon";
	button.textContent = label;
	button.setAttribute("aria-label", aria);
	return button;
}
