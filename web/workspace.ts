import type { ConnectedPapersSettings } from "../src/settings-model";

export const WORKSPACE_STORAGE_KEY = "research-connected-web-workspace-v1";
export const LEGACY_STORAGE_KEY = "research-connected-web-settings";
export const WORKSPACE_LOCK = "single-workspace";

/** Old clients can only write the retired namespace, never the new workspace. */
export function removeLegacyWorkspace(storage: Pick<Storage, "removeItem">): void {
	storage.removeItem(LEGACY_STORAGE_KEY);
	storage.removeItem(`${LEGACY_STORAGE_KEY}-before-source-review`);
}

export function clearWorkspaceRecords(settings: ConnectedPapersSettings): void {
	settings.researchProjects = {};
	settings.stagedPapers = [];
	settings.graftedBySeed = {};
	delete settings.readingWorkflow;
	delete settings.workflowMigration;
	delete settings.workIdentityDecisions;
	delete settings.sourceVersionRelations;
}
