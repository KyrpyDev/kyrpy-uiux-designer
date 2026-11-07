/**
 * Hub menu (3-button scrolling bar), hover-toolbar menu tools, and the "edited items: red edge, listed first" rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { SAMPLE_MENUS } from '../infrastructure/import/sample-menus.js';
import { BUTTON_ELEMENTS } from '../infrastructure/import/elements-catalog.js';
import { MENU_KINDS, scopeFirst, visClass, isEdited } from '../domain/entities.js';
import { renderMenu, buildMenuTree, menuExtent, hubGeometry, MENU_CSS } from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { bindMenus } from '../domain/menu-runtime.js';

const rowsOf = items => { const out = []; let id = 0; const walk = (list, parentId) => list.forEach((it, i) => { const row = { id: ++id, parentId, ord: i + 1, name: it.name, label: it.label, iconId: null }; out.push(row); if (it.children) walk(it.children, row.id); }); walk(items, null); return out; };
const HUB = SAMPLE_MENUS.find(m => m.key === 'hub-menu-horizontal');
const HUB_V = SAMPLE_MENUS.find(m => m.key === 'hub-menu-vertical');

test('hub menu: kind exists, samples have 3+ root items, big centre = 2x side button', () => {
  assert.ok(MENU_KINDS.includes('hub'));
  for (const def of [HUB, HUB_V]) { assert.equal(def.config.kind, 'hub'); assert.ok(def.items.length >= 3); }
  assert.equal(HUB.config.direction, 'horizontal'); assert.equal(HUB_V.config.direction, 'vertical');
  const g = hubGeometry(HUB.config, 56);
  assert.equal(g.big, g.small * 2); assert.equal(g.vertical, false);
  assert.equal(hubGeometry(HUB_V.config, 56).vertical, true);
  const sizeOk = BUTTON_ELEMENTS.filter(e => /hub-menu/.test(e.key));
  assert.deepEqual(sizeOk.map(e => e.key), ['html-hub-menu', 'html-hub-menu-vertical']);
  assert.ok(HUB.items.some(i => i.children?.some(c => c.children?.length)), 'a sub item has sub items (2-level fan)');
});

test('hub menu markup: every ring item pre-rendered, sub levels fan around the centre', () => {
  const tree = buildMenuTree(rowsOf(HUB.items));
  const ctx = createContext({ theme: BUILTIN_THEMES[0] });
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree, ctx, iconKey: () => null });
  assert.match(svg, /data-kind="hub"/); assert.match(svg, /data-hub-vertical="0"/);
  assert.equal((svg.match(/data-hub-index="/g) || []).length, HUB.items.length);
  assert.match(svg, /data-level="menu"/);                          // fan of the burger item
  assert.match(svg, /class="rm-center" data-for="menu\/notifications"/);   // sub item with sub items shows itself in the centre
  assert.doesNotMatch(svg, /class="rm-center" data-for="menu"/, 'the root centre item is the hub button itself');
  const v = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB_V.config }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(v, /data-hub-vertical="1"/);
  assert.match(MENU_CSS, /rm-hub-item/);
  const ext = menuExtent({ width: 56, height: 56 }, HUB.config, tree), extV = menuExtent({ width: 56, height: 56 }, HUB_V.config, tree);
  assert.ok(ext.w > ext.h * 0.9 && ext.w > 56 * 3, 'horizontal bar is wide');
  assert.ok(extV.h > 56 * 3, 'vertical bar is tall');
});

// --- runtime with a tiny DOM stub ---
function hubWorld(n = 5, children = { 0: true }) {
  const mk = (attrs = {}) => {
    const el = { attrs: { ...attrs }, cls: new Set(), kids: [], styleVars: {}, style: { setProperty: (k, v) => { el.styleVars[k] = v; } },
      getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); }, hasAttribute: k => k in el.attrs,
      classList: { toggle: (c, on) => (on ? el.cls.add(c) : el.cls.delete(c)) }, contains: x => x === el || el.kids.includes(x) };
    el.querySelector = s => el.querySelectorAll(s)[0] || null;
    el.querySelectorAll = s => el.kids.filter(k => k.sel === s);
    return el;
  };
  const btn = mk({ 'data-menu': 'hub' }); btn.sel = '.ud-btn';
  const menu = mk({ 'data-kind': 'hub', 'data-cx': '28', 'data-cy': '28', 'data-hub-small': '44.8', 'data-hub-gap': '11.2', 'data-hub-vertical': '0' });
  menu.sel = '.ud-menu'; btn.kids.push(menu);
  menu.kids = btn.kids;
  btn.querySelector = s => (s === '.ud-menu[data-kind="hub"]' || s === '.ud-menu' ? menu : btn.querySelectorAll(s)[0] || null);
  const items = Array.from({ length: n }, (_, i) => { const it = mk({ 'data-hub-index': i, 'data-item': `i${i}`, 'data-children': children[i] ? '1' : '0', 'data-action': `act${i}` }); it.sel = '.rm-level[data-level=""] .rm-hub-item'; it.closest = s => (s === '.ud-btn' ? btn : s === '[data-rm="center"], .rm-item' ? it : null); return it; });
  const sub = mk({ 'data-level': 'i0' }); sub.sel = '.rm-level';
  const rootLevel = mk({ 'data-level': '' }); rootLevel.sel = '.rm-level';
  const fanItem = mk({ 'data-item': 'i0/x', 'data-children': '0', 'data-action': 'x' }); fanItem.closest = s => (s === '.ud-btn' ? btn : s === '[data-rm="center"], .rm-item' ? fanItem : null);
  const centre = mk({ 'data-rm': 'center' }); centre.closest = s => (s === '.ud-btn' ? btn : s === '[data-rm="center"], .rm-item' ? centre : null);
  btn.kids.push(...items, sub, rootLevel);
  const root = mk({}); root.querySelectorAll = s => (s === '.ud-btn' ? [btn] : []);
  const handlers = {}; root.addEventListener = (type, fn) => { handlers[type] = fn; };
  root.ownerDocument = { addEventListener: (type, fn) => { handlers.docClick = fn; } };
  const actions = [];
  const ctl = bindMenus(root, { onAction: a => actions.push(a) });
  const click = t => handlers.click({ target: t, stopPropagation() {} });
  const pos = () => items.map(i => i.attrs['data-hub-pos']);
  return { btn, items, click, centre, fanItem, ctl, actions, pos, sub, rootLevel, handlers };
}

test('hub runtime: initial layout is left small / centre big / right small, rest hidden', () => {
  const w = hubWorld();
  assert.deepEqual(w.pos(), ['center', 'next', 'hidden', 'hidden', 'prev']);
  assert.equal(w.items[0].styleVars['--k'], '1'); assert.equal(w.items[1].styleVars['--k'], '0.5'); assert.equal(w.items[4].styleVars['--k'], '0.5');
  assert.ok(parseFloat(w.items[1].styleVars['--x']) > 28 && parseFloat(w.items[4].styleVars['--x']) < 28);   // right of / left of the centre
  assert.equal(w.items[0].styleVars['--y'], '28px');                                                     // horizontal bar: same y
  assert.equal(w.btn.attrs['data-open'], '1');
});

test('hub runtime: clicking a side button swaps place and size; the ring is infinite', () => {
  const w = hubWorld(5, {});
  w.click(w.items[1]);                                                  // right button -> centre
  assert.deepEqual(w.pos(), ['prev', 'center', 'next', 'hidden', 'hidden']);
  w.click(w.items[2]); w.click(w.items[3]); w.click(w.items[4]);        // keeps scrolling to the right
  assert.deepEqual(w.pos(), ['next', 'hidden', 'hidden', 'prev', 'center']);   // item 0 wrapped around to the right side
  w.click(w.items[3]);                                                  // left button -> centre (scrolling back)
  assert.equal(w.items[3].attrs['data-hub-pos'], 'center');
});

test('hub runtime: sub items fan out; second click on the centre or an outside click goes back', () => {
  const w = hubWorld(5, { 1: true });
  w.click(w.items[1]);                                                  // right button has sub items: swaps into the centre and fans out
  assert.deepEqual(w.ctl.get(w.btn).path, ['i1']); assert.equal(w.ctl.get(w.btn).c, 1);
  assert.equal(w.items[0].styleVars['--o'], '0', 'side buttons hide while the fan is open');
  w.click(w.centre);                                                    // second click: back to the previous ring position
  assert.deepEqual(w.ctl.get(w.btn).path, []); assert.equal(w.ctl.get(w.btn).c, 0);
  assert.deepEqual(w.pos(), ['center', 'next', 'hidden', 'hidden', 'prev']);
  w.click(w.items[1]);                                                  // fan open again, then click OUTSIDE the button
  assert.deepEqual(w.ctl.get(w.btn).path, ['i1']);
  w.handlers.docClick({ target: { outside: true } });
  assert.deepEqual(w.ctl.get(w.btn).path, []); assert.equal(w.ctl.get(w.btn).c, 0, 'outside click acts as back');
  w.handlers.docClick({ target: w.items[0] });                          // a click inside the button never triggers back
  // leaf of a fan fires its action and returns to the root position
  w.click(w.items[1]);
  w.fanItem.attrs['data-item'] = 'i1/x'; w.click(w.fanItem);
  assert.equal(w.actions.at(-1).action, 'x'); assert.deepEqual(w.ctl.get(w.btn).path, []);
});

test('hub runtime: centre click on a leaf fires its action; wheel scrolls the ring', () => {
  const w = hubWorld(5, {});
  w.click(w.centre);
  assert.equal(w.actions.length, 1); assert.equal(w.actions[0].action, 'act0');
  w.handlers.wheel({ target: { closest: () => w.btn }, deltaY: 100, preventDefault() {} });
  assert.equal(w.ctl.get(w.btn).c, 1);
  w.handlers.wheel({ target: { closest: () => w.btn }, deltaY: -100, preventDefault() {} });
  w.handlers.wheel({ target: { closest: () => w.btn }, deltaY: -100, preventDefault() {} });
  assert.equal(w.ctl.get(w.btn).c, 4, 'infinite: scrolling back past the first wraps to the last');
});

test('hub menus reach an existing library once and are idempotent (button + element presets)', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const keys = new Set(); const walk = l => l.forEach(i => { keys.add(i.icon); if (i.children) walk(i.children); }); walk(HUB.items); walk(HUB_V.items); keys.add(HUB.icon);
    for (const k of keys) c.icon.create({ name: k, key: k, projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
    const first = c.importer.ensureHubMenus();
    assert.deepEqual(first.sort(), ['hub-menu-horizontal', 'hub-menu-vertical', 'html-hub-menu', 'html-hub-menu-vertical'].sort());
    assert.deepEqual(c.importer.ensureHubMenus(), [], 'idempotent');
    const b = c.button.list().find(x => x.key === 'hub-menu-horizontal');
    const full = c.button.get(b.id);
    assert.equal(full.meta.menu.kind, 'hub'); assert.equal(full.menuItems.length, 16, '5 ring items + 11 sub items');
    assert.ok(full.menuItems.filter(m => m.parentId == null).length >= 3);
    assert.ok(full.menuItems.some(m => m.name === 'announcements'), 'second-level sub items exist');
    const el = c.element.list().find(x => x.key === 'html-hub-menu');
    assert.ok(c.element.get(el.id).nodes.some(n => n.refType === 'button' && n.refId === b.id));
    assert.equal(c.menus.setConfig(b.id, { kind: 'hub' }).kind, 'hub');
  } finally { c.close(); }
});

test('edited items: red edge and listed first (most recent first), before project / private / used / public', () => {
  const edited = new Map([['icon:5', 0], ['icon:2', 1]]);   // 5 was edited last
  const list = [
    { id: 1, visibility: 'public' }, { id: 2, visibility: 'public' }, { id: 3, visibility: 'project' },
    { id: 4, visibility: 'private', creatorId: 7 }, { id: 5, visibility: 'project' }, { id: 6, visibility: 'public' }
  ];
  const used = new Set(['icon:6']);
  assert.deepEqual(scopeFirst(list, 7, used, 'icon', edited).map(d => d.id), [5, 2, 3, 4, 6, 1]);
  assert.deepEqual(scopeFirst(list, 7, used, 'icon').map(d => d.id), [3, 5, 4, 6, 1, 2], 'no edits: unchanged order');
  assert.equal(visClass({ id: 5, visibility: 'project' }, used, 'icon', edited), ' vis-edited');
  assert.equal(visClass({ id: 2, visibility: 'public' }, used, 'icon', edited), ' vis-edited');
  assert.equal(visClass({ id: 2, visibility: 'public' }, used, 'button', edited), '', 'type is part of the key');
  assert.equal(isEdited({ id: 1 }, new Map(), 'icon'), false);
});

test('menu item can show a library button besides its icon (refButtonId): stored, validated, rendered, restored', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const mkBtn = (key, w) => c.button.create({ name: key, key, projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: w, height: w }, { nodes: [{ tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: w, height: w, rx: 8 } }] });
    const host = mkBtn('host', 64), frame = mkBtn('square-frame', 64);
    const icon = c.icon.create({ name: 'dot', key: 'dot', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
    const it = c.menus.addItem(host.id, { label: 'Scan', iconId: icon.id, refButtonId: frame.id });
    assert.equal(it.refButtonId, frame.id);
    assert.throws(() => c.menus.addItem(host.id, { label: 'Bad', refButtonId: 99999 }), /button 99999 does not exist/);
    assert.equal(c.menus.updateItem(it.id, { refButtonId: null }).refButtonId, null);
    c.menus.updateItem(it.id, { refButtonId: frame.id });
    // survives a snapshot restore (replaceAll) and a clone
    const snap = c.button.get(host.id);
    c.menus.menus.replaceAll(host.id, snap.menuItems);
    assert.equal(c.menus.get(host.id).items[0].refButtonId, frame.id);
    assert.equal(c.button.clone(host.id, { name: 'host copy' }).menuItems[0].refButtonId, frame.id);
    // markup: the referenced button's shape is drawn inside the item
    const cfg = { kind: 'popup', layout: 'list', direction: 'up', itemScale: 0.75, gap: 0.2, rotateOnOpen: 0 };
    const items = c.menus.get(host.id).items;
    const ctx = createContext({ theme: BUILTIN_THEMES[0] });
    const calls = [];
    const svg = renderMenu({ button: { key: 'host', width: 64, height: 64 }, cfg, tree: buildMenuTree(items), ctx, iconKey: () => null, renderButton: (id, size, noIcon) => { calls.push([id, size, noIcon]); return '<g class="ref-btn"/>'; } });
    assert.match(svg, /class="ref-btn"/);
    assert.deepEqual(calls[0], [frame.id, 48, true], 'item size = itemScale x button; the item icon replaces the button icon');
    const plain = renderMenu({ button: { key: 'host', width: 64, height: 64 }, cfg, tree: buildMenuTree(items.map(i => ({ ...i, refButtonId: null }))), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
    assert.doesNotMatch(plain, /ref-btn/);
    // no own button on the item: the slot shows the host button's own body instead of a bare placeholder circle
    const hostCalls = [];
    const hosted = renderMenu({ button: { key: 'host', width: 64, height: 64 }, cfg, tree: buildMenuTree(items.map(i => ({ ...i, refButtonId: null }))), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null, hostButtonId: host.id, renderButton: (id, size, noIcon) => { hostCalls.push([id, size, noIcon]); return '<g class="host-btn"/>'; } });
    assert.match(hosted, /class="host-btn"/);
    assert.equal(hostCalls[0][0], host.id);
  } finally { c.close(); }
});
