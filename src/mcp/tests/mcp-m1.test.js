/**
 * Milestone M1 sensors: API keys (create → use → rotate → revoke), ownership and scope rules,
 * audit log, project AI settings, and the designer REST routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { inTransaction } from '../../infrastructure/sqlite/database.js';
import { ForbiddenError, ValidationError, ConflictError, NotFoundError } from '../../domain/errors.js';
import { buildMcpModule } from '../composition.js';
import { generateKey, isKeyFormat, normalizeScopes, expiryFrom, keyPrefix } from '../domain/api-key.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Container + an MCP module with a controllable clock + two users who each own a project. */
function setup() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const clock = { t: new Date('2026-11-06T10:00:00Z') };
  const mcp = buildMcpModule({
    db: c.db, dbFile: ':memory:', projects: c.projects.projects, users: c.users, auth: c.auth,
    transaction: fn => inTransaction(c.db, fn), now: () => new Date(clock.t)
  });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' }).user;
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' }).user;
  const adaProject = c.projects.create({ name: 'Ada App' }, { actor: ada });
  const bobProject = c.projects.create({ name: 'Bob App' }, { actor: bob });
  return { c, keys: mcp.apiKeys, clock, ada, bob, adaProject, bobProject, advance: h => { clock.t = new Date(clock.t.getTime() + h * 3600_000); } };
}

const auditEvents = (c, keyId) => c.db.prepare('SELECT event, result, error_code FROM mcp_audit_log WHERE api_key_id = ? ORDER BY id').all(keyId)
  .map(r => `${r.event}:${r.result}${r.error_code ? `:${r.error_code}` : ''}`);

test('M1: key format, scopes and expiry rules', () => {
  const k = generateKey(randomBytes);
  assert.ok(isKeyFormat(k), k);
  assert.equal(keyPrefix(k).length, 13);
  assert.ok(!isKeyFormat('kud_live_short'));
  assert.notEqual(generateKey(randomBytes), generateKey(randomBytes));
  assert.deepEqual(normalizeScopes(undefined), ['read', 'request', 'propose']);
  assert.deepEqual(normalizeScopes(['propose']), ['read', 'propose'], 'read is always granted');
  assert.throws(() => normalizeScopes(['admin']), ValidationError);
  assert.equal(expiryFrom(null), null);
  assert.equal(expiryFrom(30, new Date('2026-01-01T00:00:00Z')), '2026-01-31T00:00:00.000Z');
  assert.throws(() => expiryFrom(0), ValidationError);
  assert.throws(() => expiryFrom(5000), ValidationError);
});

test('M1: owner creates a key; plaintext is shown once and only an HMAC is stored', () => {
  const { c, keys, ada, adaProject } = setup();
  const { key, apiKey } = keys.create({ name: 'Claude Code — laptop', projectId: adaProject.id }, ada);
  assert.ok(isKeyFormat(key));
  assert.equal(apiKey.prefix, keyPrefix(key));
  assert.equal(apiKey.status, 'active');
  assert.equal(apiKey.expiresAt, '2027-02-04T10:00:00.000Z', 'default 90 days');
  assert.deepEqual(apiKey.scopes, ['read', 'request', 'propose']);
  assert.equal(apiKey.keyHash, undefined, 'views never include the hash');
  const row = c.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(apiKey.id);
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes(key), 'plaintext is not stored anywhere in the row');
  assert.deepEqual(keys.listMine(ada).map(k => k.id), [apiKey.id]);
  assert.ok(!JSON.stringify(keys.listMine(ada)).includes(key));
  assert.deepEqual(auditEvents(c, apiKey.id), ['key.create:ok']);
  c.close();
});

test('M1: only the project owner can create keys; validation errors', () => {
  const { c, keys, ada, bob, adaProject } = setup();
  assert.throws(() => keys.create({ name: 'x', projectId: adaProject.id }, bob), ForbiddenError);
  assert.throws(() => keys.create({ name: '', projectId: adaProject.id }, ada), ValidationError);
  assert.throws(() => keys.create({ name: 'x' }, ada), ValidationError);
  assert.throws(() => keys.create({ name: 'x', projectId: 999 }, ada), NotFoundError);
  assert.throws(() => keys.create({ name: 'x', projectId: adaProject.id, scopes: ['root'] }, ada), ValidationError);
  assert.throws(() => keys.create({ name: 'x', projectId: adaProject.id }, null), /sign in/);
  const viewer = c.auth.register({ username: 'vic', email: 'vic@example.com', password: 'secret123', role: 'viewer' }).user;
  const vp = c.projects.projects.create({ key: 'vic-app', name: 'Vic App', ownerId: viewer.id });
  assert.throws(() => keys.create({ name: 'x', projectId: vp.id }, viewer), ForbiddenError, 'read-only accounts cannot create keys');
  c.close();
});

