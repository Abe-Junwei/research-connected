"""Bounded Semantic Scholar proxy; run one process so all visitors share its queue."""
import collections
import datetime
import email.utils
import http.server
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_BODY = 65536
MAX_RESPONSE = 4 * 1024 * 1024
MAX_CACHE = 16 * 1024 * 1024
FIELDS = {
    "citationCount", "referenceCount", "externalIds", "abstract", "embedding",
    "contexts", "intents", "isInfluential", "title", "year",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def valid_doi(value):
    return isinstance(value, str) and len(value) <= 512 and re.fullmatch(r"10\.\d{4,9}/[^\s\x00-\x1f\x7f]+", value) is not None


def validate(payload):
    if not isinstance(payload, dict) or set(payload) - {"method", "path", "query", "body"}:
        raise ValueError("Invalid request.")
    method, path, query = payload.get("method"), payload.get("path"), payload.get("query")
    if not isinstance(path, str) or len(path) > 2048 or not isinstance(query, dict):
        raise ValueError("Invalid path or query.")
    fields = query.get("fields")
    if not isinstance(fields, str) or not fields or len(fields) > 512 or not set(fields.split(",")) <= FIELDS:
        raise ValueError("Unsupported fields.")
    body = None
    if method == "POST" and path == "/graph/v1/paper/batch" and set(query) == {"fields"}:
        body = payload.get("body")
        if not isinstance(body, dict) or set(body) != {"ids"} or not isinstance(body["ids"], list) or not 1 <= len(body["ids"]) <= 500:
            raise ValueError("Expected 1–500 DOI identifiers.")
        if not all(isinstance(x, str) and x.startswith("DOI:") and valid_doi(x[4:]) for x in body["ids"]):
            raise ValueError("Invalid DOI identifier.")
        body = json.dumps(body, separators=(",", ":")).encode()
    elif method == "GET" and "body" not in payload:
        match = re.fullmatch(r"/graph/v1/paper/DOI:([^?#]+?)(/references)?", path)
        if not match or not valid_doi(urllib.parse.unquote(match[1])):
            raise ValueError("Unsupported paper path.")
        if match[2]:
            if set(query) - {"fields", "limit", "offset"} or query.get("limit") != "1000" or query.get("offset", "0") not in {"0", "1000", "2000"}:
                raise ValueError("Unsupported reference page.")
        elif set(query) != {"fields"} or fields != "abstract":
            raise ValueError("Unsupported paper lookup.")
    else:
        raise ValueError("Unsupported operation.")
    return method, "https://api.semanticscholar.org" + path + "?" + urllib.parse.urlencode(query), body


class Proxy:
    def __init__(self, key, opener=None, interval=1.1, allow_anonymous=False):
        self.key, self.opener, self.interval = key, opener or urllib.request.build_opener(NoRedirect()).open, interval
        self.allow_anonymous = allow_anonymous
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(16)
        self.cache = collections.OrderedDict()
        self.cache_bytes = 0
        self.next_request = 0
        self.day, self.requests = "", 0

    def request(self, payload):
        method, url, body = validate(payload)
        if not self.key and not self.allow_anonymous:
            return 503, {}, {"error": "Semantic Scholar system API key is not configured; using available local evidence."}
        if not self.slots.acquire(blocking=False):
            return 503, {"Retry-After": "10"}, {"error": "Semantic Scholar queue is full. Try again later."}
        try:
            # shortcut: one process owns the quota; use a shared queue before adding replicas.
            if not self.lock.acquire(timeout=20):
                return 503, {"Retry-After": "10"}, {"error": "Semantic Scholar queue timed out."}
            try:
                cache_key = (url, body)
                cached = self.cache.get(cache_key)
                if cached and cached[0] > time.monotonic():
                    self.cache.move_to_end(cache_key)
                    return 200, {}, cached[1]
                delay = self.next_request - time.monotonic()
                if delay > 5:
                    return 429, {"Retry-After": str(max(1, int(delay + 1)))}, {"error": "Semantic Scholar is cooling down. Try again later."}
                if delay > 0:
                    time.sleep(delay)
                today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
                if self.day != today:
                    self.day, self.requests = today, 0
                if self.requests >= 6500:
                    return 429, {"Retry-After": "3600"}, {"error": "Semantic Scholar daily service budget reached."}
                self.requests += 1
                self.next_request = time.monotonic() + self.interval
                req = urllib.request.Request(url, data=body, method=method, headers={
                    "Accept": "application/json", "Content-Type": "application/json", **({"x-api-key": self.key} if self.key else {}),
                })
                try:
                    with self.opener(req, timeout=15) as response:
                        raw = response.read(MAX_RESPONSE + 1)
                    if len(raw) > MAX_RESPONSE:
                        raise ValueError("Response too large.")
                    data = json.loads(raw)
                    if method == "POST":
                        ids = json.loads(body)["ids"]
                        if not isinstance(data, list) or len(data) != len(ids) or any(x is not None and (not isinstance(x, dict) or not set(x) & {"paperId", "citationCount", "referenceCount", "abstract", "embedding"}) for x in data):
                            raise ValueError("Invalid batch response.")
                    elif not isinstance(data, dict) or ("/references?" in url and not isinstance(data.get("data"), list)) or ("/references?" not in url and "abstract" not in data):
                        raise ValueError("Invalid paper response.")
                except urllib.error.HTTPError as error:
                    headers = {}
                    if error.code == 429:
                        retry = error.headers.get("Retry-After", "5")
                        try:
                            seconds = float(retry)
                        except ValueError:
                            try:
                                seconds = email.utils.parsedate_to_datetime(retry).timestamp() - time.time()
                            except (TypeError, ValueError, OverflowError):
                                seconds = 5
                        if not 0 <= seconds <= 86400:
                            seconds = 60
                        self.next_request = max(self.next_request, time.monotonic() + seconds)
                        headers["Retry-After"] = str(max(1, int(seconds + 1)))
                    error.close()
                    access = "authenticated" if self.key else "anonymous shared access"
                    return error.code, headers, {"error": f"Semantic Scholar {access} failed (HTTP {error.code}); using available local evidence."}
                except (OSError, ValueError):
                    return 502, {}, {"error": "Semantic Scholar returned unavailable or invalid data; using available local evidence."}
                ttl = 300 if data is None or isinstance(data, list) and any(x is None for x in data) else 3600
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


def handler_for(proxy):
    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def reply(self, status, headers, data):
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

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {}, {"ok": True, "key_configured": bool(proxy.key), "access_mode": "key" if proxy.key else "anonymous" if proxy.allow_anonymous else "unconfigured"})
            else:
                self.reply(404, {}, {"error": "Not found."})

        def do_POST(self):
            if self.path not in {"/research-connected/preview/api/semantic-scholar", "/research-connected/api/semantic-scholar", "/api/semantic-scholar"}:
                self.reply(404, {}, {"error": "Not found."})
                return
            origin = self.headers.get("Origin")
            allowed = {"https://status.jieyu.ai", "https://status.jieyu.ai:8443", "https://graph.jieyu.ai", "https://graph.jieyu.ai:8443"}
            if origin and origin not in allowed:
                self.reply(403, {}, {"error": "Unsupported origin."})
                return
            try:
                if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
                    raise ValueError("Expected a JSON request.")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    self.reply(413, {}, {"error": "Invalid request size."})
                    return
                payload = json.loads(self.rfile.read(length))
                self.reply(*proxy.request(payload))
            except (ValueError, UnicodeError):
                self.reply(400, {}, {"error": "Invalid Semantic Scholar request."})
            except OSError:
                self.reply(408, {}, {"error": "Request body timed out."})

        def log_message(self, format, *args):
            pass  # Do not log DOI payloads, headers, or credentials.
    return Handler


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", 9185), handler_for(Proxy(os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip(), allow_anonymous=os.environ.get("S2_ALLOW_ANONYMOUS") == "1"))).serve_forever()
