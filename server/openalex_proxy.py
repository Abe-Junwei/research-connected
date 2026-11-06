"""Bounded OpenAlex system proxy + anonymous operation quota for graph.jieyu.ai.

OPENALEX_API_KEY stays in a root-only env file. Request paths/DOIs are never logged.
"""
from __future__ import annotations

import collections
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from quota import QuotaStore

MAX_BODY = 65536
MAX_RESPONSE = 4 * 1024 * 1024
MAX_CACHE = 16 * 1024 * 1024
ALLOWED_ORIGINS = {
    "https://graph.jieyu.ai",
    "https://graph.jieyu.ai:8443",
}
LOCAL_ORIGINS = {
    "http://127.0.0.1",
    "http://localhost",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
}
WORK_ID = re.compile(r"^W\d+$", re.I)
SAFE_SELECT = re.compile(r"^[A-Za-z0-9_,]+$")
SAFE_FILTER = re.compile(r"^[\w\-:|./\s]+$", re.I)
SAFE_CURSOR = re.compile(r"^[\w\-*=]+$")
SAFE_SORT = re.compile(r"^[A-Za-z0-9_:,]+$")
SAFE_SEARCH = re.compile(r"^[\s\S]{1,200}$")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("CF-Connecting-IP") or handler.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    return (handler.client_address[0] if handler.client_address else "unknown")[:64]


def origin_allowed(origin: str | None, allow_local: bool) -> bool:
    if not origin:
        return True  # same-origin navigations / curl without Origin
    if origin in ALLOWED_ORIGINS:
        return True
    return allow_local and origin in LOCAL_ORIGINS


def validate_openalex(payload: dict) -> tuple[str, str]:
    if not isinstance(payload, dict) or set(payload) - {"method", "path", "query"}:
        raise ValueError("Invalid request.")
    method = payload.get("method")
    path = payload.get("path")
    query = payload.get("query") or {}
    if method != "GET" or not isinstance(path, str) or not isinstance(query, dict):
        raise ValueError("Only GET OpenAlex lookups are supported.")
    if len(path) > 2048 or not path.startswith("/"):
        raise ValueError("Invalid path.")
    if path == "/works":
        allowed = {"filter", "search", "per_page", "select", "cursor", "sort", "mailto"}
        if set(query) - allowed:
            raise ValueError("Unsupported works query.")
        if "filter" in query and (not isinstance(query["filter"], str) or not SAFE_FILTER.fullmatch(query["filter"]) or len(query["filter"]) > 1500):
            raise ValueError("Invalid filter.")
        if "search" in query and (not isinstance(query["search"], str) or not SAFE_SEARCH.fullmatch(query["search"])):
            raise ValueError("Invalid search.")
        if "select" in query and (not isinstance(query["select"], str) or not SAFE_SELECT.fullmatch(query["select"]) or len(query["select"]) > 512):
            raise ValueError("Invalid select.")
        if "cursor" in query and (not isinstance(query["cursor"], str) or not SAFE_CURSOR.fullmatch(query["cursor"]) or len(query["cursor"]) > 512):
            raise ValueError("Invalid cursor.")
        if "sort" in query and (not isinstance(query["sort"], str) or not SAFE_SORT.fullmatch(query["sort"])):
            raise ValueError("Invalid sort.")
        if "per_page" in query:
            try:
                per_page = int(query["per_page"])
            except (TypeError, ValueError):
                raise ValueError("Invalid per_page.") from None
            if not 1 <= per_page <= 100:
                raise ValueError("Invalid per_page.")
        # Drop client mailto; polite contact is owned by the server.
        query = {k: v for k, v in query.items() if k != "mailto"}
    elif path.startswith("/works/doi:"):
        doi = path[len("/works/doi:"):]
        if not doi or len(doi) > 512 or ".." in doi or any(ch in doi for ch in " \x00\n\r"):
            raise ValueError("Invalid DOI path.")
        if set(query) - {"select", "mailto"}:
            raise ValueError("Unsupported DOI query.")
        if "select" in query and (not isinstance(query["select"], str) or not SAFE_SELECT.fullmatch(query["select"])):
            raise ValueError("Invalid select.")
        query = {k: v for k, v in query.items() if k != "mailto"}
    elif path.startswith("/works/"):
        work_id = path[len("/works/"):]
        if not WORK_ID.fullmatch(work_id):
            raise ValueError("Invalid OpenAlex id.")
        if set(query) - {"select", "mailto"}:
            raise ValueError("Unsupported work query.")
        if "select" in query and (not isinstance(query["select"], str) or not SAFE_SELECT.fullmatch(query["select"])):
            raise ValueError("Invalid select.")
        query = {k: v for k, v in query.items() if k != "mailto"}
    else:
        raise ValueError("Unsupported OpenAlex path.")
    encoded = urllib.parse.urlencode(query, doseq=True)
    url = "https://api.openalex.org" + path + (("?" + encoded) if encoded else "")
    return method, url


