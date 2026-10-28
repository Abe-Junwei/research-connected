import { nicholsSnapshot } from "../preview/work-identity-fixture";
import assert from "node:assert/strict";
import { acknowledgeIdentityStates, commitPaperReading, emptyVersionScope, excludeVersion, excludeWholeWork, normalizeProjects, noteVersion, projectsForSeedId, reconcileProjectIdentity, restoreGraphSnapshot, restoreVersion, retargetProjectSeed, savedProjectForSeed, saveGraphSnapshot, stageVersion, updateProjectPaperState, versionVisible, type ReadingStatus, type ResearchProject, type SavedGraphSnapshot } from "../src/project-state";
import { graftNodes, normalizeWorkGraph, separateWorkRecords } from "../src/graph-edit";
import { paperDois, resolveWorkQuery, sameWork, workIndex } from "../src/work-identity";
import { doiOf, matchLiteratureNote, toBibTeX } from "../src/export-graph";
import { resolvePathEndpoint } from "../src/doi-path";
import { normalizeDoi, shortId } from "../src/paper";
import { OpenAlexClient, type RawWork } from "../src/openalex";
import { expandAround, expandSecondLayer, loadNeighborhood, restoreGraftedMembers, type SimilarityGraph } from "../src/neighborhood";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import type { PaperNode } from "../src/types";
import { invalidateLiteratureIndex, lookupLiteratureNote, rememberLiteratureNote } from "../src/vault-note";


