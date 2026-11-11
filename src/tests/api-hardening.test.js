import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';

async function withServer(fn, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const server = createHttpServer(c, { webRoot: '.', domainRoot: '.' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  c.__port = server.address().port;
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try { await fn(req, c); }
  finally {
    server.closeAllConnections?.(); await new Promise(r => server.close(r)); c.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const auth = t => ({ authorization: `Bearer ${t}` });

test('release mode: the API needs a session; x-user-id and the default admin are not accepted', async () => {
  await withServer(async req => {
    assert.equal((await req('GET', '/api/screens')).status, 401);
    assert.equal((await req('GET', '/api/users', undefined, { 'x-user-id': '1' })).status, 401);
    assert.equal((await req('DELETE', '/api/screens/1')).status, 401);
    assert.equal((await req('GET', '/api/health')).status, 200);
    assert.equal((await req('GET', '/api/auth/config')).status, 200);
    const login = await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' });
    assert.equal(login.status, 200);
    assert.equal((await req('GET', '/api/screens', undefined, auth(login.body.token))).status, 200);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('self-registration never yields an admin', async () => {
  await withServer(async req => {
    const r = await req('POST', '/api/auth/register', { username: 'mallory', email: 'mallory@example.com', password: 'secret123', role: 'admin' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'designer');
    assert.deepEqual(r.body.user.permissions.includes('*'), false);
  });
});

test('private projects and private items of another user are not listed', async () => {
  await withServer(async req => {
    const a = (await req('POST', '/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'secret123' })).body;
    const b = (await req('POST', '/api/auth/register', { username: 'bobby', email: 'bobby@example.com', password: 'secret123' })).body;
    const proj = await req('POST', '/api/projects', { name: 'Alice Secret', visibility: 'private' }, auth(a.token));
    assert.equal(proj.status, 200);
    const item = await req('POST', '/api/icons', { name: 'Alice Private Icon', visibility: 'private', projectId: proj.body.id }, auth(a.token));
    assert.equal(item.status, 200);

    const bobProjects = (await req('GET', '/api/projects', undefined, auth(b.token))).body;
    assert.equal(bobProjects.some(p => p.id === proj.body.id), false);
    assert.equal((await req('GET', '/api/projects', undefined, auth(a.token))).body.some(p => p.id === proj.body.id), true);

    const stolen = (await req('GET', `/api/icons?visibility=private&creatorId=${a.user.id}`, undefined, auth(b.token))).body;
    assert.equal(stolen.some(i => i.id === item.body.id), false);
    assert.equal((await req('GET', '/api/icons?visibility=private', undefined, auth(a.token))).body.some(i => i.id === item.body.id), true);
  });
});

test('a node is only reachable through its own design; sync and bulk visibility need rights', async () => {
  await withServer(async req => {
    const u = (await req('POST', '/api/auth/register', { username: 'carol', email: 'carol@example.com', password: 'secret123' })).body;
    const one = (await req('POST', '/api/icons', { name: 'One', nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 4, height: 4 } }] })).body;
    const two = (await req('POST', '/api/icons', { name: 'Two' })).body;
    const nodeId = one.nodes[0].id;
    assert.equal((await req('PATCH', `/api/icons/${two.id}/nodes/${nodeId}`, { name: 'x' })).status, 404);
    assert.equal((await req('PATCH', `/api/icons/${one.id}/nodes/${nodeId}`, { name: 'x' })).status, 200);
    assert.equal((await req('POST', '/api/sync/pull', {}, auth(u.token))).status, 403);
    assert.equal((await req('POST', '/api/projects/1/visibility', { visibility: 'public' }, auth(u.token))).status, 403);
    assert.equal((await req('GET', '/api/icons/%E0%A4%A')).status, 404);
  });
});

test('a change request is reviewed once', async () => {
  await withServer(async (req, c) => {
    const ch = c.collaboration.recordEdit({ targetType: 'icon', targetId: 1, targetName: 'x', authorId: 2, ownerId: 1 });
    assert.equal((await req('POST', `/api/changes/${ch.id}/approve`, {})).status, 200);
    assert.equal((await req('POST', `/api/changes/${ch.id}/reject`, {})).status, 409);
    assert.equal((await req('POST', `/api/changes/${ch.id}/approve`, {})).status, 409);
  });
});

test('another user cannot read, edit, clone or delete a private item', async () => {
  await withServer(async req => {
    const a = (await req('POST', '/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'secret123' })).body;
    const b = (await req('POST', '/api/auth/register', { username: 'bobby', email: 'bobby@example.com', password: 'secret123' })).body;
    const A = auth(a.token), B = auth(b.token);
    const btn = (await req('POST', '/api/buttons', { name: 'Alice Button', visibility: 'private', nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }] }, A)).body;
    const node = btn.nodes[0];
    for (const [m, u, body] of [
      ['GET', `/api/buttons/${btn.id}`],
      ['GET', `/api/buttons/${btn.id}/svg`],
      ['GET', `/api/buttons/${btn.id}/menu`],
      ['PUT', `/api/buttons/${btn.id}`, { name: 'Hacked' }],
      ['PUT', `/api/buttons/${btn.id}/nodes`, { nodes: [] }],
      ['POST', `/api/buttons/${btn.id}/nodes`, { tag: 'rect', attrs: {} }],
      ['PATCH', `/api/buttons/${btn.id}/nodes/${node.id}`, { name: 'x' }],
      ['DELETE', `/api/buttons/${btn.id}/nodes/${node.id}`],
      ['POST', `/api/buttons/${btn.id}/nodes/${node.id}/duplicate`, {}],
      ['POST', `/api/buttons/${btn.id}/nodes/${node.id}/animations`, { type: 'pulse' }],
      ['POST', `/api/buttons/${btn.id}/menu/items`, { name: 'x' }],
      ['POST', `/api/buttons/${btn.id}/clone`, {}],
      ['DELETE', `/api/buttons/${btn.id}`]
    ]) assert.equal((await req(m, u, body, B)).status, 403, `${m} ${u}`);
    assert.equal((await req('PUT', `/api/buttons/${btn.id}`, { name: 'Renamed' }, A)).status, 200);

    const wf = (await req('POST', '/api/workflows', { name: 'Alice Flow', visibility: 'private' }, A)).body;
    assert.equal((await req('GET', `/api/workflows/${wf.id}`, undefined, B)).status, 403);
    assert.equal((await req('PUT', `/api/workflows/${wf.id}`, { name: 'Hacked' }, B)).status, 403);
    assert.equal((await req('DELETE', `/api/workflows/${wf.id}`, undefined, B)).status, 403);
    assert.equal((await req('GET', `/api/workflows/${wf.id}`, undefined, A)).status, 200);
  });
});

test('menu items and animations are only reachable through their own design', async () => {
  await withServer(async req => {
    const one = (await req('POST', '/api/buttons', { name: 'One', nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }] })).body;
    const two = (await req('POST', '/api/buttons', { name: 'Two' })).body;
    const item = (await req('POST', `/api/buttons/${one.id}/menu/items`, { name: 'open' })).body;
    assert.ok(item.id);
    assert.equal((await req('PUT', `/api/buttons/${two.id}/menu/items/${item.id}`, { name: 'moved' })).status, 404);
    assert.equal((await req('DELETE', `/api/buttons/${two.id}/menu/items/${item.id}`)).status, 404);
    assert.equal((await req('PUT', `/api/buttons/${one.id}/menu/items/${item.id}`, { name: 'renamed' })).status, 200);
    const anim = await req('POST', `/api/buttons/${one.id}/nodes/${one.nodes[0].id}/animations`, { type: 'pulse' });
    assert.equal(anim.status, 200);
    assert.equal((await req('DELETE', `/api/buttons/${two.id}/animations/${anim.body.id}`)).status, 404);
    assert.equal((await req('DELETE', `/api/buttons/${one.id}/animations/${anim.body.id}`)).status, 200);
  });
});

test('global settings, themes, the user list and server paths are for admins', async () => {
  await withServer(async req => {
    const u = (await req('POST', '/api/auth/register', { username: 'carol', email: 'carol@example.com', password: 'secret123' })).body;
    const U = auth(u.token);
    assert.equal((await req('PUT', '/api/settings', { theme: 'dark' }, U)).status, 403);
    assert.equal((await req('POST', '/api/themes', { name: 'Mine', key: 'mine' }, U)).status, 403);
    assert.equal((await req('POST', '/api/export/folder', { folder: '/tmp/x-export' }, U)).status, 403);
    assert.equal((await req('POST', '/api/import/folder', { as: 'icon', folderPath: '/etc' }, U)).status, 403);
    const users = (await req('GET', '/api/users', undefined, U)).body;
    assert.equal(users.some(x => 'email' in x || 'permissions' in x), false);
    assert.equal((await req('GET', '/api/users')).body.some(x => 'email' in x), true);
    // an admin is still confined to the import roots
    assert.equal((await req('POST', '/api/import/folder', { as: 'icon', folderPath: "/etc" })).status, 422);
  });
});

test('cross-site requests are refused', async () => {
  await withServer(async req => {
    assert.equal((await req('POST', '/api/icons', { name: 'Evil' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('POST', '/api/icons', { name: 'Fine' }, { origin: 'http://127.0.0.1:5180' })).status, 200);
    assert.equal((await req('POST', '/api/icons', { name: 'Form' }, { 'content-type': 'text/plain' })).status, 415);
  });
});

test('.env values keep #, quotes inside quotes and drop trailing comments', async () => {
  const { envValue } = await import('../infrastructure/postgres/pg-sync-service.js');
  assert.equal(envValue('"p#ss\'word"'), "p#ss'word");
  assert.equal(envValue("'a\"b#c'  # note"), 'a"b#c');
  assert.equal(envValue('plain#hash  # comment'), 'plain#hash');
  assert.equal(envValue('"${PGPORT:-5432}"'), '${PGPORT:-5432}');
});

test('a failed pull changes nothing locally', async () => {
  const { PostgresSyncService } = await import('../infrastructure/postgres/pg-sync-service.js');
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const svc = new PostgresSyncService({ db: c.db, config: { host: 'none', database: 'none' } });
    svc.schemaInitialized = true;
    const before = c.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    let calls = 0;
    // first table answers with a new user, a later one fails: the user must not be kept
    svc.execPg = q => {
      calls += 1;
      if (/"users"/.test(q)) return { ok: true, stdout: JSON.stringify([{ id: 9001, username: 'ghost', email: 'ghost@example.com', role: 'designer' }]) };
      if (calls > 3) return { ok: false, error: 'connection lost' };
      return { ok: true, stdout: '[]' };
    };
    const res = svc.pullFromPostgres();
    assert.equal(res.ok, false);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
    assert.equal(c.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally { c.close(); }
});

test('static files answer 304 when unchanged', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const server = createHttpServer(c, { webRoot: new URL('../interfaces/web/', import.meta.url).pathname, domainRoot: new URL('../domain/', import.meta.url).pathname });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
  c.__port = server.address().port;
    const first = await fetch(base + '/domain/geometry.js');
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    assert.equal((await fetch(base + '/domain/geometry.js', { headers: { 'if-none-match': etag } })).status, 304);
  } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)); c.close(); }
});

/** A PostgresSyncService whose `psql` is a stub: `remote` holds the revision marker and the rows per table. */
async function fakeSync(c, remote) {
  const { PostgresSyncService } = await import('../infrastructure/postgres/pg-sync-service.js');
  const svc = new PostgresSyncService({ db: c.db, config: { host: 'none', database: 'none' } });
  svc.schemaInitialized = true;
  svc.pushes = 0;
  svc.execPg = q => {
    if (/SELECT value FROM sync_meta/.test(q) && !/BEGIN;/.test(q)) return { ok: true, stdout: remote.revision || '' };
    const sel = /FROM \(SELECT \* FROM "(\w+)"\)/.exec(q);
    if (sel) return { ok: true, stdout: JSON.stringify(remote.rows?.[sel[1]] || []) };
    if (/^BEGIN;/.test(q)) { svc.pushes += 1; remote.revision = /VALUES \('revision', '([^']+)'\)/.exec(q)[1]; return { ok: true, stdout: '' }; }
    return { ok: true, stdout: '' };
  };
  return svc;
}

test('push is refused when another machine pushed since the last sync', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const remote = { revision: '' };
    const svc = await fakeSync(c, remote);
    assert.equal(svc.pushToPostgres().ok, true);            // nobody pushed yet
    assert.equal(svc.pushToPostgres().ok, true);            // our own revision is still there
    remote.revision = 'pushed-by-another-machine';
    const refused = svc.pushToPostgres();
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'REMOTE_CHANGED');
    assert.equal(svc.pushes, 2);
    assert.equal(svc.pushToPostgres({ force: true }).ok, true);
    assert.equal(svc.pushes, 3);
  } finally { c.close(); }
});

test('pull keeps unsynced local edits unless forced, and applies remote deletions', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const old = c.services.icon.create({ name: 'Old Icon' });
    c.db.prepare("UPDATE icons SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(old.id);
    const remote = { revision: 'r1', rows: {} };
    const svc = await fakeSync(c, remote);
    svc.setState('lastSyncAt', '2024-01-01T00:00:00.000Z');
    c.db.prepare('UPDATE sync_outbox SET synced = 1').run();
    const fresh = c.services.icon.create({ name: 'Fresh Icon' });   // created after the last sync, never pushed
    remote.rows.icons = [{ ...c.db.prepare('SELECT * FROM icons WHERE id = ?').get(fresh.id), id: 987654, key: 'remote-only', uid: 'remote-only-uid' }];

    svc.enqueue('icons', fresh.id, 'insert', {});
    const refused = svc.pullFromPostgres();
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'LOCAL_UNSYNCED');
    assert.ok(c.db.prepare('SELECT 1 FROM icons WHERE id = ?').get(old.id));

    const pulled = svc.pullFromPostgres({ force: true });
    assert.equal(pulled.ok, true, pulled.error);
    assert.equal(c.db.prepare('SELECT 1 FROM icons WHERE id = ?').get(old.id), undefined, 'deleted remotely -> deleted locally');
    assert.ok(c.db.prepare('SELECT 1 FROM icons WHERE id = ?').get(fresh.id), 'created after the last sync -> kept');
    assert.equal(svc.getState('remoteRevision'), 'r1');
    assert.equal(svc.pendingCount(), 0);
  } finally { c.close(); }
});

