#!/usr/bin/env node
/**
 * PostgreSQL-primary publisher (`npm run db:publish`).
 *
 * MANDATORY RULE: PostgreSQL is the PRIMARY database for publishing. The GitHub snapshot is built from a clone of
 * the PG schema/data, never from the live SQLite file, and contains ONLY the immutable `public` user's data.
 *
 * Steps: [--push-first] push live SQLite -> PG; verify PG is reachable (abort otherwise, no SQLite fallback);
 * clone PG into a throwaway SQLite DB inside `publish/` (pull is SELECT-only; PG is never altered); purge it to the
 * public user's data; run scripts/export-public-db.js on the clone (all its leak assertions) writing
 * `publish/designer.db` + `publish/sql/*.sql`; re-run the leak check on `publish/`; with --apply copy them to
 * `src/data/designer.db` and `sql/`. Without --apply it only prepares `publish/` (dry run).
 *
 * Flags: --push-first  --apply  --keep-clone  --help. Env: PROD_DB_FILE (live DB used by --push-first),
 * PUBLISH_DIR (default <repo>/publish), PUBLISH_APPLY_DB, PUBLISH_APPLY_SQL (apply targets; tests).
 * Credentials are read by PostgresSyncService (env / credentials file) and are never printed.
 */
import { DEFAULT_ACCOUNTS, verifyPassword } from '../application/passwords.js';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../infrastructure/sqlite/database.js';
import { dropOutboxTriggers } from '../infrastructure/sqlite/outbox-triggers.js';
import { PostgresSyncService, PG_SCHEMA_SQL } from '../infrastructure/postgres/pg-sync-service.js';
import { buildContainer } from '../composition-root.js';
import { PUBLIC_USERNAME, DESIGN_TABLES } from '../domain/system-users.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const repoRoot = resolve(srcRoot, '..');
const TAG = '[db:publish]';
const PRIVATE_TABLES = ['sessions', 'api_keys', 'change_requests', 'trash_items', 'mcp_audit_log', 'changeset_ops', 'changesets', 'project_versions', 'item_requests', 'code_bindings', 'version_items', 'design_focus', 'sync_outbox'];

export function parseArgs(argv) {
  const opts = { pushFirst: false, apply: false, keepClone: false, help: false, unknown: [] };
  for (const a of argv) {
    if (a === '--push-first') opts.pushFirst = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--keep-clone') opts.keepClone = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.unknown.push(a);
  }
  return opts;
}

const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

/** Deletes everything that is not the `public` user's public library (+ bootstrap logins). Returns the public id. */
export function purgeToPublic(db) {
  const pub = db.prepare('SELECT id FROM users WHERE username = ?').get(PUBLIC_USERNAME);
  if (!pub) throw new Error(`the "${PUBLIC_USERNAME}" system user is missing in the PostgreSQL clone`);
  const PUB = Number(pub.id);
  dropOutboxTriggers(db);   // the purge is not a change to sync
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    for (const t of DESIGN_TABLES) {
      if (!hasTable(db, t)) continue;
      db.prepare(`DELETE FROM "${t}" WHERE visibility IS NOT 'public' OR COALESCE(project_id, 1) != 1 OR creator_id IS NOT ? OR root_owner_id IS NOT ?`).run(PUB, PUB);
    }
    for (const t of PRIVATE_TABLES) if (hasTable(db, t)) db.exec(`DELETE FROM "${t}";`);
    db.prepare('DELETE FROM users WHERE username NOT IN (?, ?, ?, ?, ?)').run('superadmin', 'kyrpy', 'admin', 'user', PUBLIC_USERNAME);
    if (hasTable(db, 'projects')) db.exec('DELETE FROM projects WHERE id != 1;');
    if (hasTable(db, 'project_members')) db.exec('DELETE FROM project_members WHERE project_id != 1 OR user_id NOT IN (SELECT id FROM users);');
    db.exec('COMMIT;');
  } catch (e) {
    try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return PUB;
}

