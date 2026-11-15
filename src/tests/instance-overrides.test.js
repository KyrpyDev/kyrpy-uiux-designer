import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, renderDocument, indexLibrary } from '../domain/svg.js';
import { instanceMenu, nodeMenuOverride, nodeMenuAttr, hasNodeMenuOverride, menuConfig, NODE_MENU_ATTR } from '../domain/menu.js';
import { NODE_PRESS_SLIDE_ATTR } from '../domain/press-slide.js';

const theme = { key: 't', tokens: { sw: 2, bg: '#000' }, roles: {} };
const body = [{ id: 1, kind: 'shape', tag: 'circle', parentId: null, ord: 0, attrs: { cx: 24, cy: 24, r: 24 } }];
const btn = (id, meta) => ({ id, key: `b${id}`, width: 48, height: 48, meta, nodes: body });
const items = [
  { id: 11, name: 'home', label: 'Home', parentId: null, ord: 0, visible: true },
  { id: 12, name: 'cart', label: 'Cart', parentId: null, ord: 1, visible: true }
];
const place = (refId, attrs = {}) => ({ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: 48, height: 48, ...attrs } });
const render = (b, node, menu = null) => {
  const lib = indexLibrary({ buttons: [b] }, menu ? new Map([[b.id, menu]]) : new Map());
  return renderDocument({ owner: b, nodes: [node], ctx: createContext({ theme, lib }) });
};

test('per-instance menu override: parse, serialise, merge over the button menu without touching it', () => {
  assert.deepEqual(nodeMenuOverride({ attrs: {} }), { cfg: {}, items: {} });
  assert.deepEqual(nodeMenuOverride({ attrs: { [NODE_MENU_ATTR]: 'not json' } }), { cfg: {}, items: {} });
  assert.equal(nodeMenuAttr({}), null);
  const attr = nodeMenuAttr({ cfg: { kind: 'radial' }, items: { 12: { visible: false } } });
  const node = { attrs: { [NODE_MENU_ATTR]: attr } };
  assert.ok(hasNodeMenuOverride(node));
  const base = { cfg: menuConfig({ menu: { kind: 'popup', gap: 0.3 } }), items };
  const m = instanceMenu(base, node);
  assert.equal(m.cfg.kind, 'radial');
  assert.equal(m.cfg.gap, 0.3);                       // untouched keys follow the button
  assert.equal(m.items.find(i => i.id === 12).visible, false);
  assert.equal(base.cfg.kind, 'popup');              // the library menu is not mutated
  assert.equal(items[1].visible, true);
  assert.equal(instanceMenu(base, { attrs: {} }), base);
});

test('a placed menu button renders its own menu settings and hidden items; the settings never reach the markup', () => {
  const b = btn(9, { menu: { kind: 'popup' } });
  const plain = render(b, place(9), items);
  assert.match(plain, /data-item="cart"/);
  const own = render(b, place(9, { [NODE_MENU_ATTR]: nodeMenuAttr({ cfg: { rotateOnOpen: 45 }, items: { 12: { visible: false } } }) }), items);
  assert.doesNotMatch(own, /data-item="cart"/);
  assert.match(own, /data-item="home"/);
  assert.match(own, /--rot:45deg/);
  assert.doesNotMatch(own, /data-menu-config/);
});

test('a placed press & slide button uses its own settings when it has them', () => {
  const b = btn(7, { pressSlide: { on: true } });
  assert.match(render(b, place(7)), /data-press-slide="u:scroll-up;d:scroll-down;l:back;r:enter"/);
  const own = render(b, place(7, { [NODE_PRESS_SLIDE_ATTR]: JSON.stringify({ on: true, d: { on: false }, holdMs: 400 }) }));
  assert.match(own, /data-press-slide="u:scroll-up;l:back;r:enter"[^>]*data-ps-hold="400"/);
  assert.doesNotMatch(own, /data-ps-config/);
  // switched off on this placed button only
  assert.doesNotMatch(render(b, place(7, { [NODE_PRESS_SLIDE_ATTR]: JSON.stringify({ on: false }) })), /ud-ps/);
  // a button without press & slide can get it on one placed copy
  assert.match(render(btn(8, {}), place(8, { [NODE_PRESS_SLIDE_ATTR]: JSON.stringify({ on: true }) })), /class="ud-ps"/);
});
