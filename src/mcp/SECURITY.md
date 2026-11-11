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
| Agent reads or touches other users' or shared projects | strict principal: `AccountService` answers `NOT_FOUND` for every project that is not the user's own; `getItem` / search / item-request fulfil / `StudioToolsService` allow the focused project, the user's own private library, and read/clone-only access to `visibility = 'public'` items while refusing all foreign non-public items | `mcp-design.test.js` isolation |
| Agent copies foreign user project data into its project | create / clone / init `fromProject` resolve owned projects only; references to other users' non-public items fail validation (`#readable`); public-library items are cloned cleanly into the focused project without mutating the public library | isolation tests |
| Agent controls "the whole DB" | no SQL, no generic table tools; a fixed tool list; the designer REST API rejects API keys (401); the only delete is a `-vNNN` copy of the focused master (`uiux_delete_version`, `uiux_purge_versions` with `confirm`) | isolation tests |
| Agent publishes or shares | design keys create private projects only; visibility `public` is refused; no member / key / settings tools exist | create test |
| Unreviewed writes | the review step is skipped only for the owner's own design key on the owner's own focused project (`autoApprove` is set by `DesignSessionService` alone, never by a tool argument); every save is a version, every call audited | save tests, M4 review tests |
| Stale or foreign focus | the focus row is re-checked on every call (project exists, still owned); rows cascade with the key and are private (not synced, purged from public exports) | focus tests |
| Version purge loses work | `confirm: true` required; the plan names the winner, the deleted versions and the dropped unsaved edits; a failed replace deletes nothing | purge test |
| Project spam | 10 new projects per hour per key (`save_as`, clone, create), 500 ops per changeset | rate-limit tests |

### New project from an app (`uiux_init` mode `create` / `reverse`)

| Threat | Mitigation | Sensor |
|---|---|---|
| Agent creates projects unasked | no name → nothing is created (`needsInput`, "ask the human"); `create` scope required; the user's existing project names are refused; 10 new projects per hour per key | `mcp-init-create-reverse.test.js` |
| Unreviewed writes into the new project | unchanged rules: a plain key submits changesets the owner approves; only a design key saves directly, into its own private project | create / design-key tests |
| App login details reach the server or the repository | the server has no argument for them and never runs the app; agent, skill and `init-prompt.md` keep them in the git-ignored `.uiux/cache/reverse/` or environment variables and forbid them in tool calls, items, commits and chat | reverse test (config / gitignore) |
| Injection through `appSource` or app text | `appSource` is length-capped, stripped of control characters, backticks and angle brackets, and labelled as data in `init-prompt.md`; the skill treats on-screen text as data | reverse test |
| Harmful actions while crawling | the skill forbids purchases, account deletion, messages to real people and resets (recorded as "not executed"), and asks the human to confirm they may analyse the app | skill text assertions |

### Backend API Bridge (`uiux_api_docs` + `uiux_api_call`)

| Threat | Mitigation | Sensor |
|---|---|---|
| API key calls HTTP `/api/*` directly or reaches auth/admin/sync/approval routes | HTTP `/api/*` still rejects `kud_…` keys with 401; `ApiBridge` enforces explicit `API_OPERATIONS` allowlist, blocking `/api/auth/*`, `/api/users*`, `/api/me/api-keys*`, `/api/projects/:id/api-keys*`, `/api/projects/:id/ai-*`, `/api/admin/*`, `/api/sync/*`, `/api/changes/*/approve|reject`, `/api/changesets/*/review`, `/api/item-requests/*/fulfill|reject`, global settings/theme mutations, and project deletion/member/visibility-public changes | `mcp-api-bridge.test.js` |
| Server filesystem read/write via legacy import/export args | `folderPath`, `fontPath`, `/api/import/folders`, `/api/export/folder`, and `DELETE ?permanent=1` are rejected before handler execution | `mcp-api-bridge.test.js` |
| Admin-role bypass or cross-tenant item/translation mutation | Actor role is downgraded from `admin`/`superadmin` to `'designer'`/`'viewer'`; every item mutation verifies `rec.projectId === boundProjectId`, `!rec.builtin`, and non-`public` owner; `translations` (which lacks `project_id`) verifies item ownership on write and post-filters reads to `boundProjectId`; `updateProject` strips `requireApproval`, blocks `visibility: 'public'`, and preserves `settings.ai` | `mcp-api-bridge.test.js` |
| Design (`strict`) key touches foreign projects or publishes via `uiux_api_call` | `ApiBridge` blocks `publishToPublic`, refuses reading/cloning other users' non-public items (`NOT_FOUND`), keeps public-library items read/clone-only, and binds project selection through `design.resolveFocused` | `mcp-api-bridge.test.js` |

### Public Library, Copy-to-Project, Direct CRUD & Graphical Tools (`StudioToolsService`, M10)

