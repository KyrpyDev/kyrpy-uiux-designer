import test from 'node:test';
import assert from 'node:assert/strict';
import { pressSlideConfig, pressSlideDirs, pressSlideSpec, defaultPressSlide, PRESS_SLIDE_PATH_KEYS } from '../domain/press-slide.js';
import { createContext, renderDocument, indexLibrary } from '../domain/svg.js';
import { bindMenus } from '../domain/menu-runtime.js';

const theme = { key: 't', tokens: { sw: 2, bg: '#000' }, roles: {} };

test('press & slide config: off -> null, defaults u scroll-up / d scroll-down / l back / r enter, bad values dropped', () => {
  assert.equal(pressSlideConfig({}), null);
  assert.equal(pressSlideConfig({ pressSlide: { on: false } }), null);
  assert.equal(pressSlideConfig({ pressSlide: { on: false } }, { all: true }).on, false);
  const c = pressSlideConfig({ pressSlide: { on: true, holdMs: 99999, l: { action: 'bogus' }, r: { on: false } } });
  assert.equal(c.holdMs, 5000);
  assert.deepEqual([c.u.action, c.d.action, c.l.action, c.r.action], ['scroll-up', 'scroll-down', 'back', 'enter']);
  assert.deepEqual(pressSlideDirs(c), ['u', 'd', 'l']);
  assert.equal(pressSlideSpec(defaultPressSlide()), 'u:scroll-up;d:scroll-down;l:back;r:enter');
  assert.equal(pressSlideConfig({ pressSlide: { on: true } }).holdMs, 1000);
});

const button = (meta, nodes) => ({ id: 9, key: 'joy', width: 48, height: 48, meta,
  nodes: nodes || [{ id: 1, kind: 'shape', tag: 'circle', parentId: null, ord: 0, attrs: { cx: 24, cy: 24, r: 24 } },
    { id: 2, kind: 'instance', tag: 'use', refType: 'icon', refId: 5, parentId: null, ord: 1, attrs: { x: 12, y: 12, width: 24, height: 24 } }] });
const paths = Object.entries(PRESS_SLIDE_PATH_KEYS).map(([k, key], i) => ({ id: 100 + i, key, width: 24, height: 24,
  nodes: [{ id: 500 + i, kind: 'shape', tag: 'line', name: `chev-${k}`, parentId: null, ord: 0, attrs: { x1: 6, y1: 3, x2: 12, y2: 1 } }] }));
const render = (b, extraPaths = paths) => {
  const lib = indexLibrary({ buttons: [b], paths: extraPaths, icons: [{ id: 5, key: 'ic', width: 24, height: 24, nodes: [] }] });
  const ctx = createContext({ theme, lib, editor: true });
  const nodes = [{ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId: 9, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: 48, height: 48 } }];
  return renderDocument({ owner: b, nodes, ctx });
};

test('a press & slide button carries the runtime contract and draws each enabled direction path over its icon', () => {
  const svg = render(button({ pressSlide: { on: true, d: { on: false } } }));
  assert.match(svg, /class="ud-ps"[^>]*data-press-slide="u:scroll-up;l:back;r:enter"[^>]*data-ps-hold="1000"/);
  assert.match(svg, /<g class="ud-ps-body">/);
  assert.match(svg, /class="ud-ps-dir" data-dir="u" transform="translate\(0 0\) scale\(2 2\)"/);
  assert.doesNotMatch(svg, /class="ud-ps-dir" data-dir="d"/);
  assert.match(svg, /class="ud-ps-dir" data-dir="r"/);
  // the overlay comes from the library paths, never selectable on the canvas (no node ids)
  assert.match(svg, /<line[^>]*x1="6"/);
  assert.doesNotMatch(svg, /data-el="50\d"/);
  assert.match(svg, /class="ud-ps-overlay" pointer-events="none"[^>]*stroke-width="1"[^>]*style="--ps-sw:1"/);   // icon 24 in a 48 box: half the line
  assert.match(svg, /ud-ps-ring/);
  assert.match(svg, /\.ud-ps\[data-ps-state="armed"\]/);   // the joystick CSS is in the document
});

