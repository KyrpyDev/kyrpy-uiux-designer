import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Owner kyrpy (1) owns a project; collab_dev edits `n` screens there, filing `n` pending change requests. */
function setup(n = 4) {
  const c = buildContainer({ dbFile: ':memory:' });
  const collab = c.auth.register({ username: 'collab_dev', email: 'collab@kyrpy.com', password: 'password123' }).user;
  const outsider = c.auth.register({ username: 'outsider', email: 'outsider@kyrpy.com', password: 'password123' }).user;
  const proj = c.projects.create({ name: 'Bulk App' }, { actorId: 1 });
  c.projects.addCollaborator({ projectId: proj.id, actorId: 1, usernameOrEmail: 'collab_dev', role: 'contributor' });
  const screens = [];
  for (let i = 0; i < n; i++) {
    const s = c.screen.create({ name: `Screen ${i}`, label: `Original ${i}`, projectId: proj.id },
      { nodes: [{ tag: 'rect', name: 'card', attrs: { x: 0, y: 0, width: 10, height: 10 } }], actorId: 1 });
    c.screen.update(s.id, { label: `Proposed ${i}` }, { actorId: collab.id, projectId: proj.id });
    screens.push(s);
  }
  const pending = c.collaboration.list({ projectId: proj.id, status: 'pending' });
  assert.equal(pending.length, n);
  return { c, collab, outsider, proj, screens, pending };
}

const ownerOf = c => c.auth.resolveActor({ userId: 1, allowDefault: true });

test('bulkReview approves and rejects many changes in one call', () => {
  const { c, proj, screens, pending } = setup(4);
  const actor = ownerOf(c);
  const ids = pending.map(p => p.id);
  const byScreen = new Map(pending.map(p => [p.targetId, p.id]));

  const approved = c.collaboration.bulkReview(ids.slice(0, 2), 'approve', { actor, comment: 'LGTM' });
  assert.equal(approved.approved, 2);
  assert.equal(approved.failed, 0);
  assert.deepEqual(approved.results.map(r => r.status), ['approved', 'approved']);
  assert.ok(approved.results.every(r => r.ok));

  const rejected = c.collaboration.bulkReview(ids.slice(2), 'reject', { actor });
  assert.equal(rejected.rejected, 2);
  for (const s of screens) {
    const st = c.collaboration.get(byScreen.get(s.id)).status;
    const i = Number(s.name.split(' ')[1]);
    assert.equal(c.screen.get(s.id).label, st === 'approved' ? `Proposed ${i}` : `Original ${i}`, 'reject rolls back, approve keeps');
  }
  assert.equal(c.collaboration.get(ids[0]).reviewComment, 'LGTM');
  assert.equal(c.collaboration.pendingCount(proj.id), 0);
  assert.throws(() => c.collaboration.bulkReview(ids, 'merge', { actor }), /approve' or 'reject/);
  c.close();
});

test('bulkReview refuses a designer who owns neither the item nor the project, change by change', () => {
  const { c, outsider, pending } = setup(2);
  const res = c.collaboration.bulkReview(pending.map(p => p.id), 'approve', { actor: outsider });
  assert.equal(res.approved, 0);
  assert.equal(res.failed, 2);
  assert.ok(res.results.every(r => !r.ok && r.status === 'pending' && /owner or admin/.test(r.error)));
  assert.ok(pending.every(p => c.collaboration.get(p.id).status === 'pending'), 'nothing was reviewed');
  c.close();
});

test('bulkReview skips changes that are no longer pending and keeps going after a failure', () => {
  const { c, pending } = setup(3);
  const actor = ownerOf(c);
  c.collaboration.approve(pending[0].id, { actor });
  const res = c.collaboration.bulkReview([pending[0].id, 999999, pending[1].id, pending[2].id], 'reject', { actor });
  assert.equal(res.skipped, 1);
  assert.equal(res.failed, 1, 'an unknown id fails alone');
  assert.equal(res.rejected, 2);
  const skipped = res.results.find(r => r.id === pending[0].id);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.status, 'approved');
  assert.equal(c.collaboration.get(pending[0].id).status, 'approved', 'a skipped change is left as it was');
  c.close();
});

