import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContainer } from '../composition-root.js';
import { PostgresSyncService, PG_SCHEMA_SQL } from '../infrastructure/postgres/pg-sync-service.js';
import { parseArgs, purgeToPublic, checkPublicDb, applyPublish, parsePgSchema } from '../scripts/publish-from-pg.js';

test('publish: argument parsing', () => {
  assert.deepEqual(parseArgs([]), { pushFirst: false, apply: false, keepClone: false, help: false, unknown: [] });
  const o = parseArgs(['--push-first', '--apply', '--bogus']);
  assert.ok(o.pushFirst && o.apply && !o.keepClone);
  assert.deepEqual(o.unknown, ['--bogus']);
});

test('publish: parsePgSchema reads tables and columns from PG_SCHEMA_SQL', () => {
  const s = parsePgSchema();
  assert.ok(s.users.includes('username') && s.users.includes('password_hash'));
  assert.ok(!s.users.includes('PRIMARY'));
  assert.ok(Object.keys(s).length >= 20);
  assert.ok(PG_SCHEMA_SQL.includes('CREATE TABLE'));
});

function seeded(dir) {
  const file = join(dir, 'clone.db');
  const c = buildContainer({ dbFile: file, syncEnabled: false });
  const pubId = c.publicUserId();
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const now = '2026-01-01 00:00:00';
  const ins = (key, vis, owner) => c.db.prepare(
    `INSERT INTO icons (key, name, visibility, project_id, creator_id, root_owner_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(key, key, vis, owner, owner, now, now);
  ins('pub-icon', 'public', pubId);
  ins('ada-private', 'private', ada.user.id);
  ins('ada-public', 'public', ada.user.id);
  c.db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('t', ?, ?, ?)`).run(ada.user.id, now, now);
  return { c, pubId };
}

test('publish: purgeToPublic keeps only the public user data and checkPublicDb flags leaks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  try {
    const { c, pubId } = seeded(dir);
    const before = c.db.prepare('SELECT COUNT(*) AS n FROM icons').get().n;
    assert.ok(before >= 3);
    assert.equal(purgeToPublic(c.db), pubId);
    const keys = c.db.prepare('SELECT key FROM icons').all().map(r => r.key);
    assert.deepEqual(keys, ['pub-icon']);
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'ada'").get().n, 0);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publish: checkPublicDb reports a leak in a non-exported database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  try {
    const { c } = seeded(dir);
    c.close();
    const problems = checkPublicDb(join(dir, 'clone.db'));
    assert.ok(problems.length > 0);
    assert.ok(problems.some(p => p.includes('users')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publish: applyPublish copies the db and sql files to the targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  try {
    mkdirSync(join(dir, 'p', 'sql'), { recursive: true });
    writeFileSync(join(dir, 'p', 'designer.db'), 'DB');
    writeFileSync(join(dir, 'p', 'sql', 'schema_postgres.sql'), 'SQL');
    const copied = applyPublish({ publishDir: join(dir, 'p'), dbTarget: join(dir, 'out', 'data', 'designer.db'), sqlTarget: join(dir, 'out', 'sql') });
    assert.equal(copied.length, 2);
    assert.equal(readFileSync(join(dir, 'out', 'data', 'designer.db'), 'utf8'), 'DB');
    assert.ok(existsSync(join(dir, 'out', 'sql', 'schema_postgres.sql')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publish: db:publish dry run against live PG (skipped when unreachable)', async t => {
  const probe = new PostgresSyncService({ db: buildContainer({ dbFile: ':memory:', syncEnabled: false }).db });
  if (!probe.enabled) return t.skip('PostgreSQL not configured');
  if (!probe.execPg('SELECT 1;', { tuplesOnly: true, timeoutMs: 4000 }).ok) return t.skip('PostgreSQL not reachable');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'pub-'));
  try {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/publish-from-pg.js'], {
      encoding: 'utf8', timeout: 120000, env: { ...process.env, PUBLISH_DIR: join(dir, 'publish') }
    });
    // an empty/new PG without the public user aborts cleanly; otherwise the leak check must pass
    if (r.status !== 0) return assert.match(r.stderr, /ABORTED/);
    assert.match(r.stdout, /leak check OK/);
    assert.equal(checkPublicDb(join(dir, 'publish', 'designer.db')).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
