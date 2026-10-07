import { createChromeIcon } from "./graph-chrome";
import type { CitationEvidence } from "./citation-evidence";
import { stageKey, stageSourceLabel, toggleStaged, type StagedPaper } from "./staging";
import { allowedExternalUrl } from "./safe-url";
import type { GraphEdge, PaperNode } from "./types";

/** Paper-scoped actions are shared by graph pane and note embed. */
export function paintPaperActions(
	parent: HTMLElement,
	paper: PaperNode,
	seedId: string | null,
	edge: GraphEdge | null,
	evidence: CitationEvidence | null,
	options: {
		getStaged: () => StagedPaper[];
		setStaged: (items: StagedPaper[]) => void;
		persist?: (source: string) => Promise<void> | void;
		openExternal: (url: string) => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "cpo-paper-actions";
	const sources = document.createElement("div");
	sources.className = "cpo-paper-sources";
	if (seedId && options.persist && !paper.isSeed) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-stage";
		const paintStage = (): void => {
			const staged = options.getStaged().some((item) => stageKey(item) === `${seedId}\0${paper.id}`);
			button.replaceChildren(createChromeIcon(staged ? "bookmarkCheck" : "bookmark"), document.createTextNode(staged ? "已暂存" : "加入暂存列表"));
			button.setAttribute("aria-pressed", String(staged));
		};
		paintStage();
		button.onclick = async () => {
			const before = options.getStaged();
			const source = stageSourceLabel(paper, seedId, edge, evidence);
			options.setStaged(toggleStaged(before, paper, seedId, source));
			button.disabled = true;
			button.removeAttribute("title");
			try {
				await options.persist?.(source);
				options.setStaged(toggleStaged(before, paper, seedId, source));
				paintStage();
			} catch {
				options.setStaged(before);
				paintStage();
				let error = row.querySelector<HTMLElement>(".cpo-paper-action-error");
				if (!error) {
					error = document.createElement("span");
					error.className = "cpo-paper-action-error";
					error.setAttribute("role", "status");
					row.append(error);
				}
				error.textContent = "保存失败，请重试";
			} finally {
				button.disabled = false;
			}
		};
		row.append(button);
	}
	for (const [label, candidate] of [["OpenAlex", paper.openAlexUrl], ["DOI", paper.doiUrl]] as const) {
		const url = candidate ? allowedExternalUrl(candidate) : null;
		if (!url) continue;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cpo-paper-action cpo-paper-source";
		button.append(document.createTextNode(label), createChromeIcon("external"));
		button.onclick = () => options.openExternal(url);
		sources.append(button);
	}
	if (sources.childElementCount) row.append(sources);
	if (row.childElementCount) parent.append(row);
}
