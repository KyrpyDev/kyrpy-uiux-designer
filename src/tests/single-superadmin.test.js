import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const fresh = () => buildContainer({ dbFile: ':memory:' });
const u = (c, name) => c.users.findByUsernameOrEmail(name);
const supers = c => c.users.list().filter(x => x.role === 'superadmin');

test('fresh install: kyrpy is the one superadmin, admin is a plain admin; isSuperadmin gates', () => {
  const c = fresh();
  assert.deepEqual(supers(c).map(x => x.username), ['superadmin']);
  assert.equal(u(c, 'admin').role, 'admin');
  assert.equal(c.auth.isSuperadmin(u(c, 'superadmin')), true);
  assert.equal(c.auth.isSuperadmin(u(c, 'admin')), false);
  assert.equal(c.auth.isAdmin(u(c, 'admin')), true, 'admin stays an admin for user / project management');
  assert.equal(c.auth.isSuperadmin(u(c, 'public')), false);
  assert.equal(c.auth.isSuperadmin(null), false);
  assert.equal(c.auth.devBypassLogin().user.username, 'superadmin', 'dev bypass signs in as the superadmin');
  c.close();
});

test('superadmin edits public items directly; admin files a change request; admin cannot trash library items', () => {
  const c = fresh();
  const kyrpy = u(c, 'superadmin'), admin = u(c, 'admin');
  const pub = c.publicUserId();
  const icon = c.icon.create({ name: 'Sa Icon', visibility: 'public' }, { actor: kyrpy });
  const btn = c.button.create({ name: 'Sa Button', visibility: 'public' }, { actor: kyrpy });
  assert.equal(icon.creatorId, pub);
  const pending = () => c.collaboration.list({ status: 'pending' });
  const upd = c.icon.update(icon.id, { label: 'direct' }, { actorId: kyrpy.id });
  c.button.update(btn.id, { label: 'direct' }, { actorId: kyrpy.id });
  assert.equal(upd.label, 'direct');
  assert.equal(upd.creatorId, pub, 'item stays owned by the public user');
  assert.equal(pending().length, 0);

  c.icon.update(icon.id, { label: 'admin proposal' }, { actorId: admin.id });
  assert.equal(pending().length, 1, 'admin edit of a public item goes through approval');
  c.button.update(btn.id, { label: 'admin proposal' }, { actorId: admin.id });
  assert.equal(pending().length, 2);

  assert.throws(() => c.icon.remove(icon.id, { actor: admin }), e => e.name === 'ForbiddenError');
  assert.doesNotThrow(() => c.icon.remove(icon.id, { actor: kyrpy }));
  const trashed = c.trash.list({ itemType: 'icon' })[0];
  assert.throws(() => c.trash.purge(trashed.id, { actor: admin }), e => e.name === 'NotFoundError', "another user's trash is invisible, so it cannot be purged");
  assert.equal(c.trash.purge(trashed.id, { actor: kyrpy }).purged, true);
  // an admin may still trash their own public (non-library) items
  const own = c.icon.create({ name: 'Admin Own', visibility: 'public' }, { actorId: admin.id });
  assert.equal(own.creatorId, admin.id);
  assert.doesNotThrow(() => c.icon.remove(own.id, { actor: admin }));
  c.close();
});

test('there can be only one superadmin (service and DB index)', () => {
  const c = fresh();
  const kyrpy = u(c, 'superadmin'), admin = u(c, 'admin');
  assert.throws(() => c.auth.createUserByAdmin(kyrpy, { username: 'second', role: 'superadmin' }), /only one superadmin/);
  assert.throws(() => c.auth.updateUser(admin.id, { role: 'superadmin' }, kyrpy), /only one superadmin/);
  const reg = c.auth.register({ username: 'sneaky', email: 'sneaky@example.com', password: 'secret123', role: 'superadmin' });
  assert.equal(reg.user.role, 'designer', 'registration never yields a superadmin');
  assert.equal(supers(c).length, 1);
  // DB level
  assert.throws(() => c.db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(admin.id), /UNIQUE|constraint/i);
  c.close();
});

