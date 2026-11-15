/**
 * Items an AI agent creates with a user's API key: they belong to that user, project editors can save them,
 * and they are named with the project prefix. Project prefixes are unique per owner, not globally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { AGENT_USERNAME } from '../domain/agent-user.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = p => ({ descriptionDev: `Used by tests: ${p}.`, mcpContext: { purpose: p } });
const star = [{ tag: 'path', attrs: { d: 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z' } }];

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App', prefix: 'ada' }, { actor: ada.user });
  c.projects.inviteMember(p.id, { userId: bob.user.id, role: 'editor', status: 'accepted' }, { actor: ada.user });
  const key = c.mcp.apiKeys.create({ name: 'designer', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const ok = async (name, args = {}) => {
    const r = (await (await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })
    })).json()).result;
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
  const approve = async sub => {
    const r = await fetch(`${base}/api/changesets/${sub.changeset}/review`, {
      method: 'POST', headers: { authorization: `Bearer ${ada.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ approve: sub.ops.map(o => o.opUid) })
    });
    assert.equal(r.status, 200);
  };
  return { c, p, ada, bob, ok, approve, close: () => { server.close(); c.close(); } };
}

test('AI-created items get the project prefix, belong to the key user, and a project editor can save them', async () => {
  const w = await world();
  try {
    const cs = await w.ok('uiux_begin_changeset', {});
    const st = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'bell', name: 'Bell', ...docs('bell'), nodes: star } });
    assert.equal(st.key, 'ada-icon-bell', 'the staged key carries the project prefix');
    // a button refers to the icon by the key the agent used (before the prefix)
    const btn = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'bell-btn', name: 'Bell', label: 'Notifications', ...docs('opens notifications'), width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 48, height: 48, rx: 12 } }, { tag: 'use', kind: 'instance', ref: { type: 'icon', key: 'bell' }, attrs: { x: 12, y: 12, width: 24, height: 24 } }] } });
    assert.equal(btn.key, 'ada-button-bell-btn');
    // restaging with the original key updates the same op, never doubles the prefix
    const again = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-icon-bell', name: 'Bell', ...docs('bell v2'), nodes: star } });
    assert.equal(again.key, 'ada-icon-bell');
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset });
    assert.equal(sub.ops.length, 2);
    await w.approve(sub);

    const icon = w.c.icon.get('ada-icon-bell');
    assert.equal(w.c.users.get(icon.creatorId).username, 'ada', 'the key user is the creator, not the agent');
    assert.notEqual(w.c.users.get(icon.creatorId).username, AGENT_USERNAME);
    const button = w.c.button.get('ada-button-bell-btn');
    assert.equal(button.nodes.find(n => n.kind === 'instance').refId, icon.id, 'the reference resolved to the prefixed icon');

    // an existing item keeps its key when the agent updates it by that key
    const cs2 = await w.ok('uiux_begin_changeset', {});
    const upd = await w.ok('uiux_stage_item', { changeset: cs2.changeset, item: { type: 'icon', key: 'ada-icon-bell', name: 'Bell ringing', ...docs('bell'), nodes: star } });
    assert.equal(upd.op, 'update');
    assert.equal(upd.key, 'ada-icon-bell');

    // bob, an editor of the project, saves the AI-created item
    const saved = w.c.icon.update(icon.id, { name: 'Bell (edited by bob)' }, { actor: w.bob.user });
    assert.equal(saved.name, 'Bell (edited by bob)');
  } finally { w.close(); }
});

test('an edit of an agent-owned project item is reviewed by the project owner, not by the agent', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
    const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
    const p = c.projects.create({ name: 'Ada App', prefix: 'ada' }, { actor: ada.user });
    c.projects.inviteMember(p.id, { userId: bob.user.id, role: 'editor', status: 'accepted' }, { actor: ada.user });
    const agentId = c.mcp.agentUserId();
    const doc = { creatorId: agentId, projectId: p.id, visibility: 'project' };
    assert.deepEqual(c.collaboration.changeReviewer(doc, bob.user.id), { ownerId: ada.user.id }, 'the project owner reviews');
    assert.equal(c.collaboration.changeReviewer(doc, ada.user.id), null, 'the project owner edits it directly');
  } finally { c.close(); }
});

test('project prefixes are unique per owner, not across users', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
    const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
    c.projects.create({ name: 'Shop', key: 'ada-shop', prefix: 'shop' }, { actor: ada.user });
    assert.ok(c.projects.create({ name: 'Shop', key: 'bob-shop', prefix: 'shop' }, { actor: bob.user }), 'another user may use the same prefix');
    assert.throws(() => c.projects.create({ name: 'Shop 2', key: 'ada-shop-2', prefix: 'shop' }, { actor: ada.user }), /already used by another of your projects/);
  } finally { c.close(); }
});
