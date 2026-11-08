# `src/mcp` — kyrpy-uiux-mcp (design ↔ code sync for AI coding agents)

Specification: `docs/project-definition/project-definition-mcp.md` (internal design document, not part of the public repository; this README and [`SECURITY.md`](SECURITY.md) cover the shipped behaviour).
All MCP-layer code lives in this folder. The core touches it only through these small hooks:

| Core file | Hook |
|---|---|
| `infrastructure/sqlite/database.js` | `dropMcpTriggers()` before pending core migrations, `applyMcpSchema()` after them |
| `infrastructure/postgres/pg-sync-service.js` | `PG_SCHEMA_SQL = core DDL + MCP_PG_SCHEMA_SQL`; `schema_registry` in `SYNC_TABLES` |
| `package.json` | `npm test` also runs `mcp/tests/*.test.js` |
| `composition-root.js` | `container.mcp = buildMcpModule(...)` |
| `interfaces/http/server.js` | `/mcp` handler first (unless `MCP_MODE=off`), `mcpRoutes(router, container)`, client `ip` in handler args, static `/mcp-web/` |
| `main.js` | `node main.js mcp [--port 5181]` standalone MCP service |
| `interfaces/web/js/main.js` | profile button menu + Collaborate → "AI Access Keys (MCP)…" (lazy `import('/mcp-web/ai-keys-modal.js')`) |

## Layout

```
mcp/
  domain/                     pure, no I/O
    mcp-context.js            parse / validate / merge the mcp_context JSON (16 KB cap)
    uid.js                    UUIDv7 + SQL UUIDv4 expression used by triggers
    content-hash.js           canonical id-free serialization of items (hash input)
    tables.js                 table groups (design, project-key, identity)
    schema-registry-seed.js   table + column descriptions for AI agents (SEED_VERSION)
  infrastructure/
    sqlite/mcp-schema.js      idempotent schema pass, run on every DB open
    sqlite/content-hash-store.js     compute / cache / refresh content_hash
    sqlite/schema-registry-repository.js  read + describe + upsert registry entries
    postgres/mcp-pg-schema.js PostgreSQL parity DDL
    secrets.js                HMAC pepper for API keys (env → env files → data/mcp-key-pepper)
    sqlite/api-key-repository.js     api_keys + mcp_audit_log access
  domain/api-key.js           key format, scopes, expiry, AI settings rules
  application/api-key-service.js     create / rotate / revoke / authenticate, project AI settings
  interfaces/http/mcp-routes.js      designer REST routes (session auth)
  interfaces/web/ai-keys-modal.js    Profile → AI Access Keys modal
  composition.js              builds container.mcp
  application/design-query-service.js  read model: schema, manifest, search, item, tokens, workflows
  application/bundle-service.js        .tar.gz bundles + single-use download tokens
  infrastructure/sqlite/design-read-repository.js  scope-filtered SQL reads
  infrastructure/export/tar-gz.js      zero-dep ustar + gzip writer
  server/http.js              Streamable HTTP transport (/mcp, /mcp/bundles/<token>)
  server/protocol.js          JSON-RPC: initialize, ping, tools/*, resources/*, prompts/list
  server/tools.js             the M2 tools
  server/input-schema.js      tiny JSON-Schema validator for tool arguments
  server/rate-limiter.js      per-key fixed-window limits
  server/standalone.js        MCP-only http server
  domain/ai-pack-templates.js       built-in agent + skill bodies (TEMPLATE_VERSION)
  domain/ai-pack-render.js          {{var}} / #if / #each engine + per-platform file layout
  domain/web-adapter.js             icon sprite (shared defs hoisted) + typed index.ts
  application/ai-pack-service.js    render, uiux_init install plans, template overrides
  infrastructure/sqlite/ai-artifact-repository.js
  domain/item-validation.js         §14 static checks (key, docs, 24×24, SVG safety, sizes, a11y)
  infrastructure/sqlite/version-repository.js   project_versions, changesets, changeset_ops
  application/version-service.js    head snapshots, version list, since-version delta
  application/changeset-service.js  begin / stage / diff / submit / review, dry runs, conflicts
  interfaces/web/versions-modal.js  Collaborate → Versions, AI Changesets & Requests (review UI + request inbox)
  application/project-library-service.js  project scope: clone used foreign items into the project
  application/item-request-service.js     M5 item requests
  application/binding-service.js          M6 code bindings
  domain/agent-user.js              the kyrpy-agent-designer system user
  tests/mcp-m0 … mcp-m4, mcp-m5-m6, mcp-m7, mcp-pg-sync .test.js
```

