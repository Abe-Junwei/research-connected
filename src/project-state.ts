import { tr } from "./i18n";
import { CitationEvidenceStore, type CitationEvidence } from "./citation-evidence";
import { normalizeDoi, shortId } from "./paper";
import { applyWorkIdentityDecisions, graftNodes, normalizeWorkGraph, omitNode, projectResearchRelations, refreshDerived } from "./graph-edit";
import type { ConnectedPapersSettings } from "./settings-model";
import type { WorkIdentityDecision } from "./work-identity";
import { confirmedVersionRelation, paperHasId, paperRecords, validSourceVersionRelations, type SourceVersionRelation, type WorkIdentity } from "./work-identity";
import type { SimilarityGraph } from "./neighborhood";
import { nodeMatchesFilter, type GraphFilter } from "./graph-filter";
import type { PaperNode, GraphEdge } from "./types";

export interface SavedGraphSnapshot {
	version: 1 | 2;
	workIdentity?: WorkIdentity;
	savedAt: number;
	seedId: string;
	nodes: PaperNode[];
	edges: GraphEdge[];
	seedScore: Array<[string, number]>;
	warnings: SimilarityGraph["warnings"];
	strategies: SimilarityGraph["strategies"];
	referenceLists: Array<[string, string[]]>;
	coCitationContextIds?: string[];
	rawReferenceLists?: Array<[string, NonNullable<SimilarityGraph["rawReferenceLists"]> extends ReadonlyMap<string, infer T> ? T : never]>;
	catalog: PaperNode[];
	citationEvidence: CitationEvidence[];
	skippedNonResearch: number;
	skippedRetracted?: number;
	retrievalStats?: SimilarityGraph["retrievalStats"];
	candidateAudit?: SimilarityGraph["candidateAudit"];
	excludedIds?: SimilarityGraph["excludedIds"];
	crossCheck?: Array<[string, NonNullable<SimilarityGraph["crossCheck"]> extends ReadonlyMap<string, infer T> ? T : never]>;
	semanticScores?: Array<[string, number | null]>;
	semanticMode?: SimilarityGraph["semanticMode"];
	semanticModel?: string | null;
	semanticVectorIds?: SimilarityGraph["semanticVectorIds"];
	enhancement?: SimilarityGraph["enhancement"];
	selectionRank?: Array<[string, NonNullable<SimilarityGraph["selectionRank"]> extends ReadonlyMap<string, infer T> ? T : never]>;
}

export interface SavedView {
	name: string;
	layout: "force2d" | "temporal" | "radial";
	selectedId: string | null;
	scrubYear: number | null;
	zoom: number;
	centerX: number;
	centerY: number;
	updatedAt: number;
	filter?: GraphFilter;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
}

export type ReadingStatus = "unread" | "to-read" | "read";

export interface ProjectPaperState {
	paper: PaperNode;
	reading: ReadingStatus;
	staged: boolean;
	excluded: boolean;
	source: string;
	updatedAt: number;
	fieldUpdatedAt?: Partial<Record<"reading" | "staged" | "excluded", number>>;
}

export interface DeepDiveAddition {
	paperId: string;
	source: "reference" | "citation" | "shared-reference" | "legacy";
}

export interface DeepDiveBatch {
	id: string;
	parentId: string;
	createdAt: number;
	references: number;
	citations: number;
	additions: DeepDiveAddition[];
	noMore: boolean;
	warnings: string[];
}

export interface ResearchProject {
	version: 1;
	seedId: string;
	name: string;
	updatedAt: number;
	snapshot?: SavedGraphSnapshot;
	currentView?: SavedView;
	views: SavedView[];
	deepDives?: DeepDiveBatch[];
	sampleIds?: string[];
	manualPapers?: PaperNode[];
	retractedBatchIds?: string[];
	paperStates?: Record<string, ProjectPaperState>;
	versionStates?: Record<string, ProjectPaperState>;
	exclusionScopes?: Array<{ ids: string[]; scope: VersionScope }>;
	pending?: Array<PendingItem & { paper?: PaperNode; sources?: string[]; raw?: unknown }>;
	identityOriginalStates?: Record<string, ProjectPaperState>;
	identityConflicts?: string[];
	identityReviewedGroups?: string[];
	identityOriginalDeepDives?: DeepDiveBatch[];
	identityOriginalViews?: SavedView[];
	identityOriginalCurrentView?: SavedView;
}

/** Global manual decisions update every saved projection in the same persisted settings snapshot. */
export async function commitWorkIdentityDecision(settings: ConnectedPapersSettings, decision: Omit<WorkIdentityDecision, "kind"> & { kind: "merge" | "separate" | "clear" }, persist: () => Promise<void> | void): Promise<void> {
	if (decision.ids.length < 2 || decision.ids.some(id => !/^W\d+$/i.test(id))) throw new Error(tr("请至少选择两条有效的版本记录", "Choose at least two valid version records"));
	const before = settings.workIdentityDecisions;
	const beforeReading = settings.readingWorkflow;
	const projects = settings.researchProjects;
	const decisions: WorkIdentityDecision[] = [...(before ?? []).filter(item => !item.ids.some(id => decision.ids.includes(id))), ...(decision.kind === "clear" ? [] : [{ ...decision, kind: decision.kind }])];
	const next = structuredClone(projects);
	for (const project of Object.values(next)) {
		const graph = restoreGraphSnapshot(project.snapshot);
		if (!graph) continue;
		if (graph.workIdentity) {
			graph.workIdentity.separatedIds = graph.workIdentity.separatedIds.filter(id => !decision.ids.includes(id));
			graph.workIdentity.confirmedGroups = graph.workIdentity.confirmedGroups?.filter(group => !group.some(id => decision.ids.includes(id)));
			graph.nodes = graph.nodes.map(paper => ({ ...paper, recordsSeparated: false }));
			graph.catalog = graph.catalog.map(paper => ({ ...paper, recordsSeparated: false }));
		}
		const projected = applyWorkIdentityDecisions(graph, decisions, settings.sourceVersionRelations);
		reconcileExclusionScopes(project, projected, decision.ids);
		reconcileProjectIdentity(project, projected);
		project.pending = project.pending?.filter(item => item.kind !== "identity" || !item.paper || !paperRecords(item.paper).some(record => decision.ids.includes(record.id)));
		project.snapshot = saveGraphSnapshot(projected);
	}
	settings.workIdentityDecisions = decisions;
	settings.researchProjects = next;
	if (decision.kind !== "merge") splitReadingRecords(settings, decision.ids);
	const nextReading = settings.readingWorkflow;
	try { await persist(); }
	catch (error) { if (settings.workIdentityDecisions === decisions) settings.workIdentityDecisions = before; if (settings.researchProjects === next) settings.researchProjects = projects; if (settings.readingWorkflow === nextReading) settings.readingWorkflow = beforeReading; throw error; }
}

/** Publish source facts and all affected saved projections as one save; manual choices remain dominant. */
export async function commitSourceVersionRelations(settings: ConnectedPapersSettings, reports: readonly SourceVersionRelation[], persist: () => Promise<void> | void, papers: readonly PaperNode[] = []): Promise<void> {
	if (!validSourceVersionRelations(reports)) throw new Error(tr("来源版本报告无效，已保留原数据", "Invalid source version report; original data retained"));
	const before = settings.sourceVersionRelations, projects = settings.researchProjects, beforeReading = settings.readingWorkflow;
	const rows = new Map((before ?? []).map(row => [row.ids.slice().sort().join("|"), row]));
	const changed: SourceVersionRelation[] = [];
	for (const report of reports) {
		const key = report.ids.slice().sort().join("|"), prior = rows.get(key);
		if (prior && (report.updatedAt < prior.updatedAt || report.status === prior.status && JSON.stringify(report.evidence) === JSON.stringify(prior.evidence))) continue;
		const next = { ...report, linked: report.status === "confirmed" || report.status !== "negated" && Boolean(prior?.linked), previousEvidence: [...new Set([...(prior?.previousEvidence ?? []), ...(prior?.evidence ?? []), ...(report.previousEvidence ?? [])])] };
		rows.set(key, next); changed.push(next);
	}
	if (!changed.length) return;
	const relations = [...rows.values()], next = structuredClone(projects);
	const catalog = [...papers.flatMap(paperRecords), ...Object.values(projects).flatMap(project => project.snapshot?.workIdentity?.records ?? project.snapshot?.catalog.flatMap(paperRecords) ?? [])];
	for (const project of Object.values(next)) {
		const graph = restoreGraphSnapshot(project.snapshot);
		if (!graph) continue;
		const records = graph.workIdentity?.records ?? graph.catalog.flatMap(paperRecords);
		for (const report of changed) {
			if (!records.some(record => report.ids.includes(record.id))) continue;
			const versions = [...new Map(catalog.filter(record => report.ids.includes(record.id)).map(record => [record.id, record])).values()];
			const id = `source:${report.ids.slice().sort().join("|")}`;
			const manual = settings.workIdentityDecisions?.find(decision => report.ids.every(id => decision.ids.includes(id)));
			project.pending = project.pending?.filter(item => item.id !== id);
			if (report.status !== "confirmed" || manual?.kind === "separate") project.pending = [...(project.pending ?? []), { id, kind: "identity", blocks: `identity:${report.ids.join("|")}`, paper: { ...versions[0]!, records: versions }, sources: [report.source], raw: report }];
		}
		const projected = applyWorkIdentityDecisions(graph, settings.workIdentityDecisions, relations);
		reconcileExclusionScopes(project, projected, changed.flatMap(report => report.ids));
		reconcileProjectIdentity(project, projected);
		projectVersionGraph(projected, project);
		project.snapshot = saveGraphSnapshot(projected);
	}
	settings.sourceVersionRelations = relations;
	settings.researchProjects = next;
	const splitIds = changed.filter(report => report.status === "negated" && !settings.workIdentityDecisions?.some(decision => decision.kind === "merge" && report.ids.every(id => decision.ids.includes(id)))).flatMap(report => report.ids);
	if (splitIds.length) splitReadingRecords(settings, splitIds);
	const nextReading = settings.readingWorkflow;
	try { await persist(); }
	catch (error) { if (settings.sourceVersionRelations === relations) settings.sourceVersionRelations = before; if (settings.researchProjects === next) settings.researchProjects = projects; if (settings.readingWorkflow === nextReading) settings.readingWorkflow = beforeReading; throw error; }
}

function splitReadingRecords(settings: ConnectedPapersSettings, ids: readonly string[]): void {
	if (!settings.readingWorkflow) return;
	const readings = structuredClone(settings.readingWorkflow);
	for (const [key, record] of Object.entries(readings.records)) {
		const versions = paperRecords(record.paper);
		if (versions.length < 2 || !versions.some(version => ids.includes(version.id))) continue;
		delete readings.records[key];
		for (const paper of versions) readings.records[paper.id] = { ...structuredClone(record), paper };
	}
	settings.readingWorkflow = readings;
}

