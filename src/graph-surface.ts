import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";

export type ReadingAction = "unread" | "to-read" | "read";

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
	readingActions: Map<ReadingAction, HTMLButtonElement>;
	zoom: HTMLDivElement;
	zoomIn: HTMLButtonElement;
	zoomOut: HTMLButtonElement;
	fit: HTMLButtonElement;
	reload: HTMLButtonElement;
}

export function placeNodeMenu(stage: HTMLElement, menu: HTMLElement, x: number, y: number): void {
	const rect = stage.getBoundingClientRect();
	const pad = 8;
	menu.style.left = `${Math.min(Math.max(pad, x - rect.left), Math.max(pad, rect.width - menu.offsetWidth - pad))}px`;
	menu.style.top = `${Math.min(Math.max(pad, y - rect.top), Math.max(pad, rect.height - menu.offsetHeight - pad))}px`;
}

/** Shared graph canvas shell; graph pane and note embeds supply only their host-specific content/actions. */
export function mountGraphSurface(parent: HTMLElement, options: { canvasLabel: string; title: string; hint: string }): GraphSurface {
	const stage = document.createElement("div");
	stage.className = "cpo-stage";
	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-label", options.canvasLabel);
	const empty = document.createElement("div");
	empty.className = "cpo-empty";
	const emptyTitle = document.createElement("h2");
	emptyTitle.className = "cpo-empty-title";
	emptyTitle.textContent = options.title;
	if (!options.title) emptyTitle.hidden = true;
	const messageText = document.createElement("p");
	messageText.textContent = options.hint;
	empty.append(emptyTitle, messageText);
	const tooltip = document.createElement("div");
	tooltip.className = "cpo-tooltip";
	tooltip.hidden = true;
	const nodeMenu = document.createElement("div");
	nodeMenu.className = "cpo-node-menu";
	nodeMenu.hidden = true;
	nodeMenu.setAttribute("role", "menu");
	const deleteItem = menuButton(tr("排除", "Exclude"));
	const expandItem = menuButton(tr("深挖", "Deep dive"));
	const seedItem = menuButton(tr("设为种子", "Set as seed"));
	nodeMenu.append(deleteItem, expandItem, seedItem);
	const readingActions = new Map<ReadingAction, HTMLButtonElement>();
	for (const [reading, label] of [["unread", tr("标记为未读", "Mark as unread")], ["to-read", tr("标记为待读", "Mark as to read")], ["read", tr("标记为已读", "Mark as read")]] as const) {
		const button = document.createElement("button");
		button.type = "button";
		button.setAttribute("role", "menuitem");
		button.textContent = label;
		readingActions.set(reading, button);
		nodeMenu.append(button);
	}
	const zoom = document.createElement("div");
	zoom.className = "cpo-zoom";
	const zoomIn = iconButton("+", tr("放大", "Zoom in"));
	const zoomOut = iconButton("−", tr("缩小", "Zoom out"));
	const fit = iconButton("", tr("适应窗口", "Fit to view"));
	fit.title = tr("适应窗口", "Fit to view");
	fit.append(createChromeIcon("fit"));
	const reload = iconButton("", tr("重新加载", "Reload"));
	reload.title = tr("重新加载", "Reload");
	reload.disabled = true;
	reload.append(createChromeIcon("refresh"));
	zoom.append(zoomIn, zoomOut, fit, reload);
	stage.append(canvas, empty, tooltip, nodeMenu, zoom);
	parent.append(stage);
	return { stage, canvas, empty, emptyTitle, messageText, tooltip, nodeMenu, deleteItem, expandItem, seedItem, readingActions, zoom, zoomIn, zoomOut, fit, reload };
}

function menuButton(label: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.setAttribute("role", "menuitem");
	button.textContent = label;
	return button;
}

function iconButton(label: string, aria: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cpo-icon";
	button.textContent = label;
	button.setAttribute("aria-label", aria);
	return button;
}