test('press & slide off: no overlay, no contract, no CSS; missing paths fall back to chevrons', () => {
  const off = render(button({}));
  assert.doesNotMatch(off, /ud-ps/);
  const fb = render(button({ pressSlide: { on: true } }), []);
  assert.match(fb, /data-dir="l"[^>]*><path d="M3 6 L1 12 L3 18"\/>/);
  // the arrows always snap to the button's edges, with or without an icon
  const noIcon = render(button({ pressSlide: { on: true } }, [{ id: 1, kind: 'shape', tag: 'rect', parentId: null, ord: 0, attrs: { width: 48, height: 48 } }]));
  assert.match(noIcon, /data-dir="u" transform="translate\(0 0\) scale\(2 2\)"/);
});

test('the menu runtime with press & slide stays self-contained (it is embedded verbatim into exports)', () => {
  const src = bindMenus.toString();
  assert.doesNotThrow(() => new Function(`return ${src}`));
  assert.match(src, /ud-ps\[data-press-slide\]/);
  assert.doesNotMatch(src, /=>|\blet\b|\bconst\b/);
});

import { RenderService } from '../application/render-service.js';
test('server render (exports, previews): a press & slide button pulls the public direction paths into its render', () => {
  const btn = { id: 9, key: 'joy', name: 'joy', width: 48, height: 48, meta: { pressSlide: { on: true, l: { on: false } } } };
  const pathRows = paths.map(p => ({ id: p.id, key: p.key, width: 24, height: 24 }));
  const repo = rows => ({ get: id => rows.find(r => r.id === Number(id)) || null, getByKey: key => rows.find(r => r.key === key) || null });
  const nodesBy = { button: { 9: [{ id: 1, kind: 'shape', tag: 'circle', parentId: null, ord: 0, attrs: { cx: 24, cy: 24, r: 24 } }] }, path: Object.fromEntries(paths.map(p => [p.id, p.nodes])) };
  const svc = new RenderService({
    designs: { button: repo([btn]), path: repo(pathRows), icon: repo([]), element: repo([]), screen: repo([]) },
    nodes: { listByOwner: (t, id) => nodesBy[t]?.[id] || [] },
    animations: { listAll: () => [] }, themes: { getByKey: () => theme, list: () => [theme] }, menus: { list: () => [] }
  });
  const svg = svc.boxSvg('button', 9, 't');
  assert.match(svg, /data-press-slide="u:scroll-up;d:scroll-down;r:enter"/);
  assert.match(svg, /class="ud-ps-dir" data-dir="u"[^>]*><line/);   // the library path, not the fallback chevron
  assert.doesNotMatch(svg, /class="ud-ps-dir" data-dir="l"/);
});

