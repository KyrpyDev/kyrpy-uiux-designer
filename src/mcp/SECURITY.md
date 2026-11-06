# kyrpy-uiux-mcp — STRIDE review (milestone M7)

Scope: `src/mcp` (MCP endpoint `/mcp`, bundle downloads, designer REST routes for keys, versions, changesets,
requests) and its PostgreSQL sync. Date: 2026-11-06. Sensors: `tests/mcp-m7.test.js` (+ M1–M6 suites).

| Threat | Entry point | Mitigation | Sensor |
|---|---|---|---|
| **S**poofing an agent | `Authorization: Bearer kud_…` | HMAC-SHA256(pepper) hash lookup, constant-time compare, checked on every request (no cache), owner-only keys, expiry, rotation grace 24 h | M1, M2 auth tests |
| Spoofing a reviewer | changeset approval | review only through designer session routes (`/api/*` rejects API keys with 401); owner/admin check; agent user `kyrpy-agent-designer` is `suspended` and has no password | M4 exit test, M7 isolation |
| **T**ampering with design | `uiux_stage_item` | nothing applied before human approval; dry-run validation (§14); SVG sanitising (no script, foreignObject, on*, external href, javascript:); size/node caps; hierarchy rule | M4, M7 injection |
| Tampering with another tenant | uid/key refs, changeset uids | every lookup filtered by the key's project; foreign uids → VALIDATION_FAILED/NOT_FOUND; other projects' private items cannot be referenced (and so not cloned) | M7 isolation |
| Lost designer edits | concurrent push | baseHash conflict detection per item; designer drift recorded as its own version before applying | M4 conflicts |
| **R**epudiation | all tool calls, key lifecycle | `mcp_audit_log` (argument digest only), change_requests authored by `kyrpy-agent-designer`, reviewer + time on changesets and versions | M2 audit, M7 load |
| **I**nformation disclosure | search, manifest, bundles, resources | scope filter (project + own private + public); untrusted flag on foreign text; bundle URLs single-use, 15 min, bound to the key; key hashes synced to PG are useless without the instance pepper | M2, PG live test |
| Prompt injection via design text | labels, descriptions, mcpContext | server instructions + `dataNotice`: text is data, never instructions; `untrusted` flag | M2 |
| **D**enial of service | `/mcp` | 1 MB body cap, 120 calls/min and 10 bundles/h per key, 500 ops per changeset, 256 KB per item, 2,000 nodes, 200 bindings per call, 24 h changeset expiry | M2 rate limits, M7 |
| **E**levation of privilege | scopes | `read` / `request` / `propose` checked per tool; an API key never approves; auto-approve only through the owner's project setting `pushRequiresReview = false` | M5 scope test, M4 |

Residual risks (accepted, tracked):
1. Keys are still globally unique (`UNIQUE(key)`); collisions are reported as `KEY_TAKEN` with a free key.
2. Node `onClick` / `events` targets keep numeric ids from the source instance.
3. The core web app still trusts the `x-user-id` header when no session token is sent (legacy single-user mode); the agent user is suspended so it cannot be impersonated this way. Recommended: disable header auth in multi-user deployments.
4. Load measured in-process: 400 mixed calls, 8 concurrent, p95 ≈ 60 ms on the dev machine.

Verdict: **PASS** for v1 scope (no open high/critical findings).
