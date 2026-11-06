import type { PaperNode, PaperRecord } from "./types";
import type { ConnectedPapersSettings } from "./settings-model";
import type { GetJson } from "./openalex";
import { reconstructAbstract, normalizeDoi, shortId, cleanAbstractText } from "./paper";
import { tr } from "./i18n";
import { refreshDerived } from "./graph-edit";
import { CitationEvidenceStore } from "./citation-evidence";
import type { SimilarityGraph } from "./neighborhood";

type AbstractProblem = "contents" | "web-boilerplate" | "url-only";
interface Issue {
	problem?: AbstractProblem;
	/** Legacy Web markers: chapter type was not proof of an identity conflict. */
	contents?: true;
	chapter?: boolean;
	identity?: "unchecked" | "consistent" | "conflict";
	evidence?: string[];
}
export type WebRecord = PaperRecord & {
	webMetadataReview?: Issue;
	webSource?: { version: number; checkedAt: number; requestedId: string; canonicalId: string; recompute?: boolean; previous?: Pick<PaperRecord, "id" | "title" | "authors" | "doiUrl" | "year" | "citedByCount"> };
};
export const WEB_QUALITY_VERSION = 2;
const issues = new Map<string, Issue>();
const currentProblems = new Map<string, AbstractProblem | null>();
const doiById = new Map<string, string>();
const checks = new Map<string, Promise<string | null>>();

export function abstractProblem(text: string): AbstractProblem | null {
	const plain = cleanAbstractText(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
	if (/^(?:https?:\/\/|www\.)\S+$/i.test(plain)) return "url-only";
	if (/^Preview this article\s*:/i.test(plain) && /Page\s+\d+\s+of\s+\d+/i.test(plain) && /Previous page|Next page|\/docserver\//i.test(plain)) return "web-boilerplate";
	const headings = [...plain.matchAll(/(?:^|\s)(\d{1,2}|[IVX]{1,6})[.)]\s+(?=[\p{L}])/gu)];
	const numbered = headings.length;
	const front = /^(?:list of figures\b|preface\b|table of contents\b|contents\s*[:：])/i.test(plain);
	const back = /\b(?:references|appendix|index|conclusions?)\b/i.test(plain);
	const numberedBack = /\b(?:references|appendix|index)\b/i.test(plain);
	const startsNumbered = /^\s*(?:1|I)[.)]\s+/u.test(plain);
	const sequence = headings.map(match => match[1]!);
	const sequential = sequence.every((value, index) => value === String(index + 1)) || sequence.every((value, index) => value === ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][index]);
	const shortHeadings = headings.every((heading, index) => {
		const section = plain.slice(heading.index + heading[0].length, headings[index + 1]?.index);
		return section.split(/\s+/).length <= 24 && !/[.!?。！？]\s+[\p{L}]/u.test(section);
	});
	// shortcut: high-confidence structural rules; uncertain prose needs review, not blanket deletion.
	if (front && numbered >= 3 && back || startsNumbered && numbered >= 4 && sequential && shortHeadings && numberedBack
		|| /^目录\s*/.test(plain) && (plain.match(/第[一二三四五六七八九十\d]+章/g)?.length ?? 0) >= 3 && /参考文献|索引/.test(plain)) return "contents";
	return null;
}

export function isContentsText(text: string): boolean { return abstractProblem(text) === "contents"; }

function issueFor(id?: string, doi?: string | null): Issue | undefined {
	return (id ? issues.get(shortId(id)) : undefined) ?? (doi ? issues.get(normalizeDoi(doi) ?? doi) : undefined);
}

function mark(id: string | undefined, doi: string | null | undefined, problem: AbstractProblem, saved?: Issue): Issue {
	const known = issueFor(id, doi);
	const issue: Issue = { problem, identity: saved?.identity ?? known?.identity ?? "unchecked", evidence: saved?.evidence ?? known?.evidence };
	if (id) issues.set(shortId(id), issue);
	if (doi) issues.set(normalizeDoi(doi) ?? doi, issue);
	return issue;
}

