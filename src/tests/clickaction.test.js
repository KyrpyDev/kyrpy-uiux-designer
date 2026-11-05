import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildContainer } from '../composition-root.js';
import { normalizeClickAction, normalizeNode } from '../domain/entities.js';
import { designFingerprint, restoreBody } from '../domain/doc-fingerprint.js';
import { ValidationError } from '../domain/errors.js';

const fresh = () => buildContainer({ dbFile: ':memory:' });
const rect = (name, x, extra = {}) => ({ tag: 'rect', name, attrs: { x, y: 10, width: 60, height: 30 }, ...extra });
const file = (bundle, path) => bundle.files.find(f => f.path === path)?.content;

test('normalizeClickAction: none / back need nothing, the others need a target, drawers get a side', () => {
  assert.equal(normalizeClickAction(null), null);
  assert.equal(normalizeClickAction({ type: 'none' }), null);
  assert.deepEqual(normalizeClickAction({ type: 'back' }), { type: 'back' });
  assert.deepEqual(normalizeClickAction({ type: 'screen', targetId: '7' }), { type: 'screen', targetId: 7 });
  assert.deepEqual(normalizeClickAction({ type: 'popup', targetId: 3 }), { type: 'popup', targetId: 3 });
  assert.deepEqual(normalizeClickAction({ type: 'drawer', targetId: 3 }), { type: 'drawer', targetId: 3, side: 'right' }, 'drawers default to the right');
  assert.deepEqual(normalizeClickAction({ type: 'drawer', targetId: 3, side: 'left' }), { type: 'drawer', targetId: 3, side: 'left' });
  for (const bad of [{ type: 'fly' }, { type: 'screen' }, { type: 'popup', targetId: 'x' }, { type: 'popup', targetId: 0 }, { type: 'drawer', targetId: 1, side: 'middle' }, 'screen'])
    assert.throws(() => normalizeClickAction(bad), ValidationError, JSON.stringify(bad));
  assert.equal(normalizeNode({ tag: 'rect' }).onClick, null, 'a new node has no action');
  assert.equal(normalizeNode({ tag: 'rect' }, { partial: true }).onClick, undefined, 'a patch without it leaves it alone');
});

test('a click action is stored, survives clone / restore / undo-style replace, and counts as an edit', () => {
  const c = fresh();
  const target = c.screen.create({ name: 'Detail' });
  const s = c.screen.create({ name: 'Home' }, { nodes: [rect('go', 0), rect('plain', 80)] });
  const go = c.screen.get(s.id).nodes.find(n => n.name === 'go');
  const base = c.screen.get(s.id), fp = designFingerprint(base), body = restoreBody(base);
  assert.equal(base.nodes.find(n => n.name === 'go').onClick, null);

  const saved = c.screen.updateNode(go.id, { onClick: { type: 'screen', targetId: target.id } });
  assert.deepEqual(saved.onClick, { type: 'screen', targetId: target.id });
  assert.notEqual(designFingerprint(c.screen.get(s.id)), fp, 'adding an action is an edit');
  assert.throws(() => c.screen.updateNode(go.id, { onClick: { type: 'popup' } }), ValidationError, 'a popup needs an element');
  assert.deepEqual(c.screen.get(s.id).nodes.find(n => n.name === 'go').onClick, { type: 'screen', targetId: target.id }, 'a rejected patch changes nothing');

  const copy = c.screen.clone(s.id, { name: 'Home copy' });
  assert.deepEqual(copy.nodes.find(n => n.name === 'go').onClick, { type: 'screen', targetId: target.id }, 'clone keeps it');
  const dup = c.screen.duplicateNode(go.id);
  assert.deepEqual(dup.onClick, { type: 'screen', targetId: target.id }, 'duplicate keeps it');
  c.screen.removeNode(dup.id);

  const replaced = c.screen.replaceNodes(s.id, c.screen.get(s.id).nodes);
  assert.deepEqual(replaced.nodes.find(n => n.name === 'go').onClick, { type: 'screen', targetId: target.id }, 'replaceNodes (undo) keeps it');

  const back = c.screen.restore(s.id, body);                       // Reset to the saved version: the action goes away again
  assert.equal(designFingerprint(back), fp);
  assert.equal(back.nodes.find(n => n.name === 'go').onClick, null);
  c.screen.updateNode(go.id, { onClick: null });
  c.close();
});