function reconcileExclusionScopes(project: ResearchProject, projected: SimilarityGraph, ids: readonly string[]): void {
	project.versionStates ??= structuredClone(project.paperStates ?? {});
	const known = new Set((project.snapshot?.workIdentity?.records ?? project.snapshot?.catalog.flatMap(paperRecords) ?? []).map(record => record.id));
	const scopes = project.exclusionScopes ?? [];
	const affected = projected.catalog.filter(paper => paperRecords(paper).some(record => ids.includes(record.id)));
	project.exclusionScopes = scopes.filter(entry => !entry.ids.some(id => ids.includes(id)));
	for (const paper of affected) {
		const versions = paperRecords(paper);
		const inherited = versions.map(version => scopes.find(entry => entry.ids.includes(version.id)));
		if (!inherited.some(Boolean)) continue;
		const rules = [...new Map(inherited.flatMap(entry => entry ? entry.scope.wholeExcluded ? [entry.ids] : entry.scope.wholeRules ?? [] : []).map(ids => [ids.slice().sort().join("|"), ids])).values()];
		const wholeExcluded = versions.every(version => rules.some(ids => ids.includes(version.id)));
		const scope: VersionScope = { wholeExcluded, versions: {}, wholeRules: rules, ambiguousNewVersions: !wholeExcluded && rules.length > 0 };
		for (const version of versions) {
			const prior = scopes.find(entry => entry.ids.includes(version.id));
			if (scope.ambiguousNewVersions && !prior && !known.has(version.id)) continue;
			const state = projectVersionState({ ...project, exclusionScopes: scopes }, version);
			scope.versions[version.id] = prior ? { ...flags(prior.scope, version.id) } : { excluded: state.excluded, staged: state.staged, restored: false };
		}
		project.exclusionScopes.push({ ids: versions.map(version => version.id), scope });
	}
}

export function savedProjectForSeed(
	projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string },
): ResearchProject | undefined {
	const matches = matchingSeedProjects(projects, target);
	return matches.length === 1 ? matches[0] : undefined;
}

export function matchingSeedProjects(projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string }): ResearchProject[] {
	return Object.values(projects).filter((project) => {
		if (target.kind === "openalex") return project.seedId === shortId(target.value);
		const snapshot = restoreGraphSnapshot(project.snapshot);
		return snapshot && snapshot.nodes.some((paper) => paper.isSeed && normalizeDoi(paper.doiUrl) === normalizeDoi(target.value));
	});
}

export function reconcileProjectIdentity(project: ResearchProject, graph: SimilarityGraph): void {
	if (!graph.workIdentity) return;
	const ids = new Map(graph.workIdentity.canonicalIds);
	const resolve = (id: string): string => ids.get(id) ?? id;
	const papers = new Map(graph.catalog.map((paper) => [paper.id, paper]));
	const original = project.identityOriginalStates ?? { ...project.paperStates };
	const grouped = new Map<string, ProjectPaperState[]>();
	for (const state of [...Object.values(original), ...Object.values(project.paperStates ?? {})]) {
		const targets = new Set(paperRecords(state.paper).map((record) => resolve(record.id)));
		for (const id of targets) {
			let value = state;
			if (targets.size > 1) {
				const base = original[id] ?? { paper: papers.get(id) ?? state.paper, reading: "unread" as const, staged: false, excluded: false, source: state.source, updatedAt: 0 };
				value = { ...base, fieldUpdatedAt: { ...base.fieldUpdatedAt } };
				for (const field of ["reading", "staged", "excluded"] as const) {
					const originalTime = Math.max(0, ...paperRecords(state.paper).map((record) => original[record.id]?.fieldUpdatedAt?.[field] ?? original[record.id]?.updatedAt ?? 0));
					if ((state.fieldUpdatedAt?.[field] ?? 0) > originalTime) { Object.assign(value, { [field]: state[field] }); value.fieldUpdatedAt![field] = state.fieldUpdatedAt![field]; }
				}
			}
			const rows = grouped.get(id) ?? []; rows.push(value); grouped.set(id, rows);
		}
	}
	const states: Record<string, ProjectPaperState> = {};
	const conflicts = new Set(project.identityConflicts ?? []);
	for (const [id, rows] of grouped) {
		const recent = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.paper.id.localeCompare(b.paper.id))[0]!;
		const next = { ...recent, paper: papers.get(id) ?? recent.paper, fieldUpdatedAt: { ...recent.fieldUpdatedAt } };
		for (const field of ["reading", "staged", "excluded"] as const) {
			const ordered = [...rows].sort((a, b) => (b.fieldUpdatedAt?.[field] ?? b.updatedAt) - (a.fieldUpdatedAt?.[field] ?? a.updatedAt) || a.paper.id.localeCompare(b.paper.id));
			const winner = ordered[0]!;
			Object.assign(next, { [field]: winner[field] });
			next.fieldUpdatedAt[field] = winner.fieldUpdatedAt?.[field] ?? winner.updatedAt;
			const groupKey = paperRecords(next.paper).map((record) => record.id).sort().join("|");
			if (new Set(rows.map((row) => row[field])).size > 1 && rows.some((row) => !row.fieldUpdatedAt) && !project.identityReviewedGroups?.includes(groupKey)) conflicts.add(id);
		}
		if (next.paper.isSeed) next.excluded = false;
		states[id] = next;
	}
	if (JSON.stringify(states) !== JSON.stringify(project.paperStates ?? {})) project.paperStates = states;
	project.identityOriginalStates = original;
	project.identityConflicts = [...conflicts];
	project.identityOriginalCurrentView ??= project.currentView;
	project.identityOriginalViews ??= project.views;
	const remapView = (view: SavedView, before?: SavedView): SavedView => {
		const selectedId = before?.updatedAt === view.updatedAt ? before.selectedId : view.selectedId;
		return { ...view, selectedId: selectedId ? resolve(selectedId) : null };
	};
	if (project.currentView) project.currentView = remapView(project.currentView, project.identityOriginalCurrentView);
	project.views = project.views.map((view) => remapView(view, project.identityOriginalViews?.find((before) => before.name === view.name)));
	const sourceBatches = new Map((project.identityOriginalDeepDives ?? []).map((batch) => [batch.id, batch]));
	for (const batch of project.deepDives ?? []) if (!sourceBatches.has(batch.id)) sourceBatches.set(batch.id, batch);
	project.identityOriginalDeepDives = [...sourceBatches.values()];
	const batches = project.deepDives?.map((batch) => {
		const source = sourceBatches.get(batch.id) ?? batch;
		return { ...batch, parentId: resolve(source.parentId), additions: [...new Map(source.additions.map((addition) => [resolve(addition.paperId), { ...addition, paperId: resolve(addition.paperId) }])).values()] };
	});
	if (JSON.stringify(batches) !== JSON.stringify(project.deepDives)) project.deepDives = batches;
}

export function acknowledgeIdentityStates(project: ResearchProject, paper: PaperNode): void {
	project.identityReviewedGroups = [...new Set([...(project.identityReviewedGroups ?? []), paperRecords(paper).map((record) => record.id).sort().join("|")])];
	project.identityConflicts = project.identityConflicts?.filter((id) => id !== paper.id);
}

/** Storage key stays put when the seed field changes. Not used by loadSettings until S39. */
export function retargetProjectSeed(
	projects: Record<string, ResearchProject>,
	key: string,
	nextSeedId: string,
): Record<string, ResearchProject> {
	const stored = projects[key];
	const seedId = nextSeedId.toUpperCase();
	if (!stored || stored.seedId === seedId || !/^W\d+$/.test(seedId)) return projects;
	return { ...projects, [key]: { ...stored, seedId } };
}

/** Every project whose seed field matches. Does not pick one when several share a seed. */
export function projectsForSeedId(projects: Record<string, ResearchProject>, seedId: string): ResearchProject[] {
	const id = seedId.toUpperCase();
	return Object.values(projects).filter((project) => project.seedId.toUpperCase() === id);
}

/** The one project with this seed field. Several matches yield nothing. */
export function projectForSeed(projects: Record<string, ResearchProject>, seedId: string): ResearchProject | undefined {
	const matches = projectsForSeedId(projects, seedId);
	return matches.length === 1 ? matches[0] : undefined;
}

/** Storage key for a seed. A moved seed still writes to its old key. An occupied key or several owners stop the write. */
export function projectWriteKey(projects: Record<string, ResearchProject>, seedId: string): string {
	const id = seedId.toUpperCase();
	if (!/^W\d+$/.test(id)) throw new Error(tr("起点编号无效，已停止写入", "The seed id is invalid, so the write was stopped."));
	const matches = Object.entries(projects).filter(([, project]) => project.seedId.toUpperCase() === id);
	if (matches.length > 1) throw new Error(tr("同一起点对应多个项目，已停止写入", "Several projects share this seed, so the write was stopped."));
	if (matches.length === 1) return matches[0]![0];
	if (projects[id] && projects[id].seedId.toUpperCase() !== id) throw new Error(tr("该位置保存着另一个起点，已停止写入", "That key stores a different seed, so the write was stopped."));
	return id;
}

export function writeProject(projects: Record<string, ResearchProject>, project: ResearchProject): void {
	projects[projectWriteKey(projects, project.seedId)] = project;
}

export interface VersionFlags {
	excluded: boolean;
	staged: boolean;
	/** Restored out of a whole-work exclusion. Cleared when this version is excluded again. */
	restored: boolean;
}

/** Sample rules for per-version exclusion. Not written through settings until S39. */
export interface VersionScope {
	wholeExcluded: boolean;
	versions: Record<string, VersionFlags>;
	/** A mixed-side merge cannot attribute an unseen version to either old whole-work rule. */
	ambiguousNewVersions?: boolean;
	/** Original sides retain their whole-work intent across merge and split. */
	wholeRules?: string[][];
}

export function projectVersionState(project: ResearchProject | undefined, paper: PaperNode): ProjectPaperState {
	const state = (project?.versionStates ?? project?.paperStates)?.[paper.id] ?? { paper, reading: "unread" as const, staged: false, excluded: false, source: "OpenAlex", updatedAt: 0 };
	const scope = project?.exclusionScopes?.find(entry => entry.ids.includes(paper.id));
	return scope ? { ...state, excluded: !versionVisible(scope.scope, paper.id) } : state;
}