/** Only browser transports call this; shared/Obsidian parsers retain their behavior. */
export function screenWebResponse(json: unknown, target: URL, body?: string): unknown {
	if (!json || typeof json !== "object") return json;
	if (target.hostname === "api.openalex.org") {
		const rows = "results" in json && Array.isArray(json.results) ? json.results : [json];
		for (const row of rows) {
			if (!row || typeof row !== "object") continue;
			const work = row as { id?: string; doi?: string; type?: string; abstract_inverted_index?: Record<string, number[]> | null };
			if (work.id && work.doi) doiById.set(shortId(work.id), work.doi);
			const problem = abstractProblem(reconstructAbstract(work.abstract_inverted_index));
			if (work.id && "abstract_inverted_index" in work) currentProblems.set(shortId(work.id), problem);
			if (problem) {
				mark(work.id, work.doi ?? (work.id ? doiById.get(shortId(work.id)) : undefined), problem);
				work.abstract_inverted_index = null;
			}
		}
	} else if (target.hostname === "api.crossref.org" && "message" in json && json.message && typeof json.message === "object") {
		const work = json.message as { DOI?: string; abstract?: string; reference?: unknown; relation?: unknown };
		const issue = issueFor(undefined, work.DOI);
		if (work.abstract && (abstractProblem(work.abstract) || issue && issue.identity !== "consistent")) delete work.abstract;
		if (issue && issue.identity !== "consistent") { delete work.reference; delete work.relation; }
	} else if (target.hostname === "api.opencitations.net" && Array.isArray(json)) {
		const requested = target.pathname.match(/\/doi:(.+)$/)?.[1];
		const issue = requested ? issueFor(undefined, decodeURIComponent(requested)) : undefined;
		if (issue && issue.identity !== "consistent") throw new Error(tr("文献身份待核对，已隔离其引用证据。", "Paper identity needs review; citation evidence withheld."));
		return json.filter((row: unknown) => {
			if (!row || typeof row !== "object") return true;
			const text = ["citing" in row ? row.citing : "", "cited" in row ? row.cited : ""].filter(value => typeof value === "string").join(";");
			return [...text.matchAll(/doi:([^\s;]+)/gi)].every(match => {
				const issue = issueFor(undefined, match[1]);
				return !issue || issue.identity === "consistent";
			});
		});
	} else if (target.hostname === "api.semanticscholar.org") {
		if (Array.isArray(json)) {
			const ids = body ? (JSON.parse(body) as { ids?: string[] }).ids ?? [] : [];
			return json.map((row: unknown, i: number) => {
				const issue = issueFor(undefined, ids[i]?.replace(/^DOI:/i, ""));
				if (issue && issue.identity !== "consistent") return null;
				if (row && typeof row === "object" && "abstract" in row && typeof row.abstract === "string" && abstractProblem(row.abstract)) row.abstract = null;
				return row;
			});
		}
		const doi = target.pathname.match(/\/paper\/DOI:(.+?)(?:\/references)?$/)?.[1];
		const issue = doi ? issueFor(undefined, decodeURIComponent(doi)) : undefined;
		if (issue && issue.identity !== "consistent") throw new Error(tr("文献身份尚未核对，暂不使用此 DOI 的备用摘要或引用证据。", "Paper identity has not been verified; fallback abstracts and citation evidence for this DOI are withheld."));
		if ("abstract" in json && typeof json.abstract === "string" && abstractProblem(json.abstract)) json.abstract = null;
	}
	return json;
}

function inspectPaper(paper: PaperRecord): void {
	const web = paper as WebRecord;
	if (web.webSource?.canonicalId === paper.id) {
		const aliases = [web.webSource.requestedId, web.webSource.previous?.id].filter((id): id is string => Boolean(id && /^W\d+$/.test(id) && id !== paper.id));
		if (aliases.length) paper.sourceAliases = [...new Set([...(paper.sourceAliases ?? []), ...aliases])];
	}
	const rejected = abstractProblem(paper.abstract);
	const issue = web.webMetadataReview ?? issueFor(paper.id, paper.doiUrl);
	if (rejected || issue) {
		web.webMetadataReview = mark(paper.id, paper.doiUrl, rejected ?? issue?.problem ?? "contents", issue);
		if (rejected || web.webMetadataReview.identity !== "consistent") paper.abstract = "";
	}
	if ("records" in paper && Array.isArray(paper.records)) for (const record of paper.records) inspectPaper(record as PaperRecord);
}

