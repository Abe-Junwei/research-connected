import type { ConnectedPapersSettings } from "../src/settings-model";
import type { ResearchProject, SavedGraphSnapshot } from "../src/project-state";
import type { PaperRecord } from "../src/types";

export type PreviewStorageMode = "full" | "newest" | "slim" | "none";

function isQuota(error: unknown): boolean {
	return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

function withoutAbstract<T extends PaperRecord>(paper: T): T {
	return paper.abstract ? { ...paper, abstract: "" } : paper;
}

function slimSnapshot(snapshot: SavedGraphSnapshot): SavedGraphSnapshot {
	return {
		...snapshot,
		nodes: snapshot.nodes.map(withoutAbstract),
		catalog: snapshot.catalog.map(withoutAbstract),
		referenceLists: [],
		rawReferenceLists: undefined,
		citationEvidence: [],
		workIdentity: snapshot.workIdentity ? {
			...snapshot.workIdentity,
			records: snapshot.workIdentity.records.map(withoutAbstract),
			referenceLists: [],
			evidence: [],
		} : undefined,
	};
}

/** localStorage is about 5MB. Full graphs stay in memory; only the stored copy is reduced. */
export function previewStorageJson(settings: ConnectedPapersSettings, mode: PreviewStorageMode): string {
	if (mode === "full") return JSON.stringify(settings);
	const projects = Object.entries(settings.researchProjects);
	const newest = projects.reduce<string | null>((best, [key, project]) => !best || project.updatedAt > (settings.researchProjects[best]?.updatedAt ?? 0) ? key : best, null);
	const researchProjects: Record<string, ResearchProject> = {};
	for (const [key, project] of projects) {
		if (mode === "none" || (mode === "newest" && key !== newest)) researchProjects[key] = { ...project, snapshot: undefined };
		else if (mode === "slim" && project.snapshot) researchProjects[key] = { ...project, snapshot: slimSnapshot(project.snapshot) };
		else researchProjects[key] = project;
	}
	return JSON.stringify({ ...settings, researchProjects });
}

export function writePreviewSettings(key: string, settings: ConnectedPapersSettings, legacyKey?: string): void {
	let droppedLegacy = false;
	let last: unknown;
	const modes: PreviewStorageMode[] = ["full", "newest", "slim", "none"];
	for (const mode of modes) {
		try {
			window.localStorage.setItem(key, previewStorageJson(settings, mode));
			return;
		} catch (error) {
			last = error;
			if (!isQuota(error)) throw error;
			if (legacyKey && !droppedLegacy) {
				window.localStorage.removeItem(legacyKey);
				droppedLegacy = true;
			}
		}
	}
	throw last;
}