## M0 — what exists now

- **`mcp_context` on every table** (`TEXT NOT NULL DEFAULT '{}'`). The schema pass adds it to any table that lacks it, including tables added later.
- **`schema_registry`**: one row per table (`column_name = ''`) and per column. Seeded from `domain/schema-registry-seed.js`. Unknown tables and columns get a `source = 'system'` placeholder, and the M0 test fails until someone describes them. Rows edited by users or AI (`source = 'user' | 'ai'`) are never overwritten by the seed.
- **`uid`** (stable UUID) on `paths, icons, buttons, elements, screens, workflows, themes, template_buttons, template_devices`. It is backfilled, has a unique index, is set by an insert trigger, and is protected from being cleared to NULL by a sync pull.
- **`(project_id, key)` unique index** on the project-scoped tables.
- **`content_hash`**: sha256 of the canonical, id-free content, cached on the row. Triggers on the row, `nodes`, `animations`, `menu_items`, `workflow_screens` and `workflow_links` clear it, and `ContentHashStore.get()` recomputes it lazily.

## M1 — API keys

- **Tables:** `api_keys` (HMAC-SHA256 hash only, plaintext shown once) and `mcp_audit_log` (90-day retention).
- **Rules:** only the project owner creates keys. A key is bound to one user and one project, and stops working when that user no longer owns the project. Admins can list and revoke any key. There is no caching, so a revoked key fails on the very next call. Rotation issues a new key and keeps the old one working for 24 h. Scopes are `read` (always on), `request` and `propose`.
- **Project AI settings** live in `projects.settings.ai`: `pushRequiresReview` (default true) and `mayCreatePublicItems` (default false).
- **REST:** `GET/POST /api/me/api-keys`, `POST /api/me/api-keys/:id/rotate`, `DELETE /api/me/api-keys/:id`, `GET /api/me/api-keys/:id/audit`, `GET /api/projects/:id/api-keys`, `POST /api/projects/:id/api-keys/revoke-all`, `GET/PUT /api/projects/:id/ai-settings`, `GET /api/projects/:id/ai-audit`, `GET /api/admin/api-keys`.
- **API keys are not designer sessions:** `/api/*` rejects them with 401. Only the MCP endpoint (M2) will accept them, through `container.mcp.apiKeys.authenticate()`.
- **Pepper:** set `KYRPY_UIUX_KEY_PEPPER` (32+ chars) in `credentials.env` for servers. Otherwise `src/data/mcp-key-pepper` is created (mode 0600, git-ignored). Losing it invalidates every key.
- **PostgreSQL:** keys are synced as hashes (since M7). They authenticate on another instance only when it shares `KYRPY_UIUX_KEY_PEPPER`.

## M2 — read-only MCP server

**Endpoint:** `POST /mcp` uses MCP Streamable HTTP with JSON responses and protocol versions 2025-06-18, 2025-03-26 and 2024-11-05. It is embedded in `serve` by default (`MCP_MODE=off` disables it) or runs on its own with `node main.js mcp --port 5181`.

```bash
claude mcp add --transport http kyrpy-uiux http://127.0.0.1:5180/mcp --header "Authorization: Bearer $KYRPY_UIUX_API_KEY"
```

