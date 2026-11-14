import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMenu, buildMenuTree, normalizeItemScroll, hasItemScroll, menuConfig } from '../domain/menu.js';

const ctx = { theme: { tokens: {} }, editor: false };
const rows = [{ id: 1, name: 'scan', ord: 0, targetElementId: 7 }, { id: 2, name: 'search', ord: 1 }];
const render = cfg => renderMenu({ button: { width: 100, height: 100 }, cfg: menuConfig({ menu: { kind: 'hub', ...cfg } }), tree: buildMenuTree(rows), ctx, iconKey: null });

test('normalizeItemScroll keeps only numeric item ids and sanitises the target', () => {
  assert.deepEqual(normalizeItemScroll({ 1: { on: '1', targetId: 'n-5"x' }, bad: { on: true }, 2: { on: false } }), { 1: { on: true, targetId: 'n-5x', mode: 'focus' }, 2: { on: false, targetId: null, mode: 'focus' } });
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

import { normalizeItemGestures } from '../domain/menu.js';
test('menu item gestures: long press / double tap actions are normalised and rendered on the item, slide focus mode too', () => {
  assert.deepEqual(normalizeItemGestures({ 1: { long: { type: 'popup', target: '7"x' }, dbl: { type: 'focused', target: 'zz' } }, 2: { long: { type: 'bogus' } }, x: {} }),
    { 1: { long: { type: 'popup', target: '7x' }, dbl: { type: 'focused', target: null } } });
  assert.equal(normalizeItemScroll({ 1: { on: true, mode: 'focus' } })[1].mode, 'focus');
  const svg = render({ itemScroll: { 1: { on: true, targetId: 'c9', mode: 'focus' } }, itemGestures: { 1: { long: { type: 'screen', target: '5' }, dbl: { type: 'focused', target: null } } } });
  assert.match(svg, /data-item="scan"[^>]*data-item-scroll="1" data-item-scroll-mode="focus" data-target-repeater="c9" data-gest-long="screen:5" data-gest-dbl="focused"/);
});

test('open the focused item: its own target, or a screen / popup chosen for it', async () => {
  const { normalizeItemGestures } = await import('../domain/menu.js');
  const g = normalizeItemGestures({ 4: { long: { type: 'focused', target: 's-12' }, dbl: { type: 'focused', target: 'e-7' } }, 5: { dbl: { type: 'focused', target: 'bad' } } });
  assert.deepEqual(g['4'], { long: { type: 'focused', target: 's-12' }, dbl: { type: 'focused', target: 'e-7' } });
  assert.equal(g['5'].dbl.target, null);
});

test('menu item dialog: gestures are Nothing / open the focused item, with a screen / popup browser button; no ghost toolbar', () => {
  const src = fs.readFileSync(new URL('../interfaces/web/js/components/menu-editor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'Same as a click'/);
  assert.match(src, /mi-gest-\$\{key\}-pick/);
  assert.match(src, /rm-toolbar-close/);
  assert.doesNotMatch(src, /if \(!this\.active \|\| ev\.target\.closest\?\.\('\.rm-item/);
});

test('a project-prefixed scroll-repeater action is read back as the built-in scroll-repeater', async () => {
  const { menuItemAction, normalizeMenuItem } = await import('../domain/entities.js');
  assert.equal(menuItemAction('untrap-scroll-repeater'), 'scroll-repeater');
  assert.equal(menuItemAction(' scroll-repeater '), 'scroll-repeater');
  assert.equal(menuItemAction('open-camera-scan'), 'open-camera-scan');
  assert.equal(menuItemAction('a-b-scroll-repeater'), 'a-b-scroll-repeater');   // only a single prefix word is dropped
  assert.equal(normalizeMenuItem({ action: 'untrap-scroll-repeater' }, { partial: true }).action, 'scroll-repeater');
  const tree = buildMenuTree([{ id: 9, name: 'home', ord: 0, action: 'untrap-scroll-repeater' }]);
  assert.equal(tree[0].action, 'scroll-repeater');
});

test('"Press and Scroll Items" (scroll-repeater) slides by itself, also with its slide box off; a tap steps the list', () => {
  const rows2 = [{ id: 1, name: 'scan', ord: 0, action: 'scroll-repeater' }, { id: 2, name: 'search', ord: 1 }];
  const svg = renderMenu({ button: { width: 100, height: 100 }, cfg: menuConfig({ menu: { kind: 'hub', itemScroll: { 1: { on: false, targetId: 'c4', mode: 'scroll' }, 2: { on: false } } } }), tree: buildMenuTree(rows2), ctx, iconKey: null });
  assert.match(svg, /data-item="scan"[^>]*data-item-scroll="1" data-target-repeater="c4"/, 'the action keeps the chosen container and mode');
  assert.match(svg, /data-item="search"[^>]*data-item-scroll="0"/);
  const rt = fs.readFileSync(new URL('../domain/menu-runtime.js', import.meta.url), 'utf8');
  assert.match(rt, /getAttribute\('data-action'\) === 'scroll-repeater'\) \{\s*try \{ var rs = findRepeaterStage\(btn, el\); if \(rs\) stepFocus\(rs, 1\); \}/);
  const ed = fs.readFileSync(new URL('../interfaces/web/js/components/menu-editor.js', import.meta.url), 'utf8');
  assert.match(ed, /'⟳ Press and Scroll Items'/);
  assert.match(ed, /When pressed and slid \(screen, popup or repeater\)/);
});

test('press & slide starts at once, never turns into a native drag, and the red frame is always on (runtime only in the designer)', () => {
  const rt = fs.readFileSync(new URL('../domain/menu-runtime.js', import.meta.url), 'utf8');
  assert.match(rt, /var SLIDE_HOLD_MS = 0;/);
  assert.match(rt, /No text selection \/ native drag may start from this press[^\n]*\n\s*if \(ev\.preventDefault\) ev\.preventDefault\(\);/);
  assert.match(rt, /addEventListener\('dragstart', function \(ev\) \{ if \(rptDrag\) ev\.preventDefault\(\); \}\)/);
  assert.match(rt, /function ensureFocusRings\(\)/);
  assert.match(rt, /if \(centreItemEnabled\(\)\) \{ ensureFocusRings\(\); return; \}/);
  assert.match(rt, /var nx = \(\(cur \+ dir\) % items\.length \+ items\.length\) % items\.length;/, 'the focus loops endlessly');
  const ed = fs.readFileSync(new URL('../interfaces/web/js/components/menu-editor.js', import.meta.url), 'utf8');
  assert.match(ed, /focusRings: \(\) => !!\(this\.d\.actionsLive \|\| this\.d\.menuLive\)/);
  const insp = fs.readFileSync(new URL('../interfaces/web/js/components/inspector.js', import.meta.url), 'utf8');
  assert.match(insp, /if \(sel\.length\) root\.append\(h\('hr', \{ class: 'insp-divider'[^\n]*#EF4444/);
});
