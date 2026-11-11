/**
 * Offline-First PostgreSQL Synchronization Service (`kyrpy-uiux-designer-db`).
 *
 * Architecture:
 * - Local SQLite (`designer.db`) is the primary offline-first store (0ms latency, works 100% offline / local-only).
 * - Every mutation is queued in `sync_outbox` and can optionally sync with a remote PostgreSQL database (`kyrpy-uiux-designer-db`).
 * - Reads connection settings from `.env`, `credentials.env`, or environment variables (zero external npm dependencies).
 * - When no PostgreSQL host/credentials are configured (`PG_SYNC_ENABLED=false` or empty `PGHOST`), runs in local-only SQLite mode.
 */
import { spawn, spawnSync } from 'node:child_process';
import { installOutboxTriggers } from '../sqlite/outbox-triggers.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healForeignKeys } from '../sqlite/database.js';
import { MCP_PG_SCHEMA_SQL, MCP_SYNC_TABLES } from '../../mcp/infrastructure/postgres/mcp-pg-schema.js';
import { PUBLIC_USERNAME, DESIGN_TABLES } from '../../domain/system-users.js';
import { AGENT_USERNAME } from '../../mcp/domain/agent-user.js';

const SYSTEM_OWNER_TABLES = [...DESIGN_TABLES, 'trash_items'];
const userIdByName = (db, name) => { try { return db.prepare('SELECT id FROM users WHERE username = ?').get(name)?.id ?? null; } catch { return null; } };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

/**
 * Value of one `KEY=value` line of a .env file: a quoted value runs to its closing quote (so `#`, `'` and `"` inside
 * a password survive), an unquoted one to the first ` #` comment.
 */
export function envValue(raw) {
  const s = String(raw ?? '').trim();
  const q = s[0];
  if (q === '"' || q === "'") {
    const end = s.indexOf(q, 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  return s.replace(/\s+#.*$/, '').trim();
}

function loadCredentialsEnv() {
  const envFiles = [join(repoRoot, '.env'), join(repoRoot, 'credentials.env'), join(repoRoot, 'config.env')];
  const out = {};
  for (const f of envFiles) {
    if (!existsSync(f)) continue;
    try {
      const txt = readFileSync(f, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m) {
          let val = envValue(m[2]);
          const bashDef = /^\$\{[A-Z0-9_]+:-(.*)\}$/.exec(val);
          if (bashDef) val = bashDef[1].trim();
          if (out[m[1]] === undefined || out[m[1]] === '') out[m[1]] = val;
        }
      }
    } catch (e) {
      // no .env file is normal; an unreadable one is worth a line
      if (e?.code !== 'ENOENT') console.warn(`[sync] .env not read: ${e.message}`);
    }
  }
  return out;
}

const CORE_PG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'designer',
  status TEXT NOT NULL DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '[]',
  avatar_color TEXT NOT NULL DEFAULT '#2e9bff',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_login_at TEXT
);
-- exactly one superadmin (created only when the remote has at most one, so an old copy never blocks the schema script)
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM users WHERE role = 'superadmin') <= 1 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_single_superadmin ON users(role) WHERE role = 'superadmin';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  require_approval INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  invited_by INTEGER,
  role TEXT NOT NULL DEFAULT 'editor',
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  tokens TEXT NOT NULL,
  surfaces TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paths (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 24,
  height REAL NOT NULL DEFAULT 24,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS icons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 24,
  height REAL NOT NULL DEFAULT 24,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS buttons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 64,
  height REAL NOT NULL DEFAULT 64,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS elements (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 240,
  height REAL NOT NULL DEFAULT 64,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 390,
  height REAL NOT NULL DEFAULT 844,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  parent_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'shape',
  tag TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  rotation REAL NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  attrs TEXT NOT NULL DEFAULT '{}',
  description_dev TEXT NOT NULL DEFAULT '',
  on_click TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS animations (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 1000,
  delay_ms INTEGER NOT NULL DEFAULT 0,
  easing TEXT NOT NULL DEFAULT 'ease-in-out',
  iterations TEXT NOT NULL DEFAULT 'infinite',
  direction TEXT NOT NULL DEFAULT 'alternate',
  fill_mode TEXT NOT NULL DEFAULT 'both',
  trigger TEXT NOT NULL DEFAULT 'load',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  button_id INTEGER NOT NULL,
  parent_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  icon_id INTEGER,
  action TEXT NOT NULL DEFAULT '',
  target_screen_id INTEGER,
  target_element_id INTEGER,
  visible INTEGER NOT NULL DEFAULT 1,
  description_dev TEXT NOT NULL DEFAULT ''
);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS target_element_id INTEGER;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS ref_button_id INTEGER;

CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workflow_screens (
  workflow_id INTEGER NOT NULL,
  screen_id INTEGER NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, screen_id)
);

CREATE TABLE IF NOT EXISTS workflow_links (
  id INTEGER PRIMARY KEY,
  workflow_id INTEGER NOT NULL,
  from_screen_id INTEGER NOT NULL,
  from_node_id INTEGER,
  to_screen_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'curved',
  trigger TEXT NOT NULL DEFAULT 'tap'
);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL DEFAULT 1,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_key TEXT NOT NULL DEFAULT '',
  target_name TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL DEFAULT 'update',
  summary TEXT NOT NULL DEFAULT '',
  before_snapshot TEXT NOT NULL DEFAULT '{}',
  after_snapshot TEXT NOT NULL DEFAULT '{}',
  diff_summary TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id INTEGER,
  review_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS template_devices (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'mobile',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  corner_radius INTEGER NOT NULL DEFAULT 44,
  grid INTEGER NOT NULL DEFAULT 24,
  locked INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS template_buttons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'standard',
  shape TEXT NOT NULL DEFAULT 'pill',
  width INTEGER NOT NULL DEFAULT 160,
  height INTEGER NOT NULL DEFAULT 48,
  rx_ratio REAL NOT NULL DEFAULT 0.3,
  margin_ratio REAL NOT NULL DEFAULT 0.15,
  stroke_ratio REAL NOT NULL DEFAULT 1.0,
  role TEXT NOT NULL DEFAULT 'button',
  hover_effect TEXT NOT NULL DEFAULT 'glow',
  indicator_effect TEXT NOT NULL DEFAULT 'none',
  nodes_template TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  lang_code TEXT NOT NULL,
  translated_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE (table_name, record_id, field_name, lang_code)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trash_items (
  id INTEGER PRIMARY KEY,
  item_type TEXT NOT NULL,
  original_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  builtin INTEGER NOT NULL DEFAULT 0,
  creator_id INTEGER NOT NULL DEFAULT 1,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  deleted_by INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '{}'
);
`;

/** Core DDL + the MCP layer's additions (mcp_context, uid, content_hash, schema_registry). */
// one row (`revision`) that changes on every push: lets a machine see that another one pushed since its last pull
const SYNC_META_SQL = `
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
export const PG_SCHEMA_SQL = CORE_PG_SCHEMA_SQL + SYNC_META_SQL + MCP_PG_SCHEMA_SQL;

export const SYNC_TABLES = [
  { name: 'users', pk: ['id'], conflict: 'id', uniqueCols: ['username', 'email'] },
  { name: 'projects', pk: ['id'], conflict: 'id', uniqueCols: ['key'] },
  { name: 'project_members', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'user_id'] },
  { name: 'themes', pk: ['id'], conflict: 'id', uniqueCols: ['key'] },
  { name: 'paths', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'icons', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'buttons', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'elements', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'screens', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'nodes', pk: ['id'], conflict: 'id' },
  { name: 'animations', pk: ['id'], conflict: 'id' },
  { name: 'menu_items', pk: ['id'], conflict: 'id' },
  { name: 'workflows', pk: ['id'], conflict: 'id', uniqueTuple: ['project_id', 'key'] },
  { name: 'workflow_screens', pk: ['workflow_id', 'screen_id'], conflict: 'workflow_id, screen_id' },
  { name: 'workflow_links', pk: ['id'], conflict: 'id' },
  { name: 'change_requests', pk: ['id'], conflict: 'id' },
  { name: 'template_devices', pk: ['id'], conflict: 'id', uniqueCols: ['key'] },
  { name: 'template_buttons', pk: ['id'], conflict: 'id', uniqueCols: ['key'] },
  { name: 'translations', pk: ['id'], conflict: 'id', uniqueTuple: ['table_name', 'record_id', 'field_name', 'lang_code'] },
  { name: 'settings', pk: ['key'], conflict: 'key' },
  { name: 'trash_items', pk: ['id'], conflict: 'id' },
  { name: 'schema_registry', pk: ['id'], conflict: 'id', uniqueTuple: ['table_name', 'column_name'] },
  ...MCP_SYNC_TABLES
];

const USER_REFS = [
  ...['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows', 'trash_items'].flatMap(t => [[t, 'creator_id'], [t, 'root_owner_id']]),
  ['trash_items', 'deleted_by'], ['projects', 'owner_id'], ['project_members', 'user_id'], ['project_members', 'invited_by'],
  ['change_requests', 'author_id'], ['change_requests', 'owner_id'], ['change_requests', 'reviewer_id'],
  ['template_devices', 'created_by'], ['template_buttons', 'created_by'], ['sessions', 'user_id'],
  ['api_keys', 'user_id'], ['api_keys', 'revoked_by'], ['changesets', 'user_id'], ['changesets', 'reviewed_by'],
  ['mcp_audit_log', 'user_id'], ['ai_artifacts', 'updated_by'], ['project_versions', 'approved_by']
];
const PROJECT_REF_TABLES = ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows', 'project_members', 'change_requests',
  'trash_items', 'mcp_audit_log', 'ai_artifacts', 'project_versions', 'changesets', 'item_requests', 'code_bindings',
  'version_items', 'api_keys', 'design_focus'];
