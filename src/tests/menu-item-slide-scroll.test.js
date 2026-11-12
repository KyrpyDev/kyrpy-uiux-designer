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