export function webPaperRecords(settings: ConnectedPapersSettings): PaperRecord[] {
	const papers = new Set<PaperRecord>();
	const add = (paper: PaperRecord): void => {
		if (papers.has(paper)) return;
		papers.add(paper);
		if ("records" in paper && Array.isArray(paper.records)) for (const record of paper.records) add(record as PaperRecord);
	};
	for (const project of Object.values(settings.researchProjects)) {
		const snapshot = project.snapshot;
		for (const paper of [...(snapshot?.nodes ?? []), ...(snapshot?.catalog ?? []), ...(snapshot?.workIdentity?.records ?? []), ...(project.manualPapers ?? []), ...(project.pending ?? []).flatMap(item => item.paper ? [item.paper] : []), ...Object.values(project.paperStates ?? {}).map(state => state.paper), ...Object.values(project.versionStates ?? {}).map(state => state.paper), ...Object.values(project.identityOriginalStates ?? {}).map(state => state.paper)]) add(paper);
	}
	for (const record of Object.values(settings.readingWorkflow?.records ?? {})) add(record.paper);
	for (const item of settings.stagedPapers) add(item.paper);
	return [...papers];
}

export function prepareWebSettings(settings: ConnectedPapersSettings): void {
	for (const paper of webPaperRecords(settings)) inspectPaper(paper);
}

export function applyWebSourceRecord(paper: PaperRecord, fresh: PaperNode, requestedId: string, checkedAt: number): void {
	const old = { id: paper.id, title: paper.title, authors: paper.authors, doiUrl: paper.doiUrl, year: paper.year, citedByCount: paper.citedByCount };
	const web = paper as WebRecord;
	const previous = web.webMetadataReview;
	const changed = paper.id !== fresh.id || paper.title !== fresh.title || paper.authors !== fresh.authors || paper.doiUrl !== fresh.doiUrl || paper.abstract !== fresh.abstract || paper.year !== fresh.year || paper.citedByCount !== fresh.citedByCount || paper.workType !== fresh.workType || JSON.stringify([paper.authorList, paper.concepts, paper.topicTags, paper.primaryTopic]) !== JSON.stringify([fresh.authorList, fresh.concepts, fresh.topicTags, fresh.primaryTopic]);
	const sourceAliases = [...new Set([...(paper.sourceAliases ?? []), ...(old.id !== fresh.id ? [old.id] : [])])];
	const { isSeed, origin } = paper;
	Object.assign(paper, fresh, { isSeed, origin, ...(sourceAliases.length ? { sourceAliases } : {}), abstractSource: fresh.abstract ? "openalex" : undefined });
	const problem = currentProblems.get(fresh.id);
	if (!problem && previous?.identity !== "conflict") {
		delete web.webMetadataReview;
		for (const key of [old.id, normalizeDoi(old.doiUrl), fresh.id, normalizeDoi(fresh.doiUrl)]) if (key) issues.delete(key);
	} else {
		web.webMetadataReview = mark(fresh.id, fresh.doiUrl, problem ?? previous?.problem ?? "contents", { identity: "unchecked", evidence: previous?.evidence });
	}
	web.webSource = { version: WEB_QUALITY_VERSION, checkedAt, requestedId, canonicalId: fresh.id, recompute: changed || web.webSource?.recompute, ...(changed ? { previous: old } : web.webSource?.previous ? { previous: web.webSource.previous } : {}) };
}

