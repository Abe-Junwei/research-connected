"""Bounded OpenAlex system proxy + anonymous operation quota for graph.jieyu.ai.

OPENALEX_API_KEY stays in a root-only env file. Request paths/DOIs are never logged.
Product POSTs require Origin + server-issued session nonce. Forwarded client IPs
are trusted only from configured edge addresses.
"""
from __future__ import annotations

import collections
import ipaddress
import json
import math
from pathlib import Path
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from quota import QuotaStore

MAX_BODY = 65536
MAX_RESPONSE = 4 * 1024 * 1024
MAX_CACHE = 16 * 1024 * 1024
ALLOWED_ORIGINS = {
    "https://graph.jieyu.ai",
    "https://graph.jieyu.ai:8443",
}
LOCAL_ORIGIN_HOSTS = {"127.0.0.1", "localhost"}
WORK_ID = re.compile(r"^W\d+$", re.I)
SAFE_SELECT = re.compile(r"^[A-Za-z0-9_,]+$")
SAFE_FILTER = re.compile(r"^[\w\-:|./\s]+$", re.I)
SAFE_CURSOR = re.compile(r"^[\w\-*=]+$")
SAFE_SORT = re.compile(r"^[A-Za-z0-9_:,]+$")
SAFE_SEARCH = re.compile(r"^[\s\S]{1,200}$")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def env_flag(*names: str) -> bool:
    for name in names:
        value = os.environ.get(name, "").strip().lower()
        if value in {"1", "true", "yes", "on"}:
            return True
    return False


def parse_trusted_proxies(raw: str) -> list[ipaddress._BaseNetwork]:
    networks: list[ipaddress._BaseNetwork] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "/" in part:
                networks.append(ipaddress.ip_network(part, strict=False))
            else:
                networks.append(ipaddress.ip_network(part + ("/32" if ":" not in part else "/128"), strict=False))
        except ValueError:
            continue
    return networks


def peer_ip(handler: BaseHTTPRequestHandler) -> str:
    return (handler.client_address[0] if handler.client_address else "unknown")[:64]


def client_ip(handler: BaseHTTPRequestHandler, trusted_proxies: list[ipaddress._BaseNetwork]) -> str:
    peer = peer_ip(handler)
    try:
        peer_addr = ipaddress.ip_address(peer)
    except ValueError:
        return peer
    if not any(peer_addr in network for network in trusted_proxies):
        return peer
    forwarded = handler.headers.get("CF-Connecting-IP") or handler.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return (forwarded or peer)[:64]


def origin_allowed(origin: str | None, allow_local: bool) -> tuple[bool, str]:
    if not origin:
        return False, "origin_required"
    if origin in ALLOWED_ORIGINS:
        return True, ""
    if not allow_local:
        return False, "origin_forbidden"
    try:
        parsed = urllib.parse.urlparse(origin)
    except ValueError:
        return False, "origin_forbidden"
    if parsed.scheme != "http":
        return False, "origin_forbidden"
    host = (parsed.hostname or "").lower()
    if host not in LOCAL_ORIGIN_HOSTS:
        return False, "origin_forbidden"
    return True, ""


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


def mock_openalex(path: str) -> dict:
    """Deterministic offline payload used when no system key is configured."""
    if path.startswith("/works/doi:") or path.startswith("/works/W"):
        work_id = "W1"
        if path.startswith("/works/W"):
            work_id = path.split("/", 2)[-1]
        return {
            "id": f"https://openalex.org/{work_id}",
            "display_name": "Mock seed work",
            "publication_year": 2020,
            "cited_by_count": 1,
            "doi": "https://doi.org/10.0/mock",
            "authorships": [{"author": {"display_name": "Mock Author"}}],
            "abstract_inverted_index": {"Mock": [0], "abstract": [1]},
            "referenced_works": ["https://openalex.org/W2"],
            "related_works": ["https://openalex.org/W3"],
            "type": "article",
            "is_retracted": False,
            "language": "en",
            "primary_location": {"source": {"display_name": "Mock Journal"}},
        }
    return {
        "results": [
            {
                "id": "https://openalex.org/W2",
                "display_name": "Mock neighbor",
                "publication_year": 2019,
                "cited_by_count": 2,
                "doi": "https://doi.org/10.0/mock-neighbor",
                "authorships": [{"author": {"display_name": "Neighbor Author"}}],
                "type": "article",
                "is_retracted": False,
                "language": "en",
            }
        ],
        "meta": {"next_cursor": None},
    }


