import { tr } from "../src/i18n";

/**
 * Web theme switcher. Reuses the same Obsidian CSS variables and
 * `theme-dark` / `theme-light` body classes the plugin already relies on
 * (see preview paper/night tokens and src/main.ts css-change → research-connected-theme).
 * Canvas night mode follows --background-primary luminance via map-canvas readTheme.
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "research-connected-web-theme";

/** Same token set as preview/index.html paper theme (Obsidian light defaults). */
const LIGHT_TOKENS: Record<string, string> = {
	"--background-primary": "#ffffff",
	"--background-secondary": "#f6f5f2",
	"--text-normal": "#3a3f45",
	"--text-muted": "#6b7280",
	"--text-faint": "#9aa0a6",
	"--background-modifier-border": "#e5e2da",
	"--background-modifier-hover": "rgba(60, 64, 70, 0.08)",
	"--background-modifier-box-shadow": "rgba(60, 64, 70, 0.14)",
	"--interactive-accent": "#7856c8",
	"--interactive-accent-hover": "#6a4cb0",
	"--graph-node": "#5c6570",
	"--graph-text": "#3a3f45",
	"--graph-node-focused": "#7856c8",
};

/** Same token set as preview/index.html night theme (Obsidian dark defaults). */
const DARK_TOKENS: Record<string, string> = {
	"--background-primary": "#1a1d24",
	"--background-secondary": "#232833",
	"--text-normal": "#e6e4df",
	"--text-muted": "#a8a299",
	"--text-faint": "#7a756c",
	"--background-modifier-border": "rgba(255,255,255,.14)",
	"--background-modifier-hover": "rgba(255, 255, 255, 0.08)",
	"--background-modifier-box-shadow": "rgba(0, 0, 0, 0.45)",
	"--interactive-accent": "#a994e8",
	"--interactive-accent-hover": "#b9a6ee",
	"--graph-node": "#d5d0c6",
	"--graph-text": "#e6e4df",
	"--graph-node-focused": "#a994e8",
};

let mediaQuery: MediaQueryList | null = null;
let onMedia: ((event: MediaQueryListEvent) => void) | null = null;
let currentMode: ThemeMode = "system";

export function readThemeMode(): ThemeMode {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw === "light" || raw === "dark" || raw === "system") return raw;
	} catch { /* keep default */ }
	return "system";
}

export function resolvedDark(mode: ThemeMode = currentMode): boolean {
	if (mode === "dark") return true;
	if (mode === "light") return false;
	return typeof window.matchMedia === "function"
		&& window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTokens(dark: boolean): void {
	const tokens = dark ? DARK_TOKENS : LIGHT_TOKENS;
	const targets: HTMLElement[] = [document.documentElement, document.body];
	const app = document.querySelector("#app");
	if (app instanceof HTMLElement) targets.push(app);
	const surface = document.querySelector(".cpo-surface");
	if (surface instanceof HTMLElement) targets.push(surface);
	for (const node of targets) {
		for (const key of Object.keys(tokens)) {
			const value = tokens[key];
			if (value) node.style.setProperty(key, value);
		}
		// Obsidian Appearance classes the plugin already listens to via css-change.
		node.classList.toggle("theme-dark", dark);
		node.classList.toggle("theme-light", !dark);
	}
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
	document.body.style.colorScheme = dark ? "dark" : "light";
	document.documentElement.style.backgroundColor = tokens["--background-primary"] ?? "";
	document.body.style.backgroundColor = tokens["--background-primary"] ?? "";
	document.body.style.color = tokens["--text-normal"] ?? "";
}

function bindSystemWatch(enabled: boolean): void {
	if (typeof window.matchMedia !== "function") return;
	if (!mediaQuery) mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	if (onMedia) {
		mediaQuery.removeEventListener("change", onMedia);
		onMedia = null;
	}
	if (!enabled) return;
	onMedia = () => {
		if (currentMode !== "system") return;
		applyTokens(resolvedDark("system"));
		window.dispatchEvent(new Event("research-connected-theme"));
		syncThemeControls();
	};
	mediaQuery.addEventListener("change", onMedia);
}

export function applyThemeMode(mode: ThemeMode, persist = true): void {
	currentMode = mode;
	if (persist) {
		try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
	}
	applyTokens(resolvedDark(mode));
	bindSystemWatch(mode === "system");
	window.dispatchEvent(new Event("research-connected-theme"));
	syncThemeControls();
}

export function initTheme(): ThemeMode {
	currentMode = readThemeMode();
	applyThemeMode(currentMode, false);
	return currentMode;
}

export function themeModeLabel(mode: ThemeMode): string {
	if (mode === "system") return tr("跟随系统", "System");
	if (mode === "light") return tr("浅色", "Light");
	return tr("深色", "Dark");
}

function themeButtons(group: HTMLElement): HTMLButtonElement[] {
	const out: HTMLButtonElement[] = [];
	for (let i = 0; i < group.children.length; i++) {
		const child = group.children.item(i);
		if (!child || child.tagName !== "BUTTON") continue;
		out.push(child as HTMLButtonElement);
	}
	return out;
}

export function syncThemeControls(): void {
	const group = document.querySelector("#cpo-theme-group");
	if (!(group instanceof HTMLElement)) return;
	group.dataset.resolved = resolvedDark(currentMode) ? "dark" : "light";
	for (const button of themeButtons(group)) {
		const mode = button.getAttribute("data-theme-mode");
		const selected = mode === currentMode;
		button.setAttribute("aria-checked", selected ? "true" : "false");
		button.tabIndex = selected ? 0 : -1;
		button.classList.toggle("is-selected", selected);
	}
}

export function wireThemeControls(): void {
	const group = document.querySelector("#cpo-theme-group");
	if (!(group instanceof HTMLElement)) return;
	group.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest("[data-theme-mode]");
		if (!button || button.tagName !== "BUTTON" || !group.contains(button)) return;
		const mode = button.getAttribute("data-theme-mode");
		if (mode === "system" || mode === "light" || mode === "dark") applyThemeMode(mode);
	});
	group.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
		event.preventDefault();
		const modes: ThemeMode[] = ["system", "light", "dark"];
		const index = Math.max(0, modes.indexOf(currentMode));
		let next = index;
		if (event.key === "ArrowRight") next = (index + 1) % modes.length;
		if (event.key === "ArrowLeft") next = (index - 1 + modes.length) % modes.length;
		if (event.key === "Home") next = 0;
		if (event.key === "End") next = modes.length - 1;
		const mode = modes[next];
		if (!mode) return;
		applyThemeMode(mode);
		for (const button of themeButtons(group)) {
			if (button.getAttribute("data-theme-mode") === mode) {
				button.focus();
				break;
			}
		}
	});
	syncThemeControls();
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