| Tool | Purpose |
|---|---|
| `uiux_whoami` | User, project, scopes, expiry and rate-limit budget of the key |
| `uiux_get_schema` | Design-system rules (overview); `table` gives every column of one table |
| `uiux_get_manifest` | Project items + their dependencies (uid, key, contentHash), paged; `ifNoneMatch` returns a tiny "unchanged" answer |
| `uiux_search_items` | Ranked search across project → own private → public; other users' items are flagged `untrusted` |
| `uiux_get_item` | One item as JSON (references by uid/key, no numeric ids) or as SVG in a style |
| `uiux_get_tokens` | Tokens of a style as JSON, CSS custom properties (`--uiux-*`) or TypeScript |
| `uiux_list_workflows` | Screen-navigation graphs |
| `uiux_create_bundle` | `.tar.gz` of manifest, schema, tokens, item JSON, SVGs and workflows. Returns a single-use URL valid for 15 min, plus `curl` / `sha256sum` / `tar` steps |

**Resources:** `uiux://schema`, `uiux://schema/{table}`, `uiux://project/manifest`, `uiux://item/{type}/{ref}`, `uiux://item/{type}/{ref}/svg`, `uiux://tokens/{style}`.

**Who sees what:** a key reads its project's items, its owner's private library and public items, plus anything its project items depend on. Other projects' `project` items and other users' `private` items are never returned.

**Security:** the API key is checked on every request (revocation is immediate). The Origin header must be loopback, the server's own host, or listed in `MCP_ALLOWED_ORIGINS`. Bodies are capped at 1 MB. Limits are 120 calls/min and 10 bundles/hour per key. Every tool call is audited with an argument digest, never the raw arguments.

**Not in M2:** server-to-client SSE streams and resource subscriptions.

## M3 — AI pack + `uiux_init`

- **`ai_artifacts`** holds the agent (`kyrpy-uiux-designer`) and skill (`kyrpy-skill-uiux-designer`) templates. The built-in ones are seeded from `domain/ai-pack-templates.js` and refresh when `TEMPLATE_VERSION` grows. Owners can override a body per project, admins can edit the global one, and user edits are never overwritten by the seed.
- **Platforms:** `claude` (`.claude/agents`, `.claude/skills`), `antigravity` (`.agents/…`), `agents-md` (a marked section in `AGENTS.md`), `cursor` (`.cursor/rules/*.mdc`), `generic` (`docs/uiux/*.md`).
- **`uiux_init`** returns an install plan:
  - pack files plus `.uiux/config.json`, each marked `create` / `update` / `skip` / `conflict`;
  - `.gitignore` lines;
  - a bundle with `curl` → `sha256sum` → `tar` steps, skipped when the `manifestHash` is unchanged;
  - the lockfile to write, and ordered `steps[]`.

  When a re-run sends `installed` checksums, only changed files come back. A file edited locally gets the new version as `<path>.uiux-new` instead of being overwritten.
- **`uiux_get_ai_pack`** gives the rendered files of one platform. The prompts are `init-uiux` and `pull-design`.
- **Bundles** now contain `adapters/web/<style>/` with `tokens.css`, `tokens.ts`, `icons.sprite.svg` and `index.ts`. The sprite hoists the style's shared `<defs>` (90 KB instead of 910 KB for 206 icons) and is hidden with zero size, not `display:none`, which would stop Chrome painting its gradients.
- **REST (session):** `GET /api/projects/:id/ai-pack?platform=`, `GET /api/projects/:id/ai-artifacts`, `PUT|DELETE /api/projects/:id/ai-artifacts/:kind`, `PUT /api/admin/ai-artifacts/:kind`. There is no editor UI yet; templates are edited through these routes.

## M4 — versions + changesets (push for review)