test('the superadmin cannot be deleted, suspended or demoted, not even by themselves; admins cannot touch them', () => {
  const c = fresh();
  const kyrpy = u(c, 'superadmin'), admin = u(c, 'admin');
  assert.throws(() => c.auth.deleteUser(kyrpy, kyrpy.id));
  assert.throws(() => c.auth.updateUser(kyrpy.id, { status: 'suspended' }, kyrpy), /suspended/);
  assert.throws(() => c.auth.updateUser(kyrpy.id, { role: 'admin' }, kyrpy), /superadmin/);
  assert.throws(() => c.auth.updateUser(kyrpy.id, { role: 'designer' }, kyrpy));
  assert.throws(() => c.auth.updateUser(kyrpy.id, { displayName: 'x' }, admin), e => e.name === 'ForbiddenError');
  assert.throws(() => c.auth.deleteUser(admin, kyrpy.id));
  assert.equal(u(c, 'superadmin').role, 'superadmin');
  c.close();
});

test('transfer: needs the superadmin and password/confirm, moves the role atomically, old one becomes admin', () => {
  const c = fresh();
  const kyrpy = u(c, 'superadmin'), admin = u(c, 'admin');
  const dana = c.auth.register({ username: 'dana', email: 'dana@example.com', password: 'secret123' }).user;
  assert.throws(() => c.auth.transferSuperadmin(admin, dana.id, { confirm: true }), e => e.name === 'ForbiddenError');
  assert.throws(() => c.auth.transferSuperadmin(kyrpy, dana.id, {}), /password/i);
  assert.throws(() => c.auth.transferSuperadmin(kyrpy, dana.id, { password: 'wrong-password' }), /incorrect/);
  assert.throws(() => c.auth.transferSuperadmin(kyrpy, kyrpy.id, { confirm: true }), /already/);
  assert.throws(() => c.auth.transferSuperadmin(kyrpy, c.publicUserId(), { confirm: true }), e => e.name === 'ForbiddenError');
  c.auth.updateUser(dana.id, { status: 'suspended' }, kyrpy);
  assert.throws(() => c.auth.transferSuperadmin(kyrpy, dana.id, { confirm: true }), /active/);
  c.auth.updateUser(dana.id, { status: 'active' }, kyrpy);

  const r = c.auth.transferSuperadmin(kyrpy, dana.id, { password: 'superadmin' });
  assert.equal(r.transferred, true);
  assert.deepEqual(supers(c).map(x => x.username), ['dana']);
  assert.equal(u(c, 'superadmin').role, 'admin');
  // the new superadmin now curates directly, the old one no longer does
  const icon = c.icon.create({ name: 'After Transfer', visibility: 'public' }, { actorId: dana.id });
  assert.equal(icon.creatorId, c.publicUserId());
  c.icon.update(icon.id, { label: 'dana direct' }, { actorId: dana.id });
  assert.equal(c.collaboration.list({ status: 'pending' }).length, 0);
  c.icon.update(icon.id, { label: 'kyrpy proposal' }, { actorId: kyrpy.id });
  assert.equal(c.collaboration.list({ status: 'pending' }).length, 1);
  c.close();
});