/** The SKILL.md leak query in JS. Returns a list of problems (empty = OK). */
export function checkPublicDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const problems = [];
  try {
    const n = sql => db.prepare(sql).get().n;
    const names = db.prepare('SELECT username FROM users ORDER BY username').all().map(r => r.username).join(',');
    if (names !== 'admin,public,superadmin,user') problems.push(`users are [${names}], expected exactly superadmin, admin, user, public`);
    // publish rule: the shipped accounts always carry the documented default passwords (superadmin/superadmin, admin/admin, user/user)
    for (const a of DEFAULT_ACCOUNTS) {
      const r = db.prepare('SELECT password_hash, salt FROM users WHERE username = ?').get(a.username);
      if (!r || !verifyPassword(a.password, r.password_hash, r.salt)) problems.push(`user "${a.username}" does not have the default published password`);
    }
    if (n(`SELECT COUNT(*) AS n FROM users WHERE username = 'public' AND password_hash = '' AND status = 'suspended'`) !== 1) problems.push('public user is not the suspended passwordless system account');
    const pubId = `(SELECT id FROM users WHERE username = 'public')`;
    const designs = DESIGN_TABLES.filter(t => hasTable(db, t)).map(t => `SELECT creator_id, root_owner_id, visibility, project_id FROM ${t}`).join(' UNION ALL ');
    if (n(`SELECT COUNT(*) AS n FROM (${designs}) d WHERE d.visibility IS NOT 'public' OR d.project_id != 1 OR d.creator_id IS NOT ${pubId} OR d.root_owner_id IS NOT ${pubId}`)) problems.push('design rows not owned by public / not public');
    for (const t of PRIVATE_TABLES) if (hasTable(db, t) && n(`SELECT COUNT(*) AS n FROM ${t}`)) problems.push(`rows left in ${t}`);
    // the public library is generic: app-specific (Untrap) names must live in the owner's own projects
    for (const t of DESIGN_TABLES) if (hasTable(db, t) && n(`SELECT COUNT(*) AS n FROM ${t} WHERE key LIKE '%untrap%' OR name LIKE '%untrap%' OR label LIKE '%untrap%' OR description_dev LIKE '%untrap%'`)) problems.push(`app-specific "untrap" content in public ${t}`);
    if (n('SELECT COUNT(*) AS n FROM themes WHERE builtin IS NOT 1')) problems.push('custom themes');
    for (const t of ['template_devices', 'template_buttons']) {
      if (n(`SELECT COUNT(*) AS n FROM ${t} WHERE builtin IS NOT 1 OR created_by IS NOT ${pubId}`)) problems.push(`non-built-in ${t}`);
    }
    const tr = [...DESIGN_TABLES, 'themes', 'template_devices', 'template_buttons'].map(t => `'${t}'`).join(',');
    if (n(`SELECT COUNT(*) AS n FROM translations WHERE table_name NOT IN (${tr})`)) problems.push('stray translations');
  } finally {
    db.close();
  }
  return problems;
}