test('M1: authenticate → principal; revoke blocks the very next call', () => {
  const { c, keys, ada, adaProject } = setup();
  const { key, apiKey } = keys.create({ name: 'agent', projectId: adaProject.id, scopes: ['read'] }, ada);
  const p = keys.authenticate(key, { ip: '10.0.0.5' });
  assert.equal(p.apiKeyId, apiKey.id);
  assert.equal(p.user.username, 'ada');
  assert.equal(p.project.id, adaProject.id);
  assert.deepEqual(p.scopes, ['read']);
  assert.ok(keys.hasScope(p, 'read'));
  assert.throws(() => keys.assertScope(p, 'propose'), e => e.code === 'SCOPE_DENIED' && e.status === 403);
  const listed = keys.listMine(ada)[0];
  assert.equal(listed.lastUsedIp, '10.0.0.5');
  assert.ok(listed.lastUsedAt);

  keys.revoke(apiKey.id, ada);
  assert.throws(() => keys.authenticate(key), e => e.status === 401 && e.code === 'UNAUTHORIZED');
  assert.equal(keys.listMine(ada)[0].status, 'revoked');
  assert.deepEqual(auditEvents(c, apiKey.id), ['key.create:ok', 'auth.ok:ok', 'key.revoke:ok', 'auth.fail:denied:REVOKED']);
  c.close();
});

test('M1: wrong, malformed and tampered keys are rejected', () => {
  const { c, keys, ada, adaProject } = setup();
  const { key } = keys.create({ name: 'agent', projectId: adaProject.id }, ada);
  assert.throws(() => keys.authenticate('nope'), e => e.status === 401);
  assert.throws(() => keys.authenticate(generateKey(randomBytes)), e => e.status === 401);
  const tampered = key.slice(0, -1) + (key.at(-1) === 'a' ? 'b' : 'a');   // same prefix, different secret
  assert.throws(() => keys.authenticate(tampered), e => e.status === 401);
  const codes = c.db.prepare("SELECT error_code FROM mcp_audit_log WHERE event = 'auth.fail' ORDER BY id").all().map(r => r.error_code);
  assert.deepEqual(codes, ['BAD_FORMAT', 'UNKNOWN_KEY', 'UNKNOWN_KEY']);
  c.close();
});

test('M1: expiry and "never expires"', () => {
  const { c, keys, ada, adaProject, advance } = setup();
  const short = keys.create({ name: 'short', projectId: adaProject.id, expiresInDays: 1 }, ada);
  const forever = keys.create({ name: 'forever', projectId: adaProject.id, expiresInDays: null }, ada);
  assert.equal(forever.apiKey.expiresAt, null);
  advance(25);
  assert.throws(() => keys.authenticate(short.key), e => e.status === 401);
  assert.equal(keys.listMine(ada).find(k => k.id === short.apiKey.id).status, 'expired');
  assert.ok(keys.authenticate(forever.key));
  c.close();
});

test('M1: rotation issues a new key and keeps the old one for a 24 h grace period', () => {
  const { c, keys, ada, adaProject, advance } = setup();
  const first = keys.create({ name: 'rotating', projectId: adaProject.id, expiresInDays: 30, scopes: ['read', 'request'] }, ada);
  advance(1);
  const r = keys.rotate(first.apiKey.id, ada);
  assert.notEqual(r.key, first.key);
  assert.equal(r.apiKey.name, 'rotating');
  assert.deepEqual(r.apiKey.scopes, ['read', 'request']);
  assert.equal(r.apiKey.rotatedFromId, first.apiKey.id);
  assert.equal(r.apiKey.expiresAt, '2026-12-06T11:00:00.000Z', 'same 30-day duration from now');
  assert.equal(r.previous.status, 'rotating');
  assert.equal(r.previous.expiresAt, '2026-11-07T11:00:00.000Z', 'old key ends after the grace period');
  assert.ok(keys.authenticate(first.key), 'old key still works during grace');
  assert.ok(keys.authenticate(r.key));
  assert.throws(() => keys.rotate(first.apiKey.id, ada), ConflictError, 'cannot rotate twice');
  advance(25);
  assert.throws(() => keys.authenticate(first.key), e => e.status === 401);
  assert.ok(keys.authenticate(r.key));
  c.close();
});

