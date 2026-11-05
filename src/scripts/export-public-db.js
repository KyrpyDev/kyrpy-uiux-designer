#!/usr/bin/env node
/**
 * Production-Safe Public Library & Schema Exporter (`npm run db:export-public`):
 *  - Preserves all live user edits in `src/data/designer.prod.db` (NEVER deletes or overwrites live user data!).
 *  - Builds a clean GitHub-ready SQLite database at `src/data/designer.db` and exports synchronized SQL schemas
 *    (`sql/schema_sqlite.sql`, `sql/schema_postgres.sql`) + public-only sample data dumps
 *    (`sql/sample_data_sqlite.sql`, `sql/sample_data_postgres.sql`).
 *  - Resets `admin` user password to `admin` (and `kyrpy` to `kyrpy123`) in the exported GitHub snapshot,
 *    removing any other user accounts or active sessions from the public export.
 *  - Exports ONLY `admin`'s public library (`visibility = 'public' AND project_id = 1 AND creator_id IN (1, 2)`),
 *    excluding all other edited data (`private` user-global items, `project`-specific items/projects, and non-admin items).
 */
import { scryptSync } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, healForeignKeys } from '../infrastructure/sqlite/database.js';
import { PG_SCHEMA_SQL } from '../infrastructure/postgres/pg-sync-service.js';
import { buildContainer } from '../composition-root.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const repoRoot = resolve(srcRoot, '..');
const dataDir = join(srcRoot, 'data');
const prodDbFile = process.env.PROD_DB_FILE || join(dataDir, 'designer.prod.db');
const publicDbFile = process.env.DB_FILE || join(dataDir, 'designer.db');
const tempExportDbFile = join(dataDir, 'designer.export.tmp.db');
const sqlDir = process.env.SQL_DIR || join(repoRoot, 'sql');

mkdirSync(dataDir, { recursive: true });
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

// 1. Ensure the live production database (`designer.prod.db`) exists and preserves all live WAL edits.
//    If `designer.prod.db` does not exist yet, snapshot `designer.db` (+ WAL) into `designer.prod.db` first.
if (!existsSync(prodDbFile) && existsSync(publicDbFile)) {
  const seedDb = openDatabase(publicDbFile);
  seedDb.exec(`VACUUM INTO '${prodDbFile.replace(/'/g, "''")}'`);
  seedDb.close();
}

const sourceDbFile = existsSync(prodDbFile) ? prodDbFile : publicDbFile;

// Ensure built-in themes (Dark & Light) and templates are seeded in the source DB without touching user items
{
  const container = buildContainer({ dbFile: sourceDbFile, syncEnabled: false });
  container.themes.seedBuiltins();
  container.templates.seedDefaults();
  container.close();
}

// 2. Snapshot `sourceDbFile` into `tempExportDbFile` so we NEVER mutate `designer.prod.db`!
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(`${tempExportDbFile}${suffix}`)) rmSync(`${tempExportDbFile}${suffix}`, { force: true });
}
{
  const liveDb = openDatabase(sourceDbFile);
  liveDb.exec(`VACUUM INTO '${tempExportDbFile.replace(/'/g, "''")}'`);
  liveDb.close();
}