export function verifyWorkIdentity(): void {
	const graph = restoreGraphSnapshot(nicholsSnapshot());
	assert.ok(graph);
	assert.equal(graph.nodes.length, 1, "same Nichols article with two DOIs must occupy one node");
	assert.equal(graph.referenceLists.get("W4245234602")?.length, 51, "both source reference lists must survive");
	assert.equal(graph.edges.length, 0, "an alias-to-seed edge must not become a self loop");
	const snapshot = nicholsSnapshot();
	const [seed, alias] = snapshot.nodes as [PaperNode, PaperNode];
	assert.equal(sameWork(seed, alias), true);
	assert.equal(sameWork(seed, { ...alias, authorList: [] }), false, "missing authors cannot merge different DOIs");
	assert.equal(sameWork(seed, { ...alias, year: 1987 }), false);
	assert.equal(sameWork(seed, { ...alias, bibliography: { ...alias.bibliography, issue: "2" } }), false);
	assert.equal(sameWork(seed, { ...alias, workType: "preprint" }), false);
	assert.equal(sameWork(seed, { ...alias, title: `${alias.title} II` }), false);
	const ambiguous = [seed, { ...alias, bibliography: { ...alias.bibliography, issue: null } }, { ...alias, id: "W3", bibliography: { ...alias.bibliography, issue: "2" } }];
	assert.equal(workIndex(ambiguous).papers.length, 2, "missing issue cannot bridge conflicting groups");
	assert.equal(resolveWorkQuery(graph.nodes, alias.id), seed.id);
	assert.equal(resolveWorkQuery(graph.nodes, alias.doiUrl!), seed.id);
	assert.equal(paperDois(graph.nodes[0]!).length, 2);
	assert.equal(graph.nodes[0]!.citedByCount, 404, "citation counts from separate records are not summed or maximized");
	assert.equal(resolvePathEndpoint(alias.doiUrl!, graph.nodes, normalizeDoi, shortId), seed.id);
	assert.equal(resolvePathEndpoint(alias.id, graph.nodes, normalizeDoi, shortId), seed.id);
	const notes = [{ path: "primary.md", frontmatter: { doi: seed.doiUrl } }, { path: "alternate.md", frontmatter: { doi: alias.doiUrl } }];
	assert.deepEqual(matchLiteratureNote(notes, graph.nodes[0]!, "doi")?.alternatives, ["primary.md", "alternate.md"]);
	assert.equal((toBibTeX(graph.nodes).match(/@article/g) ?? []).length, 1);
	const cited = (id: string, doi: string | null = null): PaperNode => ({
		id, title: id, authors: "Ada Lovelace", authorList: ["Ada Lovelace"], year: 2020, citedByCount: 1,
		doiUrl: doi, openAlexUrl: `https://openalex.org/${id}`, isSeed: false, origin: "reference", abstract: "",
		concepts: [], language: "en", workType: "article", venue: null, retracted: false,
	});
	const doiPaper = cited("W123", "https://doi.org/10.1234/w567");
	const otherId = cited("W567", "https://doi.org/10.9999/other");
	assert.equal(resolveWorkQuery([doiPaper, otherId], "10.1234/w567"), "W123");
	assert.equal(resolveWorkQuery([otherId], "10.1234/w567"), null);
	assert.equal(resolveWorkQuery([otherId], "https://openalex.org/works/W567"), "W567");
	assert.equal(resolvePathEndpoint("10.1234/w567", [doiPaper, otherId], normalizeDoi, shortId), "W123");
	assert.equal(resolvePathEndpoint("10.1234/w567", [otherId], normalizeDoi, shortId), null);
	assert.equal(resolveWorkQuery([doiPaper, otherId], "see 10.1234/w567 and W567"), null);
	assert.equal(doiOf(cited("W9", "https://doi.org/10.1234/example(test)")), "10.1234/example(test)");
	assert.equal(doiOf(cited("W9", "https://doi.org/10.1234/example(test).")), "10.1234/example(test)");
	const bibKeys = [...toBibTeX([cited("W1"), cited("W2"), cited("W20202")]).matchAll(/@\w+\{([^,]+),/g)].map((match) => match[1]);
	assert.deepEqual(bibKeys, ["Lovelace2020", "Lovelace20202", "Lovelace20200202"]);
	const legacy: Record<string, ResearchProject> = {
		W1: { version: 1, seedId: "W1", name: "Legacy", updatedAt: 1, views: [] },
		W8: { version: 1, seedId: "W8", name: "Other", updatedAt: 1, views: [] },
	};
	const retargeted = retargetProjectSeed(legacy, "W1", "W9");
	assert.deepEqual(Object.keys(retargeted), ["W1", "W8"]);
	assert.equal(retargeted.W1?.seedId, "W9");
	assert.equal(savedProjectForSeed(retargeted, { kind: "openalex", value: "W9" }), undefined);
	assert.equal(savedProjectForSeed(retargeted, { kind: "openalex", value: "W1" })?.name, "Legacy");
	const shared = retargetProjectSeed(retargeted, "W8", "W9");
	assert.deepEqual(projectsForSeedId(shared, "W9").map((project) => project.name), ["Legacy", "Other"]);
	assert.equal(savedProjectForSeed(shared, { kind: "openalex", value: "W9" }), undefined);
	let scope = noteVersion(noteVersion(emptyVersionScope(), "v1"), "v2");
	scope = excludeVersion(scope, "v1");
	assert.equal(versionVisible(scope, "v1"), false);
	assert.equal(versionVisible(scope, "v2"), true);
	scope = stageVersion(scope, "v1");
	assert.equal(versionVisible(scope, "v1"), false);
	scope = excludeWholeWork(scope);
	scope = noteVersion(scope, "v3");
	assert.equal(versionVisible(scope, "v3"), false);
	scope = restoreVersion(scope, "v2");
	scope = stageVersion(scope, "v2");
	assert.equal(versionVisible(scope, "v2"), true);
	assert.equal(versionVisible(scope, "v1"), false);
	assert.equal(versionVisible(scope, "v3"), false);
	scope = excludeVersion(scope, "v2");
	assert.equal(versionVisible(scope, "v2"), false);
	assert.equal(scope.versions.v2?.restored, false);
	assert.equal(excludeVersion(scope, "seed", true), scope);
	invalidateLiteratureIndex();
	const noted = cited("W1", "https://doi.org/10.1234/cache");
	const vault = (files: { path: string; frontmatter?: Record<string, unknown> }[]) => ({
		vault: {
			getMarkdownFiles: () => files.map((file) => ({ path: file.path })),
			getAbstractFileByPath: (path: string) => files.some((file) => file.path === path) ? { path } : null,
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({ frontmatter: files.find((item) => item.path === file.path)?.frontmatter }),
		},
	}) as never;
	rememberLiteratureNote(noted, "old.md", "unread");
	assert.equal(lookupLiteratureNote(vault([{ path: "old.md", frontmatter: { doi: "10.1234/cache", openalex: "https://openalex.org/W1", "rc-status": "read" } }]), noted, "doi")?.reading, "read");
	invalidateLiteratureIndex();
	rememberLiteratureNote(noted, "old.md", "unread");
	assert.equal(lookupLiteratureNote(vault([{ path: "new.md", frontmatter: { doi: "10.1234/cache", openalex: "W1", "rc-status": "to-read" } }]), noted, "doi")?.path, "new.md");
	invalidateLiteratureIndex();
	rememberLiteratureNote(noted, "a.md", "read");
	assert.deepEqual(lookupLiteratureNote(vault([
		{ path: "a.md", frontmatter: { doi: "10.1234/cache", openalex: "W1", "rc-status": "read" } },
		{ path: "b.md", frontmatter: { doi: "10.1234/cache", "rc-status": "unread" } },
	]), noted, "doi")?.alternatives, ["a.md", "b.md"]);
	invalidateLiteratureIndex();
	rememberLiteratureNote(noted, "fresh.md", "to-read");
	assert.equal(lookupLiteratureNote(vault([{ path: "fresh.md" }]), noted, "doi")?.reading, "to-read");
	assert.deepEqual(normalizeWorkGraph(graph).workIdentity?.referenceLists, graph.workIdentity?.referenceLists);
	const roundTrip = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph))))!;
	assert.equal(roundTrip.nodes.length, 1);
	assert.equal(roundTrip.referenceLists.get(seed.id)?.length, 51);
	assert.equal(roundTrip.workIdentity?.referenceLists.find(([id]) => id === seed.id)?.[1].length, 16);
	const split = separateWorkRecords(roundTrip, roundTrip.nodes[0]!);
	assert.equal(split.nodes.length, 2, "keeping separate restores both original records");
	assert.equal(split.referenceLists.get(seed.id)?.length, 16);
	assert.equal(split.referenceLists.get(alias.id)?.length, 49);
	assert.equal(restoreGraphSnapshot(saveGraphSnapshot(split))?.nodes.length, 2);
	const third = { ...seed, id: "W3", title: "Other article", isSeed: false, origin: "citation" as const, doiUrl: "https://doi.org/10.1234/third" };
	const input = nicholsSnapshot(); input.nodes.push(third); input.catalog.push(third);
	input.referenceLists.push([third.id, [seed.id, alias.id]]);
	input.coCitationContextIds = [third.id];
	input.citationEvidence = [seed, alias].map((paper) => ({ citingId: third.id, citedId: paper.id, sources: ["openalex"], intents: [], contexts: [paper.id], relation: "unclear", evidenceQuotes: [], confidence: "medium" }));
	const incoming = restoreGraphSnapshot(input)!;
	assert.deepEqual(incoming.referenceLists.get(third.id), [seed.id], "two aliases count as one cited work");
	assert.deepEqual(incoming.citationEvidence?.get(third.id, seed.id)?.contexts.sort(), [alias.id, seed.id].sort());
	const incomingSplit = separateWorkRecords(incoming, incoming.nodes.find((paper) => paper.isSeed)!);
	assert.equal(incomingSplit.citationEvidence?.get(third.id, seed.id)?.contexts.length, 1, "splitting restores source-specific evidence");
	assert.equal(incomingSplit.citationEvidence?.get(third.id, alias.id)?.contexts.length, 1);
	const citingAliases = nicholsSnapshot();
	citingAliases.nodes = citingAliases.nodes.map((paper) => ({ ...paper, origin: "citation" as const }));
	citingAliases.catalog = citingAliases.nodes;
	citingAliases.coCitationContextIds = [seed.id, alias.id];
	const citingMerged = restoreGraphSnapshot(citingAliases)!;
	assert.deepEqual(citingMerged.coCitationContextIds, [seed.id], "a merged citing work counts once");
	const citingRoundTrip = restoreGraphSnapshot(saveGraphSnapshot(citingMerged))!;
	assert.deepEqual([...(separateWorkRecords(citingRoundTrip, citingRoundTrip.nodes[0]!).coCitationContextIds ?? [])].sort(), [seed.id, alias.id].sort(), "splitting restores both original citing contexts");
	const addedContext = normalizeWorkGraph({ ...citingRoundTrip, coCitationContextIds: [seed.id, "W999"] });
	assert.ok(addedContext.workIdentity?.contextIds?.includes("W999"), "context-only changes must update reversible source data");
	const project: ResearchProject = { version: 1, seedId: seed.id, name: "Nichols", updatedAt: 1, snapshot, views: [], paperStates: {
		[seed.id]: { paper: seed, reading: "unread", staged: true, excluded: false, source: "OpenAlex", updatedAt: 1 },
		[alias.id]: { paper: alias, reading: "read", staged: false, excluded: true, source: "OpenAlex", updatedAt: 2 },
	}, currentView: { name: "Alias selected", selectedId: alias.id, layout: "force2d", scrubYear: null, zoom: 1, centerX: 0, centerY: 0, updatedAt: 1 },
	deepDives: [{ id: "batch", parentId: alias.id, createdAt: 1, references: 1, citations: 0, additions: [{ paperId: alias.id, source: "reference" }], noMore: false, warnings: [] }] };
	const migrated = normalizeProjects({ [seed.id]: project });
	const current = migrated[seed.id]!;
	assert.equal(Object.keys(current.paperStates!).length, 1);
	assert.equal(current.paperStates![seed.id]?.reading, "read");
	assert.equal(current.paperStates![seed.id]?.excluded, false, "seed alias cannot exclude the seed");
	assert.equal(current.currentView?.selectedId, seed.id);
	assert.equal(current.deepDives?.[0]?.parentId, seed.id);
	assert.equal(current.identityOriginalStates?.[alias.id]?.excluded, true);
	assert.equal(current.identityConflicts?.includes(seed.id), true);
	acknowledgeIdentityStates(current, graph.nodes[0]!);
	reconcileProjectIdentity(current, graph);
	assert.equal(current.identityConflicts?.includes(seed.id), false, "acknowledging a legacy conflict survives future refreshes");
	assert.equal(savedProjectForSeed(migrated, { kind: "openalex", value: alias.id }), current);
	assert.equal(savedProjectForSeed(migrated, { kind: "doi", value: alias.doiUrl! }), current);
	updateProjectPaperState(migrated, seed.id, alias, { reading: "to-read", staged: false });
	reconcileProjectIdentity(current, graph);
	assert.equal(current.paperStates![seed.id]?.reading, "to-read");
	assert.equal(current.paperStates![seed.id]?.staged, false);
	assert.equal(Object.keys(current.paperStates!).length, 1);
	reconcileProjectIdentity(current, split);
	assert.equal(current.paperStates![alias.id]?.reading, "to-read", "explicit post-merge reading changes follow both restored records");
	assert.equal(current.paperStates![alias.id]?.excluded, true, "splitting restores the alias's original exclusion state");
	assert.equal(current.currentView?.selectedId, alias.id);
	assert.equal(current.deepDives?.[0]?.parentId, alias.id);
	const grafted = graftNodes(graph, [alias], new Map([[alias.id, ["W999"]]]));
	assert.equal(grafted.nodes.length, 1);
	assert.equal(grafted.referenceLists.get(seed.id)?.length, 52);
	assert.equal(snapshot.nodes.length, 2, "migration must not mutate its input");
}

