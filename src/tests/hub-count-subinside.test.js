/** Hub menu: bar count (1-6, default 3) and "sub items stay inside the screen, centre fixed". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContainer } from '../composition-root.js';
import { DEFAULT_MENU } from '../domain/entities.js';
import { renderMenu, buildMenuTree, hubCount } from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { bindMenus } from '../domain/menu-runtime.js';

/** Tiny DOM: a hub button with `n` ring items; item 0 has `subs` sub items on a fan level. `screen` = device box in button units. */
function world({ n = 7, subs = 0, menuAttrs = {}, screen = null } = {}) {
  const mk = (attrs = {}) => {
    const el = { attrs: { ...attrs }, cls: new Set(), vars: {}, sel: {}, style: { setProperty: (k, v) => { el.vars[k] = String(v); }, getPropertyValue: k => el.vars[k] ?? '' },
      getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); }, removeAttribute: k => { delete el.attrs[k]; }, hasAttribute: k => k in el.attrs,
      classList: { toggle: (c, on) => (on ? el.cls.add(c) : el.cls.delete(c)) } };
    el.querySelectorAll = s => (typeof el.sel[s] === 'function' ? el.sel[s]() : el.sel[s]) || [];
    el.querySelector = s => el.querySelectorAll(s)[0] || null;
    return el;
  };
  const btn = mk({ 'data-menu': 'hub' });
  const menu = mk({ 'data-kind': 'hub', 'data-cx': '28', 'data-cy': '28', 'data-hub-small': '22', 'data-hub-big': '90', 'data-hub-gap': '11', 'data-hub-vertical': '0', 'data-keep': '1', ...menuAttrs });
  const pick = el => s => (s === '.ud-btn' ? btn : s === '[data-rm="center"], .rm-item' ? el : null);
  const items = Array.from({ length: n }, (_, i) => { const it = mk({ 'data-hub-index': i, 'data-item': `i${i}`, 'data-children': i === 0 && subs ? '1' : '0', 'data-action': `a${i}`, 'data-r': '45' }); it.closest = pick(it); return it; });
  const rootLevel = mk({ 'data-level': '' });
  const fan = mk({ 'data-level': 'i0', 'data-fan-r': '80', 'data-fan-start': '-160', 'data-fan-sweep': '140' });
  const fanItems = Array.from({ length: subs }, (_, i) => { const it = mk({ 'data-item': `i0/s${i}`, 'data-children': '0', 'data-action': `s${i}`, 'data-r': '20' }); it.parentNode = fan; it.closest = pick(it); return it; });
  fan.sel['.rm-item'] = fanItems;
  const centre = mk({ 'data-rm': 'center' }); centre.closest = pick(centre);
  btn.sel = {
    '.ud-menu': [menu], '.ud-menu[data-kind="hub"]': [menu], '.rm-level': [rootLevel, fan], '.rm-level[data-fan-r]': [fan],
    '.rm-level[data-level=""] .rm-hub-item': items,
    '.rm-level.is-active .rm-item': () => [...items, ...(fan.cls.has('is-active') ? fanItems : [])],
    '.rm-level.is-active:not([data-level=""]) .rm-item': () => (fan.cls.has('is-active') ? fanItems : [])
  };
  if (screen) {
    const id = { a: 1, inverse: () => id };
    btn.getScreenCTM = () => id;
    btn.getBoundingClientRect = () => ({ width: 56, height: 56 });
    btn.ownerSVGElement = { createSVGPoint: () => { const p = { x: 0, y: 0, matrixTransform: () => p }; return p; }, getBoundingClientRect: () => ({ left: screen.L, top: screen.T, right: screen.R, bottom: screen.B, width: screen.R - screen.L, height: screen.B - screen.T }) };
  }
  const root = mk({}); root.sel['.ud-btn'] = [btn];
  const handlers = {}; root.addEventListener = (type, fn) => { handlers[type] = fn; };
  root.ownerDocument = { addEventListener: () => {} };
  const actions = [];
  const ctl = bindMenus(root, { onAction: a => actions.push(a) });
  const click = t => handlers.click({ target: t, stopPropagation() {} });
  const pos = () => items.map(i => i.attrs['data-hub-pos']);
  const shown = () => fanItems.filter(i => i.attrs['data-fan-hidden'] !== '1');
  return { btn, menu, items, fanItems, centre, ctl, click, pos, shown, actions };
}
const num = v => parseFloat(v);

