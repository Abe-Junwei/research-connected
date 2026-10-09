import { tr } from "./i18n";
import type { LabelMode } from "./labels";
import { defaultColorMode, type ColorMode, type LayoutMode } from "./layout-modes";
import { classifyQuery, type SeedQuery } from "./paper";

/**
 * Fenced block language: `connected-papers` or `research-connected` (same body).
 *
 * The fence is the anchor. `position` only changes how that anchor sits in
 * the note; it does not move the graph to another heading.
 *
 * ```connected-papers
 * doi: 10.1038/nature14539
 * # optional
 * position: inline
 * width: 100%
 * height: 480
 * align: left
 * labels: author-year
 * maxNodes: 40
 * depth: 1
 * yearFrom: 1990
 * yearTo: 2018
 * language: en
 * type: article
 * concept: Deep learning
 * minCoCite: 2
 * minShared: 3
 * layout: temporal
 * ```
 *
 * `position`: `inline` (default, in the column), `float-left`, `float-right`
 * (beside the following text; default width 420px), or `full` (clear floats
 * and span the note column, cancelling Obsidian `--file-margins` when that
 * variable is set).
 * `width`: `420`, `420px`, `60%`, `24em`, or `24rem`. Default `100%`, or
 * `420px` when floating.
 * `height`: pixels, 280–900, default 480.
 * `align`: `left` (default), `center`, or `right`. Used when the block is
 * narrower than the column. Ignored for floats.
 * `labels`: `author-year` (default), `title`, `both`, or `off`.
 * `depth` 1 is the seed neighborhood; `depth` 2 also samples references of
 * the two closest papers. `maxNodes` overrides the setting (20–300).
 * `yearFrom` / `yearTo`: keep papers in that inclusive year range. The seed always stays.
 * `language`, `type`, `concept`: optional preset filters. They apply only when OpenAlex sent that field.
 * `minCoCite` / `minShared`: hide co-citation edges below that co-cite count, and coupling edges below that shared-reference count. Default 1.
 * `layout`: `temporal` (default; year on X), `radial`, or `force2d` (force
 * layout with community hulls). Legacy `kumu` / `community` and `force3d`
 * values map to `force2d`.
 * `color`: default follows layout (`community` on force2d, `topic` otherwise).
 * `topic`, `graph`, `community`, or `year` override that.
 * `doi`, `openalex` / `id`, or `seed`. A bare DOI or `W…` id also works.
 */
export type EmbedPosition = "inline" | "float-left" | "float-right" | "full";
export type EmbedAlign = "left" | "center" | "right";

/** Pixel clamps shared by the fence parser and the resize grip. */
export const EMBED_WIDTH_LIMIT = { min: 240, max: 1400 } as const;
export const EMBED_HEIGHT_LIMIT = { min: 280, max: 900 } as const;

export interface EmbedSpec {
	target: { kind: "doi" | "openalex"; value: string };
	maxNodes?: number;
	height: number;
	depth: 1 | 2;
	position: EmbedPosition;
	width: string;
	align: EmbedAlign;
	labels: LabelMode;
	yearFrom: number | null;
	yearTo: number | null;
	language: string | null;
	workType: string | null;
	concept: string | null;
	minCoCite: number;
	minShared: number;
	layout: LayoutMode;
	color: ColorMode;
}

const KEYS = new Set([
	"doi",
	"openalex",
	"id",
	"seed",
	"maxnodes",
	"height",
	"depth",
	"position",
	"width",
	"align",
	"labels",
	"yearfrom",
	"yearto",
	"language",
	"type",
	"concept",
	"concepts",
	"mincocite",
	"minshared",
	"layout",
	"color",
]);

