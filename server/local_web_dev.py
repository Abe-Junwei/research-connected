"""Local formal-web static server + /api reverse proxy to 9186.

Isolated from the old preview tree. Serves web/dist on WEB_PORT (default 4190).
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    proxy_base = "http://127.0.0.1:9186"

    def log_message(self, format, *args):  # noqa: A003
        # Avoid writing query strings that may contain DOIs.
        path = self.path.split("?", 1)[0]
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), path))

    def _proxy(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        headers = {}
        for key in ("Content-Type", "Origin", "X-Browser-Token", "X-Session-Nonce"):
            value = self.headers.get(key)
            if value:
                headers[key] = value
        req = urllib.request.Request(self.proxy_base + self.path.split("?", 1)[0], data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(payload)))
                origin = response.headers.get("Access-Control-Allow-Origin")
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            error.close()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/api/") or self.path == "/health":
            # health is on the proxy process; expose a tiny local note instead
            if self.path == "/health":
                payload = json.dumps({"ok": True, "static": True, "proxy": self.proxy_base}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            self._proxy()
            return
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", default=str(Path(__file__).resolve().parents[1] / "web" / "dist"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WEB_PORT", "4190")))
    parser.add_argument("--proxy", default=os.environ.get("PROXY_BASE", "http://127.0.0.1:9186"))
    args = parser.parse_args()
    os.chdir(args.dist)
    Handler.proxy_base = args.proxy.rstrip("/")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"static": f"http://127.0.0.1:{args.port}/", "proxy": Handler.proxy_base, "dist": args.dist}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
