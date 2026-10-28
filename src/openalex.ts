import { tr } from "./i18n";
import { OPENALEX_API } from "./constants";
import { normalizeDoi, reconstructAbstract, shortId } from "./paper";
import type { Origin, PaperNode, SearchHit } from "./types";

export interface RawWork {
	id?: string;
	display_name?: string;
	publication_year?: number | null;
	cited_by_count?: number;
	doi?: string | null;
	authorships?: Array<{ author?: { display_name?: string | null } | null } | null> | null;
	abstract_inverted_index?: Record<string, number[]> | null;
	referenced_works?: string[] | null;
	language?: string | null;
	type?: string | null;
	is_retracted?: boolean;
	concepts?: Array<{ display_name?: string | null; score?: number | null } | null> | null;
	topics?: Array<{ id?: string | null; display_name?: string | null; score?: number | null } | null> | null;
	primary_location?: { source?: { display_name?: string | null } | null } | null;
	biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
}

export type GetJson = (
	url: string,
	init: { headers: Record<string, string> },
) => Promise<unknown>;

export interface OpenAlexAuth {
	apiKey: string;
	contactEmail: string;
}

export interface SampledWorks {
	/** Source aliases do not consume accepted-work slots but remain available for evidence. */
	duplicateWorks?: RawWork[];
	works: RawWork[];
	rejected: RawWork[];
	rawFetched: number;
	filtered: number;
	duplicates: number;
	requests: number;
	pages: number;
	exhausted: boolean;
	error?: string;
}

const LIST_SELECT = "id,display_name,publication_year,cited_by_count,doi,authorships,language,type,is_retracted,topics,concepts,primary_location,biblio";
const WORK_SELECT = `${LIST_SELECT},abstract_inverted_index,referenced_works,related_works`;
const DETAIL_SELECT = "id,referenced_works,abstract_inverted_index";

export class OpenAlexError extends Error {
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "OpenAlexError";
		this.status = status;
	}
}

export function explainStatus(status: number | undefined): string {
	if (status === 404) return tr("OpenAlex 里没有找到这篇作品。", "This work was not found in OpenAlex.");
	if (status === 401 || status === 403) return tr("OpenAlex 拒绝了 API 密钥。请在设置里检查。", "OpenAlex rejected the API key. Check settings.");
	if (status === 429 || status === 402 || status === 409) {
		return tr("OpenAlex 额度已用完或请求过快。可在设置中填写免费 API 密钥，或等到每日额度重置。", "OpenAlex rate limit reached. Add a free API key in settings or wait for the daily reset.");
	}
	if (status) return tr(`OpenAlex 请求失败（HTTP ${status}）。`, `OpenAlex request failed (HTTP ${status}).`);
	return tr("无法连接 OpenAlex。", "Could not connect to OpenAlex.");
}

/**
 * Thin OpenAlex works client. HTTP is injected so Obsidian's requestUrl and
 * Node fetch can share the same calls.
 */
export class OpenAlexClient {
	constructor(
		private readonly getJson: GetJson,
		private readonly auth: OpenAlexAuth,
	) {}

	workByDoi(doi: string): Promise<RawWork> {
		return this.getObject(new URL(`${OPENALEX_API}/works/doi:${encodeDoi(doi)}?select=${WORK_SELECT}`));
	}

	workById(id: string): Promise<RawWork> {
		return this.getObject(new URL(`${OPENALEX_API}/works/${id}?select=${WORK_SELECT}`));
	}

	searchWorks(query: string): Promise<RawWork[]> {
		const url = new URL(`${OPENALEX_API}/works`);
		url.searchParams.set("search", query);
		url.searchParams.set("per_page", "8");
		url.searchParams.set("select", LIST_SELECT);
		return this.getResults(url);
	}

