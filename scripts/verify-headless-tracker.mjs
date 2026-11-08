import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "research-tracker-check-"));
try {
	const outfile = join(directory, "tracker.cjs");
	await build({ entryPoints: ["scripts/track-literature.ts"], alias: { obsidian: "./scripts/obsidian-stub.ts" }, bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
	for (const [args, code, text] of [[[], 2, /Usage:/], [["--seed", "Mithun 1991"], 1, /too short|Author\+Year/], [["--seed", "W1", "--year", "invalid"], 2, /4-digit year/]]) {
		const result = spawnSync(process.execPath, [outfile, ...args], { encoding: "utf8" });
		assert.equal(result.status, code, result.stderr);
		assert.match(result.stderr, text);
	}
	console.log("Headless tracker offline input checks passed");
} finally { await rm(directory, { recursive: true, force: true }); }
