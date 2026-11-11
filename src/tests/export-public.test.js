/**
 * `npm run db:export-public` must publish ONLY the immutable `public` system user's public library:
 * users kyrpy / admin (bootstrap logins, no items) + public, no other user's data, and the live DB untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildContainer } from '../composition-root.js';
import { DESIGN_TABLES } from '../domain/system-users.js';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'export-public-db.js');
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');

function buildProdDb(file) {
  const c = buildContainer({ dbFile: file, syncEnabled: false });
  const pub = c.publicUserId();
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'bobsecret1' }).user;
  const kyrpy = c.users.findByUsernameOrEmail('superadmin');

  // public library items (admin-made public items of project 1 belong to `public`)
  const pubIcon = c.icon.create({ name: 'Library Icon', visibility: 'public' }, { actorId: kyrpy.id });
  const pubWf = c.workflows.create({ name: 'Library Flow', visibility: 'public' }, { actorId: kyrpy.id });
  // bob's items: public (project 1), private and project-scoped
  const bobPublic = c.icon.create({ name: 'Bob Public Icon', visibility: 'public' }, { actorId: bob.id });
  c.button.create({ name: 'Bob Private Button', visibility: 'private' }, { actorId: bob.id });
  const bobProj = c.projects.create({ name: 'Bob Secret Project', visibility: 'private' }, { actor: bob });
  c.screen.create({ name: 'Bob Project Screen', visibility: 'project', projectId: bobProj.id }, { actorId: bob.id });
  // kyrpy's own non-library items
  c.element.create({ name: 'Kyrpy Private Element', visibility: 'private' }, { actorId: kyrpy.id });
  c.path.create({ name: 'Kyrpy Project Path', visibility: 'project' }, { actorId: kyrpy.id });
  // a change request (kyrpy edits bob's public icon), a trashed item and an API key
  c.icon.update(bobPublic.id, { label: 'edited by kyrpy' }, { actorId: kyrpy.id });
  const doomed = c.icon.create({ name: 'Bob Doomed Icon', visibility: 'private' }, { actorId: bob.id });
  c.icon.remove(doomed.id, { actor: bob });
  c.mcp.apiKeys.create({ name: 'bob-key', projectId: bobProj.id }, bob);
  // user-saved custom catalog rows (builtin = 0) — must never be published (nor re-attributed to `public`)
  c.templates.createDevice({ name: 'Bob Custom Phone', width: 400, height: 800 });
  c.templates.createButton({ name: 'Bob Custom Button' });
  const bobTheme = c.themes.clone(c.themes.list()[0].id, 'Bob Custom Theme');
  c.settings.update({ theme: bobTheme.key, device: 'bob-custom-phone', exportFolder: '/home/bob/exports' });
  c.translations.upsert({ tableName: 'template_devices', recordId: c.templates.listDevices().find(d => d.key === 'bob-custom-phone').id, fieldName: 'name', langCode: 'fi', translatedText: 'Bobin puhelin' });
  c.translations.upsert({ tableName: 'bob_notes', recordId: 1, fieldName: 'label', langCode: 'en', translatedText: 'bob stray' });
  c.close();
  return { pub, pubIcon, pubWf };
}

test('export-public-db exports only the public user library and never touches the live DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-public-'));
  try {
    const prod = join(dir, 'designer.prod.db');
    const out = join(dir, 'designer.db');
    const sqlDir = join(dir, 'sql');
    const { pub, pubIcon, pubWf } = buildProdDb(prod);
    for (const s of ['-wal', '-shm']) rmSync(prod + s, { force: true });
    const before = sha(prod);

    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
      env: { ...process.env, PROD_DB_FILE: prod, DB_FILE: out, SQL_DIR: sqlDir, PG_SYNC_ENABLED: 'false' },
      stdio: 'pipe'
    });

    assert.equal(sha(prod), before, 'the live DB is byte-for-byte unchanged');
    assert.ok(!existsSync(join(dir, 'designer.export.tmp.db')), 'temporary export DB removed');

    const db = new DatabaseSync(out, { readOnly: true });
    try {
      const users = db.prepare('SELECT id, username, password_hash, status FROM users ORDER BY id').all();
      assert.deepEqual(users.map(u => u.username).sort(), ['admin', 'public', 'superadmin', 'user']);
      const p = users.find(u => u.username === 'public');
      assert.equal(p.id, pub, 'public user keeps its live id');
      assert.equal(p.password_hash, '');
      assert.equal(p.status, 'suspended');
      assert.equal(users.find(u => u.username === 'superadmin').id, 1);
      assert.equal(users.find(u => u.username === 'admin').id, 2);

      for (const t of DESIGN_TABLES) {
        const bad = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE creator_id IS NOT ? OR root_owner_id IS NOT ? OR visibility IS NOT 'public' OR project_id != 1`).get(pub, pub).n;
        assert.equal(bad, 0, `${t}: only public-user public rows`);
      }
      assert.ok(db.prepare('SELECT 1 FROM icons WHERE id = ?').get(pubIcon.id), 'library icon exported');
      assert.ok(db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(pubWf.id), 'library workflow exported');
      for (const t of ['sessions', 'api_keys', 'change_requests', 'trash_items']) {
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} empty`);
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
      for (const t of ['themes', 'template_devices', 'template_buttons']) {
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE builtin IS NOT 1`).get().n, 0, `${t}: only built-in rows`);
        assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0, `${t}: built-in rows kept`);
      }
      for (const t of ['template_devices', 'template_buttons']) {
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE created_by IS NOT ?`).get(pub).n, 0, `${t}: attributed to public`);
      }
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, JSON.parse(r.value)]));
      assert.equal(settings.theme, 'liquid', 'settings.theme falls back to a built-in theme');
      assert.equal(settings.device, 'iphone-15', 'settings.device falls back to a built-in device');
      assert.ok(!('exportFolder' in settings), 'local export folder dropped');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM translations WHERE translated_text LIKE '%bob%' OR table_name = 'bob_notes'").get().n, 0, 'no stray translations');
      const names = DESIGN_TABLES.flatMap(t => db.prepare(`SELECT name FROM ${t}`).all().map(r => r.name));
      assert.ok(!names.some(n => /bob|kyrpy private|kyrpy project/i.test(n)), `no foreign items: ${names.join(', ')}`);
    } finally {
      db.close();
    }

    for (const f of readdirSync(sqlDir).filter(f => f.startsWith('sample_data_'))) {
      const text = readFileSync(join(sqlDir, f), 'utf8');
      assert.ok(!/bob/i.test(text), `${f} mentions no other user`);
    }
    assert.ok(!/bob/i.test(readFileSync(out).toString('latin1')), 'no residue of bob in the exported DB file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export-public-db aborts when the source has no public system user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-public-'));
  try {
    const prod = join(dir, 'designer.prod.db');
    const c = buildContainer({ dbFile: prod, syncEnabled: false });
    c.db.exec("DELETE FROM users WHERE username = 'public'");
    c.close();
    for (const s of ['-wal', '-shm']) rmSync(prod + s, { force: true });
    const before = sha(prod);
    assert.throws(() => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
      env: { ...process.env, PROD_DB_FILE: prod, DB_FILE: join(dir, 'designer.db'), SQL_DIR: join(dir, 'sql') },
      stdio: 'pipe'
    }), err => /public.*system user is missing/.test(String(err.stderr)));
    assert.equal(sha(prod), before);
    assert.ok(!existsSync(join(dir, 'designer.db')), 'nothing exported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
