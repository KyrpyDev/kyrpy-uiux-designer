import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTokens, BUILTIN_THEMES, buildThemeDefs, roleAttrs } from '../domain/theme.js';
import { nodeBBox, translateAttrs, resizeAttrs, placeAtAnchor, snap } from '../domain/geometry.js';
import { compileKeyframes, animationsToCss, defaultAnimation } from '../domain/animation.js';
import { createContext, renderTree, suffixIds, attrString } from '../domain/svg.js';
import { slugify, isValidKey, uniqueKey } from '../domain/naming.js';
import { normalizeDesign, normalizeNode } from '../domain/entities.js';
import { ValidationError } from '../domain/errors.js';

test('tokens resolve, including line-size ratios of the global value', () => {
  const t = { sw: 2, accent: '#fff' };
  assert.equal(resolveTokens('{{accent}}', t), '#fff');
  assert.equal(resolveTokens('{{sw*0.5}}', t), '1');
  assert.equal(resolveTokens('{{missing}}', t), '');
  assert.equal(resolveTokens('plain', t), 'plain');
});

test('every built-in theme defines the same paint/filter ids', () => {
  const ids = th => [...buildThemeDefs(th).matchAll(/ id="([^"]+)"/g)].map(m => m[1]).sort().join(',');
  const ref = ids(BUILTIN_THEMES[0]);
  for (const th of BUILTIN_THEMES) assert.equal(ids(th), ref, th.key);
});

test('theme surface roles restyle one stored element per theme', () => {
  const el = { id: 1, tag: 'rect', role: 'card', visible: true, attrs: { x: 0, y: 0, width: 10, height: 10 } };
  const out = {};
  for (const th of BUILTIN_THEMES) out[th.key] = renderTree([el], createContext({ theme: th }));
  assert.match(out.liquid, /fill="url\(#gFill\)"/);
  assert.match(out['neu-light'], /filter="url\(#neuOut\)"/);
  assert.match(out.glow, /filter="url\(#lineGlow\)"/);
  assert.equal(roleAttrs(BUILTIN_THEMES[2], 'shine').display, 'none');
});

test('geometry: bbox, move, resize, anchors, snap', () => {
  const r = { tag: 'rect', attrs: { x: 10, y: 20, width: 30, height: 40 } };
  assert.deepEqual(nodeBBox(r), { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(translateAttrs(r, 5, -5).x, 15);
  const big = resizeAttrs(r, nodeBBox(r), { x: 0, y: 0, w: 60, h: 80 });
  assert.equal(big.width, 60);
  const p = { tag: 'path', attrs: { d: 'M2 2h10v10H2z' } };
  assert.deepEqual(nodeBBox(p), { x: 2, y: 2, w: 10, h: 10 });
  const moved = translateAttrs(p, 4, 4); // path moves through a transform
  assert.match(moved.transform, /translate\(4 4\)/);
  assert.deepEqual(placeAtAnchor({ w: 10, h: 10 }, { w: 100, h: 200 }, 'br', 5), { x: 85, y: 185 });
  assert.equal(snap(37, 24), 48);
});

test('animations compile to css keyframes with triggers', () => {
  const a = { ...defaultAnimation('rotate'), id: 7, nodeId: 3, params: { from: 0, to: 360 } };
  assert.match(compileKeyframes(a)[1].props.transform, /rotate\(360deg\)/);
  const css = animationsToCss([a, { ...a, id: 8, trigger: 'hover' }]);
  assert.match(css, /@keyframes ud-k7/);
  assert.match(css, /\.ud-e3:hover\{animation:/);
});

test('renderer refuses unsafe markup (event handlers, odd tags, external hrefs)', () => {
  const th = BUILTIN_THEMES[0];
  const els = [
    { id: 1, tag: 'rect', visible: true, attrs: { x: 0, onclick: 'alert(1)', 'bad name': 1, href: 'javascript:alert(1)' } },
    { id: 2, tag: 'script', visible: true, attrs: {} },
    { id: 3, tag: 'text', visible: true, text: '<img src=x onerror=alert(1)>', attrs: { x: 0, y: 0 } }
  ];
  const svg = renderTree(els, createContext({ theme: th }));
  assert.ok(!/onclick|script|javascript:|bad name/.test(svg));
  assert.ok(!svg.includes('<img'));
  assert.equal(attrString({ onload: 'x', fill: 'red' }), ' fill="red"');
});

test('suffixIds makes themed copies coexist in one page', () => {
  const s = suffixIds('<svg><defs><linearGradient id="lgS"/></defs><rect fill="url(#lgS)"/><use href="#lgS"/></svg>', 'dark');
  assert.match(s, /id="lgS-dark"/); assert.match(s, /url\(#lgS-dark\)/); assert.match(s, /href="#lgS-dark"/);
});

test('naming and entity validation', () => {
  assert.equal(slugify('Sign In  Form!'), 'sign-in-form');
  assert.ok(isValidKey('a-b-1')); assert.ok(!isValidKey('A b'));
  assert.equal(uniqueKey('x', k => k === 'x'), 'x-2');
  assert.throws(() => normalizeDesign('icon', { name: '' }), ValidationError);
  assert.throws(() => normalizeDesign('icon', { name: 'x', key: 'Bad Key' }), ValidationError);
  assert.equal(normalizeDesign('screen', { name: 'S', meta: { device: 'tablet' } }).width, 768);
  assert.throws(() => normalizeNode({ tag: 'iframe' }), ValidationError);
  assert.throws(() => normalizeNode({ tag: 'use', refType: 'icon' }), ValidationError);
});