class OpenAlexProxy:
    def __init__(self, key: str, quota: QuotaStore, opener=None, interval: float = 0.12, contact_email: str = ""):
        self.key = key.strip()
        self.quota = quota
        self.opener = opener or urllib.request.build_opener(NoRedirect()).open
        self.interval = interval
        self.contact_email = contact_email.strip()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(16)
        self.cache: collections.OrderedDict = collections.OrderedDict()
        self.cache_bytes = 0
        self.next_request = 0.0

    def request(self, payload: dict) -> tuple[int, dict, object]:
        method, url = validate_openalex(payload)
        if not self.key:
            return 503, {}, {"error": "OpenAlex system API key is not configured.", "code": "openalex_unconfigured"}
        if not self.quota.openalex_allowed():
            return 429, {"Retry-After": "3600"}, {"error": "OpenAlex daily free budget is exhausted.", "code": "openalex_budget"}
        if not self.slots.acquire(blocking=False):
            return 503, {"Retry-After": "10"}, {"error": "OpenAlex queue is full. Try again later.", "code": "openalex_busy"}
        try:
            if not self.lock.acquire(timeout=20):
                return 503, {"Retry-After": "10"}, {"error": "OpenAlex queue timed out.", "code": "openalex_busy"}
            try:
                cache_key = url
                cached = self.cache.get(cache_key)
                if cached and cached[0] > time.monotonic():
                    self.cache.move_to_end(cache_key)
                    return 200, {}, cached[1]
                delay = self.next_request - time.monotonic()
                if delay > 5:
                    return 429, {"Retry-After": str(max(1, int(delay + 1)))}, {"error": "OpenAlex is cooling down. Try again later.", "code": "openalex_rate"}
                if delay > 0:
                    time.sleep(delay)
                ok, code = self.quota.charge_openalex()
                if not ok:
                    return 429, {"Retry-After": "3600"}, {"error": "OpenAlex daily free budget is exhausted.", "code": code}
                self.next_request = time.monotonic() + self.interval
                if self.contact_email:
                    parsed = urllib.parse.urlparse(url)
                    q = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
                    q["mailto"] = [self.contact_email]
                    url = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode({k: v[0] for k, v in q.items()})))
                req = urllib.request.Request(url, method=method, headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {self.key}",
                    "User-Agent": "research-connected-web/1.0",
                })
                try:
                    with self.opener(req, timeout=20) as response:
                        raw = response.read(MAX_RESPONSE + 1)
                    if len(raw) > MAX_RESPONSE:
                        raise ValueError("Response too large.")
                    data = json.loads(raw)
                    if not isinstance(data, (dict, list)):
                        raise ValueError("Invalid OpenAlex payload.")
                except urllib.error.HTTPError as error:
                    headers = {}
                    body = {"error": f"OpenAlex request failed (HTTP {error.code}).", "code": "openalex_upstream"}
                    if error.code == 429:
                        retry = error.headers.get("Retry-After", "5")
                        headers["Retry-After"] = retry
                        body["code"] = "openalex_rate"
                    elif error.code in {401, 403}:
                        body = {"error": "OpenAlex rejected the system API key.", "code": "openalex_auth"}
                    error.close()
                    return error.code, headers, body
                except (OSError, ValueError, json.JSONDecodeError):
                    return 502, {}, {"error": "OpenAlex returned unavailable or invalid data.", "code": "openalex_upstream"}
                ttl = 300
                if cache_key in self.cache:
                    self.cache_bytes -= self.cache.pop(cache_key)[2]
                while self.cache and (len(self.cache) >= 600 or self.cache_bytes + len(raw) > MAX_CACHE):
                    self.cache_bytes -= self.cache.popitem(last=False)[1][2]
                self.cache[cache_key] = (time.monotonic() + ttl, data, len(raw))
                self.cache_bytes += len(raw)
                return 200, {}, data
            finally:
                self.lock.release()
        finally:
            self.slots.release()


