import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';
import { passwordMatches, hasUserPassword, assertNewPassword } from '../application/passwords.js';

const here = dirname(fileURLToPath(import.meta.url));
const fresh = () => buildContainer({ dbFile: ':memory:' });
const register = (c, name = 'alice') => c.auth.register({ username: name, email: `${name}@ex.com`, password: 'Start1234', displayName: 'Alice A' });

test('profile: view own account, edit name / color, email change needs the password and must be unique', () => {
  const c = fresh();
  const { token, user } = register(c);
  register(c, 'bob');
  const p = c.profile.get(token);
  assert.equal(p.user.id, user.id);
  assert.equal(p.passwordSetByUser, true, 'registration marks the password as user-chosen');
  assert.equal(p.sessions.length, 1);
  assert.equal(p.sessions[0].current, true);
  assert.ok(!('token' in p.sessions[0]), 'session tokens never leave the server');
  assert.equal(typeof p.stats.itemsTotal, 'number');

  const upd = c.profile.update(token, { displayName: '  Alice Cooper ', avatarColor: '#10b981' });
  assert.equal(upd.user.displayName, 'Alice Cooper');
  assert.equal(upd.user.avatarColor, '#10b981');

  assert.throws(() => c.profile.update(token, { avatarColor: 'red' }), /hex color/);
  assert.throws(() => c.profile.update(token, { displayName: '' }), /Display name/);
  assert.throws(() => c.profile.update(token, { role: 'admin' }), /cannot be changed/);
  assert.throws(() => c.profile.update(token, { email: 'new@ex.com' }), /current password/);
  assert.throws(() => c.profile.update(token, { email: 'bob@ex.com', currentPassword: 'Start1234' }), /already used/);
  assert.throws(() => c.profile.update(token, { email: 'not-an-email', currentPassword: 'Start1234' }), /valid email/);
  assert.equal(c.profile.update(token, { email: 'Alice2@Ex.com', currentPassword: 'Start1234' }).user.email, 'alice2@ex.com');
  c.close();
});

test('profile: release mode needs a session (401); dev mode without a token acts as the default admin', () => {
  const c = fresh();
  const prev = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'release';
    assert.throws(() => c.profile.get(null), e => e.status === 401);
    process.env.APP_MODE = 'dev';
    const p = c.profile.get(null);
    assert.equal(p.devFallback, true);
    assert.equal(p.user.username, 'kyrpy');
    assert.ok(p.sessions.every(s => s.current === false));
  } finally { if (prev === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = prev; }
  // a bad token is always rejected, in any mode
  assert.throws(() => c.profile.changePassword('ud_bogus', { currentPassword: 'x', newPassword: 'Abcdefg12' }), e => e.status === 401);
  c.close();
});

test('password change: current password required, policy enforced, other sessions signed out, old password stops working', () => {
  const c = fresh();
  const s1 = register(c);
  const s2 = c.auth.login({ usernameOrEmail: 'alice', password: 'Start1234' });
  assert.equal(c.profile.sessions(s1.token).length, 2);

  assert.throws(() => c.profile.changePassword(s1.token, { currentPassword: 'wrong', newPassword: 'Better1234' }), /incorrect/);
  assert.throws(() => c.profile.changePassword(s1.token, { currentPassword: 'Start1234', newPassword: 'short1' }), /at least 8/);
  assert.throws(() => c.profile.changePassword(s1.token, { currentPassword: 'Start1234', newPassword: 'onlyletters' }), /letter and one digit/);
  assert.throws(() => c.profile.changePassword(s1.token, { currentPassword: 'Start1234', newPassword: 'Start1234' }), /differ/);

  const res = c.profile.changePassword(s1.token, { currentPassword: 'Start1234', newPassword: 'Better1234' });
  assert.deepEqual(res, { changed: true, signedOutSessions: 1 });
  assert.equal(c.auth.resolveToken(s2.token), null, 'other session revoked');
  assert.equal(c.auth.resolveToken(s1.token).username, 'alice', 'current session kept');
  assert.throws(() => c.auth.login({ usernameOrEmail: 'alice', password: 'Start1234' }), /Invalid/);
  assert.equal(c.auth.login({ usernameOrEmail: 'alice', password: 'Better1234' }).user.username, 'alice');
  c.close();
});

