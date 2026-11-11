import test from 'node:test';
import assert from 'node:assert/strict';
import { fitNodesToScreen, nodeBBox } from '../domain/geometry.js';

const nodes = [
  { id: 1, parentId: null, tag: 'rect', attrs: { x: 0, y: 0, width: 390, height: 844 } },                 // background
  { id: 2, parentId: null, tag: 'rect', attrs: { x: 0, y: 0, width: 390, height: 60 } },                  // top bar
  { id: 3, parentId: null, tag: 'rect', attrs: { x: 145, y: 372, width: 100, height: 100 } },             // centred card
  { id: 4, parentId: null, tag: 'g', attrs: { transform: 'translate(20 700)' } },
  { id: 5, parentId: 4, tag: 'rect', attrs: { x: 0, y: 0, width: 50, height: 50 } }                        // inside the group
];
const apply = (to) => {
  const patches = fitNodesToScreen(nodes, { w: 390, h: 844 }, to);
  const next = nodes.map(n => ({ ...n, attrs: patches.find(p => p.id === n.id)?.attrs ?? n.attrs }));
  return { patches, box: id => nodeBBox(next.find(n => n.id === id), next) };
};

test('device change: full-screen and full-width items keep spanning the new screen', () => {
  const { box } = apply({ w: 1280, h: 800 });
  assert.deepEqual(box(1), { x: 0, y: 0, w: 1280, h: 800 });
  const bar = box(2);
  assert.equal(bar.w, 1280);
  assert.ok(Math.abs(bar.h - 60 * (800 / 844)) < 0.01);
});

test('device change: other items keep their aspect ratio and relative place, inside the screen', () => {
  const { box } = apply({ w: 1280, h: 800 });
  const c = box(3);
  assert.ok(Math.abs(c.w - c.h) < 0.01, 'square stays square');
  assert.ok(Math.abs(c.x + c.w / 2 - 640) < 0.01, 'stays horizontally centred');
  assert.ok(Math.abs(c.y + c.h / 2 - 400) < 0.01, 'stays vertically centred');
  for (const id of [1, 2, 3, 4]) { const b = box(id); assert.ok(b.x >= -0.01 && b.y >= -0.01 && b.x + b.w <= 1280.01 && b.y + b.h <= 800.01, `node ${id} inside`); }
});

test('device change: children of a group follow the group transform (no patch of their own)', () => {
  const { patches, box } = apply({ w: 780, h: 1688 });
  assert.equal(patches.some(p => p.id === 5), false);
  const g = box(4);
  assert.ok(Math.abs(g.w - 100) < 0.01 && Math.abs(g.h - 100) < 0.01);
});
