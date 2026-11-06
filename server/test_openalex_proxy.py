"""Quota + OpenAlex proxy offline tests. Run: python3 -m unittest discover -s server -p 'test_*.py'."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from quota import QuotaStore, period_id
from openalex_proxy import OpenAlexProxy, handler_for, validate_openalex


class Clock:
    def __init__(self, start: float):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class QuotaLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "quota.json")
        # 2026-11-06 12:00 Beijing = 2026-11-06 04:00 UTC
        self.clock = Clock(time.mktime(time.strptime("2026-11-06 04:00:00", "%Y-%m-%d %H:%M:%S")))
        # Force timezone-independent epoch via datetime
        from datetime import datetime, timezone, timedelta
        beijing = timezone(timedelta(hours=8))
        self.clock.now = datetime(2026, 11, 6, 12, 0, tzinfo=beijing).timestamp()
        self.store = QuotaStore(self.path, clock=self.clock, browser_daily=10, site_daily=500, reserve_ttl=300, ip_starts_per_minute=10, openalex_budget_usd=1.0, request_cost_usd=0.1)

    def tearDown(self):
        self.tmp.cleanup()

    def test_period_boundary_at_beijing_0800(self):
        from datetime import datetime, timezone, timedelta
        beijing = timezone(timedelta(hours=8))
        before = datetime(2026, 11, 6, 7, 59, tzinfo=beijing).timestamp()
        after = datetime(2026, 11, 6, 8, 0, tzinfo=beijing).timestamp()
        self.assertEqual(period_id(before), "2026-11-05")
        self.assertEqual(period_id(after), "2026-11-06")

    def test_reserve_confirm_idempotent_and_release(self):
        reserved = self.store.reserve("b1", "build", "1.1.1.1")
        self.assertTrue(reserved.ok)
        status = self.store.status("b1")
        self.assertEqual(status["browser_remaining"], 9)
        self.assertEqual(status["site_remaining"], 499)
        confirmed = self.store.confirm("b1", reserved.reservation_id)
        self.assertTrue(confirmed.ok)
        self.assertEqual(self.store.status("b1")["browser_remaining"], 9)
        again = self.store.confirm("b1", reserved.reservation_id)
        self.assertTrue(again.ok)
        self.assertEqual(again.code, "confirmed")
        self.assertEqual(self.store.status("b1")["browser_remaining"], 9, "idempotent confirm must not double-charge")
        released = self.store.release("b1", reserved.reservation_id)
        self.assertFalse(released.ok)
        self.assertEqual(released.code, "already_confirmed")

    def test_cancel_and_expire_do_not_charge(self):
        reserved = self.store.reserve("b2", "rebuild", "1.1.1.2")
        released = self.store.release("b2", reserved.reservation_id)
        self.assertTrue(released.ok)
        self.assertEqual(self.store.status("b2")["browser_remaining"], 10)
        reserved = self.store.reserve("b2", "expand", "1.1.1.2")
        self.clock.advance(301)
        expired = self.store.confirm("b2", reserved.reservation_id)
        self.assertFalse(expired.ok)
        self.assertEqual(expired.code, "expired")
        self.assertEqual(self.store.status("b2")["browser_remaining"], 10)

    def test_browser_eleventh_and_site_limit_and_ip_rate(self):
        for i in range(10):
            decision = self.store.reserve(f"fill-{i}", "build", f"9.9.9.{i}")
            self.assertTrue(decision.ok)
            self.assertTrue(self.store.confirm(f"fill-{i}", decision.reservation_id).ok)
        # Separate browser still blocked by site when site_daily reduced
        tight = QuotaStore(os.path.join(self.tmp.name, "site.json"), clock=self.clock, site_daily=2, browser_daily=10)
        a = tight.reserve("a", "build", "2.2.2.1")
        self.assertTrue(a.ok)
        self.assertTrue(tight.confirm("a", a.reservation_id).ok)
        b = tight.reserve("b", "build", "2.2.2.2")
        self.assertTrue(b.ok)
        self.assertTrue(tight.confirm("b", b.reservation_id).ok)
        c = tight.reserve("c", "build", "2.2.2.3")
        self.assertFalse(c.ok)
        self.assertEqual(c.code, "site_quota")

        browser = QuotaStore(os.path.join(self.tmp.name, "browser.json"), clock=self.clock, browser_daily=2)
        for n in range(2):
            d = browser.reserve("solo", "build", "3.3.3.3")
            self.assertTrue(d.ok, d.message)
            self.assertTrue(browser.confirm("solo", d.reservation_id).ok)
        denied = browser.reserve("solo", "build", "3.3.3.3")
        self.assertFalse(denied.ok)
        self.assertEqual(denied.code, "browser_quota")

        rate = QuotaStore(os.path.join(self.tmp.name, "ip.json"), clock=self.clock, ip_starts_per_minute=10)
        for n in range(10):
            d = rate.reserve(f"ipb-{n}", "build", "8.8.8.8")
            self.assertTrue(d.ok)
            self.assertTrue(rate.release(f"ipb-{n}", d.reservation_id).ok)
        blocked = rate.reserve("ipb-10", "build", "8.8.8.8")
        self.assertFalse(blocked.ok)
        self.assertEqual(blocked.code, "ip_rate")

    def test_cross_period_confirm_does_not_charge_new_day(self):
        reserved = self.store.reserve("night", "build", "4.4.4.4")
        # Jump past Beijing 08:00 next day while reservation still within 5 minutes.
        from datetime import datetime, timezone, timedelta
        beijing = timezone(timedelta(hours=8))
        self.clock.now = datetime(2026, 11, 7, 8, 0, tzinfo=beijing).timestamp()
        # Keep reservation from expiring by rewriting expires_at into the future before confirm.
        self.store.state["reservations"][reserved.reservation_id]["expires_at"] = self.clock.now + 60
        denied = self.store.confirm("night", reserved.reservation_id)
        self.assertFalse(denied.ok)
        self.assertEqual(denied.code, "period_closed")
        self.assertEqual(self.store.status("night")["browser_remaining"], 10)
        self.assertEqual(self.store.status("night")["site_remaining"], 500)

    def test_restart_preserves_counters(self):
        reserved = self.store.reserve("persist", "build", "5.5.5.5")
        self.assertTrue(self.store.confirm("persist", reserved.reservation_id).ok)
        reloaded = QuotaStore(self.path, clock=self.clock)
        self.assertEqual(reloaded.status("persist")["browser_remaining"], 9)
        self.assertEqual(reloaded.status("persist")["site_remaining"], 499)

    def test_openalex_budget_blocks_and_privacy_state_has_no_doi(self):
        # request_cost 0.1 with $1 budget => 10 charges
        for _ in range(10):
            ok, _ = self.store.charge_openalex()
            self.assertTrue(ok)
        ok, code = self.store.charge_openalex()
        self.assertFalse(ok)
        self.assertEqual(code, "openalex_budget")
        denied = self.store.reserve("budget", "build", "6.6.6.6")
        self.assertFalse(denied.ok)
        self.assertEqual(denied.code, "openalex_budget")
        raw = Path(self.path).read_text(encoding="utf-8").lower()
        self.assertNotIn("10.", raw)
        self.assertNotIn("doi", raw)
        self.assertNotIn("/works/", raw)


class OpenAlexProxyTests(unittest.TestCase):
    def test_validation_rejects_unsafe_and_strips_mailto(self):
        method, url = validate_openalex({"method": "GET", "path": "/works", "query": {"filter": "cites:W1", "per_page": "50", "select": "id,display_name", "mailto": "attacker@example.com"}})
        self.assertEqual(method, "GET")
        self.assertIn("filter=cites%3AW1", url)
        self.assertNotIn("mailto", url)
        for bad in [
            {"method": "POST", "path": "/works", "query": {}},
            {"method": "GET", "path": "/authors", "query": {}},
            {"method": "GET", "path": "/works", "query": {"filter": "cites:W1;DROP"}},
            {"method": "GET", "path": "/works/not-an-id", "query": {}},
        ]:
            with self.assertRaises(ValueError):
                validate_openalex(bad)

    def test_key_budget_cache_and_http_boundary(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "q.json")
        from datetime import datetime, timezone, timedelta
        beijing = timezone(timedelta(hours=8))
        clock = Clock(datetime(2026, 11, 6, 12, 0, tzinfo=beijing).timestamp())
        quota = QuotaStore(path, clock=clock, request_cost_usd=0.5, openalex_budget_usd=1.0)

        calls = []

        def opener(req, timeout):
            calls.append(req)
            self.assertEqual(req.get_header("Authorization"), "Bearer server-key")
            return io.BytesIO(json.dumps({"id": "https://openalex.org/W1", "display_name": "Demo"}).encode())

        proxy = OpenAlexProxy("server-key", quota, opener=opener, interval=0)
        payload = {"method": "GET", "path": "/works/W1", "query": {"select": "id,display_name"}}
        self.assertEqual(proxy.request(payload)[0], 200)
        self.assertEqual(proxy.request(payload)[0], 200)
        self.assertEqual(len(calls), 1, "identical GETs share the cache")
        self.assertEqual(proxy.request({"method": "GET", "path": "/works/W2", "query": {"select": "id"}})[0], 200)
        blocked = proxy.request({"method": "GET", "path": "/works/W3", "query": {"select": "id"}})
        self.assertEqual(blocked[0], 429)
        self.assertEqual(blocked[2]["code"], "openalex_budget")

        empty = OpenAlexProxy("", quota, opener=opener)
        self.assertEqual(empty.request(payload)[0], 503)

        # HTTP boundary: origin + no path logging side effects + quota routes
        quota2 = QuotaStore(os.path.join(tmp.name, "q2.json"), clock=clock)
        proxy2 = OpenAlexProxy("server-key", quota2, opener=opener, interval=0)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(proxy2, quota2, allow_local=True))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/health") as response:
                health = json.load(response)
            self.assertTrue(health["ok"])
            self.assertTrue(health["key_configured"])

            req = urllib.request.Request(
                base + "/api/openalex",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://graph.jieyu.ai"},
            )
            with urllib.request.urlopen(req) as response:
                self.assertEqual(json.load(response)["id"], "https://openalex.org/W1")

            bad_origin = urllib.request.Request(
                base + "/api/openalex",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://evil.test"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(bad_origin)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()

            reserve = urllib.request.Request(
                base + "/api/quota/reserve",
                data=json.dumps({"action": "build"}).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://graph.jieyu.ai", "X-Browser-Id": "browser-a"},
            )
            with urllib.request.urlopen(reserve) as response:
                body = json.load(response)
            self.assertTrue(body["ok"])
            reservation_id = body["reservation_id"]
            confirm = urllib.request.Request(
                base + "/api/quota/confirm",
                data=json.dumps({"reservation_id": reservation_id}).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://graph.jieyu.ai", "X-Browser-Id": "browser-a"},
            )
            with urllib.request.urlopen(confirm) as response:
                self.assertTrue(json.load(response)["ok"])
            # Idempotent confirm
            with urllib.request.urlopen(confirm) as response:
                self.assertTrue(json.load(response)["ok"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
