/**
 * MCP-layer schema for SQLite (milestone M0). Called by `openDatabase()` right after the core migrations.
 *
 * Everything here is idempotent and runs on every open, so it also repairs tables that a later core
 * migration rebuilds (a rebuild drops added columns, indexes and triggers):
 *
 *  1. ordered one-time migrations, tracked in `mcp_migrations` (its own ledger; the core keeps PRAGMA user_version)
 *  2. `mcp_context` column on every table                        → the "every table has mcp_context" rule
 *  3. `uid` + `content_hash` on identity tables, uid backfill, unique uid index, insert trigger,
 *     (project_id, key) unique index, and hash invalidation triggers
 *  4. `schema_registry` seed refresh + placeholder rows for undocumented tables / columns
 */
import { UID_SQL_EXPR } from '../../domain/uid.js';
import { MCP_CONTEXT_COLUMN } from '../../domain/mcp-context.js';
import { DESIGN_TABLES, PROJECT_KEY_TABLES, IDENTITY_TABLES } from '../../domain/tables.js';
import { SEED_VERSION, seedRows } from '../../domain/schema-registry-seed.js';
import { BUILTIN_ARTIFACTS, TEMPLATE_VERSION } from '../../domain/ai-pack-templates.js';
import { createHash } from 'node:crypto';
import { AGENT_USERNAME, AGENT_EMAIL, AGENT_DISPLAY_NAME } from '../../domain/agent-user.js';
import { ensurePublicUser, reownPublicRows } from '../../../domain/system-users.js';

