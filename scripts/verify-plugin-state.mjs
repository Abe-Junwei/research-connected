import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bundle = await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
class Plugin {}
const obsidian = { Plugin, ItemView: class {}, PluginSettingTab: class {}, MarkdownRenderChild: class {}, getLanguage: () => "en" };
const loaded = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, () => obsidian);
const PluginClass = loaded.exports.default;
const oldWindow = globalThis.window;
globalThis.window = { dispatchEvent() {} };
try {
	const plugin = new PluginClass();
	const seed = { id: "W1", title: "Seed", isSeed: true, origin: "seed", doiUrl: null, year: 2000, citedByCount: 1, authors: "Author", authorList: ["Author"], abstract: "", openAlexUrl: "https://openalex.org/W1", language: "en", workType: "article", venue: null, retracted: false, concepts: [] };
	const saved = { researchProjects: { W1: { version: 1, seedId: "W1", name: "Saved", updatedAt: 1, views: [], snapshot: { version: 1, seedId: "W1", savedAt: 1, nodes: [seed], catalog: [seed], edges: [], seedScore: [], referenceLists: [], citationEvidence: [], warnings: [], strategies: { references: true, citations: true, related: true }, skippedNonResearch: 0 } } } };
	const files = new Map(); const writes = [];
	plugin.manifest = { dir: ".obsidian/plugins/research-connected" };
	plugin.app = { vault: { adapter: { exists: async (path) => files.has(path), read: async path => files.get(path), write: async (path, value) => { files.set(path, value); } } } };
	let diskData = structuredClone(saved);
	plugin.loadData = async () => structuredClone(diskData);
	plugin.saveData = async (value) => { assert.ok(files.size, "backup must precede the migrated write"); writes.push(value); diskData = structuredClone(value); };
	await plugin.loadSettings();
	assert.deepEqual(JSON.parse([...files.values()][0]), saved);
	assert.equal(writes[0].researchProjects.W1.snapshot.version, 2);
	await plugin.loadSettings();
	assert.deepEqual(JSON.parse(files.get(`${plugin.manifest.dir}/data-before-work-identity-v2.json`)), saved, "the original backup must not be overwritten by a later reading-workflow backup");
	assert.equal(writes.length, 1, "reopening migrated settings must not migrate or save again");
	const reopened = new PluginClass();
	reopened.manifest = plugin.manifest; reopened.app = plugin.app;
	reopened.loadData = plugin.loadData;
	reopened.saveData = async () => { throw new Error("reopen must not write"); };
	await reopened.loadSettings();
	assert.deepEqual(reopened.settings.researchProjects, plugin.settings.researchProjects, "a new plugin instance restores migrated projects");
	const v2 = new PluginClass();
	v2.manifest = plugin.manifest; v2.app = plugin.app;
	const moved = structuredClone(diskData);
	delete moved.workflowMigration;
	moved.researchProjects.W1.seedId = "W9";
	v2.loadData = async () => structuredClone(diskData);
	v2.saveData = plugin.saveData;
	diskData = moved;
	await v2.loadSettings();
	assert.equal(v2.settings.researchProjects.W1.seedId, "W9", "normalization retains the current seed under the stable project key");
	assert.deepEqual(JSON.parse(files.get(`${plugin.manifest.dir}/data-before-work-identity-v2-1.json`)), moved, "an existing backup must not replace the current complete backup");
	const invalid = new PluginClass();
	invalid.manifest = plugin.manifest; invalid.app = plugin.app;
	const malformed = structuredClone(moved);
	malformed.researchProjects.W1.paperStates = { W1: { paper: seed, reading: "broken", staged: true, excluded: true } };
	invalid.loadData = async () => malformed;
	invalid.saveData = async () => { throw new Error("must not write invalid migration"); };
	await assert.rejects(invalid.loadSettings(), /Migration stopped|迁移已停止/);
	await assert.rejects(invalid.saveSettings(false), /writes are stopped/);
	const invalidCurrent = new PluginClass();
	invalidCurrent.loadData = async () => ({ ...malformed, workflowMigration: { version: 1, backup: "existing.json", completedAt: 1 } });
	await assert.rejects(invalidCurrent.loadSettings(), /Invalid project state|项目状态无效/);
	await assert.rejects(invalidCurrent.saveSettings(false), /writes are stopped/, "a current-format validation failure must also block overwriting the original data");
	const invalidSource = new PluginClass();
	invalidSource.loadData = async () => ({ ...structuredClone(diskData), sourceVersionRelations: [{ ids: ["W1", "W2"], source: "crossref", status: "confirmed", linked: false, evidence: [], updatedAt: 1 }] });
	await assert.rejects(invalidSource.loadSettings(), /Invalid saved source version relations|保存的来源版本关系无效/);
	await assert.rejects(invalidSource.saveSettings(false), /writes are stopped/, "invalid source evidence must not be normalized away and saved over the original");
	const mismatched = new PluginClass();
	mismatched.manifest = plugin.manifest; mismatched.app = plugin.app;
	mismatched.loadData = async () => structuredClone(saved);
	let mismatchWrites = 0;
	mismatched.saveData = async () => { mismatchWrites++; };
	await assert.rejects(mismatched.loadSettings(), /reread did not match|重读结果不一致/);
	await assert.rejects(mismatched.saveSettings(false), /writes are stopped/);
	assert.equal(mismatchWrites, 1, "a mismatched reread blocks all subsequent saves");

	let allowFirst;
	const gate = new Promise((resolve) => { allowFirst = resolve; });
	const order = [];
	plugin.saveData = async (data) => { order.push(data.maxNodes); if (order.length === 1) await gate; };
	plugin.settings.maxNodes = 30; const first = plugin.saveSettings(false);
	plugin.settings.maxNodes = 40; const second = plugin.saveSettings(false);
	await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
	assert.deepEqual(order, [30], "concurrent views must not start out-of-order saves");
	allowFirst(); await Promise.all([first, second]); assert.deepEqual(order, [30, 40]);
	plugin.saveData = async () => { throw new Error("disk full"); };
	await assert.rejects(plugin.saveSettings(false), /disk full/);
	plugin.saveData = async (data) => { order.push(data.maxNodes); };
	await plugin.saveSettings(false);
	assert.equal(order.length, 3, "a failed save must not block later retries");

	const blocked = new PluginClass(); let overwritten = false;
	blocked.manifest = plugin.manifest;
	blocked.app = { vault: { adapter: { exists: async () => false, write: async () => { throw new Error("backup failed"); } } } };
	blocked.loadData = async () => structuredClone(saved); blocked.saveData = async () => { overwritten = true; };
	await assert.rejects(blocked.loadSettings(), /backup failed/);
	assert.equal(overwritten, false, "backup failure must preserve the original data");
	const directory = await mkdtemp(join(tmpdir(), "research-connected-migration-"));
	try {
		const adapter = {
			exists: async path => { try { await access(join(directory, path)); return true; } catch { return false; } },
			read: path => readFile(join(directory, path), "utf8"),
			write: async (path, value) => { await mkdir(join(directory, path, ".."), { recursive: true }); await writeFile(join(directory, path), value); },
		};
		await adapter.write("plugin/data.json", JSON.stringify(saved));
		const diskPlugin = () => {
			const instance = new PluginClass();
			instance.manifest = { dir: "plugin" }; instance.app = { vault: { adapter } };
			instance.loadData = async () => JSON.parse(await adapter.read("plugin/data.json"));
			instance.saveData = value => adapter.write("plugin/data.json", JSON.stringify(value));
			return instance;
		};
		const interrupted = diskPlugin();
		interrupted.saveData = async () => { throw new Error("interrupted before data write"); };
		await assert.rejects(interrupted.loadSettings(), /interrupted/);
		assert.deepEqual(JSON.parse(await adapter.read("plugin/data.json")), saved);
		const resumed = diskPlugin(); await resumed.loadSettings();
		assert.deepEqual(JSON.parse(await adapter.read("plugin/data-before-work-identity-v2.json")), saved);
		assert.deepEqual(JSON.parse(await adapter.read("plugin/data-before-work-identity-v2-1.json")), saved);
		const restarted = diskPlugin(); restarted.saveData = async () => { throw new Error("must not remigrate"); };
		await restarted.loadSettings();
		assert.deepEqual(restarted.settings.researchProjects, resumed.settings.researchProjects);
	} finally { await rm(directory, { recursive: true, force: true }); }
	console.log("plugin migration and serialized persistence checks passed");
} finally {
	if (oldWindow === undefined) delete globalThis.window;
	else globalThis.window = oldWindow;
}