// 3. Sanitize `tempExportDbFile` to contain ONLY admin's public library
const db = openDatabase(tempExportDbFile);

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN;');
try {
  const now = '2026-11-05 00:00:00';
  const kyrpyHash = hashPassword('kyrpy123', 'kyrpy_salt_v1');
  const adminHash = hashPassword('admin', 'admin_salt_v1');

  // 3a. Reset users to only default `kyrpy` (id=1) and `admin` (id=2, password 'admin')
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

  // 3b. Keep only Default Public Project (id=1) with default circle / 70% button settings
  db.exec('DELETE FROM projects WHERE id != 1;');
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, key, name, label, description, owner_id, visibility, require_approval, settings, created_at, updated_at)
    VALUES (1, 'default-project', 'Default Public Project', 'Default Public Project', 'Default workspace project containing public and shared UI/UX designs.', 1, 'public', 1, '{"buttonStyle":"circle","buttonIconSizePct":70}', ?, ?)
  `).run(now, now);

  db.exec('DELETE FROM project_members;');
  db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, invited_by, role, status, created_at, updated_at)
    VALUES (1, 1, 1, 1, 'owner', 'accepted', ?, ?),
           (2, 1, 2, 1, 'admin', 'accepted', ?, ?)
  `).run(now, now, now, now);

  // 3c. Keep ONLY admin's (`creator_id IN (1, 2)`) public library (`visibility = 'public' AND project_id = 1`).
  //     Exclude all private items, project-scoped items, non-default project items, and other users' edited items.
  const designTables = ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows'];
  for (const table of designTables) {
    db.exec(`
      DELETE FROM "${table}"
      WHERE visibility != 'public'
         OR visibility IS NULL
         OR COALESCE(project_id, 1) != 1
         OR COALESCE(creator_id, 1) NOT IN (1, 2)
         OR COALESCE(root_owner_id, 1) NOT IN (1, 2);
    `);
    db.exec(`
      UPDATE "${table}"
      SET project_id = 1,
          visibility = 'public',
          creator_id = 1,
          root_owner_id = 1,
          cloned_from_id = NULL,
          root_item_id = id;
    `);
  }

  // 3d. Clean up nodes, animations, menu_items, and workflow links belonging to excluded items
  db.exec(`
    DELETE FROM nodes WHERE owner_type = 'path' AND owner_id NOT IN (SELECT id FROM paths);
    DELETE FROM nodes WHERE owner_type = 'icon' AND owner_id NOT IN (SELECT id FROM icons);
    DELETE FROM nodes WHERE owner_type = 'button' AND owner_id NOT IN (SELECT id FROM buttons);
    DELETE FROM nodes WHERE owner_type = 'element' AND owner_id NOT IN (SELECT id FROM elements);
    DELETE FROM nodes WHERE owner_type = 'screen' AND owner_id NOT IN (SELECT id FROM screens);
    DELETE FROM animations WHERE node_id IS NOT NULL AND node_id NOT IN (SELECT id FROM nodes);
    DELETE FROM menu_items WHERE button_id NOT IN (SELECT id FROM buttons);
    UPDATE menu_items SET target_screen_id = NULL WHERE target_screen_id IS NOT NULL AND target_screen_id NOT IN (SELECT id FROM screens);
    UPDATE menu_items SET target_element_id = NULL WHERE target_element_id IS NOT NULL AND target_element_id NOT IN (SELECT id FROM elements);
    DELETE FROM workflow_screens WHERE workflow_id NOT IN (SELECT id FROM workflows) OR screen_id NOT IN (SELECT id FROM screens);
    DELETE FROM workflow_links WHERE workflow_id NOT IN (SELECT id FROM workflows) OR from_screen_id NOT IN (SELECT id FROM screens) OR to_screen_id NOT IN (SELECT id FROM screens);
  `);

  // 3e. Clear ephemeral / private collaboration & sync tables
  db.exec(`
    DELETE FROM change_requests;
    DELETE FROM sync_outbox;
    DELETE FROM sync_state;
    DELETE FROM trash_items;
  `);

  // 3f. Clean up orphaned translations
  for (const table of designTables) {
    db.exec(`DELETE FROM translations WHERE table_name = '${table}' AND record_id NOT IN (SELECT id FROM "${table}");`);
  }

  healForeignKeys(db);
  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  db.close();
  throw err;
}

db.exec('PRAGMA foreign_keys = ON;');
db.exec('VACUUM;');

// 4. Sync SQLite Schema (`sql/schema_sqlite.sql`) and Postgres Schema (`sql/schema_postgres.sql`)
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

// 5. Export Admin Public-Only Sample Data Dumps (`sql/sample_data_sqlite.sql` & `sql/sample_data_postgres.sql`)
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
  '-- Kyrpy UI/UX Designer — SQLite Sample Data Dump (Admin Public Library Only)',
  '-- =============================================================================',
  'PRAGMA foreign_keys = OFF;',
  'BEGIN TRANSACTION;'
];

const pgDump = [
  '-- =============================================================================',
  '-- Kyrpy UI/UX Designer — PostgreSQL Sample Database Dump (Admin Public Library Only)',
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

// 6. Close `tempExportDbFile` and write the clean public-only DB to `publicDbFile` (`src/data/designer.db`)
//    while leaving `prodDbFile` (`src/data/designer.prod.db`) 100% untouched!
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

for (const suffix of ['-wal', '-shm']) {
  if (existsSync(`${tempExportDbFile}${suffix}`)) rmSync(`${tempExportDbFile}${suffix}`, { force: true });
}

if (resolve(publicDbFile) !== resolve(sourceDbFile)) {
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${publicDbFile}${suffix}`)) rmSync(`${publicDbFile}${suffix}`, { force: true });
  }
  copyFileSync(tempExportDbFile, publicDbFile);
}
rmSync(tempExportDbFile, { force: true });

console.log('[db:export-public] Preserved live DB:', sourceDbFile);
console.log('[db:export-public] Exported admin public-only DB & schemas successfully:', JSON.stringify(counts));