/** One-time migrations of the MCP layer. Append only; never edit a released entry. */
export const MCP_MIGRATIONS = [
  {
    id: 'm0-001-schema-registry',
    sql: `
CREATE TABLE IF NOT EXISTS schema_registry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT '',          -- '' = the table itself
  mcp_context TEXT NOT NULL DEFAULT '{}',        -- the description (JSON)
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user','ai','system')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (table_name, column_name)
);`
  },
  {
    id: 'm1-001-api-keys',
    sql: `
CREATE TABLE IF NOT EXISTS api_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT NOT NULL DEFAULT '["read"]',
  expires_at      TEXT,
  last_used_at    TEXT,
  last_used_ip    TEXT,
  revoked_at      TEXT,
  revoked_by      INTEGER,
  rotated_from_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  rotated_to_id   INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id, revoked_at);`
  },
  {
    id: 'm1-002-mcp-audit-log',
    sql: `
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id   INTEGER,
  user_id      INTEGER,
  project_id   INTEGER,
  event        TEXT NOT NULL,
  tool         TEXT NOT NULL DEFAULT '',
  args_digest  TEXT NOT NULL DEFAULT '',
  result       TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','error','denied')),
  error_code   TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_key ON mcp_audit_log(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_project ON mcp_audit_log(project_id, created_at);`
  },
  {
    id: 'm3-001-ai-artifacts',
    sql: `
CREATE TABLE IF NOT EXISTS ai_artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  scope       TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id  INTEGER NOT NULL DEFAULT 0,          -- 0 for global templates
  kind        TEXT NOT NULL CHECK (kind IN ('agent','skill','rule','command','readme')),
  platform    TEXT NOT NULL DEFAULT 'any',
  name        TEXT NOT NULL,
  template    TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  checksum    TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user')),
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context TEXT NOT NULL DEFAULT '{}',
  UNIQUE (scope, project_id, kind, name, platform)
);`
  },
  {
    id: 'm4-001-versions-changesets',
    sql: `
CREATE TABLE IF NOT EXISTS project_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number          INTEGER,                          -- assigned on approval; NULL while pending / when rejected
  label           TEXT NOT NULL DEFAULT '',
  parent_id       INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  source          TEXT NOT NULL CHECK (source IN ('designer','ai-push','import','restore')),
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','superseded')),
  manifest        TEXT NOT NULL DEFAULT '[]',
  manifest_hash   TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  changeset_id    INTEGER,
  created_by_user INTEGER,
  created_by_key  INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by     INTEGER,
  approved_at     TEXT,
  mcp_context     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_project_versions_head ON project_versions(project_id) WHERE status = 'approved';
CREATE TABLE IF NOT EXISTS changesets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_version_id   INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  result_version_id INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  api_key_id        INTEGER,
  user_id           INTEGER,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','rejected','conflicted','expired','discarded')),
  summary           TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  client_info       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_at      TEXT,
  expires_at        TEXT,
  reviewed_by       INTEGER,
  reviewed_at       TEXT,
  review_comment    TEXT NOT NULL DEFAULT '',
  mcp_context       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_changesets_project ON changesets(project_id, status);
CREATE TABLE IF NOT EXISTS changeset_ops (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  changeset_id      INTEGER NOT NULL REFERENCES changesets(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL DEFAULT 0,
  op                TEXT NOT NULL CHECK (op IN ('create','update','delete')),
  item_type         TEXT NOT NULL,
  item_uid          TEXT NOT NULL,
  item_key          TEXT NOT NULL,
  base_hash         TEXT,
  proposed_hash     TEXT,
  payload           TEXT NOT NULL DEFAULT '{}',
  validation        TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','applied','rejected','conflict','failed')),
  error             TEXT NOT NULL DEFAULT '',
  change_request_id INTEGER,
  mcp_context       TEXT NOT NULL DEFAULT '{}',
  UNIQUE (changeset_id, item_type, item_key)
);
CREATE INDEX IF NOT EXISTS idx_changeset_ops_cr ON changeset_ops(change_request_id);`
  },
  {
    id: 'm5-001-item-requests',
    sql: `
CREATE TABLE IF NOT EXISTS item_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_type           TEXT NOT NULL,
  intent              TEXT NOT NULL,
  constraints         TEXT NOT NULL DEFAULT '{}',
  context             TEXT NOT NULL DEFAULT '{}',
  candidates          TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','in-review','fulfilled','cancelled','rejected')),
  requested_by_user   INTEGER,
  requested_by_key    INTEGER,
  claimed_by_key      INTEGER,
  claimed_at          TEXT,
  fulfilled_item_type TEXT,
  fulfilled_item_uid  TEXT,
  fulfilled_item_key  TEXT,
  changeset_uid       TEXT,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at         TEXT,
  mcp_context         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_item_requests_project ON item_requests(project_id, status);`
  },
  {
    id: 'm6-001-code-bindings',
    sql: `
CREATE TABLE IF NOT EXISTS code_bindings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_type            TEXT NOT NULL,
  item_uid             TEXT NOT NULL,
  repo_id              TEXT NOT NULL DEFAULT '',
  file_path            TEXT NOT NULL,
  symbol               TEXT NOT NULL DEFAULT '',
  framework            TEXT NOT NULL DEFAULT '',
  binding_hash         TEXT,
  last_seen_version_id INTEGER,
  created_by_key       INTEGER,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context          TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, item_uid, repo_id, file_path, symbol)
);
CREATE INDEX IF NOT EXISTS idx_code_bindings_file ON code_bindings(project_id, file_path);`
  },
  {
    id: 'm8-001-version-items',
    sql: `
CREATE TABLE IF NOT EXISTS version_items (
  item_uid     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  item_type    TEXT NOT NULL,
  project_id   INTEGER NOT NULL,
  item_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (item_uid, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_version_items_project ON version_items(project_id);`
  },
  {
    // content hash v2: node actions are hashed by target uid / node path (portable-actions.js)
    id: 'm7-001-content-hash-v2', pg: false,
    run: db => {
      for (const t of ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows']) {
        if (columnsOf(db, t).includes('content_hash')) db.exec(`UPDATE ${t} SET content_hash = NULL`);   // fresh DBs get the column later
      }
    }
  },
  {
    // the immutable `public` system user owns the whole public library (domain/system-users.js);
    // every visibility='public' row (6 design tables + trash) is re-owned to it once. SQLite only: PG gets it by the next push.
    id: 'm9-001-public-user', pg: false,
    run: db => { ensureAgentUser(db); reownPublicRows(db, ensurePublicUser(db)); }   // agent first: keeps its historical id
  },
  {
    // account (user-wide) API keys: `kind` column, project_id nullable. SQLite cannot relax NOT NULL in place,
    // so the table is rebuilt (foreign keys are off during the schema pass). PG parity (kind, nullable project_id) is in postgres/mcp-pg-schema.js.
    id: 'm11-001-account-keys', pg: false,
    run: db => {
      const cols = db.prepare('PRAGMA table_info(api_keys)').all();
      if (!cols.length) return;
      const hasKind = cols.some(c => c.name === 'kind');
      const projectNotNull = cols.find(c => c.name === 'project_id')?.notnull === 1;
      if (hasKind && !projectNotNull) return;
      const keep = cols.map(c => c.name).filter(n => n !== 'kind');
      db.exec(`
CREATE TABLE api_keys_m11 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project','account')),
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT NOT NULL DEFAULT '["read"]',
  expires_at      TEXT,
  last_used_at    TEXT,
  last_used_ip    TEXT,
  revoked_at      TEXT,
  revoked_by      INTEGER,
  rotated_from_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  rotated_to_id   INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context     TEXT NOT NULL DEFAULT '{}',
  CHECK ((kind = 'project' AND project_id IS NOT NULL) OR (kind = 'account' AND project_id IS NULL))
);
INSERT INTO api_keys_m11 (${keep.join(', ')}) SELECT ${keep.join(', ')} FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_m11 RENAME TO api_keys;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id, revoked_at);`);
    }
  },
  {
    // exactly ONE superadmin, kyrpy (id 1): promoted when no superadmin exists or when the only one is the legacy installer
    // account `admin` (older installs created it as superadmin; it becomes a plain admin). Any other superadmin is kept;
    // a legacy DB with several collapses to one (kyrpy, else the lowest id) so the partial unique index can exist.
    // PG parity (same index, guarded) is in postgres/pg-sync-service.js.
    id: 'm12-001-single-superadmin', pg: false,
    run: db => {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) return;
      const sa = () => db.prepare("SELECT id, username FROM users WHERE role = 'superadmin' ORDER BY (id = 1) DESC, id").all();
      const setRole = (id, role) => db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, id);
      const kyrpy = db.prepare("SELECT id FROM users WHERE id = 1 AND username = 'kyrpy'").get();
      const cur = sa();
      if (kyrpy && (!cur.length || (cur.length === 1 && cur[0].username === 'admin'))) {
        for (const x of cur) setRole(x.id, 'admin');
        setRole(kyrpy.id, 'superadmin');
      }
      for (const x of sa().slice(1)) setRole(x.id, 'admin');
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_single_superadmin ON users(role) WHERE role = 'superadmin'");
    }
  }
];

