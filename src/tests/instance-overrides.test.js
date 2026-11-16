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
  assert.deepEqual(nodeMenuOverride({ attrs: {} }), { cfg: {}, items: {}, added: [] });
  assert.deepEqual(nodeMenuOverride({ attrs: { [NODE_MENU_ATTR]: 'not json' } }), { cfg: {}, items: {}, added: [] });
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

test('a placed copy shows its own icon and label; the library nodes and the markup stay clean', async () => {
  const { INSTANCE_ICON_ATTR, INSTANCE_LABEL_ATTR, applyInstanceContent } = await import('../domain/instance-content.js');
  const nodes = [
    { id: 1, kind: 'shape', tag: 'rect', parentId: null, ord: 0, attrs: { width: 48, height: 48 } },
    { id: 2, kind: 'instance', tag: 'use', refType: 'icon', refId: 5, parentId: null, ord: 1, attrs: { x: 12, y: 4, width: 24, height: 24 } },
    { id: 3, kind: 'shape', tag: 'text', text: 'Save', parentId: null, ord: 2, attrs: { x: 24, y: 40 } }
  ];
  const b = { id: 4, key: 'b4', width: 48, height: 48, meta: {}, nodes };
  const lib = indexLibrary({ buttons: [b], icons: [{ id: 5, key: 'ic-a', width: 24, height: 24, nodes: [] }, { id: 6, key: 'ic-b', width: 24, height: 24, nodes: [] }] });
  const draw = attrs => renderDocument({ owner: b, nodes: [place(4, attrs)], ctx: createContext({ theme, lib }) });
  const plain = draw();
  assert.match(plain, /href="#i-ic-a"/); assert.match(plain, />Save</);
  const own = draw({ [INSTANCE_ICON_ATTR]: '6', [INSTANCE_LABEL_ATTR]: 'Kaydet' });
  assert.match(own, /href="#i-ic-b"/); assert.doesNotMatch(own, /href="#i-ic-a"/);
  assert.match(own, />Kaydet</); assert.doesNotMatch(own, />Save</);
  assert.doesNotMatch(own, /data-inst-/);
  assert.equal(nodes[1].refId, 5); assert.equal(nodes[2].text, 'Save');   // the library item is untouched
  assert.equal(applyInstanceContent(nodes, { attrs: {} }), nodes);
});

test('a placed button can take its own button style; the library button keeps its shape', async () => {
  const { INSTANCE_STYLE_ATTR, applyInstanceContent, buttonStyleOf } = await import('../domain/instance-content.js');
  const nodes = [{ id: 1, kind: 'shape', tag: 'rect', role: 'button', parentId: null, ord: 0, attrs: { x: 0, y: 0, width: 48, height: 48, rx: 24 } }];
  const b = { id: 5, key: 'b5', width: 48, height: 48, meta: {}, nodes };
  assert.equal(buttonStyleOf(b), 'circle');
  const lib = indexLibrary({ buttons: [b] });
  const draw = attrs => renderDocument({ owner: b, nodes: [place(5, attrs)], ctx: createContext({ theme, lib }) });
  assert.match(draw(), /rx="24"/);
  const own = draw({ [INSTANCE_STYLE_ATTR]: 'square' });
  assert.match(own, /rx="4.8"/); assert.doesNotMatch(own, /data-inst-style/);
  assert.equal(nodes[0].attrs.rx, 24);                                         // the library item is untouched
  assert.equal(applyInstanceContent(nodes, { refType: 'button', attrs: { [INSTANCE_STYLE_ATTR]: 'nope' } }, b), nodes);
});

test('per-instance menu override: add, edit, reorder and delete menu items without touching the library button', () => {
  const b = btn(10, { menu: { kind: 'popup', itemScroll: { 11: { on: true, targetId: '5', mode: 'focus' } } } });
  const base = { cfg: menuConfig(b.meta), items };
  const added = [
    { id: -1, parentId: null, ord: 2, name: 'settings', label: 'Settings', visible: true },
    { id: -2, parentId: -1, ord: 0, name: 'profile', label: 'Profile', visible: true }
  ];
  const ov = nodeMenuAttr({
    cfg: { itemScroll: { '-1': { on: true, targetId: '6', mode: 'scroll' } } },
    items: { 11: { label: 'Start', ord: 1 }, 12: { deleted: true } },
    added
  });
  const node = place(10, { [NODE_MENU_ATTR]: ov });
  const m = instanceMenu(base, node);
  assert.equal(m.items.find(i => i.id === 11).label, 'Start');
  assert.equal(m.items.find(i => i.id === 12), undefined);                     // deleted on this instance
  assert.equal(m.items.find(i => i.id === -1).label, 'Settings');
  assert.equal(m.items.find(i => i.id === -2).parentId, -1);
  assert.deepEqual(m.cfg.itemScroll['11'], { on: true, targetId: '5', mode: 'focus' });
  assert.deepEqual(m.cfg.itemScroll['-1'], { on: true, targetId: '6', mode: 'scroll' });
  // library items stay untouched
  assert.equal(items[0].label, 'Home');
  assert.equal(items.length, 2);
  // rendering a button with 0 library menu items still renders its instance-added menu items
  const emptyBtn = btn(11, { menu: { kind: 'popup' } });
  const rendered = render(emptyBtn, place(11, { [NODE_MENU_ATTR]: nodeMenuAttr({ added: [{ id: -1, parentId: null, ord: 0, name: 'solo', label: 'Solo', visible: true }] }) }), []);
  assert.match(rendered, /data-item="solo"/);
  assert.doesNotMatch(rendered, /data-menu-config/);
});

test('per-instance menu override: deleting a parent item drops its descendants on the instance only', () => {
  const nested = [
    { id: 21, name: 'parent', label: 'Parent', parentId: null, ord: 0, visible: true },
    { id: 22, name: 'child', label: 'Child', parentId: 21, ord: 0, visible: true }
  ];
  const node = place(12, { [NODE_MENU_ATTR]: nodeMenuAttr({ items: { 21: { deleted: true } } }) });
  const m = instanceMenu({ cfg: menuConfig({}), items: nested }, node);
  assert.equal(m.items.length, 0);
  assert.equal(nested.length, 2);
});
