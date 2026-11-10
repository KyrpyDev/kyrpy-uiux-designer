import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContainer } from '../composition-root.js';
import { collectScreenRoutes, crawlScreenRoutes } from '../domain/screen-routes.js';

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('collectScreenRoutes: click actions, events, nested buttons / elements / popups and menu items; cycles are safe', () => {
  const nodes = {
    'screen:1': [
      { id: 10, name: 'go', onClick: { type: 'screen', targetId: 2 } },
      { id: 11, name: 'bar', kind: 'instance', refType: 'element', refId: 5 },
      { id: 12, name: 'self', events: [{ trigger: 'longpress', type: 'screen', targetId: 1 }] },
      { id: 13, name: 'pop', onClick: { type: 'popup', targetId: 6 } }
    ],
    'element:5': [{ id: 50, kind: 'instance', refType: 'button', refId: 7 }, { id: 51, kind: 'instance', refType: 'element', refId: 5 }],
    'element:6': [{ id: 60, name: 'inside popup', events: [{ trigger: 'dblclick', type: 'screen', targetId: 4 }] }],
    'button:7': []
  };
  const menus = { 7: [{ label: 'Settings', targetScreenId: 3 }, { label: 'Again', targetScreenId: 3 }, { label: 'More', targetElementId: 6 }] };
  const routes = collectScreenRoutes(1, { nodesOf: (t, id) => nodes[`${t}:${id}`], menuOf: id => menus[id] });
  assert.deepEqual(routes, [
    { toScreenId: 2, fromNodeId: 10, name: 'go', trigger: 'tap' },
    { toScreenId: 3, fromNodeId: 11, name: 'Settings', trigger: 'tap' },
    { toScreenId: 4, fromNodeId: 11, name: 'inside popup', trigger: 'dblclick' },
    { toScreenId: 4, fromNodeId: 13, name: 'inside popup', trigger: 'dblclick' }
  ], 'own node of the screen as the origin; a route to itself and duplicates are dropped');
  const crawl = crawlScreenRoutes(1, id => ({ 1: [{ toScreenId: 2 }, { toScreenId: 9 }], 2: [{ toScreenId: 3 }, { toScreenId: 1 }], 3: [] }[id]), { exists: id => id !== 9 });
  assert.deepEqual(crawl.order, [1, 2, 3]);
  assert.deepEqual([...crawl.level], [[1, 0], [2, 1], [3, 2]]);
  assert.equal(crawl.routes.length, 3, 'the loop back home is a route too; a route to a missing screen is dropped');
});

test('workflow from a screen: every routed screen is placed and linked, recursively; importing again adds nothing', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const own = { projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub };
    const mk = (name, nodes = []) => c.screen.create({ name, key: name, width: 390, height: 844, ...own }, { nodes });
    const detail = mk('rt-detail'), about = mk('rt-about'), lonely = mk('rt-lonely');
    const settings = mk('rt-settings', [{ tag: 'rect', name: 'to detail', attrs: { x: 0, y: 0, width: 40, height: 40 }, onClick: { type: 'screen', targetId: detail.id } }]);
    const btn = c.button.create({ name: 'rt-menu', key: 'rt-menu', width: 48, height: 48, ...own }, { nodes: [] });
    c.menus.addItem(btn.id, { label: 'Settings', action: 'screen', targetScreenId: settings.id });
    c.menus.addItem(btn.id, { label: 'About', action: 'screen', targetScreenId: about.id });
    const home = mk('rt-home', [{ tag: 'use', kind: 'instance', refType: 'button', refId: btn.id, name: 'menu', attrs: { x: 10, y: 10, width: 48, height: 48 } }]);
    c.nodes.create('screen', detail.id, { tag: 'rect', name: 'home', attrs: { x: 0, y: 0, width: 10, height: 10 }, onClick: { type: 'screen', targetId: home.id } });

    const menuNode = c.screen.get(home.id).nodes.find(n => n.refType === 'button');
    assert.deepEqual(c.workflows.screenRoutes(home.id).map(r => [r.toScreenId, r.fromNodeId, r.name]), [[settings.id, menuNode.id, 'Settings'], [about.id, menuNode.id, 'About']]);

    const wf = c.workflows.generateFromScreen({ screenId: home.id, name: 'App flow', ...own });
    assert.equal(wf.name, 'App flow');
    assert.deepEqual(wf.nodes.map(n => n.screenId).sort((a, b) => a - b), [detail.id, about.id, settings.id, home.id].sort((a, b) => a - b), 'the unreachable screen stays out');
    assert.ok(!wf.nodes.some(n => n.screenId === lonely.id));
    assert.deepEqual(wf.links.map(l => `${l.fromScreenId}>${l.toScreenId}`).sort(), [`${home.id}>${settings.id}`, `${home.id}>${about.id}`, `${settings.id}>${detail.id}`, `${detail.id}>${home.id}`].sort());
    assert.equal(wf.links.find(l => l.toScreenId === settings.id).name, 'Settings');
    assert.equal(wf.links.find(l => l.toScreenId === settings.id).fromNodeId, menuNode.id);
    assert.deepEqual(wf.imported, { screens: 4, links: 4, reached: 4 });
    const at = id => wf.nodes.find(n => n.screenId === id);
    assert.ok(at(home.id).x < at(settings.id).x && at(settings.id).x < at(detail.id).x, 'one column per route depth');
    assert.equal(at(settings.id).x, at(about.id).x); assert.notEqual(at(settings.id).y, at(about.id).y);

    assert.deepEqual(c.workflows.importRoutes(wf.id, { screenId: home.id, x: 900, y: 900 }).imported, { screens: 0, links: 0, reached: 4 });
    assert.equal(c.workflows.get(wf.id).nodes.find(n => n.screenId === home.id).x, at(home.id).x, 'placed screens keep their place');

    // dropping a screen into another workflow cascades from that screen on
    const wf2 = c.workflows.create({ name: 'Partial', ...own });
    const r2 = c.workflows.importRoutes(wf2.id, { screenId: settings.id, x: 100, y: 50 });
    assert.deepEqual(r2.imported, { screens: 4, links: 4, reached: 4 });
    assert.deepEqual([r2.nodes.find(n => n.screenId === settings.id).x, r2.nodes.find(n => n.screenId === settings.id).y], [100, 50]);

    assert.throws(() => c.workflows.generateFromScreen({ screenId: lonely.id, ...own }), /no menu item or click action/);
    assert.equal(c.workflows.list().filter(w => /lonely/.test(w.name)).length, 0, 'nothing is created for a screen without routes');
    assert.throws(() => c.workflows.importRoutes(wf.id, { screenId: 999999 }), /screen/);
  } finally { c.close(); }
});

