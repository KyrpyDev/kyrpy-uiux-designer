/**
 * Follow-ups after M7: per-project keys (F1), version restore (F2), portable click/event targets (F3),
 * native adapters + live resource subscriptions over SSE (F4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { PG_SCHEMA_SQL } from '../../infrastructure/postgres/pg-sync-service.js';
import { parseColor, identifier } from '../domain/native-adapters.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = p => ({ descriptionDev: `followup ${p}`, mcpContext: { purpose: p } });
const DOT = [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }];

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada.user });
  const bp = c.projects.create({ name: 'Bob App' }, { actor: bob.user });
  const key = c.mcp.apiKeys.create({ name: 'agent', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const post = async (body, headers = {}) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, headers: r.headers, body: r.status === 202 ? null : await r.json() };
  };
  const call = async (name, args = {}) => (await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })).body.result;
  const ok = async (name, args) => { const r = await call(name, args); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return r.structuredContent; };
  const rest = async (method, path, body, token = ada.token) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const approveAll = async sub => (await rest('POST', `/api/changesets/${sub.changeset}/review`, { approve: sub.ops.map(o => o.opUid) })).data;
  return { c, p, bp, ada, bob, key, base, post, call, ok, rest, approveAll, close: () => { c.mcp.http.stop(); server.close(); c.close(); } };
}

test('F1: keys are unique per project, not globally; trash restore keeps the uid', async () => {
  const w = await world();
  try {
    const a = w.c.icon.create({ name: 'Star', key: 'star', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: DOT });
    const b = w.c.icon.create({ name: 'Star', key: 'star', projectId: w.bp.id, visibility: 'project' }, { actor: w.bob.user, nodes: DOT });
    assert.notEqual(a.id, b.id, 'same key in two projects');
    assert.throws(() => w.c.icon.create({ name: 'Star 2', key: 'star', projectId: w.p.id }, { actor: w.ada.user }), /already exists in this project/);
    assert.equal(w.c.icon.clone(a.id, { projectId: w.bp.id + 0, visibility: 'project' }).key, 'star-2', 'clone into a project that has the key');
    const item = await w.ok('uiux_get_item', { type: 'icon', ref: 'star' });
    assert.equal(item.uid, w.c.mcp.query.reads.findInProject('icon', 'star', w.p.id).uid, 'a key resolves inside the caller\'s project');
    const uid = item.uid;
    const del = w.c.icon.remove(a.id, { actor: w.ada.user });
    w.c.trash.restore(del.trashId, { actor: w.ada.user });
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'star', w.p.id).uid, uid, 'restored item keeps its uid');
    assert.match(PG_SCHEMA_SQL, /DROP CONSTRAINT IF EXISTS "icons_key_key"/);
    assert.match(PG_SCHEMA_SQL, /ux_icons_project_key ON "icons"\(project_id, key\)/);
  } finally { w.close(); }
});

test('F3: click/event targets are portable ({type, uid, key}), applied to real ids, hashed by uid and re-pointed on clone', async () => {
  const w = await world();
  try {
    const home = w.c.screen.create({ name: 'Home', key: 'home', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: DOT });
    const cs = await w.ok('uiux_begin_changeset', {});
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'screen', key: 'detail', name: 'Detail', label: 'Detail', ...docs('detail'), nodes: [{ tag: 'rect', attrs: { x: 1, y: 2, width: 30, height: 9 } }] } });
    const btn = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'go', name: 'Go', label: 'Open detail', ...docs('navigates'), width: 120, height: 48,
      nodes: [{ tag: 'rect', name: 'bg', attrs: { x: 0, y: 0, width: 120, height: 48 }, onClick: { type: 'screen', target: { type: 'screen', key: 'detail' } },
        events: [{ trigger: 'mouseover', type: 'animate', animationType: 'pulse', targetNodeIndex: 1 }, { trigger: 'dblclick', type: 'screen', target: { key: 'home' } }] },
      { tag: 'text', name: 'label', text: 'Go', attrs: { x: 60, y: 30 } }] } });
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset });
    await w.approveAll(sub);
    const b = w.c.button.get(w.c.mcp.query.reads.findInProject('button', 'go', w.p.id).id);
    const detail = w.c.mcp.query.reads.findInProject('screen', 'detail', w.p.id);
    const rect = b.nodes.find(n => n.name === 'bg'), label = b.nodes.find(n => n.name === 'label');
    assert.equal(rect.onClick.targetId, detail.id, 'target staged in the same changeset → real id');
    assert.equal(rect.events[0].targetNodeId, label.id, 'node index → real node id');
    assert.equal(rect.events[1].targetId, home.id);
    const json = await w.ok('uiux_get_item', { type: 'button', ref: 'go' });
    const jr = json.nodes.find(n => n.name === 'bg');
    assert.deepEqual(jr.onClick.target, { type: 'screen', uid: detail.uid, key: 'detail' });
    assert.equal(jr.events[0].targetNodeIndex, json.nodes.find(n => n.name === 'label').index);
    assert.equal(json.contentHash, btn.proposedHash, 'hash after apply = proposed hash');
    const deps = (await w.ok('uiux_get_manifest', { includeDeps: true })).items.find(i => i.key === 'go').deps;
    assert.ok(deps.includes(detail.uid) && deps.includes(w.c.mcp.query.reads.uidOf('screen', home.id)), `click targets are dependencies: ${JSON.stringify(deps)} ${detail.uid}`);
    // round trip: restaging the JSON is "unchanged"
    const cs2 = await w.ok('uiux_begin_changeset', {});
    assert.equal((await w.ok('uiux_stage_item', { changeset: cs2.changeset, item: json })).unchanged, true);
    // project scope: a target in another library is cloned and the action re-pointed
    const pub = w.c.screen.create({ name: 'Help', key: 'help', projectId: w.bp.id, visibility: 'public' }, { actor: w.bob.user, nodes: DOT });
    w.c.button.replaceNodes(b.id, b.nodes.map(n => (n.name === 'bg' ? { ...n, onClick: { type: 'screen', targetId: pub.id } } : n)));
    await w.ok('uiux_get_manifest', {});
    const clone = w.c.mcp.query.reads.findInProject('screen', 'help', w.p.id);
    assert.ok(clone, 'public target cloned into the project');
    assert.equal(w.c.button.get(b.id).nodes.find(n => n.name === 'bg').onClick.targetId, clone.id, 'action re-pointed at the clone');
  } finally { w.close(); }
});

test('F2: restore a version — exact manifest back, deleted item returns with its uid, reviewed like a changeset', async () => {
  const w = await world();
  try {
    const star = w.c.icon.create({ name: 'Star', key: 'star', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: [{ tag: 'path', attrs: { d: 'M12 2l3 7h7z' } }] });
    w.c.icon.create({ name: 'Dot', key: 'dot', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: DOT });
    const v1 = (await w.ok('uiux_list_versions', {})).versions[0];
    const starUid = w.c.mcp.query.reads.findInProject('icon', 'star', w.p.id).uid;
    w.c.icon.update(star.id, { label: 'Star changed' });
    w.c.icon.remove(w.c.mcp.query.reads.findInProject('icon', 'dot', w.p.id).id, { actor: w.ada.user });
    w.c.icon.create({ name: 'New', key: 'new', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: [{ tag: 'rect', attrs: { x: 1, y: 1, width: 5, height: 5 } }] });
    const dotUid = v1 && (await w.ok('uiux_list_versions', {})) && w.c.mcp.versions.repo.byNumber(w.p.id, v1.number).manifest.find(e => e.key === 'dot').uid;
    assert.equal((await w.ok('uiux_list_versions', {})).head, 2);

    assert.equal((await w.rest('POST', `/api/projects/${w.p.id}/versions/${v1.number}/restore`, {}, w.bob.token)).status, 403);
    const r = await w.rest('POST', `/api/projects/${w.p.id}/versions/${v1.number}/restore`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.ops.map(o => `${o.op}:${o.key}`).sort(), ['create:dot', 'delete:new', 'update:star']);
    assert.equal(w.c.icon.get(star.id).label, 'Star changed', 'nothing changes before review');
    const done = await w.approveAll(r.data);
    assert.equal(done.status, 'approved');
    const versions = await w.ok('uiux_list_versions', {});
    assert.equal(versions.versions[0].source, 'restore');
    assert.equal(w.c.mcp.versions.repo.head(w.p.id).manifestHash, w.c.mcp.versions.repo.byNumber(w.p.id, v1.number).manifestHash, 'exactly version 1 again');
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'dot', w.p.id).uid, dotUid, 'deleted item is back with its uid');
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'star', w.p.id).uid, starUid);
    // via MCP: restoring the head is refused; restoring an equal state is "unchanged"
    assert.equal((await w.call('uiux_restore_version', { version: versions.head })).structuredContent.error.code, 'VALIDATION_FAILED');
    assert.equal((await w.ok('uiux_restore_version', { version: v1.number })).unchanged, true);
  } finally { w.close(); }
});

test('F4: flutter / compose / swiftui adapters are deterministic native code', async () => {
  assert.deepEqual(parseColor('#2E9BFF'), { r: 46, g: 155, b: 255, a: 1 });
  assert.deepEqual(parseColor('rgba(255, 0, 0, .5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('linear-gradient(red, blue)'), null);
  assert.equal(identifier('glass-surface'), 'glassSurface');
  assert.equal(identifier('class'), 'classValue');
  assert.equal(identifier('2x-large'), 'n2xLarge');
  const w = await world();
  try {
    w.c.icon.create({ name: 'Star', key: 'star', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: DOT });
    const principal = w.c.mcp.apiKeys.authenticate(w.key);
    const make = () => w.c.mcp.bundles.files(principal, { adapters: ['flutter', 'compose', 'swiftui'], includeSvg: false, styles: ['liquid'] }).files;
    const files = make();
    const get = p => files.find(f => f.path === p)?.content;
    assert.match(get('adapters/flutter/liquid/uiux_tokens.dart'), /static const Color accent = Color\(0xFF2E9BFF\);/);
    assert.match(get('adapters/flutter/liquid/uiux_icons.dart'), /static const String star = "uiux\/liquid\/icons\/star.svg";/);
    assert.match(get('adapters/compose/liquid/UiuxTokens.kt'), /package uiux\.liquid[\s\S]*val Accent = Color\(0xFF2E9BFF\)/);
    assert.match(get('adapters/compose/liquid/UiuxIcons.kt'), /Star\("star", "uiux\/liquid\/icons\/star.svg"\)/);
    assert.match(get('adapters/swiftui/liquid/UiuxTokens.swift'), /static let accent = Color\(\.sRGB, red: 0\.1804, green: 0\.6078, blue: 1, opacity: 1\)/);
    assert.match(get('adapters/swiftui/liquid/UiuxIcons.swift'), /case star = "star"/);
    for (const a of ['flutter', 'compose', 'swiftui']) assert.match(get(`adapters/${a}/liquid/icons/star.svg`), /<svg/);
    const adapters = fs => fs.filter(f => f.path.startsWith('adapters/')).map(f => f.content);
    assert.deepEqual(adapters(make()), adapters(files), 'deterministic');
  } finally { w.close(); }
});

test('F4: resources/subscribe + GET /mcp event stream deliver notifications/resources/updated', async () => {
  const w = await world();
  try {
    const init = await w.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    assert.equal(init.body.result.capabilities.resources.subscribe, true);
    const sid = init.headers.get('mcp-session-id');
    const noSession = await w.post({ jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'uiux://project/manifest' } });
    assert.ok(noSession.body.error, 'subscriptions need a session');
    assert.ok((await w.post({ jsonrpc: '2.0', id: 3, method: 'resources/subscribe', params: { uri: 'uiux://nope' } }, { 'mcp-session-id': sid })).body.error);
    for (const uri of ['uiux://project/manifest', 'uiux://requests/open']) {
      assert.deepEqual((await w.post({ jsonrpc: '2.0', id: 4, method: 'resources/subscribe', params: { uri } }, { 'mcp-session-id': sid })).body.result, {});
    }
    assert.equal((await fetch(`${w.base}/mcp`, { headers: { authorization: `Bearer ${w.key}` } })).status, 405, 'GET without SSE accept');
    const ctrl = new AbortController();
    const stream = await fetch(`${w.base}/mcp`, { headers: { authorization: `Bearer ${w.key}`, accept: 'text/event-stream', 'mcp-session-id': sid }, signal: ctrl.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    let text = '';
    const until = async re => {
      const end = Date.now() + 3000;
      while (!re.test(text) && Date.now() < end) {
        const { value, done } = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ value: null }), 200))]);
        if (done) break;
        if (value) text += new TextDecoder().decode(value);
      }
      return re.test(text);
    };
    assert.ok(await until(/stream open/));
    // a designer edit becomes a version → manifest subscribers are told
    w.c.icon.create({ name: 'Live', key: 'live', projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: DOT });
    w.c.mcp.versions.ensureHead(w.p.id);
    assert.ok(await until(/"method":"notifications\/resources\/updated","params":\{"uri":"uiux:\/\/project\/manifest"\}/), text);
    assert.ok(!/project\/versions"/.test(text), 'only subscribed uris');
    await w.ok('uiux_request_item', { type: 'icon', intent: 'bell icon' });
    assert.ok(await until(/uiux:\/\/requests\/open/), 'request inbox subscribers are told');
    ctrl.abort();
  } finally { w.close(); }
});

test('F3: cyclic navigation in one changeset (a new screen holds a new button that opens that screen)', async () => {
  const w = await world();
  try {
    const cs = await w.ok('uiux_begin_changeset', {});
    const btn = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'open-settings', name: 'Settings', label: 'Open settings', ...docs('opens settings'), width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 48, height: 48 }, onClick: { type: 'screen', target: { type: 'screen', key: 'settings' } } }] } });
    assert.equal(btn.warnings.find(x => x.code === 'ACTION_TARGET')?.path, 'nodes[0].onClick', 'staging warns, does not fail');
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'screen', key: 'settings', name: 'Settings', label: 'Settings', ...docs('settings screen'),
      nodes: [{ tag: 'use', kind: 'instance', ref: { type: 'button', key: 'open-settings' }, attrs: { x: 10, y: 10, width: 48, height: 48 } }] } });
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset });
    const done = await w.approveAll(sub);
    assert.equal(done.status, 'approved');
    const screen = w.c.mcp.query.reads.findInProject('screen', 'settings', w.p.id);
    const b = w.c.button.get(w.c.mcp.query.reads.findInProject('button', 'open-settings', w.p.id).id);
    assert.equal(b.nodes[0].onClick.targetId, screen.id, 'the deferred target was patched in after both were created');
    assert.equal(w.c.screen.get(screen.id).nodes[0].refId, b.id);
    // a target that never comes: submit refuses
    const cs2 = await w.ok('uiux_begin_changeset', {});
    await w.ok('uiux_stage_item', { changeset: cs2.changeset, item: { type: 'button', key: 'broken', name: 'Broken', label: 'Broken', ...docs('x'), width: 48, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 4, height: 4 }, onClick: { type: 'screen', target: { type: 'screen', key: 'nowhere' } } }] } });
    const r = await w.call('uiux_submit_changeset', { changeset: cs2.changeset });
    assert.equal(r.structuredContent.error.code, 'VALIDATION_FAILED');
    assert.match(r.content[0].text, /nowhere/);
  } finally { w.close(); }
});

test('F5: the project exports as a working HTML app with a machine-readable interaction spec (all SVG)', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const w = await world();
  try {
    const u = w.ada.user, P = { projectId: w.p.id, visibility: 'project' };
    const home = w.c.screen.create({ name: 'Home', key: 'home', ...P, descriptionDev: 'Start screen' }, { actor: u, nodes: [{ tag: 'rect', name: 'open', attrs: { x: 10, y: 10, width: 80, height: 30 } }] });
    const detail = w.c.screen.create({ name: 'Detail', key: 'detail', ...P }, { actor: u, nodes: [{ tag: 'circle', attrs: { cx: 20, cy: 20, r: 9 } }] });
    const ic = w.c.icon.create({ name: 'Gear', key: 'gear', ...P }, { actor: u, nodes: DOT });
    const btn = w.c.button.create({ name: 'Menu', key: 'menu-btn', ...P, descriptionDev: 'Opens the main menu' }, { actor: u, nodes: [{ tag: 'rect', name: 'bg', attrs: { x: 0, y: 0, width: 48, height: 48 }, onClick: { type: 'screen', targetId: detail.id } }] });
    w.c.menus.addItem(btn.id, { label: 'Settings', iconId: ic.id, action: 'screen', targetScreenId: detail.id });
    w.c.screen.replaceNodes(home.id, [...w.c.screen.get(home.id).nodes, { tag: 'use', kind: 'instance', refType: 'button', refId: btn.id, attrs: { x: 100, y: 10, width: 48, height: 48 } }]);
    const wf = w.c.workflows.create({ name: 'Main', key: 'main', ...P }, { actor: u });
    w.c.workflows.placeScreen(wf.id, { screenId: home.id }); w.c.workflows.placeScreen(wf.id, { screenId: detail.id, x: 400 });
    w.c.workflows.addLink(wf.id, { fromScreenId: home.id, fromNodeId: w.c.screen.get(home.id).nodes[0].id, toScreenId: detail.id, name: 'open detail', trigger: 'click' });

    const exp = await w.ok('uiux_export_app', { styles: ['liquid'] });
    const dir = mkdtempSync(join(tmpdir(), 'uiux-app-'));
    const res = await fetch(exp.url);
    writeFileSync(join(dir, 'b.tar.gz'), Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['-xzf', join(dir, 'b.tar.gz'), '-C', dir]);
    const app = join(dir, 'app');
    assert.ok(existsSync(join(app, 'index.html')), 'entry page');
    for (const s of ['home', 'detail']) assert.ok(existsSync(join(app, 'screens', `${s}.html`)), s);
    assert.ok(existsSync(join(app, 'js', 'app.js')) && existsSync(join(app, 'DEV-NOTES.md')));
    const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [e.name]));
    assert.ok(!walk(app).some(f => /\.(png|jpe?g|gif|webp)$/i.test(f)), 'images are SVG only');
    const homeHtml = readFileSync(join(app, 'screens', 'home.html'), 'utf8');
    assert.match(homeHtml, /detail/, 'the workflow link / action to detail is wired');
    const spec = JSON.parse(readFileSync(join(app, 'interactions.json'), 'utf8'));
    assert.equal(spec.entry, 'app/index.html');
    assert.equal(spec.workflows[0].links[0].fromNodeName, 'open');
    assert.equal(spec.workflows[0].links[0].to.key, 'detail');
    const b = spec.buttons.find(x => x.key === 'menu-btn');
    assert.equal(b.descriptionDev, 'Opens the main menu');
    assert.deepEqual(b.interactions[0].onClick.target, { type: 'screen', uid: w.c.mcp.query.reads.uidOf('screen', detail.id), key: 'detail' });
    assert.equal(b.menu[0].targetScreen.key, 'detail', 'menu items and their actions are in the spec');
    assert.equal(b.menu[0].icon.key, 'gear');
    assert.equal(spec.screens.find(s => s.key === 'home').components[0].uses.key, 'menu-btn');
    // designer download of the same thing
    const r = await fetch(`${w.base}/api/projects/${w.p.id}/app-export`, { headers: { authorization: `Bearer ${w.ada.token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/gzip');
    assert.equal((await fetch(`${w.base}/api/projects/${w.p.id}/app-export`, { headers: { authorization: `Bearer ${w.bob.token}` } })).status, 403);
  } finally { w.close(); }
});

test('spec gaps: get_item html, manifest of a version, need-ui-item prompt, D6 public items, WCAG contrast', async () => {
  const { contrastRatio, contrastWarnings } = await import('../domain/item-validation.js');
  assert.equal(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }).toFixed(0), '21');
  const w = await world();
  try {
    const u = w.ada.user, P = { projectId: w.p.id, visibility: 'project' };
    const s = w.c.screen.create({ name: 'Home', key: 'home', ...P, descriptionDev: 'Start <b>here</b>' }, { actor: u, nodes: DOT });
    w.c.button.create({ name: 'Go', key: 'go', ...P }, { actor: u, nodes: [{ tag: 'rect', name: 'bg', attrs: { x: 0, y: 0, width: 40, height: 40 }, onClick: { type: 'screen', targetId: s.id } }] });
    // html format
    const h = await w.ok('uiux_get_item', { type: 'button', ref: 'go', format: 'html' });
    assert.match(h.html, /^<!doctype html>/);
    assert.match(h.html, /<svg[\s>]/);
    assert.match(h.html, /click → screen &quot;home&quot;/);
    assert.match(h.html, /<script type="application\/json" id="uiux-item">/);
    const sh = await w.ok('uiux_get_item', { type: 'screen', ref: 'home', format: 'html' });
    assert.match(sh.html, /Start &lt;b&gt;here&lt;\/b&gt;/, 'item text is escaped');
    // manifest of a stored version
    const v1 = (await w.ok('uiux_get_manifest', {})).version;
    w.c.icon.create({ name: 'Later', key: 'later', ...P }, { actor: u, nodes: DOT });
    const live = await w.ok('uiux_get_manifest', {});
    const old = await w.ok('uiux_get_manifest', { version: v1 });
    assert.equal(old.version, v1);
    assert.ok(!old.items.some(i => i.key === 'later') && live.version > v1);
    // prompt
    const pr = (await w.post({ jsonrpc: '2.0', id: 9, method: 'prompts/get', params: { name: 'need-ui-item', arguments: { type: 'icon', intent: 'share arrow' } } })).body.result;
    assert.match(pr.messages[0].content.text, /uiux_request_item/);
    // D6
    const cs = await w.ok('uiux_begin_changeset', {});
    const pub = { type: 'icon', key: 'pub-ai', name: 'Pub', visibility: 'public', ...docs('p'), nodes: [{ tag: 'rect', attrs: { x: 2, y: 2, width: 9, height: 9 } }] };
    const denied = await w.call('uiux_stage_item', { changeset: cs.changeset, item: pub });
    assert.equal(denied.structuredContent.error.details.errors[0].code, 'VISIBILITY');
    w.c.mcp.apiKeys.updateAiSettings(w.p.id, { mayCreatePublicItems: true }, w.ada.user);
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: pub });
    // contrast warning: grey on grey
    const low = await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'button', key: 'low', name: 'Low', label: 'Low', ...docs('l'), width: 120, height: 48,
      nodes: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 120, height: 48, fill: '#777777' } }, { tag: 'text', text: 'Low', attrs: { x: 10, y: 30, fill: '#888888' } }] } });
    assert.equal(low.warnings.find(x => x.code === 'A11Y_CONTRAST')?.path, 'nodes[1].attrs.fill');
    assert.deepEqual(contrastWarnings({ nodes: [{ tag: 'rect', attrs: { fill: '{{bg}}' } }, { tag: 'text', attrs: { fill: '{{fg}}' } }] }, { bg: '#000', fg: '#fff' }, (await import('../domain/native-adapters.js')).parseColor), [], 'tokens resolved; white on black passes');
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset });
    await w.approveAll(sub);
    assert.equal(w.c.mcp.query.reads.findInProject('icon', 'pub-ai', w.p.id).visibility, 'public', 'public only because the owner allowed it');
  } finally { w.close(); }
});

test('item requests: fulfilling with a public item clones it into the project; a rejected proposal reopens with the reviewer\'s reason', async () => {
  const w = await world();
  try {
    const pub = w.c.icon.create({ name: 'Bell', key: 'bell', visibility: 'public' }, { actor: w.bob.user, nodes: DOT });
    const hidden = w.c.icon.create({ name: 'Secret', key: 'secret', projectId: w.bp.id, visibility: 'project' }, { actor: w.bob.user, nodes: DOT });
    const req = (await w.ok('uiux_request_item', { type: 'icon', intent: 'notification bell icon' })).request;
    const nope = await w.call('uiux_fulfill_request', { request: req.uid, type: 'icon', ref: hidden.uid || 'secret' });
    assert.ok(nope.isError, 'an item of another project is not usable');
    const done = await w.ok('uiux_fulfill_request', { request: req.uid, type: 'icon', ref: 'bell' });
    assert.equal(done.status, 'fulfilled');
    const clone = w.c.mcp.query.reads.findInProject('icon', 'bell', w.p.id);
    assert.ok(clone && clone.id !== pub.id, 'public item cloned into the project library');
    assert.equal(done.item.uid, clone.uid, 'the request points at the project clone');
    assert.match(done.note, /cloned into the project/);

    // a proposal for a second request is rejected → request reopens with the reason
    const r2 = (await w.ok('uiux_request_item', { type: 'icon', intent: 'calendar icon for dates' })).request;
    await w.ok('uiux_claim_request', { request: r2.uid });
    const cs = await w.ok('uiux_begin_changeset', {});
    await w.ok('uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'calendar', name: 'Calendar', label: 'Calendar', ...docs('dates'), nodes: [{ tag: 'rect', attrs: { x: 3, y: 4, width: 18, height: 16 } }] } });
    assert.equal((await w.ok('uiux_fulfill_request', { request: r2.uid, type: 'icon', ref: 'calendar', changeset: cs.changeset })).status, 'in-review');
    const sub = await w.ok('uiux_submit_changeset', { changeset: cs.changeset });
    const rev = await w.rest('POST', `/api/changesets/${sub.changeset}/review`, { reject: sub.ops.map(o => o.opUid), comment: 'needs a visible date grid' });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    const back = await w.ok('uiux_get_request', { request: r2.uid });
    assert.equal(back.status, 'claimed');
    assert.match(back.note, /rejected in review: needs a visible date grid/);
  } finally { w.close(); }
});