test('export: actions become hotspots, popups and drawers become overlays with the element inside', () => {
  const c = fresh();
  const menu = c.element.create({ name: 'Side menu', width: 200, height: 400 }, { nodes: [rect('panel', 0), { tag: 'text', kind: 'text', text: 'Settings', attrs: { x: 10, y: 30 } }] });
  const sheet = c.element.create({ name: 'Filter sheet', width: 300, height: 220 }, { nodes: [rect('body', 0)] });
  const detail = c.screen.create({ name: 'Detail' });
  const home = c.screen.create({ name: 'Home' }, { nodes: [rect('open-detail', 0), rect('open-menu', 70), rect('open-sheet', 140), rect('go-back', 210), rect('hidden-one', 280), rect('plain', 350)] });
  const by = n => c.screen.get(home.id).nodes.find(x => x.name === n).id;
  c.screen.updateNode(by('open-detail'), { onClick: { type: 'screen', targetId: detail.id }, descriptionDev: 'opens the detail page' });
  c.screen.updateNode(by('open-menu'), { onClick: { type: 'drawer', targetId: menu.id, side: 'left' } });
  c.screen.updateNode(by('open-sheet'), { onClick: { type: 'popup', targetId: sheet.id } });
  c.screen.updateNode(by('go-back'), { onClick: { type: 'back' } });
  c.screen.updateNode(by('hidden-one'), { onClick: { type: 'popup', targetId: sheet.id }, visible: false });

  const b = c.exporter.buildBundle({ screenIds: [home.id], themeKeys: ['liquid', 'neu-dark'], title: 'T' });
  const page = file(b, 'screens/home.html');
  assert.match(page, /<a class="ud-hotspot" href="detail\.html"[^>]*data-action="screen"/, 'route = a real link');
  assert.match(page, /data-ud-open="ud-drawer-left-side-menu"/);
  assert.match(page, /data-ud-open="ud-popup-filter-sheet"/);
  assert.match(page, /data-ud-back/);
  assert.equal((page.match(/data-ud-open="ud-popup-filter-sheet"/g) || []).length, 1, 'a hidden element gets no hotspot');
  assert.equal((page.match(/id="ud-popup-filter-sheet"/g) || []).length, 1, 'one overlay per element and kind');
  assert.match(page, /<div class="ud-overlay ud-drawer ud-from-left" id="ud-drawer-left-side-menu" role="dialog"[^>]*hidden>\s*<div class="ud-scrim" data-ud-close>/, 'a drawer overlay starts hidden, with its backdrop');
  const overlay = page.slice(page.indexOf('id="ud-drawer-left-side-menu"'));
  assert.match(overlay, /svg data-theme="liquid"/); assert.match(overlay, /svg data-theme="neu-dark"/, 'the element is inlined for every exported theme');
  assert.match(overlay, /Settings/);

  const manifest = JSON.parse(file(b, 'data/manifest.json'));
  const acts = manifest.screens[0].actions;
  assert.deepEqual(acts.map(a => [a.name, a.type, a.to ?? a.element ?? null, a.side ?? null]),
    [['open-detail', 'screen', 'detail', null], ['open-menu', 'drawer', 'side-menu', 'left'], ['open-sheet', 'popup', 'filter-sheet', null], ['go-back', 'back', null, null]]);
  assert.equal(acts[0].descriptionDev, 'opens the detail page');
  assert.ok(!JSON.stringify(manifest).includes('<svg data-theme'), 'the manifest holds data, not markup');
  assert.ok(manifest.elements.some(e => e.key === 'side-menu') && manifest.elements.some(e => e.key === 'filter-sheet'), 'opened elements are exported too');
  assert.match(file(b, 'DEV-NOTES.md'), /\*\*Click actions\*\*[\s\S]*open `side-menu` as a drawer from the left/);
  assert.match(file(b, 'DEV-NOTES.md'), /route to `detail` - opens the detail page/);

  // the runtime (js) is valid and the typed twin knows the same thing
  assert.doesNotThrow(() => new vm.Script(file(b, 'js/app.js')));
  assert.match(file(b, 'js/app.js'), /data-ud-open/); assert.match(file(b, 'ts/app.ts'), /closeOverlay/); assert.match(file(b, 'ts/types.ts'), /interface ActionInfo/);
  assert.match(file(b, 'css/app.css'), /\.ud-from-left \.ud-panel/);
  c.close();
});

test('export: a link hotspot on the same element as a route action is not drawn twice, and deleted targets are skipped', () => {
  const c = fresh();
  const a = c.screen.create({ name: 'A' }, { nodes: [rect('btn', 0)] }), b2 = c.screen.create({ name: 'B' });
  const btn = c.screen.get(a.id).nodes[0].id;
  const wf = c.workflows.create({ name: 'Flow' });
  c.workflows.placeScreen(wf.id, { screenId: a.id, x: 0, y: 0 }); c.workflows.placeScreen(wf.id, { screenId: b2.id, x: 500, y: 0 });
  c.workflows.addLink(wf.id, { fromScreenId: a.id, toScreenId: b2.id, fromNodeId: btn, name: 'Open B' });
  const withLinkOnly = file(c.exporter.buildBundle({ screenIds: [a.id] }), 'screens/a.html');
  assert.equal((withLinkOnly.match(/class="ud-hotspot" href="b\.html"/g) || []).length, 1);
  c.screen.updateNode(btn, { onClick: { type: 'screen', targetId: b2.id } });
  const both = file(c.exporter.buildBundle({ screenIds: [a.id] }), 'screens/a.html');
  assert.equal((both.match(/class="ud-hotspot" href="b\.html"/g) || []).length, 1, 'one hotspot, not two');
  assert.match(both, /data-action="screen"/);

  const el = c.element.create({ name: 'Gone soon', width: 100, height: 100 });
  c.screen.updateNode(btn, { onClick: { type: 'popup', targetId: el.id } });
  c.element.remove(el.id);
  const after = c.exporter.buildBundle({ screenIds: [a.id] });
  assert.ok(!file(after, 'screens/a.html').includes('data-ud-open'), 'the element is gone: no dead hotspot');
  assert.deepEqual(JSON.parse(file(after, 'data/manifest.json')).screens[0].actions, []);
  c.close();
});