export async function resolveProjectPending(settings: ConnectedPapersSettings, key: string, pendingId: string, choice: "merge" | "separate" | "version" | "whole" | "visible", persist: () => Promise<void> | void): Promise<void> {
	const original = settings.researchProjects[key];
	const pending = original?.pending?.find(item => item.id === pendingId);
	if (!original || !pending?.paper) throw new Error(tr("待处理项缺少来源记录，已保留原数据", "Pending item has no source record; original data retained"));
	if (choice === "merge" || choice === "separate") {
		await commitWorkIdentityDecision(settings, { ids: paperRecords(pending.paper).map(record => record.id), kind: choice, source: "manual", updatedAt: Date.now() }, persist);
		return;
	}
	const updated = structuredClone(original);
	changeVersionExclusion(updated, { ...pending.paper, records: undefined }, choice !== "visible", choice === "whole", pending.paper);
	updated.pending = updated.pending?.filter(item => item.id !== pendingId);
	const graph = restoreGraphSnapshot(updated.snapshot);
	if (graph) updated.snapshot = saveGraphSnapshot(projectVersionGraph(graph, updated));
	settings.researchProjects[key] = updated;
	try { await persist(); }
	catch (error) { if (settings.researchProjects[key] === updated) settings.researchProjects[key] = original; throw error; }
}

export function changeVersionExclusion(project: ResearchProject, paper: PaperNode, excluded: boolean, whole: boolean, research: PaperNode = paper): void {
	const ids = paperRecords(research).map(version => version.id);
	if (excluded && (paper.id === project.seedId || whole && ids.includes(project.seedId))) throw new Error(tr("不能排除项目的起点论文", "The project seed cannot be excluded"));
	const scopes = [...(project.exclusionScopes ?? [])];
	const at = scopes.findIndex(entry => entry.ids.some(id => ids.includes(id)));
	let scope = at < 0 ? emptyVersionScope() : scopes[at]!.scope;
	for (const id of ids) scope = noteVersion(scope, id);
	if (whole && excluded) scope = excludeWholeWork(scope);
	else scope = excluded ? excludeVersion(scope, paper.id) : restoreVersion(scope, paper.id);
	const entry = { ids: [...new Set([...(at < 0 ? [] : scopes[at]!.ids), ...ids])], scope };
	if (at < 0) scopes.push(entry); else scopes[at] = entry;
	project.exclusionScopes = scopes;
	project.versionStates ??= { ...project.paperStates };
	for (const version of whole ? paperRecords(research) : [paper]) {
		const state = projectVersionState(project, version);
		project.versionStates[version.id] = { ...state, paper: { ...version }, excluded, updatedAt: Date.now() };
	}
}

export function projectVersionNode(node: PaperNode, project: ResearchProject | undefined, filter?: GraphFilter): PaperNode | null {
	const versions = paperRecords(node);
	const candidates = versions.map(version => ({ ...version, excluded: projectVersionState(project, version).excluded || Boolean(project?.pending?.some(item => item.kind === "exclusion-scope" && item.paper && paperHasId(item.paper, version.id))), passesFilter: !filter || nodeMatchesFilter(version, filter) }));
	const choice = chooseDisplayVersion(candidates, versions.find(version => version.isSeed)?.id ?? null);
	if (!choice) return null;
	const shown = versions.find(version => version.id === choice.version.id)!;
	return { ...shown, id: node.id, isSeed: node.isSeed, ...(node.records ? { records: node.records } : {}) };
}

export function projectVersionGraph(graph: SimilarityGraph, project: ResearchProject | undefined, filter?: GraphFilter): SimilarityGraph {
	const admitted = new Set<string>();
	const records = graph.workIdentity?.records ?? graph.catalog.flatMap(paperRecords);
	const known = new Set(records.map(record => record.id));
	for (const node of graph.nodes) {
		const versions = paperRecords(node);
		for (const entry of project?.exclusionScopes ?? []) if (versions.some(version => entry.ids.includes(version.id))) {
			for (const version of versions) {
				if (entry.scope.versions[version.id]) continue;
				const sibling = versions.find(other => entry.scope.versions[other.id] && confirmedVersionRelation(version, other));
				const origins = versions.filter(other => entry.scope.versions[other.id] && graph.workIdentity?.sourceRelations?.some(relation => relation.linked && relation.ids.includes(version.id) && relation.ids.includes(other.id)));
				const intents = [...new Set(origins.map(other => entry.scope.wholeExcluded || Boolean(entry.scope.wholeRules?.some(ids => ids.includes(other.id)))))];
				if (!entry.ids.includes(version.id)) entry.ids.push(version.id);
				if (entry.scope.ambiguousNewVersions && !sibling && intents.length !== 1) {
					const id = `scope:${version.id}`;
					if (!project!.pending?.some(item => item.id === id)) project!.pending = [...(project!.pending ?? []), { id, kind: "exclusion-scope", blocks: `version:${version.id}`, paper: { ...version }, sources: ["merged exclusion scopes"], raw: structuredClone(entry.scope) }];
				} else if (sibling) entry.scope = put(entry.scope, version.id, { ...flags(entry.scope, sibling.id) });
				else if (intents.length === 1) {
					entry.scope = put(entry.scope, version.id, { excluded: intents[0]!, staged: false, restored: false });
					entry.scope.wholeRules = entry.scope.wholeRules?.map(ids => origins.some(other => ids.includes(other.id)) ? [...new Set([...ids, version.id])] : ids);
				} else entry.scope = noteVersion(entry.scope, version.id);
			}
		}
	}
	const scopePending = (id: string): boolean => Boolean(project?.pending?.some(item => item.kind === "exclusion-scope" && item.paper && paperHasId(item.paper, id)));
	for (const record of records) if (!scopePending(record.id) && !projectVersionState(project, record).excluded && (!filter || nodeMatchesFilter(record, filter))) admitted.add(record.id);
	const nodes = graph.nodes.flatMap(node => {
		for (const version of paperRecords(node)) if (!scopePending(version.id) && !projectVersionState(project, version).excluded && (!filter || nodeMatchesFilter(version, filter))) admitted.add(version.id);
		const shown = projectVersionNode(node, project, filter);
		return shown ? [shown] : [];
	});
	const visible = new Set(nodes.map(node => node.id));
	const seedException = new Set(graph.nodes.filter(node => node.isSeed && !paperRecords(node).some(version => admitted.has(version.id))).map(node => node.id));
	const identity = new Map(graph.workIdentity?.canonicalIds ?? []);
	const rawLists = new Map((graph.workIdentity?.referenceLists ?? [...graph.referenceLists]).filter(([id]) => !known.has(id) || admitted.has(id)).map(([id, refs]) => [id, refs.filter(ref => !known.has(ref) || admitted.has(ref))]));
	const referenceLists = new Map<string, string[]>();
	for (const [id, refs] of rawLists) { const key = identity.get(id) ?? id; referenceLists.set(key, [...new Set([...(referenceLists.get(key) ?? []), ...refs.map(ref => identity.get(ref) ?? ref).filter(ref => ref !== key)])]); }
	const contextIds = [...new Set((graph.workIdentity?.contextIds ?? graph.coCitationContextIds ?? []).filter(id => !known.has(id) || admitted.has(id)).map(id => identity.get(id) ?? id))];
	const contexts = contextIds.map(id => referenceLists.get(id) ?? []);
	const links = [...rawLists].flatMap(([citingId, refs]) => refs.map(citedId => ({ citingId, citedId, source: "reference-list", year: records.find(record => record.id === citingId)?.year ?? null })));
	for (const row of graph.workIdentity?.evidence ?? graph.citationEvidence?.entries() ?? []) if ((!known.has(row.citingId) || admitted.has(row.citingId)) && (!known.has(row.citedId) || admitted.has(row.citedId))) for (const source of row.sources) links.push({ citingId: row.citingId, citedId: row.citedId, source, year: null });
	const projection = projectResearchRelations(links, rawLists, contexts, identity, null);
	const citationEvidence = new CitationEvidenceStore();
	for (const row of graph.workIdentity?.evidence ?? graph.citationEvidence?.entries() ?? []) if (admitted.has(row.citingId) && admitted.has(row.citedId)) { const citingId = identity.get(row.citingId) ?? row.citingId; const citedId = identity.get(row.citedId) ?? row.citedId; if (citingId !== citedId) citationEvidence.set({ ...row, citingId, citedId }); }
	const direct: GraphEdge[] = projection.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)).map(edge => ({ source: edge.source, target: edge.target, direct: edge.direct, weight: 1, sharedRefs: 0, coCitedBy: 0, coupling: 0, coCitation: 0 }));
	// This is an eligible-version projection; canonicalization would restore excluded raw relations.
	const next = refreshDerived({ ...graph, nodes, referenceLists, coCitationContextIds: contextIds, citationEvidence, edges: direct }, false);
	return { ...next, researchProjection: projection, edges: next.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target) && !seedException.has(edge.source) && !seedException.has(edge.target)) };
}

export function emptyVersionScope(): VersionScope {
	return { wholeExcluded: false, versions: {} };
}

function flags(scope: VersionScope, id: string): VersionFlags {
	return scope.versions[id] ?? { excluded: scope.wholeExcluded, staged: false, restored: false };
}

function put(scope: VersionScope, id: string, next: VersionFlags): VersionScope {
	return { ...scope, versions: { ...scope.versions, [id]: next } };
}

/** A newly seen version inherits a whole-work exclusion and does not inherit a sibling's restore. */
export function noteVersion(scope: VersionScope, id: string): VersionScope {
	if (scope.versions[id]) return scope;
	return put(scope, id, { excluded: scope.wholeExcluded, staged: false, restored: false });
}

export function excludeVersion(scope: VersionScope, id: string, isSeed = false): VersionScope {
	if (isSeed) return scope;
	const current = flags(scope, id);
	return put(scope, id, { ...current, excluded: true, restored: false });
}

export function excludeWholeWork(scope: VersionScope): VersionScope {
	const versions = Object.fromEntries(Object.entries(scope.versions).map(([id, version]) => [id, { ...version, excluded: true, restored: false }]));
	return { wholeExcluded: true, versions };
}

export function restoreVersion(scope: VersionScope, id: string): VersionScope {
	const current = flags(scope, id);
	return put(scope, id, { ...current, excluded: false, restored: scope.wholeExcluded || current.excluded });
}

/** Staging does not clear an exclusion. Restore-then-stage is what leaves the version visible. */
export function stageVersion(scope: VersionScope, id: string): VersionScope {
	const current = flags(scope, id);
	return put(scope, id, { ...current, staged: true });
}

export function versionVisible(scope: VersionScope, id: string): boolean {
	return !flags(scope, id).excluded;
}

function copyVersionScope(scope: VersionScope, ids: readonly string[]): VersionScope {
	const versions: Record<string, VersionFlags> = {};
	for (const id of ids) versions[id] = { ...(scope.versions[id] ?? { excluded: scope.wholeExcluded, staged: false, restored: false }) };
	return { wholeExcluded: scope.wholeExcluded, versions };
}