class OpenAlexProxy:
    def __init__(self, key: str, quota: QuotaStore, opener=None, interval: float = 0.12, contact_email: str = "", allow_mock: bool = False):
        self.key = key.strip()
        self.quota = quota
        self.opener = opener or urllib.request.build_opener(NoRedirect()).open
        self.interval = interval
        self.contact_email = contact_email.strip()
        self.allow_mock = allow_mock
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(16)
        self.cache: collections.OrderedDict = collections.OrderedDict()
        self.cache_bytes = 0
        self.next_request = 0.0

    def request(self, payload: dict) -> tuple[int, dict, object]:
        method, url = validate_openalex(payload)
        path = urllib.parse.urlparse(url).path
        if not self.key:
            if self.allow_mock:
                return 200, {"X-OpenAlex-Mode": "mock"}, mock_openalex(path)
            return 503, {}, {"error": "OpenAlex system API key is not configured.", "code": "openalex_unconfigured"}
        if not self.quota.openalex_allowed():
            return 429, {"Retry-After": "3600"}, {"error": "OpenAlex daily free budget is exhausted.", "code": "openalex_budget"}
        if not self.slots.acquire(blocking=False):
            return 503, {"Retry-After": "10"}, {"error": "OpenAlex queue is full. Try again later.", "code": "openalex_busy"}
        hold_id = None
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
                if not self.allow_mock:
                    if time.monotonic() >= getattr(self, "usage_check_after", 0):
                        try:
                            usage_req = urllib.request.Request("https://api.openalex.org/rate-limit", headers={"Authorization": f"Bearer {self.key}"})
                            with self.opener(usage_req, timeout=15) as usage_response:
                                usage_raw = usage_response.read(MAX_RESPONSE + 1)
                            if len(usage_raw) > MAX_RESPONSE: raise ValueError("Usage response too large")
                            usage = json.loads(usage_raw)["rate_limit"]
                            used = float(usage["daily_used_usd"])
                            remaining = float(usage["daily_remaining_usd"])
                            costs = usage["endpoint_costs_usd"]
                            if not all(math.isfinite(x) and x >= 0 for x in (used, remaining)):
                                raise ValueError("Invalid usage")
                            self.quota.observe_openalex(used, remaining)
                            self.upstream_costs = costs
                            self.usage_check_after = time.monotonic() + 60
                        except (OSError, ValueError, KeyError, TypeError):
                            return 503, {"Retry-After": "30"}, {"error": "Cannot verify OpenAlex free allowance. Try again later.", "code": "openalex_usage_unavailable"}
                    kind = "singleton" if path != "/works" else "search" if "search" in payload.get("query", {}) else "list"
                    try:
                        cost = float(self.upstream_costs[kind])
                        if not math.isfinite(cost) or cost < 0: raise ValueError("Invalid cost")
                    except (KeyError, TypeError, ValueError):
                        return 503, {}, {"error": "OpenAlex pricing is unavailable.", "code": "openalex_usage_unavailable"}
                else:
                    cost = self.quota.request_cost_usd
                if not self.quota.openalex_allowed():
                    return 429, {"Retry-After": "3600"}, {"error": "OpenAlex daily free budget is exhausted.", "code": "openalex_budget"}
                ok, code, hold_id = self.quota.hold_openalex(cost)
                if not ok:
                    return 429, {"Retry-After": "3600"}, {"error": "OpenAlex daily free budget is exhausted.", "code": code}
                self.next_request = time.monotonic() + self.interval
                final_url = url
                if self.contact_email:
                    parsed = urllib.parse.urlparse(url)
                    q = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
                    q["mailto"] = [self.contact_email]
                    final_url = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode({k: v[0] for k, v in q.items()})))
                req = urllib.request.Request(final_url, method=method, headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {self.key}",
                    "User-Agent": "research-connected-web/1.0",
                })
                try:
                    with self.opener(req, timeout=20) as response:
                        raw = response.read(MAX_RESPONSE + 1)
                        actual_header = response.headers.get("X-RateLimit-Cost-USD")
                    if len(raw) > MAX_RESPONSE:
                        raise ValueError("Response too large.")
                    data = json.loads(raw)
                    if not isinstance(data, (dict, list)):
                        raise ValueError("Invalid OpenAlex payload.")
                except urllib.error.HTTPError as error:
                    if hold_id:
                        self.quota.settle_openalex(hold_id)
                        hold_id = None
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
                    if hold_id:
                        self.quota.settle_openalex(hold_id)
                        hold_id = None
                    return 502, {}, {"error": "OpenAlex returned unavailable or invalid data.", "code": "openalex_upstream"}
                if hold_id:
                    try:
                        actual = float(actual_header) if actual_header is not None else cost
                        if not math.isfinite(actual) or actual < 0: actual = cost
                    except ValueError:
                        actual = cost
                    # Reserve authoritative endpoint cost; settle a lower known actual cost.
                    if actual > cost:
                        self.quota.observe_openalex(self.quota.openalex_budget_usd, 0)
                    self.quota.settle_openalex(hold_id, actual)
                    hold_id = None
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
            if hold_id:
                self.quota.settle_openalex(hold_id)
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
    if decision.idempotency_key:
        payload["idempotency_key"] = decision.idempotency_key
    return payload


