#!/usr/bin/env node
/**
 * Production-Safe Public Library & Schema Exporter (`npm run db:export-public`).
 *
 * MANDATORY RULE: the GitHub snapshot contains ONLY the public library of the immutable `public` system user
 * (domain/system-users.js) — never any other user's data.
 *
 *  - Never writes to the live database `src/data/designer.prod.db`: it is opened read-only and snapshotted with
 *    `VACUUM INTO`; all cleaning happens on a temporary copy.
 *  - Builds the GitHub-ready SQLite database `src/data/designer.db` and the synchronized SQL files
 *    (`sql/schema_sqlite.sql`, `sql/schema_postgres.sql`, `sql/sample_data_sqlite.sql`, `sql/sample_data_postgres.sql`).
 *  - Users in the snapshot: `kyrpy` (id 1, password reset to `kyrpy123`) and `admin` (id 2, password reset to `admin`)
 *    as bootstrap logins that own NO items, plus the `public` system user (its live id, empty password hash,
 *    `suspended`). Every other account, session and API key is dropped.
 *  - Design rows kept: `visibility = 'public' AND project_id = 1 AND creator_id = root_owner_id = <public user id>`.
 *    Owners are never rewritten; private / project items and public items of any other user are excluded.
 *  - Themes, device templates and button templates keep only their built-in seed rows (custom ones are dropped).
 *  - Hard leak assertions run before COMMIT: any design row not owned by `public` or not public, any non-built-in
 *    theme / template row, any extra user, or any session / API key / change request / trash row aborts the
 *    export (exit code 1, nothing written).
 *  - Aborts when the source has no `public` system user (open the app on it once so MCP migration m9-001 runs).
 *
 * Env overrides (tests): PROD_DB_FILE, DB_FILE, SQL_DIR.
 */
import { scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, healForeignKeys } from '../infrastructure/sqlite/database.js';
import { PG_SCHEMA_SQL } from '../infrastructure/postgres/pg-sync-service.js';
import { buildContainer } from '../composition-root.js';
import { PUBLIC_USERNAME, PUBLIC_EMAIL, PUBLIC_DISPLAY_NAME, PUBLIC_AVATAR_COLOR, DESIGN_TABLES } from '../domain/system-users.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const repoRoot = resolve(srcRoot, '..');
const dataDir = join(srcRoot, 'data');
const prodDbFile = resolve(process.env.PROD_DB_FILE || join(dataDir, 'designer.prod.db'));
const publicDbFile = resolve(process.env.DB_FILE || join(dataDir, 'designer.db'));
const tempExportDbFile = join(dirname(publicDbFile), 'designer.export.tmp.db');
const sqlDir = process.env.SQL_DIR || join(repoRoot, 'sql');

mkdirSync(dirname(publicDbFile), { recursive: true });
mkdirSync(sqlDir, { recursive: true });

function abort(message) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${tempExportDbFile}${suffix}`, { force: true });
  console.error(`[db:export-public] ABORTED: ${message}`);
  process.exit(1);
}

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

function sqlLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// 1. When `designer.prod.db` does not exist yet, snapshot `designer.db` (+ WAL) into it first.
if (!existsSync(prodDbFile) && existsSync(publicDbFile)) {
  const seedDb = openDatabase(publicDbFile);
  seedDb.exec(`VACUUM INTO '${prodDbFile.replace(/'/g, "''")}'`);
  seedDb.close();
}
const sourceDbFile = existsSync(prodDbFile) ? prodDbFile : publicDbFile;
if (!existsSync(sourceDbFile)) abort(`no source database (${prodDbFile} / ${publicDbFile})`);

