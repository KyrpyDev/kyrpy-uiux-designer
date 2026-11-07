/**
 * Public-library invariants on edits:
 *  - a public-library item (owned by the `public` system user) cannot be moved out of the default project by a
 *    PUT `{ projectId }` — admins included — it must be cloned instead;
 *  - an admin publishing an existing default-project item re-owns it to `public` (same rule as on create);
 *  - AuthService.updateUser validates the email like register / ProfileService.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { ConflictError, ValidationError } from '../domain/errors.js';
import { PUBLIC_EMAIL } from '../domain/system-users.js';

function setup() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const pub = c.publicUserId();
  const kyrpy = c.users.findByUsernameOrEmail('kyrpy');
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'bobsecret' }).user;
  const bobProj = c.projects.create({ name: 'Bob Project', visibility: 'private' }, { actor: bob });
  return { c, pub, kyrpy, bob, bobProj };
}

test('public-library items cannot be moved to another project by PUT projectId (designs and workflows, admins included)', () => {
  const { c, pub, kyrpy, bob, bobProj } = setup();
  try {
    const icon = c.icon.create({ name: 'Lib Icon', visibility: 'public' }, { actorId: kyrpy.id });
    const wf = c.workflows.create({ name: 'Lib Flow', visibility: 'public' }, { actorId: kyrpy.id });
    assert.equal(icon.creatorId, pub);
    assert.equal(wf.creatorId, pub);
    for (const actorId of [bob.id, kyrpy.id]) {
      assert.throws(() => c.icon.update(icon.id, { projectId: bobProj.id }, { actorId }), err => err instanceof ConflictError && /clone it instead/.test(err.message));
      assert.throws(() => c.workflows.update(wf.id, { projectId: bobProj.id }, { actorId }), err => err instanceof ConflictError && /clone it instead/.test(err.message));
    }
    assert.equal(c.icon.get(icon.id).projectId, 1, 'icon stays in the default project');
    assert.equal(c.workflows.get(wf.id).projectId, 1, 'workflow stays in the default project');
    // no-op projectId (same project) and other edits still work
    assert.equal(c.icon.update(icon.id, { projectId: 1, label: 'Relabelled' }, { actorId: kyrpy.id }).label, 'Relabelled');
    // restore with a foreign projectId is rejected too
    const snap = { record: { ...c.icon.get(icon.id), projectId: bobProj.id }, nodes: [], menuItems: [] };
    assert.throws(() => c.icon.restore(icon.id, snap), ConflictError);
    // cloning into the other project is the supported path
    const copy = c.icon.clone(icon.id, { projectId: bobProj.id, visibility: 'project' }, { actorId: bob.id });
    assert.equal(copy.projectId, bobProj.id);
    assert.equal(copy.creatorId, bob.id);
    // a user's own non-library item can still be moved
    const own = c.icon.create({ name: 'Bob Own Icon', visibility: 'private' }, { actorId: bob.id });
    assert.equal(c.icon.update(own.id, { projectId: bobProj.id }, { actorId: bob.id }).projectId, bobProj.id);
  } finally {
    c.close();
  }
});

test('an admin publishing an existing default-project item re-owns it to the public user; a non-admin keeps ownership', () => {
  const { c, pub, kyrpy, bob } = setup();
  try {
    const adminIcon = c.icon.create({ name: 'Admin Draft Icon', visibility: 'project' }, { actorId: kyrpy.id });
    assert.equal(adminIcon.creatorId, kyrpy.id);
    const published = c.icon.update(adminIcon.id, { visibility: 'public' }, { actorId: kyrpy.id });
    assert.equal(published.visibility, 'public');
    assert.equal(published.creatorId, pub, 'creator re-owned to public');
    assert.equal(published.rootOwnerId, pub, 'root owner re-owned to public');

    const adminWf = c.workflows.create({ name: 'Admin Draft Flow', visibility: 'private' }, { actorId: kyrpy.id });
    const pubWf = c.workflows.update(adminWf.id, { visibility: 'public' }, { actorId: kyrpy.id });
    assert.equal(pubWf.creatorId, pub);
    assert.equal(pubWf.rootOwnerId, pub);

    const bobIcon = c.icon.create({ name: 'Bob Draft Icon', visibility: 'private' }, { actorId: bob.id });
    const bobPub = c.icon.update(bobIcon.id, { visibility: 'public' }, { actorId: bob.id });
    assert.equal(bobPub.visibility, 'public');
    assert.equal(bobPub.creatorId, bob.id, 'non-admin owner keeps the item');
  } finally {
    c.close();
  }
});

test('updateUser validates the email like register / profile', () => {
  const { c, kyrpy, bob } = setup();
  try {
    const carol = c.auth.register({ username: 'carol', email: 'carol@example.com', password: 'carolsecret' }).user;
    assert.throws(() => c.auth.updateUser(carol.id, { email: 'not-an-email' }, kyrpy), ValidationError);
    assert.throws(() => c.auth.updateUser(carol.id, { email: PUBLIC_EMAIL }, kyrpy), ConflictError);
    assert.throws(() => c.auth.updateUser(carol.id, { email: 'BOB@example.com' }, kyrpy), ConflictError);
    assert.throws(() => c.auth.updateUser(carol.id, { email: 'bob@example.com' }, carol), ConflictError);
    // unchanged own email and a fresh one are accepted
    assert.equal(c.auth.updateUser(carol.id, { email: 'carol@example.com' }, carol).email, 'carol@example.com');
    assert.equal(c.auth.updateUser(carol.id, { email: ' Carol2@Example.com ' }, kyrpy).email, 'carol2@example.com');
    assert.equal(c.users.get(bob.id).email, 'bob@example.com');
  } finally {
    c.close();
  }
});
