import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRepeaterItems, repeaterConfig, repeaterMarkup, REPEATER_ATTR } from '../domain/repeater.js';
import { renderTree, createContext } from '../domain/svg.js';

const used = a => new Set(a);

test('assignment: every sub-item appears at least once, the total is the count, the pick is seeded', () => {
  for (const [m, n] of [[3, 3], [3, 10], [5, 7], [4, 50]]) {
    const a = assignRepeaterItems(m, n, 'seed-x');
    assert.equal(a.length, n);
    assert.equal(used(a).size, m, `all ${m} sub-items must appear in ${n} copies`);
  }
  assert.deepEqual(assignRepeaterItems(4, 12, 'same'), assignRepeaterItems(4, 12, 'same'));
  assert.notDeepEqual(assignRepeaterItems(4, 12, 'one'), assignRepeaterItems(4, 12, 'two'));
});

test('render: a count below the number of sub-items is raised to it, so every sub-item shows', () => {
  const tpl = (id, ord, label) => ({ id, parentId: 1, ord, kind: 'shape', tag: 'rect', name: label, attrs: { x: 0, y: 0, width: 40, height: 20, fill: '#' + (id * 111).toString(16).padStart(6, '0').slice(0, 6) }, visible: true });
  const nodes = [
    { id: 1, parentId: null, ord: 0, kind: 'shape', tag: 'g', role: 'repeater-container', name: 'rep', visible: true,
      attrs: { x: 0, y: 0, width: 300, height: 400, 'data-container': 'repeater', [REPEATER_ATTR.layout]: 'vertical', [REPEATER_ATTR.itemCount]: 2, [REPEATER_ATTR.multi]: 'true', [REPEATER_ATTR.random]: 'false' } },
    tpl(2, 0, 'a'), tpl(3, 1, 'b'), tpl(4, 2, 'c'), tpl(5, 3, 'd')
  ];
  const svg = renderTree(nodes, createContext({ theme: { tokens: {} }, repeaterMode: 'static' }));
  const copies = (svg.match(/data-rpt-index="/g) || []).length;
  assert.ok(copies >= 4, `expected at least 4 copies for 4 sub-items, got ${copies}`);
  const fills = new Set((svg.match(/fill="#[0-9a-f]{6}"/g) || []));
  assert.ok(fills.size >= 4, 'each of the 4 sub-items is drawn at least once');
});

test('config: seed and random options', () => {
  assert.equal(repeaterConfig({ attrs: {} }).random, true);
  assert.equal(repeaterConfig({ attrs: { [REPEATER_ATTR.random]: 'false' } }).random, false);
  assert.equal(repeaterConfig({ attrs: { [REPEATER_ATTR.seed]: '42' } }).seed, '42');
});