	/**
	 * Works the seed cites. OpenAlex names this filter `cited_by` (outgoing).
	 * `pages > 1` follows the cursor for deeper sampling.
	 */
	referencedBySeed(seedId: string, perPage: number, pages = 1): Promise<RawWork[]> {
		return this.listFilter(`cited_by:${seedId}`, perPage, "cited_by_count:desc", pages);
	}

	/**
	 * Works that cite the seed. OpenAlex names this filter `cites` (incoming).
	 */
	citingSeed(seedId: string, perPage: number, pages = 1): Promise<RawWork[]> {
		return this.listFilter(`cites:${seedId}`, perPage, "cited_by_count:desc", pages);
	}

	relatedTo(seedId: string, perPage: number, pages = 1): Promise<RawWork[]> {
		return this.listFilter(`related_to:${seedId}`, perPage, undefined, pages);
	}

	/** Cursor-sample until enough records pass the caller's filter or the budget ends. */
	async sampleWorks(
		filter: string,
		target: number,
		perPage: number,
		sort: string | undefined,
		maxPages: number,
		accept: (work: RawWork) => boolean,
	): Promise<SampledWorks> {
		const budget = pageBudget(perPage, maxPages);
		const url = new URL(`${OPENALEX_API}/works`);
		url.searchParams.set("filter", filter);
		url.searchParams.set("per_page", String(budget.perPage));
		if (sort) url.searchParams.set("sort", sort);
		url.searchParams.set("select", LIST_SELECT);
		if (maxPages > 1) url.searchParams.set("cursor", "*");

	const works: RawWork[] = [];
	const rejected: RawWork[] = [];
	const seen = new Set<string>();
	let rawFetched = 0;
	let filtered = 0;
	let duplicates = 0;
	const duplicateWorks: RawWork[] = [];
	let requests = 0;
	let pages = 0;
	let nextCursor: string | null = "*";
	let error: string | undefined;
	while (pages < budget.maxPages && works.length < target && nextCursor) {
		if (pages > 0) url.searchParams.set("cursor", nextCursor);
		let page: { results: RawWork[]; nextCursor: string | null };
		try {
			requests += 1;
			page = await this.getPage(url);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : tr("请求失败", "Request failed");
			break;
		}
			pages += 1;
			rawFetched += page.results.length;
			for (const work of page.results) {
				if (!accept(work)) {
					filtered += 1;
					rejected.push(work);
				} else {
					const identity = sampledIdentity(work);
					if (seen.has(identity)) { duplicates += 1; duplicateWorks.push(work); continue; }
					seen.add(identity);
					works.push(work);
				}
			}
			nextCursor = page.nextCursor;
			if (page.results.length === 0) break;
		}
		return { works: works.slice(0, target), duplicateWorks, rejected, rawFetched, filtered, duplicates, requests, pages, exhausted: !error && !nextCursor, error };
	}

	async worksByIds(ids: string[]): Promise<RawWork[]> {
		const unique = [...new Set(ids)];
		const all: RawWork[] = [];
		for (let i = 0; i < unique.length; i += 80) {
			const chunk = unique.slice(i, i + 80);
			if (chunk.length === 0) continue;
			const url = new URL(`${OPENALEX_API}/works`);
			url.searchParams.set("filter", `openalex:${chunk.join("|")}`);
			url.searchParams.set("per_page", String(chunk.length));
			url.searchParams.set("select", DETAIL_SELECT);
			all.push(...(await this.getResults(url)));
		}
		return all;
	}

	/** Full metadata is needed when restoring papers that are no longer in the sampled graph. */
	async papersByIds(ids: string[]): Promise<RawWork[]> {
		const unique = [...new Set(ids)];
		const all: RawWork[] = [];
		for (let i = 0; i < unique.length; i += 80) {
			const chunk = unique.slice(i, i + 80);
			const url = new URL(`${OPENALEX_API}/works`);
			url.searchParams.set("filter", `openalex:${chunk.join("|")}`);
			url.searchParams.set("per_page", String(chunk.length));
			url.searchParams.set("select", WORK_SELECT);
			all.push(...(await this.getResults(url)));
		}
		return all;
	}

