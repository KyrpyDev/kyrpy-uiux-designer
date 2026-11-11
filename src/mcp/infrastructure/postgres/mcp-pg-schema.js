/**
 * PostgreSQL parity for the MCP-layer schema. Appended to the core PG DDL by pg-sync-service.js, so the
 * remote database has every column the local push sends (`mcp_context`, `uid`, `content_hash`) and the
 * `schema_registry` table. Idempotent (IF NOT EXISTS everywhere).
 *
 * uid is not backfilled remotely: the next push sends the local uids, and the local `uid_keep` trigger
 * protects local uids from NULLs pulled before that.
 */
import { IDENTITY_TABLES, PROJECT_KEY_TABLES } from '../../domain/tables.js';
import { MCP_MIGRATIONS } from '../sqlite/mcp-schema.js';

/**
 * MCP tables pushed to / pulled from PostgreSQL by the snapshot sync (appended to the core SYNC_TABLES).
 * Only `mcp_migrations` (the local schema ledger) stays local. API keys are synced as HMAC hashes: they
 * authenticate on another instance only when it shares KYRPY_UIUX_KEY_PEPPER.
 */
export const MCP_SYNC_TABLES = [
  { name: 'api_keys', pk: ['id'], conflict: 'id', uniqueCols: ['uid', 'key_hash'] },
  { name: 'mcp_audit_log', pk: ['id'], conflict: 'id' },
  { name: 'ai_artifacts', pk: ['id'], conflict: 'id', uniqueCols: ['uid'], uniqueTuple: ['scope', 'project_id', 'kind', 'name', 'platform'] },
  { name: 'project_versions', pk: ['id'], conflict: 'id', uniqueCols: ['uid'] },
  { name: 'changesets', pk: ['id'], conflict: 'id', uniqueCols: ['uid'] },
  { name: 'changeset_ops', pk: ['id'], conflict: 'id', uniqueCols: ['uid'], uniqueTuple: ['changeset_id', 'item_type', 'item_key'] },
  { name: 'item_requests', pk: ['id'], conflict: 'id', uniqueCols: ['uid'] },
  { name: 'version_items', pk: ['item_uid', 'content_hash'], conflict: 'item_uid, content_hash' },
  { name: 'code_bindings', pk: ['id'], conflict: 'id', uniqueCols: ['uid'], uniqueTuple: ['project_id', 'item_uid', 'repo_id', 'file_path', 'symbol'] },
  { name: 'element_scripts', pk: ['id'], conflict: 'id', uniqueCols: ['uid', 'element_id'] }
];

/**
 * PostgreSQL form of the SQLite MCP migrations (same columns, no foreign keys: the sync pushes tables one by
 * one and ids come from SQLite). Derived, so the two schemas cannot drift apart.
 */
export function sqliteToPgDdl(sql) {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INTEGER PRIMARY KEY')
    .replace(/\s+REFERENCES\s+\w+\s*\(\w+\)(\s+ON DELETE (CASCADE|SET NULL))?/g, '')
    .replace(/DEFAULT \((strftime|datetime)\([^)]*\)\)/g, "DEFAULT ''")
    .replace(/--[^\n]*/g, '');
}
const MCP_PG_TABLES_SQL = MCP_MIGRATIONS.filter(m => m.id !== 'm0-001-schema-registry' && m.pg !== false).map(m => sqliteToPgDdl(m.sql)).join('\n');

/** Tables that exist in the PostgreSQL schema (sessions, sync_outbox, sync_state and mcp_migrations stay local). */
export const PG_TABLES = [
  'users', 'projects', 'project_members', 'themes', 'paths', 'icons', 'buttons', 'elements', 'screens',
  'nodes', 'animations', 'menu_items', 'workflows', 'workflow_screens', 'workflow_links', 'change_requests',
  'template_devices', 'template_buttons', 'translations', 'settings', 'trash_items'
];

export const MCP_PG_SCHEMA_SQL = `
-- ===== kyrpy-uiux-mcp (M0): schema_registry, mcp_context on every table, uid + content_hash =====
CREATE TABLE IF NOT EXISTS schema_registry (
  id          INTEGER PRIMARY KEY,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT '',
  mcp_context TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'seed',
  updated_at  TEXT NOT NULL DEFAULT '',
  UNIQUE (table_name, column_name)
);
${PG_TABLES.map(t => `ALTER TABLE IF EXISTS "${t}" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';`).join('\n')}
${IDENTITY_TABLES.map(t => `ALTER TABLE IF EXISTS "${t}" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "${t}" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_uid ON "${t}"(uid);`).join('\n')}
-- ===== per-project keys: drop the global UNIQUE(key), keys are unique per (project_id, key) =====
${PROJECT_KEY_TABLES.map(t => `ALTER TABLE IF EXISTS "${t}" DROP CONSTRAINT IF EXISTS "${t}_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_project_key ON "${t}"(project_id, key);`).join('\n')}
-- ===== kyrpy-uiux-mcp (M1–M6): keys, audit, AI pack, versions, changesets, requests, bindings =====
${MCP_PG_TABLES_SQL}
-- ===== account (user-wide) API keys (m11): kind + project_id nullable for kind = 'account' =====
ALTER TABLE IF EXISTS api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'project';
ALTER TABLE IF EXISTS api_keys ALTER COLUMN project_id DROP NOT NULL;
`;
