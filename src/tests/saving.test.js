import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { designFingerprint, workflowFingerprint, restoreBody, workflowRestoreBody } from '../domain/doc-fingerprint.js';
import { ConflictError } from '../domain/errors.js';

const fresh = () => buildContainer({ dbFile: ':memory:' });
const rect = (name, x) => ({ tag: 'rect', name, attrs: { x, y: 0, width: 10, height: 10 } });

test('fingerprint: any edit changes it, undoing the edit brings it back, ids and raw z numbers do not matter', () => {
  const c = fresh();
  const el = c.element.create({ name: 'Card', width: 100, height: 50 }, { nodes: [rect('a', 0), rect('b', 20)] });
  const saved = c.element.get(el.id), fp = designFingerprint(saved);
  assert.equal(designFingerprint(c.element.get(el.id)), fp, 'stable');
  c.element.updateNode(saved.nodes[0].id, { attrs: { x: 5, y: 0, width: 10, height: 10 } });
  assert.notEqual(designFingerprint(c.element.get(el.id)), fp, 'moved a node');
  c.element.updateNode(saved.nodes[0].id, { attrs: saved.nodes[0].attrs });
  assert.equal(designFingerprint(c.element.get(el.id)), fp, 'moved back = unchanged');
  c.element.update(el.id, { descriptionDev: 'for the dev team' });
  assert.notEqual(designFingerprint(c.element.get(el.id)), fp, 'description edited');
  // replacing the node list renumbers the z order but changes nothing visible
  const again = c.element.get(el.id);
  c.element.update(el.id, { descriptionDev: '' });
  c.element.replaceNodes(el.id, c.element.get(el.id).nodes);
  assert.equal(designFingerprint(c.element.get(el.id)), fp);
  void again; c.close();
});

test('restore: nodes, animations, size and record come back exactly as last saved', () => {
  const c = fresh();
  const el = c.element.create({ name: 'Box', width: 100, height: 50, descriptionDev: 'v1' }, { nodes: [rect('a', 0), rect('b', 20)] });
  const nodeA = c.element.get(el.id).nodes[0];
  c.element.addAnimation(nodeA.id, { type: 'pulse', durationMs: 900 });
  const baseline = c.element.get(el.id), body = restoreBody(baseline), fp = designFingerprint(baseline);

  // edit everything: record, size (scaling the nodes), nodes, animations
  c.element.update(el.id, { name: 'Renamed', descriptionDev: 'v2', width: 300, height: 150 });
  c.element.addNode(el.id, rect('c', 50));
  c.element.removeNode(baseline.nodes[1].id);
  c.element.addAnimation(nodeA.id, { type: 'rotate', durationMs: 500 });
  const edited = c.element.get(el.id);
  assert.notEqual(designFingerprint(edited), fp);

  const back = c.element.restore(el.id, body);
  assert.equal(designFingerprint(back), fp, 'identical to the saved version');
  assert.equal(back.name, 'Box'); assert.equal(back.width, 100); assert.equal(back.descriptionDev, 'v1');
  assert.equal(back.nodes.length, 2); assert.equal(back.animations.length, 1);
  assert.deepEqual(back.nodes.map(n => n.id).sort(), baseline.nodes.map(n => n.id).sort(), 'node ids are kept');
  assert.equal(back.nodes.find(n => n.name === 'a').attrs.width, 10, 'sizes were not re-scaled by the restore');
  c.close();
});

test('restore keeps a button menu: items edited, added and deleted since the save are undone', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Dot' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } }] });
  const b = c.button.create({ name: 'Menu', width: 64, height: 64 });
  const share = c.menus.addItem(b.id, { label: 'Share', iconId: ic.id });
  c.menus.addItem(b.id, { label: 'Mail', parentId: share.id, iconId: ic.id });
  const baseline = c.button.get(b.id), body = restoreBody(baseline), fp = designFingerprint(baseline);
  c.menus.updateItem(share.id, { label: 'Send' });
  c.menus.addItem(b.id, { label: 'Extra' });
  c.menus.removeItem(c.button.get(b.id).menuItems.find(m => m.name === 'mail').id);
  c.menus.setConfig(b.id, { kind: 'rotating' });
  assert.notEqual(designFingerprint(c.button.get(b.id)), fp);
  const back = c.button.restore(b.id, body);
  assert.equal(designFingerprint(back), fp);
  assert.deepEqual(back.menuItems.map(m => [m.name, m.label]), [['share', 'Share'], ['mail', 'Mail']]);
  assert.equal(back.meta.menu, undefined, 'menu settings back too');
  c.close();
});

