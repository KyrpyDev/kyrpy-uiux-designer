import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';

const u = (c, n) => c.users.findByUsernameOrEmail(n);

test('a regular user files a publish request; the item becomes public only after an admin approves', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const user = u(c, 'user'), admin = u(c, 'admin'), pub = c.publicUserId();
  const icon = c.icon.create({ name: 'Mine', visibility: 'private' }, { actor: user });
  const before = c.icon.list().filter(i => i.creatorId === pub).length;

  const r = c.collaboration.requestPublish({ type: 'icon', id: icon.id, actor: user });
  assert.equal(r.status, 'pending');
  assert.equal(c.collaboration.requestPublish({ type: 'icon', id: icon.id, actor: user }).duplicate, true, 'no second request');
  assert.equal(c.icon.list().filter(i => i.creatorId === pub).length, before, 'nothing public yet');
  assert.equal(c.collaboration.list({ status: 'pending' }).filter(x => x.action === 'publish').length, 1, 'admins see it in the pending list');

  assert.throws(() => c.collaboration.approve(r.change.id, { actor: user }), e => e.name === 'ForbiddenError');
  c.collaboration.approve(r.change.id, { actor: admin });
  const pubs = c.icon.list().filter(i => i.creatorId === pub && i.visibility === 'public');
  assert.equal(pubs.length, before + 1);
  assert.equal(pubs.at(-1).rootOwnerId, pub);
  c.close();
});

test('an admin publishes directly; someone else cannot publish a foreign item; rejecting publishes nothing', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const user = u(c, 'user'), admin = u(c, 'admin'), pub = c.publicUserId();
  const icon = c.icon.create({ name: 'Theirs', visibility: 'private' }, { actor: user });
  const n = () => c.icon.list().filter(i => i.creatorId === pub).length, base = n();
  assert.equal(c.collaboration.requestPublish({ type: 'icon', id: icon.id, actor: admin }).status, 'published');
  assert.equal(n(), base + 1);
  const other = c.icon.create({ name: 'Other', visibility: 'private' }, { actor: admin });
  assert.throws(() => c.collaboration.requestPublish({ type: 'icon', id: other.id, actor: user }), e => e.name === 'ForbiddenError');
  const own = c.icon.create({ name: 'Own2', visibility: 'private' }, { actor: user });
  const r = c.collaboration.requestPublish({ type: 'icon', id: own.id, actor: user });
  c.collaboration.reject(r.change.id, { actor: admin });
  assert.equal(n(), base + 1);
  c.close();
});