// 2. Read the `public` system user from the source (read-only) and snapshot it into `tempExportDbFile`.
//    The source is NEVER opened for writing.
for (const suffix of ['', '-wal', '-shm']) rmSync(`${tempExportDbFile}${suffix}`, { force: true });
let srcPublic;
{
  const src = new DatabaseSync(sourceDbFile, { readOnly: true });
  try {
    srcPublic = src.prepare('SELECT id, username, password_hash, status, created_at FROM users WHERE username = ?').get(PUBLIC_USERNAME);
    if (!srcPublic) {
      abort(`the "${PUBLIC_USERNAME}" system user is missing in ${sourceDbFile}; start the app on that database once so MCP migration m9-001-public-user creates it and re-owns the public library`);
    }
    if (srcPublic.password_hash !== '' || srcPublic.status !== 'suspended') {
      abort(`user "${PUBLIC_USERNAME}" in ${sourceDbFile} is not the immutable system account (has a password or is not suspended)`);
    }
    src.exec(`VACUUM INTO '${tempExportDbFile.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
}
const PUB = Number(srcPublic.id);
if (PUB === 1 || PUB === 2) abort(`the "${PUBLIC_USERNAME}" user has id ${PUB}, which collides with the kyrpy/admin bootstrap ids`);

// Built-in themes and templates are seeded into the COPY (migrations run there too), never into the source.
{
  const container = buildContainer({ dbFile: tempExportDbFile, syncEnabled: false });
  container.themes.seedBuiltins();
  container.templates.seedDefaults();
  if (container.publicUserId() !== PUB) {
    container.close();
    abort(`public user id changed while migrating the snapshot (${PUB} -> ${container.publicUserId()})`);
  }
  container.close();
}

// 3. Sanitize `tempExportDbFile` so it holds ONLY the public user's public library
const db = openDatabase(tempExportDbFile);
const hasTable = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const columnsOf = t => db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
const designTables = DESIGN_TABLES;
/** Catalog tables exported only as their built-in seed rows (custom rows are user-authored). */
const CATALOG_TABLES = ['themes', 'template_devices', 'template_buttons'];

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN;');
try {
  const now = '2026-11-05 00:00:00';
  const kyrpyHash = hashPassword('kyrpy123', 'kyrpy_salt_v1');
  const adminHash = hashPassword('admin', 'admin_salt_v1');

  // 3a. Users: `kyrpy` (id=1) and `admin` (id=2) bootstrap logins with reset passwords, plus the `public`
  //     system user with its live id. No other account survives (the AI agent is re-created on first open).
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

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, salt, display_name, role, status, permissions, avatar_color, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, '', '', ?, 'viewer', 'suspended', '[]', ?, ?, ?, NULL)
  `).run(PUB, PUBLIC_USERNAME, PUBLIC_EMAIL, PUBLIC_DISPLAY_NAME, PUBLIC_AVATAR_COLOR, now, now);

// 3b. Keep only Default Public Project (id=1), preserving its live button style / icon size settings
  const liveProj1 = db.prepare('SELECT settings FROM projects WHERE id = 1').get();
  const proj1Settings = (liveProj1 && liveProj1.settings && liveProj1.settings !== '{}')
    ? liveProj1.settings
    : '{"buttonStyle":"circle","buttonIconSizePct":95}';
  db.exec('DELETE FROM projects WHERE id != 1;');
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, key, name, label, description, owner_id, visibility, require_approval, settings, created_at, updated_at)
    VALUES (1, 'default-project', 'Default Public Project', 'Default Public Project', 'Default workspace project containing public and shared UI/UX designs.', 1, 'public', 1, ?, ?, ?)
  `).run(proj1Settings, now, now);

  db.exec('DELETE FROM project_members;');
  db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, invited_by, role, status, created_at, updated_at)
    VALUES (1, 1, 1, 1, 'owner', 'accepted', ?, ?),
           (2, 1, 2, 1, 'admin', 'accepted', ?, ?)
  `).run(now, now, now, now);

  // 3c. Keep ONLY the `public` user's public library (`visibility = 'public' AND project_id = 1 AND
  //     creator_id = root_owner_id = <public>`). Private, project-scoped and other users' items are excluded.
  //     Owners are NOT rewritten; only lineage pointers to excluded rows are cut.
  for (const table of designTables) {
    db.prepare(`
      DELETE FROM "${table}"
      WHERE visibility IS NOT 'public'
         OR COALESCE(project_id, 1) != 1
         OR creator_id IS NOT ?
         OR root_owner_id IS NOT ?;
    `).run(PUB, PUB);
    db.exec(`UPDATE "${table}" SET cloned_from_id = NULL, root_item_id = id;`);
  }

  // 3c'. Catalog tables (themes, device / button templates) are kept only as their built-in seed rows:
  //      user-saved custom themes / templates (builtin = 0) are another user's data and are dropped BEFORE the
  //      seeded rows are attributed to the public user (so no custom row is ever re-attributed and published).
  for (const t of CATALOG_TABLES) {
    if (hasTable(t) && columnsOf(t).includes('builtin')) db.exec(`DELETE FROM "${t}" WHERE builtin IS NOT 1;`);
  }
  for (const t of ['template_devices', 'template_buttons']) {
    if (hasTable(t) && columnsOf(t).includes('created_by')) db.prepare(`UPDATE ${t} SET created_by = ?`).run(PUB);
  }
  // Instance settings may point at a dropped custom theme / device: fall back to the built-in defaults.
  if (hasTable('settings')) {
    const resetIfMissing = (key, table, fallback) => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!row) return;
      let v; try { v = JSON.parse(row.value); } catch { v = null; }
      if (typeof v !== 'string' || !db.prepare(`SELECT 1 FROM "${table}" WHERE key = ?`).get(v)) {
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(fallback), key);
      }
    };
    resetIfMissing('theme', 'themes', 'liquid');
    if (hasTable('template_devices')) resetIfMissing('device', 'template_devices', 'iphone-15');
    db.exec("DELETE FROM settings WHERE key = 'exportFolder';");
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

  // 3e'. MCP layer: keys, audit, versions, changesets, requests and bindings are private per instance;
  //      only the built-in (global, seed) AI pack templates and the schema registry are public.
  for (const t of ['api_keys', 'mcp_audit_log', 'changeset_ops', 'changesets', 'project_versions', 'item_requests', 'code_bindings', 'version_items']) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) db.exec(`DELETE FROM ${t};`);
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_artifacts'").get()) {
    db.exec("DELETE FROM ai_artifacts WHERE scope <> 'global' OR source <> 'seed';");
    if (columnsOf('ai_artifacts').includes('updated_by')) db.exec('UPDATE ai_artifacts SET updated_by = NULL;');
  }

  // 3f. Clean up orphaned translations: keep only rows of exported tables whose record survived (a translation
  //     keyed by any other table name cannot be attributed to the public library and is dropped).
  const translatable = [...designTables, ...CATALOG_TABLES].filter(hasTable);
  db.exec(`DELETE FROM translations WHERE table_name NOT IN (${translatable.map(t => `'${t}'`).join(', ')});`);
  for (const table of translatable) {
    db.exec(`DELETE FROM translations WHERE table_name = '${table}' AND record_id NOT IN (SELECT id FROM "${table}");`);
  }

  healForeignKeys(db);

  // 3g. HARD LEAK ASSERTIONS — the export must contain nothing but the public user's public library.
  const leaks = [];
  for (const table of designTables) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE creator_id IS NOT ? OR root_owner_id IS NOT ? OR visibility IS NOT 'public' OR COALESCE(project_id, 1) != 1`).get(PUB, PUB).n;
    if (n) leaks.push(`${n} ${table} row(s) not owned by "${PUBLIC_USERNAME}" or not public`);
  }
  for (const t of CATALOG_TABLES) {
    if (!hasTable(t)) continue;
    const cols = columnsOf(t);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE builtin IS NOT 1${cols.includes('created_by') ? ' OR created_by IS NOT ?' : ''}`)
      .get(...(cols.includes('created_by') ? [PUB] : [])).n;
    if (n) leaks.push(`${n} ${t} row(s) that are not built-in seed rows of "${PUBLIC_USERNAME}"`);
  }
  const strayTranslations = db.prepare(`SELECT COUNT(*) AS n FROM translations WHERE table_name NOT IN (${translatable.map(t => `'${t}'`).join(', ')})`).get().n;
  if (strayTranslations) leaks.push(`${strayTranslations} translation row(s) for non-exported tables`);
  const users = db.prepare('SELECT id, username, password_hash FROM users ORDER BY id').all();
  const expected = [`1:kyrpy`, `2:admin`, `${PUB}:${PUBLIC_USERNAME}`].sort().join(',');
  if (users.map(u => `${u.id}:${u.username}`).sort().join(',') !== expected) leaks.push(`users are [${users.map(u => u.username).join(', ')}], expected exactly kyrpy, admin, ${PUBLIC_USERNAME}`);
  if (users.some(u => u.username === PUBLIC_USERNAME && u.password_hash !== '')) leaks.push(`"${PUBLIC_USERNAME}" has a password hash`);
  for (const t of ['sessions', 'api_keys', 'change_requests', 'trash_items', 'mcp_audit_log', 'changesets', 'changeset_ops', 'item_requests', 'project_versions', 'version_items', 'code_bindings', 'sync_outbox']) {
    if (!hasTable(t)) continue;
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    if (n) leaks.push(`${n} row(s) left in ${t}`);
  }
  const otherProjects = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE id != 1').get().n;
  if (otherProjects) leaks.push(`${otherProjects} project(s) besides the default project`);
  const members = db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id NOT IN (1, 2) OR project_id != 1').get().n;
  if (members) leaks.push(`${members} project member row(s) for other users or projects`);
  if (leaks.length) throw new Error(`export leak check failed — ${leaks.join('; ')}`);

  db.exec('COMMIT;');
} catch (err) {
  try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
  db.close();
  abort(err.message);
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

// 5. Export the public-library-only sample data dumps (`sql/sample_data_sqlite.sql` & `sql/sample_data_postgres.sql`)
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
  '-- Kyrpy UI/UX Designer — SQLite Sample Data Dump (public system user library only)',
  '-- =============================================================================',
  'PRAGMA foreign_keys = OFF;',
  'BEGIN TRANSACTION;'
];

const pgDump = [
  '-- =============================================================================',
  '-- Kyrpy UI/UX Designer — PostgreSQL Sample Database Dump (public system user library only)',
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
console.log(`[db:export-public] Exported the "${PUBLIC_USERNAME}" user's public library (user id ${PUB}) & schemas successfully:`, JSON.stringify(counts));
