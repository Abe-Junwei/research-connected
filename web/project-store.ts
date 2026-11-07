import { DEFAULT_SETTINGS, type ConnectedPapersSettings } from "../src/settings-model";
import { normalizeProjects } from "../src/project-state";
import { normalizeReadingWorkflow } from "../src/reading-workflow";
import { prepareWebSettings } from "../src/source-quality";
import { writeWebProjectSettings } from "./storage";

export function loadWebSettings(key: string): ConnectedPapersSettings {
	const raw = window.localStorage.getItem(key);
	const value: unknown = raw ? JSON.parse(raw) : {};
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("项目存储格式无法识别，请重新建图。");
	const settings = Object.assign(structuredClone(DEFAULT_SETTINGS), value);
	settings.researchProjects = normalizeProjects(settings.researchProjects);
	settings.readingWorkflow = normalizeReadingWorkflow(settings.readingWorkflow);
	if (!Array.isArray(settings.stagedPapers)) throw new Error("文献存储格式无法识别，请重新建图。");
	settings.apiKey = "system-proxy";
	settings.contactEmail = "";
	prepareWebSettings(settings);
	return settings;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function mergeEntries<T extends object>(before: T, next: T, live: T): T {
	const merged = { ...live };
	for (const key of new Set([...Object.keys(before), ...Object.keys(next)]) as Set<keyof T>) {
		if (same(before[key], next[key])) continue;
		if (!same(before[key], live[key]) && !same(next[key], live[key])) throw new Error("另一标签页已更新相同数据，已保留最新项目；请重新操作。");
		if (key in next) Object.defineProperty(merged, key, { value: next[key], enumerable: true, configurable: true, writable: true });
		else delete merged[key];
	}
	return merged;
}

/** Merge only this tab's changes under a browser-wide write lock. Never overwrite a stale peer project. */
export function createWebSettingsStore(key: string, settings: ConnectedPapersSettings, assertWrite: (projects: string[]) => void) {
	let baseline = structuredClone(settings);
	function adopt(next: ConnectedPapersSettings): void {
		for (const field of Object.keys(settings)) delete (settings as unknown as Record<string, unknown>)[field];
		Object.assign(settings, structuredClone(next));
		baseline = structuredClone(next);
	}
	return {
		refresh(force = false): boolean {
			if (!force && !same(settings, baseline)) return false;
			const next = loadWebSettings(key);
			if (same(next, baseline)) return false;
			adopt(next);
			return true;
		},
		async persist(): Promise<void> {
			const commit = (): void => {
				let live = baseline;
				try {
					live = loadWebSettings(key);
					const changed = [...new Set([...Object.keys(baseline.researchProjects), ...Object.keys(settings.researchProjects)])]
						.filter(id => !same(baseline.researchProjects[id], settings.researchProjects[id]));
					assertWrite(changed);
					const merged = mergeEntries(
						{ ...baseline, researchProjects: live.researchProjects, readingWorkflow: live.readingWorkflow },
						{ ...settings, researchProjects: live.researchProjects, readingWorkflow: live.readingWorkflow }, live);
					merged.researchProjects = mergeEntries(baseline.researchProjects, settings.researchProjects, live.researchProjects);
					if (baseline.readingWorkflow || settings.readingWorkflow || live.readingWorkflow) {
						merged.readingWorkflow = { version: 1, records: mergeEntries(baseline.readingWorkflow?.records ?? {}, settings.readingWorkflow?.records ?? {}, live.readingWorkflow?.records ?? {}) };
					}
					merged.researchProjects = normalizeProjects(merged.researchProjects);
					merged.readingWorkflow = normalizeReadingWorkflow(merged.readingWorkflow);
					prepareWebSettings(merged);
					writeWebProjectSettings(key, merged);
					adopt(merged);
				} catch (error) {
					adopt(live);
					throw error;
				}
			};
			if (navigator.locks) await navigator.locks.request("research-connected-project-write", commit);
			else commit();
		},
	};
}
