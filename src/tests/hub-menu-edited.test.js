/**
 * Hub menu (3-button scrolling bar), hover-toolbar menu tools, and the "edited items: red edge, listed first" rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { SAMPLE_MENUS } from '../infrastructure/import/sample-menus.js';
import { BUTTON_ELEMENTS } from '../infrastructure/import/elements-catalog.js';
import { MENU_KINDS, DEFAULT_MENU, scopeFirst, visClass, isEdited } from '../domain/entities.js';
import { renderMenu, buildMenuTree, menuExtent, hubGeometry, layoutItems, MENU_CSS, hubDirectionPatch, HUB_FAN, menuConfig } from '../domain/menu.js';
import { readFileSync } from 'node:fs';
import { createContext, indexLibrary, renderTree } from '../domain/svg.js';
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
  assert.equal(g.big, g.small * 4, 'side buttons are half their former size: a quarter of the centre'); assert.equal(g.vertical, false);
  assert.equal(hubGeometry(HUB.config, 56).big, hubGeometry(HUB_V.config, 56).big, 'both bar directions share the sizes');
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
function hubWorld(n = 5, children = { 0: true }, extra = {}) {
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
  const ctl = bindMenus(root, { onAction: a => actions.push(a), ...extra });
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

test('menu settings: distance from parent, hub centre size, item button style, keep-inside flag', () => {
  const base = { kind: 'popup', layout: 'list', direction: 'up', itemScale: 0.75, gap: 0.2, rotateOnOpen: 0 };
  const near = layoutItems({ ...base }, 2, 64), far = layoutItems({ ...base, distance: 0.6 }, 2, 64);
  assert.ok(Math.abs(far[0].y) - Math.abs(near[0].y) > 20, 'distance moves the first item away from its parent');
  assert.equal(Math.round(far[1].y - far[0].y), Math.round(near[1].y - near[0].y), 'the gap between items is unchanged');
  const g = hubGeometry({ hubScale: 0.5, centerScale: 1.5 }, 64);
  assert.deepEqual([g.small, g.big], [32, 96]);
  assert.equal(hubGeometry({ hubScale: 0.5 }, 64).big, 64, 'centre defaults to twice the small items');
  const rows = [{ id: 1, parentId: null, ord: 0, name: 'a', label: 'A', iconId: null, refButtonId: null, visible: true }];
  const calls = [];
  const svg = renderMenu({ button: { key: 'h', width: 64, height: 64 }, cfg: { ...base, itemButtonId: 77, keepInside: false }, tree: buildMenuTree(rows), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null, hostButtonId: 5, renderButton: (id) => { calls.push(id); return '<g/>'; } });
  assert.equal(calls[0], 77, 'the menu button style is used for items without their own button');
  assert.match(svg, /data-keep="0"/);
  assert.match(svg, /data-r="/);
});

test('hub menu editor: centre placeholder has no button circle, host body hidden under a hub, swapping an item keeps depth 0 (back button invisible)', () => {
  const tree = buildMenuTree(rowsOf(HUB.items));
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  const centres = svg.match(/<g class="rm-center"[^>]*>.*?<\/g>/g) || [];
  assert.ok(centres.length > 0);
  for (const c of centres) assert.doesNotMatch(c, /<circle/, 'no button element on the centred placeholder of a hub menu');
  assert.match(MENU_CSS, /\.ud-btn:not\(\[data-hub\]\)\[data-hubdepth="0"\]/, 'the host button body only shows for non-hub menus');
  // radial menus keep their centre circle
  const radial = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config, kind: 'radial', layout: 'fan' }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  if (/class="rm-center"/.test(radial)) assert.match(radial, /<g class="rm-center"[^>]*><circle/);
});

test('hub menu: centre item body is not hidden by the editor stylesheet; default config halves the side buttons', () => {
  const css = readFileSync(new URL('../interfaces/web/css/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /rm-hub-item\[data-hub-pos="center"\][^{]*\{[^}]*opacity:\s*0/, 'the centre hub item keeps its button body in the designer');
  const def = hubGeometry(menuConfig({}), 64);
  assert.equal(def.small, 64 * 0.4); assert.equal(def.big, 64 * 1.6);
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree: buildMenuTree(rowsOf(HUB.items)), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(svg, /data-hub-k="0.25"/, 'side buttons drawn at a quarter of the centre');
});

test('vertical hub menu: switching the bar direction moves a default fan with it (custom fans stay)', () => {
  assert.deepEqual(hubDirectionPatch({ startAngle: -160, sweep: 140 }, 'vertical'), { direction: 'vertical', ...HUB_FAN.vertical });
  assert.deepEqual(hubDirectionPatch({ startAngle: -70, sweep: 140 }, 'horizontal'), { direction: 'horizontal', ...HUB_FAN.horizontal });
  assert.deepEqual(hubDirectionPatch({ startAngle: 10, sweep: 90 }, 'vertical'), { direction: 'vertical' });
  assert.equal(HUB_V.config.startAngle, HUB_FAN.vertical.startAngle);
  const tree = buildMenuTree(rowsOf(HUB.items));
  const v = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB_V.config }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(v, /data-hub-vertical="1"/);
  const ext = menuExtent({ width: 56, height: 56 }, { ...HUB_V.config }, tree);
  assert.ok(ext.h > ext.w * 0.9, 'the vertical bar extends top to bottom');
});

test('hub menu items are body containers: changing the host button style restyles every item; a menu item style overrides all', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const mkBtn = (key, rx) => c.button.create({ name: key, key, projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 64, height: 64 }, { nodes: [{ tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: 64, height: 64, rx } }] });
    const host = mkBtn('hub-host', 32), square = mkBtn('square-style', 4);
    c.menus.setConfig(host.id, { ...HUB.config });
    const a = c.menus.addItem(host.id, { label: 'A' }); c.menus.addItem(host.id, { label: 'B' }); c.menus.addItem(host.id, { label: 'C' });
    c.menus.addItem(host.id, { label: 'A1', parentId: a.id });
    const bodies = () => { const svg = c.render.boxSvg('button', host.id, null, { editor: true }); return [...svg.matchAll(/<g class="rm-item[^"]*"[^>]*>.*?<rect[^>]*rx="([\d.]+)"/g)].map(m => m[1]); };
    const before = bodies();
    assert.equal(before.length, 4, 'ring items and fan items all draw a button body');
    assert.ok(before.every(rx => rx === '32'), 'items follow the host body (circle)');
    // the Button style tool rewrites the host nodes: every item follows
    c.button.replaceNodes(host.id, [{ tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: 64, height: 64, rx: 12 } }]);
    assert.ok(bodies().every(rx => rx === '12'), 'all items take the new host style');
    // menu-wide item style
    c.menus.setConfig(host.id, { itemButtonId: square.id });
    assert.ok(bodies().every(rx => rx === '4'));
  } finally { c.close(); }
});

test('hub editor: clicking an item swaps it into the centre, shows its existing sub items and reports the item (action toolbar)', () => {
  const seen = [];
  const w = hubWorld(5, { 1: true }, { keepOpen: true, onItem: (_, el) => seen.push(el.getAttribute('data-item')) });
  w.click(w.items[1]);
  assert.deepEqual(w.ctl.get(w.btn).path, ['i1'], 'sub items fan out in the editor too');
  assert.equal(w.items[1].attrs['data-hub-pos'], 'center');
  assert.deepEqual(seen, ['i1'], 'the editor is told which item was clicked so it can pin its toolbar');
  w.click(w.centre);                                       // back to the ring, nothing lost
  assert.deepEqual(w.ctl.get(w.btn).path, []);
  w.click(w.items[2]);                                     // a leaf: only swaps, toolbar still reported
  assert.deepEqual(w.ctl.get(w.btn).path, []); assert.equal(seen.at(-1), 'i2');
});

test('corner fan option: levels carry data-corner (never the hub ring), validated setting, runtime places items on a quarter circle inside the screen', () => {
  const tree = buildMenuTree(rowsOf(HUB.items));
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...menuConfig({ menu: HUB.config }), fanCorner: 'bottom-right' }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(svg, /data-level="menu"[^>]*data-corner="bottom-right"/, 'the burger fan opens at the corner');
  assert.doesNotMatch(svg, /data-level=""[^>]*data-corner/, 'the hub ring stays a bar');
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'burger', key: 'burger', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 48, height: 48 }, { nodes: [] });
    assert.equal(c.menus.setConfig(b.id, { kind: 'radial', fanCorner: 'bottom-left' }).fanCorner, 'bottom-left');
    assert.throws(() => c.menus.setConfig(b.id, { fanCorner: 'middle' }), /fanCorner/);
  } finally { c.close(); }
  // runtime with a stub: a 48px burger button at (300,600) of a 360 x 640 screen (identity transform)
  const mk = (attrs = {}) => { const el = { attrs: { ...attrs }, vars: {}, style: { setProperty: (k, v) => { el.vars[k] = v; } }, getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); }, hasAttribute: k => k in el.attrs, classList: { toggle() {} } }; return el; };
  const items = Array.from({ length: 4 }, () => mk({ 'data-r': '18' }));
  const level = mk({ 'data-level': '', 'data-corner': 'bottom-right', 'data-corner-r': '80' }); level.querySelectorAll = () => items;
  const menu = mk({ 'data-kind': 'radial', 'data-keep': '1' });
  const pt = () => { const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) }; return p; };
  const btn = mk({}); btn.ownerSVGElement = { createSVGPoint: pt, getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 640, width: 360 }) };
  btn.getScreenCTM = () => ({ a: 1, inverse() { return this; } });
  btn.querySelector = s => (s === '.ud-menu' || s === '.ud-menu[data-kind="hub"]' ? (s === '.ud-menu' ? menu : null) : s === '.rm-level.is-active[data-corner]' ? level : null);
  btn.querySelectorAll = () => [];
  const root = { addEventListener() {}, querySelectorAll: () => [] };
  bindMenus(root, {}).apply(btn, { open: true, path: [] });
  const pts = items.map(i => [parseFloat(i.vars['--x']), parseFloat(i.vars['--y'])]);
  for (const [x, y] of pts) { assert.ok(x + 18 <= 360 && x - 18 >= 0 && y + 18 <= 640 && y - 18 >= 0, `inside the screen: ${x},${y}`); assert.ok(x > 180 && y > 320, 'near the bottom right corner'); }
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) >= 36, 'items do not overlap');
  const d = pts.map(([x, y]) => Math.round(Math.hypot(360 - x, 640 - y)));
  assert.ok(d.every(v => v === d[0]), 'all on one arc around the corner');
});

test('hub default centre: a top-level item can be the starting centre button (validated, rendered, runtime starts there)', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'hub', key: 'hub-dc', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 56, height: 56 }, { nodes: [] });
    c.menus.setConfig(b.id, { ...HUB.config });
    const [a, , m] = ['a', 'b', 'c'].map(l => c.menus.addItem(b.id, { label: l }));
    const sub = c.menus.addItem(b.id, { label: 'a1', parentId: a.id });
    assert.throws(() => c.menus.setConfig(b.id, { hubCenterItemId: sub.id }), /top-level/);
    assert.equal(c.menus.setConfig(b.id, { hubCenterItemId: m.id }).hubCenterItemId, m.id);
    assert.match(c.render.boxSvg('button', b.id, null, {}), /data-hub-start="2"/);
    c.menus.setConfig(b.id, { hubCenterItemId: null });
    assert.match(c.render.boxSvg('button', b.id, null, {}), /data-hub-start="0"/);
  } finally { c.close(); }
  const fresh = hubWorld(5, {});
  assert.equal(fresh.ctl.get(fresh.btn).c, 0, 'no start index: the first item is the centre');
  // a menu that declares a start index begins there
  const w = hubWorld(5, {});
  w.btn.querySelector('.ud-menu').attrs['data-hub-start'] = '3';
  const st = bindMenus({ addEventListener() {}, querySelectorAll: () => [w.btn], ownerDocument: null }, {}).get(w.btn);
  assert.equal(st.c, 3); assert.equal(st.prev, 3);
});

test('hub "when clicked rotate": hubSpin is rendered and every click turns the clicked item\'s icon (accumulating); 0 = off', () => {
  assert.equal(DEFAULT_MENU.hubSpin, 0);
  const w = hubWorld(5, {});
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '360';
  w.items.forEach(it => { it.style.getPropertyValue = k => it.styleVars[k] ?? ''; });
  w.click(w.items[1]);
  assert.equal(w.items[1].styleVars['--spin'], '360deg');
  w.click(w.items[1]);          // clicked again: keeps turning the same way
  assert.equal(w.items[1].styleVars['--spin'], '720deg');
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '0';
  w.click(w.items[2]);
  assert.equal(w.items[2].styleVars['--spin'], undefined);
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '90';
  w.fanItem.style.getPropertyValue = k => w.fanItem.styleVars[k] ?? '';
  w.click(w.fanItem);                                           // a fan sub item turns too
  assert.equal(w.fanItem.styleVars['--spin'], '90deg');
});

test('hub auto downsize: sub items wider than the screen are scaled (size and distance) to fit; off or fitting = untouched', () => {
  assert.equal(DEFAULT_MENU.hubFit, false);
  const tree = buildMenuTree(rowsOf(HUB.items));
  const mkSvg = hubFit => renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...menuConfig({ menu: HUB.config }), hubFit }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(mkSvg(true), /data-hub-fit="1"/); assert.match(mkSvg(false), /data-hub-fit="0"/);
  const run = fitOn => {
    const mk = (attrs = {}) => { const el = { attrs: { ...attrs }, vars: {}, style: { setProperty: (k, v) => { el.vars[k] = v; }, getPropertyValue: k => el.vars[k] ?? '' }, getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); }, hasAttribute: k => k in el.attrs, classList: { toggle() {} }, querySelectorAll: () => [], querySelector: () => null }; return el; };
    const items = [-200, -100, 0, 100, 200].map(x => { const e = mk({ 'data-r': '20' }); e.vars['--x'] = (180 + x) + 'px'; e.vars['--y'] = '300px'; return e; });   // 440 px wide on a 360 px screen
    const menu = mk({ 'data-kind': 'hub', 'data-cx': '180', 'data-cy': '300', 'data-keep': '1', 'data-hub-fit': fitOn ? '1' : '0' });
    const pt = () => { const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) }; return p; };
    const btn = mk({}); btn.ownerSVGElement = { createSVGPoint: pt, getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 640, width: 360 }) };
    btn.getScreenCTM = () => ({ a: 1, inverse() { return this; } }); btn.getBoundingClientRect = () => ({ width: 40 });
    btn.querySelector = s => (s === '.ud-menu' ? menu : s === '.ud-menu[data-kind="hub"]' ? menu : null);
    btn.querySelectorAll = s => (s.includes('.rm-item') && s.includes('is-active') ? items : []);
    bindMenus({ addEventListener() {}, ownerDocument: { addEventListener() {} }, querySelectorAll: () => [] }, {}).apply(btn, { open: true, path: ['x'], c: 0, prev: 0 });
    return items;
  };
  const on = run(true), xs = on.map(i => parseFloat(i.vars['--x'])), s = parseFloat(on[0].vars['--fit']);
  assert.ok(s < 1 && s >= 0.2, `scale ${s}`);
  assert.ok(Math.min(...xs) - 20 * s >= 0 && Math.max(...xs) + 20 * s <= 360, 'every sub item inside the screen');
  assert.equal(xs[2], 180, 'the centre stays');
  const off = run(false);
  assert.equal(off[0].vars['--fit'], undefined, 'never scaled while off: items untouched');
  assert.equal(parseFloat(off[0].vars['--x']), -20);
});

test('menu item whose button has no visible body falls back to the plain circle', () => {
  const icon = { id: 10, key: 'bell', width: 24, height: 24, nodes: [] };
  const iconNode = { id: 1, tag: 'use', kind: 'instance', refType: 'icon', refId: 10, attrs: { x: 0, y: 0, width: 40, height: 40 } };
  const items = [{ id: 1, parentId: null, path: 'a', name: 'a', label: 'A', iconId: 10, refButtonId: null, children: [], visible: true, position: 0 }];
  const cfg = { ...menuConfig({ menu: HUB.config }) };
  const draw = hostNodes => {
    const host = { id: 5, key: 'host', width: 64, height: 64, nodes: hostNodes, meta: { menu: cfg } };
    const lib = indexLibrary({ icons: [icon], buttons: [host] }, new Map([[5, items]]));
    const ctx = createContext({ theme: BUILTIN_THEMES[0], lib });
    const inst = { id: 9, tag: 'use', kind: 'instance', refType: 'button', refId: 5, attrs: { x: 0, y: 0, width: 64, height: 64 } };
    return renderTree([inst], ctx);
  };
  const itemCircles = svg => (svg.match(/<g class="rm-item rm-hub-item"[\s\S]*?<\/g>/) || [''])[0].match(/<circle r="/g)?.length || 0;
  // body removed (only the icon left): the item still draws its circle
  assert.ok(itemCircles(draw([iconNode])) >= 1, 'bodyless host -> plain circle behind the item icon');
  // body present: the host button body is drawn instead of the fallback circle
  const withBody = draw([{ id: 2, tag: 'circle', attrs: { cx: 32, cy: 32, r: 30 } }, iconNode]);
  assert.match(withBody, /<g transform="translate\(/);
});