/** Existing members are rescored locally; a fresh candidate sample still requires Reload. */
export function prepareWebGraph(graph: SimilarityGraph): string | null {
	for (const paper of [...graph.nodes, ...graph.catalog]) inspectPaper(paper);
	const papers = [...new Map([...graph.nodes, ...graph.catalog].map(paper => [paper.id, paper])).values()];
	const affected = papers.filter(paper => (paper as WebRecord).webMetadataReview || (paper as WebRecord).webSource?.recompute);
	if (!affected.length) return null;
	const blocked = new Set(papers.filter(paper => {
		const issue = (paper as WebRecord).webMetadataReview;
		return issue && issue.identity !== "consistent";
	}).map(paper => paper.id));
	const stale = new Set(affected.map(paper => paper.id));
	for (const paper of [...graph.nodes, ...graph.catalog]) delete paper.admission;
	const referenceLists = new Map([...graph.referenceLists].filter(([id]) => !blocked.has(id)).map(([id, refs]) => [id, refs.filter(ref => !blocked.has(ref))]));
	const citationEvidence = new CitationEvidenceStore();
	for (const evidence of graph.citationEvidence?.entries() ?? []) if (!stale.has(evidence.citingId) && !stale.has(evidence.citedId)) citationEvidence.set(evidence);
	const workIdentity = graph.workIdentity ? { ...graph.workIdentity, referenceLists: graph.workIdentity.referenceLists.filter(([id]) => !blocked.has(id)).map(([id, refs]): [string, string[]] => [id, refs.filter(ref => !blocked.has(ref))]), evidence: graph.workIdentity.evidence.filter(item => !stale.has(item.citingId) && !stale.has(item.citedId)), directEdges: graph.workIdentity.directEdges.filter(edge => !stale.has(edge.source) && !stale.has(edge.target)) } : undefined;
	const clean = { ...graph, workIdentity, researchProjection: undefined, candidateAudit: undefined, referenceLists, citationEvidence, edges: graph.edges.filter(edge => !stale.has(edge.source) && !stale.has(edge.target)), semanticScores: undefined, selectionRank: undefined, semanticVectorIds: [], semanticModel: null, semanticMode: "local" as const, enhancement: undefined, crossCheck: graph.crossCheck ? new Map([...graph.crossCheck].filter(([id]) => !stale.has(id))) : undefined };
	Object.assign(graph, refreshDerived(clean, false));
	for (const id of blocked) { graph.seedScore.delete(id); (graph.semanticScores as Map<string, number | null> | undefined)?.set(id, null); }
	if (graph.nodes.some(paper => paper.isSeed && blocked.has(paper.id))) { graph.seedScore.clear(); graph.semanticScores = new Map(graph.nodes.filter(paper => !paper.isSeed).map(paper => [paper.id, null])); }
	return tr(`来源质量提示：${affected.length} 篇文献已更新或待核对；${blocked.size ? `已隔离 ${blocked.size} 篇的未核实关系和相似度。` : ""}已基于现有成员重算本地分数，旧入选理由已清除；重新加载才能重新采样。`, `Source quality: ${affected.length} papers refreshed or need review. ${blocked.size ? `Unverified relationships and similarity for ${blocked.size} papers are withheld. ` : ""}Local scores were recomputed for existing members and old selection reasons cleared; Reload is needed to resample candidates.`);
}

export function decorateWebExport(papers: readonly PaperNode[], text: string, format: "bibtex" | "yaml" | "markdown", sourceCheckIncomplete = false): string {
	const warnings = papers.flatMap(paper => {
		const records = [paper, ...(paper.records ?? [])];
		for (const record of records) inspectPaper(record);
		return records.filter(record => (record as WebRecord).webMetadataReview || (record as WebRecord).webSource?.recompute).map(record => {
			const issue = (record as WebRecord).webMetadataReview;
			return `${record.id}: ${issue?.identity === "conflict" ? "identity-conflict" : issue && issue.identity !== "consistent" ? "identity-unverified" : "refreshed-local-graph"}`;
		});
	});
	if (sourceCheckIncomplete) warnings.unshift("source-revalidation-incomplete");
	if (!warnings.length) return text;
	const prefix = format === "bibtex" ? "%" : format === "yaml" ? "#" : ">";
	const warning = `${prefix} Research Connected quality warning: ${[...new Set(warnings)].join("; ")}. Original source fields are not independently certified.`;
	if (format === "markdown" && text.startsWith("---\n")) {
		const end = text.indexOf("\n---", 4);
		if (end >= 0) return `${text.slice(0, end + 4)}\n\n${warning}\n${text.slice(end + 4)}`;
	}
	return `${warning}\n${text}`;
}

