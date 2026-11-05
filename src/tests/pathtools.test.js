import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { parsePath, serializePath, shapeToCommands, convertSegment } from '../domain/path-data.js';
import { vertexKind, makeSmooth, makeCorner, mirrorHandle, cutAt, reversePath, transformCommands, simplifyPath, roundCorner, joinPaths, combinePaths, breakApart, penToCommands, subpathRange } from '../domain/path-tools.js';
import { flatten, booleanOp, regionArea, evenOddInside, rectRings, pathfind, cropNode, worldCommands } from '../domain/path-ops.js';
import { groupNodes, ungroupNodes, alignPatches, distributePatches, flipPatches, bakePatch } from '../domain/node-ops.js';
import { nodeBBox } from '../domain/geometry.js';
import { renderTree, createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';

const rect = (x, y, w, h) => flatten(shapeToCommands('rect', { x, y, width: w, height: h }));
const sample = (rings, size = 40, n = 80) => { let c = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (evenOddInside({ x: (i + 0.5) * size / n, y: (j + 0.5) * size / n }, rings)) c++; return c * (size / n) ** 2; };
const near = (a, b, t = 0.02) => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);
const node = (id, tag, attrs, extra = {}) => ({ id, ord: id, parentId: null, kind: tag === 'g' ? 'group' : tag === 'text' ? 'text' : 'shape', tag, name: `n${id}`, role: null, rotation: 0, visible: true, locked: false, text: '', attrs, ...extra });

/* ---------------- vertex tools ---------------- */
test('vertex kinds, smooth and corner', () => {
  const sq = parsePath('M0 0L10 0L10 10L0 10Z');
  assert.equal(vertexKind(sq, 1), 'corner');
  const sm = makeSmooth(sq, 1);
  assert.equal(vertexKind(sm, 1), 'smooth');
  assert.equal(vertexKind(makeCorner(sm, 1), 1), 'corner');
  assert.equal(makeSmooth(parsePath('M0 0'), 0), null);
  // the last vertex of a closed path (joined to the start by the implicit closing line) can be smoothed too
  const tri = parsePath('M0 0L10 0L5 8Z');
  const smoothLast = makeSmooth(tri, 2);
  assert.equal(vertexKind(smoothLast, 2), 'smooth');
  assert.equal(smoothLast.at(-1).t, 'Z');
});

test('mirrored handles keep a smooth vertex smooth', () => {
  const sm = makeSmooth(parsePath('M0 0L10 0L10 10'), 1);
  const dragged = sm.map(c => ({ ...c })); dragged[1].x2 = 8; dragged[1].y2 = -3;          // moved the incoming handle
  const fixed = mirrorHandle(dragged, 1, 'c2');
  assert.equal(vertexKind(fixed, 1), 'smooth');
  const symmetric = mirrorHandle(dragged, 1, 'c2', 'symmetric');
  const a = { x: 10, y: 0 };
  near(Math.hypot(symmetric[2].x1 - a.x, symmetric[2].y1 - a.y), Math.hypot(8 - a.x, -3 - a.y));
});

test('cut, reverse, join, combine, break apart', () => {
  const sq = parsePath('M0 0L10 0L10 10L0 10Z');
  assert.equal(serializePath(cutAt(sq, 2)), 'M10 10L0 10L0 0L10 0L10 10');
  const open = parsePath('M0 0L5 0L9 4');
  const split = cutAt(open, 1);
  assert.equal(breakApart(split).length, 2);
  assert.equal(cutAt(open, 0), null);
  assert.equal(serializePath(reversePath(open)), 'M9 4L5 0L0 0');
  assert.equal(serializePath(reversePath(reversePath(sq))), serializePath(sq));
  const joined = joinPaths(parsePath('M0 0L5 0'), parsePath('M9 5L5 1'));      // closest ends: (5,0) and (5,1)
  assert.deepEqual(joined.map(c => c.t), ['M', 'L', 'L', 'L']);
  assert.equal(breakApart(combinePaths([sq, open])).length, 2);
  assert.deepEqual(subpathRange(combinePaths([sq, open]), 6), [5, 7]);
});

