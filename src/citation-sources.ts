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

	async citations(doi: string): Promise<OpenCitationRow[]> {
		return this.rows(`https://api.opencitations.net/index/v2/citations/doi:${encodeURIComponent(doi)}`);
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

interface SemanticPaper {
	paperId?: string;
	url?: string | null;
	title?: string | null;
}

export class SemanticScholarClient {
	constructor(private readonly getJson: GetJson, private readonly apiKey: string) {}

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

	async resolveDoi(doi: string): Promise<string | null> {
		const paper = await this.get<SemanticPaper>(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=paperId`);
		return paper.paperId ?? null;
	}

	async citations(paperId: string): Promise<SemanticCitation[]> {
		const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/citations`);
		url.searchParams.set("fields", "contexts,intents,isInfluential,citingPaper.title,citingPaper.year,citingPaper.externalIds");
		url.searchParams.set("limit", "1000");
		const json = await this.get<{ data?: SemanticCitation[] }>(url.toString());
		return Array.isArray(json.data) ? json.data : [];
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
