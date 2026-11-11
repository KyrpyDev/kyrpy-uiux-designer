/**
 * Hub menu (3-button scrolling bar), hover-toolbar menu tools, and the "edited items: red edge, listed first" rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { SAMPLE_MENUS } from '../infrastructure/import/sample-menus.js';
import { BUTTON_ELEMENTS } from '../infrastructure/import/elements-catalog.js';
import { MENU_KINDS, DEFAULT_MENU, scopeFirst, visClass, isEdited } from '../domain/entities.js';
import { renderMenu, buildMenuTree, menuExtent, hubGeometry, layoutItems, MENU_CSS, hubDirectionPatch, HUB_FAN, menuConfig, dropTarget, isMenuItemShown } from '../domain/menu.js';
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

test('hub runtime: initial layout is edge / side / centre / side / edge; 7 items show 5', () => {
  const w = hubWorld(7, {});
  assert.deepEqual(w.pos(), ['center', 'next', 'next2', 'hidden', 'hidden', 'prev2', 'prev']);
  assert.equal(w.items[0].styleVars['--k'], '1'); assert.equal(w.items[1].styleVars['--k'], '0.6'); assert.equal(w.items[6].styleVars['--k'], '0.6');
  assert.equal(w.items[2].styleVars['--k'], '0.4'); assert.equal(w.items[5].styleVars['--k'], '0.4');
  assert.ok(parseFloat(w.items[1].styleVars['--x']) > 28 && parseFloat(w.items[6].styleVars['--x']) < 28);   // right of / left of the centre
  assert.equal(w.items[0].styleVars['--y'], '28px');                                                     // horizontal bar: same y
  assert.equal(w.btn.attrs['data-open'], '1');
});

test('hub runtime: clicking a side button swaps place and size; the ring is infinite', () => {
  const w = hubWorld(7, {});
  w.click(w.items[1]);                                                  // right button -> centre
  assert.deepEqual(w.pos(), ['prev', 'center', 'next', 'next2', 'hidden', 'hidden', 'prev2']);
  w.click(w.items[2]); w.click(w.items[3]); w.click(w.items[4]); w.click(w.items[5]); w.click(w.items[6]);   // keeps scrolling to the right
  assert.deepEqual(w.pos(), ['next', 'next2', 'hidden', 'hidden', 'prev2', 'prev', 'center']);   // items 0 and 1 wrapped around to the right side
  w.click(w.items[5]);                                                  // left button -> centre (scrolling back)
  assert.equal(w.items[5].attrs['data-hub-pos'], 'center');
});

test('hub runtime: sub items fan out; second click on the centre or an outside click closes them and keeps the item in the centre', () => {
  const w = hubWorld(7, { 1: true });
  w.click(w.items[1]);                                                  // right button has sub items: swaps into the centre and fans out
  assert.deepEqual(w.ctl.get(w.btn).path, ['i1']); assert.equal(w.ctl.get(w.btn).c, 1);
  assert.equal(w.items[0].styleVars['--o'], '0', 'side buttons hide while the fan is open');
  w.click(w.centre);                                                    // second click: closes the sub items, the same item stays in the centre
  assert.deepEqual(w.ctl.get(w.btn).path, []); assert.equal(w.ctl.get(w.btn).c, 1);
  assert.deepEqual(w.pos(), ['prev', 'center', 'next', 'next2', 'hidden', 'hidden', 'prev2']);
  w.click(w.items[1]);                                                  // fan open again, then click OUTSIDE the button
  assert.deepEqual(w.ctl.get(w.btn).path, ['i1']);
  w.handlers.docClick({ target: { outside: true } });
  assert.deepEqual(w.ctl.get(w.btn).path, []); assert.equal(w.ctl.get(w.btn).c, 1, 'outside click acts as back (the item stays in the centre)');
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

test('edited items: every edited item red and first (most recent first), then project (orange), my scope (green), public', () => {
  const edited = new Map([['icon:5', 0], ['icon:2', 1]]);   // 5 was edited last
  const list = [
    { id: 1, visibility: 'public' }, { id: 2, visibility: 'public' }, { id: 3, visibility: 'project' },
    { id: 4, visibility: 'private', creatorId: 7 }, { id: 5, visibility: 'project' }, { id: 6, visibility: 'public' }
  ];
  const used = new Set(['icon:6']);
  assert.deepEqual(scopeFirst(list, 7, used, 'icon', edited).map(d => d.id), [5, 2, 3, 4, 1, 6]);
  assert.deepEqual(scopeFirst(list, 7, used, 'icon').map(d => d.id), [3, 5, 4, 1, 2, 6], 'no edits: project, mine, public (in order)');
  assert.equal(visClass({ id: 5, visibility: 'project' }, used, 'icon', edited), ' vis-edited');
  assert.equal(visClass({ id: 2, visibility: 'public' }, used, 'icon', edited), ' vis-edited', 'every edited item is red, not only the last one');
  assert.equal(visClass({ id: 2, visibility: 'public' }, used, 'button', edited), '', 'type is part of the key');
  assert.match(readFileSync(new URL('../interfaces/web/css/app.css', import.meta.url), 'utf8'), /\.cell\.vis-project[^{]*\{ border-color: #f97316/);
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

test('hub menu editor: centre placeholder draws its own body, host body hidden under a hub, swapping an item keeps depth 0 (back button invisible)', () => {
  const tree = buildMenuTree(rowsOf(HUB.items));
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  const centres = svg.match(/<g class="rm-center"[^>]*>.*?<\/g>/g) || [];
  assert.ok(centres.length > 0);
  // the host body is hidden below the first level, so a centred 3rd-level item draws its own body (never an icon on nothing)
  for (const c of centres) assert.match(c, /<circle/, 'the centred placeholder of a hub menu has a body');
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

test('hub "when clicked rotate": a click turns the item\'s icon to hubSpin degrees, the second click turns it back to 0; 0 = off', () => {
  assert.equal(DEFAULT_MENU.hubSpin, 0);
  const w = hubWorld(5, { 0: true });
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '450';
  w.items.forEach(it => { it.style.getPropertyValue = k => it.styleVars[k] ?? ''; });
  w.click(w.centre);                                            // centre with sub items: opens them, icon turns
  assert.equal(w.items[0].styleVars['--spin'], '450deg');
  assert.equal(w.ctl.get(w.btn).path.join('/'), 'i0');
  w.click(w.centre);                                            // second click: back, icon turns back
  assert.equal(w.items[0].styleVars['--spin'], '0deg');
  assert.equal(w.ctl.get(w.btn).path.length, 0);
  w.click(w.items[1]);                                          // leaf swapped into the centre: toggles
  assert.equal(w.items[1].styleVars['--spin'], '450deg');
  w.click(w.items[1]);
  assert.equal(w.items[1].styleVars['--spin'], '0deg');
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '0';
  w.click(w.items[2]);
  assert.equal(w.items[2].styleVars['--spin'], undefined, '0 = off');
  assert.match(MENU_CSS, /\.rm-item \.rm-icon\{[^}]*rotate\(var\(--spin,0deg\)\)[^}]*transition/, 'item icons turn, animated');
});

test('hub live test: never closed (shows the bar), centre action fires and its sub items pop up, back button hidden in the live test', () => {
  const w = hubWorld(5, { 0: true });
  w.ctl.set(w.btn, { open: false, path: [] });                  // the live test starts "closed"
  assert.equal(w.ctl.get(w.btn).open, true, 'a hub bar is always open');
  assert.equal(w.rootLevel.cls.has('is-active'), true, 'the bar level is shown');
  w.click(w.centre);
  assert.deepEqual(w.actions.map(a => a.action), ['act0'], 'the centre item\'s own action fires');
  assert.equal(w.ctl.get(w.btn).path.join('/'), 'i0', 'and its sub items pop up');
  assert.match(MENU_CSS, /\.menu-live \.ud-btn \.rm-back\{display:none\}/);
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

test('hub item toolbar: focus previous / next item buttons on the centre and on hub items (same level, visible only, wrap)', () => {
  const src = readFileSync(new URL('../interfaces/web/js/components/menu-editor.js', import.meta.url), 'utf8');
  assert.match(src, /focusButtons\(rows, it, btn\)\s*\{/);
  assert.match(src, /Focus previous item/); assert.match(src, /Focus next item/);
  assert.match(src, /this\.focusButtons\(rows, levelItem, btn\)/, 'the centred main item of a sub level offers them');
  assert.match(src, /data-kind="hub"\]'\)\) this\.toolbar\.append\(\.\.\.this\.focusButtons\(rows, it, btn\)/, 'hub ring / fan items offer them');
});

test('menu item parent change and drag & drop: moveItem re-parents with order, guards cycles / clashes / hub centre; dropTarget maps before / after / inside', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const host = c.button.create({ name: 'mv', key: 'mv', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 64, height: 64 }, { nodes: [{ tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: 64, height: 64 } }] });
    c.menus.setConfig(host.id, { ...HUB.config });
    const A = c.menus.addItem(host.id, { label: 'A' }), B = c.menus.addItem(host.id, { label: 'B' }), C = c.menus.addItem(host.id, { label: 'C' });
    const A1 = c.menus.addItem(host.id, { label: 'A1', parentId: A.id }), A2 = c.menus.addItem(host.id, { label: 'A2', parentId: A.id });
    const kids = (r, pid) => r.items.filter(i => (i.parentId ?? null) === pid).sort((x, y) => x.ord - y.ord).map(i => i.label).join(',');
    // C goes under A, between A1 and A2
    let r = c.menus.moveItem(host.id, C.id, { parentId: A.id, index: 1 });
    assert.equal(kids(r, A.id), 'A1,C,A2'); assert.equal(kids(r, null), 'A,B');
    // back to the top level, first
    r = c.menus.moveItem(host.id, C.id, { parentId: null, index: 0 });
    assert.equal(kids(r, null), 'C,A,B'); assert.equal(kids(r, A.id), 'A1,A2');
    // guards
    assert.throws(() => c.menus.moveItem(host.id, A.id, { parentId: A1.id }), /own sub items/);
    assert.throws(() => c.menus.moveItem(host.id, A.id, { parentId: A.id }), /own sub items/);
    assert.throws(() => c.menus.moveItem(host.id, A.id, { parentId: 99999 }), /same button/);
    const dup = c.menus.addItem(host.id, { label: 'B', parentId: A.id, name: 'b-two' });
    c.menus.updateItem(dup.id, { name: 'b' });
    assert.throws(() => c.menus.moveItem(host.id, B.id, { parentId: A.id }), /sibling already uses the name/);
    // a hub default centre that gets nested is reset
    c.menus.setConfig(host.id, { hubCenterItemId: C.id });
    c.menus.moveItem(host.id, C.id, { parentId: A.id });
    assert.equal(c.menus.get(host.id).config.hubCenterItemId, null);
    // dropTarget
    const rows = c.menus.get(host.id).items, it = rows.find(x => x.id === B.id), a = rows.find(x => x.id === A.id);
    assert.deepEqual(dropTarget(rows, it, a, 'inside'), { parentId: A.id, index: null });
    assert.deepEqual(dropTarget(rows, it, a, 'before'), { parentId: null, index: 0 });
    assert.equal(dropTarget(rows, it, a, 'after'), null, 'B already follows A: nothing to do');
    assert.deepEqual(dropTarget(rows, a, null, 'after'), { parentId: null, index: null });
  } finally { c.close?.(); }
});

test('menu item UI: edit dialog has the parent tree, inspector tree rows are draggable and call the move endpoint', () => {
  const rd = f => readFileSync(new URL(`../interfaces/web/js/${f}`, import.meta.url), 'utf8');
  const ed = rd('components/menu-editor.js'), ins = rd('components/inspector.js'), api = rd('api.js');
  assert.match(ed, /mi-parent-tree/); assert.match(ed, /api\.moveMenuItem\(buttonId, item\.id, \{ parentId \}\)/);
  assert.match(ins, /draggable: 'true'/); assert.match(ins, /menuActions\.moveTo\(d, id, n\.id, where, bid\)/);
  assert.match(api, /menu\/items\/\$\{iid\}\/move/);
});

test('live test on screens: menu items carry their target screen id on the canvas, placed menus carry their button id', () => {
  const rows = [{ id: 1, parentId: null, ord: 0, name: 'go', label: 'Go', iconId: null, targetScreenId: 42 }, { id: 2, parentId: null, ord: 1, name: 'keyed', label: 'K', iconId: null, targetScreenId: 42, targetKey: 'home' }];
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...menuConfig({ menu: { kind: 'popup', layout: 'list' } }) }, tree: buildMenuTree(rows), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(svg, /data-item="go"[^>]*data-target="42"/, 'no targetKey (designer canvas): the screen id');
  assert.match(svg, /data-item="keyed"[^>]*data-target="home"/, 'targetKey (server render / export) wins');
  const host = { id: 5, key: 'host', width: 64, height: 64, nodes: [{ id: 2, tag: 'circle', attrs: { cx: 32, cy: 32, r: 30 } }], meta: { menu: { kind: 'popup' } } };
  const lib = indexLibrary({ buttons: [host] }, new Map([[5, rows]]));
  const out = renderTree([{ id: 9, tag: 'use', kind: 'instance', refType: 'button', refId: 5, attrs: { x: 0, y: 0, width: 64, height: 64 } }], createContext({ theme: BUILTIN_THEMES[0], lib }));
  assert.match(out, /data-menu="host"[^>]*data-btn-id="5"|data-btn-id="5"[^>]*data-menu="host"/);
});

test('live test UI: hotspots forward clicks to menus under them, edit pills open designs in a new tab, deep link + live sync', () => {
  const rd = f => readFileSync(new URL(`../interfaces/web/js/${f}`, import.meta.url), 'utf8');
  const ta = rd('components/designer-test-actions.js'), main = rd('main.js'), ed = rd('components/menu-editor.js');
  assert.match(ta, /if \(this\.forwardToMenu\(ev\)\) return;/);
  assert.match(ta, /proto\.mountLiveEditPills = function/); assert.match(ta, /proto\.installLiveItemPill = function/);
  assert.match(ta, /window\.open\(this\.designUrl\(type, id, extra\), '_blank'\)/);
  assert.match(main, /\(path\|icon\|button\|element\|screen\):\(\\d\+\)/, 'deep link ?open=type:id');
  assert.match(main, /d\?\.actionsLive && d\.doc/, 'live designs reload on the sync event');
  assert.match(ed, /this\.d\.navigateLiveToScreen\(targetScreen\.id/, 'menu navigation stays in the live test');
  assert.match(ed, /if \(!this\.active\) \{\s*for \(const b of this\.d\.stage\.querySelectorAll\('\.ud-btn'\)\)/, 'hub bars placed on screens are laid out after every render');
});

test('rotation: item icons turn about their own centre and keep the angle across a redraw', () => {
  const rows = [{ id: 1, parentId: null, ord: 0, name: 'a', label: 'A', iconId: 7 }, { id: 2, parentId: null, ord: 1, name: 'b', label: 'B', iconId: 7 }, { id: 3, parentId: null, ord: 2, name: 'c', label: 'C', iconId: 7 }];
  const ctx = createContext({ theme: BUILTIN_THEMES[0] });
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree: buildMenuTree(rows), ctx, iconKey: () => 'dot' });
  assert.match(svg, /class="rm-icon" style="transform-origin:0px 0px"/, 'item icons are drawn around (0,0): that is their pivot');
  assert.match(MENU_CSS, /\.rm-item \.rm-icon\{transform-box:view-box;/);
  assert.doesNotMatch(MENU_CSS, /fill-box/, 'fill-box gives a wrong pivot on <use>');
  // the turned angle lives in the menu state: a fresh markup (new elements) gets it back
  const w = hubWorld(5, {});
  w.btn.querySelector('.ud-menu').attrs['data-hub-spin'] = '45';
  w.items.forEach(it => { it.style.getPropertyValue = k => it.styleVars[k] ?? ''; it.sel2 = '.rm-item'; });
  w.click(w.items[1]);
  assert.equal(w.items[1].styleVars['--spin'], '45deg');
  const st = w.ctl.get(w.btn);
  assert.deepEqual(st.spins, { i1: 45 });
  w.items[1].styleVars = {};                                     // a redraw lost the inline style
  w.btn.querySelectorAll = s => (s === '.rm-item' ? w.items : w.btn.kids.filter(k => k.sel === s));
  w.ctl.set(w.btn, { ...st, spins: undefined });                 // state objects without spins keep the old ones
  assert.equal(w.items[1].styleVars['--spin'], '45deg');
});

test('sync: the server names the design a write touched; live designs patch it at once; library panel redraws only on real changes; pills can be hidden', () => {
  const rd = f => readFileSync(new URL(f, import.meta.url), 'utf8');
  const server = rd('../interfaces/http/server.js'), main = rd('../interfaces/web/js/main.js'), lib = rd('../interfaces/web/js/components/library-panel.js'), ta = rd('../interfaces/web/js/components/designer-test-actions.js');
  assert.match(server, /broadcastSync\(url\.pathname, req\.method\)/); assert.match(server, /designType: PLURAL_TYPES\[m\[1\]\], designId: Number\(m\[2\]\)/);
  assert.match(main, /fastPatch\(msg\);/); assert.doesNotMatch(main, /app\.library\?\.renderBody\?\.\(\);/);
  assert.match(lib, /on\('library:changed', \(\) => \{ this\.loadWorkflows\(\); this\.softRefresh\(\); \}\);/); assert.match(lib, /sig === this\.renderedSig\) return;/);
  assert.match(ta, /if \(livePillsShown\(\)\) this\.mountLiveEditPills\(\);/);
});

test('menu item target picker: one modal (screen or popup element) from the toolbar and the edit dialog; copy into this project; new screen in a new tab', () => {
  const rd = f => readFileSync(new URL(f, import.meta.url), 'utf8');
  const ed = rd('../interfaces/web/js/components/menu-editor.js'), main = rd('../interfaces/web/js/main.js');
  assert.match(ed, /export function pickTarget\(/);
  assert.match(ed, /tabBtn\('screen', '🖥 Go to screen'\), tabBtn\('element', '▣ Show element as popup'\)/, 'screen and element tabs');
  assert.match(ed, /menuActions\.linkTarget\(this\.d, levelItem\.id, hit\.buttonId\)/, 'centre toolbar');
  assert.match(ed, /menuActions\.linkTarget\(this\.d, it\.id, hit\.buttonId\)/, 'item toolbar');
  assert.match(ed, /'data-f': 'mi-target'/, 'the edit dialog opens the same picker from a button');
  assert.doesNotMatch(ed, /mi-target-screen|mi-target-element|'Show element as popup\/modal box'/, 'the two dropdowns are gone');
  assert.match(ed, /targetScreenId: type === 'screen' \? target\.id : null, targetElementId: type === 'element' \? target\.id : null/, 'screen and popup are exclusive');
  assert.match(ed, /Number\(target\.projectId\) !== Number\(projectId\) \|\| isPublicLibraryItem\(target\)/, 'other project / public items are copied');
  assert.match(ed, /promptBox\(`Copy “\$\{target\.name\}” into this project`/, 'the copy is renamed');
  assert.match(ed, /api\.cloneDesign\(type, target\.id, \{ name: name\.trim\(\), projectId \}\)/);
  assert.match(ed, /new: 'screen', link: `\$\{bid\}:\$\{itemId\}`/);
  assert.match(main, /api\.updateMenuItem\(Number\(mk\[1\]\), Number\(mk\[2\]\), \{ targetScreenId: rec\.id, targetElementId: null \}\)/, 'the new tab links the created screen back');
});

test('hub bar size follows the item count: even 0.4 0.6 1 1 0.6 0.4 (max 6), odd 0.4 0.6 1 0.6 0.4 (max 5); sizes come from the settings', () => {
  assert.equal(DEFAULT_MENU.hubVisible, undefined, 'no visible-count setting');
  assert.deepEqual([DEFAULT_MENU.hubCenterSize, DEFAULT_MENU.hubSideSize, DEFAULT_MENU.hubEdgeSize], [1, 0.6, 0.4]);
  const bar = (n, sizes) => { const w = hubWorld(n, {}); if (sizes) w.btn.querySelector('.ud-menu').attrs['data-hub-sizes'] = sizes; w.ctl.set(w.btn, { open: true, path: [], c: 0, prev: 0 }); return w; };
  const ks = w => w.items.map((x, i) => [w.items[i].styleVars['--x'], w.pos()[i], x.styleVars['--k']]).filter(r => r[1] !== 'hidden').sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(r => r[2]);
  assert.deepEqual(ks(bar(3)), ['0.6', '1', '0.6']);
  assert.deepEqual(ks(bar(5)), ['0.4', '0.6', '1', '0.6', '0.4']);
  assert.deepEqual(ks(bar(9)), ['0.4', '0.6', '1', '0.6', '0.4'], 'more odd items: still 5 shown');
  assert.deepEqual(ks(bar(2)), ['1', '1']);
  assert.deepEqual(ks(bar(4)), ['0.6', '1', '1', '0.6']);
  assert.deepEqual(ks(bar(6)), ['0.4', '0.6', '1', '1', '0.6', '0.4']);
  assert.deepEqual(ks(bar(10)), ['0.4', '0.6', '1', '1', '0.6', '0.4'], 'more even items: still 6 shown');
  assert.equal(bar(4).btn.attrs['data-hub-even'], '1'); assert.equal(bar(5).btn.attrs['data-hub-even'], '0');
  assert.deepEqual(ks(bar(5, '0.9,0.5,0.3')), ['0.3', '0.5', '0.9', '0.5', '0.3'], 'adjustable sizes');
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'hs', key: 'hub-hs', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 56, height: 56 }, { nodes: [] });
    c.menus.setConfig(b.id, { ...HUB.config });
    ['a', 'b', 'c'].forEach(l => c.menus.addItem(b.id, { label: l }));
    assert.throws(() => c.menus.setConfig(b.id, { hubEdgeSize: 5 }), /hubEdgeSize must be a number from 0.1 to 2/);
    assert.equal(c.menus.setConfig(b.id, { hubSideSize: '0.7' }).hubSideSize, 0.7);
    assert.match(c.render.boxSvg('button', b.id, null, {}), /data-hub-sizes="1,0.7,0.4"/);
  } finally { c.close(); }
  let w;
  assert.match(MENU_CSS, /\[data-hub-even="1"\] \.rm-hit\{pointer-events:none\}/);
  // an end item further out scrolls the bar by one step instead of acting
  w = bar(9);
  w.items[2].attrs['data-hub-end'] = '1';
  w.click(w.items[2]);
  assert.equal(w.ctl.get(w.btn).c, 1); assert.equal(w.actions.length, 0);
});

test('fan sub items: more than 8 (even) / 9 (odd) show a window; first and last 30 % smaller and scroll it', () => {
  const mk = (attrs = {}) => { const el = { attrs: { ...attrs }, styleVars: {}, style: { setProperty: (k2, v) => { el.styleVars[k2] = v; }, getPropertyValue: k2 => el.styleVars[k2] ?? '' },
    getAttribute: k2 => el.attrs[k2] ?? null, setAttribute: (k2, v) => { el.attrs[k2] = String(v); }, removeAttribute: k2 => { delete el.attrs[k2]; }, hasAttribute: k2 => k2 in el.attrs, classList: { toggle() {} } }; return el; };
  const world = n => {
    const level = mk({ 'data-level': 'a', 'data-fan-start': '-160', 'data-fan-sweep': '140', 'data-fan-r': '60' });
    const items = Array.from({ length: n }, (_, i) => { const it = mk({ 'data-item': `a/x${i}`, 'data-children': '0', 'data-action': `x${i}` }); it.parentNode = level; return it; });
    level.querySelectorAll = () => items;
    const menu = mk({ 'data-kind': 'radial', 'data-cx': '28', 'data-cy': '28', 'data-keep': '0' });
    const btn = mk({ 'data-menu': 'm' });
    btn.querySelector = s2 => (s2 === '.ud-menu' ? menu : null);
    btn.querySelectorAll = s2 => (s2 === '.rm-level[data-fan-r]' ? [level] : []);
    items.forEach(it => { it.closest = s2 => (s2 === '.ud-btn' ? btn : s2 === '[data-rm="center"], .rm-item' ? it : null); });
    const handlers = {}, actions = [];
    const ctl = bindMenus({ addEventListener: (t, fn) => { handlers[t] = fn; }, querySelectorAll: () => [] }, { onAction: a => actions.push(a) });
    ctl.set(btn, { open: true, path: ['a'] });
    return { items, ctl, btn, actions, click: t => handlers.click({ target: t, stopPropagation() {} }) };
  };
  const visible = w => w.items.filter(it => it.attrs['data-fan-hidden'] === '0');
  let w = world(8);
  assert.ok(w.items.every(it => it.attrs['data-fan-hidden'] === undefined && it.styleVars['--end'] === '1'), '8 even items fit');
  w = world(11);                                                // odd: window of 9
  assert.equal(visible(w).length, 9); assert.equal(w.items[0].styleVars['--end'], '0.7'); assert.equal(w.items[8].styleVars['--end'], '0.7'); assert.equal(w.items[4].styleVars['--end'], '1');
  w = world(10);                                                // even: window of 8
  assert.equal(visible(w).length, 8); assert.equal(w.items[0].attrs['data-fan-end'], 'first'); assert.equal(w.items[7].attrs['data-fan-end'], 'last');
  w.click(w.items[7]);                                          // last: scroll forward, no action
  assert.equal(w.actions.length, 0); assert.equal(w.ctl.get(w.btn).fo.a, 1);
  assert.equal(w.items[1].attrs['data-fan-end'], 'first'); assert.equal(w.items[8].attrs['data-fan-end'], 'last'); assert.equal(w.items[0].attrs['data-fan-hidden'], '1');
  w.click(w.items[1]);                                          // first: scroll back
  assert.equal(w.ctl.get(w.btn).fo.a, 0);
  w.click(w.items[3]);                                          // a middle item acts
  assert.equal(w.actions.at(-1).action, 'x3');
  assert.match(MENU_CSS, /scale\(calc\(var\(--fit,1\) \* var\(--end,1\)\)\)/);
});

test('a hidden (disabled) menu item disables its whole sub tree; sub items are never promoted to the level above', () => {
  const rows = [
    { id: 1, parentId: null, ord: 0, name: 'a', visible: true }, { id: 2, parentId: 1, ord: 0, name: 'a1', visible: true },
    { id: 3, parentId: null, ord: 1, name: 'b', visible: false }, { id: 4, parentId: 3, ord: 0, name: 'b1', visible: true },
    { id: 5, parentId: 4, ord: 0, name: 'b11', visible: true }, { id: 6, parentId: 3, ord: 1, name: 'b2', visible: false }
  ];
  const shown = buildMenuTree(rows);
  assert.deepEqual(shown.map(n => n.name), ['a'], 'b1 / b11 / b2 are not promoted to the top level');
  assert.deepEqual(shown[0].children.map(n => n.name), ['a1']);
  const all = buildMenuTree(rows, { includeHidden: true });
  const b = all.find(n => n.name === 'b');
  assert.equal(b.hiddenByParent, undefined, 'b is hidden by its own switch');
  assert.equal(b.children[0].hiddenByParent, true); assert.equal(b.children[0].children[0].hiddenByParent, true);
  assert.equal(b.children[0].visible, true, 'the own switch is kept: showing b shows b1 again');
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(id => isMenuItemShown(rows, rows.find(r => r.id === id))), [true, true, false, false, false, false]);
  // showing the parent again restores the children's own state
  const back = buildMenuTree(rows.map(r => (r.id === 3 ? { ...r, visible: true } : r)));
  assert.deepEqual(back.find(n => n.name === 'b').children.map(n => n.name), ['b1']);
});

test('hub bar and fans count only enabled items (hidden items and their sub trees are not drawn)', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, parentId: null, ord: i, name: `r${i}`, label: `R${i}`, iconId: null, visible: i < 5 }));
  rows.push({ id: 20, parentId: 1, ord: 0, name: 'x', visible: true }, { id: 21, parentId: 6, ord: 0, name: 'y', visible: true });
  const svg = renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...HUB.config }, tree: buildMenuTree(rows), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.equal((svg.match(/data-hub-index="/g) || []).length, 5, '7 items, 2 disabled: an odd bar of 5');
  assert.doesNotMatch(svg, /data-item="y"|data-item="r5\/y"/, 'the sub item of a disabled item is not drawn anywhere');
  assert.match(svg, /data-item="r0\/x"/);
});

test('test runner: modal for buttons / screens (routes announced) and workflows (routes followed, back stack, this workflow only)', async () => {
  const { workflowStart } = await import('../interfaces/web/js/components/test-runner.js').catch(() => ({}));
  const src = readFileSync(new URL('../interfaces/web/js/components/test-runner.js', import.meta.url), 'utf8');
  const ta = readFileSync(new URL('../interfaces/web/js/components/designer-test-actions.js', import.meta.url), 'utf8');
  const wfd = readFileSync(new URL('../interfaces/web/js/components/workflow-designer.js', import.meta.url), 'utf8');
  const des = readFileSync(new URL('../interfaces/web/js/components/designer.js', import.meta.url), 'utf8');
  assert.match(src, /mode: isWf \? 'navigate' : 'notify'/);
  assert.match(src, /rec\.links = \(wf\.links \|\| \[\]\)\.filter\(l => l\.fromScreenId === rec\.id\)/);
  assert.match(ta, /if \(tr\?\.mode === 'notify'\) return toast\(/, 'design tests announce routes');
  assert.match(ta, /no target screen set/);
  assert.match(wfd, /openTestRunner\(this\.app, \{ type: 'workflow', id: this\.wf\.id \}\)/);
  assert.match(des, /this\.opts\.openTest \? this\.opts\.openTest\(this\.type, this\.doc\.id\)/);
  // entry screen of a workflow: one no link points to
  const start = workflowStart ?? (wf => { const ids = wf.nodes.map(n => n.screenId); const t = new Set(wf.links.map(l => l.toScreenId)); return ids.find(i => !t.has(i)) ?? ids[0]; });
  assert.equal(start({ nodes: [{ screenId: 2 }, { screenId: 1 }, { screenId: 3 }], links: [{ fromScreenId: 1, toScreenId: 2 }, { fromScreenId: 2, toScreenId: 3 }] }), 1);
});

test('extract as element: the shape, its sub tree and what lies inside it become a new element; the screen keeps its nodes', async () => {
  const { extractNodes } = await import('../domain/node-ops.js');
  const { nodeBBox } = await import('../domain/geometry.js');
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const scr = c.screen.create({ name: 'ex', key: 'ex-screen', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 390, height: 844 }, { nodes: [
      { tag: 'rect', role: 'bg', name: 'background', attrs: { x: 0, y: 0, width: 390, height: 844 } },
      { tag: 'rect', name: 'bar', attrs: { x: 20, y: 700, width: 350, height: 120, rx: 16 } },
      { tag: 'text', name: 'label', text: 'Hi', attrs: { x: 40, y: 740, 'font-size': 14 } },
      { tag: 'circle', name: 'dot', attrs: { cx: 300, cy: 760, r: 10 } },
      { tag: 'circle', name: 'outside', attrs: { cx: 100, cy: 100, r: 10 } }
    ] });
    const nodes = c.screen.get(scr.id).nodes, bar = nodes.find(n => n.name === 'bar');
    const ex = extractNodes(nodes, bar.id, n => nodeBBox(n, nodes));
    assert.deepEqual(ex.box, { x: 20, y: 700, w: 350, h: 120 });
    assert.equal(ex.nodes[0].name, 'content'); assert.equal(ex.nodes.length, 4);
    assert.ok(['bar', 'label', 'dot'].every(k => ex.nodes.some(n => n.name === k)), 'the bar and what is drawn inside it');
    assert.ok(!ex.nodes.some(n => n.name === 'outside' || n.name === 'background'));
    assert.equal(ex.nodes[0].attrs.transform, 'translate(-20 -700)');
    const el = c.element.create({ name: 'bar element', key: 'bar-element', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: ex.box.w, height: ex.box.h }, { nodes: ex.nodes });
    const stored = c.element.get(el.id).nodes;
    assert.equal(stored.length, 4); assert.equal(stored.filter(n => n.parentId == null).length, 1, 'one wrapper group at the top');
    assert.ok(stored.every(n => !nodes.some(o => o.id === n.id)), 'new node ids');
    assert.equal(c.screen.get(scr.id).nodes.length, 5, 'the screen is unchanged');
  } finally { c.close(); }
  const designerSrc = readFileSync(new URL('../interfaces/web/js/components/designer.js', import.meta.url), 'utf8');
  assert.match(designerSrc, /'data-act': 'extract-element'/);
  // the extracted element shows in the Elements library at once: marked edited (red, first), tab + scope filter follow it
  const body = designerSrc.slice(designerSrc.indexOf('async extractAsElement('), designerSrc.indexOf('async addInstance('));
  assert.match(body, /markEdited\('element', rec\.id\)/); assert.match(body, /state\.tab = 'element'/);
  assert.match(body, /revealInLibrary\(rec\)/); assert.match(body, /emit\('library:changed'\)/);
});
