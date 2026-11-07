/**
 * Account (user-wide) keys: list projects, the uiux_init selection flow (clone → new project, edit at a version),
 * scope / ownership limits, and the push of a cloned project → owner approval.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const STAR = 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z';

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const mine = c.projects.create({ name: 'Ada App', visibility: 'private' }, { actor: ada.user });
  c.icon.create({ name: 'Star', key: 'ada-star', projectId: mine.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'path', attrs: { d: STAR } }] });
  const bobPub = c.projects.create({ name: 'Bob Kit', visibility: 'public' }, { actor: bob.user });
  c.icon.create({ name: 'Bob Dot', key: 'bob-dot', projectId: bobPub.id, visibility: 'project' }, { actor: bob.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
  const bobPriv = c.projects.create({ name: 'Bob Secret', visibility: 'private' }, { actor: bob.user });
  const acc = c.mcp.apiKeys.create({ name: 'laptop', kind: 'account', scopes: ['read', 'propose', 'create'] }, ada.user).key;
  const readOnly = c.mcp.apiKeys.create({ name: 'ro', kind: 'account', scopes: ['read'] }, ada.user).key;
  const projKey = c.mcp.apiKeys.create({ name: 'repo', projectId: mine.id, scopes: ['read'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const rpc = async (method, params, bearer = acc) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}, bearer) => (await rpc('tools/call', { name, arguments: args }, bearer)).result;
  const ok = async (name, args, bearer) => { const r = await call(name, args, bearer); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return r.structuredContent; };
  const err = async (name, args, bearer) => { const r = await call(name, args, bearer); assert.ok(r.isError, `${name} should fail`); return r.structuredContent.error; };
  const rest = async (method, path, body, token = ada.token) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { c, ada, bob, mine, bobPub, bobPriv, acc, readOnly, projKey, rpc, call, ok, err, rest, close: () => { server.close(); c.close(); } };
}

test('account key: tool list, project injection, visibility (private projects are NOT_FOUND)', async () => {
  const w = await world();
  try {
    const tools = (await w.rpc('tools/list', {})).result.tools;
    const by = Object.fromEntries(tools.map(t => [t.name, t]));
    for (const n of ['uiux_list_projects', 'uiux_clone_project', 'uiux_create_project']) assert.ok(by[n], n);
    assert.ok(by.uiux_get_manifest.inputSchema.required.includes('project'), 'project injected into project tools');
    assert.ok(!(by.uiux_init.inputSchema.required || []).includes('project'), 'uiux_init: project optional (selection)');
    assert.ok(by.uiux_init.inputSchema.properties.mode, 'uiux_init: mode for account keys');
    const projTools = (await w.rpc('tools/list', {}, w.projKey)).result.tools.map(t => t.name);
    assert.ok(!projTools.includes('uiux_list_projects'), 'account-only tools hidden for project keys');
    const pk = (await w.rpc('tools/list', {}, w.projKey)).result.tools.find(t => t.name === 'uiux_init');
    assert.ok(!pk.inputSchema.properties.mode, 'project keys do not see the selection arguments');

    const list = await w.ok('uiux_list_projects', {});
    const keys = list.projects.map(p => p.key);
    assert.ok(keys.includes(w.mine.key) && keys.includes(w.bobPub.key));
    assert.ok(!keys.includes(w.bobPriv.key), 'private project of another user is invisible');
    assert.equal((await w.err('uiux_get_manifest', { project: w.bobPriv.key })).code, 'NOT_FOUND');
    assert.equal((await w.err('uiux_get_manifest', { project: 'no-such-project' })).code, 'NOT_FOUND');
    assert.ok(!(await w.call('uiux_get_manifest', { project: w.bobPub.key })).isError, 'public project readable');
    const denied = await w.err('uiux_begin_changeset', { project: w.bobPub.key });
    assert.equal(denied.code, 'SCOPE_DENIED', 'cannot push into someone else\'s project');
  } finally { w.close(); }
});

test('account key: uiux_init without a choice returns projects + versions and asks the human', async () => {
  const w = await world();
  try {
    const sel = await w.ok('uiux_init', { platform: 'claude' });
    assert.equal(sel.needsSelection, true);
    assert.deepEqual(sel.options.map(o => o.mode), ['download', 'clone', 'edit']);
    assert.ok(sel.askHuman.some(s => /ask the human/i.test(s)));
    const mine = sel.projects.find(p => p.key === w.mine.key);
    const pub = sel.projects.find(p => p.key === w.bobPub.key);
    assert.equal(mine.canEdit, true);
    assert.equal(pub.canEdit, false, 'public project of another user: clone only');
    assert.equal(pub.canClone, true);
    assert.ok(mine.head >= 1 && mine.versions.length >= 1 && mine.versions[0].number === mine.head);
    assert.ok(sel.question.includes(w.bobPub.key));
    assert.ok(!sel.files, 'nothing to write before the human chooses');
    // read-only account key: clone not available
    const ro = await w.ok('uiux_init', {}, w.readOnly);
    assert.equal(ro.options.find(o => o.mode === 'clone').available, false);
    assert.equal((await w.err('uiux_init', { mode: 'clone', project: w.bobPub.key }, w.readOnly)).code, 'SCOPE_DENIED');
  } finally { w.close(); }
});

test('account key: clone → new owned project → install plan → push → owner approves', async () => {
  const w = await world();
  try {
    const plan = await w.ok('uiux_init', { mode: 'clone', project: w.bobPub.key, newProjectName: 'Ada Dot App', platform: 'claude', framework: 'react' });
    assert.equal(plan.selection.mode, 'clone');
    assert.equal(plan.selection.source.key, w.bobPub.key);
    const nk = plan.selection.project.key;
    assert.notEqual(nk, w.bobPub.key);
    assert.ok(plan.selection.copiedItems >= 1, 'design copied');
    const created = w.c.projects.list({ user: w.ada.user }).find(p => p.key === nk);
    assert.equal(Number(created.ownerId), Number(w.ada.user.id), 'new project owned by the key user');
    assert.equal(created.visibility, 'private');
    const cfg = JSON.parse(plan.files.find(f => f.path === '.uiux/config.json').content);
    assert.equal(cfg.project, nk);
    assert.equal(cfg.origin.project, w.bobPub.key);
    assert.equal(cfg.selection.mode, 'clone');
    assert.equal(cfg.mcpClient.keyKind, 'account');
    assert.ok(plan.lockfile.version >= 1);
    // clone of an older/unknown version is refused with a clear message
    assert.equal((await w.err('uiux_init', { mode: 'clone', project: w.bobPub.key, version: 99 })).code, 'NOT_FOUND');

    // push into the new project, owner (ada) approves
    const cs = await w.ok('uiux_begin_changeset', { project: nk, summary: 'app icons' });
    const st = await w.ok('uiux_stage_item', { project: nk, changeset: cs.changeset, item: { type: 'icon', key: 'ada-app-heart', name: 'Heart', descriptionDev: 'Favourite toggle.', mcpContext: { purpose: 'favourite' }, nodes: [{ tag: 'path', attrs: { d: STAR } }] } });
    assert.ok(st.opUid);
    const sub = await w.ok('uiux_submit_changeset', { project: nk, changeset: cs.changeset });
    const rev = await w.rest('POST', `/api/changesets/${sub.changeset}/review`, { approve: [st.opUid] });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    const after = await w.ok('uiux_search_items', { project: nk, query: 'ada-app-heart' });
    assert.ok(JSON.stringify(after).includes('ada-app-heart'), 'approved item is in the new project');
    assert.ok(!w.c.icon.list({}).some(i => i.key === 'ada-app-heart' && Number(i.projectId ?? i.project_id) === w.bobPub.id), 'source untouched');
  } finally { w.close(); }
});

test('account key: edit an owned project at a chosen version (older version → baseVersion, restore on request)', async () => {
  const w = await world();
  try {
    const sel = await w.ok('uiux_init', {});
    const v1 = sel.projects.find(p => p.key === w.mine.key).head;
    // a designer edit creates a newer version
    w.c.icon.create({ name: 'Moon', key: 'ada-moon', projectId: w.mine.id, visibility: 'project' }, { actor: w.ada.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8 } }] });
    const head = await w.ok('uiux_init', { mode: 'edit', project: w.mine.key });
    assert.equal(head.selection.version, head.selection.head);
    assert.ok(head.selection.head > v1, 'designer edit made a new version');
    const cfg = JSON.parse(head.files.find(f => f.path === '.uiux/config.json').content);
    assert.equal(cfg.project, w.mine.key);
    assert.equal(cfg.selection.mode, 'edit');

    const old = await w.ok('uiux_init', { mode: 'edit', project: w.mine.key, version: v1 });
    assert.equal(old.selection.version, v1);
    assert.equal(old.selection.sinceChosen.added, 1);
    assert.equal(JSON.parse(old.files.find(f => f.path === '.uiux/config.json').content).selection.baseVersion, v1);
    assert.ok(old.steps.some(s => s.includes('restore: true')));

    const rs = await w.ok('uiux_init', { mode: 'edit', project: w.mine.key, version: v1, restore: true });
    assert.ok(rs.selection.restore.changeset, 'restore changeset submitted');
    assert.equal(rs.selection.restore.status, 'submitted');

    // not the owner → cannot edit
    assert.equal((await w.err('uiux_init', { mode: 'edit', project: w.bobPub.key })).code, 'SCOPE_DENIED');
    assert.equal((await w.err('uiux_init', { mode: 'edit', project: w.mine.key, version: 999 })).code, 'NOT_FOUND');
  } finally { w.close(); }
});

test('account key: download installs a read-only copy with ALL design styles, button styles and a style switcher', async () => {
  const w = await world();
  try {
    const plan = await w.ok('uiux_init', { mode: 'download', project: w.bobPub.key, platform: 'claude', framework: 'react' });
    assert.equal(plan.selection.mode, 'download');
    assert.equal(plan.selection.project.key, w.bobPub.key);
    const cfg = JSON.parse(plan.files.find(f => f.path === '.uiux/config.json').content);
    assert.equal(cfg.project, w.bobPub.key, 'no new project is created');
    assert.equal(cfg.origin.project, w.bobPub.key);
    assert.equal(plan.lockfile.allStyles, true);
    assert.ok(plan.steps.some(st => /switch-style\.mjs/.test(st)));
    assert.ok(plan.bundle && plan.bundle.styles.length >= 10, 'every design style is in the bundle');
    const dir = mkdtempSync(join(tmpdir(), 'uiux-dl-'));
    try {
      const res = await fetch(plan.bundle.url);
      writeFileSync(join(dir, 'b.tgz'), Buffer.from(await res.arrayBuffer()));
      const src = join(dir, 'uiux', 'source'); mkdirSync(src, { recursive: true });
      execFileSync('tar', ['-xzf', join(dir, 'b.tgz'), '-C', src]);
      const read = f => readFileSync(join(src, f), 'utf8');
      const sty = JSON.parse(read('styles.json'));
      assert.ok(sty.designStyles.length >= 10 && sty.buttonStyles.length >= 8);
      for (const st of sty.designStyles.map(x => x.key)) assert.ok(existsSync(join(src, 'adapters/web', st, 'tokens.css')), `tokens for ${st}`);
      assert.match(read('tokens/button-styles.css'), /\[data-button-style="pill"\]/);
      assert.ok(JSON.parse(read('tokens/button-templates.json')).length >= 1);
      // the switcher works: list, switch design + button style
      const sw = ['switch-style.mjs'];
      assert.match(execFileSync('node', [join(src, ...sw), '--list'], { encoding: 'utf8' }), /Button styles/);
      const other = sty.designStyles.find(x => x.key !== sty.defaultStyle).key;
      execFileSync('node', [join(src, ...sw), other, 'pill'], { encoding: 'utf8' });
      const active = JSON.parse(readFileSync(join(dir, 'uiux', 'active', 'active.json'), 'utf8').toString());
      assert.equal(active.designStyle, other); assert.equal(active.buttonStyle, 'pill');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally { w.close(); }
});