test('restore refuses a key that another design took, and a deleted icon in a menu becomes "no icon"', () => {
  const c = fresh();
  const a = c.icon.create({ name: 'A' }), b = c.icon.create({ name: 'B' });
  const body = restoreBody(c.icon.get(a.id));
  c.icon.update(a.id, { key: 'renamed-a' });
  c.icon.create({ name: 'Taker', key: 'a' });
  assert.throws(() => c.icon.restore(a.id, body), ConflictError);
  void b;
  const ic = c.icon.create({ name: 'Gone' });
  const btn = c.button.create({ name: 'Btn', width: 64, height: 64 });
  c.menus.addItem(btn.id, { label: 'One', iconId: ic.id });
  const snap = restoreBody(c.button.get(btn.id));
  c.icon.remove(ic.id);
  assert.equal(c.button.restore(btn.id, snap).menuItems[0].iconId, null);
  c.close();
});

test('Save as semantics: a copy keeps the edits while the original goes back to its saved version', () => {
  const c = fresh();
  const s = c.screen.create({ name: 'Home' }, { nodes: [rect('a', 0)] });
  const body = restoreBody(c.screen.get(s.id)), fp = designFingerprint(c.screen.get(s.id));
  c.screen.addNode(s.id, rect('edit', 40));
  const copy = c.screen.clone(s.id, { name: 'Home v2' });
  c.screen.restore(s.id, body);
  assert.equal(designFingerprint(c.screen.get(s.id)), fp, 'original is as last saved');
  assert.equal(copy.nodes.length, 2, 'the copy has the edit');
  assert.equal(copy.key, 'home-v2');
  c.close();
});

test('workflow: fingerprint and restore of positions, collapsed state, links and name', () => {
  const c = fresh();
  const a = c.screen.create({ name: 'A' }, { nodes: [{ tag: 'text', kind: 'text', text: 'Go', attrs: { x: 1, y: 1 } }] }), b = c.screen.create({ name: 'B' });
  const wf = c.workflows.create({ name: 'Flow' });
  c.workflows.placeScreen(wf.id, { screenId: a.id, x: 0, y: 0 }); c.workflows.placeScreen(wf.id, { screenId: b.id, x: 500, y: 0 });
  const link = c.workflows.addLink(wf.id, { fromScreenId: a.id, toScreenId: b.id, fromNodeId: c.screen.get(a.id).nodes[0].id, name: 'Open B' });
  const baseline = c.workflows.get(wf.id), body = workflowRestoreBody(baseline), fp = workflowFingerprint(baseline);
  c.workflows.placeScreen(wf.id, { screenId: b.id, x: 900, y: 40, collapsed: true });
  c.workflows.updateLink(link.id, { name: 'Changed' });
  c.workflows.addLink(wf.id, { fromScreenId: b.id, toScreenId: a.id, name: 'Back' });
  c.workflows.update(wf.id, { name: 'Renamed', descriptionDev: 'x' });
  assert.notEqual(workflowFingerprint(c.workflows.get(wf.id)), fp);
  const back = c.workflows.restore(wf.id, body);
  assert.equal(workflowFingerprint(back), fp, 'identical to the saved version');
  assert.equal(back.name, 'Flow'); assert.equal(back.links.length, 1); assert.equal(back.links[0].name, 'Open B');
  assert.equal(back.links[0].fromNodeId, baseline.links[0].fromNodeId, 'the trigger element is kept');
  const nodeB = back.nodes.find(n => n.screenId === b.id);
  assert.deepEqual([nodeB.x, nodeB.y, nodeB.collapsed], [500, 0, false]);
  c.close();
});

test('restore refuses an empty or malformed body instead of wiping the design', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Keep' }, { nodes: [rect('a', 0)] });
  assert.throws(() => c.icon.restore(ic.id, {}), /saved version/);
  assert.throws(() => c.icon.restore(ic.id, undefined), /saved version/);
  assert.equal(c.icon.get(ic.id).nodes.length, 1);
  const wf = c.workflows.create({ name: 'W' });
  assert.throws(() => c.workflows.restore(wf.id, {}), /saved version/);
  c.close();
});