/** Both sides inherit a whole-work exclusion. A restore exception stays on its own version. */
export function splitExclusion(scope: VersionScope, leftIds: readonly string[], rightIds: readonly string[]): [VersionScope, VersionScope] {
	return [copyVersionScope(scope, leftIds), copyVersionScope(scope, rightIds)];
}

export interface MergedExclusion {
	scope: VersionScope;
	sides: Readonly<Record<string, VersionScope>>;
	/** An old aggregation that cannot be undone stays unconfirmed. */
	pending: boolean;
}

export function mergeExclusion(leftId: string, left: VersionScope, rightId: string, right: VersionScope, reversible = true): MergedExclusion {
	const versions: Record<string, VersionFlags> = {};
	for (const scope of [left, right]) {
		for (const [id, version] of Object.entries(scope.versions)) {
			versions[id] = { ...version, excluded: version.excluded || (scope.wholeExcluded && !version.restored) };
		}
	}
	return {
		scope: { wholeExcluded: left.wholeExcluded && right.wholeExcluded, versions },
		sides: { [leftId]: left, [rightId]: right },
		pending: !reversible,
	};
}

/** A version with a known pre-merge side follows that side. An unknown side stays off the main graph. */
export function assignMergedVersion(merged: MergedExclusion, versionId: string, sideId: string | null): { merged: MergedExclusion; onGraph: boolean; pending: boolean } {
	const side = sideId ? merged.sides[sideId] : undefined;
	if (!side) return { merged, onGraph: false, pending: true };
	const version = { excluded: side.wholeExcluded, staged: false, restored: false };
	return {
		merged: { ...merged, scope: { ...merged.scope, versions: { ...merged.scope.versions, [versionId]: version } } },
		onGraph: !version.excluded,
		pending: false,
	};
}

export interface PendingItem {
	id: string;
	kind: "identity" | "exclusion-scope" | "reading";
	blocks: string;
}

export function appendPending(list: readonly PendingItem[], item: PendingItem): PendingItem[] {
	return list.some((existing) => existing.id === item.id) ? [...list] : [...list, item];
}

export function choosePending(list: readonly PendingItem[], id: string): { pending: PendingItem[]; removed: PendingItem | null } {
	const removed = list.find((item) => item.id === id) ?? null;
	return { pending: removed ? list.filter((item) => item.id !== id) : [...list], removed };
}

/** Browsing stays available. Only the named blocked operation waits. */
export function operationBlocked(list: readonly PendingItem[], operation: string): boolean {
	return operation !== "browse" && list.some((item) => item.blocks === operation);
}

export function updateProjectPaperState(
	projects: Record<string, ResearchProject>, seedId: string, paper: PaperNode,
	patch: Partial<Omit<ProjectPaperState, "paper" | "updatedAt">> & { source?: string },
	projectKey?: string,
): ProjectPaperState {
	const key = projectKey ?? projectWriteKey(projects, seedId);
	if (projectKey && projects[key]?.seedId !== seedId) throw new Error(tr("项目起点已变更，请重试", "Project seed changed; retry the action"));
	const project = projects[key] ?? (projects[key] = { version: 1, seedId: key, name: key, updatedAt: Date.now(), views: [] });
	if (patch.staged !== undefined || patch.excluded !== undefined) project.versionStates ??= { ...(project.identityOriginalStates ?? project.paperStates) };
	const previous = project.versionStates?.[paper.id] ?? project.paperStates?.[paper.id];
	const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
	const fieldUpdatedAt = { ...previous?.fieldUpdatedAt };
	for (const field of ["reading", "staged", "excluded"] as const) if (patch[field] !== undefined) fieldUpdatedAt[field] = now;
	const state: ProjectPaperState = {
		paper,
		reading: patch.reading ?? previous?.reading ?? "unread",
		staged: patch.staged ?? previous?.staged ?? false,
		excluded: paper.isSeed ? false : patch.excluded ?? previous?.excluded ?? false,
		source: patch.source ?? previous?.source ?? "OpenAlex",
		updatedAt: now,
		fieldUpdatedAt,
	};
	project.paperStates = { ...project.paperStates, [paper.id]: state };
	if (project.versionStates) project.versionStates = { ...project.versionStates, [paper.id]: state };
	project.updatedAt = state.updatedAt;
	return state;
}

/** Write the literature note before the project. A failed note sync must not leave the new status on disk. */
export async function commitPaperReading(
	reading: ReadingStatus,
	previous: ReadingStatus,
	write: (reading: ReadingStatus) => void,
	persist: () => Promise<void> | void,
	sync?: (reading: ReadingStatus) => Promise<void> | void,
): Promise<void> {
	write(reading);
	try {
		await sync?.(reading);
		await persist();
	} catch (error) {
		write(previous);
		await Promise.resolve(sync?.(previous)).catch(() => undefined);
		await Promise.resolve(persist()).catch(() => undefined);
		throw error;
	}
}

export interface SharedReadings {
	byWork: Record<string, { reading: ReadingStatus; at: number }>;
	conflicts: Record<string, { values: ReadingStatus[]; at: number }>;
}

export function emptySharedReadings(): SharedReadings {
	return { byWork: {}, conflicts: {} };
}

export function readShared(store: SharedReadings, workId: string): ReadingStatus | null {
	return store.byWork[workId]?.reading ?? null;
}

/** Record an unresolved disagreement. Does not pick the higher status. */
export function noteReadingConflict(store: SharedReadings, workId: string, values: readonly ReadingStatus[], at: number): SharedReadings {
	const unique = [...new Set(values)];
	if (unique.length < 2) return store;
	return { ...store, conflicts: { ...store.conflicts, [workId]: { values: unique, at } } };
}

/** Latest explicit write wins, including a downgrade. An older value does not cover it, and an open conflict is not resolved by rank. */
export function writeSharedReading(store: SharedReadings, workId: string, reading: ReadingStatus, at: number): SharedReadings {
	const conflict = store.conflicts[workId];
	const current = store.byWork[workId];
	if (conflict && at <= conflict.at) return store;
	if (current && at < current.at) return store;
	const conflicts = { ...store.conflicts };
	delete conflicts[workId];
	return { byWork: { ...store.byWork, [workId]: { reading, at } }, conflicts };
}

/** Persist only after the write succeeds. The caller's previous store stays in place when this throws. */
export async function commitSharedReading(
	store: SharedReadings,
	workId: string,
	reading: ReadingStatus,
	at: number,
	persist: (next: SharedReadings) => Promise<void>,
): Promise<SharedReadings> {
	const next = writeSharedReading(store, workId, reading, at);
	if (next === store) return store;
	await persist(next);
	return next;
}

const READING_RANK: Record<ReadingStatus, number> = { unread: 0, "to-read": 1, read: 2 };

function higherReading(left: ReadingStatus, right: ReadingStatus): ReadingStatus {
	return READING_RANK[left] >= READING_RANK[right] ? left : right;
}

export interface VersionReadingMerge {
	reading: ReadingStatus | null;
	backup: Record<string, ReadingStatus> | null;
	pending: boolean;
}

/** First confirmed merge keeps the further status and both originals. A heuristic match does not. */
export function confirmVersionReading(leftId: string, left: ReadingStatus, rightId: string, right: ReadingStatus, confirmed: boolean): VersionReadingMerge {
	if (!confirmed) return { reading: null, backup: null, pending: true };
	return { reading: higherReading(left, right), backup: { [leftId]: left, [rightId]: right }, pending: false };
}

/** An explicit edit is the latest intent, including a downgrade. */
export function editAfterVersionMerge(_shared: ReadingStatus, next: ReadingStatus): { reading: ReadingStatus; pending: boolean } {
	return { reading: next, pending: false };
}

export function splitSharedReading(reading: ReadingStatus): [ReadingStatus, ReadingStatus] {
	return [reading, reading];
}

export type NoteReadingField =
	| { kind: "human"; reading: ReadingStatus }
	| { kind: "removed" }
	| { kind: "invalid"; raw: string }
	| { kind: "plugin"; reading: ReadingStatus };

const READING_VALUES = new Set<ReadingStatus>(["unread", "to-read", "read"]);

function isReadingStatus(value: unknown): value is ReadingStatus {
	return typeof value === "string" && READING_VALUES.has(value as ReadingStatus);
}

/** A value equal to the plugin's own last write is an echo, not a new human edit. */
export function readNoteReading(raw: unknown, pluginWrite: ReadingStatus | null): NoteReadingField {
	if (raw === undefined || raw === null) return { kind: "removed" };
	if (!isReadingStatus(raw)) {
		const text = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : JSON.stringify(raw);
		return { kind: "invalid", raw: text ?? "" };
	}
	if (pluginWrite !== null && raw === pluginWrite) return { kind: "plugin", reading: raw };
	return { kind: "human", reading: raw };
}

export function applyNoteReading(store: SharedReadings, workId: string, field: NoteReadingField, at: number): { store: SharedReadings; syncing: boolean } {
	switch (field.kind) {
		case "human":
			return { store: writeSharedReading(store, workId, field.reading, at), syncing: true };
		case "removed":
			return { store, syncing: false };
		case "invalid":
			return { store, syncing: false };
		case "plugin":
			return { store, syncing: true };
		default: {
			const _never: never = field;
			return _never;
		}
	}
}

export interface NoteSyncResult {
	reading: ReadingStatus;
	wrote: string[];
	failed: string[];
	held: string[];
}

/** Write participating notes after the shared record is committed. One failure does not roll the reading back or rewrite a note that already succeeded. */
export async function syncParticipatingNotes(
	reading: ReadingStatus,
	notes: readonly { path: string; participating: boolean; edited: boolean; write: () => Promise<void> }[],
): Promise<NoteSyncResult> {
	const wrote: string[] = [];
	const failed: string[] = [];
	const held: string[] = [];
	for (const note of notes) {
		if (!note.participating) continue;
		if (note.edited) {
			held.push(note.path);
			continue;
		}
		try {
			await note.write();
			wrote.push(note.path);
		} catch {
			failed.push(note.path);
		}
	}
	return { reading, wrote, failed, held };
}

export interface SyncRetry {
	attempts: number;
	limit: number;
	stopped: boolean;
	paused: boolean;
}

export function openSyncRetry(limit: number): SyncRetry {
	return { attempts: 0, limit, stopped: false, paused: false };
}

