import { tr } from "./i18n";
import { createChromeIcon } from "./graph-chrome";
import type { CitationEvidence } from "./citation-evidence";
import { stageSourceLabel } from "./staging";
import type { ProjectPaperState } from "./project-state";
import { allowedExternalUrl } from "./safe-url";
import type { GraphEdge, PaperNode } from "./types";

export interface PaperActionOptions {
	getPaperState: (seedId: string, paperId: string) => ProjectPaperState | undefined;
	setStaged: (paper: PaperNode, seedId: string, staged: boolean, source: string) => void;
	persist?: (source: string) => Promise<void> | void;
	commit?: (patch: { staged?: boolean }, source: string) => Promise<void>;
	readingConflict?: boolean;
	openExternal: (url: string) => void;
}

export function paintPaperActionFeedback(parent: HTMLElement, message: string, failed = false): void {
	const card = parent.closest<HTMLElement>(".cpo-evidence-sidebar") ?? parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	card.querySelector(".cpo-paper-action-feedback")?.remove();
	const feedback = createSpan();
	feedback.setAttribute("role", "status");
	card.append(feedback);
	feedback.className = failed ? "cpo-paper-action-feedback cpo-paper-action-error" : "cpo-paper-action-feedback cpo-fact-note";
	feedback.textContent = message;
	if (!failed) window.setTimeout(() => feedback.remove(), 3000);
}

/** Paper-scoped actions are shared by graph pane and note embed. */
export function paintPaperActions(
	parent: HTMLElement,
	paper: PaperNode,
	seedId: string | null,
	edge: GraphEdge | null,
	evidence: CitationEvidence | null,
	options: PaperActionOptions,
): void {
	const feedbackHost = parent.closest<HTMLElement>(".cpo-evidence-sidebar") ?? parent;
	const card = parent.querySelector<HTMLElement>(":scope > .cpo-paper-identity") ?? parent;
	const row = card.querySelector<HTMLElement>(":scope > .cpo-paper-actions") ?? createDiv();
	row.classList.add("cpo-paper-actions");
	if (!row.parentElement) card.append(row);
	const sources = createDiv();
	sources.className = "cpo-paper-sources";
	if (seedId && (options.persist || options.commit)) {
		const button = createEl("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-stage";
		const paintStage = (): void => {
			const staged = Boolean(options.getPaperState(seedId, paper.id)?.staged);
			button.replaceChildren(createChromeIcon(staged ? "bookmarkCheck" : "bookmark"));
			button.setAttribute("aria-pressed", String(staged));
			button.title = staged ? tr("从当前项目取消收藏", "Remove from this project's saved papers") : tr("收藏到当前项目", "Save to this project");
			button.setAttribute("aria-label", button.title);
		};
		paintStage();
		let busy = false;
		const save = async (): Promise<void> => {
			if (busy) return;
			busy = true;
			const before = Boolean(options.getPaperState(seedId, paper.id)?.staged);
			const source = stageSourceLabel(paper, seedId, edge, evidence);
			button.disabled = true;
			button.setAttribute("aria-busy", "true");
			try {
				if (options.commit) await options.commit({ staged: !before }, source);
				else {
					options.setStaged(paper, seedId, !before, source);
					try { await options.persist?.(source); }
					catch (error) { options.setStaged(paper, seedId, before, source); throw error; }
				}
				paintStage();
				paintPaperActionFeedback(feedbackHost, before ? tr("已取消收藏", "Removed from saved papers") : tr("已收藏到当前项目", "Saved to this project"));
			} catch (failure) {
				paintPaperActionFeedback(feedbackHost, failure instanceof Error ? failure.message : tr("保存失败，请重试", "Could not save. Try again."), true);
			} finally {
				busy = false;
				button.disabled = false;
				button.removeAttribute("aria-busy");
			}
		};
		button.onclick = () => { void save(); };
		row.insertBefore(button, row.querySelector(".cpo-paper-exclude"));
	}
	for (const [label, candidate] of [["OpenAlex", paper.openAlexUrl], ["DOI", paper.doiUrl]] as const) {
		const url = candidate ? allowedExternalUrl(candidate) : null;
		if (!url) continue;
		const button = createEl("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-source";
		button.append(document.createTextNode(label), createChromeIcon("external"));
		button.onclick = () => options.openExternal(url);
		sources.append(button);
	}
	if (sources.childElementCount) row.append(sources);
}
