import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';
import { foldSearchHaystack } from '../../domain/search.js';
import { applyMcpSchema, dropMcpTriggers } from '../../mcp/infrastructure/sqlite/mcp-schema.js';
import { dropOutboxTriggers } from './outbox-triggers.js';

const HEAL_STEPS = [
  ['workflow_screens without workflow or screen', 'DELETE FROM workflow_screens WHERE workflow_id NOT IN (SELECT id FROM workflows) OR screen_id NOT IN (SELECT id FROM screens)'],
  ['workflow_links without workflow or screen', 'DELETE FROM workflow_links WHERE workflow_id NOT IN (SELECT id FROM workflows) OR from_screen_id NOT IN (SELECT id FROM screens) OR to_screen_id NOT IN (SELECT id FROM screens)'],
  ['workflow_links.from_node_id cleared', 'UPDATE workflow_links SET from_node_id = NULL WHERE from_node_id IS NOT NULL AND from_node_id NOT IN (SELECT id FROM nodes)'],
  ['animations without node', 'DELETE FROM animations WHERE node_id NOT IN (SELECT id FROM nodes)'],
  ['nodes.parent_id cleared', 'UPDATE nodes SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM nodes)'],
  ['menu_items without button', 'DELETE FROM menu_items WHERE button_id NOT IN (SELECT id FROM buttons)'],
  ['menu_items.parent_id cleared', 'UPDATE menu_items SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM menu_items)'],
  ['menu_items.icon_id cleared', 'UPDATE menu_items SET icon_id = NULL WHERE icon_id IS NOT NULL AND icon_id NOT IN (SELECT id FROM icons)'],
  ['menu_items.target_screen_id cleared', 'UPDATE menu_items SET target_screen_id = NULL WHERE target_screen_id IS NOT NULL AND target_screen_id NOT IN (SELECT id FROM screens)'],
  ['project_members without project or user', 'DELETE FROM project_members WHERE project_id NOT IN (SELECT id FROM projects) OR user_id NOT IN (SELECT id FROM users)'],
  ['menu_items.target_element_id cleared', 'UPDATE menu_items SET target_element_id = NULL WHERE target_element_id IS NOT NULL AND target_element_id NOT IN (SELECT id FROM elements)'],
  ['menu_items.ref_button_id cleared', 'UPDATE menu_items SET ref_button_id = NULL WHERE ref_button_id IS NOT NULL AND ref_button_id NOT IN (SELECT id FROM buttons)']
];

/**
 * Removes orphaned child rows and clears dangling nullable references after a sync or migration, so
 * `foreign_key_check` is clean. Returns what it changed (`[{ what, rows }]`) and what failed (`errors`);
 * anything changed or failed is also written to the log (`log`, default console.warn), never done silently.
 */
export function healForeignKeys(db, { log = msg => console.warn(msg) } = {}) {
  const changed = [], errors = [];
  for (const [what, sql] of HEAL_STEPS) {
    try {
      const rows = Number(db.prepare(sql).run().changes || 0);
      if (rows) changed.push({ what, rows });
    } catch (e) {
      // a table or column of a later migration is not there yet: expected, not an error
      if (!/no such (table|column)/i.test(e.message)) errors.push(`${what}: ${e.message}`);
    }
  }
  try {
    const perTable = new Map();
    for (const b of db.prepare('PRAGMA foreign_key_check').all()) {
      if (!b.table || b.rowid == null) continue;
      try { if (db.prepare(`DELETE FROM "${b.table}" WHERE rowid = ?`).run(b.rowid).changes) perTable.set(b.table, (perTable.get(b.table) || 0) + 1); }
      catch (e) { errors.push(`${b.table} row ${b.rowid}: ${e.message}`); }
    }
    for (const [table, rows] of perTable) changed.push({ what: `${table} rows with a missing parent (${'foreign_key_check'})`, rows });
  } catch (e) { errors.push(`foreign_key_check: ${e.message}`); }
  if (log && changed.length) log(`[db] reference repair: ${changed.map(c => `${c.rows} × ${c.what}`).join('; ')}`);
  if (log && errors.length) log(`[db] reference repair failed: ${errors.join('; ')}`);
  return { changed, errors };
}

/** Opens (and migrates) the SQLite database. Pass ':memory:' for tests. */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;');   // OFF while tables are rebuilt
  migrate(db);
  applyMcpSchema(db);   // MCP layer (src/mcp): mcp_context on every table, uid/content_hash, schema_registry
  healForeignKeys(db);
  const bad = db.prepare('PRAGMA foreign_key_check').all();
  if (bad.length) throw new Error(`foreign key violations after migration: ${JSON.stringify(bad.slice(0, 3))}`);
  db.exec('PRAGMA foreign_keys = ON;');
  // Unicode lower-casing for searches (SQLite's LOWER only knows ASCII)
  db.function('ulower', { deterministic: true }, v => (v == null ? null : String(v).toLowerCase()));
  // searches: lower case without accents (see domain/search.js), so every word of a query is matched the same way
  db.function('ufold', { deterministic: true }, v => (v == null ? null : foldSearchHaystack(v)));
  cacheStatements(db);
  return db;
}

const STATEMENT_CACHE_MAX = 400;

/**
 * Repositories call `db.prepare(sql)` on every use. This keeps the compiled statement of each SQL text (least
 * recently used first out, at most STATEMENT_CACHE_MAX), so a query that runs once per row is compiled once.
 * SQLite re-compiles a kept statement by itself after a schema change.
 */
export function cacheStatements(db, max = STATEMENT_CACHE_MAX) {
  const prepare = db.prepare.bind(db);
  const cache = new Map();
  db.prepare = sql => {
    const hit = cache.get(sql);
    if (hit) { cache.delete(sql); cache.set(sql, hit); return hit; }
    const stmt = prepare(sql);
    cache.set(sql, stmt);
    if (cache.size > max) cache.delete(cache.keys().next().value);
    return stmt;
  };
  db.statementCache = cache;
  return db;
}

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current < MIGRATIONS.length) dropMcpTriggers(db);   // MCP triggers would block table rebuilds; re-created by applyMcpSchema
  if (current < MIGRATIONS.length) dropOutboxTriggers(db);   // same for the sync change tracking; re-created by PostgresSyncService
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (version <= current) return;
    db.exec('BEGIN');
    try { db.exec(sql); db.exec(`PRAGMA user_version = ${version}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw new Error(`migration ${version} failed: ${e.message}`); }
  });
}

/** Runs fn inside a transaction (nesting-safe via savepoints). */
export function inTransaction(db, fn) {
  const nested = db.isTransaction;
  const sp = `sp_${Math.random().toString(36).slice(2)}`;
  db.exec(nested ? `SAVEPOINT ${sp}` : 'BEGIN');
  try {
    const r = fn();
    db.exec(nested ? `RELEASE ${sp}` : 'COMMIT');
    return r;
  } catch (e) {
    db.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw e;
  }
}