/** Failed tries stop at the limit. A concurrent edit or a field that left sync is not overwritten. */
export function stepSyncRetry(task: SyncRetry, outcome: "wrote" | "failed" | "edited" | "left"): SyncRetry {
	if (task.paused && outcome !== "edited" && outcome !== "left") return task;
	switch (outcome) {
		case "wrote":
			return { ...task, attempts: 0, stopped: false, paused: false };
		case "failed": {
			const attempts = Math.min(task.limit, task.attempts + 1);
			return { ...task, attempts, stopped: attempts >= task.limit, paused: false };
		}
		case "edited":
			return { ...task, paused: true };
		case "left":
			return { ...task, stopped: true, paused: true };
		default: {
			const _never: never = outcome;
			return _never;
		}
	}
}

/** Reopen a stopped task for another bounded run. A paused edit or a left field stays paused. */
export function reopenSyncRetry(task: SyncRetry): SyncRetry {
	if (task.paused) return task;
	return { ...task, attempts: 0, stopped: false };
}

export function projectStagedPapers(projects: Record<string, ResearchProject>): Array<{ seedId: string; paper: PaperNode; source: string; addedAt: string; read: boolean; reading: ReadingStatus }> {
	return Object.values(projects).flatMap((project) => Object.values(project.paperStates ?? {})
		.filter((state) => state.staged)
		.map((state) => ({ seedId: project.seedId, paper: state.paper, source: state.source, addedAt: new Date(state.updatedAt).toISOString(), read: state.reading === "read", reading: state.reading })));
}

export function projectExcludedPapers(project: ResearchProject): ProjectPaperState[] {
	return Object.values(project.paperStates ?? {}).filter((state) => state.excluded);
}

export interface MigrationProjectInput {
	seedId: string;
	snapshot?: { version?: number; seedId?: string; nodes?: readonly PaperNode[]; catalog?: readonly PaperNode[]; excludedIds?: readonly string[] } | null;
	paperStates?: Record<string, { reading?: string; excluded?: boolean; source?: string }>;
	versionStates?: Record<string, { reading?: string; excluded?: boolean; source?: string }>;
}

export interface MigrationOriginal {
	projectKey: string;
	reading: ReadingStatus;
}

export interface MigrationExclusion {
	projectKey: string;
	paperId: string;
	source: string;
	whole: false;
	pending: boolean;
}

export type MigrationPreview =
	| {
		stopped: false;
		keys: string[];
		readings: Record<string, { reading: ReadingStatus; originals: MigrationOriginal[] }>;
		readingConflicts: Array<{ paperId: string; originals: MigrationOriginal[] }>;
		exclusions: MigrationExclusion[];
		pending: PendingItem[];
	}
	| { stopped: true; missing: string };

function migrationNode(nodes: readonly PaperNode[], id: string): PaperNode | undefined {
	return nodes.find((node) => paperHasId(node, id));
}

function unconfirmedAggregate(node: PaperNode): boolean {
	const records = paperRecords(node);
	const head = records[0];
	return Boolean(head && records.length > 1 && records.some((record) => !confirmedVersionRelation(head, record)));
}

/** Read-only preview. Does not write settings or invent a reading, paper, or whole-work exclusion. */
export function previewMigration(projects: Record<string, MigrationProjectInput>): MigrationPreview {
	const keys = Object.keys(projects);
	const readings = new Map<string, MigrationOriginal[]>();
	const exclusions: MigrationExclusion[] = [];
	const pending: PendingItem[] = [];
	for (const key of keys) {
		const project = projects[key];
		if (!project?.seedId || !/^W\d+$/i.test(project.seedId)) return { stopped: true, missing: `${key} seedId` };
		const snapshot = project.snapshot;
		if (snapshot && (snapshot.version !== 1 && snapshot.version !== 2 || !snapshot.seedId || !Array.isArray(snapshot.nodes))) {
			return { stopped: true, missing: `${key} snapshot` };
		}
		const nodes = snapshot?.nodes ?? [];
		for (const [id, state] of [...Object.entries(project.paperStates ?? {}), ...Object.entries(project.versionStates ?? {})]) {
			if (!state) return { stopped: true, missing: `${key} paperStates.${id}` };
			if (state.reading !== undefined && state.reading !== "unread" && state.reading !== "to-read" && state.reading !== "read") {
				return { stopped: true, missing: `${key} paperStates.${id}.reading` };
			}
			if (state.reading === "unread" || state.reading === "to-read" || state.reading === "read") {
				const originals = readings.get(id) ?? [];
				originals.push({ projectKey: key, reading: state.reading });
				readings.set(id, originals);
			}
			if (state.excluded) exclusions.push({ projectKey: key, paperId: id, source: state.source ?? "paper-state", whole: false, pending: false });
		}
		for (const id of snapshot?.excludedIds ?? []) {
			if (typeof id !== "string" || !/^W\d+$/i.test(id)) return { stopped: true, missing: `${key} excludedIds ${id}` };
			const node = migrationNode([...nodes, ...(snapshot?.catalog ?? [])], id);
			const pendingScope = Boolean(node && id === node.id && unconfirmedAggregate(node));
			exclusions.push({ projectKey: key, paperId: id, source: "snapshot", whole: false, pending: pendingScope });
			if (pendingScope && !pending.some((item) => item.id === `scope:${key}:${id}`)) pending.push({ id: `scope:${key}:${id}`, kind: "exclusion-scope", blocks: "show" });
		}
		for (const node of nodes) {
			if (!unconfirmedAggregate(node) || pending.some((item) => item.id === `identity:${key}:${node.id}`)) continue;
			pending.push({ id: `identity:${key}:${node.id}`, kind: "identity", blocks: "merge" });
		}
	}
	const chosen: Record<string, { reading: ReadingStatus; originals: MigrationOriginal[] }> = {};
	const readingConflicts: Array<{ paperId: string; originals: MigrationOriginal[] }> = [];
	for (const [paperId, originals] of readings) {
		if (new Set(originals.map((item) => item.reading)).size > 1) {
			readingConflicts.push({ paperId, originals });
			pending.push({ id: `reading:${paperId}`, kind: "reading", blocks: "commit-reading" });
			continue;
		}
		chosen[paperId] = { reading: originals[0]!.reading, originals };
	}
	return { stopped: false, keys, readings: chosen, readingConflicts, exclusions, pending };
}

export type MigrationInterrupt = "save" | "mark" | "reread" | "switch";
export type DrillStage = "fresh" | "backed-up" | "saved" | "marked" | "reread" | "switched";

export interface MigrationDrill {
	stage: DrillStage;
	backup: Record<string, MigrationProjectInput> | null;
	data: Record<string, MigrationProjectInput>;
	written: Extract<MigrationPreview, { stopped: false }> | null;
	switched: boolean;
}

const DRILL_RANK: Record<DrillStage, number> = { fresh: 0, "backed-up": 1, saved: 2, marked: 3, reread: 4, switched: 5 };

function cloneProjects(data: Record<string, MigrationProjectInput>): Record<string, MigrationProjectInput> {
	return JSON.parse(JSON.stringify(data)) as Record<string, MigrationProjectInput>;
}

export function freshMigrationDrill(data: Record<string, MigrationProjectInput>, backup: Record<string, MigrationProjectInput> | null = null): MigrationDrill {
	return { stage: backup ? "backed-up" : "fresh", backup, data, written: null, switched: false };
}

/** In-memory copy. An existing backup is kept. A finished drill does not apply the preview again. */
export function stepMigrationDrill(drill: MigrationDrill, preview: MigrationPreview, failAt: MigrationInterrupt | null): MigrationDrill {
	if (drill.switched) return drill;
	const protectedDrill: MigrationDrill = drill.backup
		? { ...drill, stage: DRILL_RANK[drill.stage] >= DRILL_RANK["backed-up"] ? drill.stage : "backed-up" }
		: { ...drill, backup: cloneProjects(drill.data), stage: "backed-up" };
	if (preview.stopped) return protectedDrill;
	const steps: Array<{ interrupt: MigrationInterrupt; stage: DrillStage; apply: (copy: MigrationDrill) => MigrationDrill }> = [
		{ interrupt: "save", stage: "saved", apply: (copy) => ({ ...copy, stage: "saved", written: copy.written ?? preview }) },
		{ interrupt: "mark", stage: "marked", apply: (copy) => ({ ...copy, stage: "marked" }) },
		{ interrupt: "reread", stage: "reread", apply: (copy) => ({ ...copy, stage: "reread" }) },
		{ interrupt: "switch", stage: "switched", apply: (copy) => ({ ...copy, stage: "switched", switched: true }) },
	];
	let next = protectedDrill;
	for (const step of steps) {
		if (DRILL_RANK[next.stage] >= DRILL_RANK[step.stage]) continue;
		if (failAt === step.interrupt) return next;
		next = step.apply(next);
	}
	return next;
}

/** True only when the bytes read back match what was just written. A false result is not permission to save the previous format. */
export function migrationRereadAccepted(written: unknown, reread: unknown): boolean {
	return JSON.stringify(written) === JSON.stringify(reread);
}

export interface DisplayVersion {
	id: string;
	title: string;
	authors: string;
	year: number | null;
	workType: string | null;
	excluded: boolean;
	passesFilter: boolean;
}

export interface DisplayChoice {
	version: DisplayVersion;
	seedException: boolean;
	hidden: DisplayVersion[];
}

function byNewestThenId(left: DisplayVersion, right: DisplayVersion): number {
	return (right.year ?? -1) - (left.year ?? -1) || left.id.localeCompare(right.id);
}

/** One concrete version supplies every display field. A seed that fails the filter stays visible and marked. */
export function chooseDisplayVersion(versions: readonly DisplayVersion[], seedId: string | null): DisplayChoice | null {
	const ordered = [...versions].sort((left, right) => left.id.localeCompare(right.id));
	if (seedId) {
		const seed = ordered.find((version) => version.id === seedId);
		if (seed) return { version: seed, seedException: seed.excluded || !seed.passesFilter, hidden: ordered.filter((version) => version.id !== seed.id) };
	}
	const eligible = ordered.filter((version) => !version.excluded && version.passesFilter);
	const articles = eligible.filter((version) => version.workType === "article").sort(byNewestThenId);
	const preprints = eligible.filter((version) => version.workType === "preprint").sort(byNewestThenId);
	const rest = eligible.filter((version) => version.workType !== "article" && version.workType !== "preprint");
	const version = articles[0] ?? preprints[0] ?? rest[0];
	if (!version) return null;
	return { version, seedException: false, hidden: ordered.filter((item) => item.id !== version.id) };
}

export function expandDisplayVersion(choice: DisplayChoice, id: string): DisplayVersion | null {
	return [choice.version, ...choice.hidden].find((version) => version.id === id) ?? null;
}

export interface RetractionAdmission<T extends { id: string; retracted: boolean }> {
	visible: T[];
	hidden: T[];
	warning: boolean;
	blockedRebuild: boolean;
	confirmedSafe: false;
}