def version_info():
    try:
        data = json.loads(Path(os.environ.get("WEB_VERSION_PATH", "/var/www/graph.jieyu.ai/version.json")).read_text())
        return {"build": str(data["build"]), "api": 2, "minClientApi": 2}
    except (OSError, ValueError, KeyError):
        return {"build": "development", "api": 2, "minClientApi": 2}


def forward_s2(payload: dict, origin: str):
    # The S2 service owns validation, bounded queue, caching and upstream cooldown.
    req = urllib.request.Request("http://127.0.0.1:9185/api/semantic-scholar", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Origin": origin}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE: raise ValueError("Response too large")
            return response.status, {}, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read(MAX_RESPONSE + 1)
        retry = error.headers.get("Retry-After")
        status = error.code
        error.close()
        try: data = json.loads(raw) if len(raw) <= MAX_RESPONSE else {}
        except ValueError: data = {"error": "Semantic Scholar unavailable."}
        return status, {"Retry-After": retry} if retry else {}, data
    except (OSError, ValueError):
        return 502, {}, {"error": "Semantic Scholar unavailable.", "code": "s2_upstream"}


def handler_for(proxy: OpenAlexProxy, quota: QuotaStore, allow_local: bool = False, trusted_proxies: list | None = None, expose_debug: bool = False):
    trusted = trusted_proxies or []

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, format, *args):  # noqa: A003
            # Never print request paths: they may contain DOIs or work ids.
            return

        def cors_headers(self, origin: str | None) -> dict:
            headers = {"Cache-Control": "no-store"}
            ok, _ = origin_allowed(origin, allow_local)
            if ok and origin:
                headers["Access-Control-Allow-Origin"] = origin
                headers["Vary"] = "Origin"
                headers["Access-Control-Allow-Headers"] = "Content-Type, X-Browser-Token, X-Session-Nonce, X-Client-Api"
                headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            return headers

        def reply(self, status: int, headers: dict, data: object, origin: str | None = None):
            raw = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            merged = {**self.cors_headers(origin), **headers}
            for key, value in merged.items():
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
            # Product requests must not smuggle debug fields unless local mode says so.
            if not expose_debug and any(key.startswith("debug_") for key in data):
                raise ValueError("Debug fields are not allowed.")
            return data

        def require_origin(self) -> str:
            origin = self.headers.get("Origin")
            ok, code = origin_allowed(origin, allow_local)
            if not ok:
                raise PermissionError(code)
            return origin or ""

        def session_creds(self) -> tuple[str, str]:
            token = (self.headers.get("X-Browser-Token") or "").strip()
            nonce = (self.headers.get("X-Session-Nonce") or "").strip()
            if not token or not nonce:
                raise ValueError("Missing X-Browser-Token or X-Session-Nonce.")
            return token, nonce

        def do_OPTIONS(self):
            origin = self.headers.get("Origin")
            ok, code = origin_allowed(origin, allow_local)
            if not ok:
                self.reply(403, {}, {"error": "Unsupported origin.", "code": code}, origin)
                return
            self.reply(204, {}, {}, origin)

        def do_GET(self):
            if self.path == "/api/version":
                self.reply(200, {}, version_info())
                return
            if self.path == "/health":
                # Loopback health may omit Origin; never include secrets.
                peer = peer_ip(self)
                if peer not in {"127.0.0.1", "::1"} and not allow_local:
                    self.reply(403, {}, {"error": "Health is loopback-only.", "code": "forbidden"})
                    return
                payload = {
                    "ok": True,
                    "service": "research-connected-web",
                    "key_configured": bool(proxy.key),
                    "openalex_mode": "key" if proxy.key else "mock" if proxy.allow_mock else "unconfigured",
                    "openalex_budget_ok": quota.openalex_allowed(),
                }
                if expose_debug:
                    payload["debug_allow_local"] = allow_local
                self.reply(200, {}, payload)
            else:
                self.reply(404, {}, {"error": "Not found."})

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in {
                "/api/session",
                "/api/openalex",
                "/api/semantic-scholar",
                "/api/quota/status",
                "/api/quota/reserve",
                "/api/quota/confirm",
                "/api/quota/release",
            }:
                self.reply(404, {}, {"error": "Not found."})
                return
            try:
                origin = self.require_origin()
            except PermissionError as error:
                self.reply(403, {}, {"error": "Unsupported origin.", "code": str(error) or "origin_forbidden"})
                return
            try:
                ip = client_ip(self, trusted)
                if path == "/api/session":
                    self.read_json()
                    if not quota.allow_request("session", ip):
                        self.reply(429, {"Retry-After": "60"}, {"error": "Session requests too frequent.", "code": "query_rate"}, origin)
                        return
                    session = quota.create_session((self.headers.get("X-Browser-Token") or "").strip())
                    self.reply(200, {}, session, origin)
                    return
                token = (self.headers.get("X-Browser-Token") or "").strip()
                nonce = (self.headers.get("X-Session-Nonce") or "").strip()
                if not quota.status(token, nonce).get("ok"):
                    self.reply(401, {}, {"error": "Session expired. Refresh the page.", "code": "session_invalid"}, origin)
                    return
                if path in {"/api/openalex", "/api/semantic-scholar", "/api/quota/reserve"}:
                    if self.headers.get("X-Client-Api") != "2":
                        self.reply(426, {}, {"error": "A new version is required. Save your work and refresh; local viewing and copying remain available.", "code": "client_outdated"}, origin)
                        return
                if path in {"/api/openalex", "/api/semantic-scholar"}:
                    payload = self.read_json()
                    if not quota.allow_request("query", ip, token):
                        self.reply(429, {"Retry-After": "60"}, {"error": "Queries too frequent. Try again later.", "code": "query_rate"}, origin)
                        return
                    result = proxy.request(payload) if path == "/api/openalex" else forward_s2(payload, origin)
                    self.reply(*result, origin)
                    return
                if path == "/api/quota/status":
                    self.reply(200, {}, quota.status(token, nonce), origin)
                    return
                body = self.read_json()
                if path == "/api/quota/reserve":
                    decision = quota.reserve(
                        token,
                        nonce,
                        str(body.get("action") or ""),
                        client_ip(self, trusted),
                        str(body.get("idempotency_key") or ""),
                    )
                    self.reply(200 if decision.ok else 429, {}, decision_payload(decision), origin)
                    return
                reservation_id = str(body.get("reservation_id") or "")
                idempotency_key = str(body.get("idempotency_key") or "")
                if path == "/api/quota/confirm":
                    decision = quota.confirm(token, nonce, reservation_id, idempotency_key)
                    self.reply(200 if decision.ok else 409, {}, decision_payload(decision), origin)
                    return
                if path == "/api/quota/release":
                    decision = quota.release(token, nonce, reservation_id, idempotency_key or None, takeover=body.get("takeover") is True)
                    self.reply(200 if decision.ok else 409, {}, decision_payload(decision), origin)
                    return
            except ValueError as error:
                self.reply(400, {}, {"error": str(error), "code": "bad_request"}, self.headers.get("Origin"))
            except Exception:
                self.reply(500, {}, {"error": "Internal error.", "code": "internal"}, self.headers.get("Origin"))

    return Handler