const q = name => `"${String(name).replace(/"/g, '""')}"`;

const listTables = db => db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map(r => r.name);

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${q(table)})`).all().map(c => c.name);

/** The AI system user (see domain/agent-user.js); re-created if someone deleted it. */
function ensureAgentUser(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) return;
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password_hash, salt, display_name, role, status, permissions, avatar_color)
    VALUES (?, ?, '', '', ?, 'designer', 'suspended', '[]', '#a371f7')`).run(AGENT_USERNAME, AGENT_EMAIL, AGENT_DISPLAY_NAME);
}

function runMigrations(db, report) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    mcp_context TEXT NOT NULL DEFAULT '{}'
  );`);
  const done = new Set(db.prepare('SELECT id FROM mcp_migrations').all().map(r => r.id));
  for (const m of MCP_MIGRATIONS) {
    if (done.has(m.id)) continue;
    if (m.run) m.run(db); else db.exec(m.sql);
    db.prepare('INSERT INTO mcp_migrations (id) VALUES (?)').run(m.id);
    report.migrations.push(m.id);
  }
}

/** Rule: every table carries `mcp_context TEXT NOT NULL DEFAULT '{}'`. */
function ensureMcpContextColumns(db, report) {
  for (const t of listTables(db)) {
    if (columnsOf(db, t).includes(MCP_CONTEXT_COLUMN)) continue;
    db.exec(`ALTER TABLE ${q(t)} ADD COLUMN ${MCP_CONTEXT_COLUMN} TEXT NOT NULL DEFAULT '{}'`);
    report.mcpContextAdded.push(t);
  }
}

function ensureIdentity(db, report) {
  const tables = new Set(listTables(db));
  for (const t of IDENTITY_TABLES) {
    if (!tables.has(t)) continue;
    const cols = columnsOf(db, t);
    if (!cols.includes('uid')) db.exec(`ALTER TABLE ${q(t)} ADD COLUMN uid TEXT`);
    if (!cols.includes('content_hash')) db.exec(`ALTER TABLE ${q(t)} ADD COLUMN content_hash TEXT`);

    const filled = db.prepare(`UPDATE ${q(t)} SET uid = ${UID_SQL_EXPR} WHERE uid IS NULL OR uid = ''`).run().changes;
    if (filled) report.uidBackfilled[t] = Number(filled);

    db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_uid ON ${q(t)}(uid);
-- rows inserted by code that does not set uid get one
CREATE TRIGGER IF NOT EXISTS trg_mcp_${t}_uid_insert AFTER INSERT ON ${q(t)}
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE ${q(t)} SET uid = ${UID_SQL_EXPR} WHERE rowid = NEW.rowid; END;
-- an update that clears uid (for example a sync pull of a row that has none remotely) keeps the local uid
CREATE TRIGGER IF NOT EXISTS trg_mcp_${t}_uid_keep AFTER UPDATE OF uid ON ${q(t)}
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE ${q(t)} SET uid = OLD.uid WHERE rowid = NEW.rowid; END;
-- any row update that does not itself write content_hash makes the cached hash stale
CREATE TRIGGER IF NOT EXISTS trg_mcp_${t}_hash_row AFTER UPDATE ON ${q(t)}
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE ${q(t)} SET content_hash = NULL WHERE rowid = NEW.rowid; END;`);
  }

  // keys are unique per project (the global UNIQUE(key) is removed by dropGlobalKeyUnique)
  for (const t of PROJECT_KEY_TABLES) {
    if (!tables.has(t)) continue;
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_project_key ON ${q(t)}(project_id, key)`);
  }

  ensureHashInvalidation(db, tables);
}

/** Child-table changes (nodes, animations, menu items, workflow parts) make the owner's hash stale. */
function ensureHashInvalidation(db, tables) {
  const has = (...names) => names.every(n => tables.has(n));
  const byOwner = ref => Object.entries(DESIGN_TABLES)
    .map(([type, t]) => `UPDATE ${t} SET content_hash = NULL WHERE ${ref}.owner_type = '${type}' AND id = ${ref}.owner_id;`)
    .join('\n  ');
  const screenLinks = ref => `UPDATE workflows SET content_hash = NULL WHERE ${ref}.owner_type = 'screen'
    AND id IN (SELECT workflow_id FROM workflow_links WHERE from_screen_id = ${ref}.owner_id AND from_node_id IS NOT NULL);`;
  const animOwner = ref => Object.entries(DESIGN_TABLES)
    .map(([type, t]) => `UPDATE ${t} SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = ${ref}.node_id AND owner_type = '${type}');`)
    .join('\n  ');

  const triggers = [];
  if (has('nodes', 'workflows', 'workflow_links', ...Object.values(DESIGN_TABLES))) {
    triggers.push(
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_nodes_hash_ins AFTER INSERT ON nodes BEGIN\n  ${byOwner('NEW')}\n  ${screenLinks('NEW')}\nEND;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_nodes_hash_upd AFTER UPDATE ON nodes BEGIN\n  ${byOwner('OLD')}\n  ${byOwner('NEW')}\n  ${screenLinks('NEW')}\nEND;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_nodes_hash_del AFTER DELETE ON nodes BEGIN\n  ${byOwner('OLD')}\n  ${screenLinks('OLD')}\nEND;`
    );
  }
  if (has('animations', 'nodes')) {
    triggers.push(
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_animations_hash_ins AFTER INSERT ON animations BEGIN\n  ${animOwner('NEW')}\nEND;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_animations_hash_upd AFTER UPDATE ON animations BEGIN\n  ${animOwner('OLD')}\n  ${animOwner('NEW')}\nEND;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_animations_hash_del AFTER DELETE ON animations BEGIN\n  ${animOwner('OLD')}\nEND;`
    );
  }
  if (has('menu_items', 'buttons')) {
    triggers.push(
      'CREATE TRIGGER IF NOT EXISTS trg_mcp_menu_items_hash_ins AFTER INSERT ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id = NEW.button_id; END;',
      'CREATE TRIGGER IF NOT EXISTS trg_mcp_menu_items_hash_upd AFTER UPDATE ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id IN (OLD.button_id, NEW.button_id); END;',
      'CREATE TRIGGER IF NOT EXISTS trg_mcp_menu_items_hash_del AFTER DELETE ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id = OLD.button_id; END;'
    );
  }
  for (const child of ['workflow_screens', 'workflow_links']) {
    if (!has(child, 'workflows')) continue;
    triggers.push(
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_${child}_hash_ins AFTER INSERT ON ${child} BEGIN UPDATE workflows SET content_hash = NULL WHERE id = NEW.workflow_id; END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_${child}_hash_upd AFTER UPDATE ON ${child} BEGIN UPDATE workflows SET content_hash = NULL WHERE id IN (OLD.workflow_id, NEW.workflow_id); END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_mcp_${child}_hash_del AFTER DELETE ON ${child} BEGIN UPDATE workflows SET content_hash = NULL WHERE id = OLD.workflow_id; END;`
    );
  }
  db.exec(triggers.join('\n'));
}

