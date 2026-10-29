import { nicholsSnapshot } from "../preview/work-identity-fixture";
import assert from "node:assert/strict";
import { acknowledgeIdentityStates, appendPending, applyEmbedAction, applyNoteReading, admitRetraction, acceptEmbedGraph, assignMergedVersion, choosePending, commitPaperReading, commitProjectGraph, commitSeedSwap, commitSharedReading, confirmVersionReading, chooseDisplayVersion, closePanel, composeMembers, dropDiveBatch, dropManual, editAfterVersionMerge, emptySharedReadings, emptyVersionScope, excludeVersion, excludeWholeWork, expandDisplayVersion, failProjectGraph, followSharedReading, freshMigrationDrill, migrationRereadAccepted, keepManual, mergeExclusion, normalizeProjects, noteReadingConflict, noteVersion, openProjectRequest, openSeedSwap, openSyncRetry, openVersionNote, operationBlocked, previewMigration, presentMembers, projectsForSeedId, publishSharedGraph, readNoteReading, readShared, reconcileProjectIdentity, reopenSyncRetry, reopenEmbed, restoreGraphSnapshot, restoreVersion, resumeEmbed, rejectSeedExclude, retargetProjectSeed, writeProject, savedProjectForSeed, saveGraphSnapshot, saveUndoPoint, selectExportVersions, splitExclusion, splitSharedReading, stageVersion, stepMigrationDrill, stepSyncRetry, switchProjectGraph, syncParticipatingNotes, updateProjectPaperState, undoProject, versionVisible, viewPaper, writeSharedReading, type EmbedAssociation, type EmbedBlock, type MemberSet, type PendingItem, type ProjectUndo, type ReadingStatus, type ResearchProject, type SavedGraphSnapshot, type SeedProject } from "../src/project-state";
import { graftNodes, normalizeWorkGraph, omitSeedExceptionLinks, projectResearchRelations, releaseSeparatedRecords, separateWorkRecords } from "../src/graph-edit";
import { confirmedVersionRelation, holdSourceRelation, paperRecords, paperDois, resolveWorkQuery, sameWork, workIndex } from "../src/work-identity";
import { doiOf, matchLiteratureNote, toBibTeX } from "../src/export-graph";
import { resolvePathEndpoint } from "../src/doi-path";
import { normalizeDoi, shortId } from "../src/paper";
import { CrossrefClient } from "../src/citation-sources";
import { OpenAlexClient, type RawWork } from "../src/openalex";
import { expandAround, expandSecondLayer, loadNeighborhood, restoreGraftedMembers, type SimilarityGraph } from "../src/neighborhood";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import type { PaperNode } from "../src/types";
import { invalidateLiteratureIndex, lookupLiteratureNote, rememberLiteratureNote } from "../src/vault-note";
import { createReadingWorkflow } from "../src/reading-workflow";
import { projectVersionState } from "../src/project-state";


function duplicateSnapshot(): ReturnType<typeof nicholsSnapshot> {
	const snapshot = nicholsSnapshot();
	for (const node of [...snapshot.nodes, ...snapshot.catalog]) node.doiUrl = snapshot.nodes[0]!.doiUrl;
	return snapshot;
}

