import { tr } from "./i18n";
import type { ConnectedPapersSettings } from "./settings-model";
import { projectWriteKey, readNoteReading, updateProjectPaperState, type ReadingStatus } from "./project-state";
import { paperDois, paperRecords, sourceVersionGroups } from "./work-identity";
import type { PaperNode } from "./types";

export interface ReadingSource { source: string; reading: ReadingStatus | null; raw?: unknown }
export interface ReadingNote { path: string; raw: unknown; revision: string }
export interface ReadingNoteState extends ReadingNote {
	participating: boolean;
	issue?: "failed" | "edited" | "invalid";
	error?: string;
	attempts: number;
}
export interface ReadingRecord {
	paper: PaperNode;
	reading: ReadingStatus | null;
	sources: ReadingSource[];
	notes: Record<string, ReadingNoteState>;
	updatedAt: number;
}
export interface ReadingWorkflowStore { version: 1; records: Record<string, ReadingRecord> }
export interface ReadingIssue {
	paper: PaperNode;
	kind: "conflict" | "note";
	reading: ReadingStatus | null;
	sources: ReadingSource[];
	projects: Array<{ id: string; name: string }>;
	notes: ReadingNoteState[];
}
export interface ReadingWorkflowDeps {
	readingOpened?(paper: PaperNode): Promise<void>;
	getReadingState(paper: PaperNode): { reading: ReadingStatus | null; confirmed: boolean; sources: ReadingSource[] };
	commitWorkflow(paper: PaperNode, seedId: string | null, patch: { reading?: ReadingStatus; staged?: boolean }, projectKey?: string): Promise<void>;
	getReadingIssues(): ReadingIssue[];
	resolveReading(paper: PaperNode, reading: ReadingStatus): Promise<void>;
	retryReading(paper?: PaperNode): Promise<void>;
}
export interface ReadingWorkflowOptions {
	getSettings(): ConnectedPapersSettings;
	persist(): Promise<void> | void;
	listNotes?(paper: PaperNode): ReadingNote[];
	listPapers?(): PaperNode[];
	writeNote?(path: string, expected: ReadingNote, reading: ReadingStatus): Promise<string>;
	notify?(): void;
}
const emptyStore = (): ReadingWorkflowStore => ({ version: 1, records: {} });
const valid = (value: unknown): value is ReadingStatus => value === "unread" || value === "to-read" || value === "read";
const matches = (left: PaperNode, right: PaperNode): boolean => {
	const ids = new Set(paperRecords(left).map(record => record.id));
	const dois = paperDois(left);
	return paperRecords(right).some(record => ids.has(record.id)) || paperDois(right).some(doi => dois.includes(doi));
};

export function normalizeReadingWorkflow(value: unknown): ReadingWorkflowStore | undefined {
	if (value === undefined) return undefined;
	const candidate = value as ReadingWorkflowStore | null;
	if (!candidate || candidate.version !== 1 || !candidate.records || typeof candidate.records !== "object" || Array.isArray(candidate.records)) throw new Error(tr("保存的阅读流程无效，已保留原数据", "Invalid saved reading workflow; original data retained"));
	for (const record of Object.values(candidate.records)) {
		if (!record?.paper?.id || !Array.isArray(record.paper.concepts) || !(record.reading === null || valid(record.reading)) || !Array.isArray(record.sources) || !record.notes || typeof record.notes !== "object" || !Number.isFinite(record.updatedAt)) throw new Error(tr("保存的阅读记录无效，已保留原数据", "Invalid saved reading record; original data retained"));
		for (const source of record.sources) if (typeof source.source !== "string" || !(source.reading === null || valid(source.reading))) throw new Error(tr("阅读状态来源无效", "Invalid reading source"));
		for (const note of Object.values(record.notes)) if (typeof note.path !== "string" || typeof note.revision !== "string" || typeof note.participating !== "boolean" || !Number.isFinite(note.attempts) || (note.issue !== undefined && !["failed", "edited", "invalid"].includes(note.issue))) throw new Error(tr("笔记同步记录无效", "Invalid note sync record"));
	}
	return candidate;
}