import { normalizeItemPressSlide, itemPressSlide } from '../domain/menu.js';
test('menu items: press & slide is per item; a button with menu items ignores the button-wide setting', () => {
  assert.deepEqual(Object.keys(normalizeItemPressSlide({ 7: { on: true }, 8: { on: false }, x: { on: true } })), ['7']);
  assert.equal(itemPressSlide({ itemPressSlide: { 7: { on: true, l: { on: false } } } }, 7).l.on, false);
  assert.equal(itemPressSlide({}, 7), null);
  const b = { ...button({ pressSlide: { on: true }, menu: { kind: 'hub', itemPressSlide: { 2: { on: true, d: { on: false } } } } }) };
  const items = [{ id: 1, name: 'a', label: 'A', ord: 0, iconId: 5, parentId: null }, { id: 2, name: 'b', label: 'B', ord: 1, iconId: 5, parentId: null }, { id: 3, name: 'c', label: 'C', ord: 2, iconId: 5, parentId: null }];
  const lib = indexLibrary({ buttons: [b], paths, icons: [{ id: 5, key: 'ic', width: 24, height: 24, nodes: [] }] }, new Map([[9, items]]));
  const ctx = createContext({ theme, lib });
  const svg = renderDocument({ owner: b, nodes: [{ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId: 9, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: 48, height: 48 } }], ctx });
  // the host button is not a joystick; only item "b" is, with its own directions and paths
  assert.doesNotMatch(svg, /class="ud-btn[^"]*ud-ps/);
  assert.match(svg, /class="rm-item rm-hub-item ud-ps" data-item="b"[^>]*data-press-slide="u:scroll-up;l:back;r:enter"/);
  assert.doesNotMatch(svg, /class="rm-item rm-hub-item ud-ps" data-item="[ac]"/);
  assert.equal((svg.match(/class="ud-ps-overlay"/g) || []).length, 1);
  assert.match(svg, /data-item="b"[\s\S]*?<g class="ud-ps-body">[\s\S]*?class="ud-ps-dir" data-dir="u"/);
});

test('press & slide scroll target: auto by default, the button\'s element, overridden by the placed button on a screen', () => {
  assert.equal(pressSlideConfig({ pressSlide: { on: true } }).target, '');
  assert.equal(pressSlideConfig({ pressSlide: { on: true, target: 'auto' } }).target, '');
  assert.equal(pressSlideConfig({ pressSlide: { on: true, target: '42"><x' } }).target, '');   // only plain ids
  assert.equal(pressSlideConfig({ pressSlide: { on: true, target: 42 } }).target, '42');
  // auto: no target attribute (the runtime picks the first repeater, else the first scrollable container)
  assert.doesNotMatch(render(button({ pressSlide: { on: true } })), /data-target-repeater/);
  assert.match(render(button({ pressSlide: { on: true, target: '42' } })), /class="ud-ps"[^>]*data-target-repeater="42"/);
  const b = button({ pressSlide: { on: true, target: '42' } });
  const lib = indexLibrary({ buttons: [b], paths, icons: [{ id: 5, key: 'ic', width: 24, height: 24, nodes: [] }] });
  const nodes = [{ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId: 9, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: 48, height: 48, 'data-ps-target': '7001' } }];
  assert.match(renderDocument({ owner: b, nodes, ctx: createContext({ theme, lib, editor: true }) }), /data-target-repeater="7001"/);
});

test('press & slide "Open / go to": a picked screen / element rides on the runtime contract; other actions drop it', () => {
  const c = pressSlideConfig({ pressSlide: { on: true, r: { action: 'enter', target: 's-190' }, l: { action: 'back', target: 's-5' }, u: { action: 'enter', target: 'x-1' } } });
  assert.equal(c.r.target, 's-190');
  assert.equal(c.l.target, '');   // only "Open / go to" keeps a target
  assert.equal(c.u.target, '');   // bad ids dropped
  assert.equal(pressSlideSpec(c), 'u:enter;d:scroll-down;l:back;r:enter@s-190');
  assert.match(render(button({ pressSlide: { on: true, r: { action: 'enter', target: 'e-12' } } })), /data-press-slide="[^"]*r:enter@e-12"/);
});

test('menu items: the press & slide arrows size is separate from the icon size (0 = auto, clamped 0.5 … 1.6)', async () => {
  const { psArrowSize, hubIconSize } = await import('../domain/menu.js');
  assert.equal(psArrowSize({}), 1);
  assert.equal(psArrowSize({ psArrowSize: 0 }), 1);
  assert.equal(psArrowSize({ psArrowSize: 1.3 }), 1.3);
  assert.equal(psArrowSize({ psArrowSize: 9 }), 1.6);
  assert.equal(psArrowSize({ psArrowSize: 0.1 }), 0.5);
  assert.equal(hubIconSize({ hubIconSize: 0.4 }), 0.4);
});