export function verifyWorkIdentity(): void {
	const unconfirmed = restoreGraphSnapshot(nicholsSnapshot());
	assert.equal(unconfirmed?.nodes.length, 2, "distinct DOI records must not merge from bibliography alone");
	const graph = restoreGraphSnapshot(duplicateSnapshot());
	assert.ok(graph);
	assert.equal(graph.nodes.length, 1, "duplicate DOI records occupy one node");
	assert.equal(graph.referenceLists.get("W4245234602")?.length, 51, "both source reference lists must survive");
	assert.equal(graph.edges.length, 0, "an alias-to-seed edge must not become a self loop");
	const snapshot = duplicateSnapshot();
	const [seed, alias] = snapshot.nodes as [PaperNode, PaperNode];
	assert.equal(sameWork(seed, alias), true);
	assert.equal(sameWork(seed, { ...alias, authorList: [] }), true, "same DOI remains a duplicate despite incomplete metadata");
	assert.equal(sameWork(seed, { ...alias, doiUrl: "10.1234/other", year: 1987 }), false);
	const ambiguous = [seed, { ...alias, bibliography: { ...alias.bibliography, issue: null } }, { ...alias, id: "W3", bibliography: { ...alias.bibliography, issue: "2" } }];
	assert.equal(workIndex(ambiguous).papers.length, 1, "shared DOI is authoritative despite different bibliography");
	assert.equal(resolveWorkQuery(graph.nodes, alias.id), seed.id);
	assert.equal(resolveWorkQuery(graph.nodes, alias.doiUrl!), seed.id);
	assert.equal(paperDois(graph.nodes[0]!).length, 1);
	assert.equal(graph.nodes[0]!.citedByCount, 404, "citation counts from separate records are not summed or maximized");
	const statusGraph = workIndex([{ ...seed, citedByCount: 0, citationCountStatus: "missing" }, { ...alias, citedByCount: 9999, citationCountStatus: "known" }]);
	assert.equal(statusGraph.papers[0]!.citationCountStatus, "missing", "representative cannot borrow another version's citation availability");
	const statusSnapshot = duplicateSnapshot();
	statusSnapshot.nodes[0]!.citationCountStatus = "missing";
	statusSnapshot.nodes[1]!.citationCountStatus = "known";
	const statusRestored = restoreGraphSnapshot(statusSnapshot)!;
	const statusReopened = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(statusRestored))))!;
	assert.equal(statusReopened.nodes[0]!.citationCountStatus, "missing");
	assert.ok(paperRecords(statusReopened.nodes[0]!).some(record => record.citationCountStatus === "known"));
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
	const bibliography = { volume: "12", issue: "3", firstPage: "10", lastPage: "20" };
	const versionA = { ...cited("W1", "https://doi.org/10.1/a"), title: "Shared title", venue: "Nature", bibliography };
	const versionB = { ...cited("W2", "https://doi.org/10.1/b"), title: "Shared title", venue: "Nature", bibliography };
	assert.equal(sameWork(versionA, versionB), false);
	assert.equal(confirmedVersionRelation(versionA, versionB), false);
	assert.equal(confirmedVersionRelation(versionA, { ...versionB, doiUrl: versionA.doiUrl }), true);
	const bibKeys = [...toBibTeX([cited("W1"), cited("W2"), cited("W20202")]).matchAll(/@\w+\{([^,]+),/g)].map((match) => match[1]);
	assert.deepEqual(bibKeys, ["Lovelace2020", "Lovelace20202", "Lovelace20200202"]);
	const legacy: Record<string, ResearchProject> = {
		W1: { version: 1, seedId: "W1", name: "Legacy", updatedAt: 1, views: [] },
		W8: { version: 1, seedId: "W8", name: "Other", updatedAt: 1, views: [] },
	};
	const retargeted = retargetProjectSeed(legacy, "W1", "W9");
	assert.deepEqual(Object.keys(retargeted), ["W1", "W8"]);
	assert.equal(retargeted.W1?.seedId, "W9");
	assert.equal(savedProjectForSeed(retargeted, { kind: "openalex", value: "W9" })?.name, "Legacy");
	assert.equal(savedProjectForSeed(retargeted, { kind: "openalex", value: "W1" }), undefined);
	const shared = retargetProjectSeed(retargeted, "W8", "W9");
	assert.deepEqual(projectsForSeedId(shared, "W9").map((project) => project.name), ["Legacy", "Other"]);
	assert.equal(savedProjectForSeed(shared, { kind: "openalex", value: "W9" }), undefined);
	const moved: Record<string, ResearchProject> = { W1: { version: 1, seedId: "W9", name: "Legacy", updatedAt: 1, views: [] } };
	assert.throws(() => updateProjectPaperState(moved, "W1", cited("W3"), { staged: true }));
	assert.equal(moved.W1?.seedId, "W9");
	assert.equal(moved.W1?.paperStates, undefined);
	updateProjectPaperState(moved, "W9", cited("W3"), { staged: true });
	assert.deepEqual(Object.keys(moved), ["W1"]);
	assert.equal(Object.values(moved)[0]?.paperStates?.W3?.staged, true);
	writeProject(moved, { ...moved.W1!, name: "Renamed" });
	assert.equal(moved.W1?.name, "Renamed");
	assert.equal("W9" in moved, false);
	const sharedSeed = {
		W1: { version: 1 as const, seedId: "W9", name: "Legacy", updatedAt: 1, views: [] },
		W8: { version: 1 as const, seedId: "W9", name: "Other", updatedAt: 1, views: [] },
	};
	assert.throws(() => writeProject(sharedSeed, { version: 1, seedId: "W9", name: "New", updatedAt: 2, views: [] }));
	assert.equal("W9" in sharedSeed, false);
	assert.equal(sharedSeed.W1?.name, "Legacy");
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
	const kept = holdSourceRelation({ status: "missing" }, true);
	const frozen = holdSourceRelation({ status: "conflict", evidence: ["openalex:same", "crossref:different"] }, true);
	const denied = holdSourceRelation({ status: "negated", evidence: ["crossref:not-version-of"] }, true);
	assert.deepEqual(kept, { merged: true, review: "check", evidence: [] });
	assert.deepEqual(frozen, { merged: true, review: "freeze", evidence: ["openalex:same", "crossref:different"] });
	assert.equal(holdSourceRelation({ status: "conflict", evidence: ["openalex:same"] }, false).merged, false);
	assert.deepEqual(denied, { merged: false, review: "split", evidence: ["crossref:not-version-of"] });
	assert.equal(holdSourceRelation({ status: "negated", evidence: ["crossref:not-version-of"] }, false).merged, false);
	let whole = excludeWholeWork(noteVersion(noteVersion(emptyVersionScope(), "a"), "b"));
	whole = restoreVersion(whole, "a");
	const [leftScope, rightScope] = splitExclusion(whole, ["a"], ["b"]);
	assert.equal(leftScope.wholeExcluded && rightScope.wholeExcluded, true);
	assert.equal(versionVisible(leftScope, "a"), true);
	assert.equal(versionVisible(rightScope, "b"), false);
	const visible = noteVersion(emptyVersionScope(), "v4");
	const merged = mergeExclusion("excluded", whole, "visible", visible);
	assert.equal(merged.scope.wholeExcluded, false);
	assert.equal(merged.pending, false);
	assert.equal(versionVisible(merged.scope, "a"), true);
	assert.equal(versionVisible(merged.scope, "b"), false);
	assert.equal(versionVisible(merged.scope, "v4"), true);
	const stuck = mergeExclusion("excluded", whole, "visible", visible, false);
	assert.equal(stuck.pending, true);
	assert.equal(versionVisible(stuck.scope, "v4"), true);
	const followed = assignMergedVersion(merged, "v5", "excluded");
	assert.equal(followed.onGraph, false);
	assert.equal(followed.pending, false);
	assert.equal(versionVisible(followed.merged.scope, "v5"), false);
	const shown = assignMergedVersion(merged, "v6", "visible");
	assert.equal(shown.onGraph, true);
	assert.equal(versionVisible(shown.merged.scope, "v6"), true);
	const unknown = assignMergedVersion(merged, "v7", null);
	assert.equal(unknown.onGraph, false);
	assert.equal(unknown.pending, true);
	assert.equal(unknown.merged.scope.versions.v7, undefined);
	const identity: PendingItem = { id: "rel", kind: "identity", blocks: "merge" };
	const range: PendingItem = { id: "v7", kind: "exclusion-scope", blocks: "show" };
	let pending = appendPending(appendPending([], identity), range);
	pending = appendPending(pending, identity);
	assert.equal(pending.length, 2);
	assert.equal(operationBlocked(pending, "merge"), true);
	assert.equal(operationBlocked(pending, "browse"), false);
	const chosen = choosePending(pending, "rel");
	assert.equal(chosen.removed?.id, "rel");
	assert.equal(operationBlocked(chosen.pending, "merge"), false);
	assert.deepEqual(appendPending(chosen.pending, identity).map((item) => item.id), ["v7", "rel"]);
	let readings = writeSharedReading(emptySharedReadings(), "W1", "read", 2);
	const pane = readShared(readings, "W1");
	const embed = readShared(readings, "W1");
	assert.equal(pane, "read");
	assert.equal(embed, pane);
	readings = writeSharedReading(readings, "W1", "unread", 3);
	assert.equal(readShared(readings, "W1"), "unread");
	assert.equal(readShared(writeSharedReading(readings, "W1", "read", 1), "W1"), "unread");
	const conflicted = noteReadingConflict(emptySharedReadings(), "W1", ["unread", "read"], 1);
	assert.equal(readShared(writeSharedReading(conflicted, "W1", "read", 1), "W1"), null);
	assert.equal(readShared(writeSharedReading(conflicted, "W1", "to-read", 2), "W1"), "to-read");
	const confirmed = confirmVersionReading("W1", "unread", "W2", "read", true);
	assert.equal(confirmed.reading, "read");
	assert.deepEqual(confirmed.backup, { W1: "unread", W2: "read" });
	assert.equal(confirmed.pending, false);
	const heuristic = confirmVersionReading("W1", "unread", "W2", "read", confirmedVersionRelation(versionA, versionB));
	assert.equal(heuristic.reading, null);
	assert.equal(heuristic.backup, null);
	assert.equal(heuristic.pending, true);
	assert.deepEqual(editAfterVersionMerge("read", "unread"), { reading: "unread", pending: false });
	assert.deepEqual(splitSharedReading("to-read"), ["to-read", "to-read"]);
	const echoed = applyNoteReading(readings, "W1", readNoteReading("read", "read"), 9);
	assert.equal(echoed.store, readings);
	assert.equal(echoed.syncing, true);
	const humanEdit = applyNoteReading(readings, "W1", readNoteReading("read", "unread"), 9);
	assert.equal(readShared(humanEdit.store, "W1"), "read");
	assert.equal(humanEdit.syncing, true);
	const removed = applyNoteReading(readings, "W1", readNoteReading(undefined, "unread"), 9);
	assert.equal(removed.syncing, false);
	assert.equal(removed.store, readings);
	const invalid = readNoteReading("done", "unread");
	assert.equal(invalid.kind, "invalid");
	if (invalid.kind === "invalid") assert.equal(invalid.raw, "done");
	assert.equal(applyNoteReading(readings, "W1", invalid, 9).syncing, false);
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
	invalidateLiteratureIndex();
	rememberLiteratureNote(noted, "gone.md", "read");
	assert.equal(lookupLiteratureNote(vault([]), noted, "doi"), null);
	const edited = [{ path: "edited.md", frontmatter: { doi: "10.1234/cache", openalex: "W1", "rc-status": "read" } as Record<string, unknown> }];
	invalidateLiteratureIndex();
	assert.equal(lookupLiteratureNote(vault(edited), noted, "doi")?.reading, "read");
	edited[0]!.frontmatter["rc-status"] = "unread";
	invalidateLiteratureIndex();
	assert.equal(lookupLiteratureNote(vault(edited), noted, "doi")?.reading, "unread");
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
	const released = releaseSeparatedRecords(split, split.workIdentity?.separatedIds ?? []);
	assert.equal(released.nodes.length, 1, "undoing the keep-separate decision restores automatic merge");
	assert.equal(released.workIdentity?.records.length, split.workIdentity?.records.length);
	const third = { ...seed, id: "W3", title: "Other article", isSeed: false, origin: "citation" as const, doiUrl: "https://doi.org/10.1234/third" };
	const input = duplicateSnapshot(); input.nodes.push(third); input.catalog.push(third);
	input.referenceLists.push([third.id, [seed.id, alias.id]]);
	input.coCitationContextIds = [third.id];
	input.citationEvidence = [seed, alias].map((paper) => ({ citingId: third.id, citedId: paper.id, sources: ["openalex"], intents: [], contexts: [paper.id], relation: "unclear", evidenceQuotes: [], confidence: "medium" }));
	const incoming = restoreGraphSnapshot(input)!;
	assert.deepEqual(incoming.referenceLists.get(third.id), [seed.id], "two aliases count as one cited work");
	assert.deepEqual(incoming.citationEvidence?.get(third.id, seed.id)?.contexts.sort(), [alias.id, seed.id].sort());
	const incomingSplit = separateWorkRecords(incoming, incoming.nodes.find((paper) => paper.isSeed)!);
	assert.equal(incomingSplit.citationEvidence?.get(third.id, seed.id)?.contexts.length, 1, "splitting restores source-specific evidence");
	assert.equal(incomingSplit.citationEvidence?.get(third.id, alias.id)?.contexts.length, 1);
	const citingAliases = duplicateSnapshot();
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
	assert.equal(savedProjectForSeed(migrated, { kind: "openalex", value: alias.id }), undefined, "another record id is not this project's concrete seed");
	assert.equal(savedProjectForSeed(migrated, { kind: "doi", value: alias.doiUrl! }), current);
	updateProjectPaperState(migrated, seed.id, alias, { reading: "to-read", staged: false });
	reconcileProjectIdentity(current, graph);
	assert.equal(current.paperStates![seed.id]?.reading, "to-read");
	assert.equal(current.paperStates![seed.id]?.staged, false);
	assert.equal(Object.keys(current.paperStates!).length, 1);
	reconcileProjectIdentity(current, split);
	assert.equal(current.paperStates![alias.id]?.reading, "to-read", "explicit post-merge reading changes follow both restored records");
	assert.equal(projectVersionState(current, alias).excluded, true, "splitting restores the alias's original version exclusion state");
	assert.equal(current.currentView?.selectedId, alias.id);
	assert.equal(current.deepDives?.[0]?.parentId, alias.id);
	const grafted = graftNodes(graph, [alias], new Map([[alias.id, ["W999"]]]));
	assert.equal(grafted.nodes.length, 1);
	assert.equal(grafted.referenceLists.get(seed.id)?.length, 52);
	assert.equal(snapshot.nodes.length, 2, "migration must not mutate its input");
	const representative = cited("W1", "https://doi.org/10.1/a");
	const otherVersion = { ...cited("W2", "https://doi.org/10.1/b"), isSeed: false };
	const single = cited("W3", "https://doi.org/10.1/c");
	const aggregate = { ...representative, records: [representative, otherVersion] };
	const stored = {
		W1: { seedId: "W1", snapshot: { version: 1, seedId: "W1", nodes: [aggregate], excludedIds: ["W1", "W2"] }, paperStates: { W1: { reading: "read", source: "pane" } } },
		W8: { seedId: "W8", snapshot: { version: 2, seedId: "W8", nodes: [single] }, paperStates: { W1: { reading: "unread", source: "embed" }, W3: { reading: "to-read" } } },
	};
	const storedJson = JSON.stringify(stored);
	const preview = previewMigration(stored);
	assert.equal(JSON.stringify(stored), storedJson);
	assert.equal(preview.stopped, false);
	if (!preview.stopped) {
		assert.deepEqual(preview.keys, ["W1", "W8"]);
		assert.equal(preview.readings.W3?.reading, "to-read");
		assert.equal(preview.readings.W1, undefined);
		assert.equal(preview.readings.W2, undefined);
		assert.deepEqual(preview.readingConflicts[0]?.originals.map((item) => item.reading), ["read", "unread"]);
		assert.equal(preview.exclusions.find((item) => item.paperId === "W1")?.pending, true);
		assert.equal(preview.exclusions.find((item) => item.paperId === "W2")?.pending, false);
		assert.equal(preview.exclusions.every((item) => item.whole === false), true);
		assert.equal(operationBlocked(preview.pending, "browse"), false);
		assert.equal(operationBlocked(preview.pending, "show"), true);
	}
	const onlyV2 = previewMigration({ W8: stored.W8 });
	assert.equal(onlyV2.stopped, false);
	if (!onlyV2.stopped) assert.deepEqual(onlyV2.keys, ["W8"]);
	const missingPaper = previewMigration({ W1: { seedId: "W1", snapshot: { version: 1, seedId: "W1", nodes: [single], excludedIds: ["W404"] } } });
	assert.equal(missingPaper.stopped, false);
	if (!missingPaper.stopped) assert.deepEqual(missingPaper.exclusions, [{ projectKey: "W1", paperId: "W404", source: "snapshot", whole: false, pending: false }]);
	assert.equal(previewMigration({ W1: { seedId: "W1", snapshot: { version: 1, seedId: "W1", nodes: [single], excludedIds: ["invalid"] } } }).stopped, true);
	const invalidReading = previewMigration({ W1: { seedId: "W1", paperStates: { W1: { reading: "done" } } } });
	assert.equal(invalidReading.stopped, true);
	const source = { W8: { seedId: "W8", snapshot: { version: 2, seedId: "W8", nodes: [single] } } };
	const v2Preview = previewMigration(source);
	const oldBackup = { W9: { seedId: "W9" } };
	assert.equal(stepMigrationDrill(freshMigrationDrill(source, oldBackup), v2Preview, "save").backup, oldBackup);
	assert.equal(stepMigrationDrill(freshMigrationDrill(source), v2Preview, "save").written, null);
	assert.equal(stepMigrationDrill(freshMigrationDrill(source), v2Preview, "mark").stage, "saved");
	assert.equal(stepMigrationDrill(freshMigrationDrill(source), v2Preview, "reread").stage, "marked");
	const beforeSwitch = stepMigrationDrill(freshMigrationDrill(source), v2Preview, "switch");
	assert.equal(beforeSwitch.stage, "reread");
	assert.equal(beforeSwitch.switched, false);
	const finished = stepMigrationDrill(beforeSwitch, v2Preview, null);
	assert.equal(finished.switched, true);
	assert.equal(migrationRereadAccepted({ version: 2 }, { version: 2 }), true);
	assert.equal(migrationRereadAccepted({ version: 2 }, { version: 1 }), false);
	assert.equal(migrationRereadAccepted({ version: 2 }, null), false);
	assert.equal(finished.backup?.W8?.snapshot?.version, 2);
	assert.equal(stepMigrationDrill(finished, previewMigration({ W1: { seedId: "W1" } }), null), finished);
	source.W8.seedId = "changed";
	assert.equal(finished.backup?.W8?.seedId, "W8");
	const versionOf = (id: string, workType: string | null, year: number | null, extra: Partial<{ excluded: boolean; passesFilter: boolean }> = {}) => ({
		id, title: `title-${id}`, authors: `authors-${id}`, year, workType, excluded: false, passesFilter: true, ...extra,
	});
	assert.equal(chooseDisplayVersion([versionOf("W2", "preprint", 2024), versionOf("W1", "article", 2020), versionOf("W3", "article", 2020, { excluded: true })], null)?.version.id, "W1");
	const picked = chooseDisplayVersion([versionOf("W2", "article", 2020), versionOf("W1", "article", 2020)], null);
	assert.equal(picked?.version.id, "W1");
	assert.equal(picked?.version.title, "title-W1");
	assert.equal(picked?.version.authors, "authors-W1");
	assert.equal(picked?.version.year, 2020);
	assert.equal(chooseDisplayVersion([versionOf("W1", "article", 2019), versionOf("W2", "article", 2021)], null)?.version.id, "W2");
	assert.equal(chooseDisplayVersion([versionOf("W9", "preprint", 2024), versionOf("W8", "article", 2010, { passesFilter: false })], null)?.version.id, "W9");
	assert.equal(chooseDisplayVersion([versionOf("W1", "article", 2020, { excluded: true })], null), null);
	const seedChoice = chooseDisplayVersion([versionOf("W1", "article", 2020), versionOf("W2", "preprint", 1990, { passesFilter: false })], "W2");
	assert.equal(seedChoice?.version.id, "W2");
	assert.equal(seedChoice?.seedException, true);
	assert.equal(seedChoice?.version.year, 1990);
	assert.equal(seedChoice && expandDisplayVersion(seedChoice, "W1")?.title, "title-W1");
	const researchOf = new Map([["P", "R"], ["P2", "R"], ["A2", "A"]]);
	const projection = projectResearchRelations([
		{ citingId: "B", citedId: "P", source: "openalex", year: 2020 },
		{ citingId: "B", citedId: "P2", source: "crossref", year: 2020 },
		{ citingId: "A", citedId: "B", source: "openalex", year: 2021 },
		{ citingId: "B", citedId: "A", source: "openalex", year: 2022 },
		{ citingId: "A", citedId: "A2", source: "openalex", year: 2019 },
		{ citingId: "", citedId: "B", source: "", year: null },
	], new Map([["A", ["P"]], ["A2", ["P2"]], ["B", ["P"]]]), [["P", "P2", "B"], ["P", "B"]], researchOf, "A2");
	assert.equal(projection.edges.length, 2);
	assert.equal(projection.edges.find((edge) => edge.source === "B" && edge.target === "R")?.links.length, 2);
	assert.equal(projection.edges.find((edge) => edge.source === "A" && edge.target === "B")?.direct, "mutual");
	assert.equal(projection.edges.some((edge) => edge.source === edge.target), false);
	assert.equal(projection.selfCitations.length, 1);
	assert.equal(projection.sharedResearchRefs.find((item) => item.a === "A" && item.b === "B")?.shared, 1);
	assert.equal(projection.coCitedBy.find((item) => item.a === "B" && item.b === "R")?.contexts, 2);
	assert.equal(projection.insufficient.length, 1);
	assert.equal(projection.selectedId, "A2");
	assert.equal(projectResearchRelations([], new Map(), [], researchOf, "missing").selectedId, null);
	assert.equal(omitSeedExceptionLinks([{ citingId: "W2", citedId: "W1", source: "openalex", year: 2020 }], new Set(["W2"])).length, 0);
	const retraction = [{ id: "S", retracted: true }, { id: "V", retracted: false }, { id: "X", retracted: true }];
	const blocked = admitRetraction(retraction, "S", false);
	assert.equal(blocked.blockedRebuild, true);
	assert.deepEqual(blocked.visible.map((version) => version.id), ["S", "V", "X"]);
	assert.equal(blocked.confirmedSafe, false);
	const allowed = admitRetraction(retraction, "S", true);
	assert.equal(allowed.blockedRebuild, false);
	assert.deepEqual(allowed.visible.map((version) => version.id), ["S", "V"]);
	assert.deepEqual(allowed.hidden.map((version) => version.id), ["X"]);
	assert.equal(allowed.warning, true);
	assert.equal(admitRetraction([{ id: "V", retracted: false }], null, false).confirmedSafe, false);
	const exportRows = [
		{ ...versionOf("W1", "article", 2020), researchId: "R", seed: false },
		{ ...versionOf("W2", "preprint", 2024), researchId: "R", seed: true, passesFilter: false },
		{ ...versionOf("W3", "article", 2010, { excluded: true }), researchId: "R", seed: false },
	];
	assert.deepEqual(selectExportVersions(exportRows, "one", false).map((version) => version.id), ["W1"]);
	assert.deepEqual(selectExportVersions(exportRows, "one", true).map((version) => version.id).sort(), ["W1", "W2"]);
	assert.deepEqual(selectExportVersions(exportRows, "all", false).map((version) => version.id), ["W1"]);
	assert.deepEqual(selectExportVersions(exportRows, "all", true).map((version) => version.id).sort(), ["W1", "W2"]);
	assert.equal(selectExportVersions(exportRows, "one", true).find((version) => version.id === "W1")?.title, "title-W1");
	let request = { projectKey: "W1", generation: 0, graph: null as string | null, incomplete: false, userState: "unread" };
	const first = openProjectRequest(request);
	const second = openProjectRequest(first.current);
	request = { ...second.current, userState: "read" };
	assert.equal(commitProjectGraph(request, first.generation, "W1", "stale"), request);
	request = commitProjectGraph(request, second.generation, "W1", "fresh");
	assert.equal(request.graph, "fresh");
	assert.equal(request.userState, "read");
	const failed = failProjectGraph(request, second.generation, "W1");
	assert.equal(failed.graph, "fresh");
	assert.equal(failed.incomplete, false);
	const empty = failProjectGraph({ ...request, graph: null, generation: second.generation }, second.generation, "W1");
	assert.equal(empty.graph, null);
	assert.equal(empty.incomplete, true);
	const switched = switchProjectGraph(request, "W8");
	assert.equal(switched.graph, null);
	assert.equal(commitProjectGraph(switched, second.generation, "W1", "late"), switched);
	const panels = [
		{ id: "a", projectKey: "W1", zoom: 1, filter: "", selectedId: "W1" },
		{ id: "b", projectKey: "W1", zoom: 2, filter: "fr", selectedId: "W2" },
		{ id: "c", projectKey: "W8", zoom: 4, filter: "en", selectedId: "W8" },
	];
	const published = publishSharedGraph({ projectKey: "W1", graph: "old", evidence: [] }, panels, "new", ["edge"]);
	assert.equal(published.shared.graph, "new");
	assert.equal(published.shared.projectKey, "W1");
	assert.deepEqual(published.shared.evidence, ["edge"]);
	assert.equal(published.panels[1]?.zoom, 2);
	assert.equal(published.panels[1]?.filter, "fr");
	assert.equal(published.panels[1]?.selectedId, "W2");
	assert.equal(published.panels[2]?.projectKey, "W8");
	assert.equal(published.panels[2]?.zoom, 4);
	const closed = closePanel(published.shared, published.panels, "a");
	assert.equal(closed.shared, published.shared);
	assert.deepEqual(closed.panels.map((panel) => panel.id), ["b", "c"]);
	const members = ["W1"];
	assert.equal(viewPaper(members, "graph", "W9").detailId, "W9");
	assert.deepEqual(viewPaper(members, "outside", "W9").members, ["W1"]);
	assert.equal(viewPaper(members, "outside", "W9").staged, false);
	assert.equal(viewPaper(members, "graph", "W9").addedEdges, 0);
	const missingVersion = openVersionNote(null, ["a.md"], null, false);
	const severalFiles = openVersionNote("W1", ["a.md", "b.md"], null, false);
	const chosenFile = openVersionNote("W1", ["a.md", "b.md"], "b.md", false);
	const oneFile = openVersionNote("W1", ["a.md"], null, false);
	const createdNote = openVersionNote("W1", [], null, true);
	assert.equal("blocked" in missingVersion ? missingVersion.blocked : "", "version");
	assert.equal("blocked" in severalFiles ? severalFiles.blocked : "", "file");
	assert.equal("path" in chosenFile ? chosenFile.path : "", "b.md");
	assert.equal("path" in oneFile ? oneFile.path : "", "a.md");
	assert.equal("created" in createdNote ? createdNote.created : false, true);
	assert.equal("bodyMerged" in createdNote ? createdNote.bodyMerged : true, false);
	const manualKept = keepManual([{ id: "W1", sources: ["sample"], edge: true, reading: "read", staged: true, positive: false }], "W2", false);
	assert.equal(manualKept.find((member) => member.id === "W2")?.edge, false);
	assert.equal(manualKept.find((member) => member.id === "W2")?.positive, false);
	assert.equal(manualKept.find((member) => member.id === "W1")?.reading, "read");
	assert.deepEqual(dropManual(manualKept, "W2").map((member) => member.id), ["W1"]);
	const stillSample = dropManual(keepManual(manualKept, "W1", true), "W1");
	assert.deepEqual(stillSample.find((member) => member.id === "W1")?.sources, ["sample"]);
	const dives: MemberSet = { manual: ["M"], batches: [{ id: "d1", paperIds: ["P"] }, { id: "d2", paperIds: ["P"] }], excluded: [], reading: "to-read", staged: true };
	const oneBatch = dropDiveBatch(dives, "d1");
	assert.deepEqual(presentMembers(oneBatch), ["M", "P"]);
	assert.equal(oneBatch.reading, "to-read");
	assert.equal(oneBatch.staged, true);
	assert.deepEqual(oneBatch.excluded, []);
	assert.deepEqual(presentMembers(oneBatch), presentMembers(oneBatch));
	const composed = composeMembers({
		sample: ["S1", "S2", "S3"], cap: 1, manual: ["M", "Gone"], batches: [{ id: "d1", paperIds: ["D"] }, { id: "old", paperIds: ["Old"] }],
		cancelledManual: ["Gone"], retractedBatchIds: ["old"], excluded: ["S2"], retracted: ["S3"], seedId: "Seed", seedRebuildBlocked: false,
	});
	assert.deepEqual(composed.ids, ["D", "M", "S1", "Seed"]);
	assert.equal(composed.sampleKept, 1);
	assert.equal(composed.keptBeyondCap > 0, true);
	assert.equal(composed.reasons.length, 1);
	const blockedSeed = composeMembers({ sample: ["S1"], cap: 1, manual: [], batches: [], cancelledManual: [], retractedBatchIds: [], excluded: [], retracted: ["Seed"], seedId: "Seed", seedRebuildBlocked: true });
	assert.deepEqual(blockedSeed.ids, ["Seed"]);
	let seedProject: SeedProject<string> = { projectKey: "W1", seedId: "W1", graph: "old", generation: 0, manual: ["M"], reading: "read", zoom: 3, selectedId: "W2" };
	const swapA = openSeedSwap(seedProject);
	const swapB = openSeedSwap(swapA.current);
	seedProject = swapB.current;
	assert.equal(commitSeedSwap(seedProject, swapA.generation, "W9", "late", true).graph, "old");
	assert.equal(commitSeedSwap(seedProject, swapB.generation, "W9", "new", false).graph, "old");
	const swapped = commitSeedSwap(seedProject, swapB.generation, "W9", "new", true);
	assert.equal(swapped.projectKey, "W1");
	assert.equal(swapped.seedId, "W9");
	assert.equal(swapped.graph, "new");
	assert.equal(swapped.reading, "read");
	assert.deepEqual(swapped.manual, ["M"]);
	assert.equal(swapped.zoom, 1);
	assert.equal(swapped.selectedId, null);
	assert.equal(rejectSeedExclude(swapped.seedId, swapped.seedId), true);
	let undo: ProjectUndo<string> = { seedId: "W1", graph: "map", zoom: 2, reading: "unread", staged: false, excludedIds: [], batches: [{ id: "d1", paperIds: ["P"] }], checkpoint: null, generation: 1 };
	undo = saveUndoPoint(undo);
	undo = { ...undo, reading: "read", staged: true, batches: [], excludedIds: ["P"] };
	const refused = undoProject(undo, false);
	assert.equal(refused.undone, false);
	assert.equal(refused.current, undo);
	const undone = undoProject(undo, true);
	assert.equal(undone.undone, true);
	assert.equal(undone.current.graph, "map");
	assert.equal(undone.current.seedId, "W1");
	assert.equal(undone.current.reading, "read");
	assert.equal(undone.current.staged, true);
	assert.deepEqual(undone.current.batches, []);
	assert.deepEqual(undone.current.excludedIds, ["P"]);
	assert.equal(undoProject(undone.current, true).undone, false);
	const paused = undoProject({ ...undo, excludedIds: ["W1"] }, true);
	assert.equal(paused.undone, false);
	assert.equal(paused.current.seedId, "W1");
	assert.equal(commitProjectGraph({ projectKey: "W1", generation: undone.current.generation, graph: undone.current.graph, incomplete: false, userState: "read" }, undo.generation, "W1", "stale").graph, "map");
	const embedProjects = [{ key: "A", seedId: "W1" }, { key: "B", seedId: "W1" }];
	const embedLink: EmbedAssociation = { blockKey: "note#1", projectKey: null };
	const embedBase = { association: embedLink, projects: embedProjects, seedId: "W1", chosenKey: null, createKey: null, persistLink: false, cancel: false, generation: 2, openGeneration: 2, paperId: "P", staged: true, excluded: null };
	const paneChoice = applyEmbedAction(embedBase);
	const embedChoice = applyEmbedAction(embedBase);
	assert.deepEqual(paneChoice, embedChoice);
	assert.equal(paneChoice.status, "needs-choice");
	assert.equal(paneChoice.written, false);
	assert.equal(applyEmbedAction({ ...embedBase, projects: [{ key: "A", seedId: "W1" }] }).status, "needs-choice");
	assert.equal(applyEmbedAction({ ...embedBase, cancel: true, chosenKey: "A" }).written, false);
	assert.equal(applyEmbedAction({ ...embedBase, chosenKey: "A", generation: 1 }).status, "stale");
	const once = applyEmbedAction({ ...embedBase, chosenKey: "A" });
	assert.equal(once.written, true);
	assert.equal(once.projectKey, "A");
	assert.equal(once.association.projectKey, null);
	assert.equal(reopenEmbed(once.association), null);
	const linked = applyEmbedAction({ ...embedBase, chosenKey: "A", persistLink: true, createKey: null });
	assert.equal(linked.association.projectKey, "A");
	assert.equal(reopenEmbed(linked.association), "A");
	const createdProject = applyEmbedAction({ ...embedBase, createKey: "C", projects: embedProjects });
	assert.equal(createdProject.created, true);
	assert.equal(createdProject.association.projectKey, null);
	let embedHold: EmbedBlock<string> = { blockKey: "note#1", seedId: "W1", graph: "block", reading: "unread", projectKey: "A", paused: false, generation: 2 };
	embedHold = followSharedReading(embedHold, { seedId: "W9", graph: "project", reading: "read", excludedIds: [] });
	assert.equal(embedHold.graph, "block");
	assert.equal(embedHold.seedId, "W1");
	assert.equal(embedHold.reading, "read");
	embedHold = followSharedReading(embedHold, { seedId: "W9", graph: "project", reading: "to-read", excludedIds: ["W1"] });
	assert.equal(embedHold.paused, true);
	assert.equal(embedHold.reading, "to-read");
	assert.equal(acceptEmbedGraph(embedHold, 2, "late").graph, "block");
	assert.equal(acceptEmbedGraph({ ...embedHold, paused: false }, 1, "late").graph, "block");
	const restored = resumeEmbed(embedHold, ["W1", "P"], "restore", null);
	assert.equal(restored.block.paused, false);
	assert.deepEqual(restored.excludedIds, ["P"]);
	const unlinked = resumeEmbed(embedHold, ["W1"], "unlink", null);
	assert.equal(unlinked.block.projectKey, null);
	assert.deepEqual(unlinked.excludedIds, ["W1"]);
	const reseeded = resumeEmbed(embedHold, ["W1"], "reseed", "W2");
	assert.equal(reseeded.block.seedId, "W2");
	assert.equal(reseeded.block.paused, false);
	assert.deepEqual(reseeded.excludedIds, ["W1"]);
	const unlinkedBlock = followSharedReading({ ...embedHold, projectKey: null, paused: false }, { seedId: "W1", graph: "project", reading: "read", excludedIds: ["W1"] });
	assert.equal(unlinkedBlock.paused, false);
	assert.equal(unlinkedBlock.graph, "block");
}

