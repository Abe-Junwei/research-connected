# Semantic Scholar browser transport — 2026-11-06

The shared graph algorithm is unchanged. Both browser entry points now send S2
batch POST and paper GET requests through a same-origin Python proxy. Obsidian
retains its host adapter. Projects remain in browser storage and exports remain
clipboard text. OpenAlex/Crossref/OpenCitations transport is unchanged.

## Deployment

- Public page: https://status.jieyu.ai/research-connected/preview/
- Public S2 endpoint: `/research-connected/preview/api/semantic-scholar`.
- Service: `research-connected-s2`, listening only on `127.0.0.1:9185`.
- Code: `/opt/research-connected/server/s2_proxy.py`.
- Environment: `/etc/research-connected-s2.env`, root-only mode 0600.
- Access mode: **anonymous**; the owner's key application was not approved.
- Previous Caddy configuration and static site are backed up at
  `/var/backups/research-connected-20261106T024656Z`.

Only `/research-connected/*` is public. Unauthenticated status homepage still
returns 302 to `/login?next=/`. No system key was added to static bundles or browser
storage. Caddy configuration passed validation before reload.

## Verified

- `npm run lint`, `npm test`, `npm run build`, `npm run preview`, and
  `npm run test:browser:build` passed.
- Four Python tests passed locally and on VPS Python 3.12: operation/identifier
  validation; system-key handling and opt-in anonymous mode; shared GET/POST
  spacing and duplicate cache coalescing; 429 cooldown and invalid-response
  handling; HTTP origin/body boundary and response path.
- The browser regression page reported PASS for reading persistence/rollback,
  citation-path validation, exports, graph interactions, narrow layout, reopen,
  and cleanup.
- A fresh online browser query for `10.1038/nature14539` produced 50 nodes and 169
  edges. The UI reported S2 matching 88/98 DOIs in one request, 10 unmatched,
  six abstracts added, and **zero usable candidate vectors**. OpenCitations
  completed 20/20 checks. The seed abstract lookup separately received S2 429;
  the page exposed a retry action and kept the graph usable.
- Independent anonymous probes returned 429; one embedding-request probe returned
  400. Successful metadata transport does not establish vector availability or
  reliable anonymous service. Existing fallback/retry logic is retained.

## Remaining limits

Anonymous S2 capacity is shared and unstable. Neither a dedicated S2 quota nor a
compatible embedding response has been verified. The proxy can use an approved
key later without rebuilding the frontend. Its 6,500-upstream-attempt daily cap
and bounded queue are safety ceilings, not a production SLA; counters/cache are
in-memory and reset on restart. Multi-process replicas require shared quota
coordination first. No production load test or OpenAlex system-key proxy is part
of this change.

Local pre-existing timer changes in `src/citation-sources.ts` and
`src/s2-batch.ts`, and `scripts/track-literature.ts`, were preserved. The timer
adapters have a scoped lint exception for their existing Node-compatible
`globalThis` usage. This deployment was not committed or pushed to Git.

To roll back this deployment alone, restore the backed-up Caddyfile and site,
validate and reload Caddy, then stop/disable `research-connected-s2`. If other
changes have subsequently landed in Caddy, remove only this deployment's
research-connected route block instead of overwriting newer configuration.