test('migration m12 promotes kyrpy on a legacy DB, demotes the legacy installer superadmin and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-mig-'));
  const file = join(dir, 'legacy.db');
  try {
    let c = buildContainer({ dbFile: file });
    c.close();
    // rewind to the pre-superadmin state: kyrpy + admin are both plain admins, no index, migration not recorded
    let raw = new DatabaseSync(file);
    raw.exec("DROP INDEX ux_users_single_superadmin; UPDATE users SET role = 'admin'; DELETE FROM mcp_migrations WHERE id = 'm12-001-single-superadmin'");
    raw.close();
    c = buildContainer({ dbFile: file });
    assert.deepEqual(supers(c).map(x => x.username), ['superadmin']);
    assert.equal(u(c, 'admin').role, 'admin');
    assert.ok(c.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ux_users_single_superadmin'").get(), 'partial unique index exists');
    c.close();
    // reopen: nothing changes
    c = buildContainer({ dbFile: file });
    assert.deepEqual(supers(c).map(x => x.username), ['superadmin']);
    c.close();
    // older installs: the installer account `admin` was the superadmin and kyrpy a plain admin (prod shape) -> kyrpy takes over
    raw = new DatabaseSync(file);
    raw.exec("DROP INDEX ux_users_single_superadmin; UPDATE users SET role = 'admin' WHERE id = 1; UPDATE users SET role = 'superadmin' WHERE username = 'admin'; DELETE FROM mcp_migrations WHERE id = 'm12-001-single-superadmin'");
    raw.close();
    c = buildContainer({ dbFile: file });
    assert.deepEqual(supers(c).map(x => x.username), ['superadmin']);
    assert.equal(u(c, 'admin').role, 'admin');
    c.close();
    // several superadmins collapse to one (kyrpy wins), nobody else is touched
    raw = new DatabaseSync(file);
    raw.exec("DROP INDEX ux_users_single_superadmin; UPDATE users SET role = 'superadmin' WHERE username IN ('superadmin', 'admin'); DELETE FROM mcp_migrations WHERE id = 'm12-001-single-superadmin'");
    raw.close();
    c = buildContainer({ dbFile: file });
    assert.deepEqual(supers(c).map(x => x.username), ['superadmin']);
    assert.equal(u(c, 'admin').role, 'admin');
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP: superadmin edits a public item with no change request; admin gets one; transfer route', async () => {
  const c = fresh();
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (m, url, b, headers = {}) => {
    const r = await fetch(base + url, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const sa = await req('POST', '/api/auth/login', { usernameOrEmail: 'superadmin', password: 'superadmin' });
    const ad = await req('POST', '/api/auth/login', { usernameOrEmail: 'admin', password: 'admin' });
    assert.equal(sa.status, 200); assert.equal(ad.status, 200);
    const saH = { Authorization: `Bearer ${sa.body.token}` }, adH = { Authorization: `Bearer ${ad.body.token}` };
    const el = await req('POST', '/api/elements', { name: 'Http Public', visibility: 'public' }, saH);
    assert.equal(el.status, 200);
    const e1 = await req('PUT', `/api/elements/${el.body.id}`, { label: 'by superadmin' }, saH);
    assert.equal(e1.status, 200);
    assert.equal((await req('GET', '/api/changes?status=pending', null, saH)).body.length ?? 0, 0);
    const e2 = await req('PUT', `/api/elements/${el.body.id}`, { label: 'by admin' }, adH);
    assert.equal(e2.status, 200);
    const pend = await req('GET', '/api/changes?status=pending', null, saH);
    assert.equal(pend.body.length, 1, 'admin edit filed a change request');

    // transfer: admin may not, wrong password refused, then it works
    const adminId = ad.body.user.id;
    assert.equal((await req('POST', `/api/users/${adminId}/transfer-superadmin`, { confirm: true }, adH)).status, 403);
    assert.equal((await req('POST', `/api/users/${adminId}/transfer-superadmin`, { password: 'nope' }, saH)).status, 422);
    assert.equal((await req('DELETE', `/api/users/${sa.body.user.id}`, null, saH)).status, 422);
    const ok = await req('POST', `/api/users/${adminId}/transfer-superadmin`, { password: 'superadmin' }, saH);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(supers(c).map(x => x.username), ['admin']);
  } finally { server.close(); c.close(); }
});

test('PG push: a remote superadmin that is not the local one is demoted before the users are upserted (unique index)', () => {
  const c = fresh();
  const sent = [];
  c.pgSync.schemaInitialized = true;
  c.pgSync.execPg = sql => { sent.push(sql); return { ok: true, stdout: '' }; };
  const r = c.pgSync.pushToPostgres();
  assert.equal(r.ok, true);
  const sql = sent.join('\n');
  const demote = sql.indexOf(`UPDATE "users" SET "role" = 'admin' WHERE "role" = 'superadmin' AND "id" NOT IN (${u(c, 'superadmin').id})`);
  const upsert = sql.indexOf('INSERT INTO "users"');
  assert.ok(demote >= 0, 'demotion statement present');
  assert.ok(demote < upsert, 'runs before the users are written');
  c.close();
});

test('trash is per user: each user lists, counts, restores, purges and empties only their own deleted items', () => {
  const c = fresh();
  const sa = u(c, 'superadmin'), admin = u(c, 'admin');
  const a = c.icon.create({ name: 'Sa Own', visibility: 'public' }, { actor: sa });
  const b = c.icon.create({ name: 'Admin Own', visibility: 'public' }, { actorId: admin.id });
  c.icon.remove(a.id, { actor: sa });
  c.icon.remove(b.id, { actor: admin });
  const mine = c.trash.list({}, { actor: admin });
  assert.deepEqual(mine.map(t => t.originalId), [b.id]);
  assert.equal(c.trash.count({}, { actor: admin }), 1);
  assert.equal(c.trash.count({}, { actor: sa }), 1);
  const saItem = c.trash.list({}, { actor: sa })[0];
  assert.throws(() => c.trash.restore(saItem.id, { actor: admin }), e => e.name === 'NotFoundError');
  assert.throws(() => c.trash.purge(saItem.id, { actor: admin }), e => e.name === 'NotFoundError');
  assert.equal(c.trash.empty({ actor: admin }).purgedCount, 1, 'empty only touches the actor\'s trash');
  assert.equal(c.trash.count({}, { actor: sa }), 1, "the other user's trash is untouched");
  c.close();
});
