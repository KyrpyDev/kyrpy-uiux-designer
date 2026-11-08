/**
 * AI-assisted design: design keys ("design" scope) — focus (create / edit / clone), the edit session (stage, list, delete
 * ops), save, save-as (-vNNN projects), version management (list / open / delete / purge) and the isolation of strict keys
 * (own projects only: no public, shared or foreign data).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { parseVersionSuffix, versionIdentity, parseVersionRef } from '../domain/version-naming.js';

const here = dirname(fileURLToPath(import.meta.url));
const STAR = 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z';
const HEART = 'M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z';
const icon = (key, d = HEART) => ({ type: 'icon', key, name: key.replace(/-/g, ' '), descriptionDev: 'Test icon.', mcpContext: { purpose: 'test' }, nodes: [{ tag: 'path', attrs: { d } }] });

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const mine = c.projects.create({ name: 'Ada App', visibility: 'private' }, { actor: ada.user });
  c.icon.create({ name: 'Star', key: 'ada-star', projectId: mine.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'path', attrs: { d: STAR } }] });
  const bobPub = c.projects.create({ name: 'Bob Kit', visibility: 'public' }, { actor: bob.user });
  c.icon.create({ name: 'Bob Dot', key: 'bob-dot', projectId: bobPub.id, visibility: 'project' }, { actor: bob.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
  const bobPriv = c.projects.create({ name: 'Bob Secret', visibility: 'private' }, { actor: bob.user });
  c.icon.create({ name: 'Bob Secret Icon', key: 'bob-secret', projectId: bobPriv.id, visibility: 'project' }, { actor: bob.user, nodes: [{ tag: 'circle', attrs: { cx: 6, cy: 6, r: 3 } }] });
  const design = c.mcp.apiKeys.create({ name: 'cli', kind: 'account', scopes: ['read', 'request', 'propose', 'create', 'design'] }, ada.user).key;
  const plain = c.mcp.apiKeys.create({ name: 'plain', kind: 'account', scopes: ['read', 'propose', 'create'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const rpc = async (method, params, bearer = design) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}, bearer) => (await rpc('tools/call', { name, arguments: args }, bearer));
  const ok = async (name, args, bearer) => { const r = (await call(name, args, bearer)).result; assert.ok(r && !r.isError, `${name}: ${JSON.stringify(r?.content?.[0]?.text ?? r)}`); return r.structuredContent; };
  const err = async (name, args, bearer) => {
    const r = await call(name, args, bearer);
    if (r.error) return { code: 'RPC', message: r.error.message };
    assert.ok(r.result.isError, `${name} should fail`);
    return r.result.structuredContent.error;
  };
  const mineOf = () => c.projects.list({ user: ada.user }).filter(p => Number(p.ownerId) === Number(ada.user.id));
  const itemKeys = key => { const p = c.projects.list({ user: ada.user }).find(x => x.key === key); return p ? c.icon.list({}).filter(i => Number(i.projectId ?? i.project_id) === p.id).map(i => i.key).sort() : null; };
  return { base, c, ada, bob, mine, bobPub, bobPriv, design, plain, rpc, call, ok, err, mineOf, itemKeys, close: () => { server.close(); c.close(); } };
}

test('version naming helpers', () => {
  assert.deepEqual(parseVersionSuffix('app-v002'), { base: 'app', number: 2 });
  assert.equal(parseVersionSuffix('app'), null);
  assert.deepEqual(versionIdentity({ key: 'app', name: 'App' }, 3), { key: 'app-v003', name: 'App-v003' });
  assert.equal(parseVersionRef('v002', 'app'), 2);
  assert.equal(parseVersionRef('app-v004', 'app'), 4);
  assert.equal(parseVersionRef('other-v004', 'app'), null);
  assert.equal(parseVersionRef(7), 7);
  assert.equal(parseVersionRef('latest'), null);
});

test('design scope: only account keys can have it; tools appear only for design keys; project / changeset become optional', async () => {
  const w = await world();
  try {
    assert.throws(() => w.c.mcp.apiKeys.create({ name: 'x', projectId: w.mine.id, scopes: ['read', 'design'] }, w.ada.user), /design/);
    const names = async bearer => (await w.rpc('tools/list', {}, bearer)).result.tools.map(t => t.name);
    const designTools = ['uiux_edit_project', 'uiux_close_project', 'uiux_list_edit_ops', 'uiux_delete_edit_ops', 'uiux_save', 'uiux_save_as', 'uiux_manage_versions', 'uiux_delete_version', 'uiux_purge_versions'];
    const d = await names(w.design), p = await names(w.plain);
    for (const n of designTools) { assert.ok(d.includes(n), `${n} visible to a design key`); assert.ok(!p.includes(n), `${n} hidden from a plain account key`); }
    const by = Object.fromEntries((await w.rpc('tools/list', {})).result.tools.map(t => [t.name, t]));
    assert.ok(!(by.uiux_get_manifest.inputSchema.required || []).includes('project'), 'project optional for a design key');
    assert.ok(by.uiux_get_manifest.inputSchema.properties.project, 'project still accepted');
    assert.ok(!(by.uiux_stage_item.inputSchema.required || []).includes('changeset'), 'changeset optional for a design key');
    assert.ok(by.uiux_stage_item.inputSchema.required.includes('item'));
    assert.equal(by.uiux_purge_versions.annotations.destructiveHint, true, 'purge is destructive');
    assert.equal(by.uiux_save.annotations.readOnlyHint, false, 'save writes');
    const plainBy = Object.fromEntries((await w.rpc('tools/list', {}, w.plain)).result.tools.map(t => [t.name, t]));
    assert.ok(plainBy.uiux_get_manifest.inputSchema.required.includes('project'), 'plain account keys keep the required project');
    assert.equal((await w.err('uiux_save', {}, w.plain)).code, 'RPC', 'a plain key cannot call a design tool');
    assert.equal(by.uiux_whoami.annotations.destructiveHint, false);
    assert.equal((await w.err('uiux_clone_project', { name: 'x' }, w.plain)).code === 'RPC', false, 'clone stays available to "create" keys');
  } finally { w.close(); }
});

test('create project → focused; stage without a changeset; list ops; save → version; nothing to save', async () => {
  const w = await world();
  try {
    assert.equal((await w.err('uiux_get_manifest', {})).code, 'NO_FOCUS', 'no focus yet');
    assert.equal((await w.err('uiux_stage_item', { item: icon('x-heart') })).code, 'NO_FOCUS');
    const made = await w.ok('uiux_create_project', { name: 'Garden', description: 'AI designed' });
    assert.equal(made.project.key, 'garden');
    assert.equal(made.focused, true);
    assert.equal(made.project.visibility, 'private');
    assert.equal((await w.ok('uiux_whoami')).focus.key, 'garden');
    assert.equal((await w.err('uiux_create_project', { name: 'Public Garden', visibility: 'public' })).code, 'VALIDATION');

    const st = await w.ok('uiux_stage_item', { item: icon('garden-heart') });
    assert.equal(st.staged, 1);
    await w.ok('uiux_stage_item', { item: icon('garden-star', STAR) });
    const ops = await w.ok('uiux_list_edit_ops');
    assert.equal(ops.staged, 2);
    assert.equal(ops.summary.create, 2);
    // the project is NOT changed before save
    assert.deepEqual(w.itemKeys('garden'), []);
    const saved = await w.ok('uiux_save', { message: 'first icons' });
    assert.equal(saved.saved, true);
    assert.equal(saved.applied, 2);
    assert.ok(saved.version >= 2, `new version, got ${saved.version}`);
    assert.deepEqual(w.itemKeys('garden'), ['garden-heart', 'garden-star']);
    assert.equal((await w.ok('uiux_list_edit_ops')).staged, 0);
    const again = await w.ok('uiux_save', {});
    assert.equal(again.saved, false);
    assert.equal(again.nothingToSave, true);
    // the legacy submit tool saves too for a design key
    await w.ok('uiux_stage_item', { item: icon('garden-leaf', 'M3 3h18v18H3z') });
    const sub = await w.ok('uiux_submit_changeset', { message: 'via submit' });
    assert.equal(sub.saved, true);
    assert.ok(w.itemKeys('garden').includes('garden-leaf'));
    const list = await w.ok('uiux_get_changeset', {});
    assert.ok(list.changesets.every(c => c.status !== 'open'), 'no dangling open changeset');
  } finally { w.close(); }
});

test('edit project: lists own projects only, selects one, resumes unsaved edits; foreign projects are NOT_FOUND', async () => {
  const w = await world();
  try {
    const sel = await w.ok('uiux_edit_project', {});
    assert.equal(sel.needsSelection, true);
    assert.deepEqual(sel.projects.map(p => p.key), [w.mine.key], 'only the user\'s own projects (no public Bob Kit, no Bob Secret)');
    assert.ok(sel.askHuman.length);
    for (const k of [w.bobPub.key, w.bobPriv.key]) assert.equal((await w.err('uiux_edit_project', { project: k })).code, 'NOT_FOUND', `${k} not reachable`);
    const st = await w.ok('uiux_edit_project', { project: w.mine.key });
    assert.equal(st.project.key, w.mine.key);
    assert.equal(st.head.items, 1);
    await w.ok('uiux_stage_item', { item: icon('ada-heart') });
    // leave and come back: the unsaved edit is still there
    await w.ok('uiux_close_project', {});
    assert.equal((await w.err('uiux_list_edit_ops', {})).code, 'NO_FOCUS');
    const back = await w.ok('uiux_edit_project', { project: w.mine.key });
    assert.equal(back.edits.staged, 1, 'edit session resumed');
    // an explicit project that is not the focus is refused, the focus itself is fine
    const other = await w.ok('uiux_create_project', { name: 'Other' });
    assert.equal(other.project.key, 'other');
    assert.equal((await w.err('uiux_get_manifest', { project: w.mine.key })).code, 'SCOPE_DENIED');
    await w.ok('uiux_get_manifest', { project: 'other' });
    assert.equal((await w.ok('uiux_list_projects', {})).projects.filter(p => p.focused).map(p => p.key).join(), 'other');
  } finally { w.close(); }
});

test('delete edit operations: by key, by op uid, all; saved items are untouched', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    const a = await w.ok('uiux_stage_item', { item: icon('ada-a') });
    await w.ok('uiux_stage_item', { item: icon('ada-b', STAR + 'z') });
    await w.ok('uiux_stage_item', { item: icon('ada-c', 'M1 1h22v22H1z') });
    await w.ok('uiux_stage_delete', { type: 'icon', ref: 'ada-star' });
    assert.equal((await w.ok('uiux_list_edit_ops')).staged, 4);
    assert.equal((await w.err('uiux_delete_edit_ops', {})).code, 'VALIDATION', 'needs ops or all');
    assert.equal((await w.err('uiux_delete_edit_ops', { ops: ['nope'] })).code, 'NOT_FOUND');
    let r = await w.ok('uiux_delete_edit_ops', { ops: ['ada-b', a.opUid] });
    assert.equal(r.removed.length, 2);
    assert.equal(r.staged, 2);
    r = await w.ok('uiux_delete_edit_ops', { ops: ['icon:ada-star'] });
    assert.equal(r.removed[0].op, 'delete');
    r = await w.ok('uiux_delete_edit_ops', { all: true });
    assert.equal(r.staged, 0);
    assert.deepEqual(w.itemKeys(w.mine.key), ['ada-star']);
    assert.equal((await w.ok('uiux_save', {})).nothingToSave, true);
  } finally { w.close(); }
});

test('clone project: a new name is always required; the clone is focused; sources are own projects only', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    assert.equal((await w.err('uiux_clone_project', {})).code, 'RPC', 'name is a required argument');
    assert.equal((await w.err('uiux_clone_project', { name: '  ' })).code, 'VALIDATION');
    assert.equal((await w.err('uiux_clone_project', { name: 'ada app' })).code, 'VALIDATION', 'same name as the source');
    assert.equal((await w.err('uiux_clone_project', { source: w.bobPub.key, name: 'Stolen' })).code, 'NOT_FOUND', 'public project is out of reach');
    assert.equal((await w.err('uiux_clone_project', { source: w.bobPriv.key, name: 'Stolen 2' })).code, 'NOT_FOUND');
    const c1 = await w.ok('uiux_clone_project', { name: 'Ada App Two' });
    assert.equal(c1.clonedFrom.key, w.mine.key);
    assert.equal(c1.project.key, 'ada-app-two');
    assert.equal(c1.focused, true);
    assert.deepEqual(w.itemKeys('ada-app-two'), ['ada-star']);
    assert.equal((await w.err('uiux_clone_project', { source: w.mine.key, name: 'Ada App Two' })).code, 'CONFLICT', 'name already used');
    // edits now go to the clone, the source is untouched
    await w.ok('uiux_stage_item', { item: icon('two-heart') });
    await w.ok('uiux_save', {});
    assert.ok(w.itemKeys('ada-app-two').includes('two-heart'));
    assert.deepEqual(w.itemKeys(w.mine.key), ['ada-star']);
    // a plain account key can still clone a public project (its existing behaviour), but needs the name too
    const viaPlain = await w.ok('uiux_clone_project', { source: w.bobPub.key, name: 'Bob Based' }, w.plain);
    assert.equal(viaPlain.clonedFrom.key, w.bobPub.key);
  } finally { w.close(); }
});

test('isolation: a design key never reads, references, clones or touches public, shared or foreign data', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    // search: public / foreign never show up; the public scope is refused
    const s1 = await w.ok('uiux_search_items', { query: 'bob' });
    assert.equal(s1.total, 0, JSON.stringify(s1.results));
    assert.equal((await w.err('uiux_search_items', { query: 'dot', scope: 'public' })).code, 'VALIDATION');
    assert.ok(JSON.stringify(await w.ok('uiux_search_items', { query: 'star' })).includes('ada-star'));
    // get item: another project's / public item is not readable
    for (const ref of ['bob-dot', 'bob-secret']) {
      const e = await w.err('uiux_get_item', { type: 'icon', ref });
      assert.ok(['FORBIDDEN', 'NOT_FOUND'].includes(e.code), `${ref}: ${e.code}`);
    }
    // another project as the target of any project tool
    for (const k of [w.bobPub.key, w.bobPriv.key]) {
      const e = await w.err('uiux_get_manifest', { project: k });
      assert.ok(['SCOPE_DENIED', 'NOT_FOUND'].includes(e.code), `${k}: ${e.code}`);
    }
    // referencing a public item from a staged button is refused (it would be cloned into the project)
    const e = await w.err('uiux_stage_item', { item: { type: 'button', key: 'ada-bad-button', name: 'Bad', label: 'Bad', descriptionDev: 'x', mcpContext: { purpose: 'x' }, width: 48, height: 48, nodes: [{ tag: 'rect', attrs: { width: 48, height: 48 } }, { kind: 'ref', ref: { type: 'icon', key: 'bob-dot' }, name: 'glyph' }] } });
    assert.ok(['VALIDATION_FAILED', 'NOT_FOUND'].includes(e.code), e.code);
    // public items cannot be created either
    const pub = await w.err('uiux_stage_item', { item: { ...icon('ada-pub'), visibility: 'public' } });
    assert.equal(pub.code, 'VALIDATION_FAILED');
    // init selection lists only own projects; download of a foreign project is NOT_FOUND
    const sel = await w.ok('uiux_init', {});
    assert.deepEqual(sel.projects.map(p => p.key), [w.mine.key]);
    assert.equal((await w.err('uiux_init', { mode: 'download', project: w.bobPub.key })).code, 'NOT_FOUND');
    assert.equal((await w.err('uiux_create_project', { name: 'Copy', fromProject: w.bobPub.key })).code, 'NOT_FOUND');
    // no way to remove a project that is not a version of the focused master
    assert.equal((await w.err('uiux_delete_version', { version: w.bobPub.key })).code, 'NOT_FOUND');
    assert.equal((await w.err('uiux_delete_version', { version: '1' })).code, 'NOT_FOUND');
    assert.ok(w.c.projects.list({ user: w.bob.user }).some(p => p.key === w.bobPub.key), 'bob\'s project is intact');
    // the designer REST API rejects API keys (an AI key cannot reach any other area of the app)
    for (const path of ['/api/projects', '/api/me/api-keys']) {
      const r = await fetch(w.base + path, { headers: { authorization: `Bearer ${w.design}` } });
      assert.equal(r.status, 401, `${path} must reject an API key`);
    }
  } finally { w.close(); }
});

test('save as: current design + unsaved edits become <master>-v001 (then v002); the master keeps its saved state', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    await w.ok('uiux_stage_item', { item: icon('ada-heart') });
    await w.ok('uiux_stage_delete', { type: 'icon', ref: 'ada-star' });
    const v1 = await w.ok('uiux_save_as', { message: 'milestone one' });
    assert.equal(v1.savedAs, 'ada-app-v001');
    assert.equal(v1.number, 1);
    assert.equal(v1.master, w.mine.key);
    assert.equal(v1.carriedEdits, 2);
    assert.equal(v1.focused, true);
    assert.equal(v1.project.key, 'ada-app-v001');
    assert.equal(v1.project.visibility, 'private');
    assert.deepEqual(w.itemKeys('ada-app-v001'), ['ada-heart'], 'edits applied in the version');
    assert.deepEqual(w.itemKeys(w.mine.key), ['ada-star'], 'master unchanged');
    assert.equal((await w.ok('uiux_whoami')).focus.key, 'ada-app-v001');
    assert.equal((await w.ok('uiux_list_edit_ops')).staged, 0, 'the master\'s session was moved into the version');
    // continue in v001, then save as again: v002 is a copy of v001 (+ edits), master is still the same
    await w.ok('uiux_stage_item', { item: icon('ada-leaf', 'M3 3h18v18H3z') });
    const v2 = await w.ok('uiux_save_as', {});
    assert.equal(v2.savedAs, 'ada-app-v002');
    assert.equal(v2.master, w.mine.key, 'master of a version is the original project');
    assert.deepEqual(w.itemKeys('ada-app-v002'), ['ada-heart', 'ada-leaf']);
    assert.deepEqual(w.itemKeys('ada-app-v001'), ['ada-heart'], 'v001 keeps its saved state');
    // without unsaved edits it is a plain checkpoint
    const v3 = await w.ok('uiux_save_as', {});
    assert.equal(v3.savedAs, 'ada-app-v003');
    assert.equal(v3.carriedEdits, 0);
    assert.deepEqual(w.itemKeys('ada-app-v003'), ['ada-heart', 'ada-leaf']);
  } finally { w.close(); }
});

test('manage versions: list, open (number / "v002" / master); delete a version; the master cannot be deleted', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    await w.ok('uiux_save_as', {}); await w.ok('uiux_save_as', {}); await w.ok('uiux_save_as', {});
    let m = await w.ok('uiux_manage_versions', {});
    assert.equal(m.master.key, w.mine.key);
    assert.deepEqual(m.versions.map(v => v.key), ['ada-app-v001', 'ada-app-v002', 'ada-app-v003']);
    assert.equal(m.latest, 'ada-app-v003');
    assert.equal(m.versions.find(v => v.focused).key, 'ada-app-v003');
    assert.ok(m.versions.every(v => v.items === 1));
    m = await w.ok('uiux_manage_versions', { open: 'v001' });
    assert.equal(m.opened, 'ada-app-v001');
    assert.equal(m.versions.find(v => v.focused).number, 1);
    m = await w.ok('uiux_manage_versions', { open: 'master' });
    assert.equal(m.master.focused, true);
    assert.equal((await w.err('uiux_manage_versions', { open: 'v009' })).code, 'NOT_FOUND');
    // delete the middle one
    const d = await w.ok('uiux_delete_version', { version: 'v002' });
    assert.deepEqual(d.remaining, ['ada-app-v001', 'ada-app-v003']);
    assert.equal(w.itemKeys('ada-app-v002'), null, 'project is gone');
    assert.equal((await w.err('uiux_delete_version', { version: 'v002' })).code, 'NOT_FOUND');
    // deleting the focused version returns focus to the master
    await w.ok('uiux_manage_versions', { open: 3 });
    const d3 = await w.ok('uiux_delete_version', { version: 'ada-app-v003' });
    assert.equal(d3.focusedNow, w.mine.key);
    assert.equal((await w.ok('uiux_whoami')).focus.key, w.mine.key);
    // numbering never reuses a number that is still taken
    const again = await w.ok('uiux_save_as', {});
    assert.equal(again.savedAs, 'ada-app-v002', 'v002 is free again, v001 still exists');
  } finally { w.close(); }
});

test('purge versions: needs confirm; the latest becomes the master, every version is deleted, history restarts clean', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    await w.err('uiux_purge_versions', { confirm: true });   // no versions yet
    await w.ok('uiux_stage_item', { item: icon('ada-heart') });
    await w.ok('uiux_save_as', {});                                  // v001: star + heart
    await w.ok('uiux_stage_delete', { type: 'icon', ref: 'ada-star' });
    await w.ok('uiux_stage_item', { item: icon('ada-leaf', 'M3 3h18v18H3z') });
    await w.ok('uiux_save_as', {});                                  // v002: heart + leaf
    const mp = w.c.projects.list({ user: w.ada.user }).find(p => p.key === w.mine.key);
    const masterUid = w.c.db.prepare('SELECT uid FROM icons WHERE project_id = ? AND key = ?').get(mp.id, 'ada-star').uid;

    const plan = await w.ok('uiux_purge_versions', {});
    assert.equal(plan.needsConfirm, true);
    assert.equal(plan.plan.becomesMaster, 'ada-app-v002');
    assert.deepEqual(plan.plan.deleteVersions, ['ada-app-v001', 'ada-app-v002']);
    assert.equal(w.itemKeys('ada-app-v001').length, 2, 'nothing deleted without confirm');
    assert.deepEqual(w.itemKeys(w.mine.key), ['ada-star']);

    const done = await w.ok('uiux_purge_versions', { confirm: true });
    assert.equal(done.purged, true);
    assert.equal(done.becameMaster, 'ada-app-v002');
    assert.deepEqual(done.deletedVersions, ['ada-app-v001', 'ada-app-v002']);
    assert.deepEqual(w.itemKeys(w.mine.key), ['ada-heart', 'ada-leaf'], 'master now holds the latest design');
    assert.equal(w.itemKeys('ada-app-v001'), null);
    assert.equal(w.itemKeys('ada-app-v002'), null);
    assert.equal(w.c.db.prepare("SELECT COUNT(*) AS n FROM icons WHERE key IN ('ada-heart','ada-leaf') AND project_id <> ?").get(mp.id).n, 0, 'no orphaned version items');
    assert.equal(w.c.db.prepare('SELECT 1 FROM icons WHERE uid = ?').get(masterUid), undefined, 'the master\'s removed item is gone');
    // the master is still the same project (id, key, owner) and focused, with a clean single-version history
    const after = w.c.projects.list({ user: w.ada.user }).find(p => p.key === w.mine.key);
    assert.equal(after.id, mp.id);
    assert.equal(done.focused, w.mine.key);
    const vs = await w.ok('uiux_list_versions', {});
    assert.equal(vs.versions.length, 1, 'clean history');
    assert.equal(vs.head, 1);
    assert.equal((await w.ok('uiux_manage_versions', {})).total, 0);
    assert.equal((await w.ok('uiux_list_edit_ops', {})).staged, 0);
    // and it keeps working: edit + save on the master
    await w.ok('uiux_stage_item', { item: icon('ada-new', 'M2 2h20v20H2z') });
    assert.equal((await w.ok('uiux_save', {})).saved, true);
  } finally { w.close(); }
});

test('design keys: the audit log records every call; focus rows are private and cascade with the key', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.mine.key });
    await w.ok('uiux_stage_item', { item: icon('ada-heart') });
    await w.ok('uiux_save', {});
    const tools = w.c.db.prepare("SELECT tool FROM mcp_audit_log WHERE event = 'tool.call'").all().map(r => r.tool);
    for (const t of ['uiux_edit_project', 'uiux_stage_item', 'uiux_save']) assert.ok(tools.includes(t), t);
    assert.equal(w.c.db.prepare('SELECT COUNT(*) AS n FROM design_focus').get().n, 1);
    // focus is bound to the key row: deleting the key removes it (no stale focus can be inherited)
    w.c.db.prepare("DELETE FROM api_keys WHERE name = 'cli'").run();
    assert.equal(w.c.db.prepare('SELECT COUNT(*) AS n FROM design_focus').get().n, 0);
  } finally { w.close(); }
});

test('isolation (control): the same public-library item IS readable and referenceable with a plain account key, never with a design key', async () => {
  const w = await world();
  try {
    w.c.db.prepare("UPDATE icons SET visibility = 'public' WHERE key = 'bob-dot'").run();
    const button = { type: 'button', key: 'ada-dot-button', name: 'Dot', label: 'Dot', descriptionDev: 'Uses a public icon.', mcpContext: { purpose: 'x' }, width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 48, height: 48, rx: 12 } }, { tag: 'use', kind: 'instance', ref: { type: 'icon', key: 'bob-dot' }, attrs: { x: 12, y: 12, width: 24, height: 24 } }] };
    // plain account key (control): finds it and can use it
    assert.ok(JSON.stringify(await w.ok('uiux_search_items', { project: w.mine.key, query: 'bob dot' }, w.plain)).includes('bob-dot'), 'plain key sees public items');
    const cs = await w.ok('uiux_begin_changeset', { project: w.mine.key }, w.plain);
    assert.equal((await w.ok('uiux_stage_item', { project: w.mine.key, changeset: cs.changeset, item: button }, w.plain)).op, 'create');
    // design key: search, get, list_workflows and staging a reference never reach it
    await w.ok('uiux_edit_project', { project: w.mine.key });
    assert.equal((await w.ok('uiux_search_items', { query: 'bob dot' })).total, 0, 'search hides public items');
    const g = await w.err('uiux_get_item', { type: 'icon', ref: 'bob-dot' });
    assert.ok(['FORBIDDEN', 'NOT_FOUND'].includes(g.code), g.code);
    const st = await w.err('uiux_stage_item', { item: button });
    assert.equal(st.code, 'VALIDATION_FAILED');
    assert.match(JSON.stringify(st), /not visible to this project/);
    assert.equal((await w.ok('uiux_list_edit_ops')).staged, 0, 'nothing staged');
    assert.equal((await w.ok('uiux_request_item', { type: 'icon', intent: 'bob dot glyph', searchOnly: true })).candidates.length, 0, 'item requests do not leak candidates');
  } finally { w.close(); }
});