test('a collaborator keeps one open change request per item', async () => {
  await withServer(async (req, c) => {
    const a = (await req('POST', '/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'secret123' })).body;
    const b = (await req('POST', '/api/auth/register', { username: 'bobby', email: 'bobby@example.com', password: 'secret123' })).body;
    const icon = (await req('POST', '/api/icons', { name: 'Shared Icon', visibility: 'public', nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }] }, auth(a.token))).body;
    const B = auth(b.token);
    for (let i = 1; i <= 4; i++) assert.equal((await req('PATCH', `/api/icons/${icon.id}/nodes/${icon.nodes[0].id}`, { attrs: { x: i } }, B)).status, 200);
    const mine = c.collaboration.list({ targetType: 'icon', targetId: icon.id, authorId: b.user.id, status: 'pending' });
    assert.equal(mine.length, 1);
    assert.equal(Number(mine[0].beforeSnapshot.nodes[0].attrs.x), 0, 'the first state stays the "before"');
    assert.equal(Number(mine[0].afterSnapshot.nodes[0].attrs.x), 4);
  });
});

test('project button settings leave other projects and the public library alone', async () => {
  await withServer(async (req, c) => {
    const a = (await req('POST', '/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'secret123' })).body;
    const A = auth(a.token);
    const proj = (await req('POST', '/api/projects', { name: 'Alice Project' }, A)).body;
    const own = (await req('POST', '/api/buttons', { name: 'Own Button', projectId: proj.id, visibility: 'project' }, A)).body;
    const lib = (await req('POST', '/api/buttons', { name: 'Library Button', projectId: 1, visibility: 'public' })).body;
    const before = JSON.stringify(c.services.button.get(lib.id).meta);
    const r = await req('POST', `/api/projects/${proj.id}/button-settings`, { buttonStyle: 'square', buttonIconSizePct: 80 }, A);
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(c.services.button.get(lib.id).meta), before);
    assert.equal(c.services.button.get(own.id).meta.buttonStyle, r.body.buttonStyle);
    assert.equal((await req('POST', '/api/projects/1/button-settings', { buttonStyle: 'square' }, A)).status, 403);
  });
});

test('an edited built-in template survives a restart; deleting a used item touches its users', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const dev = c.templates.listDevices({}).find(d => d.builtin);
    c.templates.saveDevice({ id: dev.id, name: 'My Renamed Device' });
    c.templates.seedDefaults();
    assert.equal(c.templates.listDevices({}).find(d => d.id === dev.id).name, 'My Renamed Device');

    const icon = c.services.icon.create({ name: 'Used Icon' });
    const btn = c.services.button.create({ name: 'User Button' }, { nodes: [{ tag: 'use', refType: 'icon', refId: icon.id, attrs: {} }] });
    c.db.prepare("UPDATE buttons SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(btn.id);
    c.services.icon.remove(icon.id, { permanent: true });
    assert.notEqual(c.db.prepare('SELECT updated_at FROM buttons WHERE id = ?').get(btn.id).updated_at, '2020-01-01 00:00:00');
    assert.ok(c.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_icons_scope'").get());
  } finally { c.close(); }
});

test('release mode: bootstrap and live events give nothing away before sign-in; the cookie signs image requests in', async () => {
  await withServer(async (req, c) => {
    const b = (await req('GET', '/api/bootstrap')).body;
    assert.equal(b.user, null);
    assert.deepEqual(b.projects, []);
    assert.equal(b.counts.users, 0);
    assert.equal((await req('GET', '/api/events')).status, 401);
    assert.equal((await req('POST', '/api/auth/dev-bypass', {})).status, 403);
    const login = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const full = (await req('GET', '/api/bootstrap', undefined, auth(login.token))).body;
    assert.equal(full.user.username, 'superadmin');
    const screen = c.services.screen.create({ name: 'Cookie Screen' });
    assert.equal((await req('GET', `/api/screens/${screen.id}/svg`)).status, 401);
    assert.equal((await req('GET', `/api/screens/${screen.id}/svg`, undefined, { cookie: `other=1; ud_auth_token=${login.token}` })).status, 200);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('rejecting a request that others built on needs force', async () => {
  await withServer(async (req, c) => {
    const reg = async n => (await req('POST', '/api/auth/register', { username: n, email: `${n}@example.com`, password: 'secret123' })).body;
    const a = await reg('alice'), b = await reg('bobby'), d = await reg('dave');
    const icon = (await req('POST', '/api/icons', { name: 'Shared Icon', visibility: 'public', nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }] }, auth(a.token))).body;
    const edit = (who, x) => req('PATCH', `/api/icons/${icon.id}/nodes/${icon.nodes[0].id}`, { attrs: { x } }, auth(who.token));
    await edit(b, 1); await edit(d, 2);
    const first = c.collaboration.list({ targetType: 'icon', targetId: icon.id, authorId: b.user.id })[0];
    assert.equal((await req('POST', `/api/changes/${first.id}/reject`, {}, auth(a.token))).status, 409);
    assert.equal((await req('POST', `/api/changes/${first.id}/reject`, { force: true }, auth(a.token))).status, 200);
  });
});

test('a push empties the synced outbox and keeps the total; expired sessions are purged', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const svc = await fakeSync(c, { revision: '' });
    svc.enqueue('icons', 1, 'upsert', {}); svc.enqueue('icons', 2, 'upsert', {});
    const pending = svc.pendingCount();
    assert.ok(pending >= 2);
    assert.equal(svc.pushToPostgres().ok, true);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n, 0);
    assert.equal(svc.syncedCount(), pending);

    c.users.createSession('ud_old', 1, '2020-01-01T00:00:00.000Z');
    c.users.createSession('ud_new', 1, '2999-01-01T00:00:00.000Z');
    assert.equal(c.users.purgeExpiredSessions(), 1);
    assert.ok(c.users.getSession('ud_new'));
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token LIKE 'ud_%'").get().n, 0, 'tokens are stored hashed');
  } finally { c.close(); }
});

