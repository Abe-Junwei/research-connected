import { mountGraphApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet } from "../preview/fixture";

export async function verifyMobileLayoutBrowser(): Promise<void> {
	const frame = document.createElement("iframe");
	frame.style.cssText = "position:fixed;inset:0 auto auto 0;width:390px;height:700px;border:0";
	const css = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText)).join("\n");
	const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
	frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${css}html,body{height:100%;margin:0}*,*::before,*::after{transition:none!important}</style><body></body>`;
	document.body.append(frame);
	await loaded;
	const root = frame.contentDocument!.createElement("div");
	root.style.cssText = "width:100%;height:700px";
	frame.contentDocument!.body.append(root);
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.researchProjects = {};
	const app = mountGraphApp(root, { getSettings: () => settings, getJson: fixtureGet, openExternal() {}, saveProject() {} });
	const check = (ok: boolean, message: string): void => { if (!ok) throw new Error(message); };
	try {
		for (const width of [390, 640, 779]) {
			frame.style.width = `${width}px`;
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
			const sidebar = root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!;
			const box = sidebar.getBoundingClientRect();
			check(box.height <= 48, `collapsed sidebar must not reserve an empty panel at ${width}px: ${box.height}px`);
			check(Math.abs(box.width - width) <= 1, `collapsed mobile sidebar spans the viewport at ${width}px: ${box.width}px`);
			const body = root.querySelector(".cpo-body")!.getBoundingClientRect();
			const graph = root.querySelector(".cpo-graph-column")!.getBoundingClientRect();
			check(graph.height >= body.height - 100, `mobile graph keeps the available height at ${width}px`);
		}
		frame.style.width = "1440px";
		await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		const sidebar = root.querySelector<HTMLElement>(".cpo-evidence-sidebar")!;
		check(sidebar.getBoundingClientRect().width < 1, "collapsed desktop sidebar still takes no horizontal space");
		root.querySelector<HTMLButtonElement>(".cpo-panel-toggle.is-right")!.click();
		const before = sidebar.getBoundingClientRect().width;
		root.querySelector(".cpo-sidebar-resizer")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		check(sidebar.getBoundingClientRect().width > before, "desktop keyboard resizing still updates the sidebar width");
	} finally { app.destroy(); frame.remove(); }
}