/** A retracted seed blocks a rebuild and leaves the previous versions in place. Absence of a flag is not a safety claim. */
export function admitRetraction<T extends { id: string; retracted: boolean }>(
	versions: readonly T[],
	seedId: string | null,
	allowRetractedSeed: boolean,
): RetractionAdmission<T> {
	const seed = seedId ? versions.find((version) => version.id === seedId) : undefined;
	if (seed?.retracted && !allowRetractedSeed) {
		return { visible: [...versions], hidden: [], warning: true, blockedRebuild: true, confirmedSafe: false };
	}
	const hidden = versions.filter((version) => version.retracted && version.id !== seedId);
	const visible = versions.filter((version) => !version.retracted || version.id === seedId);
	return { visible, hidden, warning: hidden.length > 0 || Boolean(seed?.retracted), blockedRebuild: false, confirmedSafe: false };
}

export interface ExportVersion extends DisplayVersion {
	researchId: string;
	seed: boolean;
}

/** One chosen version, or every version that passes the filter. A seed that fails the filter is included only when requested. */
export function selectExportVersions(versions: readonly ExportVersion[], mode: "one" | "all", includeSeedException: boolean): ExportVersion[] {
	const groups = new Map<string, ExportVersion[]>();
	for (const version of versions) {
		const group = groups.get(version.researchId) ?? [];
		group.push(version);
		groups.set(version.researchId, group);
	}
	const chosen: ExportVersion[] = [];
	for (const group of groups.values()) {
		const actualSeed = group.find(version => version.seed);
		const seed = actualSeed && (actualSeed.excluded || !actualSeed.passesFilter) ? actualSeed : undefined;
		if (mode === "all") {
			chosen.push(...group.filter((version) => !version.excluded && version.passesFilter));
			if (seed && includeSeedException) chosen.push(seed);
			continue;
		}
		if (seed && includeSeedException) chosen.push(seed);
		const display = chooseDisplayVersion(group.filter((version) => version !== seed), seed ? null : actualSeed?.id ?? null);
		const match = display && group.find((version) => version.id === display.version.id);
		if (match) chosen.push(match);
	}
	return chosen;
}

export interface ProjectGraphRequest<T> {
	projectKey: string;
	generation: number;
	graph: T | null;
	/** True only when a request failed before any graph was stored. */
	incomplete: boolean;
	userState: string;
}

export function openProjectRequest<T>(current: ProjectGraphRequest<T>): { current: ProjectGraphRequest<T>; generation: number } {
	const generation = current.generation + 1;
	return { current: { ...current, generation }, generation };
}

/** A late or foreign response cannot change the graph or the user state. */
export function commitProjectGraph<T>(current: ProjectGraphRequest<T>, generation: number, projectKey: string, graph: T): ProjectGraphRequest<T> {
	if (generation !== current.generation || projectKey !== current.projectKey) return current;
	return { ...current, graph, incomplete: false };
}

export function failProjectGraph<T>(current: ProjectGraphRequest<T>, generation: number, projectKey: string): ProjectGraphRequest<T> {
	if (generation !== current.generation || projectKey !== current.projectKey) return current;
	return { ...current, incomplete: current.graph === null };
}

export function switchProjectGraph<T>(current: ProjectGraphRequest<T>, projectKey: string): ProjectGraphRequest<T> {
	if (projectKey === current.projectKey) return current;
	return { ...current, projectKey, generation: current.generation + 1, graph: null, incomplete: false };
}

export interface PanelView {
	id: string;
	projectKey: string;
	zoom: number;
	filter: string;
	selectedId: string | null;
}

export interface SharedProjectGraph<T> {
	projectKey: string;
	graph: T;
	evidence: readonly string[];
}

/** Replace the shared graph. Panel zoom, filter, and selection stay on each panel. */
export function publishSharedGraph<T>(shared: SharedProjectGraph<T>, panels: readonly PanelView[], graph: T, evidence: readonly string[]): { shared: SharedProjectGraph<T>; panels: PanelView[] } {
	return { shared: { ...shared, graph, evidence }, panels: panels.map((panel) => ({ ...panel })) };
}

export function closePanel<T>(shared: SharedProjectGraph<T>, panels: readonly PanelView[], id: string): { shared: SharedProjectGraph<T>; panels: PanelView[] } {
	return { shared, panels: panels.filter((panel) => panel.id !== id) };
}

export interface PaperView {
	entry: "graph" | "outside";
	detailId: string;
	members: readonly string[];
	staged: false;
	addedEdges: 0;
}

/** Either entry opens the detail. Membership, staging, and edges stay as they were. */
export function viewPaper(members: readonly string[], entry: "graph" | "outside", paperId: string): PaperView {
	return { entry, detailId: paperId, members: [...members], staged: false, addedEdges: 0 };
}

export type NoteOpen =
	| { versionId: string; path: string; created: false; bodyMerged: false }
	| { versionId: string; path: null; created: true; bodyMerged: false }
	| { blocked: "version" | "file" };

/** A version is required first. Several files open only the chosen path, and creating a note does not merge bodies. */
export function openVersionNote(versionId: string | null, paths: readonly string[], chosenPath: string | null, create: boolean): NoteOpen {
	if (!versionId) return { blocked: "version" };
	if (create) return { versionId, path: null, created: true, bodyMerged: false };
	const only = paths.length === 1 ? paths[0] : undefined;
	if (only && (chosenPath === null || chosenPath === only)) return { versionId, path: only, created: false, bodyMerged: false };
	if (chosenPath && paths.includes(chosenPath)) return { versionId, path: chosenPath, created: false, bodyMerged: false };
	return { blocked: "file" };
}

export interface KeptMember {
	id: string;
	sources: Array<"sample" | "manual" | "dive">;
	edge: boolean;
	reading: ReadingStatus;
	staged: boolean;
	positive: false;
}

export function keepManual(members: readonly KeptMember[], id: string, edge: boolean): KeptMember[] {
	const existing = members.find((member) => member.id === id);
	if (!existing) return [...members, { id, sources: ["manual"], edge, reading: "unread", staged: false, positive: false }];
	if (existing.sources.includes("manual")) return [...members];
	return members.map((member) => member.id === id ? { ...member, sources: [...member.sources, "manual"] } : member);
}

export function dropManual(members: readonly KeptMember[], id: string): KeptMember[] {
	return members.flatMap((member) => {
		if (member.id !== id) return [member];
		const sources = member.sources.filter((source) => source !== "manual");
		return sources.length ? [{ ...member, sources }] : [];
	});
}

export interface MemberSet {
	manual: readonly string[];
	batches: ReadonlyArray<{ id: string; paperIds: readonly string[] }>;
	excluded: readonly string[];
	reading: ReadingStatus;
	staged: boolean;
}

export function presentMembers(set: MemberSet): string[] {
	const ids = new Set<string>(set.manual);
	for (const batch of set.batches) for (const id of batch.paperIds) ids.add(id);
	for (const id of set.excluded) ids.delete(id);
	return [...ids].sort();
}

export function dropDiveBatch(set: MemberSet, batchId: string): MemberSet {
	return { ...set, batches: set.batches.filter((batch) => batch.id !== batchId) };
}

export interface MemberCompose {
	ids: string[];
	sampleKept: number;
	keptBeyondCap: number;
	reasons: string[];
}

/** Sampling is capped before explicit sources are composed. Dropping one source keeps all others. */
export function composeProjectGraph(graph: SimilarityGraph, project: ResearchProject, cap: number): SimilarityGraph {
	const seedId = graph.nodes.find(node => node.isSeed)?.id;
	if (!seedId) return graph;
	const explicitIds = new Set((project.deepDives ?? []).flatMap(batch => batch.additions.map(item => item.paperId)));
	const manual = project.manualPapers ?? [];
	const composed = composeMembers({ sample: project.sampleIds ?? graph.nodes.filter(node => !explicitIds.has(node.id) && !manual.some(paper => paper.id === node.id)).map(node => node.id), cap: Math.max(0, cap - 1), manual: manual.map(paper => paper.id), batches: (project.deepDives ?? []).map(batch => ({ id: batch.id, paperIds: batch.additions.map(item => item.paperId) })), cancelledManual: [], retractedBatchIds: project.retractedBatchIds ?? [], excluded: Object.values(project.versionStates ?? project.paperStates ?? {}).filter(state => projectVersionState(project, state.paper).excluded).map(state => state.paper.id), retracted: [], seedId, seedRebuildBlocked: false });
	const keep = new Set(composed.ids);
	const candidates = [...graph.catalog, ...manual].filter(paper => keep.has(paper.id) && !graph.nodes.some(node => node.id === paper.id)).map(paper => ({ ...paper, isSeed: paper.id === seedId }));
	let next = candidates.length ? graftNodes(graph, candidates, graph.referenceLists) : graph;
	for (const node of next.nodes) if (!node.isSeed && !paperRecords(node).some(record => keep.has(record.id))) next = omitNode(next, node.id) ?? next;
	return refreshDerived(next);
}

export function composeMembers(input: {
	sample: readonly string[];
	cap: number;
	manual: readonly string[];
	batches: ReadonlyArray<{ id: string; paperIds: readonly string[] }>;
	cancelledManual: readonly string[];
	retractedBatchIds: readonly string[];
	excluded: readonly string[];
	retracted: readonly string[];
	seedId: string;
	seedRebuildBlocked: boolean;
}): MemberCompose {
	const cancelled = new Set(input.cancelledManual);
	const retractedBatches = new Set(input.retractedBatchIds);
	const excluded = new Set(input.excluded);
	const retracted = new Set(input.retracted);
	const reserved = new Set<string>();
	for (const id of input.manual) if (!cancelled.has(id) && !excluded.has(id) && !retracted.has(id)) reserved.add(id);
	for (const batch of input.batches) {
		if (retractedBatches.has(batch.id)) continue;
		for (const id of batch.paperIds) if (!excluded.has(id) && !retracted.has(id)) reserved.add(id);
	}
	reserved.add(input.seedId);
	const sample = input.seedRebuildBlocked
		? []
		: input.sample.filter((id) => !reserved.has(id) && !excluded.has(id) && !retracted.has(id) && !cancelled.has(id)).slice(0, Math.max(0, input.cap));
	const ids = [...new Set([...reserved, ...sample])].sort();
	const keptBeyondCap = Math.max(0, ids.length - input.cap);
	return { ids, sampleKept: sample.length, keptBeyondCap, reasons: keptBeyondCap > 0 ? [`${keptBeyondCap} kept past the sample cap`] : [] };
}

export interface SeedProject<T> {
	projectKey: string;
	seedId: string;
	graph: T | null;
	generation: number;
	manual: readonly string[];
	reading: ReadingStatus;
	zoom: number;
	selectedId: string | null;
}

export function rejectSeedExclude(seedId: string, targetId: string): boolean {
	return seedId === targetId;
}

