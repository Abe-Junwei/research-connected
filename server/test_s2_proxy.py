"""Run: python3 -m unittest discover -s server -p 'test_*.py'. No network."""
import concurrent.futures
import http.server
import io
import json
import threading
import time
import unittest
import urllib.error
import urllib.request
from s2_proxy import Proxy, handler_for, validate

BATCH = {"method": "POST", "path": "/graph/v1/paper/batch", "query": {"fields": "citationCount,referenceCount,externalIds,abstract,embedding"}, "body": {"ids": ["DOI:10.1038/nature14539"]}}
GET = {"method": "GET", "path": "/graph/v1/paper/DOI:10.1038%2Fnature14539/references", "query": {"fields": "externalIds", "limit": "1000"}}


class ProxyCheck(unittest.TestCase):
    def test_validation_and_key(self):
        self.assertEqual(validate(BATCH)[0], "POST")
        self.assertEqual(validate(GET)[0], "GET")
        self.assertEqual(Proxy("").request(BATCH)[0], 503)
        def anonymous(req, timeout):
            self.assertIsNone(req.get_header("X-api-key"))
            return io.BytesIO(b'[{"abstract":"available"}]')
        self.assertEqual(Proxy("", anonymous, allow_anonymous=True).request(BATCH)[0], 200)
        for bad in [[], {**BATCH, "url": "http://127.0.0.1"}, {**BATCH, "path": "//evil.test"}, {**BATCH, "body": {"ids": ["DOI:not-a-doi"]}}, {**BATCH, "body": {"ids": ["DOI:10.1234/a"]*501}}, {**BATCH, "query": {"fields": "abstract", "api_key": "client-key"}}, {**GET, "query": {**GET["query"], "offset": "3000"}}]:
            with self.assertRaises(ValueError):
                validate(bad)

    def test_queue_cache_and_server_key(self):
        starts = []
        def open_request(req, timeout):
            self.assertEqual(req.get_header("X-api-key"), "server-key")
            starts.append(time.monotonic())
            return io.BytesIO(json.dumps([{"abstract": "text"}] if req.method == "POST" else {"data": []}).encode())
        proxy = Proxy("server-key", open_request, interval=.025)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            rows = list(pool.map(proxy.request, [BATCH, GET, BATCH]))
        self.assertTrue(all(row[0] == 200 for row in rows))
        self.assertEqual(len(starts), 2, "concurrent duplicate batches share the cached result")
        self.assertGreaterEqual(starts[1]-starts[0], .024, "GET and POST share one queue")

    def test_rate_limit_and_invalid_response_are_not_cached(self):
        calls = []
        def limited(req, timeout):
            calls.append(req)
            raise urllib.error.HTTPError(req.full_url, 429, "limited", {"Retry-After": "60"}, None)
        proxy = Proxy("key", limited, interval=0)
        self.assertEqual(proxy.request(BATCH)[0], 429)
        self.assertEqual(proxy.request(GET)[0], 429)
        self.assertEqual(len(calls), 1, "upstream Retry-After applies to every caller and endpoint")
        self.assertFalse(proxy.cache)
        invalid = Proxy("key", lambda *a, **kw: io.BytesIO(b'{"error":"bad"}'), interval=0)
        self.assertEqual(invalid.request(BATCH)[0], 502)
        self.assertFalse(invalid.cache)
        invalid.requests = 6500
        invalid.day = time.strftime("%Y-%m-%d", time.gmtime())
        self.assertEqual(invalid.request(BATCH)[0], 429)

    def test_http_boundary(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_for(Proxy("", lambda *a, **kw: io.BytesIO(b'[{"abstract":"available"}]'), allow_anonymous=True)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base+"/health") as r:
                self.assertEqual(json.load(r), {"ok": True, "key_configured": False, "access_mode": "anonymous"})
            req = urllib.request.Request(base+"/research-connected/preview/api/semantic-scholar", data=json.dumps(BATCH).encode(), headers={"Content-Type":"application/json", "Origin":"https://status.jieyu.ai"})
            with urllib.request.urlopen(req) as r:
                self.assertEqual(json.load(r), [{"abstract":"available"}])
            for payload, origin, expected in [(BATCH, "https://evil.test", 403), ({"url": "http://localhost"}, "https://status.jieyu.ai", 400)]:
                req = urllib.request.Request(base+"/research-connected/preview/api/semantic-scholar", data=json.dumps(payload).encode(), headers={"Content-Type":"application/json", "Origin":origin})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(req)
                self.assertEqual(error.exception.code, expected)
                error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
