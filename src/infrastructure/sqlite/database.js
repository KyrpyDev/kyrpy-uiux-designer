import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';
import { applyMcpSchema, dropMcpTriggers } from '../../mcp/infrastructure/sqlite/mcp-schema.js';

/** Cleans up any orphaned child rows or dangling nullable references after sync/migration so foreign_key_check is 100% clean. */
export function healForeignKeys(db) {
  try {
    db.exec(`
      DELETE FROM workflow_screens WHERE workflow_id NOT IN (SELECT id FROM workflows) OR screen_id NOT IN (SELECT id FROM screens);
      DELETE FROM workflow_links WHERE workflow_id NOT IN (SELECT id FROM workflows) OR from_screen_id NOT IN (SELECT id FROM screens) OR to_screen_id NOT IN (SELECT id FROM screens);
      UPDATE workflow_links SET from_node_id = NULL WHERE from_node_id IS NOT NULL AND from_node_id NOT IN (SELECT id FROM nodes);
      DELETE FROM animations WHERE node_id NOT IN (SELECT id FROM nodes);
      UPDATE nodes SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM nodes);
      DELETE FROM menu_items WHERE button_id NOT IN (SELECT id FROM buttons);
      UPDATE menu_items SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM menu_items);
      UPDATE menu_items SET icon_id = NULL WHERE icon_id IS NOT NULL AND icon_id NOT IN (SELECT id FROM icons);
      UPDATE menu_items SET target_screen_id = NULL WHERE target_screen_id IS NOT NULL AND target_screen_id NOT IN (SELECT id FROM screens);
      DELETE FROM project_members WHERE project_id NOT IN (SELECT id FROM projects) OR user_id NOT IN (SELECT id FROM users);
    `);
    try {
      db.exec(`UPDATE menu_items SET target_element_id = NULL WHERE target_element_id IS NOT NULL AND target_element_id NOT IN (SELECT id FROM elements);`);
      db.exec(`UPDATE menu_items SET ref_button_id = NULL WHERE ref_button_id IS NOT NULL AND ref_button_id NOT IN (SELECT id FROM buttons);`);
    } catch { /* column may not exist on older v1-v5 schema */ }
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    for (const b of bad) {
      if (b.table && b.rowid != null) {
        try { db.prepare(`DELETE FROM "${b.table}" WHERE rowid = ?`).run(b.rowid); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
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
  return db;
}

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current < MIGRATIONS.length) dropMcpTriggers(db);   // MCP triggers would block table rebuilds; re-created by applyMcpSchema
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