def main(argv: list[str] | None = None):
    import argparse
    parser = argparse.ArgumentParser(description="Research Connected OpenAlex + quota proxy")
    parser.add_argument("--host", default=os.environ.get("LISTEN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LISTEN_PORT", "9186")))
    parser.add_argument("--state", default=os.environ.get("QUOTA_STATE_PATH", "/var/lib/research-connected/quota-state.json"))
    parser.add_argument("--allow-local", action="store_true", default=env_flag("OPENALEX_ALLOW_LOCAL", "OPENALEX_ALLOW_LOCAL_ORIGINS"))
    parser.add_argument("--mock", action="store_true", default=env_flag("OPENALEX_ALLOW_MOCK"))
    args = parser.parse_args(argv)
    key = os.environ.get("OPENALEX_API_KEY", "")
    contact = os.environ.get("OPENALEX_CONTACT_EMAIL", "")
    budget = float(os.environ.get("OPENALEX_DAILY_BUDGET_USD", "1"))
    cost = float(os.environ.get("OPENALEX_REQUEST_COST_USD", "0.0001"))
    trusted = parse_trusted_proxies(os.environ.get("TRUSTED_PROXIES", ""))
    allow_mock = args.mock or (args.allow_local and not key)
    quota = QuotaStore(args.state, openalex_budget_usd=budget, request_cost_usd=cost)
    proxy = OpenAlexProxy(key, quota, contact_email=contact, allow_mock=allow_mock)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        handler_for(proxy, quota, allow_local=args.allow_local, trusted_proxies=trusted, expose_debug=args.allow_local),
    )
    print(json.dumps({
        "listening": f"{args.host}:{args.port}",
        "key_configured": bool(key),
        "allow_local": args.allow_local,
        "openalex_mode": "key" if key else "mock" if allow_mock else "unconfigured",
    }), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
