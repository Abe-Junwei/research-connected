import { mountGraphApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { nicholsSnapshot, workIdentityFixtureGet } from "../preview/work-identity-fixture";
import type { ResearchProject, SavedGraphSnapshot } from "../src/project-state";
import type { ConnectedPapersSettings } from "../src/settings-model";
import { restoreGraphSnapshot } from "../src/project-state";
import { normalizeDoi } from "../src/paper";
import { changeVersionExclusion, projectVersionState } from "../src/project-state";
import { mountEmbed } from "../src/embed-mount";
import { createReadingWorkflow } from "../src/reading-workflow";

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
async function until(predicate: () => boolean, message: string): Promise<void> {
	for (let index = 0; index < 120; index++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
	throw new Error(message);
}

export async function verifyProjectBrowser(): Promise<void> {
	const snapshot = nicholsSnapshot();
	const oldSeed = snapshot.seedId, nextSeed = snapshot.nodes[1]!.id;
	const initial: ResearchProject = { version: 1, seedId: oldSeed, name: "Stable project", updatedAt: 1, views: [], snapshot };
	const otherSnapshot = { ...structuredClone(snapshot), seedId: nextSeed, nodes: snapshot.nodes.map(paper => ({ ...paper, isSeed: paper.id === nextSeed })), catalog: snapshot.catalog.map(paper => ({ ...paper, isSeed: paper.id === nextSeed })) };
	const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: { W1: initial, W2: { ...structuredClone(initial), seedId: nextSeed, name: "Other project", snapshot: otherSnapshot } } as Record<string, ResearchProject> };
	let failSave = false;
	let failNewProject = false;
	const saveOrigins: Array<{ mount: number; key: string }> = [];
	let holdLeft = false;
	let releaseLeft: (() => void) | undefined;
	const saveProject = async (mount: number, project: ResearchProject, key = project.seedId): Promise<void> => {
		if (failSave || failNewProject && project.seedId === nextSeed) throw new Error("disk full");
		saveOrigins.push({ mount, key });
		settings.researchProjects[key] = project;
		window.dispatchEvent(new Event("research-connected-project"));
	};
	const hosts: [HTMLDivElement, HTMLDivElement] = [document.createElement("div"), document.createElement("div")];
	for (const host of hosts) { host.style.cssText = "width:1200px;height:800px"; document.body.append(host); }
	const handles = hosts.map((host, index) => mountGraphApp(host, { getSettings: () => settings, getJson: async (url, options) => {
		let delayed = false;
		if (index === 0 && holdLeft && new URL(url).pathname.endsWith(`/works/${oldSeed}`)) {
			holdLeft = false;
			delayed = true;
			await new Promise<void>(resolve => { releaseLeft = resolve; });
		}
		const result = await workIdentityFixtureGet(url, options);
		return delayed ? { ...(result as object), display_name: "STALE RESPONSE" } : result;
	}, openExternal() {}, loadSavedProject: () => settings.researchProjects.W1!, saveProject: (project, key) => saveProject(index, project, key) }));
	try {
		const [left, right] = hosts;
		const canvas = left.querySelector<HTMLCanvasElement>("canvas")!;
		const peer = right.querySelector<HTMLCanvasElement>("canvas")!;
		peer.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
		await new Promise(resolve => setTimeout(resolve, 700));
		const peerZoom = peer.dataset.zoom;
		canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
		check(canvas.dataset.selected === nextSeed, "production keyboard selects the alternate seed");
		canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
		const seedAction = Array.from(left.querySelectorAll<HTMLButtonElement>(".cpo-node-menu button")).find(button => button.textContent?.includes("种子"))!;
		check(seedAction && !seedAction.disabled, "production seed-swap action is available");
		seedAction.click();
		await until(() => left.querySelector<HTMLInputElement>(".cpo-input")?.value === nextSeed, "seed action opens the existing target project");
		check(settings.researchProjects.W1?.seedId === oldSeed && settings.researchProjects.W1?.name === "Stable project", "switching projects preserves the source project");
		check(right.querySelector<HTMLInputElement>(".cpo-input")?.value === oldSeed && peer.dataset.zoom === peerZoom, "only the initiating panel switches projects");
		await new Promise(resolve => setTimeout(resolve, 600));
		check(!saveOrigins.some(save => save.key === "W2"), "an old pending gesture cannot autosave into the newly opened target");
		const back = () => Array.from(left.querySelectorAll<HTMLButtonElement>(".cpo-menu-switch")).find(button => button.textContent === "Stable project")!.click();
		back();
		await until(() => left.querySelector<HTMLInputElement>(".cpo-input")?.value === oldSeed, "project list returns to the preserved source project");
		delete settings.researchProjects.W2;
		const openNext = () => {
			for (let index = 0; index < 3 && canvas.dataset.selected !== nextSeed; index++) canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
			canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
			seedAction.click();
		};
		failNewProject = true; openNext();
		await until(() => !left.querySelector<HTMLButtonElement>(".cpo-submit")?.disabled, "failed target creation settles");
		check(left.querySelector<HTMLInputElement>(".cpo-input")?.value === oldSeed && Object.keys(settings.researchProjects).join() === "W1", "failed target save retains the source UI and creates no partial project");
		failNewProject = false; openNext();
		await until(() => left.querySelector<HTMLInputElement>(".cpo-input")?.value === nextSeed, "retry creates and opens the new target project");
		check(settings.researchProjects[nextSeed]?.name === snapshot.nodes[1]!.title, "new project takes its target title");
		check(settings.researchProjects.W1?.seedId === oldSeed && right.querySelector<HTMLInputElement>(".cpo-input")?.value === oldSeed, "creating a target project preserves the source and its peer");
		back();
		await until(() => left.querySelector<HTMLInputElement>(".cpo-input")?.value === oldSeed, "source can be reopened after target creation");
		holdLeft = true;
		left.querySelector<HTMLButtonElement>('[aria-label="重新加载"]')!.click();
		await until(() => Boolean(releaseLeft), "first panel's request reaches the delayed response");
		const beforeSaves = saveOrigins.length;
		right.querySelector<HTMLButtonElement>('[aria-label="重新加载"]')!.click();
		await until(() => saveOrigins.slice(beforeSaves).some(save => save.mount === 1 && save.key === "W1") && !right.querySelector<HTMLButtonElement>('[aria-label="重新加载"]')!.disabled, "the later request in the second panel commits first");
		const beforeRelease = saveOrigins.length;
		check(settings.researchProjects.W1!.seedId === oldSeed, "refresh keeps the current seed");
		releaseLeft!();
		await until(() => !left.querySelector<HTMLButtonElement>('[aria-label="重新加载"]')!.disabled, "the delayed request settles");
		check(!saveOrigins.slice(beforeRelease).some(save => save.mount === 0) && !settings.researchProjects.W1!.snapshot?.nodes.some(paper => paper.title === "STALE RESPONSE"), "the older response never saves over the newer project commit");
		const embedHost = document.createElement("div"); embedHost.style.width = "900px"; document.body.append(embedHost);
		let persistedAssociation: string | null | undefined;
		const workflow = createReadingWorkflow({ getSettings: () => settings, persist: async () => { if (failSave) throw new Error("disk full"); window.dispatchEvent(new Event("research-connected-project")); } });
		let stopEmbed = mountEmbed(embedHost, { ...workflow, source: `openalex: ${oldSeed}`, getSettings: () => settings, getJson: workIdentityFixtureGet, openExternal() {}, stagePaper: async () => { if (failSave) throw new Error("disk full"); window.dispatchEvent(new Event("research-connected-project")); }, persistAssociation: async key => { persistedAssociation = key; } });
		try {
			await until(() => Boolean(embedHost.querySelector(".cpo-paper-stage")), "unlinked embed loads its own seed");
			embedHost.querySelector<HTMLButtonElement>(".cpo-paper-stage")!.click();
			await until(() => Boolean(embedHost.querySelector("dialog[open]")), "unlinked save opens the project chooser");
			const chooseDialog = embedHost.querySelector<HTMLDialogElement>("dialog")!;
			Array.from(chooseDialog.querySelectorAll("button")).find(button => button.textContent === "取消")!.click();
			await new Promise(resolve => setTimeout(resolve, 0));
			check(!projectVersionState(settings.researchProjects.W1, snapshot.nodes[0]!).staged && persistedAssociation === undefined, "cancel does not save or associate the block");
			embedHost.querySelector<HTMLButtonElement>(".cpo-paper-stage")!.click();
			await until(() => Boolean(embedHost.querySelector("dialog[open]")), "project chooser opens again");
			const remembered = embedHost.querySelector<HTMLDialogElement>("dialog")!;
			remembered.querySelector<HTMLSelectElement>("select")!.value = "W1";
			remembered.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
			Array.from(remembered.querySelectorAll("button")).find(button => button.textContent === "选择")!.click();
			await until(() => projectVersionState(settings.researchProjects.W1, snapshot.nodes[0]!).staged, "chosen project receives the saved version");
			check(persistedAssociation === "W1", "remember persists the exact project key");
			stopEmbed();
			const alias = snapshot.nodes[1]!;
			await workflow.commitWorkflow(alias, null, { reading: "read" });
			changeVersionExclusion(settings.researchProjects.W1!, alias, true, true);
			stopEmbed = mountEmbed(embedHost, { ...workflow, source: `openalex: ${nextSeed}\nproject: W1`, getSettings: () => settings, getJson: workIdentityFixtureGet, openExternal() {}, stagePaper: async () => { if (failSave) throw new Error("disk full"); window.dispatchEvent(new Event("research-connected-project")); } });
			const restore = () => Array.from(embedHost.querySelectorAll("button")).find(button => button.textContent === "恢复此版本并继续");
			await until(() => Boolean(restore()), "linked embed pauses on its excluded block seed");
			failSave = true; restore()!.click();
			await new Promise(resolve => setTimeout(resolve, 0));
			check(projectVersionState(settings.researchProjects.W1, alias).excluded && !restore()!.disabled, "failed restore retains exclusion and is retryable");
			failSave = false; restore()!.click();
			await until(() => !projectVersionState(settings.researchProjects.W1, alias).excluded, "restore clears the version scope exception");
			check(workflow.getReadingState(alias).reading === "read", "embed restore preserves shared reading");
		} finally { stopEmbed(); embedHost.remove(); }
	} finally { for (const handle of handles) handle.destroy(); for (const host of hosts) host.remove(); }
	await verifySourceBrowser(snapshot);
}

async function verifySourceBrowser(snapshot: SavedGraphSnapshot): Promise<void> {
	const [seed, alias] = snapshot.nodes;
	check(seed && alias, "source fixture has two records");
	const settings: ConnectedPapersSettings = { ...DEFAULT_SETTINGS, s2Reconcile: false, researchProjects: { W1: { version: 1, seedId: seed!.id, name: "Sources", updatedAt: 1, views: [], snapshot } } };
	const host = document.createElement("div"); host.style.cssText = "width:1200px;height:800px"; document.body.append(host);
	let failSource = true, missing = false;
	const notify = () => window.dispatchEvent(new Event("research-connected-project"));
	const getJson: typeof workIdentityFixtureGet = async (url, options) => {
		if (url.includes("api.crossref.org")) {
			const doi = decodeURIComponent(new URL(url).pathname.replace("/works/", ""));
			return { message: { DOI: doi, relation: !missing && doi === normalizeDoi(seed!.doiUrl) ? { "is-preprint-of": [{ id: normalizeDoi(alias!.doiUrl), "id-type": "doi" }] } : {} } };
		}
		return workIdentityFixtureGet(url, options);
	};
	const handle = mountGraphApp(host, { getSettings: () => settings, getJson, openExternal() {}, loadSavedProject: () => settings.researchProjects.W1!, saveProject: async (project, key) => { settings.researchProjects[key ?? project.seedId] = project; notify(); }, persistSettings: async () => { if (failSource) throw new Error("source disk full"); notify(); } });
	const reload = () => host.querySelector<HTMLButtonElement>('[aria-label="重新加载"]')!.click();
	try {
		reload();
		await until(() => Boolean(host.querySelector(".cpo-status")?.textContent?.includes("source disk full")), "source relation save failure reaches the main-panel feedback");
		check(!settings.sourceVersionRelations?.length && restoreGraphSnapshot(settings.researchProjects.W1!.snapshot)!.nodes.length === 2, "failed source save leaves the displayed project unmerged");
		failSource = false; reload();
		await until(() => settings.sourceVersionRelations?.[0]?.status === "confirmed", "main-panel background lookup persists explicit version evidence");
		check(restoreGraphSnapshot(settings.researchProjects.W1!.snapshot)!.nodes.length === 1, "main-panel source lookup updates its saved projection");
	} finally { handle.destroy(); host.remove(); }
	missing = true;
	const embedHost = document.createElement("div"); embedHost.style.width = "900px"; document.body.append(embedHost);
	const stopEmbed = mountEmbed(embedHost, { source: `openalex: ${seed!.id}\nproject: W1`, getSettings: () => settings, getJson, openExternal() {}, stagePaper: async () => { notify(); } });
	try {
		await until(() => settings.sourceVersionRelations?.[0]?.status === "missing", "embed background lookup shares a missing-source report with the saved project");
		check(settings.sourceVersionRelations?.[0]?.linked && settings.researchProjects.W1!.pending?.some(item => item.kind === "identity"), "an embed miss retains the source link and queues review instead of splitting it");
	} finally { stopEmbed(); embedHost.remove(); }
}