	private listFilter(filter: string, perPage: number, sort: string | undefined, pages = 1): Promise<RawWork[]> {
		const url = new URL(`${OPENALEX_API}/works`);
		url.searchParams.set("filter", filter);
		url.searchParams.set("per_page", String(perPage));
		if (sort) url.searchParams.set("sort", sort);
		url.searchParams.set("select", LIST_SELECT);
		if (pages <= 1) return this.getResults(url);
		return this.getPaged(url, perPage, pages);
	}

	/** Cursor pagination: one request per page, stops early at the end of the list. */
	private async getPaged(url: URL, perPage: number, pages: number): Promise<RawWork[]> {
		url.searchParams.set("cursor", "*");
		const all: RawWork[] = [];
		for (let page = 0; page < pages; page++) {
			const { results, nextCursor } = await this.getPage(url);
			all.push(...results);
			if (!nextCursor || results.length === 0) break;
			url.searchParams.set("cursor", nextCursor);
		}
		return all;
	}

	private async getPage(url: URL): Promise<{ results: RawWork[]; nextCursor: string | null }> {
		const json = await this.get(url);
		if (!json || typeof json !== "object" || !("results" in json)) {
			throw new OpenAlexError(tr("OpenAlex 返回了无法识别的列表。", "OpenAlex returned an unrecognized list."));
		}
		const body = json as { results?: unknown; meta?: { next_cursor?: unknown } };
		const results = Array.isArray(body.results)
			? body.results.filter((item): item is RawWork => Boolean(item) && typeof item === "object")
			: [];
		const cursor = body.meta?.next_cursor;
		return { results, nextCursor: typeof cursor === "string" && cursor ? cursor : null };
	}

	private async getObject(url: URL): Promise<RawWork> {
		const json = await this.get(url);
		if (!json || typeof json !== "object") {
			throw new OpenAlexError(tr("OpenAlex 返回了无法识别的作品记录。", "OpenAlex returned an unrecognized work record."));
		}
		return json;
	}

	private async getResults(url: URL): Promise<RawWork[]> {
		const json = await this.get(url);
		if (!json || typeof json !== "object" || !("results" in json)) {
			throw new OpenAlexError(tr("OpenAlex 返回了无法识别的列表。", "OpenAlex returned an unrecognized list."));
		}
		const results = (json as { results?: unknown }).results;
		if (!Array.isArray(results)) return [];
		return results.filter((item): item is RawWork => Boolean(item) && typeof item === "object");
	}

	private async get(url: URL): Promise<unknown> {
		const email = validEmail(this.auth.contactEmail);
		if (email) url.searchParams.set("mailto", email);
		try {
			return await this.getJson(url.toString(), { headers: this.headers() });
		} catch (error) {
			if (error instanceof OpenAlexError) throw error;
			throw new OpenAlexError(explainStatus(undefined));
		}
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = { Accept: "application/json" };
		const apiKey = this.auth.apiKey.trim();
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		return headers;
	}
}

/** OpenAlex documents cap `per_page` at 100. A multi-page call keeps the same raw budget by adding pages; a one-page call stays one page. */
export const OPENALEX_MAX_PER_PAGE = 100;

export function pageBudget(perPage: number, maxPages: number): { perPage: number; maxPages: number } {
	const size = Math.max(1, Math.floor(perPage) || 1);
	const pages = Math.max(1, Math.floor(maxPages) || 1);
	if (size <= OPENALEX_MAX_PER_PAGE) return { perPage: size, maxPages: pages };
	if (pages === 1) return { perPage: OPENALEX_MAX_PER_PAGE, maxPages: 1 };
	return { perPage: OPENALEX_MAX_PER_PAGE, maxPages: pages * Math.ceil(size / OPENALEX_MAX_PER_PAGE) };
}

function sampledIdentity(work: RawWork): string {
	const doi = work.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
	if (doi) return `doi:${doi}`;
	const id = work.id?.match(/W\d+/i)?.[0]?.toUpperCase();
	return `id:${id ?? "unknown"}`;
}