test('approve all matching a filter, text search and per-status counts', () => {
  const { c, proj, pending } = setup(4);
  const actor = ownerOf(c);
  // q matches the target name, case-insensitively, and the author username
  assert.equal(c.collaboration.list({ projectId: proj.id, q: 'screen 1' }).length, 1);
  assert.equal(c.collaboration.list({ projectId: proj.id, q: 'COLLAB_DEV' }).length, 4);
  assert.equal(c.collaboration.list({ projectId: proj.id, q: '100%_' }).length, 0, 'LIKE wildcards are escaped');

  c.collaboration.reject(pending.find(p => p.targetName === 'Screen 3').id, { actor });
  assert.deepEqual(c.collaboration.counts({ projectId: proj.id }), { pending: 3, approved: 0, rejected: 1, all: 4 });
  assert.deepEqual(c.collaboration.counts({ projectId: proj.id, status: 'approved', q: 'screen 0' }), { pending: 1, approved: 0, rejected: 0, all: 1 },
    'counts ignore the status filter but honour the others');

  // a filter that matches nothing reviews nothing; then approve every pending screen change
  const none = c.collaboration.bulkReview(null, 'approve', { actor, filter: { projectId: proj.id, targetType: 'icon' } });
  assert.equal(none.results.length, 0);
  const all = c.collaboration.bulkReview(null, 'approve', { actor, filter: { projectId: proj.id, targetType: 'screen', q: 'screen' } });
  assert.equal(all.approved, 3, 'the rejected change is not pending, so it is not touched');
  assert.deepEqual(c.collaboration.counts({ projectId: proj.id }), { pending: 0, approved: 3, rejected: 1, all: 4 });
  c.close();
});

test('HTTP: POST /api/changes/bulk, GET /api/changes/counts and ?q=', async () => {
  const { c, proj, pending } = setup(3);
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (m, u, b, token) => {
    const r = await fetch(base + u, {
      method: m,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: b ? JSON.stringify(b) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const owner = (await req('POST', '/api/auth/login', { usernameOrEmail: 'kyrpy', password: 'kyrpy' })).body.token;
    const outsider = (await req('POST', '/api/auth/login', { usernameOrEmail: 'outsider', password: 'password123' })).body.token;

    const counts = await req('GET', `/api/changes/counts?projectId=${proj.id}`, null, owner);
    assert.equal(counts.status, 200);
    assert.deepEqual(counts.body, { pending: 3, approved: 0, rejected: 0, all: 3 });

    const found = await req('GET', `/api/changes?projectId=${proj.id}&q=screen%202&lite=1`, null, owner);
    assert.equal(found.body.length, 1);
    assert.equal(found.body[0].beforeSnapshot, undefined, 'lite strips snapshots');

    const refused = await req('POST', '/api/changes/bulk', { ids: [pending[0].id], action: 'approve' }, outsider);
    assert.equal(refused.status, 200);
    assert.equal(refused.body.failed, 1);

    const one = await req('POST', '/api/changes/bulk', { ids: [pending[0].id], action: 'reject', comment: 'no' }, owner);
    assert.equal(one.body.rejected, 1);
    const rest = await req('POST', '/api/changes/bulk', { action: 'approve', filter: { projectId: proj.id } }, owner);
    assert.equal(rest.body.approved, 2);
    assert.equal((await req('GET', `/api/changes/counts?projectId=${proj.id}`, null, owner)).body.pending, 0);

    const bad = await req('POST', '/api/changes/bulk', { ids: [1], action: 'nope' }, owner);
    assert.ok(bad.status >= 400);
  } finally {
    await new Promise(r => server.close(r));
    c.close();
  }
});

test('approve only records the decision when the edit is live: newer edits of the item are never undone', () => {
  const { c, screens, pending } = setup(1);
  const actor = ownerOf(c);
  const s = screens[0];
  c.screen.update(s.id, { label: 'Edited again later' }, { actorId: 1 });       // the owner edited the item after the collaborator
  c.collaboration.approve(pending[0].id, { actor });
  assert.equal(c.collaboration.get(pending[0].id).status, 'approved');
  assert.equal(c.screen.get(s.id).label, 'Edited again later', 'the old "after" snapshot was not restored over the newer edit');
  c.close();
});

test('approve still applies a staged edit (the item was not touched since the change was recorded)', () => {
  const { c, screens, pending } = setup(1);
  const actor = ownerOf(c);
  const s = screens[0];
  c.db.prepare('UPDATE screens SET label = ?, updated_at = ? WHERE id = ?').run('Original 0', '2000-01-01 00:00:00', s.id);   // edit not live, item older than the change
  c.collaboration.approve(pending[0].id, { actor });
  assert.equal(c.screen.get(s.id).label, 'Proposed 0', 'staged edit applied on approval');
  c.close();
});
