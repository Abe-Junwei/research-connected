import type { ConnectedPapersSettings } from "./settings-model";
import { OpenAlexClient, toPaper, type GetJson, type RawWork } from "./openalex";
import { shortId } from "./paper";
import { restoreGraphSnapshot, saveGraphSnapshot } from "./project-state";
import { applyWebSourceRecord, prepareWebSettings, prepareWebGraph, screenWebResponse, webPaperRecords, WEB_QUALITY_VERSION, type WebRecord } from "./source-quality";
import { tr } from "./i18n";

const ID_FIELDS = new Set(["seedId", "parentId", "paperId", "selectedId", "citingId", "citedId", "researchId", "externalId", "canonicalId"]);
const ID_LISTS = new Set(["ids", "sampleIds", "excludedIds", "coCitationContextIds", "semanticVectorIds", "contextIds", "separatedIds", "identityConflicts"]);
const ID_MAPS = new Set(["paperStates", "versionStates", "identityOriginalStates", "versions", "graftedBySeed"]);
const ID_PAIRS = new Set(["referenceLists", "rawReferenceLists", "canonicalIds", "seedScore", "semanticScores", "selectionRank", "crossCheck"]);

/** Only identifier-bearing schema fields change; titles, project names and note contents never do. */
export function remapWebIds(settings: ConnectedPapersSettings, aliases: ReadonlyMap<string, string>): ConnectedPapersSettings {
	const resolve = (id: string): string => {
		const seen = new Set<string>();
		while (aliases.has(id)) {
			if (seen.has(id)) throw new Error(tr("规范 ID 别名循环，原数据已保留", "Canonical ID cycle; original data retained"));
			seen.add(id);
			id = aliases.get(id)!;
		}
		return id;
	};
	const conflict = (id: string): never => { throw new Error(tr(`规范 ID ${id} 的整理状态冲突，自动迁移已暂停，原数据已保留；请先统一两侧阅读、收藏或排除状态后重试。`, `Conflicting personal state for canonical ID ${id}; migration stopped and original data retained. Reconcile reading, saved and excluded states before retrying.`)); };
	const combine = (left: unknown, right: unknown, id: string): unknown => {
		if (JSON.stringify(left) === JSON.stringify(right)) return right;
		if (Array.isArray(left) && Array.isArray(right)) return [...new Map([...(left as unknown[]), ...(right as unknown[])].map(value => [JSON.stringify(value), value])).values()];
		if (!left || !right || typeof left !== "object" || typeof right !== "object" || !("paper" in left) || !("paper" in right)) return conflict(id);
		const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
		for (const field of ["reading", "staged", "excluded"]) if (field in a && field in b && a[field] !== b[field]) return conflict(id);
		const notes = { ...(a.notes as Record<string, unknown> ?? {}) };
		for (const [path, note] of Object.entries(b.notes as Record<string, unknown> ?? {})) {
			if (path in notes && JSON.stringify(notes[path]) !== JSON.stringify(note)) return conflict(id);
			notes[path] = note;
		}
		const latest = Number(a.updatedAt ?? 0) > Number(b.updatedAt ?? 0) ? a : b;
		const sources = [...(Array.isArray(a.sources) ? a.sources as unknown[] : []), ...(Array.isArray(b.sources) ? b.sources as unknown[] : [])];
		for (const state of [a, b]) if (typeof state.source === "string") sources.push({ source: state.source, reading: state.reading ?? null });
		return { ...a, ...b, ...latest, ...(Object.keys(notes).length ? { notes } : {}), ...(sources.length ? { sources: [...new Map(sources.map(value => [JSON.stringify(value), value])).values()] } : {}) };
	};
	const visit = (value: unknown, field = ""): unknown => {
		if (Array.isArray(value)) {
			if (field === "confirmedGroups" || field === "wholeRules") return value.map(group => visit(group, "ids"));
			if (ID_LISTS.has(field) || field === "grafted-members") return [...new Set(value.map(item => typeof item === "string" ? resolve(item) : visit(item)))];
			if (ID_PAIRS.has(field)) return value.map(pair => Array.isArray(pair) ? [typeof pair[0] === "string" ? resolve(pair[0]) : pair[0], field === "referenceLists" ? visit(pair[1], "ids") : field === "canonicalIds" && typeof pair[1] === "string" ? resolve(pair[1]) : visit(pair[1])] : visit(pair));
			const rows = value.map(item => visit(item));
			if (["nodes", "catalog", "manualPapers", "records"].includes(field)) {
				const keyed = new Map<string, Record<string, unknown>>();
				for (const row of rows) {
					if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string") continue;
					const prior = keyed.get(row.id);
					keyed.set(row.id, { ...row, ...(prior?.isSeed ? { isSeed: true, origin: "seed" } : {}) });
				}
				return [...keyed.values()];
			}
			return rows;
		}
		if (!value || typeof value !== "object") return typeof value === "string" && ID_FIELDS.has(field) ? resolve(value) : value;
		const input = value as Record<string, unknown>, output: Record<string, unknown> = {};
		const paper = typeof input.title === "string" && typeof input.id === "string" && Array.isArray(input.authorList);
		const edge = typeof input.source === "string" && typeof input.target === "string";
		const keyed = ID_MAPS.has(field) || field === "records";
		for (const [key, item] of Object.entries(input)) {
			const target = keyed && /^W\d+$/.test(key) ? resolve(key) : key;
			const next = key === "notes" || key === "webSource" ? structuredClone(item) : paper && key === "id" && typeof item === "string" || edge && (key === "source" || key === "target") && typeof item === "string" ? resolve(item) : visit(item, field === "graftedBySeed" ? "grafted-members" : key);
			output[target] = target in output ? combine(output[target], next, target) : next;
		}
		return output;
	};
	return visit(settings) as ConnectedPapersSettings;
}

