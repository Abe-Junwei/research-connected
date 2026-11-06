import assert from "node:assert/strict";

const PROXY = process.env.PROXY_BASE || "http://127.0.0.1:9186";
const ORIGIN = process.env.WEB_ORIGIN || "http://127.0.0.1:4190";

async function json(path, { method = "POST", headers = {}, body } = {}) {
	const response = await fetch(`${PROXY}${path}`, {
		method,
		headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
		body: body === undefined ? "{}" : JSON.stringify(body),
	});
	const data = await response.json();
	return { status: response.status, data };
}

function auth(session) {
	return { "X-Browser-Token": session.browser_token, "X-Session-Nonce": session.session_nonce };
}

const failures = [];
function check(cond, message) {
	if (!cond) failures.push(message);
}

const noOrigin = await json("/api/session", { headers: { Origin: "" } }).catch(async () => {
	// fetch may omit empty Origin; force with Request
	const response = await fetch(`${PROXY}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
	return { status: response.status, data: await response.json() };
});
check(noOrigin.status === 403, `missing Origin must 403, got ${noOrigin.status}`);

const evil = await json("/api/session", { headers: { Origin: "https://evil.test" } });
check(evil.status === 403, `evil Origin must 403, got ${evil.status}`);

const sessionRes = await json("/api/session");
check(sessionRes.status === 200 && sessionRes.data.browser_token && sessionRes.data.session_nonce, "session bootstrap");
const session = sessionRes.data;

const openalex = await json("/api/openalex", { body: { method: "GET", path: "/works/W1", query: { select: "id,display_name" } } });
check([200, 503].includes(openalex.status), `openalex mock/unconfigured status ${openalex.status}`);
if (openalex.status === 503) check(openalex.data.code === "openalex_unconfigured", "unconfigured code");
if (openalex.status === 200) check(openalex.data.id?.includes("openalex.org"), "mock work id");

const reserve = await json("/api/quota/reserve", { headers: auth(session), body: { action: "build", idempotency_key: "live-1" } });
check(reserve.status === 200 && reserve.data.ok && reserve.data.reservation_id, "reserve ok");
const reservationId = reserve.data.reservation_id;

const cancelSession = (await json("/api/session")).data;
const cancelReserve = await json("/api/quota/reserve", { headers: auth(cancelSession), body: { action: "rebuild", idempotency_key: "live-cancel" } });
const released = await json("/api/quota/release", { headers: auth(cancelSession), body: { reservation_id: cancelReserve.data.reservation_id, idempotency_key: "live-cancel" } });
check(released.data.ok, "cancel/release ok");

const confirm = await json("/api/quota/confirm", { headers: auth(session), body: { reservation_id: reservationId, idempotency_key: "live-1" } });
check(confirm.status === 200 && confirm.data.ok, "confirm ok");
const confirm2 = await json("/api/quota/confirm", { headers: auth(session), body: { reservation_id: reservationId, idempotency_key: "live-1" } });
check(confirm2.data.ok, "idempotent confirm ok");
const status = await json("/api/quota/status", { headers: auth(session) });
check(status.data.browser_remaining === 9, `browser remaining after one success, got ${status.data.browser_remaining}`);

const late = await json("/api/quota/reserve", { headers: auth(session), body: { action: "expand", idempotency_key: "live-late" } });
check(late.data.ok, "late reserve");
// Soft-expire by confirming with wrong key first
const wrong = await json("/api/quota/confirm", { headers: auth(session), body: { reservation_id: late.data.reservation_id, idempotency_key: "wrong" } });
check(wrong.status === 409 && wrong.data.code === "idempotency_mismatch", "idempotency mismatch rejected");
await json("/api/quota/release", { headers: auth(session), body: { reservation_id: late.data.reservation_id, idempotency_key: "live-late" } });

if (failures.length) {
	console.error("verify-web-quota-live FAILED:\n- " + failures.join("\n- "));
	process.exit(1);
}
console.log("verify-web-quota-live: ok");
