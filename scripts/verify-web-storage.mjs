import assert from "node:assert/strict";

class StorageFullError extends Error {
	constructor(message = "Browser storage is full") {
		super(message);
		this.name = "StorageFullError";
	}
}

function isQuota(error) {
	return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

function writeWebProjectSettings(key, settings, storage) {
	const payload = JSON.stringify(settings);
	try {
		storage.setItem(key, payload);
	} catch (error) {
		if (isQuota(error)) throw new StorageFullError();
		throw error;
	}
}

const memory = new Map([["keep", JSON.stringify({ researchProjects: { old: { snapshot: { nodes: [1] } } } })]]);
const storage = {
	getItem: (k) => (memory.has(k) ? memory.get(k) : null),
	setItem(k, v) {
		if (String(v).length > 40) throw new DOMException("full", "QuotaExceededError");
		memory.set(k, v);
	},
};

assert.ok(storage.getItem("keep"));
assert.throws(
	() => writeWebProjectSettings("settings", { researchProjects: { a: { snapshot: { nodes: [1, 2, 3, 4, 5, 6, 7, 8] } } } }, storage),
	(error) => error instanceof StorageFullError,
);
assert.ok(storage.getItem("keep"), "quota failure must not delete existing projects");
assert.equal(memory.has("settings"), false, "failed write must not partially replace");
console.log("verify-web-storage: ok");