test('hub bar: data-hub-count picks how many buttons show (1-6); the rest are reached by turning the ring', () => {
  const w3 = world({ n: 7, menuAttrs: { 'data-hub-count': '3' } });
  assert.deepEqual(w3.pos(), ['center', 'next', 'hidden', 'hidden', 'hidden', 'hidden', 'prev']);
  w3.click(w3.items[1]);                                         // a side button turns the ring: the next item comes in
  assert.deepEqual(w3.pos(), ['prev', 'center', 'next', 'hidden', 'hidden', 'hidden', 'hidden']);
  assert.deepEqual(world({ n: 7, menuAttrs: { 'data-hub-count': '1' } }).pos(), ['center', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden']);
  assert.equal(world({ n: 7, menuAttrs: { 'data-hub-count': '4' } }).pos().filter(p => p !== 'hidden').length, 4);
  assert.equal(world({ n: 7, menuAttrs: { 'data-hub-count': '6' } }).pos().filter(p => p !== 'hidden').length, 6);
  assert.equal(world({ n: 2, menuAttrs: { 'data-hub-count': '5' } }).pos().filter(p => p !== 'hidden').length, 2, 'never more buttons than items');
  assert.equal(world({ n: 7 }).pos().filter(p => p !== 'hidden').length, 5, 'markup without the attribute keeps the old 5 / 6 bar');
});

test('hub config: hubCount default 3, validated 1-6, rendered; hubSubInside default on', () => {
  assert.equal(DEFAULT_MENU.hubCount, 3); assert.equal(DEFAULT_MENU.hubSubInside, true);
  assert.equal(hubCount({}), 3); assert.equal(hubCount({ hubCount: 6 }), 6); assert.equal(hubCount({ hubCount: 9 }), 3);
  const tree = buildMenuTree([{ id: 1, parentId: null, ord: 1, name: 'a', label: 'A' }, { id: 2, parentId: null, ord: 2, name: 'b', label: 'B' }]);
  const draw = cfg => renderMenu({ button: { key: 'k', width: 56, height: 56 }, cfg: { ...DEFAULT_MENU, kind: 'hub', ...cfg }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => null });
  assert.match(draw({}), /data-hub-count="3" data-sub-inside="1"/);
  assert.match(draw({ hubCount: 5, hubSubInside: false }), /data-hub-count="5" data-sub-inside="0"/);
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'hc', key: 'hc', width: 48, height: 48, projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub }, { nodes: [] });
    assert.equal(c.menus.setConfig(b.id, { kind: 'hub', hubCount: '4', hubSubInside: false }).hubCount, 4);
    assert.equal(c.menus.get(b.id).config?.hubSubInside ?? c.button.get(b.id).meta.menu.hubSubInside, false);
    assert.throws(() => c.menus.setConfig(b.id, { hubCount: 7 }), /hubCount/); assert.throws(() => c.menus.setConfig(b.id, { hubCount: 0 }), /hubCount/);
  } finally { c.close(); }
  const insp = readFileSync(new URL('../interfaces/web/js/components/inspector.js', import.meta.url), 'utf8');
  assert.match(insp, /mc-\$\{bid\}-hubcount/); assert.match(insp, /mc-\$\{bid\}-hubsubinside/);
});

test('hub sub items stay inside the screen around a fixed centre; the ones without room hide and the end items turn the ring', () => {
  // the button sits near the right edge of the screen: the right part of the designed fan (-160°..-20°) is outside
  const screen = { L: -300, R: 70, T: -300, B: 300 };
  const w = world({ n: 5, subs: 12, menuAttrs: { 'data-hub-count': '3', 'data-sub-inside': '1' }, screen });
  w.click(w.centre);                                             // the centre item's sub items fan out
  assert.equal(w.menu.vars['--sx'], '0px'); assert.equal(w.menu.vars['--sy'], '0px');
  const inside = el => { const r = 20 * num(el.vars['--fit'] || 1) * num(el.vars['--end'] || 1), x = num(el.vars['--x']), y = num(el.vars['--y']); return x - r >= screen.L && x + r <= screen.R && y - r >= screen.T && y + r <= screen.B; };
  const shown = w.shown();
  assert.ok(shown.length >= 3 && shown.length < 12, `a window of the 12 sub items (${shown.length})`);
  assert.ok(shown.every(inside), 'every drawn sub item is inside the device screen');
  for (const el of shown) assert.ok(Math.abs(Math.hypot(num(el.vars['--x']) - 28, num(el.vars['--y']) - 28) - 80) < 0.01, 'on the ring around the centre, which did not move');
  const [first, last] = [shown.find(e => e.attrs['data-fan-end'] === 'first'), shown.find(e => e.attrs['data-fan-end'] === 'last')];
  assert.equal(first, w.fanItems[0]); assert.ok(last); assert.equal(last.vars['--end'], '0.7');
  w.click(last);                                                 // turns the ring by one: no action, the hidden item comes in
  assert.equal(w.actions.filter(a => /^s/.test(a.action)).length, 0);
  assert.equal(w.fanItems[0].attrs['data-fan-hidden'], '1'); assert.equal(w.fanItems[shown.length].attrs['data-fan-hidden'], '0');
  let reached = new Set(w.shown());
  for (let i = 0; i < 12; i++) { w.click(w.shown().find(e => e.attrs['data-fan-end'] === 'last')); w.shown().forEach(e => reached.add(e)); }
  assert.equal(reached.size, 12, 'every sub item can be reached by turning');

  // room everywhere: the fan stays where it was designed and shows everything
  const free = world({ n: 5, subs: 5, menuAttrs: { 'data-hub-count': '3', 'data-sub-inside': '1' }, screen: { L: -400, R: 400, T: -400, B: 400 } });
  free.click(free.centre);
  assert.equal(free.shown().length, 5);
  const ang = el => Math.round(Math.atan2(num(el.vars['--y']) - 28, num(el.vars['--x']) - 28) * 180 / Math.PI);
  assert.deepEqual([ang(free.fanItems[0]), ang(free.fanItems[4])], [-160, -20]);

  // the option off: the level is left to the old "shift the whole menu" rule
  const off = world({ n: 5, subs: 5, menuAttrs: { 'data-hub-count': '3', 'data-sub-inside': '0' }, screen });
  off.click(off.centre);
  assert.equal(off.fanItems[0].vars['--x'], undefined, 'positions stay as rendered');
});

