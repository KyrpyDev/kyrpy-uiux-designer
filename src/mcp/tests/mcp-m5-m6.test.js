/**
 * Milestones M5 (item requests) and M6 (code bindings, react-tsx adapter), plus the project-scope rule
 * (used foreign items are cloned into the project) and the kyrpy-agent-designer attribution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { cleanFilePath } from '../application/binding-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = p => ({ descriptionDev: `Used by tests: ${p}.`, mcpContext: { purpose: p } });

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada.user });
  const bp = c.projects.create({ name: 'Bob Lib' }, { actor: bob.user });
  c.icon.create({ name: 'Star', key: 'ada-star', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'path', attrs: { d: 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z' } }] });
  c.icon.create({ name: 'Filter funnel', key: 'bob-filter', projectId: bp.id, visibility: 'public', descriptionDev: 'filter funnel icon' }, { actor: bob.user, nodes: [{ tag: 'path', attrs: { d: 'M3 4h18l-7 8v6l-4 2v-8z' } }] });
  const keys = {
    coder: c.mcp.apiKeys.create({ name: 'coder', projectId: p.id, scopes: ['read', 'request'] }, ada.user).key,
    designer: c.mcp.apiKeys.create({ name: 'designer', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key,
    reader: c.mcp.apiKeys.create({ name: 'reader', projectId: p.id, scopes: ['read'] }, ada.user).key
  };
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const call = async (who, name, args = {}) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${keys[who]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })
  })).json()).result;
  const ok = async (who, name, args) => { const r = await call(who, name, args); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return r.structuredContent; };
  const rest = async (method, path, body, token = ada.token) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { c, p, bp, ada, bob, call, ok, rest, close: () => { server.close(); c.close(); } };
}

test('M5 exit sensor: request → designer agent fulfils → approve → consumer pull', async () => {
  const w = await world();
  try {
    // the coding agent cannot propose; the read-only key cannot request
    assert.equal((await w.call('coder', 'uiux_begin_changeset', {})).structuredContent.error.code, 'SCOPE_DENIED');
    assert.equal((await w.call('reader', 'uiux_request_item', { type: 'icon', intent: 'heart' })).structuredContent.error.code, 'SCOPE_DENIED');

    const v0 = (await w.ok('coder', 'uiux_get_manifest', {})).version;
    const look = await w.ok('coder', 'uiux_request_item', { type: 'icon', intent: 'filter', searchOnly: true });
    assert.equal(look.request, null);
    assert.ok(look.candidates.some(c => c.key === 'bob-filter'), 'search runs first');

    const req = await w.ok('coder', 'uiux_request_item', { type: 'icon', intent: 'bell with unread dot', constraints: { states: ['default', 'unread'] }, context: { file: 'src/Header.tsx' } });
    assert.equal(req.request.status, 'open');
    const inbox = await w.ok('designer', 'uiux_list_requests', { status: 'open' });
    assert.deepEqual(inbox.requests.map(r => r.uid), [req.request.uid]);
    assert.equal((await w.ok('designer', 'uiux_claim_request', { request: req.request.uid })).status, 'claimed');

    const cs = await w.ok('designer', 'uiux_begin_changeset', { summary: `request ${req.request.uid}` });
    await w.ok('designer', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-bell-unread', name: 'Bell unread', ...docs('notification bell with unread dot'),
      nodes: [{ tag: 'path', attrs: { d: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z' } }, { tag: 'circle', attrs: { cx: 18, cy: 6, r: 3, fill: '{{accent}}' } }] },
      binding: { file: 'src/icons/BellUnread.tsx', symbol: 'BellUnread', framework: 'react' } });
    assert.equal((await w.ok('designer', 'uiux_fulfill_request', { request: req.request.uid, ref: 'ada-bell-unread', changeset: cs.changeset })).status, 'in-review');
    const sub = await w.ok('designer', 'uiux_submit_changeset', { changeset: cs.changeset, message: 'bell for request' });

    const cr = w.c.collaboration.list({ projectId: w.p.id, status: 'pending' })[0];
    assert.equal(cr.authorName, 'kyrpy-agent-designer', 'AI change requests are authored by the agent user');
    const rev = await w.rest('POST', `/api/changesets/${sub.changeset}/review`, { approve: sub.ops.map(o => o.opUid) });
    assert.equal(rev.data.status, 'approved');

    const done = await w.ok('coder', 'uiux_get_request', { request: req.request.uid });
    assert.equal(done.status, 'fulfilled');
    assert.equal(done.item.key, 'ada-bell-unread');
    const pull = await w.ok('coder', 'uiux_get_manifest', { sinceVersion: v0 });
    assert.deepEqual(pull.added.map(a => a.key), ['ada-bell-unread'], 'the consumer pull sees the new item');
    const bell = w.c.icon.get('ada-bell-unread');
    assert.equal(w.c.users.get(bell.creatorId).username, 'kyrpy-agent-designer', 'AI-created items belong to the agent user');
    const item = await w.ok('coder', 'uiux_get_item', { type: 'icon', ref: 'ada-bell-unread' });
    assert.equal(item.untrusted, false, 'approved agent items of the own project are trusted');
    assert.deepEqual(item.bindings.map(b => b.file), ['src/icons/BellUnread.tsx'], 'binding recorded on approval');

    // cancel and human reject paths
    const r2 = await w.ok('coder', 'uiux_request_item', { type: 'button', intent: 'share button' });
    assert.equal((await w.ok('coder', 'uiux_cancel_request', { request: r2.request.uid, reason: 'candidate fits' })).status, 'cancelled');
    const r3 = await w.ok('coder', 'uiux_request_item', { type: 'icon', intent: 'gold star' });
    const inboxRest = await w.rest('GET', `/api/projects/${w.p.id}/item-requests`);
    assert.equal(inboxRest.data.length, 3);
    assert.equal((await w.rest('POST', `/api/item-requests/${r3.request.uid}/fulfill`, { ref: 'ada-star' })).data.status, 'fulfilled', 'a human links an existing item');
    const r4 = await w.ok('coder', 'uiux_request_item', { type: 'icon', intent: 'unicorn' });
    assert.equal((await w.rest('POST', `/api/item-requests/${r4.request.uid}/reject`, { note: 'out of scope' }, w.bob.token)).status, 403, 'non-members cannot');
    assert.equal((await w.rest('POST', `/api/item-requests/${r4.request.uid}/reject`, { note: 'out of scope' })).data.status, 'rejected');

    // a rejected op sends the request back to claimed
    const r5 = await w.ok('coder', 'uiux_request_item', { type: 'icon', intent: 'moon' });
    await w.ok('designer', 'uiux_claim_request', { request: r5.request.uid });
    const cs2 = await w.ok('designer', 'uiux_begin_changeset', {});
    await w.ok('designer', 'uiux_stage_item', { changeset: cs2.changeset, item: { type: 'icon', key: 'ada-moon', name: 'Moon', ...docs('moon'), nodes: [{ tag: 'path', attrs: { d: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z' } }] } });
    await w.ok('designer', 'uiux_fulfill_request', { request: r5.request.uid, ref: 'ada-moon', changeset: cs2.changeset });
    const sub2 = await w.ok('designer', 'uiux_submit_changeset', { changeset: cs2.changeset });
    await w.rest('POST', `/api/changesets/${sub2.changeset}/review`, { reject: sub2.ops.map(o => o.opUid) });
    assert.equal((await w.ok('coder', 'uiux_get_request', { request: r5.request.uid })).status, 'claimed');
  } finally { w.close(); }
});

test('project scope: a used public item is cloned into the project and referenced there', async () => {
  const w = await world();
  try {
    const cs = await w.ok('designer', 'uiux_begin_changeset', {});
    const btn = await w.ok('designer', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'ada-filter-btn', name: 'Filter', label: 'Filter results', ...docs('opens filters'), width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 48, height: 48, rx: 12 } }, { tag: 'use', kind: 'instance', ref: { type: 'icon', key: 'bob-filter' }, attrs: { x: 12, y: 12, width: 24, height: 24 } }] } });
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'bob-filter', w.p.id), null, 'dry runs leave no clone');
    const sub = await w.ok('designer', 'uiux_submit_changeset', { changeset: cs.changeset });
    await w.rest('POST', `/api/changesets/${sub.changeset}/review`, { approve: sub.ops.map(o => o.opUid) });
    const clone = w.c.icon.get(w.c.mcp.query.reads.findInProject('icon', 'bob-filter', w.p.id).id);
    assert.equal(clone.key, 'bob-filter', 'per-project keys: the clone keeps the key');
    assert.equal(clone.projectId, w.p.id);
    assert.equal(clone.visibility, 'project');
    assert.equal(w.c.users.get(clone.creatorId).username, 'kyrpy-agent-designer');
    const b = w.c.button.get('ada-filter-btn');
    assert.equal(b.nodes.find(n => n.kind === 'instance').refId, clone.id, 'the button uses the clone');
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'bob-filter', w.bp.id).visibility, 'public', 'the public original is untouched');
    assert.equal(w.c.button.get('ada-filter-btn').nodes.length, 2);
    const m = await w.ok('designer', 'uiux_get_manifest', {});
    assert.ok(m.items.every(i => i.origin === 'project'), 'the manifest is project-only');
    assert.equal((await w.ok('designer', 'uiux_get_item', { type: 'button', ref: 'ada-filter-btn' })).contentHash, btn.proposedHash, 'adoption in the dry run = adoption on apply');

    // a designer drags a public icon into a project button → adopted on the next versioning
    const b2 = w.c.button.create({ name: 'Raw', key: 'ada-raw', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: w.c.icon.get('bob-filter').id }] });
    const adopt = await w.rest('POST', `/api/projects/${w.p.id}/adopt-dependencies`, {});
    assert.equal(adopt.status, 200);
    assert.equal(w.c.button.get(b2.id).nodes[0].refId, clone.id, 'reuses the existing clone');
  } finally { w.close(); }
});

test('M6: code bindings, stale detection, path safety, unchanged re-push = 0 ops, react-tsx adapter', async () => {
  const w = await world();
  try {
    assert.throws(() => cleanFilePath('../etc/passwd'));
    assert.throws(() => cleanFilePath('/abs/path.ts'));
    assert.throws(() => cleanFilePath('C:\\x.ts'));
    assert.equal(cleanFilePath('./src\\a.ts'), 'src/a.ts');
    const bad = await w.call('designer', 'uiux_bind_code', { bindings: [{ type: 'icon', ref: 'ada-star', file: '../../secret' }] });
    assert.equal(bad.isError, true);
    assert.equal((await w.call('designer', 'uiux_bind_code', { bindings: [{ type: 'icon', ref: 'bob-filter', file: 'a.ts' }] })).isError, true, 'only project items');
    const b = await w.ok('designer', 'uiux_bind_code', { bindings: [{ type: 'icon', ref: 'ada-star', file: 'src/icons/Star.tsx', symbol: 'Star', framework: 'react' }] });
    assert.equal(b.count, 1);
    let list = await w.ok('coder', 'uiux_list_bindings', { file: 'src/icons/Star.tsx' });
    assert.equal(list.bindings[0].stale, false);
    w.c.icon.update(w.c.icon.get('ada-star').id, { label: 'Star!' });
    list = await w.ok('coder', 'uiux_list_bindings', {});
    assert.equal(list.bindings[0].stale, true, 'design changed after the code was synced');

    // re-pushing an unchanged repository produces 0 ops (and still records bindings)
    const cs = await w.ok('designer', 'uiux_begin_changeset', {});
    const star = await w.ok('designer', 'uiux_get_item', { type: 'icon', ref: 'ada-star' });
    const same = await w.ok('designer', 'uiux_stage_item', { changeset: cs.changeset, item: star, binding: { file: 'src/icons/Star.tsx', symbol: 'Star', framework: 'react' } });
    assert.equal(same.unchanged, true);
    assert.equal((await w.ok('designer', 'uiux_diff_changeset', { changeset: cs.changeset })).ops.length, 0);
    assert.equal((await w.ok('coder', 'uiux_list_bindings', {})).bindings[0].stale, false, 'binding refreshed to the current hash');
    await w.ok('designer', 'uiux_discard_changeset', { changeset: cs.changeset });
    assert.equal((await w.ok('designer', 'uiux_bind_code', { bindings: [{ type: 'icon', ref: 'ada-star', file: 'src/icons/Star.tsx', symbol: 'Star' }], remove: true })).bindings[0].removed, true);

    // react-tsx adapter
    const principal = w.c.mcp.apiKeys.authenticate(w.c.mcp.apiKeys.create({ name: 'x', projectId: w.p.id }, w.ada.user).key);
    const { files } = w.c.mcp.bundles.files(principal, { adapters: ['react-tsx'], includeSvg: false, styles: ['liquid'] });
    const icon = files.find(f => f.path === 'adapters/react-tsx/liquid/Icon.tsx');
    assert.match(icon.content, /export type IconName = "ada-star";/);
    assert.match(icon.content, /<use href=\{`\$\{spriteUrl\}#icon-\$\{name\}`\} \/>/);
    assert.ok(files.some(f => f.path === 'adapters/react-tsx/liquid/icons.sprite.svg'));
    assert.ok(files.some(f => f.path === 'adapters/web/liquid/tokens.css'), 'react-tsx brings the web sprite and tokens');
    const again = w.c.mcp.bundles.files(principal, { adapters: ['react-tsx'], includeSvg: false, styles: ['liquid'] }).files.find(f => f.path === icon.path);
    assert.equal(again.content, icon.content, 'deterministic output');
  } finally { w.close(); }
});
