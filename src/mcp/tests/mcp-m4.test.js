/**
 * Milestone M4 sensors: project versions, changesets (stage / validate / diff / submit), conflicts,
 * human-only review, the core change-list hook — and the exit sensor:
 *   push → owner approves → head moves → pull delta is empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { validateItemStatic } from '../domain/item-validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const STAR = 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z';
const docs = (purpose = 'test item') => ({ descriptionDev: `Used by tests: ${purpose}.`, mcpContext: { purpose } });

async function world({ ai } = {}) {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada.user });
  if (ai) c.mcp.apiKeys.updateAiSettings(p.id, ai, ada.user);
  const star = c.icon.create({ name: 'Star', key: 'ada-star', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'path', attrs: { d: STAR, fill: '{{accent}}' } }] });
  c.icon.create({ name: 'Dot', key: 'ada-dot', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
  const key = c.mcp.apiKeys.create({ name: 'agent', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const rpc = async (method, params, bearer = key) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  const ok = async (name, args) => { const r = await call(name, args); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return r.structuredContent; };
  const rest = async (method, path, body, token = ada.token) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { c, p, ada, bob, star, key, rpc, call, ok, rest, close: () => { server.close(); c.close(); } };
}

test('M4: static validation rules (§14)', () => {
  const v = (item, o) => validateItemStatic(item, o).errors.map(e => e.code);
  assert.deepEqual(v({ type: 'icon', key: 'good-key', ...docs() }), []);
  assert.ok(v({ type: 'icon', key: 'Bad Key', ...docs() }).includes('KEY'));
  assert.ok(v({ type: 'icon', key: 'no-docs' }).includes('DOCS'), 'create needs descriptionDev + purpose');
  assert.deepEqual(validateItemStatic({ type: 'icon', key: 'no-docs' }, { op: 'update' }).errors, [], 'updates only warn');
  assert.ok(v({ type: 'icon', key: 'big', width: 32, ...docs() }).includes('GRID'));
  assert.ok(v({ type: 'icon', key: 'x', ...docs(), nodes: [{ tag: 'path', attrs: { onclick: 'alert(1)' } }] }).includes('UNSAFE_SVG'));
  assert.ok(v({ type: 'icon', key: 'x', ...docs(), nodes: [{ tag: 'use', attrs: { href: 'https://evil.example/x.svg#a' } }] }).includes('UNSAFE_SVG'));
  assert.ok(v({ type: 'icon', key: 'x', ...docs() }, { svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' }).includes('UNSAFE_SVG'));
  assert.ok(v({ type: 'icon', key: 'x', ...docs() }, { svg: '<svg viewBox="0 0 48 48"><path d="M0 0h4"/></svg>' }).includes('GRID'));
  assert.ok(v({ type: 'button', key: 'b', descriptionDev: 'd', mcpContext: { purpose: 'p' }, label: '', name: '' }).includes('A11Y'));
});

test('M4: tools/list — propose tools are not read-only; validate reports errors without storing', async () => {
  const w = await world();
  try {
    const tools = (await w.rpc('tools/list')).result.tools;
    const by = Object.fromEntries(tools.map(t => [t.name, t]));
    for (const n of ['uiux_list_versions', 'uiux_validate_item', 'uiux_begin_changeset', 'uiux_stage_item', 'uiux_stage_delete', 'uiux_diff_changeset', 'uiux_submit_changeset', 'uiux_get_changeset', 'uiux_discard_changeset']) assert.ok(by[n], n);
    assert.equal(by.uiux_stage_item.annotations.readOnlyHint, false);
    assert.equal(by.uiux_diff_changeset.annotations.readOnlyHint, true);
    assert.ok((await w.rpc('prompts/list')).result.prompts.some(p => p.name === 'push-app-version'));

    const bad = await w.ok('uiux_validate_item', { item: { type: 'icon', key: 'ada-dot-2', ...docs(), nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] } });
    assert.equal(bad.valid, false);
    assert.equal(bad.errors[0].code, 'DUPLICATE', 'identical drawing of ada-dot');
    const taken = await w.ok('uiux_validate_item', { item: { type: 'button', key: 'x-hier', ...docs(), label: 'Go', nodes: [{ tag: 'use', kind: 'instance', ref: { type: 'screen', key: 'nope' } }] } });
    assert.ok(taken.errors.some(e => e.code === 'REF'));
    const good = await w.ok('uiux_validate_item', { item: { type: 'icon', key: 'ada-heart', name: 'Heart', ...docs('favourite toggle'), nodes: [{ tag: 'path', attrs: { d: 'M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z' } }] } });
    assert.equal(good.valid, true);
    assert.match(good.proposedHash, /^[0-9a-f]{64}$/);
    assert.equal(w.c.icon.list({}).some(i => i.key === 'ada-heart'), false, 'dry run leaves nothing behind');
    const hierarchy = await w.ok('uiux_validate_item', { item: { type: 'icon', key: 'icon-with-button', ...docs(), nodes: [{ tag: 'use', kind: 'instance', ref: { type: 'icon', key: 'ada-star' } }] } });
    assert.equal(hierarchy.valid, false, 'an icon cannot contain an icon');
  } finally { w.close(); }
});

test('M4 exit sensor: push → owner approves → head moves → pull delta is empty', async () => {
  const w = await world();
  try {
    const m0 = await w.ok('uiux_get_manifest', {});
    assert.equal(m0.version, 1, 'baseline version recorded on first use');

    const cs = await w.ok('uiux_begin_changeset', { summary: 'push app v2', baseVersion: 1 });
    assert.equal(cs.status, 'open');
    const heart = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-heart', name: 'Heart', ...docs('favourite toggle'), nodes: [{ tag: 'path', attrs: { d: 'M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z' } }] } });
    assert.equal(heart.op, 'create');
    const fav = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'ada-fav-button', name: 'Favourite', label: 'Add to favourites', ...docs('toggles favourite'), width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 48, height: 48, rx: 12 } }, { tag: 'use', kind: 'instance', ref: { type: 'icon', key: 'ada-heart' }, attrs: { x: 12, y: 12, width: 24, height: 24 } }] } });
    assert.equal(fav.op, 'create', 'references an icon staged in the same changeset');
    const starItem = await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-star' });
    const upd = await w.ok('uiux_stage_item', { changeset: cs.changeset, baseHash: starItem.contentHash, item: { ...starItem, nodes: starItem.nodes.map(n => ({ ...n, attrs: { ...n.attrs, fill: '{{text}}' } })) } });
    assert.equal(upd.op, 'update');
    assert.notEqual(upd.proposedHash, starItem.contentHash);
    const same = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-dot' }) });
    assert.equal(same.unchanged, true, 'an unchanged item is not staged');
    const svgIcon = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-square', name: 'Square', ...docs('square bullet') }, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg>' });
    assert.equal(svgIcon.op, 'create', 'svg import');

    const diff = await w.ok('uiux_diff_changeset', { changeset: cs.changeset });
    assert.deepEqual(diff.summary, { create: 3, update: 1, delete: 0, conflicts: 0 });
    assert.deepEqual(diff.ops.find(o => o.key === 'ada-star').changedFields, ['nodes']);
    assert.equal(w.c.icon.list({}).some(i => i.key === 'ada-heart'), false, 'nothing applied before review');

    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset, message: 'Heart, favourite button, square; star uses text color', label: '2.0.0' });
    assert.equal(sub.status, 'submitted');
    assert.equal(sub.resultVersion.status, 'pending');
    const crs = w.c.collaboration.list({ projectId: w.p.id, status: 'pending' }).filter(c => c.action.startsWith('ai-'));
    assert.equal(crs.length, 4, 'one change request per op (notification + Change List)');
    assert.equal((await w.call('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'late', ...docs() } })).structuredContent.error.code, 'CONFLICT', 'submitted changesets are frozen');

    // only a human session can approve: API key → 401 on REST; a non-owner → 403
    assert.equal((await w.rest('POST', `/api/changesets/${cs.changeset}/review`, { approve: [] }, w.key)).status, 401);
    assert.equal((await w.rest('POST', `/api/changesets/${cs.changeset}/review`, { approve: [heart.opUid] }, w.bob.token)).status, 403);

    const detail = await w.rest('GET', `/api/changesets/${cs.changeset}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.canReview, true);
    const prev = await w.rest('GET', `/api/changesets/${cs.changeset}/ops/${upd.opUid}/preview`);
    assert.match(prev.data.before, /<svg/);
    assert.match(prev.data.after, /<svg/);
    assert.notEqual(prev.data.before, prev.data.after);
    const prevNew = await w.rest('GET', `/api/changesets/${cs.changeset}/ops/${fav.opUid}/preview`);
    assert.equal(prevNew.data.before, null);
    assert.match(prevNew.data.after, /<svg/, 'after preview of a create that references another staged create');

    const allOps = [heart.opUid, fav.opUid, upd.opUid, svgIcon.opUid];
    const rev = await w.rest('POST', `/api/changesets/${cs.changeset}/review`, { approve: allOps, comment: 'looks good' });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    assert.equal(rev.data.status, 'approved');
    assert.equal(rev.data.resultVersion.number, 2, 'head moved');

    const got = await w.ok('uiux_get_changeset', { changeset: cs.changeset });
    assert.deepEqual(got.opStatus, { applied: 4 });
    assert.equal(got.reviewComment, 'looks good');
    const heartRow = await w.ok('uiux_get_item', { type: 'icon', ref: heart.uid });
    assert.equal(heartRow.key, 'ada-heart', 'the created item keeps the uid announced at staging');
    assert.equal(heartRow.scope, 'project');
    assert.equal(heartRow.mcpContext.purpose, 'favourite toggle');
    assert.equal(heartRow.contentHash, heart.proposedHash, 'applied hash = proposed hash');
    assert.equal((await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-star' })).contentHash, upd.proposedHash);
    assert.equal(w.c.collaboration.list({ projectId: w.p.id, status: 'approved' }).length, 4);

    const pull = await w.ok('uiux_get_manifest', { sinceVersion: 2 });
    assert.equal(pull.empty, true, 'pull delta from the new head is empty');
    const fromOld = await w.ok('uiux_get_manifest', { sinceVersion: 1 });
    assert.deepEqual([fromOld.added.length, fromOld.changed.length, fromOld.removed.length], [3, 1, 0]);
    const versions = await w.ok('uiux_list_versions', {});
    assert.equal(versions.head, 2);
    assert.equal(versions.versions[0].label, '2.0.0');
    assert.equal(versions.versions[0].source, 'ai-push');

    // a designer edit becomes its own version automatically
    w.c.icon.update(w.star.id, { label: 'Star!' });
    assert.equal((await w.ok('uiux_get_manifest', { sinceVersion: 2 })).changed.length, 1);
    assert.equal((await w.ok('uiux_list_versions', {})).versions[0].source, 'designer');
  } finally { w.close(); }
});

test('M4: conflicts — item changed in the designer after base; restage with headHash fixes it', async () => {
  const w = await world();
  try {
    const cs = await w.ok('uiux_begin_changeset', {});
    const star = await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-star' });
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { ...star, label: 'Star (from code)' } });
    const dot = await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-dot' });
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { ...dot, label: 'Dot (from code)' } });
    w.c.icon.update(w.star.id, { label: 'Star (designer)' });   // human edit meanwhile

    const r = await w.call('uiux_submit_changeset', { changeset: cs.changeset });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.error.code, 'CONFLICT');
    const conflicts = r.structuredContent.error.details.conflicts;
    assert.deepEqual(conflicts.map(c => c.key), ['ada-star'], 'disjoint change (dot) does not conflict');
    assert.equal((await w.ok('uiux_get_changeset', { changeset: cs.changeset })).status, 'conflicted');

    const now = await w.ok('uiux_get_item', { type: 'icon', ref: 'ada-star' });
    await w.ok('uiux_stage_item', { changeset: cs.changeset, baseHash: conflicts[0].headHash, item: { ...now, label: 'Star (merged)' } });
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset, message: 'labels' });
    assert.equal(sub.status, 'submitted');

    // reject one op through the core Change List, approve the other there: the changeset finalizes
    const crs = w.c.collaboration.list({ projectId: w.p.id, status: 'pending' });
    const crStar = crs.find(c => c.targetKey === 'ada-star'), crDot = crs.find(c => c.targetKey === 'ada-dot');
    assert.equal((await w.rest('POST', `/api/changes/${crStar.id}/reject`, { comment: 'keep designer label' })).status, 200);
    assert.equal((await w.ok('uiux_get_changeset', { changeset: cs.changeset })).status, 'submitted', 'still one op pending');
    assert.equal((await w.rest('POST', `/api/changes/${crDot.id}/approve`, {})).status, 200);
    const fin = await w.ok('uiux_get_changeset', { changeset: cs.changeset });
    assert.equal(fin.status, 'approved');
    assert.deepEqual(fin.opStatus, { applied: 1, rejected: 1 });
    assert.equal(w.c.icon.get(w.star.id).label, 'Star (designer)', 'rejected op not applied');
    assert.equal(w.c.icon.get('ada-dot').label, 'Dot (from code)');
  } finally { w.close(); }
});

test('M4: deletes, per-project keys, empty push, reject-all, auto-approve setting, workflows', async () => {
  const w = await world();
  try {
    // another user's public icon owns a key → KEY_TAKEN with a suggestion
    const other = w.c.projects.create({ name: 'Bob App' }, { actor: w.bob.user });
    w.c.icon.create({ name: 'Pub', key: 'pub-icon', projectId: other.id, visibility: 'public' }, { actor: w.bob.user, nodes: [{ tag: 'rect', attrs: { x: 1, y: 1, width: 3, height: 3 } }] });
    const cs = await w.ok('uiux_begin_changeset', {});
    // keys are unique per project: another library's key is free here (a create, not an update of bob's icon)
    const own = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'pub-icon', ...docs(), nodes: [{ tag: 'circle', attrs: { cx: 5, cy: 5, r: 2 } }] } });
    assert.equal(own.op, 'create');
    assert.equal((await w.ok('uiux_stage_delete', { changeset: cs.changeset, type: 'icon', ref: 'pub-icon' })).unstaged, true);

    // empty push → nothing to submit; discard
    assert.equal((await w.call('uiux_submit_changeset', { changeset: cs.changeset })).structuredContent.error.code, 'VALIDATION_FAILED');
    assert.equal((await w.ok('uiux_discard_changeset', { changeset: cs.changeset })).status, 'discarded');

    // delete + workflow over two new screens; reject everything
    const cs2 = await w.ok('uiux_begin_changeset', {});
    const del = await w.ok('uiux_stage_delete', { changeset: cs2.changeset, type: 'icon', ref: 'ada-dot' });
    assert.equal(del.op, 'delete');
    for (const k of ['home', 'detail']) {
      await w.ok('uiux_stage_item', { changeset: cs2.changeset, item: { type: 'screen', key: `ada-${k}`, name: k, label: k, ...docs(`${k} screen`), width: 390, height: 844,
        nodes: [{ tag: 'rect', name: 'open', attrs: { x: 10 + (k === 'home' ? 0 : 7), y: 10, width: 100, height: 40 } }] } });
    }
    const wf = await w.ok('uiux_stage_item', { changeset: cs2.changeset, item: { type: 'workflow', key: 'ada-main-flow', name: 'Main', ...docs('main navigation'),
      screens: [{ screen: { key: 'ada-home' }, x: 0, y: 0 }, { screen: { key: 'ada-detail' }, x: 400, y: 0 }],
      links: [{ from: { key: 'ada-home' }, fromNodeName: 'open', to: { key: 'ada-detail' }, name: 'open detail', trigger: 'click' }] } });
    assert.equal(wf.op, 'create');
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs2.changeset });
    const rev = await w.rest('POST', `/api/changesets/${sub.changeset}/review`, { reject: sub.ops.map(o => o.opUid), comment: 'not now' });
    assert.equal(rev.data.status, 'rejected');
    assert.ok(w.c.icon.get('ada-dot'), 'rejected delete keeps the item');
    const versions = await w.ok('uiux_list_versions', {});
    assert.equal(versions.head, 1);
    assert.equal(versions.versions.find(v => v.source === 'ai-push').status, 'rejected');
  } finally { w.close(); }

  const auto = await world({ ai: { pushRequiresReview: false } });
  try {
    const cs = await auto.ok('uiux_begin_changeset', {});
    await auto.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-plus', name: 'Plus', ...docs('add'), nodes: [{ tag: 'path', attrs: { d: 'M12 5v14M5 12h14' } }] } });
    for (const k of ['a', 'b']) {
      await auto.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'screen', key: `ada-s-${k}`, name: k, label: k, ...docs(k), nodes: [{ tag: 'rect', name: 'go', attrs: { x: k === 'a' ? 1 : 2, y: 1, width: 10, height: 10 } }] } });
    }
    await auto.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'workflow', key: 'ada-flow', name: 'Flow', ...docs('flow'),
      screens: [{ screen: { key: 'ada-s-a' } }, { screen: { key: 'ada-s-b' }, x: 300 }], links: [{ from: { key: 'ada-s-a' }, fromNodeName: 'go', to: { key: 'ada-s-b' } }] } });
    const sub = await auto.ok('uiux_submit_changeset', { changeset: cs.changeset });
    assert.equal(sub.status, 'approved', 'pushRequiresReview off → auto-approved');
    assert.equal(sub.resultVersion.number, 2);
    const flow = auto.c.workflows.get('ada-flow');
    assert.equal(flow.nodes.length, 2);
    assert.equal(flow.links.length, 1);
    assert.ok(flow.links[0].fromNodeId, 'link hotspot resolved by node name');
    assert.equal((await auto.ok('uiux_get_manifest', { sinceVersion: 2 })).empty, true);
  } finally { auto.close(); }
});