test('transforms, simplify and round corners', () => {
  const p = parsePath('M0 0L4 0L4 2');
  assert.equal(serializePath(transformCommands(p, { mirror: 'h', cx: 2, cy: 0 })), 'M4 0L0 0L0 2');
  const rot = transformCommands(p, { rotate: 90, cx: 0, cy: 0 });
  near(rot[1].x, 0); near(rot[1].y, 4);
  assert.equal(simplifyPath(parsePath('M0 0L1 0.001L2 0L3 0L3 3'), 0.05).length, 3);
  const r = roundCorner(parsePath('M0 0L10 0L10 10'), 1, 2);
  assert.equal(r[2].t, 'Q'); near(r[1].x, 8); near(r[2].y, 2);
  assert.equal(roundCorner(parsePath('M0 0L10 0'), 1, 2), null);
});

test('pen tool builds lines and curves, open or closed', () => {
  const pts = [{ x: 0, y: 0, out: { x: 3, y: 0 } }, { x: 10, y: 10, in: { x: 10, y: 6 } }, { x: 0, y: 10 }];
  assert.equal(serializePath(penToCommands(pts, false)), 'M0 0C3 0 10 6 10 10L0 10');
  assert.equal(penToCommands(pts, true).at(-1).t, 'Z');
  assert.equal(serializePath(penToCommands([{ x: 0, y: 0 }, { x: 5, y: 5 }])), 'M0 0L5 5');
});

/* ---------------- pathfinder ---------------- */
test('boolean operations: areas of overlapping squares', () => {
  const A = rect(0, 0, 10, 10), B = rect(5, 5, 10, 10);
  near(regionArea(booleanOp('union', A, B)), 175);
  near(regionArea(booleanOp('subtract', A, B)), 75);
  near(regionArea(booleanOp('intersect', A, B)), 25);
  near(sample(booleanOp('exclude', A, B)), 150, 0.05);
});

test('boolean operations: holes, shared edges, curves', () => {
  const sq = rect(0, 0, 20, 20), circle = flatten(shapeToCommands('circle', { cx: 10, cy: 10, r: 5 }), 0.2);
  const hole = booleanOp('subtract', sq, circle);
  assert.equal(hole.length, 2); near(regionArea(hole), 400 - Math.PI * 25, 0.01);                     // cut-out leaves a hole
  near(regionArea(booleanOp('union', rect(0, 0, 10, 10), rect(10, 0, 10, 10))), 200);                  // touching squares merge
  near(regionArea(booleanOp('subtract', rect(0, 0, 10, 10), rect(0, 0, 5, 10))), 50);                 // shared edge
  const c2 = flatten(shapeToCommands('circle', { cx: 10, cy: 5, r: 4 }), 0.1);
  near(regionArea(booleanOp('intersect', rect(0, 0, 10, 10), c2)), Math.PI * 8, 0.02);                // curved crossing
  assert.deepEqual(booleanOp('intersect', rect(0, 0, 5, 5), rect(20, 20, 5, 5)), []);                 // disjoint
});

test('pathfind on nodes: cut out the front shape, crop to a rectangle', () => {
  const back = node(1, 'rect', { x: 0, y: 0, width: 20, height: 20, fill: 'red' }), front = node(2, 'circle', { cx: 10, cy: 10, r: 5 });
  const all = [back, front];
  const cut = pathfind('subtract', all, all);
  near(regionArea(cut.rings), 400 - Math.PI * 25, 0.02);
  assert.match(cut.d, /^M/);
  near(regionArea(pathfind('union', all, all).rings), 400, 0.01);
  const crop = cropNode(back, all, { x: 5, y: 5, w: 100, h: 100 });
  near(regionArea(crop.rings), 225);
  assert.equal(cropNode(back, all, { x: 50, y: 50, w: 5, h: 5 }), null);
  assert.throws(() => pathfind('union', [back, node(3, 'text', { x: 0, y: 0 })], all), /only paths and basic shapes/);
  // transforms and rotation are honoured
  const moved = node(4, 'path', { d: 'M0 0L10 0L10 10L0 10Z', transform: 'translate(5 5) scale(2 2)' });
  const w = worldCommands(moved, [moved]);
  assert.deepEqual([w[2].x, w[2].y], [25, 25]);
  const rotated = node(5, 'rect', { x: 0, y: 0, width: 10, height: 10 }, { rotation: 90 });
  const wr = worldCommands(rotated, [rotated]);
  near(wr[1].x, 10); near(wr[1].y, 10);
});

