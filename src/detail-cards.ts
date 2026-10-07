import { edgeCitationPairs, evidenceLabel, SOURCE_TEXT, type CitationEvidence, type CrossCheckLike } from "./citation-evidence";
import type { RankedWork } from "./aggregates";
import { relationFacts } from "./graph-filter";
import { paintEvidenceBadges, paintPaperStateBadges } from "./graph-chrome";
import type { SelectionRank } from "./neighborhood";
import { nonResearchLabel } from "./paper";
import type { GraphEdge, Origin, PaperNode } from "./types";
import { formatCount } from "./visual";

/** Sidebar detail cards shared by the main pane and the note embed. */

export const ORIGIN_TEXT: Record<Origin, string> = {
	seed: "种子论文",
	reference: "种子的参考文献",
	citation: "引用了种子",
	related: "OpenAlex 相关作品",
};

/** Cross-check fields the metadata card reads; both graphs carry this shape. */
export type DetailCrossCheck = CrossCheckLike & { s2Citations?: number | null };

export interface RelationSectionOptions {
	sources: string;
	getEvidence(citingId: string, citedId: string): CitationEvidence | null;
	seedScore?: number;
	/** 本地语义分（BM25+主题）；null 显示「不可用」，undefined 不渲染该 meter。 */
	semanticScore?: number | null;
	/** 语义 meter 的 hint；缺省为本地通道文案。 */
	semanticHint?: string;
}

const AUTHOR_CHIP_LIMIT = 6;

/** 语义 meter 的 hint 文案：向量通道与本地通道分开标注。 */
export function semanticHintFor(mode?: "embedding" | "local"): string {
	return mode === "embedding" ? "SPECTER2 语义向量 + 主题" : "标题 / 摘要 / 主题，本地计算";
}

/** Author chips from the structured list; falls back to the joined string. */
export function paintAuthorChips(parent: HTMLElement, paper: PaperNode): void {
	const row = el(parent, "div", "cpo-badge-row cpo-author-chips");
	el(row, "span", "cpo-chip-label", "主要作者");
	const names = paper.authorList.length > 0 ? paper.authorList : [paper.authors];
	for (const name of names.slice(0, AUTHOR_CHIP_LIMIT)) el(row, "span", "cpo-chip cpo-chip-author", name);
	if (names.length > AUTHOR_CHIP_LIMIT) el(row, "span", "cpo-chip", `等 ${names.length} 位`);
}

/** 出处行：期刊名/书名 chip，悬停显示全文。元数据卡与聚合卡共用。 */
export function paintVenueRow(parent: HTMLElement, paper: PaperNode): void {
	if (!paper.venue) return;
	const row = el(parent, "div", "cpo-badge-row cpo-venue-row");
	el(row, "span", "cpo-chip-label", "出处");
	const venue = el(row, "span", "cpo-chip cpo-chip-venue", paper.venue);
	venue.title = paper.venue;
}

/** 聚合列表（先验/衍生）单条：与元数据卡同一体系的迷你卡，整条可点击。 */
export function paintAggregateCard(parent: HTMLElement, row: RankedWork, noun: string, onPick: (paper: PaperNode) => void): void {
	const item = el(parent, "li", "cpo-agg-entry");
	const card = el(item, "div", "cpo-card cpo-agg-card");
	card.setAttribute("role", "button");
	card.tabIndex = 0;
	const badges = el(card, "div", "cpo-badge-row");
	el(badges, "span", "cpo-chip cpo-chip-accent", `${noun} ${row.count} 次`);
	el(badges, "span", "cpo-chip", row.paper.year === null ? "年份不详" : `${row.paper.year} 年`);
	el(badges, "span", "cpo-chip cpo-chip-muted", `被引 ${formatCount(row.paper.citedByCount)}`);
	el(card, "h3", "cpo-card-title", row.paper.title || row.paper.id);
	paintAuthorChips(card, row.paper);
	paintVenueRow(card, row.paper);
	const run = () => onPick(row.paper);
	card.addEventListener("click", run);
	card.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			run();
		}
	});
}

