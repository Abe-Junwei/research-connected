import { mountGraphApp } from "../src/app";
import { mountEmbed } from "../src/embed-mount";
import { DEFAULT_SETTINGS } from "../src/settings-model";
import { fixtureGet } from "../preview/fixture";
import { updateProjectPaperState, type ResearchProject } from "../src/project-state";
import { bindLanguage, isChinese } from "../src/i18n";
import { readHostLanguage } from "../src/host-language";
import { createReadingWorkflow } from "../src/reading-workflow";

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
async function until(predicate: () => boolean, message: string): Promise<void> {
	for (let index = 0; index < 300; index++) {
		if (predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 30));
	}
	throw new Error(message);
}

export async function verifyExportBrowser(): Promise<void> {
	const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	let copied = "", failClipboard = false;
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(text: string) { if (failClipboard) throw new Error("permission denied"); copied = text; } } });
	try {
		for (const language of ["zh-CN", "en"]) {
			bindLanguage(() => language);
			for (const embed of [false, true]) {
				for (const writeNote of [false, true]) {
					const label = `${language}/${embed ? "embed" : "pane"}/${writeNote ? "vault" : "clipboard"}`;
					const host = document.createElement("div"); host.style.cssText = "width:1000px;height:700px"; document.body.append(host);
					const settings = { ...DEFAULT_SETTINGS, s2Reconcile: false, literatureFilename: "{{year}} {{title}}", literatureFolder: "Papers", researchProjects: {} as Record<string, ResearchProject> };
					let failNote = false, existing = false, confirmed = true, writes = 0, remembered = 0;
					let content = "", filename = "", folder: string | undefined;
					const deps = {
						...createReadingWorkflow({ getSettings: () => settings, persist: async () => {} }),
						getSettings: () => settings, getJson: fixtureGet, openExternal() {},
						saveProject: async (project: ResearchProject, key = project.seedId) => { settings.researchProjects[key] = project; },
						persistSettings: async () => {},
						getReadingState: () => ({ reading: confirmed ? "read" as const : null, confirmed, sources: [] }),
						lookupLiteratureNote: () => existing ? { path: "existing.md", reading: "read" as const } : null,
						rememberLiteratureNote: () => { remembered++; },
						createNote: writeNote ? async (name: string, text: string, target?: string) => { if (failNote) throw new Error("disk full"); writes++; filename = name; content = text; folder = target; return `Papers/${name}`; } : undefined,
					};
					const handle = embed ? mountEmbed(host, { ...deps, source: "doi: 10.1234/seed\nheight: 600" }) : mountGraphApp(host, { ...deps, initialDoi: "10.1234/seed" });
					const destroy = () => { if (typeof handle === "function") handle(); else handle.destroy(); host.remove(); };
					try {
						await until(() => Boolean(host.querySelector<HTMLButtonElement>(".cpo-export-items button:not(:disabled)")), `${label}: graph loads`);
						const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".cpo-export-items button"));
						const click = async (index: number): Promise<void> => {
							copied = "";
							host.querySelector<HTMLDetailsElement>(".cpo-export-menu")!.open = true;
							buttons()[index]!.click();
							await new Promise(resolve => setTimeout(resolve, 50));
						};
						const message = () => host.querySelector(".cpo-export-message")?.textContent ?? "";
						for (const [index, prefix] of [[0, "@"], [1, "papers:"], [2, isChinese() ? "| 题名 |" : "| Title |"]] as const) {
							failClipboard = false; await click(index);
							check(copied.startsWith(prefix), `${label}: format ${index} copies actual content`);
							check(/已复制|Copied/.test(message()), `${label}: copy success is reported`);
							const expected = copied;
							failClipboard = true; await click(index);
							check(/剪贴板不可用|Clipboard unavailable/.test(message()), `${label}: clipboard errors offer manual copy`);
							check(host.querySelector(".cpo-export-text")?.textContent === expected, `${label}: fallback preserves format ${index}`);
						}
						failClipboard = false;
						await click(3);
						if (writeNote) {
							check(writes === 1 && remembered === 1, `${label}: a successful note is remembered once`);
							check(content.includes("rc-status: read") && content.startsWith("---\n"), `${label}: note keeps shared reading state and frontmatter`);
							check(folder === "Papers" && filename.endsWith(".md"), `${label}: folder and filename reach the host`);
							failNote = true; await click(3);
							check(message().includes("disk full") && writes === 1 && remembered === 1, `${label}: failed writes never report or remember success`);
							failNote = false;
						} else {
							check(copied.startsWith("---\n") && copied.includes("rc-status: read"), `${label}: note template falls back to clipboard`);
							const expected = copied; failClipboard = true; await click(3);
							check(host.querySelector(".cpo-export-text")?.textContent === expected, `${label}: note template survives clipboard rejection`);
							failClipboard = false;
						}
						existing = true; await click(3);
						check(/已找到文献笔记|Literature notes found/.test(message()) && !copied && writes === (writeNote ? 1 : 0), `${label}: existing notes are not duplicated`);
						existing = false; confirmed = false; await click(3);
						check(/请先确认阅读状态|Confirm reading status/.test(message()) && !copied && writes === (writeNote ? 1 : 0), `${label}: reading conflicts cannot silently create an unread note`);
						if (!embed) {
							confirmed = true;
							const [key, project] = Object.entries(settings.researchProjects)[0]!;
							const seed = project.snapshot!.nodes.find(paper => paper.isSeed)!;
							updateProjectPaperState(settings.researchProjects, key, seed, { staged: true, reading: "read" });
							const library = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => /收藏与排除|Saved and excluded/.test(button.textContent ?? ""));
							check(library, `${label}: saved list tab exists`); library!.click();
							const listButtons = Array.from(host.querySelectorAll<HTMLButtonElement>(".cpo-library-menu-item"));
							check(listButtons.length === (writeNote ? 3 : 2), `${label}: list actions reflect host capabilities`);
							for (const [index, prefix] of [[0, isChinese() ? "| 题名 |" : "| Title |"], [1, "@"]] as const) {
								copied = ""; listButtons[index]!.click();
								await new Promise(resolve => setTimeout(resolve, 30));
								check(copied.startsWith(prefix) && copied.includes(seed.title), `${label}: saved list format ${index} exports the saved paper`);
							}
							if (writeNote) {
								listButtons[2]!.click(); await new Promise(resolve => setTimeout(resolve, 30));
								check(writes === 2 && content.includes(seed.title) && /已读|Read/.test(content), `${label}: saved list writes its own note with the reading state`);
								failNote = true; listButtons[2]!.click(); await new Promise(resolve => setTimeout(resolve, 30));
								check(writes === 2 && message().includes("disk full"), `${label}: saved list write errors remain visible`);
							}
						}
					} catch (error) { throw new Error(`${String(error)}; UI: ${host.textContent?.slice(-1200)}`); } finally { destroy(); }
				}
			}
		}
	} finally {
		bindLanguage(readHostLanguage);
		if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
		else Reflect.deleteProperty(navigator, "clipboard");
	}
}