export function openSeedSwap<T>(current: SeedProject<T>): { current: SeedProject<T>; generation: number } {
	const generation = current.generation + 1;
	return { current: { ...current, generation }, generation };
}

/** Only the newest successful swap replaces the graph. The project key, reading, and kept sources stay. */
export function commitSeedSwap<T>(current: SeedProject<T>, generation: number, seedId: string, graph: T, ok: boolean): SeedProject<T> {
	if (generation !== current.generation || !ok) return current;
	return { ...current, seedId, graph, zoom: 1, selectedId: null };
}

export interface ProjectUndo<T> {
	seedId: string;
	graph: T;
	zoom: number;
	reading: ReadingStatus;
	staged: boolean;
	excludedIds: readonly string[];
	batches: ReadonlyArray<{ id: string; paperIds: readonly string[] }>;
	checkpoint: { seedId: string; graph: T; zoom: number } | null;
	generation: number;
}

export function saveUndoPoint<T>(current: ProjectUndo<T>): ProjectUndo<T> {
	return { ...current, checkpoint: { seedId: current.seedId, graph: current.graph, zoom: current.zoom } };
}

/** Restore the previous seed and graph. Reading, staging, exclusion, and batches stay at their latest values. */
export function undoProject<T>(current: ProjectUndo<T>, persistOk: boolean): { current: ProjectUndo<T>; undone: boolean } {
	const point = current.checkpoint;
	if (!point || !persistOk || current.excludedIds.includes(point.seedId)) return { current, undone: false };
	return {
		undone: true,
		current: { ...current, seedId: point.seedId, graph: point.graph, zoom: point.zoom, checkpoint: null, generation: current.generation + 1 },
	};
}

export interface EmbedAssociation {
	blockKey: string;
	projectKey: string | null;
}

export interface EmbedProjectOption {
	key: string;
	seedId: string;
}

export interface EmbedActionResult {
	status: "needs-choice" | "cancelled" | "stale" | "applied";
	association: EmbedAssociation;
	written: boolean;
	projectKey: string | null;
	created: boolean;
	paperId: string | null;
	staged: boolean | null;
	excluded: boolean | null;
}

/** Reopen restores only an explicit persistent link. */
export function reopenEmbed(association: EmbedAssociation): string | null {
	return association.projectKey;
}

/** A stage or exclude writes only to an explicit project. The same seed is never enough to pick one. */
export function applyEmbedAction(input: {
	association: EmbedAssociation;
	projects: readonly EmbedProjectOption[];
	seedId: string;
	chosenKey: string | null;
	createKey: string | null;
	persistLink: boolean;
	cancel: boolean;
	generation: number;
	openGeneration: number;
	paperId: string | null;
	staged: boolean | null;
	excluded: boolean | null;
}): EmbedActionResult {
	const idle: Omit<EmbedActionResult, "status"> = {
		association: input.association, written: false, projectKey: null, created: false, paperId: null, staged: null, excluded: null,
	};
	if (input.cancel) return { status: "cancelled", ...idle };
	if (input.generation !== input.openGeneration) return { status: "stale", ...idle };
	const explicit = input.createKey ?? input.chosenKey ?? input.association.projectKey;
	if (!explicit) return { status: "needs-choice", ...idle };
	const created = input.createKey !== null && !input.projects.some((project) => project.key === input.createKey);
	const association = input.persistLink ? { ...input.association, projectKey: explicit } : input.association;
	return {
		status: "applied", association, written: true, projectKey: explicit, created,
		paperId: input.paperId, staged: input.staged, excluded: input.excluded,
	};
}

export interface EmbedBlock<T> {
	blockKey: string;
	seedId: string;
	graph: T;
	reading: ReadingStatus;
	projectKey: string | null;
	paused: boolean;
	generation: number;
}

/** Project seed and dive changes stay on the project. Shared reading still copies, and an excluded block seed pauses. */
export function followSharedReading<T>(block: EmbedBlock<T>, project: { seedId: string; graph: T; reading: ReadingStatus; excludedIds: readonly string[] }): EmbedBlock<T> {
	const paused = block.projectKey !== null && project.excludedIds.includes(block.seedId);
	return { ...block, reading: project.reading, paused };
}

export type EmbedResume = "restore" | "unlink" | "reseed";

export function resumeEmbed<T>(block: EmbedBlock<T>, excludedIds: readonly string[], action: EmbedResume, nextSeedId: string | null): { block: EmbedBlock<T>; excludedIds: readonly string[] } {
	switch (action) {
		case "restore":
			return { block: { ...block, paused: false }, excludedIds: excludedIds.filter((id) => id !== block.seedId) };
		case "unlink":
			return { block: { ...block, projectKey: null, paused: false }, excludedIds: [...excludedIds] };
		case "reseed": {
			const seedId = nextSeedId ?? block.seedId;
			return { block: { ...block, seedId, paused: block.projectKey !== null && excludedIds.includes(seedId) }, excludedIds: [...excludedIds] };
		}
		default: {
			const neverAction: never = action;
			return neverAction;
		}
	}
}

/** A paused embed, or an older generation, keeps the block graph. */
export function acceptEmbedGraph<T>(block: EmbedBlock<T>, generation: number, graph: T): EmbedBlock<T> {
	if (block.paused || generation !== block.generation) return block;
	return { ...block, graph };
}

/** Migrate old staged rows, snapshot exclusions, and remembered deep-dive IDs into the project record. */
export function migrateProjectRecords(
	projects: Record<string, ResearchProject>, legacyStaged: readonly { seedId: string; paper: PaperNode; source: string; read: boolean }[],
	legacyGrafted: Record<string, string[]>,
): Record<string, ResearchProject> {
	for (const item of legacyStaged) {
		const existing = projects[item.seedId.toUpperCase()]?.paperStates?.[item.paper.id];
		if (!existing) updateProjectPaperState(projects, item.seedId, item.paper, { staged: true, reading: item.read ? "read" : "unread", source: item.source });
	}
	for (const seedId of Object.keys(legacyGrafted)) {
		const key = seedId.toUpperCase();
		if (!projects[key]) projects[key] = { version: 1, seedId: key, name: key, updatedAt: Date.now(), views: [] };
	}
	for (const project of Object.values(projects)) {
		const snapshot = project.snapshot;
		if (snapshot) for (const id of snapshot.excludedIds ?? []) {
			const paper = snapshot.nodes.find((node) => node.id === id) ?? snapshot.catalog.find((node) => node.id === id);
			if (paper) updateProjectPaperState(projects, project.seedId, paper, { excluded: true });
			else if (!project.exclusionScopes?.some(entry => entry.ids.includes(id))) {
				// Old snapshots can retain exclusion IDs after evicting their paper metadata.
				(project.exclusionScopes ??= []).push({ ids: [id], scope: excludeVersion(emptyVersionScope(), id) });
			}
		}
		const existing = new Set((project.deepDives ?? []).flatMap((batch) => batch.additions.map((item) => item.paperId)));
		const legacyIds = (legacyGrafted[project.seedId] ?? []).filter((id) => !existing.has(id));
		if (legacyIds.length) {
			project.deepDives = [...(project.deepDives ?? []), {
				id: `legacy-${project.seedId}`, parentId: project.seedId, createdAt: project.updatedAt,
				references: 0, citations: 0, additions: legacyIds.map((paperId) => ({ paperId, source: "legacy" as const })),
				noMore: false, warnings: [],
			}];
		}
	}
	return projects;
}

export function saveGraphSnapshot(graph: SimilarityGraph): SavedGraphSnapshot {
	const seed = graph.nodes.find((node) => node.isSeed);
	if (!seed) throw new Error(tr("研究项目缺少种子文献", "Research project has no seed paper"));
	return {
		version: 2,
		workIdentity: graph.workIdentity,
		savedAt: Date.now(),
		seedId: seed.id,
		nodes: graph.nodes,
		edges: graph.edges,
		seedScore: [...graph.seedScore],
		warnings: graph.warnings,
		strategies: graph.strategies,
		referenceLists: [...graph.referenceLists].map(([id, refs]) => [id, [...refs]]),
		coCitationContextIds: graph.coCitationContextIds ? [...graph.coCitationContextIds] : undefined,
		rawReferenceLists: graph.rawReferenceLists ? [...graph.rawReferenceLists].map(([id, refs]) => [id, [...refs]]) : undefined,
		catalog: [...graph.catalog],
		citationEvidence: graph.citationEvidence?.entries() ?? [],
		skippedNonResearch: graph.skippedNonResearch,
		skippedRetracted: graph.skippedRetracted,
		retrievalStats: graph.retrievalStats,
		candidateAudit: graph.candidateAudit,
		excludedIds: graph.excludedIds,
		crossCheck: graph.crossCheck ? [...graph.crossCheck] : undefined,
		semanticScores: graph.semanticScores ? [...graph.semanticScores] : undefined,
		semanticMode: graph.semanticMode,
		semanticModel: graph.semanticModel,
		semanticVectorIds: graph.semanticVectorIds,
		enhancement: graph.enhancement,
		selectionRank: graph.selectionRank ? [...graph.selectionRank] : undefined,
	};
}

