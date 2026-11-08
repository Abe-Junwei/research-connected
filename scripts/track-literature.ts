/**
 * Headless literature tracker for Research Connected.
 * Builds the same OpenAlex neighborhood as the plugin, then prints JSON:
 * related papers, frequently cited references (prior), classics — no graph UI.
 *
 * Usage (from repo root):
 *   npx --yes tsx scripts/track-literature.ts --seed "10.1038/nature14539"
 *   npx --yes tsx scripts/track-literature.ts --seed "W2919115771" --max-nodes 50
 *   npx --yes tsx scripts/track-literature.ts --seed "Active agentive case marking" --author Mithun --year 1991
 *
 * Prefer DOI or OpenAlex W… seeds. Short Author+Year titles are rejected unless
 * --author / --year / --expect-title disambiguate, and ambiguous search hits
 * return candidates instead of silently picking the top result.
 */
import "../src/host-language";
import { classicCandidates, derivativeWorks, priorWorks } from "../src/aggregates";
import { CrossrefClient, SemanticScholarClient } from "../src/citation-sources";
import { loadNeighborhood } from "../src/neighborhood";
import {
	OpenAlexClient,
	OpenAlexError,
	explainStatus,
	type GetJson,
	type RawWork,
} from "../src/openalex";
import { NON_RESEARCH_TYPES, classifyQuery, normalizeDoi } from "../src/paper";
import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../src/settings-model";
import type { PaperNode } from "../src/types";

const getJson: GetJson = async (url, init) => {
	const response = await fetch(url, { headers: init.headers });
	if (!response.ok) throw new OpenAlexError(explainStatus(response.status), response.status);
	return (await response.json()) as unknown;
};

const postJson = async (url: string, init: { headers: Record<string, string>; body: string }): Promise<unknown> => {
	const response = await fetch(url, { method: "POST", headers: init.headers, body: init.body });
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return (await response.json()) as unknown;
};

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

function has(flag: string): boolean {
	return process.argv.includes(flag);
}

function fail(payload: Record<string, unknown>, code = 1): never {
	console.error(JSON.stringify(payload));
	process.exit(code);
}

