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
| Live stream abuse | `GET /mcp` (SSE) | key + session ownership checked, at most 2 streams per session, keep-alive pings, streams closed with the session | follow-ups test |
| **D**enial of service | `/mcp` | 1 MB body cap, 120 calls/min and 10 bundles/h per key, 500 ops per changeset, 256 KB per item, 2,000 nodes, 200 bindings per call, 24 h changeset expiry | M2 rate limits, M7 |
| **E**levation of privilege | scopes | `read` / `request` / `propose` checked per tool; an API key never approves; auto-approve only through the owner's project setting `pushRequiresReview = false` | M5 scope test, M4 |

### AI-assisted design keys (scope `design`, account keys only)

| Threat | Mitigation | Sensor |
|---|---|---|
| Agent reads the public library, other users' or shared projects | strict principal: `AccountService` answers `NOT_FOUND` for every project that is not the user's own; search drops the public scope; `getItem` / workflows / item-request fulfil refuse non-project, non-own-private items | `mcp-design.test.js` isolation (+ control with a plain key) |
| Agent copies foreign data into its project | create / clone / init `fromProject` resolve owned projects only; references to public or foreign items fail validation (`#readable`) instead of being adopted | isolation tests |
| Agent controls "the whole DB" | no SQL, no generic table tools; a fixed tool list; the designer REST API rejects API keys (401); the only delete is a `-vNNN` copy of the focused master (`uiux_delete_version`, `uiux_purge_versions` with `confirm`) | isolation tests |
| Agent publishes or shares | design keys create private projects only; visibility `public` is refused; no member / key / settings tools exist | create test |
| Unreviewed writes | the review step is skipped only for the owner's own design key on the owner's own focused project (`autoApprove` is set by `DesignSessionService` alone, never by a tool argument); every save is a version, every call audited | save tests, M4 review tests |
| Stale or foreign focus | the focus row is re-checked on every call (project exists, still owned); rows cascade with the key and are private (not synced, purged from public exports) | focus tests |
| Version purge loses work | `confirm: true` required; the plan names the winner, the deleted versions and the dropped unsaved edits; a failed replace deletes nothing | purge test |
| Project spam | 10 new projects per hour per key (`save_as`, clone, create), 500 ops per changeset | rate-limit tests |

Residual: a design key can still delete or overwrite anything inside the focused project and its own versions (that is its job); the owner restores through the version history (`uiux_restore_version` is applied directly for design keys) or the designer.

Residual risks (accepted, tracked):
1. ~~Global `UNIQUE(key)`~~ fixed: keys are unique per project (tenant data cannot collide across projects).
2. ~~Numeric action targets~~ fixed: actions are portable (`{type, uid, key}`), and targets are resolved with the same visibility checks as instances.
3. The core web app still trusts the `x-user-id` header when no session token is sent (legacy single-user mode); the agent user is suspended so it cannot be impersonated this way. Recommended: disable header auth in multi-user deployments.
4. Load measured in-process: 400 mixed calls, 8 concurrent, p95 ≈ 60 ms on the dev machine.

Verdict: **PASS** for v1 scope (no open high/critical findings).