/** 元数据卡：origin/年份/类型/被引徽章行 + 标题 + 作者 chips + 状态徽章与警告 + 主题 chips。 */
export function paintMetadataCard(parent: HTMLElement, paper: PaperNode, check: DetailCrossCheck | null | undefined): void {
	const card = el(parent, "section", "cpo-card cpo-paper-identity");
	el(card, "h3", "cpo-card-title", paper.title || paper.id);
	const authors = el(card, "div", "cpo-paper-authors");
	const authorNames = paper.authorList.length ? paper.authorList : paper.authors ? [paper.authors] : [];
	if (authorNames.length) {
		const author = el(authors, "span", undefined, authorNames.join(", "));
		author.title = authorNames.join(", ");
	}
	if (paper.year !== null) {
		if (authorNames.length) el(authors, "span", "cpo-paper-separator", "·");
		el(authors, "span", "cpo-paper-year", String(paper.year));
	}
	const publication = [
		paper.venue,
		paper.bibliography?.volume ? `${paper.bibliography.volume}${paper.bibliography.issue ? `(${paper.bibliography.issue})` : ""}` : null,
		paper.bibliography?.firstPage ? `${paper.bibliography.firstPage}${paper.bibliography.lastPage ? `–${paper.bibliography.lastPage}` : ""}` : null,
	].filter(Boolean);
	if (publication.length) {
		const row = el(card, "div", "cpo-paper-publication");
		row.setAttribute("aria-label", "出处与页码");
		publication.forEach((part, index) => {
			if (index) el(row, "span", "cpo-paper-separator", "·");
			el(row, "span", undefined, part!);
		});
	}
	paintPaperStateBadges(card, paper, check);
	if (paper.concepts.length > 0) {
		const topics = el(card, "div", "cpo-paper-topics");
		topics.setAttribute("aria-label", "论文主题");
		for (const name of paper.concepts.slice(0, 3)) el(topics, "span", "cpo-paper-topic", name);
		if (paper.concepts.length > 3) {
			const more = el(topics, "button", "cpo-paper-topic-more", `+${paper.concepts.length - 3}`) as HTMLButtonElement;
			more.type = "button";
			more.setAttribute("aria-expanded", "false");
			more.setAttribute("aria-label", `显示其余 ${paper.concepts.length - 3} 个主题`);
			more.onclick = () => {
				const expanded = more.getAttribute("aria-expanded") !== "true";
				more.setAttribute("aria-expanded", String(expanded));
				if (expanded) {
					for (const name of paper.concepts.slice(3)) {
						const chip = document.createElement("span");
						chip.className = "cpo-paper-topic cpo-paper-topic-extra";
						chip.textContent = name;
						more.before(chip);
					}
					more.textContent = "收起";
				} else {
					topics.querySelectorAll(".cpo-paper-topic-extra").forEach((chip) => chip.remove());
					more.textContent = `+${paper.concepts.length - 3}`;
				}
			};
		}
	}
	if (paper.retracted) {
		el(card, "p", "cpo-side-tip", "⚠ OpenAlex 将这篇作品标记为已撤稿（is_retracted）。引用它之前请先核实撤稿原因。");
	}
	const flagged = nonResearchLabel(paper);
	if (flagged) {
		el(card, "p", "cpo-side-tip", `OpenAlex 将这条记录标记为「${flagged}」。书评的题名里嵌着原书信息，指向它的引用往往属于原书，作者字段以实际书评作者为准——这是 OpenAlex 的数据特点，不是本插件的映射。`);
	}
	if (check?.mismatched) {
		const s2 = check.s2Citations === null || check.s2Citations === undefined ? "无记录" : formatCount(check.s2Citations);
		el(card, "p", "cpo-side-tip", `⚠ 数据源差异悬殊：OpenAlex 被引 ${formatCount(paper.citedByCount)}，Semantic Scholar 被引 ${s2}。差异这么大通常是记录错配（例如书评继承了原书的引用），引用前请经 DOI 链接核实。`);
	}
}

/** One labeled similarity meter; null renders the unavailable empty state. */
export function paintMeter(parent: HTMLElement, label: string, value: number | null, hint: string, alt = false): void {
	const meter = el(parent, "div", "cpo-meter");
	const head = el(meter, "div", "cpo-meter-head");
	el(head, "span", "cpo-meter-label", label);
	if (value === null) {
		el(head, "span", "cpo-meter-na", "不可用");
		el(meter, "p", "cpo-meter-hint", "当前缺少可比较数据");
		return;
	}
	el(head, "span", "cpo-meter-value", value.toFixed(2));
	const track = el(meter, "div", "cpo-meter-track");
	const fill = el(track, "div", alt ? "cpo-meter-fill cpo-meter-fill-alt" : "cpo-meter-fill");
	fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
	el(meter, "p", "cpo-meter-hint", hint);
}

function paintStat(parent: HTMLElement, label: string, value: string): void {
	const cell = el(parent, "div", "cpo-stat");
	el(cell, "span", "cpo-stat-label", label);
	el(cell, "span", "cpo-stat-value", value);
}