/** Seeds / refreshes schema_registry and adds `system` placeholders for anything undocumented. */
function syncRegistry(db, report) {
  const get = db.prepare('SELECT version, source FROM schema_registry WHERE table_name = ? AND column_name = ?');
  const insert = db.prepare('INSERT INTO schema_registry (table_name, column_name, mcp_context, version, source) VALUES (?, ?, ?, ?, ?)');
  const update = db.prepare("UPDATE schema_registry SET mcp_context = ?, version = ?, source = 'seed', updated_at = datetime('now') WHERE table_name = ? AND column_name = ?");

  for (const row of seedRows()) {
    const ctx = JSON.stringify(row.context);
    const cur = get.get(row.tableName, row.columnName);
    if (!cur) { insert.run(row.tableName, row.columnName, ctx, SEED_VERSION, 'seed'); report.registryInserted++; continue; }
    const refreshable = cur.source === 'system' || (cur.source === 'seed' && cur.version < SEED_VERSION);
    if (refreshable) { update.run(ctx, SEED_VERSION, row.tableName, row.columnName); report.registryUpdated++; }
  }

  const placeholder = JSON.stringify({ purpose: '', needsDescription: true, source: 'system' });
  for (const t of listTables(db)) {
    for (const c of ['', ...columnsOf(db, t)]) {
      if (t === 'schema_registry' && c === MCP_CONTEXT_COLUMN) continue;   // here the column *is* the description
      if (get.get(t, c)) continue;
      insert.run(t, c, placeholder, 0, 'system');
      report.registryPlaceholders.push(c ? `${t}.${c}` : t);
    }
  }
}