export async function verifyWorkIdentityPipeline(): Promise<void> {
	const snapshot = nicholsSnapshot(); const [seed, alias] = snapshot.nodes as [PaperNode, PaperNode];
	const toRaw = (paper: PaperNode): RawWork => ({ id: `https://openalex.org/${paper.id}`, doi: paper.doiUrl, display_name: paper.title, publication_year: paper.year ?? undefined, type: paper.workType ?? undefined,
		authorships: paper.authorList.map((name) => ({ author: { display_name: name } })), primary_location: { source: { display_name: paper.venue ?? undefined } },
		biblio: { volume: paper.bibliography?.volume, issue: paper.bibliography?.issue, first_page: paper.bibliography?.firstPage, last_page: paper.bibliography?.lastPage },
		referenced_works: snapshot.referenceLists.find(([id]) => id === paper.id)?.[1], cited_by_count: paper.citedByCount });
	const requested: string[] = [];
	const client = new OpenAlexClient(async (url) => {
		requested.push(url); const query = new URL(url); const filter = query.searchParams.get("filter") ?? "";
		if (query.pathname !== "/works") return toRaw(query.pathname.includes(alias.id) ? alias : seed);
		if (filter.startsWith("openalex:")) return { results: [seed, alias].filter((paper) => filter.includes(paper.id)).map(toRaw) };
		return { results: filter.startsWith("cited_by:") ? [toRaw(alias)] : [], meta: { next_cursor: null } };
	}, { apiKey: "", contactEmail: "" });
	const settings = { ...DEFAULT_SETTINGS, includeReferences: true, includeCitations: false, includeRelated: false, s2Reconcile: false, researchProjects: {} };
	const graph = await loadNeighborhood(client, { kind: "openalex", value: seed.id }, settings);
	assert.equal(graph.nodes.length, 1, "new graph must not select its seed alias as a second node");
	assert.equal(graph.referenceLists.get(seed.id)?.length, 51, "aliases excluded from slots must still have their references fetched");
	assert.ok(requested.some((url) => new URL(url).searchParams.get("filter")?.includes(alias.id)));
	const single = restoreGraphSnapshot({ ...snapshot, nodes: [seed], catalog: [seed], referenceLists: [snapshot.referenceLists[0]!] })!;
	const result = await expandAround(client, single, seed, new Set(), settings, 8);
	assert.equal(result.papers.length, 0);
	assert.equal(result.aliases.length, 1, "deep dive supplements alias records without reporting a new work");
	assert.equal(graftNodes(single, result.aliases, result.lists).referenceLists.get(seed.id)?.length, 51);
	const restored = await restoreGraftedMembers(client, single, [alias.id], settings);
	assert.equal(restored.added, 0, "restoring a deep-dive alias cannot count as a new paper");
	assert.equal(restored.graph.nodes.length, 1);
	const savedProject: ResearchProject = { version: 1, seedId: seed.id, name: "Saved", updatedAt: 1, views: [], snapshot: saveGraphSnapshot(graph) };
	const aliasSeed = await loadNeighborhood(client, { kind: "openalex", value: alias.id }, { ...settings, researchProjects: { [seed.id]: savedProject } });
	assert.equal(aliasSeed.nodes.find((paper) => paper.isSeed)?.id, seed.id, "an embed opened through an alias must retain the saved project's seed ID");
	const split = separateWorkRecords(graph, graph.nodes[0]!);
	const reloadedSplit = await loadNeighborhood(client, { kind: "openalex", value: seed.id }, { ...settings, researchProjects: { [seed.id]: { ...savedProject, snapshot: saveGraphSnapshot(split) } } });
	assert.equal(reloadedSplit.nodes.length, 2, "a saved keep-separate override must survive a remote rebuild");
	let memory: ReadingStatus = "unread";
	let disk: ReadingStatus = "unread";
	let note: ReadingStatus = "unread";
	await assert.rejects(commitPaperReading(
		"read",
		"unread",
		(value) => { memory = value; },
		async () => { disk = memory; },
		async (value) => { if (value === "read") throw new Error("sync"); note = value; },
	));
	assert.equal(memory, "unread");
	assert.equal(disk, "unread");
	assert.equal(note, "unread");
	const layerPaper = (id: string, seed = false): PaperNode => ({
		id, title: id, authors: "A", authorList: ["A"], year: 2020, citedByCount: 1, doiUrl: null,
		openAlexUrl: `https://openalex.org/${id}`, isSeed: seed, origin: seed ? "seed" : "reference", abstract: "",
		concepts: [], language: "en", workType: "article", venue: null, retracted: false,
	});
	const layer: SimilarityGraph = {
		nodes: [layerPaper("W1", true), layerPaper("W2")], edges: [], seedScore: new Map([["W2", 1]]), warnings: [],
		strategies: { references: true, citations: false, related: false }, referenceLists: new Map(),
		catalog: [layerPaper("W1", true), layerPaper("W2")], skippedNonResearch: 0,
	};
	const raw = (id: string, type: string, retracted = false): RawWork => ({
		id: `https://openalex.org/${id}`, display_name: id, publication_year: 2020, type, is_retracted: retracted,
		authorships: [{ author: { display_name: "A" } }],
	});
	const layerClient = {
		referencedBySeed: async () => [raw("W9", "book-review"), raw("W10", "article", true), raw("W11", "article")],
		worksByIds: async () => [],
	} as unknown as OpenAlexClient;
	const filtered = await expandSecondLayer(layerClient, layer, 10, true);
	assert.deepEqual(filtered.graph.nodes.map((node) => node.id).sort(), ["W1", "W11", "W2"]);
	const open = await expandSecondLayer(layerClient, layer, 10, false);
	assert.equal(open.graph.nodes.some((node) => node.id === "W10"), true);
	assert.equal(open.graph.nodes.some((node) => node.id === "W9"), false);
}
