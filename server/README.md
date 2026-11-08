# Browser Semantic Scholar transport

The browser workspace and embed send Semantic Scholar requests to the same-origin
`api/semantic-scholar` endpoint. Other data sources retain their existing transport.
Obsidian still uses its direct `obsidianGetJson`/`obsidianPostJson` transport and personal credentials. Both hosts now apply the shared source-quality checks; the plugin does not use this proxy.

Run a **single** Python 3.12+ process using `research-connected-s2.service`.
Install `s2_proxy.py` at `/opt/research-connected/server/s2_proxy.py` and create
`/etc/research-connected-s2.env`, readable only by root:

```ini
SEMANTIC_SCHOLAR_API_KEY=
S2_ALLOW_ANONYMOUS=1
```

Anonymous mode is explicitly enabled for an installation whose key application
was not approved. It uses the shared public API pool and may receive 429 errors;
it is not a substitute for an approved dedicated quota. If a key is obtained,
edit the environment file on the server, set `S2_ALLOW_ANONYMOUS=0`, and restart
`research-connected-s2`. Never put a system key in browser storage or bundles.

The proxy validates fixed paper operations (up to 500 DOI IDs), refuses redirects,
caps request bodies at 64KiB, responses at 4MiB, cache payloads at 16MiB/600 entries,
and pending requests at 16. One queue spaces upstream GET and POST starts by at
least 1.1 seconds, including retries initiated by the existing client. It honors
429 cooldown across all clients and does not itself retry. It permits at most
6,500 upstream attempts per UTC day per process; that ceiling resets on restart.
It is a safety cap, not a guarantee of 500 successful builds. User actions and
missing references affect requests per build. No DOI payloads or keys are logged.
Cache lifetime is one hour, or five minutes for batches containing misses.

Bind only `127.0.0.1:9185`. The reverse proxy forwards only these exact POST paths:

```
/research-connected/preview/api/semantic-scholar
/research-connected/api/semantic-scholar
```

`GET /health` is loopback-only and reports `key`, `anonymous`, or `unconfigured`
without disclosing credentials. Allow the research-connected static directory
separately from the status dashboard's existing authentication. Keep all unrelated
status routes behind their existing login. Browser Origin checks accept only
`https://status.jieyu.ai` and its `:8443` variant; deployment to another hostname
requires updating that explicit allowlist.

Run `python3 -m unittest discover -s server -p 'test_*.py'`, `npm run test:s2`,
`npm test`, `npm run build`, and `npm run preview` before deployment. Verify actual
upstream responses after deployment: transport success alone does not establish
that a paper has an abstract or a compatible embedding. Local text/structural
evidence remains available when enhancement is incomplete.


## OpenAlex system proxy + operation quota (`openalex_proxy.py`)

Formal web product only (`https://graph.jieyu.ai`). Not used by the Obsidian plugin.

### Security
- **Origin required** on every product POST (`/api/session`, `/api/openalex`, `/api/quota/*`). Missing or foreign Origins return **403** with `origin_required` / `origin_forbidden`.
- Local debugging Origins (`http://127.0.0.1:*`, `http://localhost:*`) only when `OPENALEX_ALLOW_LOCAL_ORIGINS=true` (or `OPENALEX_ALLOW_LOCAL=1`). Debug response fields are likewise local-only.
- **Session**: `POST /api/session` issues an unforgeable `browser_token` + `session_nonce`. Quota reserve binds both; confirm/release must present the same pair plus the tab `idempotency_key`.
- **Client IP**: `CF-Connecting-IP` / `X-Forwarded-For` are honored only when the TCP peer is listed in `TRUSTED_PROXIES`. Otherwise the socket peer is used (prevents spoofing on loopback).
- Request paths/DOIs are never written by the Python logger. Caddy must also delete `uri` / query / body for `/api/*` (see `docs/caddy-graph.jieyu.ai.snippet.caddy`).

### Quotas
- Browser 10 / site 500 successful confirms; Beijing **08:00** operation periods.
- Reservations **do not migrate** into a new operation period; cross-period confirm returns `period_closed` / `expired` without charging.
- 5-minute reserve TTL; late confirm is rejected. Browser also refuses save→confirm after expiry (`assertActive`).
- OpenAlex **$1** free budget resets on the **UTC calendar day**. Hold → settle/refund so failed upstream calls do not keep pre-charges; holds cannot push committed+held spend over $1.

### Local (Mac) without a real key
```bash
export OPENALEX_ALLOW_LOCAL_ORIGINS=true
export OPENALEX_API_KEY=
export OPENALEX_ALLOW_MOCK=1
export QUOTA_STATE_PATH=/tmp/rc-quota-state.json
python3 server/openalex_proxy.py --port 9186 --state "$QUOTA_STATE_PATH" --allow-local --mock
npm run web
python3 server/local_web_dev.py --port 4190
```
Open `http://127.0.0.1:4190/` (formal web). Old preview remains separate.

### Ports
| Port | Role |
|---|---|
| 443 | Xray — never bind the site here |
| 8443 | Cloudflare origin HTTPS |
| 9185 | Existing S2 proxy — do not move |
| 9186 | This OpenAlex + quota proxy (loopback) |
| 4190 | Local static formal web (dev only) |

Tests: `python3 -m unittest discover -s server -p 'test_*.py'`.