/** Runs before mounting the UI, so asynchronous source updates cannot overwrite in-flight edits. */
export async function revalidateWebSettings(settings: ConnectedPapersSettings, get: GetJson, commit: (next: ConnectedPapersSettings) => void | Promise<void>, now = Date.now()): Promise<{ notice: string; complete: boolean } | null> {
	const working = structuredClone(settings);
	const papers = webPaperRecords(working);
	const due = new Set(papers.filter(paper => /^W\d+$/.test(paper.id) && ((paper as WebRecord).webSource?.version !== WEB_QUALITY_VERSION || now - ((paper as WebRecord).webSource?.checkedAt ?? 0) >= 86400000)).map(paper => paper.id));
	if (!due.size) return null;
	const deadline = Date.now() + 20000;
	const boundedGet: GetJson = async (url, init) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("Source review timed out");
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([get(url, init), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Source review timed out")), remaining); })]);
		} finally { clearTimeout(timer); }
	};
	const client = new OpenAlexClient(boundedGet, settings);
	const fresh = new Map<string, RawWork>();
	const aliases = new Map<string, string>();
	const failed = new Set<string>();
	try {
		const ids = [...due];
		let retrievalError: Error | undefined;
		for (let at = 0; at < ids.length; at += 80) {
			const chunk = ids.slice(at, at + 80);
			try {
				for (const raw of await client.papersByIds(chunk)) if (raw.id) fresh.set(shortId(raw.id), raw);
			} catch (error) {
				retrievalError = error instanceof Error ? error : new Error(String(error));
				for (const id of chunk) failed.add(id);
			}
			if (Date.now() >= deadline) { for (const id of ids.slice(at + 80)) failed.add(id); break; }
		}
		for (const id of due) {
			if (fresh.has(id) || failed.has(id)) continue;
			try {
				const raw = await client.workById(id);
				if (!raw.id || !/^W\d+$/.test(shortId(raw.id))) { failed.add(id); continue; }
				fresh.set(id, raw);
				if (shortId(raw.id) !== id) aliases.set(id, shortId(raw.id));
			} catch { failed.add(id); }
		}
		if (!fresh.size) throw retrievalError ?? new Error(tr("未取得可用来源记录", "No source records retrieved"));
		for (const paper of papers) {
			if (!due.has(paper.id)) continue;
			const raw = fresh.get(paper.id);
			if (!raw) continue;
			const screened = screenWebResponse(structuredClone(raw), new URL("https://api.openalex.org/works")) as RawWork;
			const next = toPaper(screened, paper.origin);
			if (next) applyWebSourceRecord(paper, next, paper.id, now);
			else { failed.add(paper.id); aliases.delete(paper.id); }
		}
		const next = remapWebIds(working, aliases);
		const web = next as ConnectedPapersSettings & { webAliases?: Record<string, { canonicalId: string; observedAt: number; source: "openalex" }> };
		if (aliases.size) {
			web.webAliases ??= {};
			for (const [requestedId, canonicalId] of aliases) web.webAliases[requestedId] = { canonicalId, observedAt: now, source: "openalex" };
		}
		prepareWebSettings(next);
		const sourceReferences = new Map([...fresh.values()].filter(raw => raw.id && Array.isArray(raw.referenced_works)).map(raw => [shortId(raw.id!), raw.referenced_works!.map(shortId).map(id => aliases.get(id) ?? id)]));
		for (const project of Object.values(next.researchProjects)) {
			if (!project.snapshot) continue;
			const graph = restoreGraphSnapshot(project.snapshot);
			if (!graph) throw new Error(tr("更新后的项目无法完整恢复，原数据已保留", "Updated project could not be restored; original data retained"));
			const refs = new Map(graph.referenceLists);
			for (const [id, values] of sourceReferences) if (refs.has(id) || graph.nodes.some(paper => paper.id === id) || graph.catalog.some(paper => paper.id === id)) {
				if (JSON.stringify(refs.get(id) ?? []) !== JSON.stringify(values)) for (const paper of [...graph.nodes, ...graph.catalog].filter(paper => paper.id === id)) {
					const source = (paper as WebRecord).webSource;
					if (source) source.recompute = true;
				}
				refs.set(id, values);
			}
			graph.referenceLists = refs;
			graph.edges = [];
			if (graph.workIdentity) {
				graph.workIdentity.referenceLists = [...refs].map(([id, values]) => [id, [...values]]);
				graph.workIdentity.directEdges = [];
			}
			if (prepareWebGraph(graph)) project.snapshot = saveGraphSnapshot(graph);
		}
		await commit(next);
		Object.assign(settings, next);
		return { complete: failed.size === 0, notice: tr(`已核对 ${due.size - failed.size} 条来源，迁移 ${aliases.size} 个规范 ID${failed.size ? `；${failed.size} 条未完成，保留旧信息` : ""}。个人整理状态已保留；有变更的现有成员已重算，重新加载可重采样。`, `Checked ${due.size - failed.size} source records and migrated ${aliases.size} canonical IDs${failed.size ? `; ${failed.size} checks incomplete, previous metadata retained` : ""}. Personal state retained; changed existing members rescored, Reload resamples candidates.`) };
	} catch (error) {
		return { complete: false, notice: tr(`来源更新未保存，继续使用原项目：${error instanceof Error ? error.message : String(error)}`, `Source update was not saved; using the original projects: ${error instanceof Error ? error.message : String(error)}`) };
	}
}