export function restoreGraphSnapshot(raw: unknown): SimilarityGraph | null {
	if (!raw || typeof raw !== "object") return null;
	const saved = JSON.parse(JSON.stringify(raw)) as Partial<SavedGraphSnapshot>;
	if (![1, 2].includes(saved.version ?? 0) || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges) || !Array.isArray(saved.seedScore) || !Array.isArray(saved.referenceLists) || !Array.isArray(saved.catalog)) return null;
	if (!saved.nodes.some((node) => node?.isSeed && node.id === saved.seedId)) return null;
	if (saved.enhancement !== undefined && !validEnhancement(saved.enhancement)) return null;
	try {
		const identity = saved.workIdentity;
		if (identity && (identity.version !== 1 || !Array.isArray(identity.records) || identity.records.length > 10000 || !identity.records.every((paper) => paper && typeof paper.id === "string" && typeof paper.title === "string" && Array.isArray(paper.authorList)) || !Array.isArray(identity.referenceLists) || !identity.referenceLists.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")) || !Array.isArray(identity.evidence) || !Array.isArray(identity.directEdges) || !Array.isArray(identity.canonicalIds) || !identity.canonicalIds.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === "string")) || !Array.isArray(identity.separatedIds) || !identity.separatedIds.every((id) => typeof id === "string"))) return null;
		if (identity?.contextIds !== undefined && (!Array.isArray(identity.contextIds) || identity.contextIds.length > 10000 || !identity.contextIds.every((id) => typeof id === "string"))) return null;
		if (identity?.sourceRelations !== undefined && !validSourceVersionRelations(identity.sourceRelations)) return null;
		if (saved.nodes.length > 5000 || saved.edges.length > 200000 || saved.seedScore.some((entry) => !Array.isArray(entry) || entry.length !== 2)) return null;
		const citationEvidence = new CitationEvidenceStore();
		for (const evidence of Array.isArray(saved.citationEvidence) ? saved.citationEvidence : []) {
			if (evidence && typeof evidence.citingId === "string" && typeof evidence.citedId === "string") citationEvidence.set(evidence);
		}
		return normalizeWorkGraph({
		workIdentity: saved.workIdentity,
		nodes: saved.nodes,
		edges: saved.edges,
		seedScore: new Map(saved.seedScore),
		warnings: saved.warnings ?? [],
		strategies: saved.strategies ?? { references: true, citations: true, related: true },
		referenceLists: new Map(saved.referenceLists),
		coCitationContextIds: Array.isArray(saved.coCitationContextIds) ? saved.coCitationContextIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 400) : undefined,
		rawReferenceLists: saved.rawReferenceLists ? new Map(saved.rawReferenceLists) : undefined,
		catalog: saved.catalog,
		citationEvidence,
		skippedNonResearch: saved.skippedNonResearch ?? 0,
		skippedRetracted: saved.skippedRetracted ?? 0,
		retrievalStats: saved.retrievalStats,
		candidateAudit: Array.isArray(saved.candidateAudit)
			? saved.candidateAudit.filter((item: NonNullable<SavedGraphSnapshot["candidateAudit"]>[number]) => item && typeof item.id === "string" && typeof item.source === "string" && (item.doi === null || typeof item.doi === "string")).slice(0, 5000)
			: undefined,
		excludedIds: Array.isArray(saved.excludedIds) ? saved.excludedIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)) : undefined,
		crossCheck: saved.crossCheck ? new Map(saved.crossCheck) : undefined,
		semanticScores: saved.semanticScores ? new Map(saved.semanticScores) : undefined,
		semanticMode: saved.semanticMode,
		semanticModel: saved.semanticModel,
		semanticVectorIds: Array.isArray(saved.semanticVectorIds) ? saved.semanticVectorIds.filter(id => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 5000) : undefined,
		enhancement: saved.enhancement,
			selectionRank: saved.selectionRank ? new Map(saved.selectionRank) : undefined,
		});
	} catch {
		return null;
	}
}

function validEnhancement(value: unknown): value is NonNullable<SimilarityGraph["enhancement"]> {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const count = (item: unknown): boolean => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
	if (!["candidates", "openAlexRequested", "openAlexAbstracts", "abstractsAdded", "compatibleVectors"].every(key => count(record[key]))) return false;
	if (!record.s2 || typeof record.s2 !== "object") return false;
	const stats = record.s2 as Record<string, unknown>;
	return ["requested", "cacheHits", "requests", "found", "notFound", "unresolved"].every(key => count(stats[key]))
		&& typeof stats.rateLimited === "boolean" && typeof stats.embeddingFallback === "boolean"
		&& (stats.error === undefined || typeof stats.error === "string");
}

export function normalizeProjects(raw: unknown): Record<string, ResearchProject> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, ResearchProject> = {};
	for (const [seedId, value] of Object.entries(raw)) {
		if (!/^W\d+$/i.test(seedId) || !value || typeof value !== "object") continue;
		const project = value as Partial<ResearchProject>;
		if (project.versionStates) for (const [id, state] of Object.entries(project.versionStates)) {
			if (!state || state.paper?.id !== id || !["unread", "to-read", "read"].includes(state.reading)) throw new Error(tr(`版本状态无效 ${seedId}:${id}，已保留原数据`, `Invalid version state ${seedId}:${id}; original data retained`));
		}
		if (project.exclusionScopes && (!Array.isArray(project.exclusionScopes) || project.exclusionScopes.some(entry => !entry || !Array.isArray(entry.ids) || entry.ids.some(id => typeof id !== "string" || !/^W\d+$/i.test(id)) || !entry.scope || typeof entry.scope.wholeExcluded !== "boolean" || !entry.scope.versions || Object.values(entry.scope.versions).some(flags => typeof flags.excluded !== "boolean" || typeof flags.staged !== "boolean" || typeof flags.restored !== "boolean")))) throw new Error(tr(`排除范围无效 ${seedId}，已保留原数据`, `Invalid exclusion scope ${seedId}; original data retained`));
		for (const { scope } of project.exclusionScopes ?? []) {
			if (scope.ambiguousNewVersions !== undefined && typeof scope.ambiguousNewVersions !== "boolean" || scope.wholeRules !== undefined && (!Array.isArray(scope.wholeRules) || scope.wholeRules.some(ids => !Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !/^W\d+$/.test(id))))) throw new Error(tr(`排除来源记录无效 ${seedId}，已保留原数据`, `Invalid exclusion provenance ${seedId}; original data retained`));
		}
		const snapshot = project.snapshot ? restoreGraphSnapshot(project.snapshot) : null;
		if (project.snapshot && !snapshot) throw new Error(tr(`项目快照无效 ${seedId}，已保留原数据`, `Invalid project snapshot ${seedId}; original data retained`));
		if (project.manualPapers !== undefined && (!Array.isArray(project.manualPapers) || project.manualPapers.some(paper => !paper || !/^W\d+$/i.test(paper.id) || !Array.isArray(paper.concepts)))) throw new Error(tr(`保留论文记录无效 ${seedId}，已保留原数据`, `Invalid retained papers ${seedId}; original data retained`));
		if (project.sampleIds !== undefined && (!Array.isArray(project.sampleIds) || project.sampleIds.some(id => typeof id !== "string" || !/^W\d+$/i.test(id)))) throw new Error(tr(`采样编号无效 ${seedId}，已保留原数据`, `Invalid sample ids ${seedId}; original data retained`));
		if (project.pending !== undefined && (!Array.isArray(project.pending) || project.pending.some(item => !item || typeof item.id !== "string" || !["identity", "exclusion-scope", "reading"].includes(item.kind) || typeof item.blocks !== "string"))) throw new Error(tr(`待处理项无效 ${seedId}，已保留原数据`, `Invalid pending items ${seedId}; original data retained`));
		const paperStates: Record<string, ProjectPaperState> = {};
		for (const [id, rawState] of Object.entries(project.paperStates ?? {})) {
			if (!rawState || rawState.paper?.id !== id || !["unread", "to-read", "read"].includes(rawState.reading)) throw new Error(tr(`项目状态无效 ${seedId}:${id}，已保留原数据`, `Invalid project state ${seedId}:${id}; original data retained`));
			paperStates[id] = {
				paper: rawState.paper,
				reading: rawState.reading,
				staged: Boolean(rawState.staged),
				excluded: Boolean(rawState.excluded),
				source: typeof rawState.source === "string" ? rawState.source.slice(0, 300) : "OpenAlex",
				updatedAt: Number.isFinite(rawState.updatedAt) ? rawState.updatedAt : 0,
				fieldUpdatedAt: rawState.fieldUpdatedAt && Object.fromEntries(Object.entries(rawState.fieldUpdatedAt).filter(([field, time]) => ["reading", "staged", "excluded"].includes(field) && Number.isFinite(time))),
			};
		}
		if (project.version !== 1 || (!snapshot && Object.keys(paperStates).length === 0 && !project.deepDives?.length)) continue;
		out[seedId.toUpperCase()] = {
			version: 1,
			seedId: typeof project.seedId === "string" && /^W\d+$/i.test(project.seedId) ? project.seedId.toUpperCase() : seedId.toUpperCase(),
			name: typeof project.name === "string" ? project.name.slice(0, 120) : snapshot?.nodes.find((node) => node.isSeed)?.title || seedId,
			updatedAt: Number.isFinite(project.updatedAt) ? Number(project.updatedAt) : Number(project.snapshot && project.snapshot.savedAt) || 0,
			snapshot: snapshot ? project.snapshot : undefined,
			deepDives: Array.isArray(project.deepDives) ? project.deepDives.filter((batch) => batch && typeof batch.id === "string" && typeof batch.parentId === "string" && Array.isArray(batch.additions)).slice(-100).map((batch) => ({
				id: batch.id.slice(0, 80),
				parentId: batch.parentId,
				createdAt: Number.isFinite(batch.createdAt) ? batch.createdAt : 0,
				references: Number.isFinite(batch.references) ? Math.max(0, batch.references) : 0,
				citations: Number.isFinite(batch.citations) ? Math.max(0, batch.citations) : 0,
				additions: batch.additions.filter((item) => item && typeof item.paperId === "string" && ["reference", "citation", "shared-reference", "legacy"].includes(item.source)),
				noMore: Boolean(batch.noMore),
				warnings: Array.isArray(batch.warnings) ? batch.warnings.filter((item): item is string => typeof item === "string").slice(0, 10) : [],
			})) : [],
			paperStates,
			versionStates: project.versionStates ?? project.identityOriginalStates ?? paperStates,
			exclusionScopes: project.exclusionScopes,
			pending: project.pending,
			sampleIds: Array.isArray(project.sampleIds) ? project.sampleIds.filter(id => typeof id === "string" && /^W\d+$/i.test(id)) : undefined,
			manualPapers: Array.isArray(project.manualPapers) ? project.manualPapers.filter(paper => paper && /^W\d+$/i.test(paper.id) && Array.isArray(paper.concepts)) : [],
			retractedBatchIds: Array.isArray(project.retractedBatchIds) ? project.retractedBatchIds.filter(id => typeof id === "string") : [],
			identityOriginalStates: project.identityOriginalStates,
			identityConflicts: project.identityConflicts,
			identityReviewedGroups: project.identityReviewedGroups,
			identityOriginalDeepDives: project.identityOriginalDeepDives,
			identityOriginalViews: project.identityOriginalViews,
			identityOriginalCurrentView: project.identityOriginalCurrentView,
			currentView: validView(project.currentView) ? project.currentView : undefined,
			views: Array.isArray(project.views) ? project.views.filter(validView).slice(0, 30) : [],
		};
		const next = out[seedId.toUpperCase()]!;
		if (snapshot) { reconcileProjectIdentity(next, snapshot); next.snapshot = { ...saveGraphSnapshot(snapshot), savedAt: project.snapshot?.savedAt ?? 0 }; }
	}
	return out;
}

function validView(view: unknown): view is SavedView {
	if (!view || typeof view !== "object") return false;
	const item = view as Partial<SavedView>;
	return typeof item.name === "string" && ["force2d", "temporal", "radial"].includes(item.layout ?? "")
		&& (item.selectedId === null || typeof item.selectedId === "string")
		&& (item.scrubYear === null || typeof item.scrubYear === "number")
		&& Number.isFinite(item.zoom) && Number.isFinite(item.centerX) && Number.isFinite(item.centerY);
}