function encodeDoi(doi: string): string {
	return encodeURIComponent(doi).replace(/%2F/gi, "/");
}

export function toPaper(raw: RawWork, origin: Origin): PaperNode | null {
	if (!raw.id) return null;
	const id = shortId(raw.id);
	if (!/^W\d+$/.test(id)) return null;
	const title = (raw.display_name ?? "").trim();
	if (!title) return null;
	const names = authorNames(raw.authorships);
	return {
		id,
		title,
		year: typeof raw.publication_year === "number" ? raw.publication_year : null,
		citedByCount: typeof raw.cited_by_count === "number" ? raw.cited_by_count : 0,
		authors: formatAuthorNames(names),
		authorList: names,
		abstract: reconstructAbstract(raw.abstract_inverted_index),
		doiUrl: toDoiUrl(raw.doi),
		openAlexUrl: `https://openalex.org/${id}`,
		isSeed: origin === "seed",
		origin,
		language: cleanToken(raw.language),
		workType: cleanToken(raw.type),
		venue: cleanName(raw.primary_location?.source?.display_name),
		bibliography: raw.biblio ? {
			volume: cleanToken(raw.biblio.volume),
			issue: cleanToken(raw.biblio.issue),
			firstPage: cleanToken(raw.biblio.first_page),
			lastPage: cleanToken(raw.biblio.last_page),
		} : undefined,
		retracted: raw.is_retracted === true,
		concepts: conceptNames(raw.topics, raw.concepts),
		topicTags: topicTags(raw.topics, raw.concepts),
	};
}

export function toSearchHit(raw: RawWork): SearchHit | null {
	const paper = toPaper(raw, "related");
	if (!paper) return null;
	return {
		id: paper.id,
		title: paper.title,
		year: paper.year,
		citedByCount: paper.citedByCount,
		authors: paper.authors,
	};
}

function cleanToken(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().toLowerCase();
	return trimmed || null;
}

function cleanName(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/\s+/g, " ");
	return trimmed || null;
}

function conceptNames(topics: RawWork["topics"], concepts: RawWork["concepts"]): string[] {
	const ranked = [...(topics?.length ? topics : concepts ?? [])].sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of ranked) {
		const name = item?.display_name?.trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
		if (names.length >= 8) break;
	}
	return names;
}

function topicTags(topics: RawWork["topics"], concepts: RawWork["concepts"]): Array<{ id: string; name: string; score: number }> {
	if (topics?.length) {
		return topics.flatMap((topic) => {
			const id = topic?.id?.trim();
			const name = topic?.display_name?.trim();
			if (!id || !name) return [];
			return [{ id, name, score: Math.max(0, Math.min(1, topic?.score ?? 1)) }];
		});
	}
	return (concepts ?? []).flatMap((concept) => {
		const name = concept?.display_name?.trim();
		if (!name) return [];
		return [{ id: `name:${name.toLocaleLowerCase()}`, name, score: Math.max(0, Math.min(1, concept?.score ?? 1)) }];
	});
}

function authorNames(authorships: RawWork["authorships"]): string[] {
	const names: string[] = [];
	for (const authorship of authorships ?? []) {
		const name = authorship?.author?.display_name?.trim();
		if (name) names.push(name);
	}
	return names;
}

function formatAuthorNames(names: string[]): string {
	if (names.length === 0) return tr("作者不详", "Author unknown");
	if (names.length <= 3) return names.join(", ");
	return tr(`${names.slice(0, 3).join(", ")} 等`, `${names.slice(0, 3).join(", ")} et al.`);
}

function toDoiUrl(doi: string | null | undefined): string | null {
	const normalized = normalizeDoi(doi);
	return normalized ? `https://doi.org/${normalized}` : null;
}

function validEmail(email: string): string | null {
	const trimmed = email.trim();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return null;
	return trimmed;
}