/** Copies the prepared publish outputs to the tracked paths. Returns the copied files. */
export function applyPublish({ publishDir, dbTarget, sqlTarget }) {
  const copied = [];
  mkdirSync(dirname(dbTarget), { recursive: true });
  mkdirSync(sqlTarget, { recursive: true });
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbTarget}${suffix}`, { force: true });
  copyFileSync(join(publishDir, 'designer.db'), dbTarget);
  copied.push(dbTarget);
  const sqlSrc = join(publishDir, 'sql');
  for (const f of readdirSync(sqlSrc).filter(f => f.endsWith('.sql'))) {
    copyFileSync(join(sqlSrc, f), join(sqlTarget, f));
    copied.push(join(sqlTarget, f));
  }
  return copied;
}

/** Expected tables/columns of PG_SCHEMA_SQL (top-level comma split of each CREATE TABLE body). */
export function parsePgSchema(sql = PG_SCHEMA_SQL) {
  const out = {};
  const re = /CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?\s*\(/g;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1, i = re.lastIndex, start = i;
    const parts = [];
    for (; i < sql.length && depth > 0; i++) {
      const c = sql[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) parts.push(sql.slice(start, i)); }
      else if (c === ',' && depth === 1) { parts.push(sql.slice(start, i)); start = i + 1; }
    }
    out[m[1]] = parts.map(p => p.replace(/--.*$/gm, '').trim()).filter(p => p && !/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)\b/i.test(p)).map(p => p.split(/\s+/)[0].replace(/"/g, ''));
  }
  return out;
}

/** Compares the live PG schema to PG_SCHEMA_SQL (read-only). Returns missing 'table' / 'table.column' names. */
export function pgSchemaDrift(svc) {
  const res = svc.execPg(`SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = current_schema();`, { tuplesOnly: true, timeoutMs: 15000 });
  if (!res.ok) return { ok: false, error: res.error, missing: [] };
  const live = new Set(res.stdout.split('\n').map(s => s.trim()).filter(Boolean));
  const liveTables = new Set([...live].map(s => s.split('.')[0]));
  const missing = [];
  for (const [t, cols] of Object.entries(parsePgSchema())) {
    if (!liveTables.has(t)) { missing.push(t); continue; }
    for (const c of cols) if (!live.has(`${t}.${c}`)) missing.push(`${t}.${c}`);
  }
  return { ok: true, missing };
}

const sizeKb = f => `${(statSync(f).size / 1024).toFixed(0)} KiB`;
function fail(msg) { console.error(`${TAG} ABORTED: ${msg}`); process.exit(1); }

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: npm --prefix src run db:publish -- [--push-first] [--apply] [--keep-clone]');
    return;
  }
  if (opts.unknown.length) fail(`unknown argument(s): ${opts.unknown.join(' ')}`);
  const publishDir = resolve(process.env.PUBLISH_DIR || join(repoRoot, 'publish'));
  const liveDbFile = resolve(process.env.PROD_DB_FILE || join(srcRoot, 'data', 'designer.prod.db'));
  const cloneFile = join(publishDir, 'pg-clone.tmp.db');
  const outDb = join(publishDir, 'designer.db');
  const outSql = join(publishDir, 'sql');

  // a. PG must be reachable; no silent SQLite fallback.
  const probeDb = openDatabase(':memory:');
  const probe = new PostgresSyncService({ db: probeDb });
  if (!probe.enabled) fail('PostgreSQL is not configured (PGHOST / credentials); publishing requires PostgreSQL as the primary database');
  const ping = probe.execPg('SELECT 1;', { tuplesOnly: true, timeoutMs: 5000 });
  probeDb.close();
  if (!ping.ok) fail(`PostgreSQL is not reachable: ${String(ping.error).split('\n')[0]}`);

  // b. optional push of the live SQLite -> PG (only mutation: pushToPostgres marks outbox rows synced in the live DB)
  if (opts.pushFirst) {
    if (!existsSync(liveDbFile)) fail(`--push-first: live DB not found: ${liveDbFile}`);
    console.log(`${TAG} --push-first: pushing live SQLite ${liveDbFile} -> PostgreSQL (full push; marks outbox rows synced)`);
    const live = openDatabase(liveDbFile);
    const pushed = new PostgresSyncService({ db: live }).pushToPostgres({ force: process.argv.includes('--force-push') });
    live.close();
    if (!pushed.ok) fail(`push failed: ${String(pushed.error).split('\n')[0]}`);
  } else {
    console.log(`${TAG} no --push-first: PostgreSQL is cloned as it is (the live SQLite may be ahead)`);
  }

  // schema drift (read-only report)
  const checker = new PostgresSyncService({ db: openDatabase(':memory:') });
  const drift = pgSchemaDrift(checker);
  if (!drift.ok) console.warn(`${TAG} WARNING: schema drift check failed: ${String(drift.error).split('\n')[0]}`);
  else if (drift.missing.length) console.warn(`${TAG} WARNING: live PG schema is missing vs PG_SCHEMA_SQL (not altered): ${drift.missing.join(', ')}`);
  else console.log(`${TAG} PG schema matches PG_SCHEMA_SQL (every table/column present)`);
  checker.db.close();

  // c. clone PG into a throwaway SQLite DB inside a freshly emptied publish/
  rmSync(publishDir, { recursive: true, force: true });
  mkdirSync(outSql, { recursive: true });
  const container = buildContainer({ dbFile: cloneFile, syncEnabled: false });
  const svc = new PostgresSyncService({ db: container.db });
  svc.schemaInitialized = true;   // skip the DDL step of ensureRemoteDatabase: the pull is SELECT-only
  const pulled = svc.pullFromPostgres();
  if (!pulled.ok) { container.close(); rmSync(publishDir, { recursive: true, force: true }); fail(`PG pull failed: ${String(pulled.error).split('\n')[0]}`); }
  try { purgeToPublic(container.db); } catch (e) { container.close(); rmSync(publishDir, { recursive: true, force: true }); fail(e.message); }
  container.close();
  console.log(`${TAG} cloned PostgreSQL -> ${cloneFile} and purged to the "${PUBLIC_USERNAME}" user's data`);

  // d. existing exporter on the clone (all its leak assertions)
  const exp = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'export-public-db.js')], {
    stdio: 'inherit', env: { ...process.env, PROD_DB_FILE: cloneFile, DB_FILE: outDb, SQL_DIR: outSql }
  });
  for (const s of ['', '-wal', '-shm']) if (!opts.keepClone) rmSync(`${cloneFile}${s}`, { force: true });
  if (exp.status !== 0) { rmSync(publishDir, { recursive: true, force: true }); fail('export-public-db.js failed'); }

  // e. leak check on publish/ (drop the throwaway pepper / WAL files so only the DB + sql remain)
  for (const f of ['mcp-key-pepper', 'designer.db-wal', 'designer.db-shm']) rmSync(join(publishDir, f), { force: true });
  const problems = checkPublicDb(outDb);
  if (problems.length) { rmSync(publishDir, { recursive: true, force: true }); fail(`leak check failed on publish/: ${problems.join('; ')}`); }
  const db = new DatabaseSync(outDb, { readOnly: true });
  const counts = Object.fromEntries(['users', ...DESIGN_TABLES, 'themes', 'template_devices', 'template_buttons'].filter(t => hasTable(db, t)).map(t => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  db.close();
  for (const f of ['designer.db-wal', 'designer.db-shm']) rmSync(join(publishDir, f), { force: true });
  console.log(`${TAG} leak check OK. rows: ${JSON.stringify(counts)}`);
  console.log(`${TAG} publish/designer.db ${sizeKb(outDb)}; sql: ${readdirSync(outSql).map(f => `${f} ${sizeKb(join(outSql, f))}`).join(', ')}`);

  if (opts.apply) {
    const copied = applyPublish({ publishDir, dbTarget: process.env.PUBLISH_APPLY_DB || join(srcRoot, 'data', 'designer.db'), sqlTarget: process.env.PUBLISH_APPLY_SQL || join(repoRoot, 'sql') });
    console.log(`${TAG} --apply: copied ${copied.length} file(s): ${copied.join(', ')}`);
  } else {
    console.log(`${TAG} dry run: tracked files untouched (use --apply to copy publish/ -> src/data/designer.db and sql/)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