function paperOut(paper: PaperNode) {
	const doi = normalizeDoi(paper.doiUrl);
	return {
		id: paper.id,
		title: paper.title,
		year: paper.year,
		citedByCount: paper.citedByCount,
		authors: paper.authors,
		doi,
		origin: paper.origin,
		isSeed: Boolean(paper.isSeed),
		openAlex: `https://openalex.org/${paper.id}`,
		doiUrl: paper.doiUrl,
	};
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** Content-bearing tokens: drop bare years and very short noise. */
function contentTokens(tokens: string[]): string[] {
	return tokens.filter((t) => !/^\d{4}$/.test(t) && t.length >= 3);
}

/**
 * Weak seeds are short or Author+Year shaped and need filters / a precise id.
 * Example rejected without filters: "Mithun 1991".
 */
function isWeakSeed(query: string): boolean {
	const tokens = tokenize(query);
	if (tokens.length < 4) return true;
	const content = contentTokens(tokens);
	if (content.length < 2) return true;
	// Author(+initials) + year, optionally with "et al"
	if (/^[A-Za-z][A-Za-z'.\-]*(?:\s+[A-Za-z]\.?){0,2}(?:\s+et\s+al\.?)?\s+\d{4}$/i.test(query.trim())) {
		return true;
	}
	return false;
}

function workId(raw: RawWork): string | null {
	const id = String(raw.id ?? "").replace("https://openalex.org/", "").toUpperCase();
	return /^W\d+$/.test(id) ? id : null;
}

function workAuthors(raw: RawWork): string[] {
	const names: string[] = [];
	for (const authorship of raw.authorships ?? []) {
		const name = authorship?.author?.display_name?.trim();
		if (name) names.push(name);
	}
	return names;
}

function workDoi(raw: RawWork): string | null {
	return normalizeDoi(raw.doi ?? null);
}

function candidateOut(raw: RawWork, score?: number) {
	return {
		id: workId(raw),
		title: (raw.display_name ?? "").trim() || null,
		year: typeof raw.publication_year === "number" ? raw.publication_year : null,
		authors: workAuthors(raw),
		doi: workDoi(raw),
		type: raw.type ?? null,
		...(typeof score === "number" ? { score: Number(score.toFixed(3)) } : {}),
	};
}

function titleOverlap(queryTokens: string[], title: string): number {
	const titleTokens = new Set(tokenize(title));
	if (queryTokens.length === 0 || titleTokens.size === 0) return 0;
	let hit = 0;
	for (const token of queryTokens) {
		if (titleTokens.has(token)) hit += 1;
	}
	return hit / queryTokens.length;
}

function authorMatch(authors: string[], want: string): boolean {
	const needle = want.trim().toLowerCase();
	if (!needle) return false;
	const needleSurname = needle.split(/\s+/).pop() ?? needle;
	return authors.some((name) => {
		const lower = name.toLowerCase();
		if (lower.includes(needle)) return true;
		const parts = lower.split(/\s+/);
		const surname = parts[parts.length - 1] ?? "";
		return surname === needleSurname || surname.replace(/[^a-z]/g, "") === needleSurname.replace(/[^a-z]/g, "");
	});
}

function yearScore(year: number | null, want: number | undefined): number {
	if (want === undefined) return 0;
	if (year === null) return -0.5;
	if (year === want) return 2;
	if (Math.abs(year - want) === 1) return 0.5;
	return -2;
}

type ScoredHit = { raw: RawWork; score: number; reasons: string[] };

function scoreHit(
	raw: RawWork,
	query: string,
	filters: { author?: string; year?: number; expectTitle?: string },
): ScoredHit | null {
	const type = (raw.type ?? "").toLowerCase();
	if (type && NON_RESEARCH_TYPES.has(type)) return null;

	const title = (raw.display_name ?? "").trim();
	if (!title) return null;

	const expect = filters.expectTitle?.trim().toLowerCase();
	if (expect && !title.toLowerCase().includes(expect)) return null;

	const authors = workAuthors(raw);
	const year = typeof raw.publication_year === "number" ? raw.publication_year : null;
	const qTokens = contentTokens(tokenize(query));
	const overlap = titleOverlap(qTokens.length ? qTokens : tokenize(query), title);

	let score = overlap * 4;
	const reasons: string[] = [`titleOverlap=${overlap.toFixed(2)}`];

	if (filters.author) {
		if (authorMatch(authors, filters.author)) {
			score += 3;
			reasons.push("author");
		} else {
			score -= 3;
			reasons.push("authorMiss");
		}
	}

	const ys = yearScore(year, filters.year);
	if (filters.year !== undefined) {
		score += ys;
		reasons.push(ys >= 2 ? "year" : ys > 0 ? "yearNear" : "yearMiss");
	}

	if (expect) {
		score += 2;
		reasons.push("expectTitle");
	}

	return { raw, score, reasons };
}

function resolveSearchSeed(
	hits: RawWork[],
	query: string,
	filters: { author?: string; year?: number; expectTitle?: string },
): { chosen: RawWork; scored: ScoredHit[] } | { ambiguous: true; scored: ScoredHit[]; error: string } {
	const scored: ScoredHit[] = [];
	for (const raw of hits) {
		const item = scoreHit(raw, query, filters);
		if (item) scored.push(item);
	}
	scored.sort((a, b) => b.score - a.score);

	if (scored.length === 0) {
		return {
			ambiguous: true,
			scored,
			error: "Title search returned no usable research hits (or all failed filters / were non-research types).",
		};
	}

	const top = scored[0]!;
	const second = scored[1];
	const hasDecisiveFilter = Boolean(filters.author || filters.year !== undefined || filters.expectTitle);
	const MIN_SCORE = hasDecisiveFilter ? 2.5 : 2.0;
	const CLOSE_GAP = 0.75;

	if (top.score < MIN_SCORE) {
		return {
			ambiguous: true,
			scored,
			error: `Best title match score ${top.score.toFixed(2)} is too low to trust. Pass a DOI / OpenAlex W… id, or add --author / --year / --expect-title.`,
		};
	}

	if (second && top.score - second.score < CLOSE_GAP && !hasDecisiveFilter) {
		return {
			ambiguous: true,
			scored,
			error: "Top search hits are too close without --author/--year/--expect-title; refusing to guess.",
		};
	}

	// With filters, still refuse if author was required but missed on the winner.
	if (filters.author && !authorMatch(workAuthors(top.raw), filters.author)) {
		return {
			ambiguous: true,
			scored,
			error: `No hit matched --author ${JSON.stringify(filters.author)} with a confident title score.`,
		};
	}

	return { chosen: top.raw, scored };
}

async function main(): Promise<void> {
	const seedRaw = arg("--seed") ?? arg("-s");
	if (!seedRaw) {
		console.error(
			"Usage: tsx scripts/track-literature.ts --seed <doi|W…|title> [--author NAME] [--year YYYY] [--expect-title SUBSTR] [--max-nodes N] [--api-key KEY] [--pretty]",
		);
		process.exit(2);
	}

	const maxNodes = Number(arg("--max-nodes") ?? "50");
	const apiKey = arg("--api-key") ?? process.env.OPENALEX_API_KEY ?? "";
	const contactEmail = arg("--email") ?? process.env.OPENALEX_MAILTO ?? "";
	const authorFilter = arg("--author");
	const expectTitle = arg("--expect-title");
	const yearRaw = arg("--year");
	let yearFilter: number | undefined;
	if (yearRaw !== undefined) {
		yearFilter = Number(yearRaw);
		if (!Number.isInteger(yearFilter) || yearFilter < 1000 || yearFilter > 2100) {
			fail({ ok: false, error: `--year must be a 4-digit year, got ${JSON.stringify(yearRaw)}` }, 2);
		}
	}

	const settings: ConnectedPapersSettings = {
		...DEFAULT_SETTINGS,
		apiKey,
		contactEmail,
		maxNodes: Number.isFinite(maxNodes) ? Math.min(80, Math.max(20, maxNodes)) : 50,
		includeReferences: true,
		includeCitations: true,
		includeRelated: true,
	};

	const client = new OpenAlexClient(getJson, { apiKey: settings.apiKey, contactEmail: settings.contactEmail });
	const query = classifyQuery(seedRaw.trim());
	let target: { kind: "doi" | "openalex"; value: string };
	let seedResolution: {
		mode: "doi" | "openalex" | "search";
		query: string;
		chosenFromSearch: ReturnType<typeof candidateOut> | null;
		candidatesChecked: number;
	};

	if (!query) {
		fail({ ok: false, error: "Could not parse seed as DOI, OpenAlex id, or title." }, 2);
	}

	if (query.kind === "search") {
		const filters = { author: authorFilter, year: yearFilter, expectTitle };
		const hasFilter = Boolean(authorFilter || yearFilter !== undefined || expectTitle);
		if (isWeakSeed(query.value) && !hasFilter) {
			fail({
				ok: false,
				error:
					"Seed looks too short or Author+Year-shaped to resolve safely (e.g. \"Mithun 1991\"). " +
					"Pass a DOI or OpenAlex W… id, or disambiguate with --author NAME and/or --year YYYY and/or --expect-title SUBSTR.",
				query: query.value,
				hint: {
					prefer: "DOI or OpenAlex W…",
					example:
						'--seed "10.1353/lan.1991.0015"   OR   --seed "Active agentive case marking" --author Mithun --year 1991',
				},
			});
		}

		const hits = await client.searchWorks(query.value);
		if (!hits.length) {
			fail({ ok: false, error: "Title search returned no hits.", query: query.value });
		}

		const resolved = resolveSearchSeed(hits, query.value, filters);
		if ("ambiguous" in resolved) {
			fail({
				ok: false,
				error: resolved.error,
				query: query.value,
				candidates: resolved.scored.slice(0, 5).map((s) => candidateOut(s.raw, s.score)),
				rawHitCount: hits.length,
			});
		}

		const id = workId(resolved.chosen);
		if (!id) {
			fail({ ok: false, error: "Chosen search hit had no OpenAlex work id.", query: query.value });
		}
		target = { kind: "openalex", value: id };
		seedResolution = {
			mode: "search",
			query: query.value,
			chosenFromSearch: candidateOut(resolved.chosen, resolved.scored[0]?.score),
			candidatesChecked: resolved.scored.length,
		};
	} else if (query.kind === "doi") {
		target = { kind: "doi", value: query.value };
		seedResolution = { mode: "doi", query: query.value, chosenFromSearch: null, candidatesChecked: 0 };
	} else {
		target = { kind: "openalex", value: query.value };
		seedResolution = { mode: "openalex", query: query.value, chosenFromSearch: null, candidatesChecked: 0 };
	}

	const s2 = settings.s2Reconcile
		? new SemanticScholarClient(getJson, settings.semanticScholarApiKey ?? "", postJson)
		: null;
	const crossref = new CrossrefClient(getJson, settings.contactEmail);

	const graph = await loadNeighborhood(client, target, settings, undefined, s2, crossref);
	const visible = new Set(graph.nodes.map((n) => n.id));
	const priors = priorWorks(graph, visible);
	const derivatives = derivativeWorks(graph, visible);
	const classics = classicCandidates(graph.nodes, graph.edges, new Date().getFullYear(), graph.referenceLists);

	const related = graph.nodes
		.filter((n) => !n.isSeed)
		.map((n) => ({
			...paperOut(n),
			classic: classics.has(n.id) ? classics.get(n.id) : null,
		}));

	const out = {
		ok: true,
		seed: paperOut(graph.nodes.find((n) => n.isSeed) ?? graph.nodes[0]!),
		seedResolution,
		warnings: graph.warnings,
		counts: {
			related: related.length,
			prior: priors.length,
			derivative: derivatives.length,
			classic: classics.size,
		},
		related,
		priorWorks: priors.map((item) => ({ ...paperOut(item.paper), supportCount: item.count })),
		derivativeWorks: derivatives.map((item) => ({ ...paperOut(item.paper), supportCount: item.count })),
		classics: [...classics.entries()].map(([id, evidence]) => {
			const paper = graph.nodes.find((n) => n.id === id) ?? graph.catalog.find((n) => n.id === id);
			return {
				...(paper ? paperOut(paper) : { id }),
				evidence,
			};
		}),
		note:
			"related = sampled similarity neighborhood (plugin map nodes, no layout). " +
			"priorWorks = cited by ≥2 visible papers (foundation candidates). " +
			"classics = plugin classicCandidates (age/citation channels; not a certified canon).",
	};
	console.log(JSON.stringify(out, null, has("--pretty") ? 2 : undefined));
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(JSON.stringify({ ok: false, error: message }));
	process.exit(1);
});
