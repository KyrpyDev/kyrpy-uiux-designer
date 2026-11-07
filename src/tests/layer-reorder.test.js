import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderLayer, stepLayer } from '../domain/node-ops.js';

// paint order back→front: a(0) b(1) g(2) [g's kids c(3) d(4)] e(5); the Layers panel lists front-most first
const nodes = () => [
  { id: 1, name: 'a', parentId: null, ord: 0 }, { id: 2, name: 'b', parentId: null, ord: 1 },
  { id: 3, name: 'g', parentId: null, ord: 2 }, { id: 4, name: 'c', parentId: 3, ord: 3 },
  { id: 5, name: 'd', parentId: 3, ord: 4 }, { id: 6, name: 'e', parentId: null, ord: 5 }
];
const names = list => list.map(n => n.name).join('');
const panel = list => [...list].sort((x, y) => y.ord - x.ord).map(n => n.name).join('');

test('reorderLayer: "above" puts the dragged layer directly in front of the target', () => {
  const out = reorderLayer(nodes(), 1, 6, 'above');
  assert.equal(names(out), 'bgcdea');
  assert.deepEqual(out.map(n => n.ord), [0, 1, 2, 3, 4, 5]);
  assert.equal(panel(out)[0], 'a');                       // top of the panel = front-most
});

test('reorderLayer: "below" puts it directly behind the target', () => {
  assert.equal(names(reorderLayer(nodes(), 6, 2, 'below')), 'aebgcd');
  assert.equal(names(reorderLayer(nodes(), 6, 1, 'below')), 'eabgcd');
});

test('reorderLayer: only siblings reorder; no-ops and unknown ids return null', () => {
  assert.equal(reorderLayer(nodes(), 4, 6, 'above'), null);   // child of g onto a top-level node
  assert.equal(reorderLayer(nodes(), 4, 4, 'above'), null);
  assert.equal(reorderLayer(nodes(), 2, 1, 'above'), null);   // already directly in front of a
  assert.equal(reorderLayer(nodes(), 9, 1, 'above'), null);
  assert.equal(names(reorderLayer(nodes(), 5, 4, 'below')), 'abgdce');
});

test('reorderLayer does not mutate its input', () => {
  const src = nodes();
  reorderLayer(src, 1, 6, 'above');
  assert.deepEqual(src, nodes());
});

test('stepLayer: moves one step among siblings (1 = toward the front), skipping other levels', () => {
  const up = stepLayer(nodes(), 3, 1);
  assert.equal(names(up), 'abcdeg');
  assert.equal(panel(up.filter(n => n.parentId == null)), 'geba');
  assert.equal(panel(stepLayer(nodes(), 3, -1).filter(n => n.parentId == null)), 'ebga');
  assert.equal(stepLayer(nodes(), 6, 1), null);               // already front-most
  assert.equal(stepLayer(nodes(), 1, -1), null);              // already back-most
  assert.equal(panel(stepLayer(nodes(), 4, 1).filter(n => n.parentId === 3)), 'cd');
});
