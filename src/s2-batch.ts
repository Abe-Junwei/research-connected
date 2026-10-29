import { tr } from "./i18n";
import { normalizeDoi, cleanAbstractText } from "./paper";
import { embeddingCosine } from "./text-similarity";
import type { PostJson, S2Counts } from "./citation-sources";

export interface S2BatchStats {
	requested: number;
	cacheHits: number;
	requests: number;
	found: number;
	notFound: number;
	unresolved: number;
	rateLimited: boolean;
	embeddingFallback: boolean;
	error?: string;
}

interface CacheEntry {
	at: number;
	value: S2Counts | null;
	embeddingRequested: boolean;
}

interface BatchState {
	cache: Map<string, CacheEntry>;
	queue: Promise<unknown>;
	nextRequest: number;
	cooldown: number;
}

// Scope by transport and credentials, so preview fixtures and different accounts never share records.
const states = new WeakMap<PostJson, Map<string, BatchState>>();
const CACHE_LIMIT = 600;
const SUCCESS_TTL = 60 * 60_000;
const MISS_TTL = 5 * 60_000;
const RETRY_BUDGET = 5_000;

function stateFor(post: PostJson, key: string): BatchState {
	let accounts = states.get(post);
	if (!accounts) { accounts = new Map(); states.set(post, accounts); }
	let state = accounts.get(key);
	if (!state) {
		state = { cache: new Map(), queue: Promise.resolve(), nextRequest: 0, cooldown: 0 };
		accounts.set(key, state);
	}
	return state;
}

function errorInfo(error: unknown): { status?: number; retryAfterMs?: number; message: string } {
	const value = error && typeof error === "object" ? error as { status?: unknown; retryAfterMs?: unknown } : {};
	return {
		status: typeof value.status === "number" ? value.status : undefined,
		retryAfterMs: typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) ? Math.max(0, value.retryAfterMs) : undefined,
		message: error instanceof Error ? error.message : tr("Semantic Scholar 请求失败", "Semantic Scholar request failed"),
	};
}

const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

export async function fetchS2Batch(
	post: PostJson | undefined,
	apiKey: string,
	dois: readonly string[],
	embedding: boolean,
): Promise<{ data: Map<string, S2Counts>; stats: S2BatchStats }> {
	const ids = [...new Set(dois.map(normalizeDoi).filter((doi): doi is string => Boolean(doi)))];
	const stats: S2BatchStats = {
		requested: ids.length, cacheHits: 0, requests: 0, found: 0, notFound: 0,
		unresolved: 0, rateLimited: false, embeddingFallback: false,
	};
	const data = new Map<string, S2Counts>();
	if (!ids.length) return { data, stats };
	if (!post) {
		stats.error = tr("Semantic Scholar 批量传输不可用", "Semantic Scholar batch transport unavailable");
		stats.unresolved = ids.length;
		return { data, stats };
	}
	const state = stateFor(post, apiKey);
	const run = async (): Promise<void> => {
		const pending = ids.filter((doi) => {
			const entry = state.cache.get(doi);
			if (!entry || Date.now() - entry.at >= (entry.value ? SUCCESS_TTL : MISS_TTL) || embedding && entry.value && !entry.embeddingRequested) return true;
			stats.cacheHits += 1;
			if (entry.value) data.set(doi, entry.value);
			else stats.notFound += 1;
			return false;
		});
		for (let i = 0; i < pending.length; i += 500) {
			if (Date.now() < state.cooldown) {
				stats.rateLimited = true;
				stats.error = tr("Semantic Scholar 限流冷却中，本轮使用本地证据", "Semantic Scholar is cooling down after rate limiting; using local evidence this round");
				break;
			}
			const chunk = pending.slice(i, i + 500);
			let requestEmbedding = embedding;
			let rows: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				await wait(Math.max(0, state.nextRequest - Date.now()));
				state.nextRequest = Date.now() + 1100;
				const url = new URL("https://api.semanticscholar.org/graph/v1/paper/batch");
				url.searchParams.set("fields", `citationCount,referenceCount,externalIds,abstract${requestEmbedding ? ",embedding" : ""}`);
				stats.requests += 1;
				try {
					rows = await post(url.toString(), {
						headers: { Accept: "application/json", "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
						body: JSON.stringify({ ids: chunk.map(doi => `DOI:${doi}`) }),
					});
					if (!Array.isArray(rows) || rows.length !== chunk.length || rows.some((row: unknown) =>
						row !== null && (typeof row !== "object" || Array.isArray(row) || !["paperId", "citationCount", "referenceCount", "abstract", "embedding"].some(key => key in row)))) {
						throw new Error(tr("Semantic Scholar 批量响应结构无效", "Invalid Semantic Scholar batch response"));
					}
					break;
				} catch (error) {
					rows = undefined;
					const info = errorInfo(error);
					if (info.status === 429) {
						stats.rateLimited = true;
						const delay = info.retryAfterMs ?? 2500 * (attempt + 1);
						state.cooldown = Date.now() + Math.max(delay, 1100);
						if (attempt === 0 && delay <= RETRY_BUDGET) { await wait(Math.max(delay, 1100)); continue; }
					} else if (attempt === 0 && requestEmbedding && (info.status === 400 || info.status === 422)) {
						requestEmbedding = false;
						stats.embeddingFallback = true;
						continue;
					} else if (attempt === 0 && (info.status === undefined || info.status >= 500)) {
						await wait(1200);
						continue;
					}
					stats.error = info.message;
					break;
				}
			}
			if (!Array.isArray(rows)) break;
			for (let index = 0; index < chunk.length; index++) {
				const doi = chunk[index]!;
				const raw: unknown = rows[index];
				if (raw === null) {
					state.cache.set(doi, { at: Date.now(), value: null, embeddingRequested: requestEmbedding });
					stats.notFound += 1;
					continue;
				}
				const item = raw as { citationCount?: unknown; referenceCount?: unknown; abstract?: unknown; embedding?: { model?: unknown; vector?: unknown } | null };
				const vector = item.embedding?.vector;
				const model = typeof item.embedding?.model === "string" ? item.embedding.model.trim() : "";
				const numbers = Array.isArray(vector) && vector.every((n: unknown): n is number => typeof n === "number" && Number.isFinite(n))
					? vector : null;
				const validVector = requestEmbedding && model && numbers && embeddingCosine(numbers, numbers) !== null;
				const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
				const value: S2Counts = {
					citationCount: count(item.citationCount), referenceCount: count(item.referenceCount),
					abstract: typeof item.abstract === "string" ? cleanAbstractText(item.abstract) || null : null,
					embedding: validVector ? [...numbers] : null,
					embeddingModel: validVector ? model : null,
				};
				data.set(doi, value);
				state.cache.set(doi, { at: Date.now(), value, embeddingRequested: requestEmbedding });
			}
			while (state.cache.size > CACHE_LIMIT) state.cache.delete(state.cache.keys().next().value!);
		}
	};
	const request = state.queue.then(run);
	state.queue = request.catch(() => {});
	await request;
	stats.found = data.size;
	stats.unresolved = ids.length - stats.found - stats.notFound;
	return { data, stats };
}