export function parseEmbed(source: string): { ok: true; spec: EmbedSpec } | { ok: false; error: string } {
	let target: { kind: "doi" | "openalex"; value: string } | null = null;
	let maxNodes: number | undefined;
	let height = 480;
	let depth: 1 | 2 = 1;
	let position: EmbedPosition = "inline";
	let width: string | null = null;
	let align: EmbedAlign = "left";
	let labels: LabelMode = "author-year";
	let yearFrom: number | null = null;
	let yearTo: number | null = null;
	let language: string | null = null;
	let workType: string | null = null;
	let concept: string | null = null;
	let minCoCite = 1;
	let minShared = 1;
	let layout: LayoutMode = "temporal";
	let color: ColorMode | null = null;

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const split = line.indexOf(":");
		const looksKeyed = split > 0 && KEYS.has(line.slice(0, split).trim().toLowerCase());
		if (!looksKeyed) {
			const parsed = asSeed(line);
			if (!parsed.ok) return parsed;
			target = parsed.target;
			continue;
		}
		const key = line.slice(0, split).trim().toLowerCase();
		const value = line.slice(split + 1).trim();
		if (key === "doi" || key === "openalex" || key === "id" || key === "seed") {
			if (!value) return { ok: false, error: tr("种子不能为空。请写 DOI 或 OpenAlex ID。", "A seed is required. Enter a DOI or OpenAlex ID.") };
			const parsed = asSeed(value);
			if (!parsed.ok) return parsed;
			target = parsed.target;
			continue;
		}
		if (key === "maxnodes") {
			const parsed = readInt(value, "maxNodes");
			if (!parsed.ok) return parsed;
			maxNodes = clampInt(parsed.value, 20, 300);
			continue;
		}
		if (key === "height") {
			const parsed = readInt(value, "height");
			if (!parsed.ok) return parsed;
			height = clampInt(parsed.value, EMBED_HEIGHT_LIMIT.min, EMBED_HEIGHT_LIMIT.max);
			continue;
		}
		if (key === "depth") {
			const parsed = readInt(value, "depth");
			if (!parsed.ok) return parsed;
			depth = parsed.value >= 2 ? 2 : 1;
			continue;
		}
		if (key === "position") {
			const parsed = readPosition(value);
			if (!parsed) {
				return { ok: false, error: tr("position 只能是 inline、float-left、float-right 或 full。", "position must be inline, float-left, float-right, or full.") };
			}
			position = parsed;
			continue;
		}
		if (key === "width") {
			const parsed = readWidth(value);
			if (!parsed.ok) return parsed;
			width = parsed.width;
			continue;
		}
		if (key === "align") {
			const parsed = readAlign(value);
			if (!parsed) return { ok: false, error: tr("align 只能是 left、center 或 right。", "align must be left, center, or right.") };
			align = parsed;
			continue;
		}
		if (key === "labels") {
			const parsed = readLabels(value);
			if (!parsed) return { ok: false, error: tr("labels 只能是 author-year、title、both 或 off。", "labels must be author-year, title, both, or off.") };
			labels = parsed;
			continue;
		}
		if (key === "yearfrom" || key === "yearto") {
			const parsed = readInt(value, key === "yearfrom" ? "yearFrom" : "yearTo");
			if (!parsed.ok) return parsed;
			const year = clampInt(parsed.value, 1000, 2100);
			if (key === "yearfrom") yearFrom = year;
			else yearTo = year;
			continue;
		}
		if (key === "language") {
			const token = value.trim().toLowerCase();
			if (!token) return { ok: false, error: tr("language 不能为空。", "language cannot be empty.") };
			language = token;
			continue;
		}
		if (key === "type") {
			const token = value.trim().toLowerCase();
			if (!token) return { ok: false, error: tr("type 不能为空。", "type cannot be empty.") };
			workType = token;
			continue;
		}
		if (key === "concept" || key === "concepts") {
			const token = value.trim();
			if (!token) return { ok: false, error: tr("concept 不能为空。", "concept cannot be empty.") };
			concept = token;
			continue;
		}
		if (key === "layout") {
			const parsed = readLayout(value);
			if (!parsed) return { ok: false, error: tr("layout 只能是 temporal、radial 或 force2d。", "layout must be temporal, radial, or force2d.") };
			layout = parsed;
			continue;
		}
		if (key === "color") {
			const parsed = readColor(value);
			if (!parsed) return { ok: false, error: tr("color 只能是 topic、graph、community 或 year。", "color must be topic, graph, community, or year.") };
			color = parsed;
			continue;
		}
		const parsed = readInt(value, key === "mincocite" ? "minCoCite" : "minShared");
		if (!parsed.ok) return parsed;
		if (key === "mincocite") minCoCite = clampInt(parsed.value, 1, 40);
		else minShared = clampInt(parsed.value, 1, 80);
	}

	if (!target) {
		return { ok: false, error: tr("请写 doi: 10.1038/nature14539，或一行 OpenAlex ID。", "Enter doi: 10.1038/nature14539 or an OpenAlex ID on one line.") };
	}
	if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
		const swap = yearFrom;
		yearFrom = yearTo;
		yearTo = swap;
	}
	return {
		ok: true,
		spec: {
			target,
			maxNodes,
			height,
			depth,
			position,
			width: width ?? defaultWidth(position),
			align,
			labels,
			yearFrom,
			yearTo,
			language,
			workType,
			concept,
			minCoCite,
			minShared,
			layout,
			color: color ?? defaultColorMode(layout),
		},
	};
}