test('M1: who may revoke; revoke-all; keys die when ownership moves', () => {
  const { c, keys, ada, bob, adaProject, bobProject } = setup();
  const a1 = keys.create({ name: 'a1', projectId: adaProject.id }, ada);
  const a2 = keys.create({ name: 'a2', projectId: adaProject.id }, ada);
  keys.create({ name: 'b1', projectId: bobProject.id }, bob);
  assert.throws(() => keys.revoke(a1.apiKey.id, bob), ForbiddenError);
  assert.throws(() => keys.listForProject(adaProject.id, bob), ForbiddenError);
  assert.throws(() => keys.listAll(bob), ForbiddenError);
  const admin = c.auth.defaultAdmin();
  assert.equal(keys.listAll(admin).length, 3, 'admins see every key');

  const res = keys.revokeAllForProject(adaProject.id, ada);
  assert.equal(res.revoked, 2);
  assert.throws(() => keys.authenticate(a2.key), e => e.status === 401);

  const b2 = keys.create({ name: 'b2', projectId: bobProject.id }, bob);
  c.projects.projects.update(bobProject.id, { ownerId: ada.id });
  assert.throws(() => keys.authenticate(b2.key), e => e.status === 401, 'a key stops working when its user no longer owns the project');
  assert.throws(() => keys.rotate(b2.apiKey.id, bob), ConflictError);
  c.close();
});

test('M1: project AI settings default safe and only the owner can change them', () => {
  const { c, keys, ada, bob, adaProject } = setup();
  const s = keys.getAiSettings(adaProject.id, ada);
  assert.deepEqual({ ...s, canEdit: undefined }, { projectId: adaProject.id, pushRequiresReview: true, mayCreatePublicItems: false, canEdit: undefined });
  assert.equal(s.canEdit, true);
  assert.equal(keys.getAiSettings(adaProject.id, bob).canEdit, false);
  assert.throws(() => keys.updateAiSettings(adaProject.id, { mayCreatePublicItems: true }, bob), ForbiddenError);
  assert.throws(() => keys.updateAiSettings(adaProject.id, { pushRequiresReview: 'no' }, ada), ValidationError);
  const u = keys.updateAiSettings(adaProject.id, { mayCreatePublicItems: true }, ada);
  assert.equal(u.mayCreatePublicItems, true);
  assert.equal(u.pushRequiresReview, true);
  const p = c.projects.projects.get(adaProject.id);
  assert.equal(p.settings.ai.mayCreatePublicItems, true);
  assert.ok(p.settings.buttonStyle === undefined || typeof p.settings.buttonStyle === 'string', 'other settings untouched');
  c.close();
});

test('M1: REST routes for the profile menu (session auth) and no API-key login on /api', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const reg = c.auth.register({ username: 'cy', email: 'cy@example.com', password: 'secret123' });
  const proj = c.projects.create({ name: 'Cy App' }, { actor: reg.user });
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = reg.token) => {
    const r = await fetch(base + path, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const created = await call('POST', '/api/me/api-keys', { name: 'Cursor', projectId: proj.id, expiresInDays: 30 });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.ok(isKeyFormat(created.data.key));
    const list = await call('GET', '/api/me/api-keys');
    assert.equal(list.data.length, 1);
    assert.ok(!JSON.stringify(list.data).includes(created.data.key));
    const asKey = await call('GET', '/api/me/api-keys', undefined, created.data.key);
    assert.equal(asKey.status, 401, 'API keys are not accepted as designer sessions');
    const settings = await call('PUT', `/api/projects/${proj.id}/ai-settings`, { pushRequiresReview: false });
    assert.equal(settings.data.pushRequiresReview, false);
    const rotated = await call('POST', `/api/me/api-keys/${created.data.apiKey.id}/rotate`, {});
    assert.ok(isKeyFormat(rotated.data.key));
    const projKeys = await call('GET', `/api/projects/${proj.id}/api-keys`);
    assert.equal(projKeys.data.length, 2);
    const revoked = await call('DELETE', `/api/me/api-keys/${rotated.data.apiKey.id}`);
    assert.equal(revoked.data.status, 'revoked');
    const audit = await call('GET', `/api/projects/${proj.id}/ai-audit`);
    assert.deepEqual(audit.data.map(e => e.event).sort(), ['ai_settings.update', 'key.create', 'key.revoke', 'key.rotate']);
    const ui = await fetch(`${base}/mcp-web/ai-keys-modal.js`);
    assert.equal(ui.status, 200, 'web module is served from src/mcp/interfaces/web');
  } finally {
    server.close();
    c.close();
  }
});
