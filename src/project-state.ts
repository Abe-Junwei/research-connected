import { tr } from "./i18n";
import { CitationEvidenceStore, type CitationEvidence } from "./citation-evidence";
import { shortId } from "./paper";
import { normalizeWorkGraph } from "./graph-edit";
import { paperHasId, paperRecords, resolveWorkQuery, type WorkIdentity } from "./work-identity";
import type { SimilarityGraph } from "./neighborhood";
import type { GraphFilter } from "./graph-filter";
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
	paperStates?: Record<string, ProjectPaperState>;
	identityOriginalStates?: Record<string, ProjectPaperState>;
	identityConflicts?: string[];
	identityReviewedGroups?: string[];
	identityOriginalDeepDives?: DeepDiveBatch[];
	identityOriginalViews?: SavedView[];
	identityOriginalCurrentView?: SavedView;
}

export function savedProjectForSeed(
	projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string },
): ResearchProject | undefined {
	if (target.kind === "openalex" && projects[shortId(target.value)]) return projects[shortId(target.value)];
	const matches = Object.values(projects).filter((project) => { const graph = restoreGraphSnapshot(project.snapshot); return graph && resolveWorkQuery(graph.nodes.filter((paper) => paper.isSeed), target.value) !== null; });
	return matches.length === 1 ? matches[0] : undefined;
}

export function matchingSeedProjects(projects: Record<string, ResearchProject>, target: { kind: "doi" | "openalex"; value: string }): ResearchProject[] {
	return Object.values(projects).filter((project) => {
		const snapshot = restoreGraphSnapshot(project.snapshot);
		return snapshot && resolveWorkQuery(snapshot.nodes.filter((paper) => paper.isSeed), target.value) !== null;
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
	kind: "identity" | "exclusion-scope";
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
): ProjectPaperState {
	const key = seedId.toUpperCase();
	const project = projects[key] ?? (projects[key] = { version: 1, seedId: key, name: key, updatedAt: Date.now(), views: [] });
	paper = project.snapshot?.nodes.find((item) => paperHasId(item, paper.id)) ?? paper;
	const previous = project.paperStates?.[paper.id];
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

/** A later explicit edit that disagrees with the shared status waits. It does not replace that status. */
export function editAfterVersionMerge(shared: ReadingStatus, next: ReadingStatus): { reading: ReadingStatus; pending: boolean } {
	if (next === shared) return { reading: shared, pending: false };
	return { reading: shared, pending: true };
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
	if (!seed) throw new Error(tr("研究项目缺少种子论文", "Research project has no seed paper"));
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
		selectionRank: graph.selectionRank ? [...graph.selectionRank] : undefined,
	};
}

export function restoreGraphSnapshot(raw: unknown): SimilarityGraph | null {
	if (!raw || typeof raw !== "object") return null;
	const saved = JSON.parse(JSON.stringify(raw)) as Partial<SavedGraphSnapshot>;
	if (![1, 2].includes(saved.version ?? 0) || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges) || !Array.isArray(saved.seedScore) || !Array.isArray(saved.referenceLists) || !Array.isArray(saved.catalog)) return null;
	if (!saved.nodes.some((node) => node?.isSeed && node.id === saved.seedId)) return null;
	try {
		const identity = saved.workIdentity;
		if (identity && (identity.version !== 1 || !Array.isArray(identity.records) || identity.records.length > 10000 || !identity.records.every((paper) => paper && typeof paper.id === "string" && typeof paper.title === "string" && Array.isArray(paper.authorList)) || !Array.isArray(identity.referenceLists) || !identity.referenceLists.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")) || !Array.isArray(identity.evidence) || !Array.isArray(identity.directEdges) || !Array.isArray(identity.canonicalIds) || !identity.canonicalIds.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === "string")) || !Array.isArray(identity.separatedIds) || !identity.separatedIds.every((id) => typeof id === "string"))) return null;
		if (identity?.contextIds !== undefined && (!Array.isArray(identity.contextIds) || identity.contextIds.length > 10000 || !identity.contextIds.every((id) => typeof id === "string"))) return null;
		if (saved.nodes.length > 300 || saved.edges.length > 20000 || saved.seedScore.some((entry) => !Array.isArray(entry) || entry.length !== 2)) return null;
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
		excludedIds: Array.isArray(saved.excludedIds) ? saved.excludedIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 300) : undefined,
		crossCheck: saved.crossCheck ? new Map(saved.crossCheck) : undefined,
		semanticScores: saved.semanticScores ? new Map(saved.semanticScores) : undefined,
		semanticMode: saved.semanticMode,
		semanticModel: saved.semanticModel,
			selectionRank: saved.selectionRank ? new Map(saved.selectionRank) : undefined,
		});
	} catch {
		return null;
	}
}

export function normalizeProjects(raw: unknown): Record<string, ResearchProject> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, ResearchProject> = {};
	for (const [seedId, value] of Object.entries(raw)) {
		if (!/^W\d+$/i.test(seedId) || !value || typeof value !== "object") continue;
		const project = value as Partial<ResearchProject>;
		const snapshot = project.snapshot ? restoreGraphSnapshot(project.snapshot) : null;
		const paperStates: Record<string, ProjectPaperState> = {};
		for (const [id, rawState] of Object.entries(project.paperStates ?? {}).slice(0, 1000)) {
			if (!rawState || rawState.paper?.id !== id || !["unread", "to-read", "read"].includes(rawState.reading)) continue;
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
		if (project.version !== 1 || (snapshot && snapshot.nodes.length > 300) || (!snapshot && Object.keys(paperStates).length === 0 && !project.deepDives?.length)) continue;
		out[seedId.toUpperCase()] = {
			version: 1,
			seedId: seedId.toUpperCase(),
			name: typeof project.name === "string" ? project.name.slice(0, 120) : snapshot?.nodes.find((node) => node.isSeed)?.title || seedId,
			updatedAt: Number.isFinite(project.updatedAt) ? Number(project.updatedAt) : Number(project.snapshot && project.snapshot.savedAt) || 0,
			snapshot: snapshot ? project.snapshot : undefined,
			deepDives: Array.isArray(project.deepDives) ? project.deepDives.filter((batch) => batch && typeof batch.id === "string" && typeof batch.parentId === "string" && Array.isArray(batch.additions)).slice(-100).map((batch) => ({
				id: batch.id.slice(0, 80),
				parentId: batch.parentId,
				createdAt: Number.isFinite(batch.createdAt) ? batch.createdAt : 0,
				references: Number.isFinite(batch.references) ? Math.max(0, batch.references) : 0,
				citations: Number.isFinite(batch.citations) ? Math.max(0, batch.citations) : 0,
				additions: batch.additions.filter((item) => item && typeof item.paperId === "string" && ["reference", "citation", "shared-reference", "legacy"].includes(item.source)).slice(0, 300),
				noMore: Boolean(batch.noMore),
				warnings: Array.isArray(batch.warnings) ? batch.warnings.filter((item): item is string => typeof item === "string").slice(0, 10) : [],
			})) : [],
			paperStates,
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