test('screen → workflow tools are wired: topbar button, drop into the workflow canvas, draggable screen cells, routes', () => {
  const designer = src('../interfaces/web/js/components/designer.js'), wfd = src('../interfaces/web/js/components/workflow-designer.js');
  assert.match(designer, /this\.type === 'screen' \? ibtn\('workflow', 'Generate workflow', \(\) => this\.generateWorkflow\(\)/);
  assert.match(designer, /api\.workflowFromScreen\(\{ screenId: this\.doc\.id/);
  assert.match(wfd, /vp\.addEventListener\('drop'/); assert.match(wfd, /api\.importScreenRoutes\(this\.wf\.id, \{ screenId: s\.id/);
  assert.match(src('../interfaces/web/js/components/library-panel.js'), /ondragstart: this\.dragData\('screen', s\)/);
  const routes = src('../interfaces/http/controllers/misc-routes.js');
  assert.ok(routes.indexOf("'/api/workflows/from-screen'") > 0 && routes.indexOf("'/api/workflows/:id/import-routes'") > 0);
  const api = src('../interfaces/web/js/api.js');
  assert.match(api, /workflowFromScreen: b => api\.post\('\/api\/workflows\/from-screen', b\)/);
});

test('HTTP: POST /api/workflows/from-screen and /api/workflows/:id/import-routes', async () => {
  const { createHttpServer } = await import('../interfaces/http/server.js');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  try {
    const pub = c.publicUserId();
    const own = { projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub };
    const b = c.screen.create({ name: 'http-b', key: 'http-b', width: 390, height: 844, ...own }, { nodes: [] });
    const a = c.screen.create({ name: 'http-a', key: 'http-a', width: 390, height: 844, ...own }, { nodes: [{ tag: 'rect', name: 'next', attrs: { x: 0, y: 0, width: 9, height: 9 }, onClick: { type: 'screen', targetId: b.id } }] });
    const made = await post('/api/workflows/from-screen', { screenId: a.id, name: 'HTTP flow' });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.nodes.length, 2); assert.equal(made.data.links.length, 1); assert.equal(made.data.links[0].name, 'next');
    const none = await post('/api/workflows/from-screen', { screenId: b.id });
    assert.equal(none.status, 422);
    const again = await post(`/api/workflows/${made.data.id}/import-routes`, { screenId: a.id, x: 5, y: 5 });
    assert.equal(again.status, 200); assert.deepEqual(again.data.imported, { screens: 0, links: 0, reached: 2 });
  } finally { await new Promise(r => server.close(r)); c.close(); }
});
