import { tr } from "./i18n";
import { CitationEvidenceStore, type CitationEvidence } from "./citation-evidence";
import type { SimilarityGraph } from "./neighborhood";
import type { GraphFilter } from "./graph-filter";
import type { PaperNode, GraphEdge } from "./types";

export interface SavedGraphSnapshot {
	version: 1;
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
}

export function updateProjectPaperState(
	projects: Record<string, ResearchProject>, seedId: string, paper: PaperNode,
	patch: Partial<Omit<ProjectPaperState, "paper" | "updatedAt">> & { source?: string },
): ProjectPaperState {
	const key = seedId.toUpperCase();
	const project = projects[key] ?? (projects[key] = { version: 1, seedId: key, name: key, updatedAt: Date.now(), views: [] });
	const previous = project.paperStates?.[paper.id];
	const state: ProjectPaperState = {
		paper,
		reading: patch.reading ?? previous?.reading ?? "unread",
		staged: patch.staged ?? previous?.staged ?? false,
		excluded: patch.excluded ?? previous?.excluded ?? false,
		source: patch.source ?? previous?.source ?? "OpenAlex",
		updatedAt: Date.now(),
	};
	project.paperStates = { ...project.paperStates, [paper.id]: state };
	project.updatedAt = state.updatedAt;
	return state;
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
		version: 1,
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
	const saved = raw as Partial<SavedGraphSnapshot>;
	if (saved.version !== 1 || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges) || !Array.isArray(saved.seedScore) || !Array.isArray(saved.referenceLists) || !Array.isArray(saved.catalog)) return null;
	if (!saved.nodes.some((node) => node?.isSeed && node.id === saved.seedId)) return null;
	try {
		if (saved.nodes.length > 300 || saved.edges.length > 20000 || saved.seedScore.some((entry) => !Array.isArray(entry) || entry.length !== 2)) return null;
		const citationEvidence = new CitationEvidenceStore();
		for (const evidence of Array.isArray(saved.citationEvidence) ? saved.citationEvidence : []) {
			if (evidence && typeof evidence.citingId === "string" && typeof evidence.citedId === "string") citationEvidence.set(evidence);
		}
		return {
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
			? saved.candidateAudit.filter((item) => item && typeof item.id === "string" && typeof item.source === "string" && (item.doi === null || typeof item.doi === "string")).slice(0, 5000)
			: undefined,
		excludedIds: Array.isArray(saved.excludedIds) ? saved.excludedIds.filter((id): id is string => typeof id === "string" && /^W\d+$/i.test(id)).slice(0, 300) : undefined,
		crossCheck: saved.crossCheck ? new Map(saved.crossCheck) : undefined,
		semanticScores: saved.semanticScores ? new Map(saved.semanticScores) : undefined,
		semanticMode: saved.semanticMode,
		semanticModel: saved.semanticModel,
			selectionRank: saved.selectionRank ? new Map(saved.selectionRank) : undefined,
		};
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
			};
		}
		if (project.version !== 1 || (snapshot && snapshot.nodes.length > 300) || (!snapshot && Object.keys(paperStates).length === 0 && !project.deepDives?.length)) continue;
		out[seedId.toUpperCase()] = {
			version: 1,
			seedId: seedId.toUpperCase(),
			name: typeof project.name === "string" ? project.name.slice(0, 120) : snapshot?.nodes.find((node) => node.isSeed)?.title || seedId,
			updatedAt: Number.isFinite(project.updatedAt) ? Number(project.updatedAt) : Number(project.snapshot && (project.snapshot as SavedGraphSnapshot).savedAt) || 0,
			snapshot: snapshot ? project.snapshot as SavedGraphSnapshot : undefined,
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
			currentView: validView(project.currentView) ? project.currentView : undefined,
			views: Array.isArray(project.views) ? project.views.filter(validView).slice(0, 30) : [],
		};
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
