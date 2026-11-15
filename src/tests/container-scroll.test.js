/**
 * A plain scrollable container (Surface role "container"): children may overflow it along the axes it scrolls, and at run time
 * a wheel or a drag over it scrolls that content vertically and horizontally (clamped to the content).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBoxToContainer, containerScrollAxes } from '../domain/geometry.js';
import { bindRepeaterScroll } from '../domain/repeater.js';
import { renderTree, createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';

const cont = (extra = {}) => ({ id: 1, tag: 'rect', role: 'container', attrs: { x: 0, y: 0, width: 200, height: 100, 'data-inner-margin': 0, ...extra } });

test('a scrollable container lets its children overflow; an axis switched off limits the child size again', () => {
  assert.deepEqual(containerScrollAxes(cont()), { x: true, y: true }, 'both axes scroll by default');
  assert.deepEqual(containerScrollAxes(cont({ 'data-scroll-x': 'false' })), { x: false, y: true });
  assert.deepEqual(containerScrollAxes({ id: 2, tag: 'rect', role: 'carousel-container', attrs: {} }), { x: false, y: false }, 'carousels lay out their own items');
  assert.deepEqual(containerScrollAxes({ id: 3, tag: 'rect', role: 'repeater-container', attrs: {} }), { x: false, y: false }, 'repeaters too');

  const big = { x: -10, y: 20, w: 600, h: 400 };
  assert.deepEqual(clampBoxToContainer(big, cont(), [cont()]), { x: 0, y: 20, w: 600, h: 400 }, 'kept whole, only moved to start inside');
  const fixed = cont({ 'data-scroll-x': 'false', 'data-scroll-y': 'false' });
  assert.deepEqual(clampBoxToContainer(big, fixed, [fixed]), { x: 0, y: 0, w: 200, h: 100 }, 'no scrolling: clamped as before');
  const vOnly = cont({ 'data-scroll-x': 'false' });
  assert.deepEqual(clampBoxToContainer(big, vOnly, [vOnly]), { x: 0, y: 20, w: 200, h: 400 }, 'vertical only: the width is limited');
});

test('the container markup carries the clip and the scroll axes the runtime reads', () => {
  const nodes = [cont({ 'data-scroll-x': 'false' }), { id: 2, parentId: 1, tag: 'rect', attrs: { x: 0, y: 0, width: 150, height: 300 } }];
  const svg = renderTree(nodes, createContext({ theme: BUILTIN_THEMES[0] }));
  assert.match(svg, /data-container-children="1" data-scroll-x="0" data-scroll-y="1"/);
  assert.match(svg, /clip-path="url\(#ud-clip-cont-1\)"/);
});

/** A container group (clip 0 0 200 100) holding content of `content` size, in a host scaled 1× at (0, 0). */
function fakeContainer(content, { sx = '1', sy = '1', bind = r => bindRepeaterScroll(r) } = {}) {
  let transform = null;
  const inner = { getAttribute: k => (k === 'data-scroll-inner' ? '1' : k === 'transform' ? transform : null),
    setAttribute: (k, v) => { if (k === 'transform') transform = v; }, removeAttribute: k => { if (k === 'transform') transform = null; },
    getBBox: () => ({ x: 0, y: 0, width: content.w, height: content.h }) };
  const rect = { getAttribute: k => ({ x: '0', y: '0', width: '200', height: '100' })[k] };
  const doc = { getElementById: id => (id === 'clip' ? { querySelector: () => rect } : null) };
  const g = { firstElementChild: inner, childElementCount: 1, ownerDocument: doc,
    getAttribute: k => ({ 'clip-path': 'url(#clip)', 'data-container-children': '1', 'data-scroll-x': sx, 'data-scroll-y': sy })[k] ?? null,
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
  const handlers = {};
  const root = { ownerDocument: doc, addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
    querySelectorAll: sel => (sel === '[data-container-children]' ? [g] : []) };
  const fire = (type, ev) => {
    const e = { button: 0, deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 50, clientY: 50, target: null, prevented: false, ...ev,
      preventDefault() { this.prevented = true; }, stopPropagation() {} };
    for (const fn of handlers[type] || []) fn(e);
    return e;
  };
  bind(root);
  return { fire, offset: () => transform };
}

test('wheel and drag scroll an overflowing container on both axes, clamped to its content', () => {
  const s = fakeContainer({ w: 500, h: 300 });   // overflow: 300 sideways, 200 down
  assert.ok(s.fire('wheel', { deltaY: 120 }).prevented);
  assert.equal(s.offset(), 'translate(0 -120)');
  s.fire('wheel', { deltaY: 500 });
  assert.equal(s.offset(), 'translate(0 -200)', 'stops at the end of the content');
  s.fire('wheel', { deltaX: 90 });
  assert.equal(s.offset(), 'translate(-90 -200)', 'horizontal keeps the vertical offset');
  s.fire('wheel', { deltaY: 40, shiftKey: true });
  assert.equal(s.offset(), 'translate(-130 -200)', 'shift + wheel scrolls sideways');
  // drag: content follows the pointer (drag up-left = scroll down-right… here back towards the start)
  s.fire('pointerdown', { clientX: 50, clientY: 50 });
  s.fire('pointermove', { clientX: 80, clientY: 110 });
  s.fire('pointerup', {});
  assert.equal(s.offset(), 'translate(-100 -140)');
  assert.ok(!s.fire('wheel', { clientX: 400, clientY: 400, deltaY: 50 }).prevented, 'outside the container: left alone');
});

test('a container whose content fits, or a horizontal-only one, scrolls correctly', () => {
  const fits = fakeContainer({ w: 150, h: 80 });
  assert.ok(!fits.fire('wheel', { deltaY: 100 }).prevented, 'nothing to scroll: the page keeps the wheel');
  assert.equal(fits.offset(), null);
  const row = fakeContainer({ w: 600, h: 300 }, { sy: '0' });
  row.fire('wheel', { deltaY: 70 });
  assert.equal(row.offset(), 'translate(-70 0)', 'only sideways to go: the plain wheel scrolls sideways');
});

test('a placed library element with the container role clips its own content to its box and scrolls it', async () => {
  const { indexLibrary } = await import('../domain/svg.js');
  const el = { id: 40, key: 'policy-scroll', width: 300, height: 200,
    nodes: [{ id: 401, kind: 'shape', tag: 'text', text: 'long policy', parentId: null, ord: 0, attrs: { x: 10, y: 20 } },
      { id: 402, kind: 'shape', tag: 'text', text: 'far below', parentId: null, ord: 1, attrs: { x: 10, y: 480 } }] };
  const lib = indexLibrary({ elements: [el] });
  const placed = { id: 7, kind: 'instance', tag: 'use', refType: 'element', refId: 40, role: 'container', name: 'policy', parentId: null, ord: 0, visible: true,
    attrs: { x: 16, y: 100, width: 300, height: 200, 'data-scroll-x': 'false' } };
  const svg = renderTree([placed], createContext({ theme: BUILTIN_THEMES[0], lib, editor: true }));
  assert.match(svg, /<clipPath id="ud-clip-inst-7-\d+"><rect x="0" y="0" width="300" height="200"\/><\/clipPath>/);
  assert.match(svg, /data-container-children="7" data-scroll-x="0" data-scroll-y="1"[^>]*>.*far below/);
  // without the container role the element is drawn as before (no clip)
  const plain = renderTree([{ ...placed, role: null }], createContext({ theme: BUILTIN_THEMES[0], lib, editor: true }));
  assert.equal(plain.includes('data-container-children'), false);
});

test('the designer\'s edit mode: the wheel scrolls a container (Ctrl + wheel left to the zoom), drag stays off', () => {
  const s = fakeContainer({ w: 200, h: 300 }, { bind: r => bindRepeaterScroll(r, () => false, { wheel: ev => !ev.ctrlKey }) });
  assert.ok(s.fire('wheel', { deltaY: 60 }).prevented);
  assert.equal(s.offset(), 'translate(0 -60)');
  assert.ok(!s.fire('wheel', { deltaY: 60, ctrlKey: true }).prevented, 'Ctrl + wheel zooms the canvas');
  s.fire('pointerdown', { clientX: 50, clientY: 50 }); s.fire('pointermove', { clientX: 50, clientY: 10 }); s.fire('pointerup', {});
  assert.equal(s.offset(), 'translate(0 -60)', 'a drag moves elements in edit mode, it never scrolls');
  const off = fakeContainer({ w: 200, h: 300 }, { bind: r => bindRepeaterScroll(r, () => false) });
  assert.ok(!off.fire('wheel', { deltaY: 60 }).prevented, 'without opts.wheel nothing scrolls while off');
});