test('designer switch + session history + sync lock: wired', async () => {
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const ed = await import('../interfaces/web/js/edited.js');
  ed.setEditedSessionUser(7);
  ed.markEdited('screen', 11); ed.markEdited('button', 5); ed.markEdited('screen', 12); ed.rememberName('screen', 12, 'Home');
  assert.deepEqual(ed.sessionEdited('screen'), ['screen:12', 'screen:11']);
  assert.equal(ed.lastEdited('screen'), 12); assert.equal(ed.lastEdited('button'), 5); assert.equal(ed.lastEdited('path'), null);
  assert.equal(ed.editedName('screen', 12), 'Home');
  ed.setEditedSessionUser(8);
  assert.deepEqual(ed.sessionEdited(), [], 'another user starts with an empty session history');
  assert.equal(ed.lastEdited('screen'), 12, 'the remembered (red edge) marks still say what was edited last');
  ed.clearEdited();
  const designer = read('../interfaces/web/js/components/designer.js'), main = read('../interfaces/web/js/main.js'), collab = read('../interfaces/web/js/components/collab-modals.js');
  assert.match(designer, /typeSwitch\(\) \{/); assert.match(designer, /for \(const k of sessionEdited\(this\.type\)\)/);
  assert.match(main, /const last = lastEdited\(type\)/); assert.match(main, /openPage: t => openPageType\(t\)/);
  assert.equal((collab.match(/await withSyncProgress\(/g) || []).length, 3, 'the three sync buttons lock the page behind a progress bar');
  assert.match(read('../interfaces/web/css/app.css'), /\.sync-lock \{ position: fixed; inset: 0; z-index: 10000/);
});

test('hub icon size: hubIconSize sets the icon inside every hub button, up to the button itself (0 = automatic)', async () => {
  const { hubIconSize } = await import('../domain/menu.js');
  assert.equal(DEFAULT_MENU.hubIconSize, 0); assert.equal(hubIconSize({}), 0); assert.equal(hubIconSize({ hubIconSize: 3 }), 1); assert.equal(hubIconSize({ hubIconSize: 0.5 }), 0.5);
  const tree = buildMenuTree([{ id: 1, parentId: null, ord: 1, name: 'a', label: 'A', iconId: 9 }, { id: 2, parentId: 1, ord: 1, name: 'b', label: 'B', iconId: 9 }]);
  const widths = cfg => [...renderMenu({ button: { key: 'k', width: 50, height: 50 }, cfg: { ...DEFAULT_MENU, kind: 'hub', layout: 'fan', centerScale: 2, itemScale: 0.5, ...cfg }, tree, ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => 'star' }).matchAll(/<use href="#i-star"[^>]* width="([\d.]+)"/g)].map(m => Number(m[1]));
  const auto = widths({}), full = widths({ hubIconSize: 1 }), half = widths({ hubIconSize: 0.5 });
  assert.ok(auto.includes(62), 'automatic: 62 % of the 100 px centre button');
  assert.ok(full.includes(100) && full.includes(50), 'fills the centre button (100) and the sub item (50)');
  assert.ok(half.includes(50) && half.includes(25));
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'hi', key: 'hi', width: 48, height: 48, projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub }, { nodes: [] });
    assert.equal(c.menus.setConfig(b.id, { kind: 'hub', hubIconSize: '0.8' }).hubIconSize, 0.8);
    assert.throws(() => c.menus.setConfig(b.id, { hubIconSize: 1.5 }), /hubIconSize/);
  } finally { c.close(); }
  assert.match(readFileSync(new URL('../interfaces/web/js/components/inspector.js', import.meta.url), 'utf8'), /mc-\$\{bid\}-hubiconsize/);
});
