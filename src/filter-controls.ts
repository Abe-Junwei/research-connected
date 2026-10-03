import { facetOptions, type GraphFilter } from "./graph-filter";
import { RELATION_LABEL } from "./relation";
import type { PaperNode } from "./types";

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

export function buildFilters(
	host: HTMLElement,
	read: () => GraphFilter,
	write: (next: GraphFilter) => void,
): { fill: (nodes: PaperNode[]) => void } {
	const initial = read();
	const commit = (patch: Partial<GraphFilter>): void => {
		write({ ...read(), ...patch });
	};
	host.append(
		numberField("共被引 ≥", initial.minCoCitedBy, 1, 40, (value) => commit({ minCoCitedBy: value })),
		numberField("共享文献 ≥", initial.minSharedRefs, 1, 80, (value) => commit({ minSharedRefs: value })),
		yearField("从", initial.yearFrom, (yearFrom) => commit({ yearFrom })),
		yearField("到", initial.yearTo, (yearTo) => commit({ yearTo })),
	);
	const language = selectField("语言");
	const workType = selectField("类型");
	const concept = selectField("概念");
	language.label.hidden = true;
	workType.label.hidden = true;
	concept.label.hidden = true;
	host.append(language.label, workType.label, concept.label);
	const path = document.createElement("button");
	path.type = "button";
	path.className = read().focusPath ? "cpo-path-toggle is-on" : "cpo-path-toggle";
	path.setAttribute("aria-pressed", read().focusPath ? "true" : "false");
	path.textContent = "到种子的路径";
	path.addEventListener("click", () => {
		const on = !read().focusPath;
		path.classList.toggle("is-on", on);
		path.setAttribute("aria-pressed", on ? "true" : "false");
		commit({ focusPath: on });
	});
	host.append(path);

	const fill = (nodes: PaperNode[]): void => {
		const options = facetOptions(nodes);
		const current = read();
		fillSelect(language, options.languages, current.language, (languageValue) => commit({ language: languageValue }));
		fillSelect(workType, options.types, current.workType, (workTypeValue) => commit({ workType: workTypeValue }));
		fillSelect(concept, options.concepts, current.concept, (conceptValue) => commit({ concept: conceptValue }));
	};
	return { fill };
}

function numberField(label: string, value: number, min: number, max: number, onChange: (value: number) => void): HTMLLabelElement {
	const field = document.createElement("label");
	field.textContent = label;
	const input = document.createElement("input");
	input.type = "number";
	input.min = String(min);
	input.max = String(max);
	input.step = "1";
	input.value = String(value);
	input.addEventListener("change", () => {
		const next = Number(input.value);
		if (!Number.isFinite(next)) return;
		const clamped = Math.min(max, Math.max(min, Math.round(next)));
		input.value = String(clamped);
		onChange(clamped);
	});
	field.append(input);
	return field;
}

function yearField(label: string, value: number | null, onChange: (value: number | null) => void): HTMLLabelElement {
	const field = document.createElement("label");
	field.textContent = label;
	const input = document.createElement("input");
	input.type = "number";
	input.min = "1000";
	input.max = "2100";
	input.step = "1";
	input.placeholder = "年份";
	if (value !== null) input.value = String(value);
	input.addEventListener("change", () => {
		if (!input.value.trim()) {
			onChange(null);
			return;
		}
		const next = Number(input.value);
		if (!Number.isFinite(next)) return;
		const year = Math.min(2100, Math.max(1000, Math.round(next)));
		input.value = String(year);
		onChange(year);
	});
	field.append(input);
	return field;
}

function selectField(label: string): { label: HTMLLabelElement; select: HTMLSelectElement } {
	const field = document.createElement("label");
	field.textContent = label;
	const select = document.createElement("select");
	field.append(select);
	return { label: field, select };
}

function fillSelect(
	field: { label: HTMLLabelElement; select: HTMLSelectElement },
	options: string[],
	selected: string | null,
	onChange: (value: string | null) => void,
): void {
	const values = [...options];
	if (selected && !values.some((item) => item.toLowerCase() === selected.toLowerCase())) values.unshift(selected);
	field.label.hidden = values.length === 0;
	field.select.replaceChildren();
	const any = document.createElement("option");
	any.value = "";
	any.textContent = "全部";
	field.select.append(any);
	for (const option of values) {
		const item = document.createElement("option");
		item.value = option;
		item.textContent = option;
		if (selected && option.toLowerCase() === selected.toLowerCase()) item.selected = true;
		field.select.append(item);
	}
	field.select.onchange = () => onChange(field.select.value || null);
}