export async function checkWebMetadata(paper: PaperNode, get: GetJson): Promise<string | null> {
	inspectPaper(paper);
	const issue = (paper as WebRecord).webMetadataReview ?? issueFor(paper.id, paper.doiUrl);
	if (!issue) return null;
	const description = issue.problem === "web-boilerplate" ? tr("网页导航或预览文字", "page navigation or preview text") : issue.problem === "url-only" ? tr("纯链接", "a URL without abstract prose") : tr("目录", "table-of-contents text");
	const base = tr(`上游摘要字段包含${description}，已排除；这本身不代表文献身份错误。`, `The abstract field contains ${description} and has been excluded; this alone does not establish an identity error.`);
	const doi = normalizeDoi(paper.doiUrl);
	const key = `${paper.id}:${doi ?? ""}:${issue.problem ?? "contents"}`;
	const cached = checks.get(key);
	if (cached) return cached;
	const check = (async (): Promise<string> => {
		try {
			if (!doi) {
				if (!/^W\d+$/.test(paper.id)) return base;
				const current = await get(`https://api.openalex.org/works/${paper.id}`, { headers: { Accept: "application/json" } });
				if (current && typeof current === "object" && "id" in current && typeof current.id === "string") {
					const currentDoi = "doi" in current && typeof current.doi === "string" ? normalizeDoi(current.doi) : null;
					if (shortId(current.id) !== paper.id || currentDoi) return `${base} ${tr(`当前 OpenAlex 已解析为 ${shortId(current.id)}${currentDoi ? `，DOI：${currentDoi}` : ""}。旧快照可能已过期，请核对来源后重新加载；未自动改写项目标识或合计引用数。`, `OpenAlex now resolves this ID to ${shortId(current.id)}${currentDoi ? `, DOI: ${currentDoi}` : ""}. The saved snapshot may be stale. Check the source and reload; project identifiers and citation counts were not remapped or summed automatically.`)}`;
				}
				return `${base} ${tr("当前记录无 DOI，不能仅凭同名作品自动补挂 DOI。", "This record has no DOI; matching titles alone cannot attach one automatically.")}`;
			}
			const json = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: "application/json" } });
			const message = json && typeof json === "object" && "message" in json && json.message && typeof json.message === "object" ? json.message as { DOI?: string; type?: string; title?: string[]; subtitle?: string[]; author?: Array<{ family?: string; given?: string }> } : null;
			if (!message || normalizeDoi(message.DOI) !== doi) throw new Error("Unmatched DOI metadata");
			const normalize = (s: string) => s.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
			const title = message.title?.filter(t => typeof t === "string").join(" ") ?? "";
			const ownTitle = normalize(paper.title), registered = normalize(title);
			const titlesMatch = Boolean(ownTitle && registered && (ownTitle === registered || ownTitle.startsWith(registered + " ") || registered.startsWith(ownTitle + " ")));
			const ownNames = paper.authorList.map(name => normalize(name).split(" ").pop()).filter(Boolean);
			const registeredNames = (message.author ?? []).map(author => normalize(author.family ?? "")).filter(Boolean);
			const authorsOverlap = ownNames.some(name => registeredNames.includes(name!));
			const authorsMatch = ownNames.length > 0 && registeredNames.length > 0 && ownNames.every(name => registeredNames.includes(name!)) && registeredNames.every(name => ownNames.includes(name));
			const evidence = [ownTitle && registered && !titlesMatch ? tr(`题名不一致：${paper.title} / ${title}`, `Titles differ: ${paper.title} / ${title}`) : "", ownNames.length && registeredNames.length && !authorsOverlap ? tr("作者署名不一致", "Author names differ") : ""].filter(Boolean);
			issue.identity = evidence.length ? "conflict" : titlesMatch && authorsMatch ? "consistent" : "unchecked";
			issue.evidence = evidence;
			(paper as WebRecord).webMetadataReview = mark(paper.id, doi, issue.problem ?? "contents", issue);
			const subtitle = message.subtitle?.filter(s => typeof s === "string").join(" · ") ?? "";
			const status = evidence.length ? tr(`来源元数据存在身份冲突：${evidence.join("；")}。已隔离未经核实的备用摘要、向量和引用数据，请核对原始记录。`, `Identity conflict between source records: ${evidence.join("; ")}. Unverified fallback abstracts, vectors and citation data are withheld; inspect the sources.`) : issue.identity === "consistent" ? tr("DOI 登记的题名和作者与当前记录相符，可继续尝试备用摘要。", "The DOI registration's title and author match this record; fallback abstracts may be requested.") : tr("DOI 登记信息不足以核实作者与作品身份，暂不拼接备用摘要或引用数据；缺失信息不视为身份冲突。", "The DOI registration lacks enough evidence to verify identity; fallback abstracts and citation data are withheld. Missing information is not an identity conflict.");
			return `${base} ${status}${subtitle ? tr(` DOI 登记副标题：${subtitle}。`, ` DOI subtitle: ${subtitle}.`) : ""}`;
		} catch {
			checks.delete(key);
			return `${base} ${tr("来源核对暂未完成，请查看原始记录。", "Source verification is incomplete; inspect the original records.")}`;
		}
	})();
	checks.set(key, check);
	return check;
}
