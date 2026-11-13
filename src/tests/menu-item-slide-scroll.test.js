import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMenu, buildMenuTree, normalizeItemScroll, hasItemScroll, menuConfig } from '../domain/menu.js';

const ctx = { theme: { tokens: {} }, editor: false };
const rows = [{ id: 1, name: 'scan', ord: 0, targetElementId: 7 }, { id: 2, name: 'search', ord: 1 }];
const render = cfg => renderMenu({ button: { width: 100, height: 100 }, cfg: menuConfig({ menu: { kind: 'hub', ...cfg } }), tree: buildMenuTree(rows), ctx, iconKey: null });

test('normalizeItemScroll keeps only numeric item ids and sanitises the target', () => {
  assert.deepEqual(normalizeItemScroll({ 1: { on: '1', targetId: 'n-5"x' }, bad: { on: true }, 2: { on: false } }), { 1: { on: true, targetId: 'n-5x' }, 2: { on: false, targetId: null } });
  assert.equal(hasItemScroll({}), false);
});

test('per item slide-scroll: only the switched-on item scrolls, with its own container', () => {
  const svg = render({ itemScroll: { 2: { on: true, targetId: 'c9' } } });
  assert.match(svg, /data-item="search"[^>]*data-item-scroll="1" data-target-repeater="c9"/);
  assert.match(svg, /data-item="scan"[^>]*data-item-scroll="0"/);
  assert.doesNotMatch(svg, /data-target-repeater="7"/);
  assert.match(svg, /class="rm-hit"[^>]*data-hub-center-scroll="0"/);
});

import { fitNodesToScreen } from '../domain/geometry.js';
test('device preview: a card filling its repeater keeps the repeater margins on a wider screen', () => {
  const nodes = [
    { id: 1, kind: 'instance', tag: 'use', attrs: { x: 16, y: 96, width: 358, height: 648 } },
    { id: 2, parentId: 1, kind: 'instance', tag: 'use', attrs: { x: 28, y: 108, width: 334, height: 94 } }
  ];
  const p = new Map(fitNodesToScreen(nodes, { w: 390, h: 844 }, { w: 412, h: 915 }).map(r => [r.id, r.attrs]));
  const c = p.get(1), k = p.get(2);
  assert.ok(Math.abs((Number(k.x) - Number(c.x)) - 12) < 0.5);
  assert.ok(Math.abs((Number(c.x) + Number(c.width)) - (Number(k.x) + Number(k.width)) - 12) < 0.5);
});

test('static hub picture: the default centre item sits on the button, the others and the back arrow are hidden', () => {
  const svg = render({ hubCenterItemId: 2 });
  assert.match(svg, /data-item="search"[^>]*transform="translate\(50 50\)"(?! scale)/);
  assert.match(svg, /data-item="scan"[^>]*transform="translate\(50 50\) scale\(0\)" opacity="0"/);
  assert.match(svg, /class="rm-back"[^>]*visibility="hidden"/);
});
