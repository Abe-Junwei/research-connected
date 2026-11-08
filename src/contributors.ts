import { CrossrefClient, doiFromPaper } from "./citation-sources";
import { tr } from "./i18n";
import type { SimilarityGraph } from "./neighborhood";
import type { GetJson } from "./openalex";
import { knownAuthorNames, normalizeDoi } from "./paper";
import type { PaperNode, PaperRecord } from "./types";

export interface ContributorMetadata {
	authors: string[];
	editors: string[];
}

function names(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(tr("贡献者元数据格式错误", "Invalid contributor metadata"));
	return [...new Set(value.map((item: unknown) => {
		if (!item || typeof item !== "object") throw new Error(tr("贡献者元数据格式错误", "Invalid contributor metadata"));
		const row = item as { name?: unknown; given?: unknown; family?: unknown };
		for (const field of [row.name, row.given, row.family]) if (field !== undefined && typeof field !== "string") throw new Error(tr("贡献者姓名格式错误", "Invalid contributor name"));
		return (typeof row.name === "string" ? row.name : [row.given, row.family].filter(Boolean).join(" ")).trim();
	}).filter(Boolean))];
}

export async function lookupContributors(getJson: GetJson, contactEmail: string, paper: PaperNode, fresh = false): Promise<ContributorMetadata> {
	const doi = doiFromPaper(paper);
	if (!doi) return { authors: [], editors: [] };
	const work = await new CrossrefClient(getJson, contactEmail).work(doi, fresh);
	if (!work) return { authors: [], editors: [] };
	if (normalizeDoi(work.DOI) !== doi) throw new Error(tr("Crossref 返回的 DOI 不匹配", "Crossref returned a different DOI"));
	return { authors: names(work.author), editors: names(work.editor) };
}

/** Update source records as well as projected nodes so saving/reprojection retains roles. */
export function applyContributors(graph: SimilarityGraph, paper: PaperNode, metadata: ContributorMetadata): void {
	const doi = normalizeDoi(paper.doiUrl);
	if (!doi) return;
	const apply = (record: PaperRecord): void => {
		if (normalizeDoi(record.doiUrl) !== doi) return;
		if (metadata.authors.length || metadata.editors.length) delete record.contributorLookup;
		else record.contributorLookup = "missing";
		if (!knownAuthorNames(record).length && metadata.authors.length) {
			record.authorList = [...metadata.authors];
			record.authors = metadata.authors.join(", ");
			record.contributorSource = "crossref";
		}
		if (!record.editorList?.length && metadata.editors.length) {
			record.editorList = [...metadata.editors];
			record.contributorSource = "crossref";
		}
	};
	for (const node of [paper, ...graph.nodes, ...graph.catalog]) {
		apply(node);
		for (const record of node.records ?? []) apply(record);
	}
	for (const record of graph.workIdentity?.records ?? []) apply(record);
}

/** One lookup per DOI per surface; failures remain retryable and never become missing metadata. */
export function createContributorLookup(getJson: GetJson, contactEmail: () => string) {
	const requests = new Map<string, Promise<ContributorMetadata>>();
	return (parent: HTMLElement, paper: PaperNode, auto: boolean, onFound: (metadata: ContributorMetadata) => void): void => {
		const doi = doiFromPaper(paper);
		if (knownAuthorNames(paper).length || paper.editorList?.length || !doi) return;
		const row = createEl("p");
		row.className = "cpo-side-tip";
		parent.append(row);
		const button = (retry: boolean): void => {
			const control = createEl("button");
			control.type = "button";
			control.className = "cpo-text-btn";
			control.textContent = retry ? tr("重试署名查询", "Retry contributor lookup") : tr("查询作者 / 编者", "Find authors / editors");
			control.onclick = () => { void load(retry); };
			row.append(control);
		};
		const load = async (fresh = false): Promise<void> => {
			const placeholder = parent.querySelector<HTMLElement>(".cpo-contributor-placeholder");
			row.textContent = placeholder ? "" : tr("正在查询 Crossref 署名…", "Looking up Crossref contributors…");
			if (placeholder) { placeholder.textContent = tr("正在查询署名…", "Looking up contributors…"); placeholder.setAttribute("role", "status"); }
			if (fresh || !requests.has(doi)) requests.set(doi, lookupContributors(getJson, contactEmail(), paper, fresh));
			let metadata: ContributorMetadata;
			try {
				metadata = await requests.get(doi)!;
			} catch (error) {
				if (placeholder) placeholder.textContent = tr("署名查询失败", "Contributor lookup failed");
				row.textContent = tr(`署名查询失败：${error instanceof Error ? error.message : String(error)} `, `Contributor lookup failed: ${error instanceof Error ? error.message : String(error)} `);
				button(true);
				return;
			}
			if (!row.isConnected) return;
			if (metadata.authors.length || metadata.editors.length) {
				delete paper.contributorLookup;
				onFound(metadata);
			} else {
				row.textContent = tr("Crossref 未提供作者或编者信息。", "Crossref provides no author or editor information.");
				if (placeholder) placeholder.textContent = tr("作者信息缺失", "Author information missing");
				if (paper.contributorLookup !== "missing") {
					paper.contributorLookup = "missing";
					onFound(metadata);
				}
			}
		};
		if (auto || requests.has(doi)) void load();
		else button(false);
	};
}