export function createReadingWorkflow(options: ReadingWorkflowOptions): ReadingWorkflowDeps & { refreshReading(): Promise<void>; readingOpened(paper: PaperNode): Promise<void> } {
	let pending = Promise.resolve();
	const sessionAttempts = new Map<string, number>();
	const enqueue = (action: () => Promise<void>): Promise<void> => {
		const next = pending.catch(() => {}).then(action);
		pending = next;
		return next;
	};
	const store = (): ReadingWorkflowStore => options.getSettings().readingWorkflow ?? emptyStore();
	const collect = (paper: PaperNode): ReadingRecord => {
		const settings = options.getSettings();
		const manual = [...(settings.workIdentityDecisions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).find(item => item.ids.includes(paper.id));
		const ids = sourceVersionGroups(settings.sourceVersionRelations, settings.workIdentityDecisions).find(ids => ids.includes(paper.id));
		const decision = manual?.kind === "separate" ? manual : ids ? { ids, kind: "merge" as const } : manual;
		if (decision?.kind === "merge") {
			const catalog = [...Object.values(settings.researchProjects).flatMap(project => project.snapshot?.workIdentity?.records ?? project.snapshot?.catalog.flatMap(paperRecords) ?? []), ...Object.values(store().records).flatMap(record => paperRecords(record.paper)), ...paperRecords(paper)];
			const versions = [...new Map(catalog.filter(version => decision.ids.includes(version.id)).map(version => [version.id, version])).values()];
			if (versions.length > 1) paper = { ...paper, records: versions };
		}
		const existing = Object.values(store().records).filter(record => matches(record.paper, paper));
		if (existing.length === 1 && paperRecords(paper).every(version => paperRecords(existing[0]!.paper).some(saved => saved.id === version.id))) {
			return decision?.kind === "separate" ? { ...existing[0]!, paper } : existing[0]!;
		}
		if (existing.length) {
			const priorMerge = existing.find(record => paperRecords(record.paper).length > 1);
			const rank: Record<ReadingStatus, number> = { unread: 0, "to-read": 1, read: 2 };
			const values = existing.map(record => record.reading);
			const conflict = values.includes(null) || Boolean(priorMerge && values.some(value => value !== priorMerge.reading));
			const reading = conflict ? null : values.filter(valid).sort((a, b) => rank[b] - rank[a])[0] ?? "unread";
			return { paper, reading, sources: existing.flatMap(record => [...record.sources, { source: `reading:${record.paper.id}`, reading: record.reading }]), notes: Object.assign({}, ...existing.map(record => record.notes)) as Record<string, ReadingNoteState>, updatedAt: Math.max(...existing.map(record => record.updatedAt)) };
		}
		const sources: ReadingSource[] = [];
		for (const project of Object.values(options.getSettings().researchProjects)) {
			for (const state of Object.values(project.paperStates ?? {})) {
				if (matches(state.paper, paper)) sources.push({ source: project.name || project.seedId, reading: state.reading });
			}
		}
		const notes: Record<string, ReadingNoteState> = {};
		for (const note of options.listNotes?.(paper) ?? []) {
			const field = readNoteReading(note.raw, null);
			notes[note.path] = { ...note, participating: field.kind !== "removed", attempts: 0, ...(field.kind === "invalid" ? { issue: "invalid" as const } : {}) };
			if (field.kind === "human") sources.push({ source: note.path, reading: field.reading, raw: note.raw });
			else if (field.kind === "invalid") sources.push({ source: note.path, reading: null, raw: note.raw });
		}
		const values = [...new Set(sources.map(source => source.reading).filter(valid))];
		return { paper, sources, notes, reading: values.length > 1 ? null : values[0] ?? "unread", updatedAt: 0 };
	};
	const save = async (record: ReadingRecord, seedId: string | null = null, staged?: boolean, selectedProjectKey?: string, stagedPaper = record.paper): Promise<void> => {
		const settings = options.getSettings();
		const before = settings.readingWorkflow;
		const projects = settings.researchProjects;
		const records = { ...store().records };
		for (const [id, current] of Object.entries(records)) if (matches(current.paper, record.paper)) {
			delete records[id];
			const remaining = paperRecords(current.paper).filter(version => !matches(version, record.paper));
			if (remaining.length) { const paper: PaperNode = { ...remaining[0]!, ...(remaining.length > 1 ? { records: remaining } : {}) }; records[paper.id] = { ...current, paper }; }
		}
		const next: ReadingWorkflowStore = { version: 1, records: { ...records, [record.paper.id]: record } };
		let projectKey: string | null = null;
		if (staged !== undefined && seedId) {
			projectKey = selectedProjectKey ?? projectWriteKey(projects, seedId);
			settings.researchProjects = { ...projects };
			const project = projects[projectKey];
			if (project) settings.researchProjects[projectKey] = { ...project, paperStates: { ...project.paperStates }, versionStates: { ...(project.versionStates ?? project.paperStates) } };
			updateProjectPaperState(settings.researchProjects, seedId, stagedPaper, { staged }, selectedProjectKey);
		}
		settings.readingWorkflow = next;
		try { await options.persist(); }
		catch (error) {
			if (settings.readingWorkflow === next) settings.readingWorkflow = before;
			if (projectKey) {
				for (const states of [settings.researchProjects[projectKey]?.paperStates, settings.researchProjects[projectKey]?.versionStates]) {
					const previous = (projects[projectKey]?.versionStates ?? projects[projectKey]?.paperStates)?.[stagedPaper.id];
					const current = states?.[stagedPaper.id];
					if (states && current) {
						if (!previous && !current.excluded) delete states[stagedPaper.id];
						else states[stagedPaper.id] = { ...current, staged: previous?.staged ?? false };
					}
				}
			}
			throw error;
		}
		options.notify?.();
	};
	const observeNotes = (record: ReadingRecord): void => {
		const listed = options.listNotes?.(record.paper);
		if (!listed) return;
		const live = new Set(listed.map(note => note.path));
		for (const path of Object.keys(record.notes)) if (!live.has(path)) delete record.notes[path];
		for (const note of listed) {
			const previous = record.notes[note.path];
			const field = readNoteReading(note.raw, previous && valid(previous.raw) ? previous.raw : null);
			if ((!previous || JSON.stringify(previous.raw) !== JSON.stringify(note.raw)) && !record.sources.some(source => source.source === note.path && JSON.stringify(source.raw) === JSON.stringify(note.raw))) {
				record.sources.push({ source: note.path, reading: valid(note.raw) ? note.raw : null, raw: note.raw });
			}
			if (field.kind === "removed") record.notes[note.path] = { ...note, participating: false, attempts: 0 };
			else if (field.kind === "invalid") record.notes[note.path] = { ...note, participating: true, attempts: 0, issue: "invalid" };
			else if (!previous || previous.raw !== note.raw || (previous.issue === "failed" && previous.revision !== note.revision)) {
				record.notes[note.path] = { ...note, participating: true, attempts: 0, ...(field.reading !== record.reading || previous?.issue === "failed" ? { issue: "edited" as const } : {}) };
			} else record.notes[note.path] = { ...previous, revision: note.revision };
		}
	};
	const synchronize = async (input: ReadingRecord): Promise<void> => {
		const record = structuredClone(input);
		observeNotes(record);
		if (record.reading !== null && options.writeNote) {
			for (const note of Object.values(record.notes)) {
				const key = `${record.paper.id}\0${note.path}\0${note.revision}\0${record.reading}`;
				if (!note.participating || note.issue === "invalid" || note.issue === "edited" || (sessionAttempts.get(key) ?? 0) >= 3) continue;
				if (note.raw === record.reading && !note.issue) continue;
				sessionAttempts.set(key, (sessionAttempts.get(key) ?? 0) + 1);
				try {
					const revision = await options.writeNote(note.path, note, record.reading);
					note.raw = record.reading;
					note.revision = revision;
					delete note.issue;
					delete note.error;
					note.attempts = 0;
				} catch (error) {
					note.issue = "failed";
					note.error = error instanceof Error ? error.message : String(error);
					note.attempts += 1;
				}
			}
		}
		if (JSON.stringify(record) !== JSON.stringify(input)) await save(record);
	};
	const commit = (paper: PaperNode, seedId: string | null, patch: { reading?: ReadingStatus; staged?: boolean }, projectKey?: string): Promise<void> => enqueue(async () => {
		if (patch.reading !== undefined && !valid(patch.reading)) throw new Error(tr("阅读状态无效", "Invalid reading status"));
		if (patch.staged !== undefined && !seedId) throw new Error(tr("请先选择项目再保存论文", "A project is required to save a paper"));
		const record = structuredClone(collect(paper));
		if (patch.reading !== undefined) {
			observeNotes(record);
			for (const note of Object.values(record.notes)) if (note.issue === "edited") delete note.issue;
			record.reading = patch.reading;
			record.updatedAt = Date.now();
		}
		await save(record, seedId, patch.staged, projectKey, paper);
		if (patch.reading !== undefined) {
			try { await synchronize(record); }
			catch (error) { throw new Error(tr(`阅读状态已保存；笔记同步记录保存失败，请重试：${error instanceof Error ? error.message : String(error)}`, `Reading status was saved, but the note sync record could not be saved. Retry: ${error instanceof Error ? error.message : String(error)}`)); }
		}
	});
	const papers = (): PaperNode[] => {
		const found = new Map(Object.values(store().records).map(record => [record.paper.id, record.paper]));
		for (const paper of options.listPapers?.() ?? []) found.set(paper.id, paper);
		for (const project of Object.values(options.getSettings().researchProjects)) {
			for (const state of Object.values(project.paperStates ?? {})) found.set(state.paper.id, state.paper);
		}
		return [...found.values()].filter((paper, index, all) => all.findIndex(other => matches(other, paper)) === index);
	};
	return {
		getReadingState(paper) {
			const record = collect(paper);
			return { reading: record.reading, confirmed: record.reading !== null, sources: record.sources };
		},
		commitWorkflow: commit,
		resolveReading: (paper, reading) => commit(paper, null, { reading }),
		getReadingIssues() {
			return papers().flatMap(paper => {
				const record = collect(paper);
				const notes = Object.values(record.notes).filter(note => note.issue);
				if (record.reading !== null && !notes.length) return [];
				const projects = Object.entries(options.getSettings().researchProjects)
					.filter(([, project]) => Object.values(project.paperStates ?? {}).some(state => matches(state.paper, paper)) || project.snapshot?.nodes.some(node => matches(node, paper)))
					.map(([id, project]) => ({ id, name: project.name }));
				return [{ paper, kind: record.reading === null ? "conflict" as const : "note" as const, reading: record.reading, sources: record.sources, projects, notes }];
			});
		},
		retryReading: paper => enqueue(async () => {
			for (const target of paper ? [paper] : papers()) await synchronize(collect(target));
		}),
		refreshReading: () => enqueue(async () => {
			for (const paper of papers()) {
				const record = collect(paper);
				if (store().records[record.paper.id] !== record) await save(record);
				await synchronize(record);
			}
		}),
		readingOpened: paper => enqueue(async () => {
			const record = collect(paper);
			if (store().records[record.paper.id] !== record) await save(record);
			await synchronize(record);
		}),
	};
}
