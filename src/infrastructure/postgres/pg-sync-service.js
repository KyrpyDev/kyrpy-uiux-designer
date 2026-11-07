/**
 * Offline-First PostgreSQL Synchronization Service (`kyrpy-uiux-designer-db`).
 *
 * Architecture:
 * - Local SQLite (`designer.db`) is the primary offline-first store (0ms latency, works 100% offline / local-only).
 * - Every mutation is queued in `sync_outbox` and can optionally sync with a remote PostgreSQL database (`kyrpy-uiux-designer-db`).
 * - Reads connection settings from `.env`, `credentials.env`, or environment variables (zero external npm dependencies).
 * - When no PostgreSQL host/credentials are configured (`PG_SYNC_ENABLED=false` or empty `PGHOST`), runs in local-only SQLite mode.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

function loadCredentialsEnv() {
  const envFiles = [join(repoRoot, '.env'), join(repoRoot, 'credentials.env'), join(repoRoot, 'config.env')];
  const out = {};
  for (const f of envFiles) {
    if (!existsSync(f)) continue;
    try {
      const txt = readFileSync(f, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n#]*)["']?/.exec(line);
        if (m) {
          let val = m[2].trim();
          const bashDef = /^\$\{[A-Z0-9_]+:-(.*)\}$/.exec(val);
          if (bashDef) val = bashDef[1].trim();
          if (out[m[1]] === undefined || out[m[1]] === '') out[m[1]] = val;
        }
      }
    } catch { /* ignore */ }
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
export const PG_SCHEMA_SQL = CORE_PG_SCHEMA_SQL + MCP_PG_SCHEMA_SQL;

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
  }

  /** Logs an offline-first mutation into the local SQLite outbox. */
  enqueue(tableName, recordId, operation, payload = {}) {
    try {
      this.db.prepare('INSERT INTO sync_outbox (table_name, record_id, operation, payload, synced) VALUES (?, ?, ?, ?, 0)')
        .run(String(tableName), String(recordId), String(operation), JSON.stringify(payload ?? {}));
    } catch { /* ignore outbox write errors on closed db */ }
  }

  pendingCount() {
    try {
      return this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced = 0').get().n;
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
    } catch { /* ignore */ }
  }

  /** Executes SQL against PostgreSQL via psql with a strict timeout so offline mode never blocks. */
  execPg(sql, { database = this.config.database, tuplesOnly = false, timeoutMs = 8000 } = {}) {
    if (!this.enabled) return { ok: false, error: 'sync disabled' };
    const args = ['-h', this.config.host, '-p', this.config.port, '-U', this.config.user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
    if (tuplesOnly) args.push('-t', '-A');
    const res = spawnSync('psql', args, {
      input: sql,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: this.config.password, PGCONNECT_TIMEOUT: '3' }
    });
    if (res.error || res.status !== 0) {
      const err = (res.stderr || res.error?.message || 'PostgreSQL connection failed').trim();
      this.online = false;
      this.lastError = err;
      return { ok: false, error: err };
    }
    this.online = true;
    this.lastError = null;
    return { ok: true, stdout: (res.stdout || '').trim() };
  }

  /** Ensures the target database `kyrpy-uiux-designer-db` and all tables exist in PostgreSQL. */
  ensureRemoteDatabase() {
    const check = this.execPg(`SELECT 1 FROM pg_database WHERE datname = ${pgLiteral(this.config.database)};`, { database: this.config.adminDb, tuplesOnly: true, timeoutMs: 5000 });
    if (!check.ok) return check;
    if (!check.stdout.includes('1')) {
      const create = this.execPg(`CREATE DATABASE "${this.config.database}";`, { database: this.config.adminDb, timeoutMs: 8000 });
      if (!create.ok && !String(create.error).includes('already exists')) return create;
    }
    const schemaRes = this.execPg(PG_SCHEMA_SQL, { database: this.config.database, timeoutMs: 12000 });
    if (schemaRes.ok) this.schemaInitialized = true;
    return schemaRes;
  }

  syncedCount() {
    try {
      return this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced = 1').get().n;
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
      state: {
        last_push_at: this.getState('lastPushAt', lastSyncAt),
        last_pull_at: this.getState('lastPullAt', lastSyncAt),
        last_sync_status: !this.enabled ? 'local-only' : (this.lastError ? 'error' : (lastSyncAt ? 'synced' : 'ready'))
      }
    };
  }

  /** Pushes all local SQLite tables to PostgreSQL `kyrpy-uiux-designer-db` in a single atomic transaction. */
  pushToPostgres() {
    if (!this.schemaInitialized) {
      const init = this.ensureRemoteDatabase();
      if (!init.ok) return { ok: false, status: this.status(), error: init.error };
    }

    const statements = ['BEGIN;'];
    const tableCounts = {};

    for (const tbl of SYNC_TABLES) {
      const rows = this.db.prepare(`SELECT * FROM ${tbl.name}`).all();
      tableCounts[tbl.name] = rows.length;
      if (!rows.length) {
        statements.push(`DELETE FROM "${tbl.name}";`);
        continue;
      }
      if (tbl.pk.length === 1) {
        const pkCol = tbl.pk[0];
        const idList = rows.map(r => pgLiteral(r[pkCol])).join(', ');
        statements.push(`DELETE FROM "${tbl.name}" WHERE "${pkCol}" NOT IN (${idList});`);
      }
      // a remote superadmin that is not the local one steps down first: the single-superadmin index would reject
      // upserting the new superadmin while the old one still holds the role (rows are written one by one)
      if (tbl.name === 'users') {
        const keep = rows.filter(r => r.role === 'superadmin').map(r => pgLiteral(r.id));
        statements.push(`UPDATE "users" SET "role" = 'admin' WHERE "role" = 'superadmin' AND "id" NOT IN (${keep.length ? keep.join(', ') : '-1'});`);
      }
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => `"${c}"`).join(', ');
      const updateSet = cols
        .filter(c => !tbl.pk.includes(c))
        .map(c => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');

      // Resolve any secondary UNIQUE column conflicts on remote PostgreSQL (e.g. recreated item with same key but new id)
      if (tbl.uniqueCols) {
        for (const uCol of tbl.uniqueCols) {
          for (const r of rows) {
            if (r[uCol] !== undefined && r[uCol] !== null) {
              statements.push(`DELETE FROM "${tbl.name}" WHERE "${uCol}" = ${pgLiteral(r[uCol])} AND "id" != ${pgLiteral(r.id)};`);
            }
          }
        }
      }
      if (tbl.uniqueTuple) {
        for (const r of rows) {
          const cond = tbl.uniqueTuple.map(c => `"${c}" = ${pgLiteral(r[c])}`).join(' AND ');
          statements.push(`DELETE FROM "${tbl.name}" WHERE ${cond} AND "id" != ${pgLiteral(r.id)};`);
        }
      }

      // Batch inserts in chunks of 250 rows for speed
      const chunkSize = 250;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const valuesSql = chunk.map(r => `(${cols.map(c => pgLiteral(r[c])).join(', ')})`).join(',\n');
        if (updateSet) {
          statements.push(`INSERT INTO "${tbl.name}" (${colList}) VALUES\n${valuesSql}\nON CONFLICT (${tbl.conflict}) DO UPDATE SET ${updateSet};`);
        } else {
          statements.push(`INSERT INTO "${tbl.name}" (${colList}) VALUES\n${valuesSql}\nON CONFLICT (${tbl.conflict}) DO NOTHING;`);
        }
      }
    }

    statements.push('COMMIT;');
    const res = this.execPg(statements.join('\n'), { timeoutMs: 30000 });
    if (!res.ok) return { ok: false, status: this.status(), error: res.error };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE sync_outbox SET synced = 1, synced_at = ? WHERE synced = 0').run(now);
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
      status: this.status()
    };
  }

  pushAll(opts = {}) {
    void opts;
    return this.pushToPostgres();
  }

  /** Pulls records from PostgreSQL `kyrpy-uiux-designer-db` into local SQLite (upsert). */
  pullFromPostgres() {
    if (!this.schemaInitialized) {
      const init = this.ensureRemoteDatabase();
      if (!init.ok) return { ok: false, status: this.status(), error: init.error };
    }

    const pulledCounts = {};
    // system users (public library owner, AI agent) are matched by username: when the remote copy has another id,
    // local-only rows they own must follow the new id (see #remapSystemOwners)
    const systemBefore = this.#captureSystemOwners();
    const pulledIds = {};
    this.db.exec('PRAGMA foreign_keys = OFF;');
    try {
      for (const tbl of SYNC_TABLES) {
        const localInfo = this.db.prepare(`PRAGMA table_info(${tbl.name})`).all();
        if (!localInfo.length) continue;
        const localCols = new Set(localInfo.map(c => c.name));

        const q = `SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT * FROM "${tbl.name}") t;`;
        const res = this.execPg(q, { tuplesOnly: true, timeoutMs: 15000 });
        if (!res.ok) return { ok: false, status: this.status(), error: res.error };
        let rows = [];
        try { rows = JSON.parse(res.stdout || '[]'); } catch { rows = []; }
        pulledCounts[tbl.name] = rows.length;
        if (!rows.length) continue;

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
        const delTupleStmt = (tbl.uniqueTuple && tbl.uniqueTuple.every(c => localCols.has(c)))
          ? this.db.prepare(`DELETE FROM ${tbl.name} WHERE ${tbl.uniqueTuple.map(c => `${c} = ?`).join(' AND ')} AND id != ?`)
          : null;

        this.db.exec('BEGIN');
        try {
          const ids = (pulledIds[tbl.name] ||= new Set());
          for (const r of rows) {
            if (r.id != null) ids.add(Number(r.id));
            for (const u of findUniqueStmts) {
              if (r[u.col] !== undefined && r[u.col] !== null) {
                const oldRows = u.find.all(r[u.col], r.id);
                for (const old of oldRows) {
                  if (delOrphanNodesStmt) delOrphanNodesStmt.run(ownerType, old.id);
                  u.del.run(old.id);
                }
              }
            }
            if (delTupleStmt) {
              delTupleStmt.run(...tbl.uniqueTuple.map(c => r[c]), r.id);
            }
            stmt.run(...cols.map(c => {
              const v = r[c];
              if (typeof v === 'boolean') return v ? 1 : 0;
              if (typeof v === 'object' && v !== null) return JSON.stringify(v);
              return v;
            }));
          }
          this.db.exec('COMMIT');
        } catch (e) {
          try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
          this.lastError = e.message;
          return { ok: false, status: this.status(), error: `Pull failed on ${tbl.name}: ${e.message}` };
        }
      }
      this.#remapSystemOwners(systemBefore, pulledIds);
      healForeignKeys(this.db);
    } finally {
      try { this.db.exec('PRAGMA foreign_keys = ON;'); } catch { /* ignore */ }
    }

    const now = new Date().toISOString();
    this.lastSyncAt = now;
    this.lastError = null;
    this.setState('lastSyncAt', now);
    this.setState('lastPullAt', now);
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
      this.db.exec('BEGIN');
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
        this.db.exec('COMMIT');
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
        this.lastError = `remap of system user ${username} failed: ${e.message}`;
      }
    }
  }

  /** Bi-directional sync: pushes local state & outbox to PostgreSQL, ensuring both DBs match. */
  syncNow() {
    const pushRes = this.pushToPostgres();
    if (!pushRes.ok) return pushRes;
    return { ...pushRes, push: pushRes, direction: 'bidirectional' };
  }
}