- **Tables** (synced to PostgreSQL): `project_versions` (numbered manifest snapshots; the `approved` row is the head), `changesets` (24 h expiry), `changeset_ops` (one per item; `base_hash`, `proposed_hash`, payload in the `uiux_get_item` format).
- **Head rule:** `VersionService.ensureHead()` records a `designer` version whenever the live project differs from the head (first time: `import` baseline). So a version number always names one exact manifest, and `uiux_get_manifest { sinceVersion }` returns a precise added / changed / removed delta. AI pushes get their number on approval.
- **Dry runs:** staging, `uiux_validate_item`, submit and the review preview apply the proposal inside a transaction that is always rolled back. Core normalization, the hierarchy rule and references therefore behave exactly as in the designer, and the reported `proposedHash` equals the hash after approval.
- **Validation (§14):** key pattern, `descriptionDev` and `mcpContext.purpose` required on create, 24×24 for icons and paths, SVG sanitising (no scripts, `foreignObject`, `on*`, external `href`, `javascript:`), 256 KB and 2,000 nodes per item, button label, 44 px touch-target warning, `KEY_TAKEN` (with a free key suggestion), `DUPLICATE` (same drawing exists; `allowDuplicate` overrides), `REF` (unresolved reference). Errors come back as `VALIDATION_FAILED` with `details {errors, warnings, fixes}`. Updates identical to the live item are not staged (`unchanged: true`).
- **Conflicts:** an update or delete conflicts when the live hash is no longer its `baseHash`. Submit returns `CONFLICT` with `{key, baseHash, headHash, proposedHash}` for those items only; disjoint ops never conflict. Restage with `baseHash = headHash`.
- **Review:** submit creates a pending version plus one `change_requests` row per op (`action = ai-create|ai-update|ai-delete`, `after_snapshot.mcp`), so the existing notification count and Change List show it. `CollaborationService` delegates those rows to `container.mcp.changesets` (`collaboration.externalReviewer`), and the Versions modal reviews whole changesets: approve all, approve selected / reject the rest, or reject all, with before/after SVG previews (shown as `<img>` data URLs, so agent SVG never runs). Only the project owner or an admin can review, and only with a designer session (API keys get 401 on `/api/*`). When no op is left staged, the version becomes the head (if anything was applied) or is rejected. Approved deletes go to the trash. Project setting `pushRequiresReview: false` auto-approves on submit (D3).
- **Tools:** `uiux_list_versions`, `uiux_validate_item` (read), `uiux_begin_changeset`, `uiux_stage_item` (nodes or `svg`), `uiux_stage_delete`, `uiux_submit_changeset`, `uiux_discard_changeset` (propose; `readOnlyHint: false`), `uiux_diff_changeset`, `uiux_get_changeset` (read). `uiux_get_manifest` returns `version` and accepts `sinceVersion`; `uiux_init` writes `version` into the lockfile. Prompt `push-app-version`; resource `uiux://project/versions`. Skill templates are at `TEMPLATE_VERSION` 2 and include the push procedure.
- **REST (session):** `GET|POST /api/projects/:id/versions`, `GET /api/projects/:id/versions/:number`, `GET /api/projects/:id/changesets?status=`, `GET /api/changesets/:uid`, `GET /api/changesets/:uid/ops/:op/preview?style=`, `POST /api/changesets/:uid/review {approve[], reject[], comment}`.
- **Formerly open, now done (see Follow-ups):** per-project keys, version restore, and portable node `onClick` / `events` targets.

## Project scope + `kyrpy-agent-designer`

- **Project scope:** `ProjectLibraryService` clones every item a project uses from another library (public, another project, a private library) into the project: visibility `project`, key `<project-key>-<key>`, `cloned_from_id` set, and a **deterministic uid** derived from the project key and the source uid. Because the uid is deterministic, a dry run and the real apply produce the same contentHash. References (nodes, menu targets, workflow screens and links) are pointed at the clone. This runs automatically when a staged item references a foreign item, before every version snapshot (`ensureHead`), and on `POST /api/projects/:id/adopt-dependencies`. Manifests therefore contain project items only.
- **Agent user:** the schema pass creates the system user `kyrpy-agent-designer` (status `suspended`, no password, so it cannot sign in or be impersonated with `x-user-id`). It is the creator of AI-created items and clones and the author of AI change requests, and it is written into `mcp_context.updatedBy`. Agent-made items of the key's own project are not flagged `untrusted`, because a human approved them.

