#!/usr/bin/env node
/**
 * Sanitizes `src/data/designer.db` and exports synchronized SQL schemas + public-only sample data dumps:
 *  - Syncs `sql/schema_sqlite.sql` and `sql/schema_postgres.sql` with the final database schema.
 *  - Resets `admin` user password to `admin` (and `kyrpy` to `kyrpy123`), removing any other user accounts or sessions.
 *  - Exports ONLY `public` items (`visibility = 'public'`), excluding all `private` (user global) and `project`-specific items
 *    from `src/data/designer.db`, `sql/sample_data_sqlite.sql`, and `sql/sample_data_postgres.sql`.
 */
import { scryptSync } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, healForeignKeys } from '../infrastructure/sqlite/database.js';
import { PG_SCHEMA_SQL } from '../infrastructure/postgres/pg-sync-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const repoRoot = resolve(srcRoot, '..');
const dbFile = process.env.DB_FILE || join(srcRoot, 'data', 'designer.db');
const sqlDir = join(repoRoot, 'sql');

mkdirSync(sqlDir, { recursive: true });

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

function sqlLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const db = openDatabase(dbFile);

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN;');
try {
  const now = '2026-11-05 00:00:00';
  const kyrpyHash = hashPassword('kyrpy123', 'kyrpy_salt_v1');
  const adminHash = hashPassword('admin', 'admin_salt_v1');

  // 1. Reset users to only default `kyrpy` (id=1) and `admin` (id=2, password 'admin')
  db.exec('DELETE FROM sessions;');
  db.exec('DELETE FROM users;');
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, salt, display_name, role, status, permissions, avatar_color, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '["*"]', ?, ?, ?, NULL)
  `).run(1, 'kyrpy', 'kyrpy@kyrpy.com', kyrpyHash, 'kyrpy_salt_v1', 'Kyrpy (Admin)', 'admin', '#2e9bff', now, now);

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, salt, display_name, role, status, permissions, avatar_color, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '["*"]', ?, ?, ?, NULL)
  `).run(2, 'admin', 'admin@local.dev', adminHash, 'admin_salt_v1', 'Administrator', 'superadmin', '#10b981', now, now);

  // 2. Keep only Default Public Project (id=1)
  db.exec('DELETE FROM projects WHERE id != 1;');
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, key, name, label, description, owner_id, visibility, require_approval, settings, created_at, updated_at)
    VALUES (1, 'default-project', 'Default Public Project', 'Default Public Project', 'Default workspace project containing public and shared UI/UX designs.', 1, 'public', 1, '{}', ?, ?)
  `).run(now, now);

  db.exec('DELETE FROM project_members;');
  db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, invited_by, role, status, created_at, updated_at)
    VALUES (1, 1, 1, 1, 'owner', 'accepted', ?, ?),
           (2, 1, 2, 1, 'admin', 'accepted', ?, ?)
  `).run(now, now, now, now);

  // 3. Exclude all `private` and `project` items — keep ONLY `public` items
  const designTables = ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows'];
  for (const table of designTables) {
    db.exec(`DELETE FROM "${table}" WHERE visibility != 'public' OR visibility IS NULL;`);
    db.exec(`UPDATE "${table}" SET project_id = 1, visibility = 'public', creator_id = 1, root_owner_id = 1, cloned_from_id = NULL, root_item_id = id;`);
  }

  // 4. Clean up nodes belonging to deleted non-public items
  db.exec(`
    DELETE FROM nodes WHERE owner_type = 'path' AND owner_id NOT IN (SELECT id FROM paths);
    DELETE FROM nodes WHERE owner_type = 'icon' AND owner_id NOT IN (SELECT id FROM icons);
    DELETE FROM nodes WHERE owner_type = 'button' AND owner_id NOT IN (SELECT id FROM buttons);
    DELETE FROM nodes WHERE owner_type = 'element' AND owner_id NOT IN (SELECT id FROM elements);
    DELETE FROM nodes WHERE owner_type = 'screen' AND owner_id NOT IN (SELECT id FROM screens);
  `);

  // 5. Clear ephemeral / private collaboration & sync tables
  db.exec(`
    DELETE FROM change_requests;
    DELETE FROM sync_outbox;
    DELETE FROM sync_state;
    DELETE FROM trash_items;
  `);

  // 6. Clean up orphaned translations
  for (const table of designTables) {
    db.exec(`DELETE FROM translations WHERE table_name = '${table}' AND record_id NOT IN (SELECT id FROM "${table}");`);
  }

  healForeignKeys(db);
  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  throw err;
}