/* ---------------- grouping, align, flip ---------------- */
test('group and ungroup keep structure, order and positions', () => {
  const a = node(1, 'rect', { x: 0, y: 0, width: 10, height: 10 }), b = node(2, 'rect', { x: 20, y: 0, width: 10, height: 10 }), c = node(3, 'rect', { x: 40, y: 0, width: 10, height: 10 });
  const { nodes: grouped } = groupNodes([a, b, c], [1, 3]);
  const g = grouped.find(n => n.tag === 'g');
  assert.deepEqual(grouped.map(n => n.id), [2, -1, 1, 3]);
  assert.equal(grouped.find(n => n.id === 1).parentId, -1);
  assert.throws(() => groupNodes([a, { ...b, parentId: 99 }], [1, 2]), /same level/);
  // a moved/scaled group is dissolved into its children
  const moved = grouped.map(n => (n.id === -1 ? { ...n, attrs: { transform: 'translate(10 5) scale(2 2)' } } : n)).map(n => ({ ...n, ord: n.ord }));
  const un = ungroupNodes(moved.map((n, i) => ({ ...n, ord: i })), -1);
  const a2 = un.nodes.find(n => n.id === 1).attrs;
  assert.deepEqual([a2.x, a2.y, a2.width, a2.height], [10, 5, 20, 20]);
  assert.equal(un.nodes.some(n => n.tag === 'g'), false);
  assert.equal(un.nodes.find(n => n.id === 3).parentId, null);
  void g;
});

test('align, distribute and flip', () => {
  const a = node(1, 'rect', { x: 0, y: 0, width: 10, height: 10 }), b = node(2, 'rect', { x: 30, y: 8, width: 20, height: 4 }), c = node(3, 'rect', { x: 100, y: 20, width: 10, height: 10 });
  const all = [a, b, c];
  const left = alignPatches(all, [1, 2, 3], 'left');
  assert.deepEqual(left.map(p => p.attrs.x), [0, 0, 0]);
  const mid = alignPatches(all, [1, 2], 'vmiddle');
  near(nodeBBox({ ...b, attrs: mid[1].attrs }).y + 2, nodeBBox({ ...a, attrs: mid[0].attrs }).y + 5);
  assert.equal(alignPatches([a], [1], 'right', { x: 0, y: 0, w: 100, h: 50 })[0].attrs.x, 90);
  const dist = distributePatches(all, [1, 2, 3], 'h');
  near(dist.find(p => p.id === 2).attrs.x, 45);                                                         // gaps are equal: (110 - 40) / 2 = 35
  const p = node(4, 'path', { d: 'M0 0L10 0L10 4' });
  const flipped = flipPatches([p], [4], 'h')[0];
  assert.equal(flipped.attrs.d, 'M10 0L0 0L0 4');
  const baked = bakePatch(node(5, 'path', { d: 'M0 0L10 0', transform: 'translate(2 3)' }), []);
  assert.equal(baked.attrs.d, 'M2 3L12 3'); assert.equal(baked.attrs.transform, undefined);
});

/* ---------------- persistence ---------------- */
test('grouping and pathfinder results persist through the existing node API and render', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const p = c.path.create({ name: 'Work' }, { nodes: [{ tag: 'rect', name: 'a', attrs: { x: 0, y: 0, width: 10, height: 10 } }, { tag: 'rect', name: 'b', attrs: { x: 12, y: 0, width: 10, height: 10 } }] });
  const nodes = c.path.get(p.id).nodes;
  const { nodes: grouped } = groupNodes(nodes, nodes.map(n => n.id), 'pair');
  const saved = c.path.replaceNodes(p.id, grouped);
  const g = saved.nodes.find(n => n.tag === 'g');
  assert.ok(g.id > 0 && saved.nodes.filter(n => n.parentId === g.id).length === 2, 'children were re-parented to the new group');
  const svg = renderTree(saved.nodes, createContext({ theme: BUILTIN_THEMES[0] }));
  assert.match(svg, /<g[^>]*><rect[^>]*\/><rect/);
  const un = ungroupNodes(saved.nodes, g.id);
  const back = c.path.replaceNodes(p.id, un.nodes);
  assert.equal(back.nodes.some(n => n.tag === 'g'), false);
  assert.equal(back.nodes.filter(n => n.parentId == null).length, 2);
  // a pathfinder result replaces its sources
  const result = pathfind('union', back.nodes, back.nodes);
  const after = c.path.replaceNodes(p.id, [{ id: -1, tag: 'path', kind: 'shape', name: 'union', attrs: { d: result.d, 'fill-rule': 'evenodd' } }]);
  assert.equal(after.nodes.length, 1); assert.match(after.nodes[0].attrs.d, /^M/);
  c.close();
});