/**
 * Drops every MCP trigger. Must run before core migrations: a core table rebuild (CREATE new, DROP old,
 * RENAME) fails while triggers on other tables (nodes, animations …) still reference the dropped table.
 * applyMcpSchema() recreates them afterwards.
 */
export function dropMcpTriggers(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg\\_mcp\\_%' ESCAPE '\\'").all().map(r => r.name);
  for (const n of names) db.exec(`DROP TRIGGER IF EXISTS ${q(n)}`);
  return names.length;
}

/** Seeds / refreshes the built-in AI pack templates (global scope). User-edited globals are kept. */
function syncAiArtifacts(db, report) {
  const get = db.prepare("SELECT id, version, source FROM ai_artifacts WHERE scope = 'global' AND project_id = 0 AND kind = ? AND name = ? AND platform = ?");
  for (const a of BUILTIN_ARTIFACTS) {
    const checksum = createHash('sha256').update(a.template).digest('hex');
    const cur = get.get(a.kind, a.name, a.platform);
    if (!cur) {
      db.prepare(`INSERT INTO ai_artifacts (uid, scope, project_id, kind, platform, name, template, version, checksum, source)
        VALUES (${UID_SQL_EXPR}, 'global', 0, ?, ?, ?, ?, ?, ?, 'seed')`).run(a.kind, a.platform, a.name, a.template, TEMPLATE_VERSION, checksum);
      report.aiArtifacts++;
    } else if (cur.source === 'seed' && cur.version < TEMPLATE_VERSION) {
      db.prepare("UPDATE ai_artifacts SET template = ?, version = ?, checksum = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(a.template, TEMPLATE_VERSION, checksum, cur.id);
      report.aiArtifacts++;
    }
  }
}

/**
 * Per-project keys: rebuilds the item tables whose `key` column still carries the global UNIQUE constraint
 * (a column constraint cannot be dropped in SQLite). Every column is copied, so uid, content_hash and
 * mcp_context survive; indexes and core triggers of the table are recreated; the (project_id, key)
 * unique index is (re)created by ensureIdentity(). Runs once per database; foreign keys are OFF here.
 */
function dropGlobalKeyUnique(db, report) {
  const re = /(\bkey\s+TEXT\s+NOT\s+NULL)\s+UNIQUE\b/i;
  let triggersDropped = false;
  for (const t of PROJECT_KEY_TABLES) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!row || !re.test(row.sql)) continue;
    if (!triggersDropped) { dropMcpTriggers(db); triggersDropped = true; }
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(t).map(r => r.sql);
    const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name NOT LIKE 'trg\\_mcp\\_%' ESCAPE '\\'").all(t).map(r => r.sql);
    const tmp = `${t}__mcp_rebuild`;
    const create = row.sql.replace(re, '$1').replace(/^CREATE TABLE\s+(?:"[^"]+"|\w+)/i, `CREATE TABLE ${q(tmp)}`);
    const cols = columnsOf(db, t).map(q).join(', ');
    db.exec(create);
    db.exec(`INSERT INTO ${q(tmp)} (${cols}) SELECT ${cols} FROM ${q(t)}`);
    db.exec(`DROP TABLE ${q(t)}`);
    db.exec(`ALTER TABLE ${q(tmp)} RENAME TO ${q(t)}`);
    for (const sql of [...indexes, ...triggers]) db.exec(sql);
    report.keyUniqueDropped.push(t);
  }
}

/** Applies the whole MCP-layer schema. Safe to call on every open; returns what changed. */
export function applyMcpSchema(db) {
  const report = {
    migrations: [], mcpContextAdded: [], uidBackfilled: {},
    registryInserted: 0, registryUpdated: 0, registryPlaceholders: [], aiArtifacts: 0, keyUniqueDropped: []
  };
  const own = !db.isTransaction;
  if (own) db.exec('BEGIN');
  try {
    runMigrations(db, report);
    ensureAgentUser(db);
    ensurePublicUser(db);
    dropGlobalKeyUnique(db, report);
    ensureMcpContextColumns(db, report);
    ensureIdentity(db, report);
    syncRegistry(db, report);
    syncAiArtifacts(db, report);
    if (own) db.exec('COMMIT');
  } catch (e) {
    if (own) db.exec('ROLLBACK');
    throw new Error(`mcp schema failed: ${e.message}`);
  }
  return report;
}
