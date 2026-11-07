/**
 * The immutable `public` system user (domain/system-users.js): owner of the whole public library.
 * Cannot sign in, cannot be changed or deleted; admins curate its items without change requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { MCP_PG_SCHEMA_SQL } from '../infrastructure/postgres/mcp-pg-schema.js';
import { DESIGN_TABLES } from '../../domain/system-users.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', '..', 'v1'))
  ? resolve(here, '..', '..', '..', 'v1')
  : resolve(here, '..', '..', '..', '.archive', 'v1');
const fresh = () => buildContainer({ dbFile: ':memory:' });

test('a fresh container has the public system user: suspended, no password, flagged read-only', () => {
  const c = fresh();
  const pub = c.publicUserId();
  assert.ok(pub > 0);
  const row = c.db.prepare('SELECT username, password_hash, salt, status FROM users WHERE id = ?').get(pub);
  assert.equal(row.username, 'public');
  assert.equal(row.password_hash, '');
  assert.equal(row.status, 'suspended');
  const listed = c.auth.listUsers().find(u => u.id === pub);
  assert.equal(listed.system, true);
  assert.equal(listed.readOnly, true);
  assert.ok(!c.auth.listUsers({ includeSystem: false }).some(u => u.system));
  assert.ok(c.auth.listUsers().find(u => u.username === 'kyrpy-agent-designer').system, 'the agent is a system user too');
  assert.ok(MCP_PG_SCHEMA_SQL.length > 0, 'PG DDL builds with the run-only m9 migration');
  c.close();
});

test('the public user cannot sign in, be impersonated, changed, deleted, re-registered, invited or own keys', () => {
  const c = fresh();
  const pub = c.publicUserId();
  const admin = c.users.findByUsernameOrEmail('admin');
  assert.throws(() => c.auth.login({ usernameOrEmail: 'public', password: 'anything' }), e => e.status === 403);
  assert.throws(() => c.auth.updateUser(pub, { status: 'active', password: 'secret123' }, admin), e => e.status === 403);
  assert.throws(() => c.auth.updateUser(pub, { displayName: 'x' }, admin), e => e.status === 403);
  assert.throws(() => c.auth.deleteUser(admin, pub), e => e.status === 403);
  assert.throws(() => c.auth.register({ username: 'public', email: 'p@example.com', password: 'secret123' }), /reserved/);
  assert.throws(() => c.auth.register({ username: 'Public', email: 'p@example.com', password: 'secret123' }), /reserved/);
  assert.throws(() => c.auth.register({ username: 'someone', email: 'public@kyrpy.local', password: 'secret123' }), /reserved/);
  assert.throws(() => c.auth.register({ username: 'kyrpy-agent-designer', email: 'a@example.com', password: 'secret123' }), /reserved/);
  // even when someone flips its status in the DB, the account stays locked
  c.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(pub);
  assert.throws(() => c.auth.login({ usernameOrEmail: 'public', password: 'anything' }), e => e.status === 403);
  assert.notEqual(c.auth.resolveActor({ userId: pub }).id, pub, 'x-user-id cannot impersonate the public user');
  assert.throws(() => c.mcp.apiKeys.create({ name: 'k', projectId: 1 }, c.users.get(pub)), e => e.status === 403);
  assert.throws(() => c.projects.inviteMember(1, { userId: pub }, { actor: admin }), /System account/);
  assert.throws(() => c.projects.create({ name: 'Owned By Public', ownerId: pub }), /system account/i);
  c.close();
});

test('built-in items seeded by the importer belong to the public user', () => {
  const c = fresh();
  c.importer.run({ legacyRoot });
  const pub = c.publicUserId();
  for (const t of DESIGN_TABLES) {
    const rows = c.db.prepare(`SELECT creator_id, root_owner_id FROM ${t}`).all();
    assert.ok(rows.length > 0, `${t} seeded`);
    assert.ok(rows.every(r => r.creator_id === pub && r.root_owner_id === pub), `${t} owned by public`);
  }
  c.close();
});

test('migration m9-001 re-owns public rows of an old-state DB but leaves project and private rows alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-user-'));
  try {
    const file = join(dir, 'old.db');
    let c = buildContainer({ dbFile: file, syncEnabled: false });
    const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'bobsecret' }).user;
    const pubIcon = c.icon.create({ name: 'Old Public Icon', visibility: 'public', creatorId: 1, rootOwnerId: 1 });
    const bobPublic = c.button.create({ name: 'Bob Old Public', visibility: 'public' }, { actorId: bob.id });
    const priv = c.element.create({ name: 'Kyrpy Private', visibility: 'private' }, { actorId: 1 });
    const proj = c.path.create({ name: 'Kyrpy Project Path', visibility: 'project' }, { actorId: 1 });
    const bobProj = c.screen.create({ name: 'Bob Project Screen', visibility: 'project' }, { actorId: bob.id });
    // roll back to the pre-m9 state: no public user, public rows owned by humans, migration not applied
    c.db.exec("DELETE FROM mcp_migrations WHERE id = 'm9-001-public-user'");
    c.db.prepare("DELETE FROM users WHERE username = 'public'").run();
    c.db.prepare('UPDATE icons SET creator_id = 1, root_owner_id = 1 WHERE id = ?').run(pubIcon.id);
    c.close();

    c = buildContainer({ dbFile: file, syncEnabled: false });
    const pub = c.publicUserId();
    assert.ok(pub);
    const owner = (t, id) => c.db.prepare(`SELECT creator_id AS c, root_owner_id AS r FROM ${t} WHERE id = ?`).get(id);
    assert.deepEqual({ ...owner('icons', pubIcon.id) }, { c: pub, r: pub });
    assert.deepEqual({ ...owner('buttons', bobPublic.id) }, { c: pub, r: pub });
    assert.deepEqual({ ...owner('elements', priv.id) }, { c: 1, r: 1 });
    assert.deepEqual({ ...owner('paths', proj.id) }, { c: 1, r: 1 });
    assert.deepEqual({ ...owner('screens', bobProj.id) }, { c: bob.id, r: bob.id });
    assert.ok(c.db.prepare("SELECT 1 FROM mcp_migrations WHERE id = 'm9-001-public-user'").get());
    c.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the superadmin curates public-library items without change requests; admins and collaborators file one for a real reviewer', () => {
  const c = fresh();
  const pub = c.publicUserId();
  const admin = c.users.findByUsernameOrEmail('admin');
  const kyrpy = c.users.findByUsernameOrEmail('kyrpy');
  assert.equal(kyrpy.role, 'superadmin');
  assert.equal(admin.role, 'admin');
  const dana = c.auth.register({ username: 'dana', email: 'dana@example.com', password: 'secret123' }).user;
  const icon = c.icon.create({ name: 'Library Star', visibility: 'public' }, { actorId: kyrpy.id });
  assert.equal(icon.creatorId, pub, 'superadmin-made public item of project 1 joins the library');
  const wf = c.workflows.create({ name: 'Library Flow', visibility: 'public' }, { actor: kyrpy });
  assert.equal(wf.creatorId, pub);
  const pending = () => c.collaboration.list({ status: 'pending' });

  c.icon.update(icon.id, { label: 'curated' }, { actorId: kyrpy.id });
  c.icon.update(icon.id, { label: 'curated twice' }, { actorId: kyrpy.id });
  c.workflows.update(wf.id, { label: 'curated' }, { actorId: kyrpy.id });
  assert.equal(pending().length, 0, 'superadmin edits of public items file no change request');

  c.icon.update(icon.id, { label: 'admin idea' }, { actorId: admin.id });
  assert.equal(pending().length, 1, 'a plain admin keeps the approval flow');
  c.icon.update(icon.id, { label: 'dana idea' }, { actorId: dana.id });
  c.workflows.update(wf.id, { label: 'dana flow' }, { actorId: dana.id });
  const reqs = pending();
  assert.equal(reqs.length, 3, 'collaborator edits still file change requests');
  const projectOwner = c.projects.get(1).ownerId;
  assert.ok(reqs.every(r => r.ownerId === projectOwner && r.ownerId !== pub), 'reviewed by the default project owner');

  // admin-made public items keep their human owner (only the superadmin creates library items)
  const adminIcon = c.icon.create({ name: 'Admin Public', visibility: 'public' }, { actorId: admin.id });
  assert.equal(adminIcon.creatorId, admin.id);
  // designer-made public items keep their human owner
  const danaIcon = c.icon.create({ name: 'Dana Public', visibility: 'public' }, { actorId: dana.id });
  assert.equal(danaIcon.creatorId, dana.id);
  c.close();
});

test('public-library items stay public and keep their owner', () => {
  const c = fresh();
  const pub = c.publicUserId();
  const admin = c.users.findByUsernameOrEmail('kyrpy');
  const icon = c.icon.create({ name: 'Locked Public', visibility: 'public' }, { actor: admin });
  const wf = c.workflows.create({ name: 'Locked Flow', visibility: 'public' }, { actor: admin });
  assert.throws(() => c.icon.update(icon.id, { visibility: 'private' }, { actor: admin }), e => e.name === 'ValidationError' && /public library/.test(e.message));
  assert.throws(() => c.icon.update(icon.id, { visibility: 'project' }, { actor: admin }), /public library/);
  assert.throws(() => c.workflows.update(wf.id, { visibility: 'private' }, { actor: admin }), /public library/);
  assert.throws(() => c.projects.setAllItemsVisibility(1, 'project'), /public library/);
  // ownership / lineage fields in a patch are ignored
  const after = c.icon.update(icon.id, { creatorId: 1, rootOwnerId: 1, label: 'still public' }, { actor: admin });
  assert.equal(after.creatorId, pub);
  assert.equal(after.rootOwnerId, pub);
  assert.equal(c.icon.get(icon.id).visibility, 'public');
  // users clone instead; the clone keeps the public root owner
  const dana = c.auth.register({ username: 'dana', email: 'dana@example.com', password: 'secret123' }).user;
  const copy = c.icon.clone(icon.id, { name: 'Dana Copy', visibility: 'private' }, { actorId: dana.id });
  assert.equal(copy.creatorId, dana.id);
  assert.equal(copy.rootOwnerId, pub);
  c.close();
});