const ITEM_REFS = {
  icons: [['menu_items', 'icon_id']],
  buttons: [['menu_items', 'button_id'], ['menu_items', 'ref_button_id']],
  elements: [['menu_items', 'target_element_id']],
  screens: [['menu_items', 'target_screen_id'], ['workflow_screens', 'screen_id'], ['workflow_links', 'from_screen_id'], ['workflow_links', 'to_screen_id']],
  workflows: [['workflow_screens', 'workflow_id'], ['workflow_links', 'workflow_id']]
};
/** Columns that hold an id of `target`: `[table, column, typeColumn?, typeValue?]` (declared and undeclared references). */
function referencesTo(target) {
  if (target === 'users') return USER_REFS;
  if (target === 'projects') return PROJECT_REF_TABLES.map(t => [t, 'project_id']);
  const type = { paths: 'path', icons: 'icon', buttons: 'button', elements: 'element', screens: 'screen', workflows: 'workflow' }[target];
  if (!type) return [];
  return [
    [target, 'cloned_from_id'], [target, 'root_item_id'],
    ...(ITEM_REFS[target] || []),
    ...(type === 'workflow' ? [] : [['nodes', 'ref_id', 'ref_type', type]]),
    ['change_requests', 'target_id', 'target_type', type]
  ];
}

const DESIGN_TABLE_TYPES = { paths: 'path', icons: 'icon', buttons: 'button', elements: 'element', screens: 'screen' };

/** A value as a quoted text literal (for comparisons done as text). */
const pgText = v => `'${String(v).replace(/'/g, "''")}'`;

function pgLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export class PostgresSyncService {
  constructor({ db, enabled = true, config = {} }) {
    this.db = db;
    const creds = loadCredentialsEnv();
    this.config = {
      host: config.host ?? process.env.PGHOST ?? process.env.PG_HOST ?? creds.PGHOST ?? creds.PG_HOST ?? '',
      port: String(config.port || process.env.PGPORT || process.env.PG_PORT || creds.PGPORT || creds.PG_PORT || '5432'),
      user: config.user || process.env.PGUSER || process.env.PG_USER || creds.PGUSER || creds.PG_USER || 'postgres',
      password: config.password ?? process.env.PGPASSWORD ?? process.env.PG_PASSWORD ?? process.env.KYRPY_POSTGRES_ADMIN_PASSWORD ?? creds.PGPASSWORD ?? creds.PG_PASSWORD ?? creds.KYRPY_POSTGRES_ADMIN_PASSWORD ?? '',
      database: config.database || process.env.PGDATABASE || process.env.PG_DATABASE || creds.PGDATABASE || creds.PG_DATABASE || 'kyrpy-uiux-designer-db',
      adminDb: config.adminDb || process.env.PGADMINDB || process.env.PG_ADMIN_DB || creds.PGADMINDB || creds.PG_ADMIN_DB || 'postgres'
    };
    const envSyncFlag = String(process.env.PG_SYNC_ENABLED ?? creds.PG_SYNC_ENABLED ?? '').toLowerCase();
    const envLocalOnly = String(process.env.LOCAL_ONLY ?? creds.LOCAL_ONLY ?? '').toLowerCase();
    const placeholderHosts = new Set(['', 'none', 'disabled', 'local', 'your-postgres-host.example.com', '<your-postgres-host>']);
    const hasConfiguredHost = !placeholderHosts.has(String(this.config.host || '').trim().toLowerCase());
    if (envLocalOnly === 'true' || envLocalOnly === '1' || envSyncFlag === 'false' || envSyncFlag === '0' || !hasConfiguredHost) {
      this.enabled = false;
    } else {
      this.enabled = Boolean(enabled);
    }
    this.schemaInitialized = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.online = false;
    this.busy = null;   // 'push' | 'pull' while a non-blocking sync runs
    // every write to a synced table is recorded by a trigger (see outbox-triggers.js)
    try { this.tracked = installOutboxTriggers(db, SYNC_TABLES); } catch { this.tracked = 0; }
  }

  /**
   * Records that a row changed (table, id, operation; no row copy). The triggers already do this for every write,
   * so repositories calling it only repeat what is recorded: a record that is already waiting is not added twice.
   */
  enqueue(tableName, recordId, operation) {
    const op = operation === 'delete' ? 'delete' : 'upsert';
    try {
      this.db.prepare(`INSERT INTO sync_outbox (table_name, record_id, operation, payload, synced)
        SELECT ?, ?, ?, '{}', 0
        WHERE NOT EXISTS (SELECT 1 FROM sync_outbox WHERE synced = 0 AND table_name = ? AND record_id = ? AND operation = ?)`)
        .run(String(tableName), String(recordId), op, String(tableName), String(recordId), op);
    } catch (e) { if (!/closed|not open/i.test(e.message)) console.warn(`[sync] outbox write failed: ${e.message}`); }
  }

  /** Records changed locally and not pushed yet (rows of a push in flight count until it succeeds). */
  pendingCount() {
    try {
      return this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced <> 1').get().n;
    } catch { return 0; }
  }

  getState(key, fallback = null) {
    try {
      const r = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  }

  setState(key, value) {
    try {
      this.db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
    } catch (e) { console.warn(`[sync] state "${key}" not saved: ${e.message}`); }
  }

  #psqlArgs(database, tuplesOnly) {
    const args = ['-h', this.config.host, '-p', this.config.port, '-U', this.config.user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
    if (tuplesOnly) args.push('-t', '-A');
    return args;
  }

  #psqlEnv() { return { ...process.env, PGPASSWORD: this.config.password, PGCONNECT_TIMEOUT: '3' }; }

  #psqlResult(failed, stdout, stderr) {
    if (failed) {
      const err = String(stderr || 'PostgreSQL connection failed').trim();
      this.online = false;
      this.lastError = err;
      return { ok: false, error: err };
    }
    this.online = true;
    this.lastError = null;
    return { ok: true, stdout: String(stdout || '').trim() };
  }

  /** Executes SQL against PostgreSQL via psql and waits for it (command line and scripts). The server uses `execPgAsync`. */
  execPg(sql, { database = this.config.database, tuplesOnly = false, timeoutMs = 8000 } = {}) {
    if (!this.enabled) return { ok: false, error: 'sync disabled' };
    const res = spawnSync('psql', this.#psqlArgs(database, tuplesOnly), {
      input: sql,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: this.#psqlEnv()
    });
    return this.#psqlResult(res.error || res.status !== 0, res.stdout, res.stderr || res.error?.message);
  }

  /** Same as `execPg` without blocking the event loop: the HTTP server keeps answering while psql runs. */
  execPgAsync(sql, opts = {}) {
    // a replaced `execPg` (tests, the publish probe) is honoured here too
    if (Object.hasOwn(this, 'execPg')) return Promise.resolve(this.execPg(sql, opts));
    const { database = this.config.database, tuplesOnly = false, timeoutMs = 8000 } = opts;
    if (!this.enabled) return Promise.resolve({ ok: false, error: 'sync disabled' });
    return new Promise(resolve => {
      let out = '', err = '', done = false;
      const finish = (failed, msg) => { if (done) return; done = true; clearTimeout(timer); resolve(this.#psqlResult(failed, out, msg ?? err)); };
      let child;
      try { child = spawn('psql', this.#psqlArgs(database, tuplesOnly), { env: this.#psqlEnv() }); }
      catch (e) { resolve(this.#psqlResult(true, '', e.message)); return; }
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(true, `psql timed out after ${Math.round(timeoutMs / 1000)} s`); }, timeoutMs);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => finish(true, e.message));
      child.on('close', code => finish(code !== 0));
      child.stdin.on('error', () => { /* psql ended before reading everything; `close` reports it */ });
      child.stdin.end(sql);
    });
  }

  /**
   * Runs SQL that arrives as a sequence of statements: they are written to a temporary file one by one and psql
   * reads the file, so the whole text never sits in memory. A replaced `execPg` (tests, the publish probe) gets the
   * joined text instead.
   */
  #execSpooled(parts, opts = {}, nonBlocking) {
    if (Object.hasOwn(this, 'execPg')) return this.execPg([...parts].join('\n'), opts);
    if (!this.enabled) return { ok: false, error: 'sync disabled' };
    const { database = this.config.database, tuplesOnly = false, timeoutMs = 8000 } = opts;
    const dir = mkdtempSync(join(tmpdir(), 'ud-push-'));
    const file = join(dir, 'push.sql');
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { console.warn(`[sync] temporary file not removed: ${e.message}`); } };
    let fd;
    try {
      fd = openSync(file, 'w', 0o600);
      for (const part of parts) { writeSync(fd, part); writeSync(fd, '\n'); }
      closeSync(fd); fd = null;
    } catch (e) {
      if (fd != null) { try { closeSync(fd); } catch { /* already closed */ } }
      cleanup();
      return { ok: false, error: `push could not be prepared: ${e.message}` };
    }
    if (!nonBlocking) {
      const input = openSync(file, 'r');
      try {
        const res = spawnSync('psql', this.#psqlArgs(database, tuplesOnly), { stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: this.#psqlEnv() });
        return this.#psqlResult(res.error || res.status !== 0, res.stdout, res.stderr || res.error?.message);
      } finally { closeSync(input); cleanup(); }
    }
    return new Promise(resolve => {
      let out = '', err = '', done = false, input = null;
      const finish = (failed, msg) => {
        if (done) return; done = true; clearTimeout(timer);
        if (input != null) { try { closeSync(input); } catch { /* already closed */ } }
        cleanup();
        resolve(this.#psqlResult(failed, out, msg ?? err));
      };
      let child, timer = null;
      try { input = openSync(file, 'r'); child = spawn('psql', this.#psqlArgs(database, tuplesOnly), { stdio: [input, 'pipe', 'pipe'], env: this.#psqlEnv() }); }
      catch (e) { finish(true, e.message); return; }
      timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(true, `psql timed out after ${Math.round(timeoutMs / 1000)} s`); }, timeoutMs);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => finish(true, e.message));
      child.on('close', code => finish(code !== 0));
    });
  }

  /** Runs a step generator (it yields `{ sql, opts }` and receives the psql result) with the blocking psql. */
  #runSync(steps) {
    let r = steps.next();
    while (!r.done) r = steps.next(typeof r.value.sql === 'string' ? this.execPg(r.value.sql, r.value.opts) : this.#execSpooled(r.value.sql, r.value.opts, false));
    return r.value;
  }

  /** Runs the same steps with the non-blocking psql. */
  async #runAsync(steps) {
    let r = steps.next();
    while (!r.done) r = steps.next(typeof r.value.sql === 'string' ? await this.execPgAsync(r.value.sql, r.value.opts) : await this.#execSpooled(r.value.sql, r.value.opts, true));
    return r.value;
  }

  /** One sync operation at a time: a second push or pull while one runs answers `code: 'BUSY'`. */
  async #exclusive(kind, steps) {
    if (this.busy) return { ok: false, code: 'BUSY', error: `A ${this.busy} is already running; wait for it to finish.`, status: this.status() };
    this.busy = kind;
    try { return await this.#runAsync(steps); }
    finally { this.busy = null; }
  }

  /** Ensures the target database `kyrpy-uiux-designer-db` and all tables exist in PostgreSQL. */
  ensureRemoteDatabase() { return this.#runSync(this.#ensureSteps()); }

  *#ensureSteps() {
    const check = yield { sql: `SELECT 1 FROM pg_database WHERE datname = ${pgLiteral(this.config.database)};`, opts: { database: this.config.adminDb, tuplesOnly: true, timeoutMs: 5000 } };
    if (!check.ok) return check;
    if (!check.stdout.includes('1')) {
      const create = yield { sql: `CREATE DATABASE "${this.config.database}";`, opts: { database: this.config.adminDb, timeoutMs: 8000 } };
      if (!create.ok && !String(create.error).includes('already exists')) return create;
    }
    const schemaRes = yield { sql: PG_SCHEMA_SQL, opts: { database: this.config.database, timeoutMs: 12000 } };
    if (schemaRes.ok) this.schemaInitialized = true;
    return schemaRes;
  }

  /** How many changes were pushed so far: the running total of pruned rows plus the synced rows still in the outbox. */
  syncedCount() {
    try {
      return Number(this.getState('syncedTotal', 0)) + this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced = 1').get().n;
    } catch { return 0; }
  }

  /** Synced outbox rows have no further use (a push mirrors the tables, it never replays them): keep their count, drop the rows. */
  pruneOutbox() {
    try {
      const n = this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced = 1').get().n;
      if (!n) return 0;
      this.setState('syncedTotal', Number(this.getState('syncedTotal', 0)) + n);
      this.db.prepare('DELETE FROM sync_outbox WHERE synced = 1').run();
      return n;
    } catch { return 0; }
  }

  /** Returns current offline-first & PostgreSQL sync status. */
  status({ probe = false } = {}) {
    if (probe && this.enabled) {
      this.execPg('SELECT 1;', { tuplesOnly: true, timeoutMs: 3000 });
    }
    const lastSyncAt = this.lastSyncAt || this.getState('lastSyncAt', null);
    const pending = this.pendingCount();
    const synced = this.syncedCount();
    return {
      mode: 'offline-first',
      syncEnabled: this.enabled,
      localOnly: !this.enabled,
      sqliteConnected: true,
      host: this.config.host || 'localhost',
      port: this.config.port,
      database: this.config.database,
      postgresHost: this.config.host ? `${this.config.host}:${this.config.port}` : 'local-only (SQLite)',
      postgresDatabase: this.config.database,
      postgresOnline: this.online,
      pendingOutbox: pending,
      pendingCount: pending,
      syncedCount: synced,
      lastSyncAt,
      lastError: this.lastError,
      busy: this.busy,
      state: {
        last_push_at: this.getState('lastPushAt', lastSyncAt),
        last_pull_at: this.getState('lastPullAt', lastSyncAt),
        last_sync_status: !this.enabled ? 'local-only' : (this.lastError ? 'error' : (lastSyncAt ? 'synced' : 'ready'))
      }
    };
  }

  /** The remote revision marker (changes on every push), `null` when nobody pushed yet. `{ ok:false }` when unreachable. */
  remoteRevision() { return this.#runSync(this.#revisionSteps()); }

  *#revisionSteps() {
    const res = yield { sql: `SELECT value FROM sync_meta WHERE key = 'revision';`, opts: { tuplesOnly: true, timeoutMs: 8000 } };
    if (!res.ok) return res;
    return { ok: true, revision: res.stdout.trim() || null };
  }

  #refuse(code, error) {
    this.lastError = error;
    return { ok: false, code, needsForce: true, error, status: this.status() };
  }

  /**
   * Pushes all local SQLite tables to PostgreSQL in a single atomic transaction: the remote becomes a mirror of the
   * local database (remote rows that do not exist locally are deleted).
   *
   * Because of that, the push is refused (`code: 'REMOTE_CHANGED'`) when another machine pushed since this one last
   * pulled or pushed — its work would be deleted. Pull first, or pass `force: true` to overwrite the remote anyway.
   */
  pushToPostgres(opts = {}) { return this.#runSync(this.#pushSteps(opts)); }

  /** `pushToPostgres` for the server: psql runs without blocking other requests. */
  pushToPostgresAsync(opts = {}) { return this.#exclusive('push', this.#pushSteps(opts)); }

  *#pushSteps({ force = false } = {}) {
    if (!this.schemaInitialized) {
      const init = yield* this.#ensureSteps();
      if (!init.ok) return { ok: false, status: this.status(), error: init.error };
    }
    const known = this.getState('remoteRevision', null);
    if (!force) {
      const remote = yield* this.#revisionSteps();
      if (!remote.ok) return { ok: false, status: this.status(), error: remote.error };
      if (remote.revision && remote.revision !== known) {
        return this.#refuse('REMOTE_CHANGED', 'PostgreSQL was changed by another machine since this one last synced. Pull first (or force the push to overwrite the remote: its newer rows will be deleted).');
      }
    }
    const revision = randomUUID();

    const tableCounts = {};
    // only columns that exist on both sides are sent: one local-only column must not fail the whole push
    const remoteCols = new Map();
    const colRes = yield { sql: `SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = current_schema();`, opts: { tuplesOnly: true, timeoutMs: 8000 } };
    if (colRes.ok) {
      for (const line of colRes.stdout.split('\n')) {
        const [t, col] = line.trim().split('.');
        if (t && col) { if (!remoteCols.has(t)) remoteCols.set(t, new Set()); remoteCols.get(t).add(col); }
      }
    }
    const skippedColumns = {};
    // the changes recorded so far belong to this push (synced = 2); what is written while psql runs is recorded anew
    this.db.prepare('UPDATE sync_outbox SET synced = 2 WHERE synced = 0').run();

    // The push is produced statement by statement and the rows are read in chunks: neither the SQL text nor a
    // whole table is held in memory (the runner spools the statements to a temporary file for psql).
    const db = this.db;
    const statements = function* () {
      yield 'BEGIN;';
      // re-checked inside the transaction (row lock): two machines pushing at once cannot both pass the check above
      if (!force) {
        yield `DO $$ DECLARE cur TEXT; BEGIN
  SELECT value INTO cur FROM sync_meta WHERE key = 'revision' FOR UPDATE;
  IF cur IS DISTINCT FROM ${known ? pgLiteral(known) : 'NULL'} THEN RAISE EXCEPTION 'REMOTE_CHANGED'; END IF;
END $$;`;
      }
      for (const tbl of SYNC_TABLES) {
        const localCols = db.prepare(`PRAGMA table_info(${tbl.name})`).all().map(c => c.name);
        const total = db.prepare(`SELECT COUNT(*) AS n FROM ${tbl.name}`).get().n;
        tableCounts[tbl.name] = total;
        if (!total) { yield `DELETE FROM "${tbl.name}";`; continue; }
        if (tbl.pk.length === 1) {
          const pkCol = tbl.pk[0];
          const idList = db.prepare(`SELECT ${pkCol} AS k FROM ${tbl.name}`).all().map(r => pgLiteral(r.k)).join(', ');
          yield `DELETE FROM "${tbl.name}" WHERE "${pkCol}" NOT IN (${idList});`;
        }
        // a remote superadmin that is not the local one steps down first: the single-superadmin index would reject
        // upserting the new superadmin while the old one still holds the role (rows are written one by one)
        if (tbl.name === 'users') {
          const keep = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").all().map(r => pgLiteral(r.id));
          yield `UPDATE "users" SET "role" = 'admin' WHERE "role" = 'superadmin' AND "id" NOT IN (${keep.length ? keep.join(', ') : '-1'});`;
        }
        const known_ = remoteCols.get(tbl.name);
        const cols = localCols.filter(c => !known_ || known_.has(c));
        const skipped = localCols.filter(c => !cols.includes(c));
        if (skipped.length) skippedColumns[tbl.name] = skipped;
        const colList = cols.map(c => `"${c}"`).join(', ');
        const updateSet = cols.filter(c => !tbl.pk.includes(c)).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

        // A remote row that holds the same unique value under another id (e.g. an item recreated with the same key)
        // goes first. One set-based statement per 500 rows instead of one statement per row; values are compared as
        // text so the local value type never matters.
        const uniqueSets = [...(tbl.uniqueCols || []).map(c => [c]), ...(tbl.uniqueTuple ? [tbl.uniqueTuple] : [])];
        for (const ucols of uniqueSets) {
          if (!localCols.includes('id') || !ucols.every(c => localCols.includes(c))) continue;
          const alias = ucols.map((_, k) => `c${k}`);
          const cond = ucols.map((c, k) => `r."${c}"::text = v.c${k}`).join(' AND ');
          const where = ['id', ...ucols].map(c => `${c} IS NOT NULL`).join(' AND ');
          let batch = [];
          const flush = () => `DELETE FROM "${tbl.name}" AS r USING (VALUES\n${batch.join(',\n')}\n) AS v(id, ${alias.join(', ')}) WHERE ${cond} AND r."id"::text <> v.id;`;
          for (const r of db.prepare(`SELECT id, ${ucols.join(', ')} FROM ${tbl.name} WHERE ${where}`).iterate()) {
            batch.push(`(${[r.id, ...ucols.map(c => r[c])].map(pgText).join(', ')})`);
            if (batch.length === 500) { yield flush(); batch = []; }
          }
          if (batch.length) yield flush();
        }

        // rows go out in chunks of 250, read from SQLite as they are written
        const tail = updateSet ? `ON CONFLICT (${tbl.conflict}) DO UPDATE SET ${updateSet};` : `ON CONFLICT (${tbl.conflict}) DO NOTHING;`;
        let chunk = [];
        const insert = () => `INSERT INTO "${tbl.name}" (${colList}) VALUES\n${chunk.join(',\n')}\n${tail}`;
        for (const r of db.prepare(`SELECT * FROM ${tbl.name}`).iterate()) {
          chunk.push(`(${cols.map(c => pgLiteral(r[c])).join(', ')})`);
          if (chunk.length === 250) { yield insert(); chunk = []; }
        }
        if (chunk.length) yield insert();
      }
      yield `INSERT INTO sync_meta (key, value) VALUES ('revision', ${pgLiteral(revision)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();`;
      yield 'COMMIT;';
    };
    const res = yield { sql: statements(), opts: { timeoutMs: 120000 } };
    if (!res.ok) {
      this.db.prepare('UPDATE sync_outbox SET synced = 0 WHERE synced = 2').run();   // nothing was pushed: still pending
      if (String(res.error).includes('REMOTE_CHANGED')) return this.#refuse('REMOTE_CHANGED', 'PostgreSQL was changed by another machine during the push. Pull first.');
      return { ok: false, status: this.status(), error: res.error };
    }

    const now = new Date().toISOString();
    this.setState('remoteRevision', revision);
    this.db.prepare('UPDATE sync_outbox SET synced = 1, synced_at = ? WHERE synced = 2').run(now);
    this.pruneOutbox();
    this.lastSyncAt = now;
    this.setState('lastSyncAt', now);
    this.setState('lastPushAt', now);
    this.setState('lastSyncCounts', tableCounts);
    return {
      ok: true,
      direction: 'push',
      syncedAt: now,
      pushed: Object.keys(tableCounts).length,
      tableCounts,
      skippedColumns,
      status: this.status()
    };
  }

  pushAll({ force = false } = {}) {
    return this.pushToPostgres({ force });
  }

  pushAllAsync({ force = false } = {}) {
    return this.pushToPostgresAsync({ force });
  }

  /**
   * Pulls PostgreSQL into the local SQLite database: remote rows replace local ones, and rows that were deleted
   * remotely since the last sync are deleted locally (rows created locally after the last sync are kept).
   *
   * Refused (`code: 'LOCAL_UNSYNCED'`) when this database synced before and has local changes that were never
   * pushed — the pull would overwrite them. Push first, or pass `force: true` to discard them.
   */
  pullFromPostgres(opts = {}) { return this.#runSync(this.#pullSteps(opts)); }

  /** `pullFromPostgres` for the server: the remote tables are read without blocking other requests. */
  pullFromPostgresAsync(opts = {}) { return this.#exclusive('pull', this.#pullSteps(opts)); }

  *#pullSteps({ force = false } = {}) {
    if (!this.schemaInitialized) {
      const init = yield* this.#ensureSteps();
      if (!init.ok) return { ok: false, status: this.status(), error: init.error };
    }
    const lastSync = this.getState('lastSyncAt', null);
    const pending = this.pendingCount();
    if (!force && lastSync && pending > 0) {
      return this.#refuse('LOCAL_UNSYNCED', `${pending} local change(s) were never pushed and would be overwritten. Push first (or force the pull to discard them).`);
    }
    const remoteRev = yield* this.#revisionSteps();
    if (!remoteRev.ok) return { ok: false, status: this.status(), error: remoteRev.error };

    const pulledCounts = {};
    // system users (public library owner, AI agent) are matched by username: when the remote copy has another id,
    // local-only rows they own must follow the new id (see #remapSystemOwners)
    const systemBefore = this.#captureSystemOwners();
    const pulledIds = {};
    const replaced = {};
    // 1. read every remote table first: a failed or unreadable table aborts the pull before the local database is touched
    const fetched = [];
    for (const tbl of SYNC_TABLES) {
      const localInfo = this.db.prepare(`PRAGMA table_info(${tbl.name})`).all();
      if (!localInfo.length) continue;
      const q = `SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT * FROM "${tbl.name}") t;`;
      const res = yield { sql: q, opts: { tuplesOnly: true, timeoutMs: 60000 } };
      if (!res.ok) { this.lastError = res.error; return { ok: false, status: this.status(), error: res.error }; }
      let rows;
      try { rows = JSON.parse(res.stdout || '[]'); }
      catch (e) { this.lastError = `Pull failed on ${tbl.name}: unreadable answer (${e.message})`; return { ok: false, status: this.status(), error: this.lastError }; }
      pulledCounts[tbl.name] = rows.length;
      if (rows.length) fetched.push({ tbl, rows, localCols: new Set(localInfo.map(c => c.name)) });
    }
    // somebody may have edited while the remote tables were read (non-blocking pull): same rule as at the start
    if (!force && lastSync && this.pendingCount() > 0) {
      return this.#refuse('LOCAL_UNSYNCED', 'Local changes were made while the pull was reading PostgreSQL. Push first (or force the pull to discard them).');
    }
    // 2. apply all tables, the system-owner remap and the reference repair in ONE transaction (all or nothing)
    this.db.exec('PRAGMA foreign_keys = OFF;');
    let current = '';
    try {
      this.db.exec('BEGIN');
      for (const { tbl, rows, localCols } of fetched) {
        current = tbl.name;

        const cols = Object.keys(rows[0]).filter(c => localCols.has(c));
        if (!cols.length) continue;
        const colList = cols.join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const updateSet = cols.filter(c => !tbl.pk.includes(c)).map(c => `${c} = excluded.${c}`).join(', ');
        const sql = updateSet
          ? `INSERT INTO ${tbl.name} (${colList}) VALUES (${placeholders}) ON CONFLICT(${tbl.conflict}) DO UPDATE SET ${updateSet}`
          : `INSERT OR IGNORE INTO ${tbl.name} (${colList}) VALUES (${placeholders})`;
        const stmt = this.db.prepare(sql);
        const ownerTypeMap = { paths: 'path', icons: 'icon', buttons: 'button', elements: 'element', screens: 'screen' };
        const ownerType = ownerTypeMap[tbl.name] || null;
        const findUniqueStmts = (tbl.uniqueCols || [])
          .filter(uCol => localCols.has(uCol))
          .map(uCol => ({
            col: uCol,
            find: this.db.prepare(`SELECT id FROM ${tbl.name} WHERE ${uCol} = ? AND id != ?`),
            del: this.db.prepare(`DELETE FROM ${tbl.name} WHERE id = ?`)
          }));
        const delOrphanNodesStmt = ownerType ? this.db.prepare('DELETE FROM nodes WHERE owner_type = ? AND owner_id = ?') : null;
        const findTupleStmt = (tbl.uniqueTuple && tbl.uniqueTuple.every(c => localCols.has(c)))
          ? this.db.prepare(`SELECT id FROM ${tbl.name} WHERE ${tbl.uniqueTuple.map(c => `${c} = ?`).join(' AND ')} AND id != ?`)
          : null;
        const delByIdStmt = findTupleStmt ? this.db.prepare(`DELETE FROM ${tbl.name} WHERE id = ?`) : null;
        // local id -> remote id of a row that lost its unique value to a remote row (see #repointReplaced)
        const lost = (replaced[tbl.name] ||= new Map());

        {
          const ids = (pulledIds[tbl.name] ||= new Set());
          for (const r of rows) {
            if (r.id != null) ids.add(Number(r.id));
            for (const u of findUniqueStmts) {
              if (r[u.col] !== undefined && r[u.col] !== null) {
                const oldRows = u.find.all(r[u.col], r.id);
                for (const old of oldRows) {
                  if (delOrphanNodesStmt) delOrphanNodesStmt.run(ownerType, old.id);
                  u.del.run(old.id);
                  if (r.id != null) lost.set(Number(old.id), Number(r.id));
                }
              }
            }
            if (findTupleStmt && tbl.uniqueTuple.every(c => r[c] !== undefined && r[c] !== null)) {
              for (const old of findTupleStmt.all(...tbl.uniqueTuple.map(c => r[c]), r.id)) {
                if (delOrphanNodesStmt) delOrphanNodesStmt.run(ownerType, old.id);
                delByIdStmt.run(old.id);
                if (r.id != null) lost.set(Number(old.id), Number(r.id));
              }
            }
            stmt.run(...cols.map(c => {
              const v = r[c];
              if (typeof v === 'boolean') return v ? 1 : 0;
              if (typeof v === 'object' && v !== null) return JSON.stringify(v);
              return v;
            }));
          }
        }
      }
      current = 'remote deletions';
      const deletedCounts = this.#applyRemoteDeletions(fetched, pulledIds, lastSync);
      Object.assign(pulledCounts, { deleted: deletedCounts });
      current = 'reference repair';
      this.#remapSystemOwners(systemBefore, pulledIds);
      const repointed = this.#repointReplaced(replaced, pulledIds);
      if (Object.keys(repointed).length) Object.assign(pulledCounts, { repointed });
      healForeignKeys(this.db);
      // the local database now is the remote state: the changes recorded so far (discarded local edits and the
      // rows this pull wrote) are not waiting for a push
      this.db.prepare('DELETE FROM sync_outbox WHERE synced <> 1').run();
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      this.lastError = e.message;
      return { ok: false, status: this.status(), error: `Pull failed on ${current}: ${e.message}; nothing was changed locally` };
    } finally {
      try { this.db.exec('PRAGMA foreign_keys = ON;'); } catch { /* ignore */ }
    }

    const now = new Date().toISOString();
    this.lastSyncAt = now;
    this.lastError = null;
    this.setState('lastSyncAt', now);
    this.setState('lastPullAt', now);
    if (remoteRev.revision) this.setState('remoteRevision', remoteRev.revision);
    return {
      ok: true,
      direction: 'pull',
      syncedAt: now,
      pulledCounts,
      pulledUsers: pulledCounts.users ?? 0,
      pulledProjects: pulledCounts.projects ?? 0,
      status: this.status()
    };
  }

  /**
   * Rows deleted remotely since the last sync are deleted locally. A local row that is missing remotely is only
   * removed when it existed at the last sync (`created_at` not later than it): rows created here afterwards are local
   * work that was not pushed yet. Tables without `created_at` are left to the reference repair (their owners decide).
   * Nothing is deleted on a first pull (no last sync) or for a table the remote returned empty.
   */
  #applyRemoteDeletions(fetched, pulledIds, lastSync) {
    const out = {};
    if (!lastSync) return out;
    for (const { tbl, localCols } of fetched) {
      if (tbl.pk.length !== 1 || tbl.pk[0] !== 'id' || !localCols.has('created_at') || tbl.name === 'users') continue;
      const remote = pulledIds[tbl.name];
      if (!remote?.size) continue;
      const del = this.db.prepare(`DELETE FROM ${tbl.name} WHERE id = ?`);
      const delNodes = DESIGN_TABLE_TYPES[tbl.name] ? this.db.prepare('DELETE FROM nodes WHERE owner_type = ? AND owner_id = ?') : null;
      let n = 0;
      for (const r of this.db.prepare(`SELECT id FROM ${tbl.name} WHERE datetime(created_at) <= datetime(?)`).all(lastSync)) {
        if (remote.has(Number(r.id))) continue;
        if (delNodes) delNodes.run(DESIGN_TABLE_TYPES[tbl.name], r.id);
        del.run(r.id);
        n += 1;
      }
      if (n) out[tbl.name] = n;
    }
    return out;
  }

  /**
   * A local row that held the same unique value (username, key …) as a remote row under another id was replaced by
   * the remote one. Rows that stayed local (not part of this pull) and pointed at the old id now point at the new
   * one; rows that came from PostgreSQL already carry remote ids and are left alone. Returns `{ 'table.column': n }`.
   */
  #repointReplaced(replaced, pulledIds) {
    const out = {};
    const has = new Map();
    const cols = t => { if (!has.has(t)) has.set(t, new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name))); return has.get(t); };
    for (const [target, map] of Object.entries(replaced)) {
      if (!map.size) continue;
      for (const [table, column, typeCol, typeVal] of referencesTo(target)) {
        const tc = cols(table);
        if (!tc.has(column) || (typeCol && !tc.has(typeCol))) continue;
        const keyCol = tc.has('id') ? 'id' : 'rowid';
        const pulled = keyCol === 'id' ? pulledIds[table] : null;
        const find = this.db.prepare(`SELECT ${keyCol} AS k FROM ${table} WHERE ${column} = ?${typeCol ? ` AND ${typeCol} = ?` : ''}`);
        const set = this.db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${keyCol} = ?`);
        let n = 0;
        for (const [oldId, newId] of map) {
          for (const row of find.all(...(typeCol ? [oldId, typeVal] : [oldId]))) {
            if (pulled?.has(Number(row.k))) continue;
            n += Number(set.run(newId, row.k).changes || 0);
          }
        }
        if (n) out[`${table}.${column}`] = n;
      }
    }
    return out;
  }

  /** Local ids of the system users and, per table, the ids of rows they own (creator or root owner). */
  #captureSystemOwners() {
    const out = [];
    for (const username of [PUBLIC_USERNAME, AGENT_USERNAME]) {
      const id = userIdByName(this.db, username);
      if (id == null) continue;
      const rows = {};
      for (const t of SYSTEM_OWNER_TABLES) {
        try {
          rows[t] = this.db.prepare(`SELECT id, creator_id, root_owner_id FROM ${t} WHERE creator_id = ? OR root_owner_id = ?`).all(id, id);
        } catch { /* table or column missing */ }
      }
      out.push({ username, id: Number(id), rows });
    }
    return out;
  }

  /**
   * After a pull: a system user whose local id changed (the remote row won the username) keeps owning its local-only
   * rows. Rows that came from PostgreSQL already carry the remote ids and are left alone.
   */
  #remapSystemOwners(before, pulledIds) {
    for (const { username, id: oldId, rows } of before) {
      const newId = userIdByName(this.db, username);
      if (newId == null || Number(newId) === oldId) continue;
      try {
        for (const [t, list] of Object.entries(rows)) {
          const pulled = pulledIds[t] || new Set();
          const setCreator = this.db.prepare(`UPDATE ${t} SET creator_id = ? WHERE id = ? AND creator_id = ?`);
          const setRoot = this.db.prepare(`UPDATE ${t} SET root_owner_id = ? WHERE id = ? AND root_owner_id = ?`);
          for (const r of list) {
            if (pulled.has(Number(r.id))) continue;
            if (Number(r.creator_id) === oldId) setCreator.run(newId, r.id, oldId);
            if (Number(r.root_owner_id) === oldId) setRoot.run(newId, r.id, oldId);
          }
        }
      } catch (e) {
        // runs inside the pull transaction: a failed remap rolls the whole pull back
        throw new Error(`remap of system user ${username} failed: ${e.message}`);
      }
    }
  }

  /**
   * Pushes the local state to PostgreSQL (the remote becomes a mirror of the local database). It never pulls: a pull
   * replaces local rows, so it stays an explicit action (`pullFromPostgres`). The answer says so (`direction: 'push'`).
   */
  syncNow({ force = false } = {}) {
    const pushRes = this.pushToPostgres({ force });
    if (!pushRes.ok) return pushRes;
    return { ...pushRes, push: pushRes, direction: 'push', pulled: false };
  }

  async syncNowAsync({ force = false } = {}) {
    const pushRes = await this.pushToPostgresAsync({ force });
    if (!pushRes.ok) return pushRes;
    return { ...pushRes, push: pushRes, direction: 'push', pulled: false };
  }
}