## M5 — item requests

- **Table:** `item_requests`, with statuses `open → claimed → in-review → fulfilled`, plus `cancelled` and `rejected`.
- **Tools:** `uiux_request_item` (scope request; searches first and returns candidates; `searchOnly`), `uiux_cancel_request` (request), `uiux_list_requests` and `uiux_get_request` (read), `uiux_claim_request` and `uiux_fulfill_request` (propose; `ref` = an existing item, or `ref + changeset` = a staged item). An existing public or own private item (for example a search candidate) is cloned into the project library first, so the request always points at a project item. The changeset review moves requests to `fulfilled` when their op is applied, or back to `claimed` when it is rejected or fails; the request note then carries the reviewer's comment (or the apply error) so the next proposal can address it. Resource: `uiux://requests/open`.
- **Designer:** the *AI item requests* tab (Collaborate → AI Item Requests) lets members fulfil a request with an existing project item or reject it. REST: `GET /api/projects/:id/item-requests`, `POST /api/item-requests/:uid/fulfill|reject`.

## M6 — code bindings + react-tsx

- **Table:** `code_bindings` (item uid ↔ repo / file / symbol / framework, plus `binding_hash` = the item's hash when the code was synced).
- **Tools:** `uiux_bind_code` (propose, up to 200 per call, `remove`) and `uiux_list_bindings` (read; `stale` = the design changed since then). `uiux_stage_item { binding }` records the binding on approval, or at once when the item is unchanged ("code wins for bindings"). `uiux_get_item` returns `bindings` for project items. Paths must be repository-relative, with no `..` and no absolute or drive paths.
- **Adapter `react-tsx`:** `adapters/react-tsx/<style>/{Icon.tsx, tokens.ts, icons.sprite.svg, index.ts}` — a typed `IconName` union, `<Icon name size title/>` over the sprite, and `setIconSpriteUrl()`. Output is deterministic.
- Re-pushing an unchanged repository stages 0 ops (sensor in `mcp-m5-m6.test.js`).

## M7 — hardening + PostgreSQL

- **STRIDE review:** [`SECURITY.md`](SECURITY.md) (verdict PASS; residual risks listed there).
- **Sensors (`mcp-m7.test.js`):** SQL-like and traversal input in search, refs and resource URIs; markup and `javascript:` in nodes; item size cap; 1 MB body cap; tenant isolation of changesets, requests, bindings, uid updates and references; 24 h expiry; a load run of 400 mixed calls (8 concurrent) with p95 < 250 ms (≈ 60 ms measured).
- **PostgreSQL:** `mcp-pg-schema.js` derives the PG DDL of every MCP migration (`sqliteToPgDdl`: no FKs, no SQLite defaults), and `MCP_SYNC_TABLES` adds `api_keys`, `mcp_audit_log`, `ai_artifacts`, `project_versions`, `changesets`, `changeset_ops`, `item_requests` and `code_bindings` to the snapshot sync. Only `mcp_migrations` stays local. `mcp-pg-sync.test.js` pushes to an isolated `kyrpy-uiux-designer-test-db`, pulls into a fresh instance, checks that heads, hashes, requests, bindings and keys survive, and then drops the database.
- **Public export:** `npm run db:export-public` now clears keys, audit, versions, changesets, requests, bindings and non-seed AI templates from the GitHub snapshot.

## Follow-ups (after M7)

- **Per-project keys (F1):** the global `UNIQUE(key)` is gone. `dropGlobalKeyUnique()` rebuilds the six item tables once, copying every column so `uid`, `content_hash` and `mcp_context` survive, then recreates indexes and triggers. Core lookups are project-aware (`keyExists(key, projectId)`, and `getByKey(key, projectId)` prefers the project, then public), and MCP key refs resolve inside the key's project. Copies into another project and adoption clones keep their key. PostgreSQL drops `<t>_key_key` and syncs on `(project_id, key)`. A restored trash item keeps its uid.
- **Version restore (F2):** every recorded version stores its items' JSON in `version_items` (keyed by item uid + contentHash, so it is deduplicated and synced to PG). `uiux_restore_version` and `POST /api/projects/:id/versions/:n/restore` (owner/admin) build a changeset: changed items roll back, removed items return with their original uid, and items added since are deleted. On approval, the head (source `restore`) has exactly that version's manifest hash.
- **Portable interactions (F3):** `domain/portable-actions.js`. `uiux_get_item` writes node `onClick` / `events` targets as `target {type, uid, key}` and `targetNodeIndex`. Staging resolves them (cloning foreign targets into the project), and the content hash uses target uids and node paths (hash v2 migration). Click targets count as dependencies, and adoption re-points them. Targets are soft references: a target that does not exist yet (for example a new screen that contains the new button opening it) is patched in after all ops apply. Staging only warns (`ACTION_TARGET`); submit requires every target to exist.
- **Native adapters + SSE (F4):** `domain/native-adapters.js` adds `flutter` (Dart `UiuxTokens` / `UiuxIcons`; output checked with `flutter analyze`), `compose` (Kotlin `object UiuxTokens`, `enum class UiuxIcon`) and `swiftui` (`enum UiuxTokens`, `enum UiuxIcon`), each with `icons/*.svg`. `resources/subscribe` / `unsubscribe` (manifest, versions, requests/open) work on the transport session. `GET /mcp` with `Accept: text/event-stream` streams `notifications/resources/updated`. Projects with listeners are polled every 10 s so designer edits are noticed.
- **Working HTML app (F5):** `uiux_export_app`, `uiux_create_bundle { includeApp }`, `GET /api/projects/:id/app-export` and *Collaborate → Download Project as HTML App* produce `app/`: the core exporter's working HTML/CSS/JS/TS app for the project's own screens, with workflow hotspots, actions, popups, drawers and menus, SVG images, and `DEV-NOTES.md`. They also produce `app/interactions.json` (format `kyrpy-uiux-interactions/1`) covering workflows, screen components and interactions, button menus, element actions and every developer note. The export was checked in headless Chrome: the hotspot navigates home → detail with no errors.

## Spec gaps closed

- `uiux_get_item { format: "html" }`: a standalone page with the rendered SVG, a table of nodes with behaviour (actions, instances, developer notes), menu and navigation lists, and the item JSON in `<script type="application/json" id="uiux-item">`. All item text is escaped.
- `uiux_get_manifest { version }`: the stored manifest of a version (`sinceVersion` still gives the delta).
- Prompt `need-ui-item` (§11.3): search → request → hand off to the designer agent.
- D6: an AI-created item may be `visibility: "public"` only when the project setting `mayCreatePublicItems` is on (`VISIBILITY` error otherwise); the setting is checked again when the item is applied.
- §14.7: `A11Y_CONTRAST` warning when a text node's fill does not reach WCAG AA (4.5:1, or 3:1 for large text) against the filled shape behind it. `{{token}}` colors are resolved with the default style's tokens.

## Rules for anyone changing the schema

1. A new table or column needs an entry in `domain/schema-registry-seed.js` (bump `SEED_VERSION` when changing text). `npm test` enforces this.
2. Do not add `mcp_context` by hand in core migrations; the schema pass adds it.
3. A core migration that **rebuilds** an identity table must copy `uid`, `content_hash` and `mcp_context` into the new table. Otherwise every row gets a new uid and loses its identity. MCP triggers are dropped automatically before core migrations and recreated afterwards.
4. New MCP-layer DDL that is not idempotent goes into `MCP_MIGRATIONS` (append only).

## Deliberately not done in M0

- **Dropping the global `UNIQUE(key)`.** About a dozen core call sites (`getByKey`, `keyExists`, `uniqueKey`, PG sync `uniqueCols: ['key']`) assume keys are unique across the whole table. Making keys project-scoped needs those lookups to take a project, and is planned before M4 (push), where the same key in two projects first matters. Until then the new `(project_id, key)` index is satisfied automatically.
- **Trash restore keeps no uid.** A restored item gets a new uid. To fix in M4 by carrying the uid in the trash snapshot.

## Connect an AI coder (AI Access Keys modal)

`interfaces/web/client-setup.js` (pure, tested in `tests/client-setup.test.js`) builds copy-ready setup steps for
Claude Code, Codex CLI, Gemini CLI, Antigravity (agy), Cursor, VS Code · GitHub Copilot, Windsurf, Cline / Roo Code,
opencode, Zed, Claude Desktop, any stdio client (`mcp-remote` bridge) and raw details/curl, for bash/zsh, PowerShell,
fish and cmd. `interfaces/web/connect-panel.js` renders them twice: in the one-time key reveal (the key can go into an
environment variable or inline into a user-level config) and in the always-available **Connect an AI coder** card
(environment variable + placeholder, since keys are shown only once). Files that are usually committed (`.mcp.json`,
`.vscode/mcp.json`, `.cursor/mcp.json`, `opencode.json`) never contain the key. Claude Code, Codex and Gemini CLI
recipes were run against a live server (`claude mcp get` → ✔ Connected, `codex mcp list` → enabled, bearer token).

### Several projects on one laptop: per-repository keys

A **project key** is stored per repository so two repos never share a key: Claude Code `claude mcp add --scope local`
(run inside the repo; Claude keeps it per path in `~/.claude.json`), Gemini CLI `.gemini/.env` + `.gemini/settings.json`
(`Bearer $VAR`), direnv `.envrc` for the other CLIs on bash/zsh/fish, VS Code `${input:…}` prompts. Secret files are
returned in `gitignore[]` and added to `.gitignore` by `uiux_init`. Optional per-project server names / env variables
(`kyrpy-uiux-<project>`, `KYRPY_UIUX_API_KEY_<PROJECT>`) are available in the panel and as `uiux_init` arguments
(`client`, `shell`, `serverName`, `envVar`); `.uiux/config.json → mcpClient` records the choice for the next agent.

## Account keys (user-wide) — clone a design, build an app, push it as a new project

Key `kind` is `project` (one owned project) or `account` (all projects the user can see; `api_keys.project_id` NULL,
migration `m11-001-account-keys`, PG parity in `mcp-pg-schema.js`). Account-key rules (`application/account-service.js`):

| scope | what the account key may do |
|---|---|
| `read` | any project the user can see (owned, accepted member, public). Others answer `NOT_FOUND`, same as unknown keys |
| `request` / `propose` | only projects the user **owns** (`SCOPE_DENIED` with a hint to clone otherwise) |
| `create` | `uiux_create_project` / clone: new projects owned by the user, private by default (10 per hour) |

Project tools get a required `project` argument for account keys (injected into `tools/list`); account-only tools are
`uiux_list_projects`, `uiux_clone_project` (new name required), `uiux_create_project`. System users never get keys or sessions. The `design` scope (see below) makes an account key strict.

**Init selection flow** — `uiux_init` with an account key and no choice returns `needsSelection: true`: every visible
project with role, `canClone` / `canEdit`, head and recent versions, a ready `question`, and `askHuman` rules (the agent
must stop and ask the human; MCP elicitation or a chat question). The second call carries the human's answer:

- `{ mode: "download", project }` → a read-only local copy of any visible project (nothing is created or changed on the
  server); `.uiux/config.json` gets `origin` and `selection.mode = "download"`. To build on it later, call `clone`.
- `{ mode: "clone", project, newProjectName? }` → a new private project of the user, copied from the source head
  (the source is never changed), then the normal install plan for the new project; `.uiux/config.json` gets
  `project` (new key), `origin { project, name, version }` and `selection`.
- `{ mode: "edit", project, version? }` → an owned project. At the head: normal install. At an older version: the plan
  records `selection.baseVersion`, reports what changed since (`sinceChosen`), and with `restore: true` submits a restore
  changeset back to that version for the owner's approval.

**All styles in the repository** — every `uiux_init` bundle now carries *all* design styles (`tokens/<style>.{json,css,ts}`
and `adapters/web/<style>/` for each) plus all button styles (`tokens/button-styles.{json,css,ts}`,
`tokens/button-templates.json`, `styles.json`). `node uiux/source/switch-style.mjs --list` shows them;
`node uiux/source/switch-style.mjs <design-style> [<button-style>]` (or `--button <style>`) copies that style into
`uiux/active/` and writes `uiux/active/active.json`; set `<html data-button-style="…">` for the button style. Per-item SVG
files exist for the default style pair; very large projects (icons × styles above `SWITCH_SPRITE_BUDGET`) get icon
sprites for the default pair only (tokens still ship for every style; `styles.json.spriteStyles` says which).

Then push with the changeset tools (`project`: the key from config) and approve in the designer. Sensors:
`tests/mcp-account.test.js` (visibility, scopes, selection list, clone → stage → submit → approve, edit at a version).

## AI-assisted design (account keys with the `design` scope)

Code: `application/design-session-service.js` (focus, edit session, save, save-as, versions), `infrastructure/sqlite/focus-repository.js`
(table `design_focus`, migration `m13-001-design-focus`, local only: never synced to PostgreSQL, purged from every public export),
`domain/version-naming.js` (`<master>-v001`), tools `DESIGN_TOOLS` in `server/tools.js`. User guide: `readme-mcp.md` §3b.

- **Strict principal**: `ApiKeyService.authenticate` sets `principal.strict` for an account key whose scopes include `design`. Strict mode is enforced in the
  layers, not in the tools: `AccountService` (own projects only; foreign and public projects answer `NOT_FOUND`; private projects only), `DesignQueryService`
  (search without the public scope, `getItem`, `listWorkflows`), `ChangesetService` (`#readable`: references to public / foreign items fail validation),
  `ItemRequestService` (fulfil), and `McpProtocol` (`resolveFocused`: the `project` argument is optional and must equal the focus; the owner check runs on every call).
- **Focus**: one `design_focus` row per key. `uiux_create_project`, `uiux_clone_project`, `uiux_edit_project`, `uiux_save_as`, `uiux_init` (edit / clone) and `uiux_manage_versions { open }` set it.
- **Edit session** = the key's open changeset on the focused project (24 h). `uiux_stage_item` / `_stage_delete` / `_diff_changeset` / `_discard_changeset` / `_submit_changeset` take no `changeset` argument for design keys.
  `ChangesetService.unstage` removes staged ops. `submit({ autoApprove: true })` is called **only** by `DesignSessionService` (no tool argument can set it), so every other key still waits for review.
- **Versions** are separate projects: `<master-key>-v001`, link in `settings.ai.versionOf { master, number }`. `save_as` clones the focused project, replays the unsaved ops into the copy (uids → keys), saves it there and moves the focus;
  `purge_versions` replays the latest version's items into the master (one changeset, applied directly), hard-deletes every version project (`#destroyProject`: items first, because the design tables have no cascade from `projects`; history, bindings, requests, focus rows), then `VersionRepository.purgeHistory(master)` and a fresh baseline.
- Sensors: `tests/mcp-design.test.js` (focus, session, save, save-as, versions, purge, isolation incl. a public-item control with a plain key).

## M8 — prototype, init-prompt, style import, update check

`domain/init-prompt.js` (init-prompt.md, written once by `uiux_init`), `domain/prototype-shell.js` (dependency-free top-left Options menu: device / style / button type), `uiux_import_styles` (`BundleService.styleCatalog` / `createStyles`, merges into `uiux/source/`), `uiux_check_update` (`AiPackService.checkUpdate`, lockfile `toolsHash` from `server/tools.js`), `uiux_refresh_info` (live tool catalog + versions + projects read from the server; diffs against the session's `toolsHash` / `knownTools` so OLD sessions that cached an earlier tool list can discover new tools such as `uiux_create_project`). Sensors: `tests/mcp-m8.test.js`. Full reference: `readme-mcp.md`.
