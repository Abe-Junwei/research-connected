import { tr } from "./i18n";
import { edgeCitationPairs, evidenceLabel, SOURCE_TEXT, type CitationEvidence, type CrossCheckLike } from "./citation-evidence";
import type { RankedWork } from "./aggregates";
import { relationFacts, SIMILARITY_NOT_CITATION } from "./graph-filter";
import { createChromeIcon, paintEvidenceBadges, paintPaperStateBadges } from "./graph-chrome";
import type { SelectionRank, SimilarityGraph } from "./neighborhood";
import { paintPaperActions, paintPaperActionFeedback, type PaperActionOptions } from "./paper-actions";
import type { ProjectPaperState, ReadingStatus } from "./project-state";
import { nonResearchLabel, normalizeDoi } from "./paper";
import { comparableStructuralSimilarity, findEdge, observedRelationCount } from "./relation";
import type { GraphEdge, Origin, PaperNode } from "./types";
import { citationCountText, formatCount } from "./visual";
import { paperRecords } from "./work-identity";
import { admissionText } from "./admission";

/** Sidebar detail cards shared by the main pane and the note embed. */

export const ORIGIN_TEXT: Record<Origin, string> = {
	seed: tr("种子文献", "Seed paper"),
	reference: tr("种子的参考文献", "Seed references"),
	citation: tr("引用了种子", "Cites the seed"),
	related: tr("OpenAlex 相关作品", "OpenAlex related works"),
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

/** Shown when a vault note already matches this paper's DOI or OpenAlex id. */
export function paintLiteratureLink(parent: HTMLElement, path: string, open: (path: string) => void, alternatives?: string[]): void {
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const actionRow = card.querySelector<HTMLElement>(":scope > .cpo-paper-actions");
	const note = el(card, "p", "cpo-fact-note");
	if (alternatives?.length) {
		note.textContent = tr("匹配到多份笔记，请选择：", "Multiple matching notes. Choose one: ");
		for (const file of alternatives) { const pick = el(note, "button", "cpo-text-btn", file); pick.type = "button"; pick.onclick = () => open(file); }
		if (actionRow) card.insertBefore(note, actionRow);
		return;
	}
	const button = el(note, "button", "cpo-text-btn", tr("打开笔记", "Open note"));
	button.type = "button";
	button.title = path;
	button.onclick = () => open(path);
	note.prepend(document.createTextNode(tr("已有笔记 · ", "In your notes · ")));
	if (actionRow) card.insertBefore(note, actionRow);
}

export function paintIdentitySources(parent: HTMLElement, paper: PaperNode, open: (url: string) => void, separate: () => void, conflict = false, acknowledge?: () => void): void {
	if (!paper.records?.length) return;
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const details = el(card, "details", "cpo-work-sources");
	el(details, "summary", "cpo-fact-note", tr(`已合并 ${paper.records.length} 条同作品记录 · 查看来源`, `${paper.records.length} records merged for this work · Sources`));
	el(details, "p", "cpo-fact-note", tr("依据：相同 DOI 或已确认的版本归属。被引数与原始来源分别保留。", "Matched by DOI or a confirmed version decision. Citation counts and original sources remain separate."));
	for (const record of paper.records) {
		const row = el(details, "p", "cpo-fact-note", `${record.id} · ${citationCountText(record)} ${tr("次被引", "citations")} · `);
		if (record.doiUrl) { const link = el(row, "button", "cpo-text-btn", record.doiUrl.replace(/^https?:\/\/doi.org\//, "")); link.type = "button"; link.onclick = () => open(record.doiUrl!); }
	}
	if (conflict) {
		el(details, "p", "cpo-fact-note", tr("旧记录的阅读、收藏或排除状态不一致；已按各字段时间恢复，原值已保留。请核对当前状态。", "Legacy records have conflicting workflow states. The latest field values were restored and originals retained. Review the current state."));
		if (acknowledge) { const done = el(details, "button", "cpo-paper-action", tr("已核对状态", "States reviewed")); done.type = "button"; done.onclick = acknowledge; }
	}
	const button = el(details, "button", "cpo-paper-action", tr("保持这些记录分开", "Keep these records separate"));
	button.type = "button"; button.onclick = separate;
}

/** An explicit choice is required before different DOI records share one research identity. */
export function paintIdentityDecisionActions(parent: HTMLElement, paper: PaperNode, candidates: readonly PaperNode[], decide: (ids: string[], kind: "merge" | "clear") => Promise<void>): void {
	const own = paperRecords(paper).map(record => record.id);
	const others = [...new Map(candidates.flatMap(candidate => paperRecords(candidate)).filter(record => !own.includes(record.id)).map(record => [record.id, record])).values()];
	if (!others.length && own.length < 2) return;
	const details = el(parent, "details", "cpo-card cpo-why cpo-identity-decisions");
	el(details, "summary", "", tr("版本归属 · 全库", "Version identity · library-wide")).prepend(createChromeIcon("chevronRight"));
	const body = el(details, "div", "cpo-identity-body");
	el(body, "p", "cpo-fact-note", tr("仅在确认两条记录属于同一研究时合并；此决定影响所有项目。", "Merge only records of the same research; this decision affects every project."));
	const label = el(body, "label", "cpo-identity-label", tr("待确认版本", "Version to confirm")); label.hidden = !others.length;
	const choices = el(label, "select", "cpo-version-choice"); choices.setAttribute("aria-label", tr("选择具体版本", "Choose a version"));
	const placeholder = el(choices, "option", "", tr("请选择版本", "Choose a version")); placeholder.value = ""; placeholder.disabled = true; placeholder.selected = true;
	for (const record of others) { const option = el(choices, "option", "", `${record.title} · ${record.id}${record.doiUrl ? ` · ${record.doiUrl.replace(/^https?:\/\/doi.org\//, "")}` : ""}`); option.value = record.id; }
	const message = el(details, "p", "cpo-fact-note"); message.setAttribute("role", "status");
	const run = async (button: HTMLButtonElement, ids: string[], kind: "merge" | "clear") => {
		button.disabled = true;
		try { await decide(ids, kind); }
		catch (error) { message.textContent = error instanceof Error ? error.message : String(error); button.disabled = false; }
	};
	const actions = el(body, "div", "cpo-identity-actions");
	if (others.length) { const merge = el(actions, "button", "cpo-text-btn", tr("确认同一研究", "Confirm same research")); merge.type = "button"; merge.disabled = true; choices.onchange = () => { merge.disabled = !choices.value; }; merge.onclick = () => { if (choices.value) void run(merge, [...own, choices.value], "merge"); }; }
	if (own.length > 1 || paper.recordsSeparated) { const clear = el(actions, "button", "cpo-text-btn", tr("撤销人工归属", "Undo manual decision")); clear.type = "button"; clear.disabled = own.length < 2; choices.addEventListener("change", () => { clear.disabled = own.length < 2 && !choices.value; }); clear.onclick = () => { if (own.length > 1 || choices.value) void run(clear, own.length > 1 ? own : [paper.id, choices.value], "clear"); }; }
}

export function choosePaperVersion(paper: PaperNode, allowWhole = false, signal?: AbortSignal): Promise<{ paper: PaperNode; whole: boolean }> {
	if (signal?.aborted) return Promise.reject(new Error(tr("面板已关闭，未保存任何内容", "Panel closed; nothing saved")));
	const versions = paperRecords(paper);
	if (versions.length < 2) return Promise.resolve({ paper, whole: false });
	return new Promise((resolve, reject) => {
		const dialog = createEl("dialog"); dialog.className = "cpo-surface cpo-project-dialog"; dialog.setAttribute("aria-label", tr("选择操作版本", "Choose a version for this action"));
		el(dialog, "h3", "", tr("选择操作版本", "Choose a version for this action"));
		const select = el(dialog, "select", ""); select.setAttribute("aria-label", tr("版本或整项研究", "Version or whole research"));
		for (const version of versions) { const option = el(select, "option", "", `${version.id} · ${version.doiUrl ?? version.title}`); option.value = version.id; }
		if (allowWhole && !versions.some(version => version.isSeed)) { const option = el(select, "option", "", tr("整项研究（含未来版本）", "Whole research, including future versions")); option.value = "whole"; }
		const close = () => { signal?.removeEventListener("abort", cancelAction); dialog.close(); dialog.remove(); };
		const cancel = el(dialog, "button", "cpo-text-btn", tr("取消", "Cancel")); cancel.type = "button";
		const cancelAction = () => { close(); reject(new Error(tr("已取消，未保存", "Cancelled; nothing saved"))); };
		signal?.addEventListener("abort", cancelAction, { once: true });
		cancel.onclick = cancelAction; dialog.addEventListener("cancel", event => { event.preventDefault(); cancelAction(); });
		const confirm = el(dialog, "button", "cpo-text-btn", tr("确认", "Confirm")); confirm.type = "button";
		confirm.onclick = () => { const whole = select.value === "whole"; const version = versions.find(version => version.id === select.value) ?? versions[0]!; close(); resolve({ paper: { ...version }, whole }); };
		document.body.append(dialog); dialog.showModal(); select.focus();
	});
}

let readingGroupSequence = 0;

export function paintPaperWorkflowState(
	parent: HTMLElement, paper: PaperNode, state: ProjectPaperState & { readingConflict?: boolean },
	onReading: (reading: ReadingStatus, previous: ReadingStatus) => Promise<void> | void, onExclude?: () => Promise<void> | void,
	onRestore?: () => Promise<void> | void,
): void {
	const feedbackHost = parent.closest<HTMLElement>(".cpo-evidence-sidebar") ?? parent;
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const row = el(card, "div", "cpo-paper-actions");
	const readingRow = el(row, "div", "cpo-paper-reading-row");
	const group = el(readingRow, "div", "cpo-paper-reading");
	group.title = tr("阅读状态在各项目间共享", "Reading status is shared across projects");
	const trigger = el(group, "button", "cpo-paper-action cpo-reading-trigger");
	trigger.type = "button";
	trigger.setAttribute("aria-haspopup", "menu");
	trigger.setAttribute("aria-expanded", "false");
	const menu = el(group, "div", "cpo-reading-menu");
	menu.id = `cpo-reading-${++readingGroupSequence}`;
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-label", tr("选择阅读状态", "Choose reading status"));
	trigger.setAttribute("aria-controls", menu.id);
	menu.hidden = true;
	menu.onclick = event => event.stopPropagation();
	let currentReading = state.reading;
	let conflict = state.readingConflict;
	let busy = false;
	const pending = el(row, "span", "cpo-fact-note cpo-reading-feedback", tr("阅读状态待确认", "Reading status needs confirmation"));
	pending.setAttribute("role", "status");
	pending.hidden = !conflict;
	const labels: Record<ReadingStatus, string> = { unread: tr("未读", "Unread"), "to-read": tr("待读", "To read"), read: tr("已读", "Read") };
	const inputs: HTMLButtonElement[] = [];
	const close = (focus = false): void => {
		if (busy) return;
		menu.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
		if (focus) trigger.focus();
	};
	const paint = (): void => {
		group.setAttribute("aria-busy", String(busy));
		trigger.disabled = busy;
		const label = conflict ? tr("待确认", "Confirm status") : labels[currentReading];
		trigger.replaceChildren(document.createTextNode(label), createChromeIcon("chevronDown"));
		trigger.setAttribute("aria-label", tr(`阅读状态：${label}（各项目共享）`, `Reading status: ${label} (shared across projects)`));
		for (const input of inputs) {
			const checked = !conflict && input.value === currentReading;
			input.setAttribute("aria-checked", String(checked));
			input.textContent = `${checked ? "✓ " : ""}${labels[input.value as ReadingStatus]}`;
			input.disabled = busy;
		}
	};
	const save = async (next: ReadingStatus): Promise<void> => {
		if (busy || (next === currentReading && !conflict)) return;
		const previous = currentReading;
		const restoreFocus = menu.contains(document.activeElement);
		busy = true;
		paint();
		pending.hidden = false;
		pending.textContent = tr("正在保存…", "Saving…");
		try {
			await onReading(next, previous);
			currentReading = next;
			conflict = false;
			pending.hidden = true;
			busy = false;
			close();
		} catch {
			pending.textContent = tr("保存失败，请重试", "Could not save. Try again.");
		} finally {
			busy = false;
			paint();
			if (restoreFocus && group.isConnected) {
				if (menu.hidden) trigger.focus();
				else inputs.find(input => input.value === next)?.focus();
			}
		}
	};
	for (const reading of ["unread", "to-read", "read"] as const) {
		const input = el(menu, "button", "cpo-reading-option");
		input.type = "button";
		input.setAttribute("role", "menuitemradio");
		input.value = reading;
		input.onclick = () => { if (reading === currentReading && !conflict) close(true); else void save(reading); };
		inputs.push(input);
	}
	paint();
	const open = (last = false): void => {
		if (busy) return;
		menu.hidden = false;
		trigger.setAttribute("aria-expanded", "true");
		(last ? inputs[inputs.length - 1] : inputs.find(input => input.getAttribute("aria-checked") === "true") ?? inputs[0])?.focus();
	};
	trigger.onclick = () => { if (menu.hidden) open(); else close(); };
	trigger.onkeydown = event => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(event.key === "ArrowUp"); }
	};
	group.onkeydown = event => {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
		if (menu.hidden || event.target === trigger || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const index = inputs.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === "Home" ? 0 : event.key === "End" ? inputs.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length;
		inputs[next]?.focus();
	};
	group.addEventListener("focusout", event => { if (!group.contains(event.relatedTarget as Node | null)) close(); });
	if (!paper.isSeed && (onExclude || onRestore || state.excluded)) {
		const exclude = el(row, "button", "cpo-paper-action cpo-paper-exclude");
		exclude.type = "button";
		exclude.prepend(createChromeIcon(state.excluded ? "refresh" : "exclude"));
		const action = state.excluded ? onRestore : onExclude;
		exclude.disabled = !action;
		exclude.title = state.excluded ? tr("恢复到当前项目图谱", "Restore to the current project's graph") : tr("从当前项目排除", "Exclude from this project");
		exclude.setAttribute("aria-label", exclude.title);
		if (action) exclude.onclick = async () => {
			exclude.disabled = true;
			try {
				await action();
				paintPaperActionFeedback(feedbackHost, state.excluded ? tr("已恢复到当前项目图谱", "Restored to this project's graph") : tr("已从当前项目排除", "Excluded from this project"));
			}
			catch (error) {
				paintPaperActionFeedback(feedbackHost, error instanceof Error ? error.message : tr("保存失败，请重试", "Could not save. Try again."), true);
			}
			finally { exclude.disabled = !action; }
		};
	}
}

/** 语义 meter 的 hint 文案：向量通道与本地通道分开标注。 */
export function semanticHintFor(mode?: "embedding" | "local", model?: string | null): string {
	return mode === "embedding"
		? tr(`同模型语义向量${model ? ` (${model})` : ""}，结合可用主题`, `Same-model embeddings${model ? ` (${model})` : ""} with available topics`)
		: tr("标题 / 摘要 / 主题，本地计算", "Title, abstract, and topics; computed locally");
}

/** Author line from the structured list; falls back to the joined string. */
export function paintAuthorChips(parent: HTMLElement, paper: PaperNode): void {
	const names = paper.authorList?.length ? paper.authorList : paper.authors ? [paper.authors] : [];
	if (names.length === 0) return;
	const row = el(parent, "div", "cpo-badge-row cpo-author-chips");
	const text = el(row, "span", "cpo-paper-authors", names.slice(0, 5).join(" · "));
	if (names.length > 5) {
		const more = el(row, "button", "cpo-chip cpo-chip-author cpo-author-more", `+${names.length - 5}`);
		more.type = "button";
		more.setAttribute("aria-expanded", "false");
		more.setAttribute("aria-label", tr(`显示其余 ${names.length - 5} 位作者`, `Show ${names.length - 5} more authors`));
		more.onclick = () => {
			const expanded = more.getAttribute("aria-expanded") !== "true";
			more.setAttribute("aria-expanded", String(expanded));
			text.textContent = (expanded ? names : names.slice(0, 5)).join(" · ");
			more.textContent = expanded ? tr("收起", "Collapse") : `+${names.length - 5}`;
			more.setAttribute("aria-label", expanded ? tr("收起其余作者", "Collapse other authors") : tr(`显示其余 ${names.length - 5} 位作者`, `Show ${names.length - 5} more authors`));
		};
	}
}

/** 出处行：期刊名/书名题录行，悬停显示全文。元数据卡与聚合卡共用。 */
export function paintVenueRow(parent: HTMLElement, paper: PaperNode): void {
	if (!paper.venue) return;
	const row = el(parent, "div", "cpo-badge-row cpo-venue-row");
	const venue = el(row, "span", "cpo-paper-venue", paper.venue);
	venue.title = paper.venue;
}

/** 聚合列表单条：与元数据卡同一体系的迷你卡，整条可点击。 */
export function paintAggregateCard(parent: HTMLElement, row: RankedWork, noun: string, onPick: (paper: PaperNode) => void, onActions?: (card: HTMLElement, paper: PaperNode) => void): void {
	const item = el(parent, "li", "cpo-agg-entry");
	const card = el(item, "div", "cpo-card cpo-agg-card");
	const badges = el(card, "div", "cpo-badge-row");
	el(badges, "span", "cpo-chip cpo-chip-accent", tr(`${noun} ${row.count} 次`, `${noun} ${row.count} times`));
	el(badges, "span", "cpo-chip", row.paper.year === null ? tr("年份不详", "Year unknown") : tr(`${row.paper.year} 年`, `${row.paper.year}`));
	el(badges, "span", "cpo-chip cpo-chip-muted", tr(`被引 ${citationCountText(row.paper)}`, `Cited ${citationCountText(row.paper)} times`));
	const heading = el(card, "h3", "cpo-card-title");
	const open = el(heading, "button", "cpo-agg-open", row.paper.title || row.paper.id);
	open.type = "button";
	open.setAttribute("aria-label", tr(`查看论文：${row.paper.title || row.paper.id}`, `View paper: ${row.paper.title || row.paper.id}`));
	paintAuthorChips(card, row.paper);
	paintVenueRow(card, row.paper);
	const run = () => onPick(row.paper);
	open.addEventListener("click", run);
	card.addEventListener("click", (event) => {
		if (!(event.target as HTMLElement).closest("button, select")) run();
	});
	onActions?.(card, row.paper);
}

/** 元数据卡：origin/年份/类型/被引徽章行 + 标题 + 作者 chips + 状态徽章与警告 + 主题 chips。 */
export function paintMetadataCard(parent: HTMLElement, paper: PaperNode, check: DetailCrossCheck | null | undefined, isClassic = false): void {
	const card = el(parent, "section", "cpo-card cpo-paper-identity");
	const title = el(card, "h3", "cpo-card-title", paper.title || paper.id);
	if (isClassic) {
		const icon = createChromeIcon("star");
		icon.classList.add("cpo-paper-classic-icon");
		const marker = el(title, "span", "cpo-paper-title-source");
		marker.title = tr("高被引提示：依据被引量与发表年限的启发式标记，不代表学术质量评定", "High-citation indicator: a heuristic based on citations and age, not an assessment of research quality");
		marker.setAttribute("role", "img");
		marker.setAttribute("aria-label", marker.title);
		marker.append(icon);
	}
	el(card, "p", "cpo-library-meta", [
		ORIGIN_TEXT[paper.origin],
		paper.year === null ? tr("年份不详", "Year unknown") : tr(`${paper.year} 年`, `${paper.year}`),
		tr(`被引 ${citationCountText(paper)}`, `Cited ${citationCountText(paper)} times`),
	].join(" · "));
	paintAuthorChips(card, paper);
	paintVenueRow(card, paper);
	paintPaperStateBadges(card, paper, check);
	if (!paper.isSeed && paper.admission) el(card, "p", "cpo-fact-note", admissionText(paper.admission));
	if (paper.concepts.length > 0) {
		const topics = el(card, "div", "cpo-paper-topics");
		topics.setAttribute("aria-label", tr("论文主题", "Paper topics"));
		for (const name of paper.concepts.slice(0, 3)) el(topics, "span", "cpo-paper-topic", name);
		if (paper.concepts.length > 3) {
			const more = el(topics, "button", "cpo-paper-topic-more", `+${paper.concepts.length - 3}`);
			more.type = "button";
			more.setAttribute("aria-expanded", "false");
			more.setAttribute("aria-label", tr(`显示其余 ${paper.concepts.length - 3} 个主题`, `Show ${paper.concepts.length - 3} more topics`));
			more.onclick = () => {
				const expanded = more.getAttribute("aria-expanded") !== "true";
				more.setAttribute("aria-expanded", String(expanded));
				if (expanded) {
					for (const name of paper.concepts.slice(3)) {
						const chip = createSpan();
						chip.className = "cpo-paper-topic cpo-paper-topic-extra";
						chip.textContent = name;
						more.before(chip);
					}
					more.textContent = tr("收起", "Collapse");
				} else {
					topics.querySelectorAll(".cpo-paper-topic-extra").forEach((chip) => chip.remove());
					more.textContent = `+${paper.concepts.length - 3}`;
				}
			};
		}
	}
	if (paper.retracted) {
		el(card, "p", "cpo-side-tip", tr("⚠ OpenAlex 将这篇作品标记为已撤稿（is_retracted）。引用它之前请先核实撤稿原因。", "⚠ OpenAlex marks this work as retracted (is_retracted). Check the reason before citing it."));
	}
	const flagged = nonResearchLabel(paper);
	if (flagged) {
		el(card, "p", "cpo-side-tip", tr(`OpenAlex 将此记录标记为「${flagged}」。请通过原始来源核对文献类型和作者。`, `OpenAlex labels this record as “${flagged}”. Verify its type and authors against the original source.`));
	}
	if (check?.mismatched) {
		const s2 = check.s2Citations === null || check.s2Citations === undefined ? tr("无记录", "No record") : formatCount(check.s2Citations);
		el(card, "p", "cpo-side-tip", tr(`⚠ 被引次数差异较大：OpenAlex ${citationCountText(paper)}，Semantic Scholar ${s2}。可能与收录范围、更新或记录归并有关，请通过 DOI 核对论文身份。`, `⚠ Citation counts differ: OpenAlex ${citationCountText(paper)}; Semantic Scholar ${s2}. Coverage, updates, or record grouping may explain the difference. Verify the paper's identity through its DOI.`));
	}
}

/** One labeled similarity meter; null renders the unavailable empty state. */
export function paintMeter(parent: HTMLElement, label: string, value: number | null, hint: string, alt = false): void {
	const meter = el(parent, "div", "cpo-meter");
	meter.title = hint;
	const head = el(meter, "div", "cpo-meter-head");
	el(head, "span", "cpo-meter-label", label);
	if (value === null) {
		el(head, "span", "cpo-meter-na", tr("不可用", "Unavailable"));
		el(meter, "p", "cpo-meter-hint", tr("当前缺少可比较数据", "No comparable data is available"));
		return;
	}
	meter.classList.add("cpo-meter-valued");
	el(head, "span", "cpo-meter-value", value.toFixed(2));
	const track = el(meter, "div", "cpo-meter-track");
	const fill = el(track, "div", alt ? "cpo-meter-fill cpo-meter-fill-alt" : "cpo-meter-fill");
	fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
	el(meter, "p", "cpo-meter-hint", hint);
}

function paintStat(parent: HTMLElement, label: string, value: string): HTMLElement {
	const cell = el(parent, "div", "cpo-stat");
	el(cell, "span", "cpo-stat-label", label);
	el(cell, "span", "cpo-stat-value", value);
	return cell;
}

/** 关系证据卡：导语 + 相似度条 + 统计格 + 证据徽章/上下文 + 注意事项。节点与边视图共用。 */
export function paintRelationSection(parent: HTMLElement, edge: GraphEdge, a: PaperNode, b: PaperNode, options: RelationSectionOptions): void {
	const card = el(parent, "section", "cpo-card");
	const info = relationFacts(edge, a, b, options.sources);
	el(card, "p", "cpo-fact-lead", info.lead);
	if (options.seedScore !== undefined) paintMeter(card, tr("图谱综合相似度", "Overall graph similarity"), options.seedScore, tr("结构 + 语义信号", "Structure and semantic signals"));
	paintMeter(card, tr("文献结构相似度", "Structural similarity"), comparableStructuralSimilarity(edge), tr("当前列表与采样中的共享参考文献 / 共被引", "Shared references and co-citations in obtained lists and this sample"), true);
	if (options.semanticScore !== undefined) {
		paintMeter(card, tr("语义相似度", "Semantic similarity"), options.semanticScore, options.semanticHint ?? tr("标题 / 摘要 / 主题，本地计算", "Title, abstract, and topics; computed locally"), true);
	}
	const grid = el(card, "div", "cpo-stat-grid");
	paintStat(grid, tr("共享参考文献", "Shared references"), observedRelationCount(edge, "references"));
	paintStat(grid, tr("共被引", "Co-citations"), observedRelationCount(edge, "coCitation"));
	const source = paintStat(grid, tr("来源", "Source"), options.sources);
	const sourceLabel = source.querySelector<HTMLElement>(".cpo-stat-label")!;
	sourceLabel.classList.add("cpo-source-label");
	for (const pair of edgeCitationPairs(edge)) {
		const evidence = options.getEvidence(pair.citingId, pair.citedId);
		paintEvidenceBadges(sourceLabel, evidence);
		if (evidence) {
			const label = evidenceLabel(evidence);
			if (label) el(card, "p", "cpo-evidence", tr(`证据：${label}`, `Evidence: ${label}`));
			for (const context of evidence.contexts.slice(0, 5)) el(card, "blockquote", "cpo-side-tip", context);
		}
	}
	for (const caveat of info.caveats) el(card, "p", "cpo-fact-note", caveat);
}

/** 摘要卡：标题行 + 复制 + 四行折叠/展开；加载/缺失/来源标注文案来自 abstractText。 */
export function paintAbstractCard(parent: HTMLElement, paper: PaperNode, abstractText: (paper: PaperNode) => string): void {
	const card = el(parent, "section", "cpo-card");
	const head = el(card, "div", "cpo-card-head");
	el(head, "h3", "cpo-kicker", tr("摘要", "Abstract"));
	const wrap = el(card, "div", "cpo-abstract-wrap");
	const para = el(wrap, "p", "cpo-abstract", abstractText(paper));
	if (!paper.abstract) return;
	para.classList.add("cpo-abstract-clamp");
	const fade = el(wrap, "div", "cpo-abstract-fade");
	fade.hidden = true;
	const copy = el(head, "button", "cpo-ghost cpo-abstract-copy");
	copy.type = "button";
	copy.append(createChromeIcon("copy"));
	copy.setAttribute("aria-label", tr("复制", "Copy"));
	copy.title = tr("复制", "Copy");
	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(paper.abstract).then(() => {
			copy.setAttribute("aria-label", tr("已复制", "Copied"));
			copy.title = tr("已复制", "Copied");
			window.setTimeout(() => {
				copy.setAttribute("aria-label", tr("复制", "Copy"));
				copy.title = tr("复制", "Copy");
			}, 1600);
		}, () => undefined);
	});
	const toggle = el(card, "button", "cpo-ghost cpo-abstract-toggle");
	toggle.type = "button";
	toggle.setAttribute("aria-expanded", "false");
	toggle.setAttribute("aria-label", tr("展开摘要", "Show full abstract"));
	toggle.title = tr("展开摘要", "Show full abstract");
	toggle.append(createChromeIcon("chevronDown"));
	toggle.hidden = true;
	const syncClamp = (): void => {
		if (!para.isConnected) {
			observer.disconnect();
			return;
		}
		if (!para.classList.contains("cpo-abstract-clamp")) return;
		const overflow = para.clientHeight > 0 && para.scrollHeight > para.clientHeight + 1;
		fade.hidden = !overflow;
		toggle.hidden = !overflow;
	};
	const observer = new ResizeObserver(syncClamp);
	observer.observe(para);
	toggle.addEventListener("click", () => {
		const collapsed = para.classList.toggle("cpo-abstract-clamp");
		toggle.setAttribute("aria-expanded", String(!collapsed));
		fade.hidden = !collapsed;
		toggle.hidden = false;
		const label = collapsed ? tr("展开摘要", "Show full abstract") : tr("收起摘要", "Collapse abstract");
		toggle.replaceChildren(createChromeIcon(collapsed ? "chevronDown" : "chevronUp"));
		toggle.setAttribute("aria-label", label);
		toggle.title = label;
	});
	syncClamp();
}

/** 对方论文跳转条：compact 信息 + 「查看」。 */
export function paintJumpStrip(parent: HTMLElement, paper: PaperNode, onJump: (paper: PaperNode) => void): void {
	const strip = el(parent, "section", "cpo-jump-strip");
	const info = el(strip, "div", "cpo-jump-info");
	const head = el(info, "div", "cpo-badge-row");
	el(head, "span", "cpo-chip cpo-chip-accent", ORIGIN_TEXT[paper.origin]);
	el(head, "span", "cpo-chip cpo-chip-muted", tr(`${paper.year ?? tr("年份不详", "Year unknown")} · 被引 ${citationCountText(paper)}`, `${paper.year ?? tr("年份不详", "Year unknown")} · cited ${citationCountText(paper)} times`));
	el(info, "p", "cpo-jump-title", paper.title || paper.id);
	el(info, "p", "cpo-jump-meta", paper.authors);
	const go = el(strip, "button", "cpo-text-btn", tr("查看", "View"));
	go.append(createChromeIcon("chevronRight"));
	go.type = "button";
	go.addEventListener("click", () => onJump(paper));
}

/** Distinct evidence sources behind an edge's directed citation pairs. */
export function edgeSourcesText(edge: GraphEdge, getEvidence: (citingId: string, citedId: string) => CitationEvidence | null): string {
	const sources = new Set(edgeCitationPairs(edge).flatMap((pair) => getEvidence(pair.citingId, pair.citedId)?.sources ?? []));
	return sources.size ? [...sources].map((source) => SOURCE_TEXT[source]).join(" + ") : tr("来源未知", "Source unknown");
}

/** 「入选原因」折叠区：候选选择时的真实分数快照（仅 picked 节点有）。 */
export function paintSelectionReasons(parent: HTMLElement, rank: SelectionRank, currentScore?: number): void {
	const details = createEl("details");
	details.className = "cpo-card cpo-why";
	const summary = createEl("summary");
	summary.textContent = tr("入选原因", "Why selected");
	summary.prepend(createChromeIcon("chevronRight"));
	details.append(summary);
	paintMeter(details, tr("被引与时效分", "Citation–recency score"), rank.authority, tr("基于被引量和发表年份的排序信号，不是学术质量评定", "A ranking signal based on citations and publication year, not research quality"), true);
	const selectionHint = rank.semanticChannel
		? semanticHintFor(rank.semanticChannel, rank.semanticModel)
		: tr("根据入选时可用的文本、主题或兼容向量计算；旧快照未记录具体通道", "Based on text, topics, or compatible vectors available at selection; this older snapshot did not record the channel");
	paintMeter(details, tr("入选时语义分", "Semantic score at selection"), rank.semantic, selectionHint, true);
	paintMeter(details, tr("入选排序分", "Selection score"), rank.relevance, tr("综合被引与时效、语义信号；缺少语义时仅使用前者，撤稿文献降权。不是相关概率", "Combines citation–recency and semantic signals; uses the former alone if semantics are unavailable. Retracted works are penalized. Not a relevance probability"), true);
	if (currentScore !== undefined) {
		paintMeter(details, tr("建图后当前综合分", "Current overall score"), currentScore, tr("结构 + 语义信号；未参与候选入选", "Structure and semantic signals; not used for candidate selection"));
	}
	el(details, "p", "cpo-fact-note", tr("入选还受节点上限、相关来源上限和多样性筛选（MMR）影响。", "Selection also depends on node and related-source limits, and diversity selection (MMR)."));
	parent.append(details);
}

export function abstractCaption(
	paper: PaperNode,
	sources: { s2: ReadonlySet<string>; crossref: ReadonlySet<string>; missing: ReadonlySet<string>; errors?: ReadonlyMap<string, string> },
): string {
	const key = normalizeDoi(paper.doiUrl) ?? paper.id;
	if (paper.abstract) {
		const recordedSource = paper.abstractSource ?? (sources.s2.has(key) || sources.s2.has(paper.id) ? "s2" : sources.crossref.has(key) || sources.crossref.has(paper.id) ? "crossref" : undefined);
		const source = recordedSource === "s2" ? "Semantic Scholar" : recordedSource === "crossref" ? "Crossref" : "";
		return paper.abstract + (source ? tr(`（摘要来源：${source}）`, ` (abstract source: ${source})`) : "");
	}
	if (!normalizeDoi(paper.doiUrl)) return tr("暂未获取到摘要；此记录缺少 DOI，无法通过备用来源查询。", "No abstract retrieved. This record has no DOI for fallback lookup.");
	const error = sources.errors?.get(key) ?? sources.errors?.get(paper.id);
	if (error) return tr(`暂未获取到摘要，部分请求失败。可重试。详情：${error}`, `No abstract retrieved; some requests failed. Retry is available. Details: ${error}`);
	if (sources.missing.has(key) || sources.missing.has(paper.id)) return tr("暂未获取到摘要；本次查询未返回摘要内容。", "No abstract retrieved; this lookup returned no abstract text.");
	return tr("正在尝试从 Semantic Scholar / Crossref 获取摘要…", "Trying Semantic Scholar and Crossref for an abstract…");
}

export interface PaperDetailOptions {
	isClassic?: boolean;
	abstractText: (paper: PaperNode) => string;
	onRetryAbstract?: () => void;
	openExternal: (url: string) => void;
	separate: () => void;
	conflict: boolean;
	acknowledge?: () => void;
	workflow: ProjectPaperState & { readingConflict?: boolean };
	onReading: (reading: ReadingStatus, previous: ReadingStatus) => Promise<void> | void;
	onExclude?: () => Promise<void> | void;
	onRestore?: () => Promise<void> | void;
	literature?: { path: string; alternatives?: string[]; open: (path: string) => void };
	lookupLiteratureNote?: (paper: PaperNode) => { path: string; alternatives?: string[] } | null;
	openLiteratureNote?: (path: string) => void;
	signal?: AbortSignal;
	diveNote?: string;
	actions: PaperActionOptions;
	onJump: (paper: PaperNode) => void;
	/** Selected edge that is not the seed link. The pane passes null. */
	extraEdge?: GraphEdge | null;
}

/** Shared paper-detail order for the pane and the note embed. */
export function paintPaperDetail(parent: HTMLElement, graph: SimilarityGraph, paper: PaperNode, options: PaperDetailOptions): void {
	const seed = graph.nodes.find((node) => node.isSeed) ?? null;
	const getEvidence = (citingId: string, citedId: string) => graph.citationEvidence?.get(citingId, citedId) ?? null;
	paintMetadataCard(parent, paper, graph.crossCheck?.get(paper.id), options.isClassic);
	paintIdentitySources(parent, paper, options.openExternal, options.separate, options.conflict, options.acknowledge);
	const versionFacts = graph.researchProjection?.selfCitations.filter(link => paperRecords(paper).some(record => record.id === link.citingId || record.id === link.citedId)) ?? [];
	if (versionFacts.length) { const facts = el(parent, "details", "cpo-work-sources"); el(facts, "summary", "cpo-fact-note", tr("研究内部的版本引用", "Citations between versions of this research")); for (const link of versionFacts) el(facts, "p", "cpo-fact-note", `${link.citingId} → ${link.citedId} · ${link.source}`); }
	paintPaperWorkflowState(parent, paper, options.workflow, options.onReading, options.onExclude, options.onRestore);
	if (paperRecords(paper).length > 1 && options.lookupLiteratureNote && options.openLiteratureNote) {
		const records = paperRecords(paper);
		if (records.some(record => options.lookupLiteratureNote!(record))) {
			const host = el(parent.querySelector<HTMLElement>(".cpo-paper-identity") ?? parent, "div", "cpo-fact-note");
			const button = el(host, "button", "cpo-text-btn", tr("选择版本并打开笔记", "Choose version and open note"));
			button.type = "button";
			button.onclick = async () => {
				try {
					const selected = (await choosePaperVersion(paper, false, options.signal)).paper;
					if (!host.isConnected) return;
					const note = options.lookupLiteratureNote!(selected);
					if (note) { host.replaceChildren(); paintLiteratureLink(host, note.path, options.openLiteratureNote!, note.alternatives); }
					else paintPaperActionFeedback(host, tr("此版本没有匹配笔记，可从导出创建", "No note for this version; create one from Export"));
				} catch (error) { if (host.isConnected) paintPaperActionFeedback(host, error instanceof Error ? error.message : String(error), true); }
			};
		}
	} else if (options.literature) paintLiteratureLink(parent, options.literature.path, options.literature.open, options.literature.alternatives);
	if (options.diveNote) {
		const identityCard = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
		const actionRow = identityCard.querySelector<HTMLElement>(":scope > .cpo-paper-actions");
		const diveNote = el(identityCard, "p", "cpo-fact-note", options.diveNote);
		if (actionRow) identityCard.insertBefore(diveNote, actionRow);
	}
	const stageEdge = seed && !paper.isSeed ? findEdge(graph.edges, paper.id, seed.id) : null;
	const stageEvidence = seed && !paper.isSeed ? getEvidence(paper.id, seed.id) ?? getEvidence(seed.id, paper.id) : null;
	paintPaperActions(parent, paper, seed?.id ?? null, stageEdge, stageEvidence, options.actions);
	paintAbstractCard(parent, paper, options.abstractText);
	if (options.onRetryAbstract) {
		const host = parent.querySelector<HTMLElement>(".cpo-abstract-wrap") ?? parent;
		const retry = el(host, "button", "cpo-text-btn", tr("重试获取摘要", "Retry abstract lookup"));
		retry.type = "button";
		retry.onclick = options.onRetryAbstract;
	}
	if (seed && !paper.isSeed) {
		const semanticHint = semanticHintFor(graph.semanticVectorIds?.includes(paper.id) ? "embedding" : "local", graph.semanticModel);
		const score = graph.seedScore.get(paper.id);
		const from = stageEdge ? graph.nodes.find((node) => node.id === stageEdge.source) : undefined;
		const to = stageEdge ? graph.nodes.find((node) => node.id === stageEdge.target) : undefined;
		if (stageEdge && from && to) {
			paintRelationSection(parent, stageEdge, from, to, {
				sources: edgeSourcesText(stageEdge, getEvidence),
				getEvidence,
				seedScore: score,
				semanticScore: graph.semanticScores?.get(paper.id),
				semanticHint,
			});
		} else {
			const recorded = getEvidence(paper.id, seed.id) ?? getEvidence(seed.id, paper.id);
			if (score !== undefined || !recorded) {
				const card = el(parent, "section", "cpo-card");
				if (score !== undefined) paintMeter(card, tr("图谱综合相似度", "Overall graph similarity"), score, tr("结构 + 语义信号", "Structure and semantic signals"));
				const semantic = graph.semanticScores?.get(paper.id);
				if (semantic !== undefined) paintMeter(card, tr("语义相似度", "Semantic similarity"), semantic, semanticHint, true);
				if (!recorded) el(card, "p", "cpo-fact-note", tr(`与种子没有直接引用记录 · ${SIMILARITY_NOT_CITATION}`, `No direct citation to the seed recorded · ${SIMILARITY_NOT_CITATION}`));
			}
		}
		const rankInfo = graph.selectionRank?.get(paper.id);
		if (rankInfo) paintSelectionReasons(parent, rankInfo, score);
	}
	const extra = options.extraEdge;
	if (extra && seed && !samePair(extra, paper.id, seed.id)) {
		const from = graph.nodes.find((node) => node.id === extra.source);
		const to = graph.nodes.find((node) => node.id === extra.target);
		if (from && to) paintRelationSection(parent, extra, from, to, { sources: edgeSourcesText(extra, getEvidence), getEvidence });
	}
}

function samePair(edge: GraphEdge, a: string, b: string): boolean {
	return (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a);
}

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = createEl(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}
