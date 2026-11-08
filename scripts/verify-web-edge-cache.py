"""Public deployment check; no literature queries or quota operations.

Uses curl so the network path matches the existing desktop measurement tools.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path

BASE = "https://graph.jieyu.ai"


def request(path, method="GET", headers=None):
    with tempfile.TemporaryDirectory() as tmp:
        args = ["curl", "--silent", "--show-error", "--compressed", "--max-time", "25",
                "-D", str(Path(tmp) / "headers")]
        for key, value in (headers or {}).items():
            args += ["-H", f"{key}: {value}"]
        if method == "POST":
            args += ["--data", "{}"]
        result = subprocess.run(args + [BASE + path], capture_output=True, check=True)
        raw = (Path(tmp) / "headers").read_text()
        status = int(re.findall(r"HTTP/\S+ (\d+)", raw)[-1])
        values = {key.lower(): value.strip() for key, value in re.findall(r"(?m)^([^:\n]+): ([^\n]*)", raw)}
        return status, values, result.stdout


def check_public(path, policy):
    hits = []
    for _ in range(4):
        status, headers, body = request(path)
        assert status == 200, (path, status)
        assert policy in headers.get("cache-control", ""), (path, headers)
        hits.append(headers.get("cf-cache-status"))
        if hits[-1] == "HIT":
            print(path, "edge HIT;", headers["cache-control"])
            return body
    raise AssertionError((path, "No edge HIT in four requests", hits))


html = check_public("/", "max-age=60").decode()
for name in set(re.findall(r'(?:href|src)="\./((?:web-|styles-)[^"/]+\.(?:js|css))"', html)):
    check_public("/" + name, "max-age=31536000, immutable")

for path in ["/api/version", "/version.json", "/health", "/api/not-found.js"]:
    status, headers, _ = request(path)
    assert "no-store" in headers.get("cache-control", ""), (path, status, headers)
    assert headers.get("cf-cache-status") != "HIT", (path, headers)
    print(path, status, "not cached")

headers = {"Content-Type": "application/json", "Origin": BASE, "X-Client-Api": "2"}
status, response_headers, body = request("/api/session", "POST", headers)
assert status == 200 and "no-store" in response_headers.get("cache-control", "")
session = json.loads(body)
headers.update({"X-Browser-Token": session["browser_token"], "X-Session-Nonce": session["session_nonce"]})
status, response_headers, _ = request("/api/quota/status", "POST", headers)
assert status == 200 and "no-store" in response_headers.get("cache-control", "")
assert response_headers.get("cf-cache-status") != "HIT"
status, response_headers, _ = request("/", "POST", headers)
assert status == 405 and response_headers.get("cf-cache-status") != "HIT"
print("Session/quota status valid, POST home uncached; no operations or literature queries issued")
