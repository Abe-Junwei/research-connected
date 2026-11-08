"""Quota + OpenAlex proxy offline tests. Run: python3 -m unittest discover -s server -p 'test_*.py'."""
from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import concurrent.futures
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from quota import QuotaStore, budget_period_id, operation_period_id
from openalex_proxy import OpenAlexProxy, handler_for, validate_openalex


class Clock:
    def __init__(self, start: float):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


BEIJING = timezone(timedelta(hours=8))


class QuotaLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "quota.json")
        self.clock = Clock(datetime(2026, 11, 6, 12, 0, tzinfo=BEIJING).timestamp())
        self.store = QuotaStore(
            self.path,
            clock=self.clock,
            browser_daily=10,
            site_daily=500,
            reserve_ttl=300,
            ip_starts_per_minute=10,
            openalex_budget_usd=1.0,
            request_cost_usd=0.1,
        )
        self.session = self.store.create_session()
        self.token = self.session["browser_token"]
        self.nonce = self.session["session_nonce"]

    def tearDown(self):
        self.tmp.cleanup()

    def reserve(self, action="build", ip="1.1.1.1", key=None, token=None, nonce=None):
        return self.store.reserve(token or self.token, nonce or self.nonce, action, ip, key or ("idem-" + os.urandom(4).hex()))

    def test_period_boundary_at_beijing_0800_and_budget_utc(self):
        before = datetime(2026, 11, 6, 7, 59, tzinfo=BEIJING).timestamp()
        after = datetime(2026, 11, 6, 8, 0, tzinfo=BEIJING).timestamp()
        self.assertEqual(operation_period_id(before), "2026-11-05")
        self.assertEqual(operation_period_id(after), "2026-11-06")
        utc_instant = datetime(2026, 11, 6, 0, 30, tzinfo=timezone.utc).timestamp()
        self.assertEqual(budget_period_id(utc_instant), "2026-11-06")

    def test_reserve_confirm_idempotent_cancel_expire(self):
        key = "idem-1"
        reserved = self.reserve(key=key)
        self.assertTrue(reserved.ok)
        confirmed = self.store.confirm(self.token, self.nonce, reserved.reservation_id, key)
        self.assertTrue(confirmed.ok)
        again = self.store.confirm(self.token, self.nonce, reserved.reservation_id, key)
        self.assertTrue(again.ok)
        self.assertEqual(self.store.status(self.token, self.nonce)["browser_remaining"], 9)
        self.assertFalse(self.store.release(self.token, self.nonce, reserved.reservation_id, key).ok)

        reserved = self.reserve(action="rebuild", key="idem-cancel")
        self.assertTrue(self.store.release(self.token, self.nonce, reserved.reservation_id, "idem-cancel").ok)
        self.assertEqual(self.store.status(self.token, self.nonce)["browser_remaining"], 9)

        reserved = self.reserve(action="expand", key="idem-expire")
        self.clock.advance(301)
        expired = self.store.confirm(self.token, self.nonce, reserved.reservation_id, "idem-expire")
        self.assertFalse(expired.ok)
        self.assertEqual(expired.code, "expired")

    def test_nonce_and_idempotency_bindings(self):
        reserved = self.reserve(key="idem-bind")
        other = self.store.create_session()
        bad_nonce = self.store.confirm(self.token, other["session_nonce"], reserved.reservation_id, "idem-bind")
        self.assertEqual(bad_nonce.code, "session_invalid")
        bad_key = self.store.confirm(self.token, self.nonce, reserved.reservation_id, "other-key")
        self.assertEqual(bad_key.code, "idempotency_mismatch")

    def test_takeover_cancels_only_same_browser_and_rejects_late_confirm(self):
        reserved = self.reserve(key="takeover")
        peer = self.store.create_session(self.token)
        outsider = self.store.create_session()
        self.assertFalse(self.store.release(outsider["browser_token"], outsider["session_nonce"], reserved.reservation_id, takeover=True).ok)
        self.assertFalse(self.store.release(self.token, peer["session_nonce"], reserved.reservation_id).ok)
        self.assertTrue(self.store.release(self.token, peer["session_nonce"], reserved.reservation_id, takeover=True).ok)
        self.assertEqual(self.store.confirm(self.token, self.nonce, reserved.reservation_id, "takeover").code, "released")

    def test_concurrent_reservations_do_not_oversubscribe(self):
        self.store.site_daily = 7
        sessions = [self.store.create_session() for _ in range(20)]
        def reserve(row):
            return self.store.reserve(row["browser_token"], row["session_nonce"], "build", "concurrent", row["browser_token"])
        with concurrent.futures.ThreadPoolExecutor(20) as pool:
            results = list(pool.map(reserve, sessions))
        self.assertEqual(sum(result.ok for result in results), 7)
        reopened = QuotaStore(self.path, clock=self.clock, site_daily=7)
        self.assertEqual(reopened.status(self.token, self.nonce)["site_remaining"], 0)

    def test_corrupt_state_is_not_silently_reset(self):
        Path(self.path).write_text("{broken")
        with self.assertRaisesRegex(RuntimeError, "refusing to reset"):
            QuotaStore(self.path, clock=self.clock)
        self.assertEqual(Path(self.path).read_text(), "{broken")

    def test_failed_disk_confirmation_rolls_memory_back(self):
        reserved = self.reserve(key="disk-failure")
        with patch("quota.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.confirm(self.token, self.nonce, reserved.reservation_id, "disk-failure")
        self.assertEqual(self.store.state["site_success"], 0)
        self.assertEqual(self.store.state["reservations"][reserved.reservation_id]["status"], "reserved")
        self.assertTrue(self.store.confirm(self.token, self.nonce, reserved.reservation_id, "disk-failure").ok)
        self.assertEqual(QuotaStore(self.path, clock=self.clock).state["site_success"], 1)

    def test_new_period_does_not_migrate_reservation(self):
        reserved = self.reserve(key="idem-period")
        self.assertTrue(reserved.ok)
        # Jump past Beijing 08:00 next day while reservation TTL rewritten forward.
        self.clock.now = datetime(2026, 11, 7, 8, 0, tzinfo=BEIJING).timestamp()
        # Keep the same session alive across the operation-period boundary.
        token_hash = __import__("hashlib").sha256(self.token.encode()).hexdigest()
        self.store.state["sessions"][token_hash]["expires_at"] = self.clock.now + 3600
        self.store.state["sessions"][token_hash]["nonces"][__import__("hashlib").sha256(self.nonce.encode()).hexdigest()] = self.clock.now + 3600
        self.store.state["reservations"][reserved.reservation_id]["expires_at"] = self.clock.now + 60
        # Rolling must expire rather than migrate the open reservation.
        status = self.store.status(self.token, self.nonce)
        self.assertEqual(status["browser_remaining"], 10)
        self.assertIsNone(status.get("active_reservation"))
        denied = self.store.confirm(self.token, self.nonce, reserved.reservation_id, "idem-period")
        self.assertFalse(denied.ok)
        self.assertIn(denied.code, {"expired", "period_closed"})

    def test_browser_site_ip_limits_and_restart(self):
        for i in range(2):
            session = self.store.create_session()
            d = self.store.reserve(session["browser_token"], session["session_nonce"], "build", f"9.9.9.{i}", f"k{i}")
            self.assertTrue(d.ok)
            self.assertTrue(self.store.confirm(session["browser_token"], session["session_nonce"], d.reservation_id, f"k{i}").ok)
        tight = QuotaStore(os.path.join(self.tmp.name, "site.json"), clock=self.clock, site_daily=1, browser_daily=10)
        a = tight.create_session()
        d = tight.reserve(a["browser_token"], a["session_nonce"], "build", "2.2.2.1", "a")
        self.assertTrue(d.ok)
        self.assertTrue(tight.confirm(a["browser_token"], a["session_nonce"], d.reservation_id, "a").ok)
        b = tight.create_session()
        blocked = tight.reserve(b["browser_token"], b["session_nonce"], "build", "2.2.2.2", "b")
        self.assertEqual(blocked.code, "site_quota")

        rate = QuotaStore(os.path.join(self.tmp.name, "ip.json"), clock=self.clock, ip_starts_per_minute=10)
        for n in range(10):
            s = rate.create_session()
            d = rate.reserve(s["browser_token"], s["session_nonce"], "build", "8.8.8.8", f"ip{n}")
            self.assertTrue(d.ok)
            self.assertTrue(rate.release(s["browser_token"], s["session_nonce"], d.reservation_id, f"ip{n}").ok)
        s = rate.create_session()
        self.assertEqual(rate.reserve(s["browser_token"], s["session_nonce"], "build", "8.8.8.8", "ipx").code, "ip_rate")

        reserved = self.reserve(key="persist")
        self.assertTrue(self.store.confirm(self.token, self.nonce, reserved.reservation_id, "persist").ok)
        reloaded = QuotaStore(self.path, clock=self.clock)
        # Same token/nonce session must still exist on disk.
        self.assertEqual(reloaded.status(self.token, self.nonce)["browser_remaining"], 9)

    def test_budget_hold_settle_refund_and_privacy(self):
        ok, _, hold = self.store.hold_openalex(0.4)
        self.assertTrue(ok)
        self.assertTrue(self.store.settle_openalex(hold)[0])
        ok, _, hold = self.store.hold_openalex(0.4)
        self.assertTrue(ok)
        self.assertTrue(self.store.refund_openalex(hold)[0])
        # Remaining room is 0.6; a 0.7 hold must fail without overshooting $1.
        ok, code, _ = self.store.hold_openalex(0.7)
        self.assertFalse(ok)
        self.assertEqual(code, "openalex_budget")
        raw = Path(self.path).read_text(encoding="utf-8").lower()
        self.assertNotIn("doi", raw)
        self.assertNotIn("/works/", raw)
        self.assertNotIn(self.token.lower(), raw)

    def test_tabs_reopen_renewal_preserve_identity_and_reservations(self):
        a = self.session
        reserved = self.reserve(key="tabs")
        b = self.store.create_session(self.token)
        self.assertEqual(b["browser_token"], self.token)
        self.assertNotEqual(b["session_nonce"], self.nonce)
        self.assertEqual(self.store.status(self.token, b["session_nonce"])["reason"], "browser_busy")
        self.assertTrue(self.store.confirm(self.token, self.nonce, reserved.reservation_id, "tabs").ok)
        self.assertEqual(self.store.status(self.token, b["session_nonce"])["browser_remaining"], 9)
        self.clock.advance(12 * 3600 + 1)
        self.assertEqual(self.store.status(self.token, self.nonce)["code"], "session_invalid")
        c = self.store.create_session(self.token)
        self.assertEqual(c["browser_token"], self.token)
        # This clock crosses the next operation period, but retains browser identity.
        self.assertTrue(self.store.status(self.token, c["session_nonce"])["ok"])
        reloaded = QuotaStore(self.path, clock=self.clock)
        self.assertEqual(reloaded.create_session(self.token)["browser_token"], self.token)

    def test_query_limits_and_abandoned_cost_survive_restart(self):
        for _ in range(120): self.assertTrue(self.store.allow_request("query", "1.2.3.4", self.token))
        self.assertFalse(self.store.allow_request("query", "1.2.3.4", self.token))
        self.assertFalse(QuotaStore(self.path, clock=self.clock).allow_request("query", "1.2.3.4", self.token))
        self.clock.advance(61)
        self.assertTrue(self.store.allow_request("query", "1.2.3.4", self.token))
        ok, _, hold = self.store.hold_openalex(0.4, ttl_sec=1)
        self.assertTrue(ok)
        self.clock.advance(2)
        self.assertAlmostEqual(self.store.status(self.token, self.nonce)["openalex_budget_remaining_usd"], 0.6)
        self.store.observe_openalex(0.8, 0.2)
        self.assertAlmostEqual(self.store.status(self.token, self.nonce)["openalex_budget_remaining_usd"], 0.2)


class OpenAlexProxyTests(unittest.TestCase):
    def test_local_proxy_forwards_client_api(self):
        from local_web_dev import Handler
        handler = object.__new__(Handler)
        handler.headers = {"X-Client-Api": "2", "X-Browser-Token": "browser", "X-Session-Nonce": "nonce"}
        handler.path = "/api/quota/status"
        handler.command = "POST"
        handler.rfile = io.BytesIO()
        handler.wfile = io.BytesIO()
        handler.send_response = lambda status: None
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"{}"
        response.status = 200
        response.headers = {}
        with patch("local_web_dev.urllib.request.urlopen", return_value=response) as request:
            handler._proxy()
        self.assertEqual(request.call_args.args[0].get_header("X-client-api"), "2")

    def test_validation_and_mock_unconfigured(self):
        method, url = validate_openalex({"method": "GET", "path": "/works/W1", "query": {"select": "id", "mailto": "x@y.z"}})
        self.assertEqual(method, "GET")
        self.assertNotIn("mailto", url)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        quota = QuotaStore(os.path.join(tmp.name, "q.json"), clock=Clock(datetime(2026, 11, 6, 12, 0, tzinfo=BEIJING).timestamp()))
        unconfigured = OpenAlexProxy("", quota)
        self.assertEqual(unconfigured.request({"method": "GET", "path": "/works/W1", "query": {"select": "id"}})[2]["code"], "openalex_unconfigured")
        mocked = OpenAlexProxy("", quota, allow_mock=True)
        self.assertEqual(mocked.request({"method": "GET", "path": "/works/W1", "query": {"select": "id"}})[0], 200)

    def test_http_origin_session_and_quota_flow(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        clock = Clock(datetime(2026, 11, 6, 12, 0, tzinfo=BEIJING).timestamp())
        quota = QuotaStore(os.path.join(tmp.name, "q.json"), clock=clock)
        proxy = OpenAlexProxy("", quota, allow_mock=True)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(proxy, quota, allow_local=True, expose_debug=True))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            # Missing Origin is rejected.
            req = urllib.request.Request(base + "/api/session", data=b"{}", headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(req)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()

            # Spoofed CF-Connecting-IP from untrusted peer is ignored (peer remains 127.0.0.1).
            session_req = urllib.request.Request(
                base + "/api/session",
                data=b"{}",
                headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4190"},
            )
            with urllib.request.urlopen(session_req) as response:
                session = json.load(response)
            headers = {
                "Content-Type": "application/json",
                "Origin": "http://127.0.0.1:4190",
                "X-Browser-Token": session["browser_token"],
                "X-Session-Nonce": session["session_nonce"],
                "CF-Connecting-IP": "203.0.113.9",
                "X-Client-Api": "2",
            }
            reserve = urllib.request.Request(base + "/api/quota/reserve", data=json.dumps({"action": "build", "idempotency_key": "local-1"}).encode(), headers=headers)
            with urllib.request.urlopen(reserve) as response:
                body = json.load(response)
            self.assertTrue(body["ok"])
            reservation_id = body["reservation_id"]
            confirm = urllib.request.Request(base + "/api/quota/confirm", data=json.dumps({"reservation_id": reservation_id, "idempotency_key": "local-1"}).encode(), headers=headers)
            with urllib.request.urlopen(confirm) as response:
                self.assertTrue(json.load(response)["ok"])
            with urllib.request.urlopen(confirm) as response:
                self.assertTrue(json.load(response)["ok"])

            # Evil origin
            evil = urllib.request.Request(base + "/api/openalex", data=json.dumps({"method": "GET", "path": "/works/W1", "query": {"select": "id"}}).encode(), headers={"Content-Type": "application/json", "Origin": "https://evil.test"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(evil)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()

            from unittest.mock import patch
            payload = json.dumps({"method": "GET", "path": "/works/W1", "query": {"select": "id"}}).encode()
            for extra, expected in [({}, 401), ({"X-Browser-Token": session["browser_token"], "X-Session-Nonce": session["session_nonce"]}, 426)]:
                request = urllib.request.Request(base + "/api/openalex", data=payload, headers={"Content-Type": "application/json", "Origin": "https://graph.jieyu.ai", **extra})
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, expected)
                error.exception.close()
            with patch("openalex_proxy.forward_s2", return_value=(200, {}, {"title": "S2 routed"})) as forward:
                request = urllib.request.Request(base + "/api/semantic-scholar", data=b"{}", headers=headers)
                with urllib.request.urlopen(request) as response: self.assertEqual(json.load(response)["title"], "S2 routed")
                forward.assert_called_once()
            with urllib.request.urlopen(base + "/api/version") as response:
                self.assertEqual(json.load(response)["minClientApi"], 2)

            # Product origin works with mock
            good = urllib.request.Request(base + "/api/openalex", data=json.dumps({"method": "GET", "path": "/works/W1", "query": {"select": "id"}}).encode(), headers={**headers, "Origin": "https://graph.jieyu.ai"})
            with urllib.request.urlopen(good) as response:
                self.assertEqual(json.load(response)["id"], "https://openalex.org/W1")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_authoritative_pricing_and_ambiguous_failure(self):
        from unittest.mock import patch
        class Response(io.BytesIO):
            headers = {"X-RateLimit-Cost-USD": "0.001"}
        with tempfile.TemporaryDirectory() as tmp:
            quota = QuotaStore(os.path.join(tmp, "q.json"))
            proxy = OpenAlexProxy("test-only", quota)
            usage = {"rate_limit": {"daily_used_usd": 0.1, "daily_remaining_usd": 0.9, "endpoint_costs_usd": {"singleton": 0, "list": 0.0001, "search": 0.001}}}
            def opener(req, timeout):
                if req.full_url.endswith("/rate-limit"): return Response(json.dumps(usage).encode())
                return Response(b'{"results": []}')
            proxy.opener = opener
            status, _, _ = proxy.request({"method": "GET", "path": "/works", "query": {"search": "language"}})
            self.assertEqual(status, 200)
            self.assertAlmostEqual(quota.state["openalex"]["spent_micros"] / 1e6, 0.101)
            proxy.opener = lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError())
            status, _, _ = proxy.request({"method": "GET", "path": "/works", "query": {"search": "different"}})
            self.assertEqual(status, 502)
            self.assertAlmostEqual(quota.state["openalex"]["spent_micros"] / 1e6, 0.102)
            proxy.usage_check_after = 0
            self.assertEqual(proxy.request({"method": "GET", "path": "/works/W1", "query": {}})[0], 503)


if __name__ == "__main__":
    unittest.main()
