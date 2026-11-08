import { normalizeProjects, type ResearchProject } from "../src/project-state";
import { normalizeReadingWorkflow } from "../src/reading-workflow";
import { validSourceVersionRelations } from "../src/work-identity";
import type { ConnectedPapersSettings } from "../src/settings-model";

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export interface WorkspaceData {
 project: ResearchProject | null;
 readingWorkflow?: ConnectedPapersSettings["readingWorkflow"];
 workIdentityDecisions?: ConnectedPapersSettings["workIdentityDecisions"];
 sourceVersionRelations?: ConnectedPapersSettings["sourceVersionRelations"];
}
export interface WorkspaceBackup { format: "wenxian-workspace"; version: 1; createdAt: string; data: WorkspaceData }
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function invalid(): never { throw new Error("备份格式无效或包含不受支持的数据；原工作区未更改。 / Invalid backup; workspace retained."); }
const id = (v: unknown): boolean => typeof v === "string" && /^W\d+$/i.test(v);
const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
function list(v: unknown, max = 200000): unknown[] { if (!Array.isArray(v) || v.length > max) invalid(); return v; }
function strings(v: unknown, max = 200000): void { if (!list(v, max).every(x => typeof x === "string")) invalid(); }
function topic(v: unknown): void {
 if (!object(v) || typeof v.id !== "string" || typeof v.name !== "string" || !finite(v.score)) invalid();
 for (const key of ["subfield", "field", "domain"]) if (v[key] !== undefined) { const part = v[key]; if (!object(part) || typeof part.id !== "string" || typeof part.name !== "string") invalid(); }
}
function paper(v: unknown): void {
 if (!object(v) || !id(v.id) || typeof v.title !== "string" || typeof v.authors !== "string" || typeof v.abstract !== "string" || typeof v.openAlexUrl !== "string" || typeof v.isSeed !== "boolean" || !["seed", "reference", "citation", "related"].includes(String(v.origin)) || !(v.year === null || finite(v.year)) || !finite(v.citedByCount)) invalid();
 strings(v.authorList, 10000); strings(v.concepts, 10000);
 if (typeof v.retracted !== "boolean") invalid();
 if (v.sourceAliases !== undefined) strings(v.sourceAliases, 10000);
 if (v.topicTags !== undefined) for (const tag of list(v.topicTags, 10000)) topic(tag);
 if (v.primaryTopic !== undefined && v.primaryTopic !== null) topic(v.primaryTopic);
 if (v.bibliography !== undefined) { if (!object(v.bibliography)) invalid(); for (const key of ["volume", "issue", "firstPage", "lastPage"]) if (!(v.bibliography[key] === undefined || v.bibliography[key] === null || typeof v.bibliography[key] === "string")) invalid(); }
 if (v.webMetadataReview !== undefined) { if (!object(v.webMetadataReview)) invalid(); if (v.webMetadataReview.evidence !== undefined) strings(v.webMetadataReview.evidence, 10000); }
 for (const field of ["doiUrl", "language", "workType", "venue"]) if (!(v[field] === null || typeof v[field] === "string")) invalid();
 if (v.editorList !== undefined) strings(v.editorList, 10000);
 if (v.records !== undefined) for (const record of list(v.records, 10000)) { if (!object(record) || record.records !== undefined) invalid(); paper(record); }
}
function view(v: unknown): void {
 if (!object(v) || typeof v.name !== "string" || !["force2d", "temporal", "radial"].includes(String(v.layout)) || !finite(v.updatedAt) || !finite(v.zoom) || Number(v.zoom) <= 0 || !finite(v.centerX) || !finite(v.centerY) || !(v.scrubYear === null || finite(v.scrubYear)) || !(v.selectedId === null || id(v.selectedId))) invalid();
 for (const key of ["leftCollapsed", "rightCollapsed"]) if (v[key] !== undefined && typeof v[key] !== "boolean") invalid();
 if (v.filter !== undefined) {
  const f = v.filter; if (!object(f) || !object(f.kinds) || !["direct", "cocitation", "coupling", "weak"].every(k => typeof f.kinds === "object" && f.kinds !== null && typeof (f.kinds as Record<string, unknown>)[k] === "boolean")) invalid();
  for (const k of ["minCoCitedBy", "minSharedRefs"]) if (!finite(f[k]) || Number(f[k]) < 0) invalid();
  for (const k of ["yearFrom", "yearTo", "scrubYear"]) if (!(f[k] === null || finite(f[k]))) invalid();
  for (const k of ["language", "workType", "concept"]) if (!(f[k] === null || typeof f[k] === "string")) invalid();
 }
}
function pairs(v: unknown, valid: (value: unknown) => boolean): void {
 for (const entry of list(v)) { const pair = list(entry, 2); if (pair.length !== 2 || typeof pair[0] !== "string" || !valid(pair[1])) invalid(); }
}
function evidence(v: unknown): void {
 if (!object(v) || !id(v.citingId) || !id(v.citedId) || !["high", "medium", "low"].includes(String(v.confidence)) || !["background", "method", "extension", "validation", "application", "criticism", "unclear"].includes(String(v.relation))) invalid();
 for (const key of ["sources", "intents", "contexts", "evidenceQuotes"]) strings(v[key], 10000);
}
function snapshot(v: unknown): void {
 if (!object(v) || ![1, 2].includes(Number(v.version)) || !id(v.seedId) || !finite(v.savedAt)) invalid();
 for (const entry of list(v.nodes, 5000)) paper(entry);
 for (const entry of list(v.catalog, 10000)) paper(entry);
 for (const edge of list(v.edges)) if (!object(edge) || typeof edge.source !== "string" || typeof edge.target !== "string" || !finite(edge.weight)) invalid();
 pairs(v.seedScore, finite); pairs(v.referenceLists, x => Array.isArray(x) && x.every(y => typeof y === "string"));
 if (v.rawReferenceLists !== undefined) pairs(v.rawReferenceLists, x => Array.isArray(x) && x.every(ref => object(ref) && ["openalex", "semantic-scholar", "crossref"].includes(String(ref.source)) && typeof ref.externalId === "string" && (ref.doi === undefined || typeof ref.doi === "string")));
 if (v.semanticScores !== undefined) pairs(v.semanticScores, x => x === null || finite(x));
 if (v.selectionRank !== undefined) pairs(v.selectionRank, x => object(x) && finite(x.authority) && finite(x.relevance) && (x.semantic === null || finite(x.semantic)));
 if (v.crossCheck !== undefined) pairs(v.crossCheck, object);
 if (v.citationEvidence !== undefined) for (const item of list(v.citationEvidence)) evidence(item);
 for (const [key, cap] of [["excludedIds", 10000], ["semanticVectorIds", 5000], ["coCitationContextIds", 400]] as const) if (v[key] !== undefined && !list(v[key], cap).every(id)) invalid();
 if (v.candidateAudit !== undefined) for (const item of list(v.candidateAudit, 5000)) if (!object(item) || typeof item.id !== "string" || typeof item.source !== "string" || !(item.doi === null || typeof item.doi === "string")) invalid();
 strings(v.warnings, 10000);
 if (!object(v.strategies) || !["references", "citations", "related"].every(key => typeof (v.strategies as Record<string, unknown>)[key] === "boolean")) invalid();
 if (v.workIdentity !== undefined) {
  const w = v.workIdentity; if (!object(w) || w.version !== 1) invalid();
  for (const entry of list(w.records, 10000)) paper(entry);
  for (const e of list(w.evidence)) evidence(e);
  for (const edge of list(w.directEdges)) if (!object(edge) || !id(edge.source) || !id(edge.target) || !finite(edge.weight)) invalid();
  pairs(w.referenceLists, x => Array.isArray(x) && x.every(y => typeof y === "string"));
  pairs(w.canonicalIds, x => typeof x === "string"); strings(w.separatedIds, 10000);
  if (w.confirmedGroups !== undefined) for (const group of list(w.confirmedGroups, 10000)) { if (!list(group, 10000).every(id)) invalid(); }
  if (w.sourceRelations !== undefined && !validSourceVersionRelations(w.sourceRelations)) invalid();
 }
}
function project(v: unknown): void {
 if (!object(v) || v.version !== 1 || !id(v.seedId) || typeof v.name !== "string" || v.name.length > 120 || !finite(v.updatedAt)) invalid();
 if (v.snapshot === undefined) invalid(); snapshot(v.snapshot);
 if ((v.snapshot as Record<string, unknown>).seedId !== v.seedId) invalid();
 for (const key of ["paperStates", "versionStates", "identityOriginalStates"]) if (v[key] !== undefined) {
  const states = v[key]; if (!object(states) || Object.keys(states).length > 10000) invalid();
  for (const [key, state] of Object.entries(states)) { if (!id(key) || !object(state) || !object(state.paper) || state.paper.id !== key || !["unread", "to-read", "read"].includes(String(state.reading)) || typeof state.staged !== "boolean" || typeof state.excluded !== "boolean" || typeof state.source !== "string" || state.source.length > 300 || !finite(state.updatedAt)) invalid(); paper(state.paper); }
 }
 for (const key of ["currentView", "identityOriginalCurrentView"]) if (v[key] !== undefined) view(v[key]);
 for (const key of ["views", "identityOriginalViews"]) if (v[key] !== undefined) for (const saved of list(v[key], 30)) view(saved);
 for (const key of ["deepDives", "identityOriginalDeepDives"]) if (v[key] !== undefined) for (const batch of list(v[key], 100)) {
  if (!object(batch) || typeof batch.id !== "string" || batch.id.length > 80 || !id(batch.parentId) || !finite(batch.createdAt) || !finite(batch.references) || !finite(batch.citations) || Number(batch.references) < 0 || Number(batch.citations) < 0 || typeof batch.noMore !== "boolean") invalid();
  strings(batch.warnings, 10);
  for (const item of list(batch.additions, 10000)) if (!object(item) || !id(item.paperId) || !["reference", "citation", "shared-reference", "legacy"].includes(String(item.source))) invalid();
 }
 if (v.manualPapers !== undefined) for (const p of list(v.manualPapers, 10000)) paper(p);
 if (v.sampleIds !== undefined && !list(v.sampleIds, 10000).every(id)) invalid();
 for (const key of ["retractedBatchIds", "identityConflicts", "identityReviewedGroups"]) if (v[key] !== undefined) strings(v[key], 10000);
 if (v.pending !== undefined) for (const item of list(v.pending, 10000)) { if (!object(item)) invalid(); if (item.paper !== undefined) paper(item.paper); if (item.sources !== undefined) strings(item.sources, 10000); }
 const normalized = normalizeProjects({ [String(v.seedId)]: v });
 if (!normalized[String(v.seedId)]) invalid();
}
function bounded(value: unknown, depth = 0): void {
 if (depth > 40) invalid();
 if (typeof value === "string" && value.length > 2000000 || typeof value === "number" && !Number.isFinite(value)) invalid();
 if (Array.isArray(value)) { list(value); for (const item of value) bounded(item, depth + 1); }
 else if (object(value)) for (const [key, item] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) invalid(); bounded(item, depth + 1); }
}
export function parseWorkspaceBackup(text: string): WorkspaceBackup {
 if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("备份超过 20 MB / Backup exceeds 20 MB");
 const raw: unknown = JSON.parse(text); bounded(raw);
 if (!object(raw) || raw.format !== "wenxian-workspace" || raw.version !== 1 || typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt)) || !object(raw.data) || Object.keys(raw).some(k => !["format", "version", "createdAt", "data"].includes(k))) invalid();
 const data = raw.data;
 if (Object.keys(data).some(k => !["project", "readingWorkflow", "workIdentityDecisions", "sourceVersionRelations"].includes(k))) invalid();
 if (data.project !== null) project(data.project);
 const workflow = normalizeReadingWorkflow(data.readingWorkflow);
 if (workflow) { if (Object.keys(workflow.records).length > 10000) invalid(); for (const [key, record] of Object.entries(workflow.records)) { if (key !== record.paper.id || !object(record.notes)) invalid(); paper(record.paper); } }
 if (data.workIdentityDecisions !== undefined) for (const decision of list(data.workIdentityDecisions, 10000)) {
  if (!object(decision)) invalid(); const ids = list(decision.ids, 10000);
  if (!ids.every(id) || ids.length < 2 || new Set(ids).size !== ids.length || !["merge", "separate"].includes(String(decision.kind)) || decision.source !== "manual" || !finite(decision.updatedAt)) invalid();
 }
 if (data.sourceVersionRelations !== undefined && (!validSourceVersionRelations(data.sourceVersionRelations) || data.sourceVersionRelations.length > 10000)) invalid();
 return raw as unknown as WorkspaceBackup;
}
export function captureWorkspace(settings: ConnectedPapersSettings, current: ResearchProject | null): WorkspaceBackup {
 const data: WorkspaceData = { project: current, readingWorkflow: settings.readingWorkflow, workIdentityDecisions: settings.workIdentityDecisions, sourceVersionRelations: settings.sourceVersionRelations };
 return parseWorkspaceBackup(JSON.stringify({ format: "wenxian-workspace", version: 1, createdAt: new Date().toISOString(), data }));
}