test('sessions: list, revoke one by sid, revoke all others', () => {
  const c = fresh();
  const a = register(c);
  c.auth.login({ usernameOrEmail: 'alice', password: 'Start1234' });
  c.auth.login({ usernameOrEmail: 'alice', password: 'Start1234' });
  const list = c.profile.sessions(a.token);
  assert.equal(list.length, 3);
  const other = list.find(s => !s.current);
  assert.deepEqual(c.profile.revokeSession(a.token, other.sid), { revoked: 1, current: false });
  assert.throws(() => c.profile.revokeSession(a.token, other.sid), e => e.status === 404);
  assert.deepEqual(c.profile.revokeOtherSessions(a.token), { revoked: 1 });
  assert.equal(c.profile.sessions(a.token).length, 1);
  c.close();
});

test('legacy default-admin passwords only work until the account password is changed', () => {
  const c = fresh();
  const k = c.auth.login({ usernameOrEmail: 'kyrpy', password: 'kyrpy' });
  assert.equal(c.profile.get(k.token).passwordSetByUser, false);
  c.profile.changePassword(k.token, { currentPassword: 'kyrpy', newPassword: 'Kyrpy-new-2026' });
  for (const old of ['kyrpy', 'kyrpy123', 'admin', 'admin123']) {
    assert.throws(() => c.auth.login({ usernameOrEmail: 'kyrpy', password: old }), /Invalid/, `legacy "${old}" rejected`);
  }
  assert.ok(c.auth.login({ usernameOrEmail: 'kyrpy', password: 'Kyrpy-new-2026' }).token);
  assert.equal(hasUserPassword(c.users.getWithAuth(1)), true);
  c.close();
});

test('admin user panel: own password needs the current one; resetting another user does not', () => {
  const c = fresh();
  const a = register(c);
  const admin = c.users.get(1);
  assert.throws(() => c.auth.updateUser(a.user.id, { password: 'Other1234' }, a.user), /Current password/);
  c.auth.updateUser(a.user.id, { password: 'Other1234', currentPassword: 'Start1234' }, a.user);
  assert.ok(c.auth.login({ usernameOrEmail: 'alice', password: 'Other1234' }).token);
  c.auth.updateUser(a.user.id, { password: 'Reset1234' }, admin);
  assert.ok(passwordMatches(c.users.getWithAuth(a.user.id), 'Reset1234'));
  c.close();
});

test('password helpers', () => {
  assert.throws(() => assertNewPassword('alice1234', { username: 'alice1234' }), /username/);
  assert.equal(assertNewPassword('Good1234'), 'Good1234');
});

test('HTTP: /api/auth/profile routes (viewer can edit own profile; changes list lite mode)', async () => {
  const c = fresh();
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (m, u, b, token) => {
    const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await req('GET', '/api/auth/profile', null, 'ud_bogus')).status, 401);
    const v = c.auth.register({ username: 'vic', email: 'vic@ex.com', password: 'Start1234', role: 'viewer' });
    const me = await req('GET', '/api/auth/profile', null, v.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.canWrite, false);
    const put = await req('PUT', '/api/auth/profile', { displayName: 'Victor' }, v.token);
    assert.equal(put.status, 200, 'read-only accounts can still edit their own profile');
    assert.equal(put.body.user.displayName, 'Victor');
    const pw = await req('POST', '/api/auth/profile/password', { currentPassword: 'Start1234', newPassword: 'Victor-2026' }, v.token);
    assert.equal(pw.status, 200);
    const ses = await req('GET', '/api/auth/profile/sessions', null, v.token);
    assert.equal(ses.body.sessions.length, 1);
    assert.equal((await req('DELETE', '/api/auth/profile/sessions/0000000000000000', null, v.token)).status, 404);

    c.collaboration.recordChange({ projectId: 1, targetType: 'icon', targetId: 1, targetKey: 'x', authorId: 1, ownerId: 1, beforeSnapshot: { big: 'x'.repeat(1000) }, afterSnapshot: { big: 'y' } });
    const lite = await req('GET', '/api/changes?lite=1');
    assert.ok(lite.body.length >= 1);
    assert.ok(lite.body.every(ch => !('beforeSnapshot' in ch) && !('afterSnapshot' in ch)));
    const full = await req('GET', '/api/changes');
    assert.ok('beforeSnapshot' in full.body[0]);
  } finally {
    await new Promise(r => server.close(r));
    c.close();
  }
});
