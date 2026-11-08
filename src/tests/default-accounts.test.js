import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { DEFAULT_ACCOUNTS } from '../application/passwords.js';

test('fresh install seeds superadmin/superadmin, admin/admin and user/user; each can sign in', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  for (const a of DEFAULT_ACCOUNTS) {
    const r = c.auth.login({ usernameOrEmail: a.username, password: a.password });
    assert.equal(r.user.username, a.username);
    assert.equal(r.user.role, a.role);
  }
  assert.ok(!c.users.findByUsernameOrEmail('kyrpy'), 'no kyrpy account any more');
  assert.equal(c.profile.get(c.auth.login({ usernameOrEmail: 'user', password: 'user' }).token).passwordSetByUser, false, 'default password is flagged for an immediate change');
  c.close();
});

test('a legacy kyrpy account is renamed to superadmin; a password the person set survives', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  c.users.update(1, { username: 'kyrpy' });
  c.auth.ensureDefaultAdmin();
  assert.equal(c.users.get(1).username, 'superadmin');
  assert.ok(c.auth.login({ usernameOrEmail: 'superadmin', password: 'superadmin' }).token);
  c.profile.changePassword(c.auth.login({ usernameOrEmail: 'superadmin', password: 'superadmin' }).token, { currentPassword: 'superadmin', newPassword: 'Own-pass-2026' });
  c.users.update(1, { username: 'kyrpy' });
  c.auth.ensureDefaultAdmin();
  assert.ok(c.auth.login({ usernameOrEmail: 'superadmin', password: 'Own-pass-2026' }).token);
  c.close();
});