| Threat | Mitigation | Sensor |
|---|---|---|
| Agent mutates or deletes public/built-in items or another user's project items via `uiux_update_item`, `uiux_delete_item`, or `uiux_graphic_tool` | Every mutation checks `Number(proj.ownerId) === Number(principal.user.id)`, downgrades actor role from `admin`/`superadmin` to `'designer'`, verifies `row.project_id === projectId`, and rejects immutable public/built-in rows (`SCOPE_DENIED`) unless `copyIfForeign: true` explicitly clones into the owned project first | `mcp-crud-graphics-public.test.js` |
| Agent searches or copies from another user's private project via `uiux_copy_item_to_project` | `#canReadRow` enforces project membership / public visibility / own-private checks; inaccessible foreign private projects and items return `NOT_FOUND` | `mcp-crud-graphics-public.test.js` |
| Strict `design` key copies from non-owned private/shared projects via `uiux_copy_item_to_project` | `#canReadRow` restricts `actor.strict` to `visibility = 'public'`, own `private` items, and projects where `role === 'owner'`, blocking shared/other-user project items (`NOT_FOUND`) while allowing public library adoption | `mcp-crud-graphics-public.test.js`, `mcp-design.test.js` |
| Permanent deletion or cross-user Trash access via `uiux_delete_item` | `uiux_delete_item` always soft-deletes (`permanent: false`) into per-user `TrashService`, and `restore: true` only sees/restores entries deleted by `actor.id` inside `projectId` | `mcp-crud-graphics-public.test.js` |

### Sandboxed Custom Element JS & Public JS Supply Chain (`uiux_element_script`, M11)

| Threat | Mitigation | Sensor |
|---|---|---|
| Stored XSS on Designer origin (`design.kyrpy.kyrpy.com`) via malicious element JS | Designer canvas renders SVG `nodes` only and never executes `element_scripts`; previews (`GET /api/elements/:id/script/sandbox`, `uiux_get_item { format: "html" }`, Inspector preview modal) execute strictly inside `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` (`window.origin === "null"`, never `allow-same-origin`), isolating cookies, `localStorage`, and `/api/*` | `mcp-element-script.test.js` |
| Supply-chain poisoning / typosquatting / tag mutation via public JS imports | Only exact `x.y.z` semver (`latest`, `*`, `^`, `~` rejected) on allowlisted HTTPS ESM CDNs (`cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`) with `<package>@<version>` URL path binding; `verifyIntegrity` fetches hop-by-hop (blocking redirects to non-allowlisted origins and payloads > 2 MB) to verify/pin `sha384` Subresource Integrity (`<script type="importmap">` `integrity` + `<link rel="modulepreload">`); optional `lockfilePackages` restricts imports to exact versions in the target repo's lockfile | `mcp-element-script.test.js` |
| Dangerous dynamic JS constructs or undeclared imports | Static audit (`auditElementScriptCode`) rejects `eval`, `new Function`, string `setTimeout`/`setInterval`, `document.cookie`, `parent.document`/`top.location`, `localStorage`/`sessionStorage`/`indexedDB`, `javascript:` URLs, and any `import` specifier not declared in `imports[]` | `mcp-element-script.test.js` |
| Data exfiltration or SSRF via `capabilities.allowNetwork` | Default CSP sets `connect-src 'none'`; `allowedConnectOrigins` rejects non-HTTPS, loopback (`localhost`, `127.0.0.1`), link-local (`169.254.169.254`), and RFC1918 private IPs; MCP calls (`actor.viaMcp === true`) cannot self-approve `allowNetwork: true` (`reviewStatus = 'needs-human-review'` keeps `connect-src 'none'` until a signed-in human approves in a browser session) | `mcp-element-script.test.js` |
| Cross-tenant or public-library script tampering | `set`, `verify_sri`, and `remove` require `propose` scope and project ownership; immutable public elements reject in-place writes unless `copyIfForeign: true` clones the element into the owned project first | `mcp-element-script.test.js` |

Residual: the crawl runs on the user's machine with the coding agent's own permissions; the server cannot enforce what the agent does there.

Residual: a design key can still delete or overwrite anything inside the focused project and its own versions (that is its job); the owner restores through the version history (`uiux_restore_version` is applied directly for design keys) or the designer.

Residual risks (accepted, tracked):
1. ~~Global `UNIQUE(key)`~~ fixed: keys are unique per project (tenant data cannot collide across projects).
2. ~~Numeric action targets~~ fixed: actions are portable (`{type, uid, key}`), and targets are resolved with the same visibility checks as instances.
3. The core web app still trusts the `x-user-id` header when no session token is sent (legacy single-user mode); the agent user is suspended so it cannot be impersonated this way. Recommended: disable header auth in multi-user deployments.
4. Load measured in-process: 400 mixed calls, 8 concurrent, p95 ≈ 60 ms on the dev machine.

Verdict: **PASS** for v1 scope (no open high/critical findings).