db.exec('PRAGMA foreign_keys = ON;');
db.exec('VACUUM;');

// 7. Sync SQLite Schema (`sql/schema_sqlite.sql`) and Postgres Schema (`sql/schema_postgres.sql`)
const schemaRows = db.prepare(`
  SELECT type, name, tbl_name, sql
  FROM sqlite_master
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name
`).all();

const sqliteSchemaLines = [
  '-- =============================================================================',
  '-- Kyrpy UI/UX Designer — SQLite Schema (Auto-synced by scripts/export-public-db.js)',
  '-- =============================================================================',
  'PRAGMA foreign_keys = ON;',
  ''
];
for (const row of schemaRows) {
  sqliteSchemaLines.push(`${row.sql.trim()};`);
  sqliteSchemaLines.push('');
}
writeFileSync(join(sqlDir, 'schema_sqlite.sql'), sqliteSchemaLines.join('\n'), 'utf8');

const pgSchemaHeader = `-- Kyrpy UI/UX Designer — PostgreSQL Schema\n${PG_SCHEMA_SQL.trim()}\n`;
writeFileSync(join(sqlDir, 'schema_postgres.sql'), pgSchemaHeader, 'utf8');

// 8. Export Public-Only Sample Data Dumps (`sql/sample_data_sqlite.sql` & `sql/sample_data_postgres.sql`)
const EXPORT_TABLES = [
  'users',
  'projects',
  'project_members',
  'themes',
  'paths',
  'icons',
  'buttons',
  'elements',
  'screens',
  'nodes',
  'animations',
  'menu_items',
  'workflows',
  'workflow_screens',
  'workflow_links',
  'change_requests',
  'template_devices',
  'template_buttons',
  'translations',
  'settings',
  'trash_items'
];

const sqliteDump = [
  '-- =============================================================================',
  '-- Kyrpy UI/UX Designer — SQLite Sample Data Dump (Public Items Only)',
  '-- =============================================================================',
  'PRAGMA foreign_keys = OFF;',
  'BEGIN TRANSACTION;'
];

const pgDump = [
  '-- =============================================================================',
  '-- Kyrpy UI/UX Designer — PostgreSQL Sample Database Dump (Public Items Only)',
  '-- Import with: psql -h <PGHOST> -p <PGPORT> -U <PGUSER> -d kyrpy-uiux-designer-db -f sql/sample_data_postgres.sql',
  '-- =============================================================================',
  'BEGIN;',
  PG_SCHEMA_SQL.trim(),
  `TRUNCATE TABLE ${EXPORT_TABLES.join(', ')} RESTART IDENTITY CASCADE;`
];

const counts = {};
for (const table of EXPORT_TABLES) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
  if (!cols.length) continue;
  const orderCol = cols.includes('id')
    ? 'id'
    : (cols.includes('workflow_id') ? 'workflow_id, screen_id' : cols[0]);
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderCol}`).all();
  counts[table] = rows.length;
  sqliteDump.push(`-- Table: ${table} (${rows.length} rows)`);
  pgDump.push(`-- Table: ${table} (${rows.length} rows)`);
  const colList = cols.map(c => `"${c}"`).join(', ');
  for (const row of rows) {
    const valList = cols.map(c => sqlLiteral(row[c])).join(', ');
    sqliteDump.push(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${valList});`);
    pgDump.push(`INSERT INTO "${table}" (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;`);
  }
}

sqliteDump.push('COMMIT;');
sqliteDump.push('PRAGMA foreign_keys = ON;');
sqliteDump.push('');

pgDump.push('COMMIT;');
pgDump.push('');

writeFileSync(join(sqlDir, 'sample_data_sqlite.sql'), sqliteDump.join('\n'), 'utf8');
writeFileSync(join(sqlDir, 'sample_data_postgres.sql'), pgDump.join('\n'), 'utf8');

console.log('[db:export-public] Exported public-only DB & schemas successfully:', JSON.stringify(counts));
