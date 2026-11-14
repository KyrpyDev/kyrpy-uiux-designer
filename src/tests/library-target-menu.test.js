import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMenu, buildMenuTree, menuConfig } from '../domain/menu.js';

const ctx = { theme: { tokens: {} }, editor: false };
const rows = [{ id: 1, name: 'scan', ord: 0 }];
const render = menu => renderMenu({ button: { width: 100, height: 100 }, cfg: menuConfig({ menu: { kind: 'show-element', ...menu } }), tree: buildMenuTree(rows), ctx, iconKey: null });

test('show-element menu: a screen target is rendered on the centre hit area (routes to the screen)', () => {
  const svg = render({ targetScreenId: 12 });
  assert.match(svg, /data-rm="center"[^>]*data-show-screen-id="12"/);
  assert.doesNotMatch(svg, /data-show-element-id/);
});

test('show-element menu: an element target still wins over a screen target', () => {
  const svg = render({ targetElementId: 7, targetScreenId: 12 });
  assert.match(svg, /data-show-element-id="7"/);
  assert.doesNotMatch(svg, /data-show-screen-id/);
});