function asSeed(
	value: string,
): { ok: true; target: { kind: "doi" | "openalex"; value: string } } | { ok: false; error: string } {
	const parsed: SeedQuery | null = classifyQuery(value);
	if (!parsed || parsed.kind === "search") {
		return { ok: false, error: tr("嵌入里请写 DOI 或 OpenAlex ID。按标题搜索请用命令面板。", "Embeds require a DOI or OpenAlex ID. Use the command palette to search by title.") };
	}
	return { ok: true, target: parsed };
}

function readInt(value: string, label: string): { ok: true; value: number } | { ok: false; error: string } {
	if (!/^\d+$/.test(value)) return { ok: false, error: tr(`${label} 需要一个整数。`, `${label} requires an integer.`) };
	return { ok: true, value: Number(value) };
}

function readPosition(value: string): EmbedPosition | null {
	const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
	if (key === "inline" || key === "full" || key === "float-left" || key === "float-right") return key;
	return null;
}

function readAlign(value: string): EmbedAlign | null {
	const key = value.trim().toLowerCase();
	if (key === "left" || key === "center" || key === "centre" || key === "right") {
		return key === "centre" ? "center" : key;
	}
	return null;
}

function readLayout(value: string): LayoutMode | null {
	const key = value.trim().toLowerCase().replace(/[\s_]+/g, "");
	// kumu/community 与 force3d 都是历史值：圈层已并入平面，三维已移除。
	if (key === "kumu" || key === "community") return "force2d";
	if (key === "temporal" || key === "time" || key === "year") return "temporal";
	if (key === "radial") return "radial";
	if (key === "force2d" || key === "2d" || key === "flat") return "force2d";
	if (key === "force3d" || key === "3d") return "force2d";
	return null;
}

function readColor(value: string): ColorMode | null {
	const key = value.trim().toLowerCase();
	if (key === "graph" || key === "mono" || key === "plain") return "graph";
	if (key === "community" || key === "cluster") return "community";
	if (key === "year") return "year";
	if (key === "topic" || key === "topics") return "topic";
	return null;
}

function readLabels(value: string): LabelMode | null {
	const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
	if (key === "author-year" || key === "authoryear") return "author-year";
	if (key === "title" || key === "both" || key === "off") return key;
	return null;
}

function readWidth(value: string): { ok: true; width: string } | { ok: false; error: string } {
	const raw = value.trim().toLowerCase();
	if (/^\d+$/.test(raw)) return { ok: true, width: `${clampInt(Number(raw), EMBED_WIDTH_LIMIT.min, EMBED_WIDTH_LIMIT.max)}px` };
	const match = raw.match(/^(\d+(?:\.\d+)?)(px|%|em|rem)$/);
	if (!match) return { ok: false, error: tr("width 写成 420、420px、60% 或 24em。", "Write width as 420, 420px, 60%, or 24em.") };
	const amount = Number(match[1]);
	const unit = match[2];
	if (!unit || !Number.isFinite(amount)) return { ok: false, error: tr("width 写成 420、420px、60% 或 24em。", "Write width as 420, 420px, 60%, or 24em.") };
	if (unit === "px") return { ok: true, width: `${clampInt(amount, EMBED_WIDTH_LIMIT.min, EMBED_WIDTH_LIMIT.max)}px` };
	if (unit === "%") return { ok: true, width: `${clampInt(amount, 30, 100)}%` };
	return { ok: true, width: `${clampInt(amount, 16, 80)}${unit}` };
}

function defaultWidth(position: EmbedPosition): string {
	if (position === "float-left" || position === "float-right") return "420px";
	return "100%";
}

function clampInt(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}