def decision_payload(decision) -> dict:
    payload = {
        "ok": decision.ok,
        "code": decision.code,
        "message": decision.message,
        "browser_remaining": decision.browser_remaining,
        "site_remaining": decision.site_remaining,
        "reset_at": decision.reset_at,
        "reason": decision.reason or decision.code,
    }
    if decision.reservation_id:
        payload["reservation_id"] = decision.reservation_id
    if decision.expires_at is not None:
        payload["expires_at"] = decision.expires_at
    return payload


def handler_for(proxy: OpenAlexProxy, quota: QuotaStore, allow_local: bool = False):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, format, *args):  # noqa: A003 — stdlib signature
            # Never print request paths: they may contain DOIs or work ids.
            return

        def reply(self, status: int, headers: dict, data: object):
            raw = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def read_json(self) -> dict:
            if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
                raise ValueError("Expected a JSON request.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                raise ValueError("Invalid body length.")
            raw = self.rfile.read(length)
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            return data

        def browser_id(self) -> str:
            value = (self.headers.get("X-Browser-Id") or "").strip()
            if not value or len(value) > 128 or not re.fullmatch(r"[A-Za-z0-9._:-]+", value):
                raise ValueError("Missing or invalid X-Browser-Id.")
            return value

        def check_origin(self) -> bool:
            return origin_allowed(self.headers.get("Origin"), allow_local)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {}, {
                    "ok": True,
                    "service": "research-connected-web",
                    "key_configured": bool(proxy.key),
                    "openalex_budget_ok": quota.openalex_allowed(),
                })
            else:
                self.reply(404, {}, {"error": "Not found."})

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in {
                "/api/openalex",
                "/api/quota/status",
                "/api/quota/reserve",
                "/api/quota/confirm",
                "/api/quota/release",
            }:
                self.reply(404, {}, {"error": "Not found."})
                return
            if not self.check_origin():
                self.reply(403, {}, {"error": "Unsupported origin.", "code": "origin"})
                return
            try:
                if path == "/api/openalex":
                    payload = self.read_json()
                    # Browser id is optional for single-paper lookups that do not
                    # consume operation quota, but still useful for future audits.
                    status, headers, data = proxy.request(payload)
                    self.reply(status, headers, data)
                    return
                browser = self.browser_id()
                if path == "/api/quota/status":
                    self.reply(200, {}, quota.status(browser))
                    return
                body = self.read_json()
                if path == "/api/quota/reserve":
                    decision = quota.reserve(browser, str(body.get("action") or ""), client_ip(self))
                    self.reply(200 if decision.ok else 429, {}, decision_payload(decision))
                    return
                reservation_id = str(body.get("reservation_id") or "")
                if path == "/api/quota/confirm":
                    decision = quota.confirm(browser, reservation_id)
                    self.reply(200 if decision.ok else 409, {}, decision_payload(decision))
                    return
                if path == "/api/quota/release":
                    decision = quota.release(browser, reservation_id)
                    self.reply(200 if decision.ok else 409, {}, decision_payload(decision))
                    return
            except ValueError as error:
                self.reply(400, {}, {"error": str(error), "code": "bad_request"})
            except Exception:
                self.reply(500, {}, {"error": "Internal error.", "code": "internal"})

    return Handler


def main(argv: list[str] | None = None):
    import argparse
    parser = argparse.ArgumentParser(description="Research Connected OpenAlex + quota proxy")
    parser.add_argument("--host", default=os.environ.get("LISTEN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LISTEN_PORT", "9186")))
    parser.add_argument("--state", default=os.environ.get("QUOTA_STATE_PATH", "/var/lib/research-connected/quota-state.json"))
    parser.add_argument("--allow-local", action="store_true", default=os.environ.get("OPENALEX_ALLOW_LOCAL", "") == "1")
    args = parser.parse_args(argv)
    key = os.environ.get("OPENALEX_API_KEY", "")
    contact = os.environ.get("OPENALEX_CONTACT_EMAIL", "")
    budget = float(os.environ.get("OPENALEX_DAILY_BUDGET_USD", "1"))
    cost = float(os.environ.get("OPENALEX_REQUEST_COST_USD", "0.0001"))
    quota = QuotaStore(args.state, openalex_budget_usd=budget, request_cost_usd=cost)
    proxy = OpenAlexProxy(key, quota, contact_email=contact)
    server = ThreadingHTTPServer((args.host, args.port), handler_for(proxy, quota, allow_local=args.allow_local))
    print(json.dumps({"listening": f"{args.host}:{args.port}", "key_configured": bool(key), "allow_local": args.allow_local}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