/* ---- batch 6: passwords, sessions, sign-in limits, MCP transport ---- */

test('one password policy: register, admin create and admin reset; no default password or address', async () => {
  await withServer(async (req, c) => {
    assert.equal((await req('POST', '/api/auth/register', { username: 'shorty', email: 'shorty@example.com', password: 'abcd' })).status, 422);
    assert.equal((await req('POST', '/api/auth/register', { username: 'nodigit', email: 'nodigit@example.com', password: 'abcdefghij' })).status, 422);
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    assert.equal((await req('POST', '/api/users', { username: 'nopass', email: 'nopass@example.com' }, auth(su.token))).status, 422);
    assert.equal((await req('POST', '/api/users', { username: 'nomail', password: 'secret123' }, auth(su.token))).status, 422);
    const made = await req('POST', '/api/users', { username: 'erin', email: 'erin@example.com', password: 'secret123', role: 'reviewer' }, auth(su.token));
    assert.equal(made.status, 200);
    assert.equal(made.body.role, 'reviewer');
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(made.body.id).n, 0, 'creating a user leaves no session behind');
    assert.equal((await req('PUT', `/api/users/${made.body.id}`, { password: 'abc' }, auth(su.token))).status, 422, 'a short password is refused, not ignored');
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('a password reset signs the user out everywhere; session tokens are stored hashed and not read from the URL', async () => {
  await withServer(async (req, c) => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const erin = (await req('POST', '/api/auth/register', { username: 'erin', email: 'erin@example.com', password: 'secret123' })).body;
    assert.equal((await req('GET', '/api/screens', undefined, auth(erin.token))).status, 200);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(erin.token).n, 0);
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token NOT LIKE 'h1:%'").get().n, 0);
    assert.equal((await req('GET', `/api/screens?token=${erin.token}`)).status, 401, 'no token in the query string');

    assert.equal((await req('PUT', `/api/users/${erin.user.id}`, { password: 'Reset1234' }, auth(su.token))).status, 200);
    assert.equal((await req('GET', '/api/screens', undefined, auth(erin.token))).status, 401, 'old session is gone');
    assert.equal((await req('POST', '/api/auth/login', { username: 'erin', password: 'Reset1234' })).status, 200);

    // a session row written before hashing (clear token) is converted at start and still works
    c.db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('ud_legacy', ?, '2999-01-01T00:00:00.000Z')").run(erin.user.id);
    assert.equal(c.users.hashLegacySessions(), 1);
    assert.equal((await req('GET', '/api/screens', undefined, auth('ud_legacy'))).status, 200);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('sign-in: limited attempts, the same answer for a wrong name and a wrong password, state only after the password', async () => {
  await withServer(async (req, c) => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const erin = (await req('POST', '/api/auth/register', { username: 'erin', email: 'erin@example.com', password: 'secret123' })).body;
    await req('PUT', `/api/users/${erin.user.id}`, { status: 'suspended' }, auth(su.token));
    const wrongName = await req('POST', '/api/auth/login', { username: 'nobody', password: 'x1234567' });
    const wrongPass = await req('POST', '/api/auth/login', { username: 'erin', password: 'x1234567' });
    assert.equal(wrongName.status, 401);
    assert.equal(wrongPass.status, 401, 'a suspended account is not revealed to a wrong password');
    assert.equal(wrongName.body.error.message, wrongPass.body.error.message);
    assert.equal((await req('POST', '/api/auth/login', { username: 'erin', password: 'secret123' })).status, 403);

    for (let i = 0; i < 10; i++) await req('POST', '/api/auth/login', { username: 'admin', password: `wrong${i}` });
    const locked = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
    assert.equal((await req('POST', '/api/auth/login', { username: 'user', password: 'user' })).status, 200, 'other accounts are not affected');
    c.db.prepare('DELETE FROM login_failures').run();
    assert.equal((await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).status, 200);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('users: the actor is required; an owner of projects or items is not deleted; transfer needs the password', async () => {
  await withServer(async (req, c) => {
    const su = c.auth.superadminUser();
    assert.throws(() => c.auth.updateUser(su.id, { displayName: 'x' }), e => e.status === 403);
    assert.throws(() => c.auth.deleteUser(null, 2), e => e.status === 403);
    assert.throws(() => c.auth.createUserByAdmin(null, { username: 'zed', email: 'zed@example.com', password: 'secret123' }), e => e.status === 403);
    const erin = c.auth.register({ username: 'erin', email: 'erin@example.com', password: 'secret123' }).user;
    assert.throws(() => c.auth.transferSuperadmin(su, erin.id, { confirm: true }), /password/i);
    const proj = c.projects.create({ name: 'Erin Project', visibility: 'private' }, { actor: erin });
    assert.throws(() => c.auth.deleteUser(su, erin.id), e => e.status === 409 && /still owns 1 project/.test(e.message));
    c.projects.remove(proj.id, { actor: erin });
    assert.equal(c.auth.deleteUser(su, erin.id).deleted, true);
  });
});

test('downloads: file names are quoted and escaped; sync status hides connection details from non-admins', async () => {
  const { attachmentHeader } = await import('../interfaces/http/server.js');
  assert.equal(attachmentHeader('a"b\r\nx: y/z.svg'), `attachment; filename="a_b__x: y_z.svg"; filename*=UTF-8''a_b__x%3A%20y_z.svg`);
  assert.match(attachmentHeader('ikona-ž.svg'), /filename="ikona-_\.svg"; filename\*=UTF-8''ikona-%C5%BE\.svg$/);
  await withServer(async req => {
    const erin = (await req('POST', '/api/auth/register', { username: 'erin', email: 'erin@example.com', password: 'secret123' })).body;
    const st = (await req('GET', '/api/sync/status', undefined, auth(erin.token))).body;
    assert.equal('host' in st || 'database' in st || 'postgresHost' in st, false);
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    assert.equal('database' in (await req('GET', '/api/sync/status', undefined, auth(su.token))).body, true);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('MCP transport: DELETE needs the key, rejected keys are limited per address, the limiter sweeps on a schedule', async () => {
  const { RateLimiter } = await import('../mcp/server/rate-limiter.js');
  let t = 0;
  const rl = new RateLimiter({ a: { limit: 2, windowMs: 100 }, b: { limit: 2, windowMs: 10_000 } }, () => t, { sweepEvery: 3 });
  rl.hit('a', 1); rl.hit('b', 1);
  t = 500;
  rl.hit('a', 2);   // third hit: sweep with each counter's own window
  assert.deepEqual([...rl.counters.keys()].sort(), ['a:2', 'b:1']);
  assert.equal(rl.status('nope', 1).used, 0);

  await withServer(async (req, c) => {
    if (!c.mcp?.http) return;
    assert.equal((await req('DELETE', '/mcp', undefined, { 'mcp-session-id': 'x' })).status, 401);
    let last;
    for (let i = 0; i < 21; i++) last = await req('POST', '/mcp', { jsonrpc: '2.0', id: i, method: 'ping' }, auth(`kud_wrong_${i}`));
    assert.equal(last.status, 429);
  });
});

/* ---- batch 7: display order, delete of a used item, copies of nested lists, reference repair log ---- */

test('display order writes one or two rows and leaves other projects alone', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' }).user;
    const p1 = c.projects.create({ name: 'One' }, { actor: ada }), p2 = c.projects.create({ name: 'Two' }, { actor: ada });
    const mk = (n, p) => c.button.create({ name: n, key: n.toLowerCase(), projectId: p.id, visibility: 'project', creatorId: ada.id }, { nodes: [] });
    const a = mk('A', p1), x = mk('X', p2), b = mk('B', p1), y = mk('Y', p2), d = mk('D', p1);
    const pos = id => c.db.prepare('SELECT position FROM buttons WHERE id = ?').get(id).position;
    const order = p => c.db.prepare('SELECT name FROM buttons WHERE project_id = ? ORDER BY position, name').all(p.id).map(r => r.name).join('');
    const other = [pos(x.id), pos(y.id)];
    assert.equal(c.button.reorder(d.id, 'forward', { actor: ada }).touched, 2);
    assert.equal(order(p1), 'ADB');
    assert.equal(c.button.reorder(b.id, 'front', { actor: ada }).touched, 1);
    assert.equal(order(p1), 'BAD');
    assert.equal(c.button.reorder(b.id, 'back', { actor: ada }).touched, 1);
    assert.equal(order(p1), 'ADB');
    assert.equal(c.button.reorder(a.id, 'front', { actor: ada }).touched, 0, 'already first in its project');
    assert.deepEqual([pos(x.id), pos(y.id)], other);
    assert.equal(order(p2), 'XY');
  } finally { c.close(); }
});

test('deleting an item that other designs use needs a confirmation (force)', async () => {
  await withServer(async (req, c) => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const icon = c.services.icon.create({ name: 'Used Icon' }, { nodes: [] });
    const btn = c.services.button.create({ name: 'User Button' }, { nodes: [{ tag: 'use', refType: 'icon', refId: icon.id, attrs: {} }] });
    const free = c.services.icon.create({ name: 'Free Icon' }, { nodes: [] });
    const refused = await req('DELETE', `/api/icons/${icon.id}`, undefined, auth(su.token));
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'IN_USE');
    assert.equal(refused.body.error.details.usage, 1);
    assert.equal(c.services.button.get(btn.id).nodes.length, 1, 'nothing was removed');
    assert.equal((await req('DELETE', `/api/icons/${free.id}`, undefined, auth(su.token))).status, 200);
    assert.equal((await req('DELETE', `/api/icons/${icon.id}?force=1`, undefined, auth(su.token))).status, 200);
    assert.equal(c.services.button.get(btn.id).nodes.length, 0);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('helpers: parents-first order at any depth, translate forms on duplicate, reference repair reports what it removed', async () => {
  const { parentsFirst } = await import('../application/user-project-collab-service.js');
  const list = [{ id: 3, parentId: 2 }, { id: 2, parentId: 1 }, { id: 1, parentId: null }, { id: 4, parentId: 3 }];
  assert.deepEqual(parentsFirst(list).map(x => x.id), [1, 2, 3, 4]);
  assert.deepEqual(parentsFirst([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }]).length, 2, 'a cycle does not hang');

  const { shiftAttrs } = await import('../application/design-service.js');
  const shift = transform => { const a = { transform }; shiftAttrs({ tag: 'g' }, a, 10, 20); return a.transform; };
  assert.equal(shift('translate(5)'), 'translate(15 20)');
  assert.equal(shift('translate(1e2, 3)'), 'translate(110 23)');
  assert.equal(shift('rotate(45) translate(5 6) scale(2)'), 'rotate(45) translate(15 26) scale(2)');
  assert.equal(shift('scale(2)'), 'translate(10 20) scale(2)');
  assert.equal(shift(undefined), 'translate(10 20)');

  const { healForeignKeys } = await import('../infrastructure/sqlite/database.js');
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    c.db.exec('PRAGMA foreign_keys = OFF');
    c.db.prepare("INSERT INTO menu_items (button_id, label) VALUES (987654, 'orphan')").run();
    const lines = [];
    const out = healForeignKeys(c.db, { log: m => lines.push(m) });
    assert.equal(out.changed.some(x => /menu_items without button/.test(x.what) && x.rows === 1), true);
    assert.match(lines.join('\n'), /1 × menu_items without button/);
    assert.deepEqual(healForeignKeys(c.db, { log: m => lines.push(m) }).changed, []);
  } finally { c.db.exec('PRAGMA foreign_keys = ON'); c.close(); }
});

/* ---- batch 8: sync outbox (triggers, no row copies) and non-blocking push / pull ---- */

test('the outbox records every write path once per record, without row copies', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const svc = await fakeSync(c, { revision: '' });
    assert.equal(svc.pushToPostgres().ok, true);
    assert.equal(svc.pendingCount(), 0);
    const icon = c.services.icon.create({ name: 'Tracked' }, { nodes: [{ tag: 'rect', attrs: {} }, { tag: 'circle', attrs: {} }] });
    const afterCreate = svc.pendingCount();
    c.services.icon.update(icon.id, { label: 'one' });
    c.services.icon.update(icon.id, { label: 'two' });
    assert.equal(svc.pendingCount(), afterCreate, 'a record that is already waiting is not added again');
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE payload <> '{}'").get().n, 0);

    assert.equal(svc.pushToPostgres().ok, true);
    c.db.prepare("UPDATE icons SET visibility = 'project' WHERE id = ?").run(icon.id);            // raw SQL, no repository
    assert.deepEqual(c.db.prepare("SELECT table_name, record_id, operation FROM sync_outbox WHERE synced = 0").all().map(r => ({ ...r })),
      [{ table_name: 'icons', record_id: String(icon.id), operation: 'upsert' }]);
    assert.equal(svc.pushToPostgres().ok, true);
    c.db.prepare('DELETE FROM icons WHERE id = ?').run(icon.id);
    c.db.prepare("DELETE FROM nodes WHERE owner_type = 'icon' AND owner_id = ?").run(icon.id);
    const ops = c.db.prepare("SELECT table_name, operation FROM sync_outbox WHERE synced = 0 ORDER BY id").all().map(r => `${r.table_name}:${r.operation}`);
    assert.deepEqual(ops, ['icons:delete', 'nodes:delete', 'nodes:delete']);
  } finally { c.close(); }
});

test('non-blocking push: changes made while it runs stay pending, a second sync is refused, a failed push keeps everything pending', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const remote = { revision: '' };
    const svc = await fakeSync(c, remote);
    assert.equal((await svc.pushToPostgresAsync()).ok, true);
    const icon = c.services.icon.create({ name: 'Before Push' });
    const inner = svc.execPg;
    let during = null;
    svc.execPg = (q, o) => {
      if (/^BEGIN;/.test(q)) {
        c.services.icon.update(icon.id, { label: 'edited while pushing' });
        during = svc.pushToPostgresAsync();   // a second sync while this one runs
      }
      return inner(q, o);
    };
    const res = await svc.pushToPostgresAsync();
    assert.equal(res.ok, true);
    assert.equal((await during).code, 'BUSY');
    assert.deepEqual(c.db.prepare('SELECT table_name, record_id FROM sync_outbox WHERE synced <> 1').all().map(r => `${r.table_name}:${r.record_id}`), [`icons:${icon.id}`]);

    svc.execPg = q => (/^BEGIN;/.test(q) ? { ok: false, error: 'connection lost' } : inner(q));
    const failed = await svc.syncNowAsync();
    assert.equal(failed.ok, false);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE synced = 2').get().n, 0);
    assert.equal(svc.pendingCount(), 1);
    assert.equal(svc.busy, null);
  } finally { c.close(); }
});

test('push sends only the columns the remote has and removes unique conflicts with one statement per table', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const svc = await fakeSync(c, { revision: '' });
    const inner = svc.execPg;
    let sent = '';
    const cols = c.db.prepare('PRAGMA table_info(themes)').all().map(x => x.name).filter(n => n !== 'surfaces');
    svc.execPg = (q, o) => {
      if (/information_schema\.columns/.test(q)) return { ok: true, stdout: cols.map(n => `themes.${n}`).join('\n') };
      if (/^BEGIN;/.test(q)) sent = q;
      return inner(q, o);
    };
    const res = svc.pushToPostgres();
    assert.equal(res.ok, true);
    assert.deepEqual(res.skippedColumns, { themes: ['surfaces'] });
    assert.equal(/INSERT INTO "themes" \([^)]*"surfaces"/.test(sent), false);
    assert.equal(/INSERT INTO "users" \([^)]*"username"/.test(sent), true, 'tables the remote did not describe keep all columns');
    const themeDeletes = sent.split('\n').filter(l => /^DELETE FROM "themes" AS r USING/.test(l)).length;
    assert.equal(themeDeletes, 1);
    assert.equal(/DELETE FROM "themes" WHERE "key" = /.test(sent), false, 'no per-row statements');
  } finally { c.close(); }
});

/* ---- batch 9: list and search paths ---- */

test('icon search filters, counts and pages in SQL (terms, pack, Unicode case, LIKE wildcards)', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const mk = (name, extra = {}) => c.services.icon.create({ name, visibility: 'public', ...extra }, { nodes: [] });
    mk('Zeta Arrow Left', { tags: ['nav'] }); mk('Zeta Arrow Right', { tags: ['nav'] }); mk('Zeta Домик', { tags: ['home'] });
    mk('Zeta 100% Done'); mk('Zeta Packed One', { category: 'pack-lucide' }); mk('Zeta Packed Two', { meta: { pack: 'Lucide' } });
    const s = (q, o = {}) => c.iconCatalog.search({ q, ...o });
    assert.equal(s('zeta arrow').total, 2);
    assert.equal(s('zeta nav right').items.map(i => i.name).join(), 'Zeta Arrow Right');
    assert.equal(s('ДОМИК').total, 1, 'Unicode lower-casing');
    assert.equal(s('zeta 100%').total, 1, '% is a character, not a wildcard');
    assert.equal(s('zeta_arrow').total, 0, '_ is a character, not a wildcard');
    assert.equal(s('zeta', { pack: 'lucide' }).total, 2);
    assert.equal(s('zeta', { pack: 'builtin' }).total, 4);
    const page = s('zeta', { limit: 2, offset: 1 });
    assert.equal(page.total, 6);
    assert.equal(page.items.length, 2);
    const all = s('zeta', { limit: 1000 }).items.map(i => i.id);
    assert.deepEqual(page.items.map(i => i.id), all.slice(1, 3));

    const [a, b] = all;
    assert.deepEqual(c.iconCatalog.full([b, 999999, a]).map(i => i.id), [b, a], 'the order asked for; unknown ids skipped');
  } finally { c.close(); }
});

test('lists read users and usage once, change lists skip the snapshots, statements are compiled once', async () => {
  await withServer(async (req, c) => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    assert.equal(su.user.username, 'superadmin');
    const icon = c.services.icon.create({ name: 'Counted Icon' }, { nodes: [] });
    c.services.button.create({ name: 'Uses It' }, { nodes: [{ tag: 'use', refType: 'icon', refId: icon.id, attrs: {} }, { tag: 'use', refType: 'icon', refId: icon.id, attrs: {} }] });
    const row = c.services.icon.list({}).find(i => i.id === icon.id);
    assert.equal(row.usage, 2);
    assert.equal(row.creatorUsername.length > 0, true);
    const full = c.services.button.listFull({ q: 'Uses It' });
    assert.equal(full.length, 1);
    assert.equal(full[0].nodes.length, 2);

    const erin = (await req('POST', '/api/auth/register', { username: 'erin', email: 'erin@example.com', password: 'secret123' })).body;
    const pub = c.services.icon.create({ name: 'Public Shared', visibility: 'public' }, { nodes: [], actorId: su.user.id });
    await req('PUT', `/api/icons/${pub.id}`, { label: 'edited by erin' }, auth(erin.token));
    const lite = (await req('GET', '/api/changes?lite=1', undefined, auth(su.token))).body;
    const fullList = (await req('GET', '/api/changes', undefined, auth(su.token))).body;
    assert.equal(lite.length, fullList.length);
    if (lite.length) {
      assert.equal('beforeSnapshot' in lite[0] || 'afterSnapshot' in lite[0], false);
      assert.equal('afterSnapshot' in fullList[0], true);
      assert.equal(lite[0].targetName, fullList[0].targetName);
    }

    const sql = 'SELECT COUNT(*) AS n FROM icons WHERE id > ?';
    assert.equal(c.db.prepare(sql), c.db.prepare(sql), 'the same statement object is reused');
    assert.equal(c.db.statementCache.size <= 400, true);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('saving a design rewrites only the nodes that changed', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const svc = await fakeSync(c, { revision: '' });
    const icon = c.services.icon.create({ name: 'Three Nodes' }, { nodes: [
      { tag: 'rect', attrs: { x: 1 }, animations: [{ type: 'pulse', params: { scale: 1.1 } }] }, { tag: 'circle', attrs: { r: 2 } }, { tag: 'path', attrs: { d: 'M0 0' } }] });
    const nodes = c.services.icon.get(icon.id).nodes;
    const animId = c.db.prepare('SELECT id FROM animations WHERE node_id = ?').get(nodes[0].id).id;
    assert.equal(svc.pushToPostgres().ok, true);

    c.services.icon.replaceNodes(icon.id, nodes.map(n => ({ ...n, animations: n.id === nodes[0].id ? [{ type: 'pulse', params: { scale: 1.1 } }] : [] })));
    const none = c.db.prepare("SELECT table_name FROM sync_outbox WHERE synced = 0 AND table_name IN ('nodes', 'animations')").all();
    assert.equal(none.length, 0, 'nothing changed: no node or animation was written');
    assert.equal(c.db.prepare('SELECT id FROM animations WHERE node_id = ?').get(nodes[0].id).id, animId, 'the animation row was kept');

    c.services.icon.replaceNodes(icon.id, nodes.map(n => (n.id === nodes[1].id ? { ...n, attrs: { r: 9 } } : n)));
    const changed = c.db.prepare("SELECT record_id FROM sync_outbox WHERE synced = 0 AND table_name = 'nodes'").all().map(r => Number(r.record_id));
    assert.deepEqual(changed, [nodes[1].id]);
    assert.equal(c.services.icon.get(icon.id).nodes.find(n => n.id === nodes[1].id).attrs.r, 9);
  } finally { c.close(); }
});

/* ---- batch 9b: repeated writes and the browser offline queue ---- */

test('a write repeated with the same idempotency key is done once', async () => {
  await withServer(async (req, c) => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const h = { ...auth(su.token), 'x-idempotency-key': 'k-1' };
    const before = c.db.prepare('SELECT COUNT(*) AS n FROM icons').get().n;
    const first = await req('POST', '/api/icons', { name: 'Once Only' }, h);
    const again = await req('POST', '/api/icons', { name: 'Once Only' }, h);
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM icons').get().n, before + 1);
    const other = await req('POST', '/api/icons', { name: 'Once Only' }, { ...auth(su.token), 'x-idempotency-key': 'k-2' });
    assert.notEqual(other.body.id, first.body.id, 'another key is another write');
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('offline queue: refused writes are dropped, unreachable ones stay, another user\'s entries are not sent', async () => {
  const store = new Map();
  const saved = { ls: globalThis.localStorage, fetch: globalThis.fetch, window: globalThis.window };
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const events = [];
  globalThis.window = { dispatchEvent: e => events.push(e.type) };
  try {
    const { api, setAuthSession } = await import('../interfaces/web/js/api.js');
    setAuthSession({ token: 'ud_x', userId: 7 });
    const sent = [];
    const answer = (status, body) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => '' });
    globalThis.fetch = async (url, init) => {
      sent.push({ url, key: init.headers['x-idempotency-key'] });
      if (url.includes('offline')) throw new TypeError('fetch failed');
      if (url.includes('gone')) return answer(404, { error: { code: 'NOT_FOUND', message: 'not found' } });
      return answer(200, { ok: true });
    };
    await assert.rejects(api.put('/api/icons/1?offline', { label: 'a' }));
    assert.equal(api.outbox().length, 1);
    const key = api.outbox()[0].id;
    assert.equal(api.outbox()[0].userId, 7);
    store.set('ud_offline_outbox_v2', JSON.stringify([...api.outbox(),
      { id: 'q2', userId: 7, method: 'PUT', url: '/api/icons/2?gone', body: {} },
      { id: 'q3', userId: 7, method: 'PUT', url: '/api/icons/3', body: {} },
      { id: 'q4', userId: 8, method: 'PUT', url: '/api/icons/4', body: {} }]));
    sent.length = 0;
    const r = await api.flushOutbox();
    assert.equal(r.flushed, 1);
    assert.equal(r.remaining, 2);
    assert.equal(r.foreign, 1);
    assert.deepEqual(r.dropped.map(d => d.status), [404]);
    assert.deepEqual(sent.map(x => x.key), [key, 'q2', 'q3'], 'each replay carries its own key; the other user\'s entry is not sent');
    assert.deepEqual(api.outbox().map(x => x.id), [key, 'q4'], 'the unreachable write is queued once, not twice');
  } finally {
    globalThis.localStorage = saved.ls; globalThis.fetch = saved.fetch; globalThis.window = saved.window;
  }
});

test('live sync says whether one design or the lists changed', async () => {
  const { changeScope } = await import('../interfaces/http/server.js');
  assert.equal(changeScope('/api/icons/5', 'PUT'), 'item');
  assert.equal(changeScope('/api/buttons/12/menu/items/3', 'DELETE'), 'item');
  assert.equal(changeScope('/api/screens/2/nodes', 'POST'), 'item');
  assert.equal(changeScope('/api/icons/5', 'DELETE'), 'list');
  assert.equal(changeScope('/api/icons', 'POST'), 'list');
  assert.equal(changeScope('/api/icons/5/order', 'POST'), 'list');
  assert.equal(changeScope('/api/icons/5/clone', 'POST'), 'list');
  assert.equal(changeScope('/api/projects/3', 'PUT'), 'list');
});

test('a record written without an actor is owned by the superadmin found by role, not by id 1', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const su = c.auth.superadminUser();
    const other = c.auth.register({ username: 'carol', email: 'carol@example.com', password: 'secret123' }).user;
    // hand the role over the way a pull that remaps ids would leave it: the superadmin is no longer the lowest id
    c.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(su.id);
    c.db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(other.id);
    assert.equal(c.auth.users.defaultOwnerId(), other.id);
    const row = c.db.prepare('SELECT creator_id, root_owner_id FROM icons WHERE id = ?')
      .get(c.services.icon.designs.create({ key: 'no-actor', name: 'No Actor', width: 24, height: 24, visibility: 'private' }).id);
    assert.equal(row.creator_id, other.id);
    assert.equal(row.root_owner_id, other.id);
  } finally { c.close(); }
});

test('register, password change and admin reset work through the non-blocking hash and keep every check', async () => {
  await withServer(async (req, c) => {
    const weak = await req('POST', '/api/auth/register', { username: 'dave', email: 'dave@example.com', password: 'short' });
    assert.equal(weak.status, 422);
    const d = (await req('POST', '/api/auth/register', { username: 'dave', email: 'dave@example.com', password: 'secret123' })).body;
    assert.ok(String(c.auth.users.getWithAuth(d.user.id).salt).startsWith('u1:'));
    const D = auth(d.token);
    assert.equal((await req('POST', '/api/auth/profile/password', { currentPassword: 'wrong-one1', newPassword: 'another456' }, D)).status, 422);
    assert.equal((await req('POST', '/api/auth/profile/password', { currentPassword: 'secret123', newPassword: 'secret123' }, D)).status, 422);
    assert.equal((await req('POST', '/api/auth/profile/password', { currentPassword: 'secret123', newPassword: 'another456' }, D)).status, 200);
    assert.equal((await req('POST', '/api/auth/login', { username: 'dave', password: 'another456' })).status, 200);
    assert.equal((await req('POST', '/api/auth/login', { username: 'dave', password: 'secret123' })).status, 401);
    // own password through /api/users needs the current one; a stranger cannot set it; `pre` in the body is ignored
    assert.equal((await req('PUT', `/api/users/${d.user.id}`, { password: 'third7890', pre: { currentOk: true } }, D)).status, 422);
    const e = (await req('POST', '/api/auth/register', { username: 'erin', email: 'erin@example.com', password: 'secret123' })).body;
    assert.equal((await req('PUT', `/api/users/${d.user.id}`, { password: 'third7890' }, auth(e.token))).status, 403);
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    assert.equal((await req('PUT', `/api/users/${d.user.id}`, { password: 'third7890' }, auth(su.token))).status, 200);
    assert.equal((await req('POST', '/api/auth/login', { username: 'dave', password: 'third7890' })).status, 200);
    assert.equal((await req('POST', `/api/users/${d.user.id}/transfer-superadmin`, { password: 'not-it-123' }, auth(su.token))).status, 422);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('pull: rows that stay local follow an item or user whose id was replaced by the remote one', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const user = c.auth.register({ username: 'frank', email: 'frank@example.com', password: 'secret123' }).user;
    const icon = c.services.icon.create({ name: 'Shared Key Icon', visibility: 'public' });
    const mine = c.services.element.create({ name: 'Local Element', creatorId: user.id, visibility: 'private' });
    c.services.element.addNode(mine.id, { kind: 'instance', tag: 'use', refType: 'icon', refId: icon.id, attrs: { x: 0, y: 0, width: 10, height: 10 } });
    const nodeId = c.db.prepare("SELECT id FROM nodes WHERE owner_type = 'element' AND owner_id = ?").get(mine.id).id;
    assert.equal(c.db.prepare('SELECT ref_id FROM nodes WHERE id = ?').get(nodeId).ref_id, icon.id);
    const remote = { revision: 'r1', rows: {
      users: [{ ...c.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), id: 70001 }],
      icons: [{ ...c.db.prepare('SELECT * FROM icons WHERE id = ?').get(icon.id), id: 80001 }]
    } };
    const svc = await fakeSync(c, remote);
    const pulled = svc.pullFromPostgres({ force: true });
    assert.equal(pulled.ok, true, pulled.error);
    assert.equal(c.db.prepare('SELECT 1 FROM icons WHERE id = ?').get(icon.id), undefined);
    assert.equal(c.db.prepare('SELECT ref_id FROM nodes WHERE id = ?').get(nodeId).ref_id, 80001, 'the instance follows the icon');
    assert.equal(c.db.prepare('SELECT creator_id FROM elements WHERE id = ?').get(mine.id).creator_id, 70001, 'the element follows its owner');
    assert.ok(pulled.pulledCounts.repointed['nodes.ref_id'] >= 1);
  } finally { c.close(); }
});

test('the library and the catalog search answer 304 until something is written, per user and query', async () => {
  await withServer(async (req, c) => {
    const base = `http://127.0.0.1:${c.__port}`;
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const a = (await req('POST', '/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'secret123' })).body;
    const get = (path, token, etag) => fetch(base + path, { headers: { authorization: `Bearer ${token}`, ...(etag ? { 'if-none-match': etag } : {}) } });
    for (const path of ['/api/library?projectId=1', '/api/catalog/search?q=a']) {
      const first = await get(path, su.token);
      assert.equal(first.status, 200);
      const etag = first.headers.get('etag');
      assert.ok(etag, path);
      assert.match(first.headers.get('cache-control'), /no-cache/);
      await first.arrayBuffer();
      assert.equal((await get(path, su.token, etag)).status, 304, 'unchanged');
      assert.equal((await get(path, a.token, etag)).status, 200, 'another user never reuses the tag');
      assert.equal((await get(path + '&x=1', su.token, etag)).status, 200, 'another query');
      assert.equal((await req('POST', '/api/icons', { name: `Etag Breaker ${path.length}` }, auth(su.token))).status, 200);
      const after = await get(path, su.token, etag);
      assert.equal(after.status, 200, 'a write changes the tag');
      assert.notEqual(after.headers.get('etag'), etag);
    }
    assert.equal((await fetch(base + '/api/screens', { headers: auth(su.token) })).headers.get('etag'), null);
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('ids, numeric query parameters and bodies are checked before they reach a service', async () => {
  await withServer(async (req, c) => {
    const base = `http://127.0.0.1:${c.__port}`;
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const S = auth(su.token);
    assert.equal((await req('PUT', '/api/users/abc', { displayName: 'X' }, S)).status, 422);
    assert.equal((await req('PUT', '/api/users/1e3', { displayName: 'X' }, S)).status, 422);
    assert.equal((await req('PUT', '/api/users/-1', { displayName: 'X' }, S)).status, 422);
    assert.equal((await req('GET', '/api/icons?projectId=1%20OR%201', undefined, S)).status, 422);
    assert.equal((await req('GET', '/api/icons?creatorId=abc', undefined, S)).status, 422);
    assert.equal((await req('GET', '/api/icons?projectId=', undefined, S)).status, 200, 'an empty value is no value');
    assert.equal((await req('GET', '/api/icons?projectId=undefined', undefined, S)).status, 200);
    assert.equal((await req('GET', '/api/icons?projectId=1', undefined, S)).status, 200);
    for (const raw of ['"text"', '42', 'true']) {
      const r = await fetch(base + '/api/icons', { method: 'POST', headers: { 'content-type': 'application/json', ...S }, body: raw });
      assert.equal(r.status, 422, raw);
    }
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('a trash restore says which parts of the snapshot could not be put back', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const warn = console.warn; const lines = []; console.warn = m => lines.push(String(m));
  try {
    const su = c.auth.superadminUser();
    const wf = c.workflows.create({ name: 'Restore Me' }, { actor: su });
    c.workflows.remove(wf.id, { actor: su });
    const entry = c.db.prepare("SELECT id, snapshot FROM trash_items WHERE item_type = 'workflow' ORDER BY id DESC LIMIT 1").get();
    const snap = JSON.parse(entry.snapshot);
    snap.links = [{ fromScreenId: 999001, toScreenId: 999002 }];   // screens that no longer exist
    c.db.prepare('UPDATE trash_items SET snapshot = ? WHERE id = ?').run(JSON.stringify(snap), entry.id);
    const out = c.trash.restore(entry.id, { actor: su });
    assert.equal(out.restored, true);
    assert.equal(out.partial, true);
    assert.equal(out.skipped.length, 1);
    assert.ok(lines.some(l => l.includes('trash restore')), 'the skipped part is logged');
  } finally { console.warn = warn; c.close(); }
});

test('the sign-in limit is kept in the database: a second server process and a restart count together', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ud-login-'));
  const dbFile = join(dir, 'd.db');
  let a = buildContainer({ dbFile, syncEnabled: false });
  let b = null;
  try {
    for (let i = 0; i < 10; i++) assert.throws(() => a.auth.login({ username: 'admin', password: `wrong${i}`, ip: '10.0.0.9' }), /Invalid/);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM login_failures').get().n, 1);
    assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE bucket LIKE '%admin%'").get().n, 0, 'the name is stored hashed');
    b = buildContainer({ dbFile, syncEnabled: false });   // another process on the same database
    assert.throws(() => b.auth.login({ username: 'admin', password: 'admin', ip: '10.0.0.9' }), e => e.code === 'TOO_MANY_ATTEMPTS');
    assert.ok(b.auth.login({ username: 'admin', password: 'admin', ip: '10.0.0.10' }).token, 'another address is not locked');
    a.db.prepare('UPDATE login_failures SET started_at = started_at - ?').run(16 * 60 * 1000);
    assert.ok(a.auth.login({ username: 'admin', password: 'admin', ip: '10.0.0.9' }).token, 'the window ends');
  } finally { a.close(); b?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('body fields have the right shape before a service sees them', async () => {
  await withServer(async req => {
    const su = (await req('POST', '/api/auth/login', { username: 'superadmin', password: 'superadmin' })).body;
    const S = auth(su.token);
    const bad = async (method, path, body) => { const r = await req(method, path, body, S); assert.equal(r.status, 422, `${path} ${JSON.stringify(body)}`); return r.body.error.message; };
    assert.match(await bad('POST', '/api/icons', { name: { $ne: 1 } }), /"name"/);
    await bad('POST', '/api/icons', { name: 'x'.repeat(201) });
    await bad('POST', '/api/icons', { name: 'Ok', nodes: 'not-a-list' });
    await bad('POST', '/api/icons', { name: 'Ok', projectId: '1 OR 1' });
    await bad('POST', '/api/icons', { name: 'Ok', meta: [] });
    await bad('POST', '/api/projects', {});
    await bad('POST', '/api/auth/login', { username: ['superadmin'], password: 'superadmin' });
    assert.equal((await req('POST', '/api/icons', { name: 'Ok', projectId: '1', tags: ['a'], meta: null }, S)).status, 200, 'numeric text and null are accepted');
  }, { APP_MODE: 'release', BYPASS_AUTH: 'false' });
});

test('offline response cache: values are kept as they are, old entries are evicted, a full store makes room', async () => {
  const { createResponseCache, localStorageDriver } = await import('../interfaces/web/js/response-cache.js');
  const mem = (limit = Infinity) => {
    const m = new Map();
    return { m, get: async k => m.get(k), set: async (k, r) => { if (!m.has(k) && m.size >= limit) throw new Error('quota'); m.set(k, r); }, delete: async k => { m.delete(k); }, keys: async () => [...m.keys()] };
  };
  let t = 0;
  const d = mem();
  const cache = createResponseCache(d, { maxEntries: 3, now: () => ++t });
  const big = { icons: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `icon-${i}` })) };
  assert.equal(await cache.put('a', big), true);
  assert.equal(await cache.get('a'), big, 'no JSON round trip');
  for (const k of ['b', 'c', 'd', 'e']) await cache.put(k, { k });
  await cache.trim();
  assert.deepEqual([...d.m.keys()], ['c', 'd', 'e'], 'the oldest entries go first');
  assert.equal(await cache.get('missing'), undefined);

  const full = mem(2);
  const c2 = createResponseCache(full);
  await c2.put('x', 1); await c2.put('y', 2);
  assert.equal(await c2.put('z', 3), true, 'room is made');
  assert.deepEqual([...full.m.keys()], ['z']);

  const ls = new Map();
  const storage = { get length() { return ls.size; }, key: i => [...ls.keys()][i], getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };
  ls.set('ud_auth_token', 'keep-me');
  const c3 = createResponseCache(localStorageDriver(storage, 'ud_cache_v2:'));
  assert.equal(await c3.put('ud_cache_v2:/api/x', { ok: 1 }), true);
  assert.deepEqual(await c3.get('ud_cache_v2:/api/x'), { ok: 1 });
  assert.equal(await c3.put('ud_cache_v2:/api/huge', { s: 'x'.repeat(3 * 1024 * 1024) }), false, 'too large for the fallback');
  assert.equal(ls.get('ud_auth_token'), 'keep-me', 'only cache entries are ever removed');
});

test('building the services does not write: constructors never seed, the container seeds only when asked', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false, seed: false });
  try {
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username IN ('superadmin', 'admin', 'user')").get().n, 0);
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM template_devices').get().n, 0);
    assert.ok(c.projects.services && c.projects.libraryTransfer && c.collaboration.libraryTransfer, 'the second half of the wiring is in place');
    assert.throws(() => c.projects.bind({ services: null, libraryTransfer: null }), /needs services/);
    c.auth.seed(); c.projects.seed(); c.templates.seed();
    assert.ok(c.auth.superadminUser());
    assert.ok(c.projects.get(1));
    assert.ok(c.db.prepare('SELECT COUNT(*) AS n FROM template_devices').get().n > 0);
  } finally { c.close(); }
});
