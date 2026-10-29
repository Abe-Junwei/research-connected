import { tr } from "./i18n";
import type { GetJson } from "./openalex";
import { cleanAbstractText, normalizeDoi } from "./paper";
import type { SourceVersionRelation } from "./work-identity";
import type { PaperNode } from "./types";
import { fetchS2Batch, type S2BatchStats } from "./s2-batch";

export interface OpenCitationRow {
	oci?: string;
	citing?: string;
	cited?: string;
	creation?: string;
}

export interface CrossrefWork {
	DOI?: string;
	abstract?: string;
	reference?: Array<{ DOI?: string; unstructured?: string }>;
	relation?: Record<string, Array<{ id?: unknown; "id-type"?: unknown }>>;
}

/** Public Crossref DOI metadata, used only as a bounded fallback. */
export class CrossrefClient {
	constructor(private readonly getJson: GetJson, private readonly contactEmail: string) {}

	async work(doi: string, fresh = false): Promise<CrossrefWork | null> {
		const encodedDoi = encodeURIComponent(doi).replace(/%2F/gi, "/");
		const url = new URL(`https://api.crossref.org/works/${encodedDoi}`);
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.contactEmail)) url.searchParams.set("mailto", this.contactEmail);
		if (fresh) dropCachedGet(url.toString(), { Accept: "application/json" });
		const json = await cachedGet(this.getJson, url.toString(), { headers: { Accept: "application/json" } });
		if (!json || typeof json !== "object") {
			dropCachedGet(url.toString(), { Accept: "application/json" });
			throw new CitationSourceError(tr("Crossref 返回格式错误。", "Crossref returned an invalid response."));
		}
		const message = (json as { message?: unknown }).message;
		if (!message || typeof message !== "object") {
			dropCachedGet(url.toString(), { Accept: "application/json" });
			throw new CitationSourceError(tr("Crossref 未返回作品元数据。", "Crossref returned no work metadata."));
		}
		return message;
	}

	async referenceDois(doi: string): Promise<string[]> {
		const work = await this.work(doi);
		return [...new Set((work?.reference ?? []).flatMap((row) => {
			const value = row.DOI?.trim().toLowerCase();
			return value ? [value] : [];
		}))];
	}

	async abstract(doi: string): Promise<string | null> {
		const work = await this.work(doi);
		if (!work?.abstract) return null;
		const text = work.abstract
			.replace(/<[^>]*>/g, " ")
			.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
			.replace(/\s+/g, " ").trim();
		return cleanAbstractText(text) || null;
	}

	/** Crossref's explicit intra-work types only; inter-work review/comment claims conflict with a version link. */
	async versionRelations(papers: readonly PaperNode[], previous: readonly SourceVersionRelation[] = []): Promise<SourceVersionRelation[]> {
		const byDoi = new Map<string, string[]>();
		for (const paper of papers) {
			const doi = normalizeDoi(paper.doiUrl);
			if (doi) byDoi.set(doi, [...new Set([...(byDoi.get(doi) ?? []), paper.id])]);
		}
		const claims = new Map<string, { ids: string[]; positive: string[]; contrary: string[] }>();
		const checked = new Set<string>();
		// shortcut: inspect 20 DOI records per graph load; expand only if measured coverage requires it.
		for (const [doi, ids] of [...byDoi].slice(0, 20)) {
			let work: CrossrefWork | null;
			try { work = await this.work(doi, true); } catch { continue; }
			if (!work || normalizeDoi(work.DOI) !== doi) continue;
			for (const id of ids) checked.add(id);
			for (const [type, rows] of Object.entries(work.relation ?? {})) {
				const positive = ["is-identical-to", "is-preprint-of", "has-preprint", "is-manuscript-of", "has-manuscript", "is-version-of", "has-version"].includes(type);
				const contrary = ["is-review-of", "has-review", "is-comment-on", "has-comment", "is-reply-to", "has-reply"].includes(type);
				if ((!positive && !contrary) || !Array.isArray(rows)) continue;
				for (const row of rows) {
					if (!row || row["id-type"] !== "doi" || typeof row.id !== "string") continue;
					const target = normalizeDoi(row.id);
					for (const a of ids) for (const b of target ? byDoi.get(target) ?? [] : []) {
						if (a === b) continue;
						const pair = [a, b].sort(), key = pair.join("|");
						const claim = claims.get(key) ?? { ids: pair, positive: [], contrary: [] };
						(positive ? claim.positive : claim.contrary).push(`crossref:${doi}:${type}:${target}`);
						claims.set(key, claim);
					}
				}
			}
		}
		const reports: SourceVersionRelation[] = [];
		const keys = new Set([...claims.keys(), ...previous.filter(relation => relation.ids.some(id => checked.has(id))).map(relation => relation.ids.slice().sort().join("|"))]);
		for (const key of keys) {
			const claim = claims.get(key), prior = previous.find(relation => relation.ids.slice().sort().join("|") === key);
			if (!claim?.positive.length && !prior) continue;
			const status = claim?.contrary.length ? "conflict" : claim?.positive.length ? "confirmed" : "missing";
			const evidence = [...new Set([...(claim?.positive ?? []), ...(claim?.contrary ?? [])])].sort();
			if (prior?.status === status && JSON.stringify(prior.evidence) === JSON.stringify(evidence)) continue;
			reports.push({ ids: key.split("|"), source: "crossref", status, linked: status === "confirmed" || Boolean(prior?.linked), evidence, previousEvidence: [...new Set([...(prior?.previousEvidence ?? []), ...(prior?.evidence ?? [])])], updatedAt: Date.now() });
		}
		return reports;
	}
}

