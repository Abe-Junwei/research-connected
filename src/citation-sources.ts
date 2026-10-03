import type { GetJson } from "./openalex";

export interface OpenCitationRow {
	oci?: string;
	citing?: string;
	cited?: string;
	creation?: string;
}

export class CitationSourceError extends Error {}

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
		if (!Array.isArray(json)) throw new CitationSourceError("OpenCitations 返回格式错误。");
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

	/**
	 * One batched lookup (POST /paper/batch, up to 500 ids) that cross-checks
	 * OpenAlex numbers. Keys of the returned map are the lowercased DOIs that
	 * Semantic Scholar recognized.
	 */
	async bulkCounts(dois: string[]): Promise<Map<string, S2Counts>> {
		if (!this.postJson || dois.length === 0) return new Map();
		const url = new URL("https://api.semanticscholar.org/graph/v1/paper/batch");
		url.searchParams.set("fields", "citationCount,referenceCount,externalIds");
		const out = new Map<string, S2Counts>();
		for (let i = 0; i < dois.length; i += 500) {
			const chunk = dois.slice(i, i + 500);
			const json = await this.postJson(url.toString(), {
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
				},
				body: JSON.stringify({ ids: chunk.map((doi) => `DOI:${doi}`) }),
			});
			if (!Array.isArray(json)) throw new CitationSourceError("Semantic Scholar 批量接口返回格式错误。");
			for (const item of json as Array<{
				citationCount?: number | null;
				referenceCount?: number | null;
				externalIds?: Record<string, string | null> | null;
			} | null>) {
				const doi = item?.externalIds?.DOI?.toLowerCase();
				if (!item || !doi) continue;
				out.set(doi, {
					citationCount: typeof item.citationCount === "number" ? item.citationCount : null,
					referenceCount: typeof item.referenceCount === "number" ? item.referenceCount : null,
				});
			}
		}
		return out;
	}

	/**
	 * DOIs of the works this paper references, one page of up to 1000. Used to
	 * backfill reference lists that OpenAlex does not have.
	 */
	async referenceDois(doi: string): Promise<string[]> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/references`);
		url.searchParams.set("fields", "externalIds");
		url.searchParams.set("limit", "1000");
		const result = await this.get<{ data?: Array<{ citedPaper?: { externalIds?: Record<string, string | null> | null } | null }> }>(url.toString());
		if (!Array.isArray(result.data)) throw new CitationSourceError("Semantic Scholar 返回格式错误。");
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
			const result = await this.get<{ data?: SemanticCitation[]; next?: number }>(url.toString());
			if (!Array.isArray(result.data)) throw new CitationSourceError("Semantic Scholar 返回格式错误。");
			data.push(...result.data);
			if (typeof result.next !== "number") return { data, partial: false };
			if (result.next <= offset) throw new CitationSourceError("Semantic Scholar 分页无进展。");
			offset = result.next;
		}
		return { data, partial: true };
	}

	/** Single-paper abstract lookup, used when OpenAlex has none. */
	async abstract(doi: string): Promise<string | null> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`);
		url.searchParams.set("fields", "abstract");
		const result = await this.get<{ abstract?: string | null }>(url.toString());
		const text = typeof result.abstract === "string" ? result.abstract.trim() : "";
		return text || null;
	}

	private async get<T>(url: string): Promise<T> {
		const json = await cachedGet(this.getJson, url, {
			headers: {
				Accept: "application/json",
				...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
			},
		});
		if (!json || typeof json !== "object") throw new CitationSourceError("引用数据源返回了无法识别的内容。");
		return json as T;
	}
}

export function doisFromOpenCitation(row: OpenCitationRow): { citing: string[]; cited: string[] } {
	return { citing: pids(row.citing), cited: pids(row.cited) };
}

/** Bare DOI from a paper's https://doi.org/ link, or null when the paper has none. */
export function doiFromPaper(paper: { doiUrl: string | null }): string | null {
	if (!paper.doiUrl) return null;
	const match = paper.doiUrl.match(/^https?:\/\/(?:dx\.)?doi\.org\/(\S+)$/i);
	return match?.[1] ?? null;
}

/**
 * OpenAlex has no abstract for many papers (Nature and friends deposit
 * none). Ask Semantic Scholar for one; null means "don't bother again".
 */
export async function semanticAbstract(
	getJson: GetJson,
	apiKey: string,
	paper: { doiUrl: string | null },
): Promise<string | null> {
	const doi = doiFromPaper(paper);
	if (!doi) return null;
	try {
		return await new SemanticScholarClient(getJson, apiKey).abstract(doi);
	} catch {
		return null;
	}
}

function pids(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(/\bdoi:([^\s;]+)/gi)].map(match => match[1]!.toLowerCase());
}

const queues = new Map<string, Promise<unknown>>();
const responses = new Map<string, { at: number; result: Promise<unknown> }>();
async function cachedGet(get: GetJson, url: string, init: { headers: Record<string, string> }): Promise<unknown> {
	const origin = new URL(url).origin;
	const key = url + JSON.stringify(init.headers);
	const cached = responses.get(key);
	if (cached && Date.now() - cached.at < 300_000) return cached.result;
	const previous = queues.get(origin) ?? Promise.resolve();
	const result = previous.catch(() => {}).then(async () => {
		await new Promise(resolve => setTimeout(resolve, origin.includes("semanticscholar") ? 1100 : 400));
		return get(url, init);
	});
	queues.set(origin, result);
	if (responses.size >= 200) responses.delete(responses.keys().next().value!);
	responses.set(key, { at: Date.now(), result });
	try { return await result; } catch (error) { responses.delete(key); throw error; }
}
