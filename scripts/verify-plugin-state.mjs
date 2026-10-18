import assert from "node:assert/strict";
import { build } from "esbuild";

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
	plugin.app = { vault: { adapter: { exists: async (path) => files.has(path), write: async (path, value) => { files.set(path, value); } } } };
	plugin.loadData = async () => structuredClone(saved);
	plugin.saveData = async (value) => { assert.ok(files.size, "backup must precede the migrated write"); writes.push(value); };
	await plugin.loadSettings();
	assert.deepEqual(JSON.parse([...files.values()][0]), saved);
	assert.equal(writes[0].researchProjects.W1.snapshot.version, 2);
	await plugin.loadSettings();
	assert.equal(files.size, 1, "the original backup must not be overwritten");

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
	blocked.loadData = plugin.loadData; blocked.saveData = async () => { overwritten = true; };
	await assert.rejects(blocked.loadSettings(), /backup failed/);
	assert.equal(overwritten, false, "backup failure must preserve the original data");
	console.log("plugin migration and serialized persistence checks passed");
} finally {
	if (oldWindow === undefined) delete globalThis.window;
	else globalThis.window = oldWindow;
}