/** 关系证据卡：导语 + 相似度条 + 统计格 + 证据徽章/上下文 + 注意事项。节点与边视图共用。 */
export function paintRelationSection(parent: HTMLElement, edge: GraphEdge, a: PaperNode, b: PaperNode, options: RelationSectionOptions): void {
	const card = el(parent, "section", "cpo-card");
	const info = relationFacts(edge, a, b, options.sources);
	el(card, "p", "cpo-fact-lead", info.lead);
	if (options.seedScore !== undefined) paintMeter(card, "图谱综合相似度", options.seedScore, "结构 + 语义信号");
	if (edge.structuralSimilarity !== undefined) {
		paintMeter(card, "文献结构相似度", edge.structuralSimilarity, "共享参考文献 / 共被引", true);
	}
	if (options.semanticScore !== undefined) {
		paintMeter(card, "文本相似度", options.semanticScore, options.semanticHint ?? "标题 / 摘要 / 主题，本地计算", true);
	}
	const grid = el(card, "div", "cpo-stat-grid");
	paintStat(grid, "共享参考文献", `${edge.sharedRefs} 篇`);
	paintStat(grid, "共被引", `${edge.coCitedBy} 次`);
	paintStat(grid, "来源", options.sources);
	for (const pair of edgeCitationPairs(edge)) {
		const evidence = options.getEvidence(pair.citingId, pair.citedId);
		paintEvidenceBadges(card, evidence);
		if (evidence) {
			el(card, "p", "cpo-evidence", `证据：${evidenceLabel(evidence)}`);
			for (const context of evidence.contexts.slice(0, 5)) el(card, "blockquote", "cpo-side-tip", context);
		}
	}
	for (const caveat of info.caveats) el(card, "p", "cpo-fact-note", caveat);
}

/** 摘要卡：标题行 + 复制 + 四行折叠/展开；加载/缺失/来源标注文案来自 abstractText。 */
export function paintAbstractCard(parent: HTMLElement, paper: PaperNode, abstractText: (paper: PaperNode) => string): void {
	const card = el(parent, "section", "cpo-card");
	const head = el(card, "div", "cpo-card-head");
	el(head, "h3", "cpo-kicker", "摘要");
	const wrap = el(card, "div", "cpo-abstract-wrap");
	const para = el(wrap, "p", "cpo-abstract", abstractText(paper));
	if (!paper.abstract) return;
	para.classList.add("cpo-abstract-clamp");
	const fade = el(wrap, "div", "cpo-abstract-fade");
	const copy = el(head, "button", "cpo-text-btn", "复制") as HTMLButtonElement;
	copy.type = "button";
	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(paper.abstract).then(() => {
			copy.textContent = "已复制";
			window.setTimeout(() => { copy.textContent = "复制"; }, 1600);
		}, () => undefined);
	});
	const toggle = el(card, "button", "cpo-text-btn cpo-abstract-toggle", "展开全文") as HTMLButtonElement;
	toggle.type = "button";
	toggle.addEventListener("click", () => {
		const collapsed = para.classList.toggle("cpo-abstract-clamp");
		fade.hidden = !collapsed;
		toggle.textContent = collapsed ? "展开全文" : "收起摘要";
	});
}

/** 对方论文跳转条：compact 信息 + 「查看」。 */
export function paintJumpStrip(parent: HTMLElement, paper: PaperNode, onJump: (paper: PaperNode) => void): void {
	const strip = el(parent, "section", "cpo-jump-strip");
	const info = el(strip, "div", "cpo-jump-info");
	const head = el(info, "div", "cpo-badge-row");
	el(head, "span", "cpo-chip cpo-chip-accent", ORIGIN_TEXT[paper.origin]);
	el(head, "span", "cpo-chip cpo-chip-muted", `${paper.year ?? "年份不详"} · 被引 ${formatCount(paper.citedByCount)}`);
	el(info, "p", "cpo-jump-title", paper.title || paper.id);
	el(info, "p", "cpo-jump-meta", paper.authors);
	const go = el(strip, "button", "cpo-text-btn", "查看 →") as HTMLButtonElement;
	go.type = "button";
	go.addEventListener("click", () => onJump(paper));
}

/** Distinct evidence sources behind an edge's directed citation pairs. */
export function edgeSourcesText(edge: GraphEdge, getEvidence: (citingId: string, citedId: string) => CitationEvidence | null): string {
	const sources = new Set(edgeCitationPairs(edge).flatMap((pair) => getEvidence(pair.citingId, pair.citedId)?.sources ?? []));
	return sources.size ? [...sources].map((source) => SOURCE_TEXT[source]).join(" + ") : "OpenAlex 采样";
}

/** 「入选原因」折叠区：候选选择时的真实分数快照（仅 picked 节点有）。 */
export function paintSelectionReasons(parent: HTMLElement, rank: SelectionRank, currentScore?: number): void {
	const details = document.createElement("details");
	details.className = "cpo-card cpo-why";
	const summary = document.createElement("summary");
	summary.textContent = "入选原因";
	details.append(summary);
	paintMeter(details, "权威分", rank.authority, "log 被引 × 新近度，候选池内归一", true);
	paintMeter(details, "选择时语义分", rank.semantic, "标题 / 主题，本地计算（选择时摘要尚未补取）", true);
	paintMeter(details, "选择时相关性", rank.relevance, "0.5×权威 + 0.5×选择时语义；语义缺失时等于权威分；撤稿作品进一步降权", true);
	if (currentScore !== undefined) {
		paintMeter(details, "建图后当前综合分", currentScore, "结构 + 语义信号；未参与候选入选");
	}
	el(details, "p", "cpo-fact-note", "入选还受来源配额与多样性（MMR）影响。");
	parent.append(details);
}

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
