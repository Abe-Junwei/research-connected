import type { GraphFilter } from "./graph-filter";
import { RELATION_LABEL } from "./relation";

export function buildLegend(
	legend: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): void {
	for (const kind of ["direct", "cocitation", "coupling", "weak"] as const) {
		const button = document.createElement("button");
		button.type = "button";
		const on = read().kinds[kind];
		button.className = on ? "cpo-legend-kind is-on" : "cpo-legend-kind";
		button.setAttribute("aria-pressed", on ? "true" : "false");
		const swatch = document.createElement("i");
		swatch.dataset.kind = kind;
		button.append(swatch, document.createTextNode(RELATION_LABEL[kind]));
		button.addEventListener("click", () => {
			const current = read();
			const on = !current.kinds[kind];
			button.classList.toggle("is-on", on);
			button.setAttribute("aria-pressed", on ? "true" : "false");
			write({ ...current, kinds: { ...current.kinds, [kind]: on } });
		});
		legend.append(button);
	}
	for (const [tier, label] of [
		["weak", "弱"],
		["mid", "中"],
		["strong", "强"],
	] as const) {
		const item = document.createElement("span");
		item.className = "cpo-tier-key";
		const bar = document.createElement("i");
		bar.className = `cpo-tier cpo-tier-${tier}`;
		item.append(bar, document.createTextNode(label));
		legend.append(item);
	}
}

/** "到种子的路径"开关，面板抽屉与嵌入共用。 */
export function buildPathToggle(read: () => GraphFilter, write: (next: GraphFilter) => void): HTMLButtonElement {
	const path = document.createElement("button");
	path.type = "button";
	path.className = read().focusPath ? "cpo-path-toggle is-on" : "cpo-path-toggle";
	path.setAttribute("aria-pressed", read().focusPath ? "true" : "false");
	path.textContent = "到种子的路径";
	path.addEventListener("click", () => {
		const on = !read().focusPath;
		path.classList.toggle("is-on", on);
		path.setAttribute("aria-pressed", on ? "true" : "false");
		write({ ...read(), focusPath: on });
	});
	return path;
}