export async function verifyWorkIdentityPipeline(): Promise<void> {
	const before = writeSharedReading(emptySharedReadings(), "W1", "unread", 3);
	await assert.rejects(commitSharedReading(before, "W1", "read", 4, async () => { throw new Error("disk"); }));
	assert.equal(readShared(before, "W1"), "unread");
	const calls: string[] = [];
	const synced = await syncParticipatingNotes("read", [
		{ path: "a.md", participating: true, edited: false, write: async () => { calls.push("a"); } },
		{ path: "b.md", participating: true, edited: false, write: async () => { throw new Error("disk"); } },
		{ path: "c.md", participating: true, edited: true, write: async () => { calls.push("c"); } },
		{ path: "d.md", participating: false, edited: false, write: async () => { calls.push("d"); } },
	]);
	assert.equal(synced.reading, "read");
	assert.deepEqual(synced.wrote, ["a.md"]);
	assert.deepEqual(synced.failed, ["b.md"]);
	assert.deepEqual(synced.held, ["c.md"]);
	assert.deepEqual(calls, ["a"]);
	let retry = openSyncRetry(2);
	retry = stepSyncRetry(retry, "failed");
	assert.equal(retry.stopped, false);
	retry = stepSyncRetry(retry, "failed");
	assert.deepEqual(retry, { attempts: 2, limit: 2, stopped: true, paused: false });
	assert.equal(stepSyncRetry(retry, "failed").attempts, 2);
	retry = stepSyncRetry(reopenSyncRetry(retry), "failed");
	assert.equal(retry.attempts, 1);
	assert.equal(retry.stopped, false);
	const paused = stepSyncRetry(openSyncRetry(2), "edited");
	assert.equal(reopenSyncRetry(paused), paused);
	assert.equal(stepSyncRetry(paused, "wrote"), paused);
	const left = stepSyncRetry(openSyncRetry(2), "left");
	assert.equal(left.stopped && left.paused, true);
	assert.equal(stepSyncRetry(left, "wrote"), left);
	const snapshot = duplicateSnapshot(); const [seed, alias] = snapshot.nodes as [PaperNode, PaperNode];
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
	const admissionRaw = (id: string, type = "article", retracted = false): RawWork => ({
		id: `https://openalex.org/${id}`, display_name: id, publication_year: 2020, type, is_retracted: retracted,
		authorships: [{ author: { display_name: "A" } }], cited_by_count: 3, referenced_works: [],
	});
	const admissionById = (id: string): RawWork => id.endsWith("W9") ? admissionRaw("W9", "book-review") : id.endsWith("W10") ? admissionRaw("W10", "article", true) : admissionRaw(id.endsWith("W1") ? "W1" : "W11");
	const admissionClient = new OpenAlexClient(async (url) => {
		const query = new URL(url);
		const filter = query.searchParams.get("filter") ?? "";
		if (query.pathname !== "/works") return admissionById("W1");
		if (filter.startsWith("openalex:")) return { results: filter.slice("openalex:".length).split("|").filter(Boolean).map(admissionById) };
		if (filter.startsWith("cited_by:")) return { results: [admissionById("W9"), admissionById("W10"), admissionById("W11")], meta: { next_cursor: null } };
		return { results: [], meta: { next_cursor: null } };
	}, { apiKey: "", contactEmail: "" });
	const strictAdmission = { ...DEFAULT_SETTINGS, includeReferences: true, includeCitations: false, includeRelated: false, excludeRetracted: true, s2Reconcile: false, maxNodes: 20 };
	const openAdmission = { ...strictAdmission, excludeRetracted: false };
	const idsOf = (nodes: Array<{ id: string }>): string[] => nodes.map((node) => node.id).sort();
	const strictLoad = await loadNeighborhood(admissionClient, { kind: "openalex", value: "W1" }, strictAdmission);
	assert.deepEqual(idsOf(strictLoad.nodes), ["W1", "W11"], "first load drops book reviews and retracted works");
	const openLoad = await loadNeighborhood(admissionClient, { kind: "openalex", value: "W1" }, openAdmission);
	assert.deepEqual(idsOf(openLoad.nodes), ["W1", "W10", "W11"], "turning retraction exclusion off still drops book reviews");
	const seedOnly: SimilarityGraph = {
		...layer, nodes: [layerPaper("W1", true)], catalog: [layerPaper("W1", true)], seedScore: new Map(),
	};
	const dived = await expandAround(admissionClient, seedOnly, seedOnly.nodes[0]!, new Set(), strictAdmission, 8);
	assert.deepEqual(dived.papers.map((paper) => paper.id).sort(), ["W11"], "deep dive uses the same admission");
	const divedOpen = await expandAround(admissionClient, seedOnly, seedOnly.nodes[0]!, new Set(), openAdmission, 8);
	assert.deepEqual(divedOpen.papers.map((paper) => paper.id).sort(), ["W10", "W11"]);
	const restoredStrict = await restoreGraftedMembers(admissionClient, seedOnly, ["W9", "W10", "W11"], strictAdmission);
	assert.deepEqual(idsOf(restoredStrict.graph.nodes), ["W1", "W11"], "restoring a deep dive drops the same records");
	const restoredOpen = await restoreGraftedMembers(admissionClient, seedOnly, ["W9", "W10", "W11"], openAdmission);
	assert.deepEqual(idsOf(restoredOpen.graph.nodes), ["W1", "W10", "W11"]);
	let attempts = 0;
	const crossref = new CrossrefClient(async () => {
		attempts += 1;
		if (attempts === 1) throw new Error("temporary");
		return { message: { DOI: "10.1000/s04-retry" } };
	}, "");
	await assert.rejects(() => crossref.work("10.1000/s04-retry"));
	assert.equal((await crossref.work("10.1000/s04-retry"))?.DOI, "10.1000/s04-retry");
	assert.equal((await crossref.work("10.1000/s04-retry"))?.DOI, "10.1000/s04-retry");
	assert.equal(attempts, 2);
	const paper = { id: "W3", title: "W3", authors: "A", authorList: ["A"], year: 2020, citedByCount: 1, doiUrl: null, openAlexUrl: "https://openalex.org/W3", isSeed: false, origin: "reference" as const, abstract: "", concepts: [], language: "en", workType: "article", venue: null, retracted: false };
	const workflowSettings = { ...DEFAULT_SETTINGS, researchProjects: {}, readingWorkflow: undefined };
	let notes = [{ path: "old.md", raw: "read", revision: "1:1" }];
	const writes: string[] = [];
	const workflow = createReadingWorkflow({
		getSettings: () => workflowSettings,
		persist: async () => undefined,
		listNotes: () => notes,
		writeNote: async (path, _expected, reading) => {
			writes.push(path);
			notes = notes.map((note) => note.path === path ? { ...note, raw: reading, revision: "9:9" } : note);
			return "9:9";
		},
	});
	await workflow.commitWorkflow(paper, null, { reading: "read" });
	notes = [{ path: "new.md", raw: "read", revision: "2:2" }];
	await workflow.refreshReading();
	assert.deepEqual(writes, [], "renaming a note does not write the old path");
	assert.equal(workflow.getReadingIssues().length, 0);
	notes = [{ path: "new.md", raw: "to-read", revision: "3:3" }];
	await workflow.refreshReading();
	assert.deepEqual(writes, [], "an external edit stays pending");
	assert.equal(workflow.getReadingIssues().length, 1);
	await workflow.resolveReading(paper, "read");
	assert.deepEqual(writes, ["new.md"]);
	assert.equal(workflow.getReadingIssues().length, 0);
	writes.length = 0;
	await workflow.refreshReading();
	assert.deepEqual(writes, [], "refreshing after confirmation does not write again");
	assert.equal(workflow.getReadingIssues().length, 0);
}