export class CitationSourceError extends Error {}

const S2_QUOTA_TEXT = tr("Semantic Scholar 额度已用完或请求过快。可在设置中填写 API 密钥，或稍后再试。", "Semantic Scholar rate limit reached. Add an API key in settings or try again later.");
const S2_QUOTA_MESSAGE = /too many requests|rate.?limit|quota|throttl/i;

/** Compact description of an unexpected Semantic Scholar payload, for diagnostics. */
function describeS2Shape(json: unknown): string {
	if (json === null) return "null";
	if (Array.isArray(json)) return tr(`数组(${json.length} 条)`, `Array (${json.length} items)`);
	if (typeof json === "object") {
		const keys = Object.keys(json).slice(0, 6).join(", ");
		const message = (json as { message?: unknown }).message;
		return `{${keys}}${typeof message === "string" ? tr(`，message="${message.slice(0, 160)}"`, `, message="${message.slice(0, 160)}"`) : ""}`;
	}
	return typeof json;
}

/**
 * S2 edge nodes occasionally answer 200 with an error body instead of data.
 * Log the actual shape so swallowed reconcile failures stay diagnosable, and
 * map recognizable quota messages back to the quota wording.
 */
function s2FormatError(context: string, json: unknown): CitationSourceError {
	console.warn(tr(`[research-connected] Semantic Scholar ${context}返回了非预期结构：${describeS2Shape(json)}`, `[research-connected] Semantic Scholar ${context} returned an unexpected structure: ${describeS2Shape(json)}`), json);
	const message = json && typeof json === "object" ? (json as { message?: unknown }).message : undefined;
	if (typeof message === "string" && S2_QUOTA_MESSAGE.test(message)) return new CitationSourceError(S2_QUOTA_TEXT);
	return new CitationSourceError(tr(`Semantic Scholar ${context}返回格式错误。`, `Semantic Scholar ${context} returned an invalid response.`));
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class OpenCitationsClient {
	constructor(private readonly getJson: GetJson, private readonly token: string) {}

	async references(doi: string): Promise<OpenCitationRow[]> {
		return this.rows(`https://api.opencitations.net/index/v2/references/doi:${encodeURIComponent(doi)}`);
	}

	private async rows(url: string): Promise<OpenCitationRow[]> {
		const json = await cachedGet(this.getJson, url, {
			headers: {
				Accept: "application/json",
				...(this.token ? { authorization: this.token } : {}),
			},
		});
		if (!Array.isArray(json)) throw new CitationSourceError(tr("OpenCitations 返回格式错误。", "OpenCitations returned an invalid response."));
		return json as OpenCitationRow[];
	}
}

export type PostJson = (
	url: string,
	init: { headers: Record<string, string>; body: string },
) => Promise<unknown>;

export interface S2Counts {
	citationCount: number | null;
	referenceCount: number | null;
	/** Vector and its actual model, present only when the request asked for embeddings. */
	embedding?: number[] | null;
	embeddingModel?: string | null;
	abstract?: string | null;
}

export interface SemanticCitation {
	citedPaper?: { paperId?: string; externalIds?: Record<string, string | null> | null };
	citingPaper?: {
		paperId?: string;
		title?: string | null;
		year?: number | null;
		externalIds?: Record<string, string | null> | null;
	};
	contexts?: string[] | null;
	intents?: string[] | null;
	isInfluential?: boolean | null;
}

export class SemanticScholarClient {
	constructor(
		private readonly getJson: GetJson,
		private readonly apiKey: string,
		private readonly postJson?: PostJson,
	) {}

	/** Model name of the embeddings returned by the last bulkCounts call (null when none). */
	embeddingModel: string | null = null;
	batchStats?: S2BatchStats;

	/**
	 * One batched lookup (POST /paper/batch, up to 500 ids) that cross-checks
	 * OpenAlex numbers. Keys of the returned map are the lowercased DOIs that
	 * Semantic Scholar recognized. With `opts.embedding` the same request also
	 * also requests abstracts and optionally model-labeled vectors before selection.
	 */
	async bulkCounts(dois: string[], opts?: { embedding?: boolean }): Promise<Map<string, S2Counts>> {
		const result = await fetchS2Batch(this.postJson, this.apiKey, dois, opts?.embedding === true);
		this.batchStats = result.stats;
		const models = new Set([...result.data.values()].map(item => item.embeddingModel).filter((model): model is string => Boolean(model)));
		this.embeddingModel = models.size === 1 ? [...models][0]! : null;
		if (result.stats.error) console.warn("[research-connected] Semantic Scholar:", result.stats.error);
		return result.data;
	}

	/**
	 * DOIs of the works this paper references, one page of up to 1000. Used to
	 * backfill reference lists that OpenAlex does not have.
	 */
	async referenceDois(doi: string): Promise<string[]> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/references`);
		url.searchParams.set("fields", "externalIds");
		url.searchParams.set("limit", "1000");
		const result = await this.getList<{ citedPaper?: { externalIds?: Record<string, string | null> | null } | null }>(url.toString(), tr("参考文献接口", "reference API"));
		const dois: string[] = [];
		for (const row of result.data) {
			const ref = row?.citedPaper?.externalIds?.DOI?.toLowerCase();
			if (ref) dois.push(ref);
		}
		return dois;
	}

	async referenceEvidence(doi: string): Promise<{ data: SemanticCitation[]; partial: boolean }> {
		const data: SemanticCitation[] = [];
		let offset = 0;
		for (let page = 0; page < 3; page++) {
			const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/references`);
			url.searchParams.set("fields", "contexts,intents,isInfluential,title,year,externalIds");
			url.searchParams.set("limit", "1000");
			url.searchParams.set("offset", String(offset));
			const result = await this.getList<SemanticCitation>(url.toString(), tr("引用语义接口", "citation intent API"));
			data.push(...result.data);
			if (typeof result.next !== "number") return { data, partial: false };
			if (result.next <= offset) throw new CitationSourceError(tr("Semantic Scholar 分页无进展。", "Semantic Scholar pagination made no progress."));
			offset = result.next;
		}
		return { data, partial: true };
	}

	/** Single-paper abstract lookup, used when OpenAlex has none. */
	async abstract(doi: string): Promise<string | null> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`);
		url.searchParams.set("fields", "abstract");
		const result = (await this.get(url.toString())) as { abstract?: string | null };
		if (!("abstract" in result) || (result.abstract !== null && typeof result.abstract !== "string")) {
			dropCachedGet(url.toString(), this.headers());
			throw s2FormatError(tr("摘要接口", "abstract API"), result);
		}
		const text = typeof result.abstract === "string" ? cleanAbstractText(result.abstract) : "";
		return text || null;
	}

	/**
	 * GET a paged list endpoint with one retry: S2 edge nodes occasionally
	 * answer 200 with an error body, which a fresh request usually fixes.
	 */
	private async getList<T>(url: string, context: string): Promise<{ data: T[]; next?: number }> {
		let lastError: unknown = new CitationSourceError(tr(`Semantic Scholar ${context}返回格式错误。`, `Semantic Scholar ${context} returned an invalid response.`));
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt > 0) await pause(1200);
			let result: unknown;
			try {
				result = await this.get(url);
			} catch (error) {
				lastError = error;
				continue;
			}
			if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) {
				return result as { data: T[]; next?: number };
			}
			dropCachedGet(url, this.headers());
			lastError = s2FormatError(context, result);
		}
		throw lastError;
	}

	private async get(url: string): Promise<unknown> {
		const json = await cachedGet(this.getJson, url, { headers: this.headers() });
		if (!json || typeof json !== "object") {
			dropCachedGet(url, this.headers());
			throw s2FormatError(tr("接口", "API"), json);
		}
		return json;
	}

	private headers(): Record<string, string> {
		return {
			Accept: "application/json",
			...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
		};
	}
}

export function doisFromOpenCitation(row: OpenCitationRow): { citing: string[]; cited: string[] } {
	return { citing: pids(row.citing), cited: pids(row.cited) };
}

/** Bare DOI from a paper's https://doi.org/ link, or null when the paper has none. */
export function doiFromPaper(paper: { doiUrl: string | null }): string | null {
	return normalizeDoi(paper.doiUrl);
}

/** A missing abstract returns null; failed requests remain errors. */
export async function semanticAbstract(
	getJson: GetJson,
	apiKey: string,
	paper: { doiUrl: string | null },
): Promise<string | null> {
	const doi = doiFromPaper(paper);
	if (!doi) return null;
	return new SemanticScholarClient(getJson, apiKey).abstract(doi);
}

export type AbstractLookupResult =
	| { status: "found"; text: string; source: "s2" | "crossref" }
	| { status: "unavailable" | "no-doi" }
	| { status: "error"; error: string };

export async function fallbackAbstract(
	getJson: GetJson,
	paper: { doiUrl: string | null },
	options: { semanticScholarApiKey: string; contactEmail: string },
): Promise<AbstractLookupResult> {
	if (!doiFromPaper(paper)) return { status: "no-doi" };
	const failures: string[] = [];
	for (const source of ["s2", "crossref"] as const) {
		try {
			const text = source === "s2"
				? await semanticAbstract(getJson, options.semanticScholarApiKey, paper)
				: await crossrefAbstract(getJson, options.contactEmail, paper);
			if (text) return { status: "found", text, source };
		} catch (error) {
			const message = `${source === "s2" ? "Semantic Scholar" : "Crossref"}: ${error instanceof Error ? error.message : String(error)}`;
			console.warn("[research-connected] Abstract lookup:", message);
			failures.push(message);
		}
	}
	return failures.length ? { status: "error", error: failures.join("; ") } : { status: "unavailable" };
}

export async function crossrefAbstract(
	getJson: GetJson,
	contactEmail: string,
	paper: { doiUrl: string | null },
): Promise<string | null> {
	const doi = doiFromPaper(paper);
	if (!doi) return null;
	return new CrossrefClient(getJson, contactEmail).abstract(doi);
}

function pids(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(/\bdoi:([^\s;]+)/gi)].map(match => match[1]!.toLowerCase());
}

const queues = new Map<string, Promise<unknown>>();
const responses = new Map<string, { at: number; result: Promise<unknown> }>();

function responseKey(url: string, headers: Record<string, string>): string {
	return url + JSON.stringify(headers);
}

function dropCachedGet(url: string, headers: Record<string, string>): void {
	responses.delete(responseKey(url, headers));
}

async function cachedGet(get: GetJson, url: string, init: { headers: Record<string, string> }): Promise<unknown> {
	const origin = new URL(url).origin;
	const key = responseKey(url, init.headers);
	const cached = responses.get(key);
	if (cached && Date.now() - cached.at < 300_000) return cached.result;
	const previous = queues.get(origin) ?? Promise.resolve();
	const result = previous.catch(() => {}).then(async () => {
		await new Promise(resolve => window.setTimeout(resolve, origin.includes("semanticscholar") ? 1100 : 400));
		return get(url, init);
	});
	queues.set(origin, result);
	if (responses.size >= 200) responses.delete(responses.keys().next().value!);
	responses.set(key, { at: Date.now(), result });
	try { return await result; } catch (error) { responses.delete(key); throw error; }
}