// The settings migration must keep all controls searchable, writable, and masked.
const settingsBundle = await build({ entryPoints: ["src/settings.ts"], bundle: true, platform: "node", format: "cjs", external: ["obsidian"], write: false, logLevel: "silent" });
const settingsModule = { exports: {} };
class SettingsTab {
	updates = 0;
	update() { this.updates++; }
}
new Function("module", "exports", "require", settingsBundle.outputFiles[0].text)(settingsModule, settingsModule.exports, () => ({ ...obsidian, PluginSettingTab: SettingsTab }));
let saves = 0;
const store = { settings: { ...settingsModule.exports.DEFAULT_SETTINGS }, saveSettings: async () => { saves++; } };
const tab = new settingsModule.exports.ConnectedPapersSettingTab({}, {}, store);
const controls = new Map();
const helpLinks = [];
function renderSettings() {
	controls.clear();
	helpLinks.length = 0;
	for (const definition of tab.getSettingDefinitions()) {
		assert.ok(definition.name && definition.desc, "every setting must have searchable text");
		const control = {
			inputEl: {},
			setPlaceholder() { return this; }, setValue() { return this; },
			setLimits() { return this; }, addOption() { return this; },
			onChange(callback) { this.change = callback; return this; },
		};
		const render = (callback) => { callback(control); controls.set(definition.name, control); };
		definition.render({
			addText: render, addTextArea: render, addSlider: render, addToggle: render, addDropdown: render,
			controlEl: { addClass() {}, createEl(tag, options) { helpLinks.push({ tag, ...options }); } },
		});
	}
}
renderSettings();
assert.deepEqual(helpLinks.map(({ tag, text, href, attr }) => [tag, text, href, attr]), [
	["a", "User guide", "https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Report a bug", "https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml", { target: "_blank", rel: "noopener noreferrer" }],
	["a", "Request a feature", "https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml", { target: "_blank", rel: "noopener noreferrer" }],
]);
assert.equal(controls.size, 17, "all non-LLM settings must remain available");
assert.equal(controls.get("OpenAlex API key").inputEl.type, "password");
await controls.get("Maximum nodes").change(999);
assert.equal(store.settings.maxNodes, 300);
await controls.get("DOI property name").change("  ");
assert.equal(store.settings.literatureDoiProperty, "doi");
await controls.get("Enable LLM research narrative").change(true);
assert.equal(tab.updates, 1, "LLM visibility must refresh through the host update API");
renderSettings();
assert.equal(controls.size, 21);
assert.equal(controls.get("LLM API key").inputEl.type, "password");
await controls.get("LLM endpoint").change(" https://example.test/chat/completions ");
assert.equal(store.settings.llmEndpoint, "https://example.test/chat/completions");
assert.equal(saves, 4);
store.saveSettings = async () => { throw new Error("disk full"); };
await assert.rejects(controls.get("Contact email (mailto)").change("a@example.test"), /disk full/);
console.log("settings search, persistence, visibility and secret masking checks passed");
