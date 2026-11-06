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

- Bind `127.0.0.1:9186` (do not collide with S2 on `9185`, and never bind `:443`).
- Env file template: `research-connected-web.env.example` → `/etc/research-connected-web.env` (root 0600).
- Endpoints: `POST /api/openalex`, `POST /api/quota/{status,reserve,confirm,release}`, `GET /health`.
- Origin allowlist: `https://graph.jieyu.ai` (+ `:8443`). Local origins only when `OPENALEX_ALLOW_LOCAL=1`.
- Beijing 08:00 quota periods; browser 10 / site 500 successful confirms; IP 10 starts/minute; 5-minute reservations.
- OpenAlex daily free budget defaults to `$1` with no top-up. Request paths/DOIs are never logged.
- Persist counters in `QUOTA_STATE_PATH` so restarts do not reset the period.

Tests: `python3 -m unittest discover -s server -p 'test_*.py'`.
