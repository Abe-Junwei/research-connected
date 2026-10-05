import type { PaperNode } from "./types";

export interface StagedPaper {
	seedId: string;
	paper: PaperNode;
	source: string;
	addedAt: string;
	read: boolean;
}

export function stageKey(item: Pick<StagedPaper, "seedId" | "paper">): string {
	return `${item.seedId}\0${item.paper.id}`;
}

export function toggleStaged(items: readonly StagedPaper[], paper: PaperNode, seedId: string, source: string): StagedPaper[] {
	const key = `${seedId}\0${paper.id}`;
	if (items.some((item) => stageKey(item) === key)) return items.filter((item) => stageKey(item) !== key);
	return [...items, { seedId, paper, source, addedAt: new Date().toISOString(), read: false }];
}
