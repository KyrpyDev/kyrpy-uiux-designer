/**
 * Repeater container (pure, isomorphic). A repeater is a container node whose single child is a template;
 * at render time the template is drawn `itemCount` times, laid out and animated by `layout` / `dimension`.
 * The copies are never stored as nodes.
 *
 * Settings live in the container node's attrs (all `data-repeater-*`, see REPEATER_ATTR):
 *   layout     vertical | horizontal | carousel | roll | slide | scroll
 *   dimension  2d | 3d
 *   itemCount  1..50 (default 5)       gap        px between items (default 12)
 *   itemWidth / itemHeight             slot size (0 / empty = the template's own bbox)
 *   speed      ms per item (default 1800)   autoplay  true | false
 *   perspective px (3d, default 800)       direction vertical | horizontal (scroll and slide axis)
 *
 * `repeaterPlan` and `repeaterMarkup` are self-contained (no outer references except repeaterPlan) so the exported
 * HTML runtime can embed them with Function.prototype.toString(), like the menu runtime.
 */
import { nodeBBox, resizeAttrs } from './geometry.js';

export const REPEATER_KEY = 'html-repeater';
export const REPEATER_LAYOUTS = ['vertical', 'horizontal', 'carousel', 'roll', 'slide', 'scroll'];
export const REPEATER_DIMENSIONS = ['2d', '3d'];
export const REPEATER_MAX_ITEMS = 50;
export const REPEATER_ATTR = {
  layout: 'data-repeater-layout', dimension: 'data-repeater-dim', itemCount: 'data-repeater-count', gap: 'data-repeater-gap',
  itemWidth: 'data-repeater-item-width', itemHeight: 'data-repeater-item-height', speed: 'data-repeater-speed',
  autoplay: 'data-repeater-autoplay', perspective: 'data-repeater-perspective', direction: 'data-repeater-direction'
};
export const REPEATER_DEFAULTS = { layout: 'vertical', dimension: '2d', itemCount: 5, gap: 12, itemWidth: 0, itemHeight: 0, speed: 1800, autoplay: true, perspective: 800, direction: 'vertical' };

/** Default attrs of a freshly placed repeater container. */
export function repeaterDefaultAttrs(overrides = {}) {
  const c = { ...REPEATER_DEFAULTS, ...overrides };
  return {
    'data-container': 'repeater', 'data-size-mode': 'responsive', 'data-outer-margin': 16, 'data-inner-margin': 12,
    [REPEATER_ATTR.layout]: c.layout, [REPEATER_ATTR.dimension]: c.dimension, [REPEATER_ATTR.itemCount]: c.itemCount,
    [REPEATER_ATTR.gap]: c.gap, [REPEATER_ATTR.speed]: c.speed, [REPEATER_ATTR.autoplay]: c.autoplay ? 'true' : 'false',
    [REPEATER_ATTR.perspective]: c.perspective, [REPEATER_ATTR.direction]: c.direction
  };
}

const lookup = (lib, id) => (!lib ? null : typeof lib.get === 'function' ? lib.get(id) : Array.isArray(lib) ? lib.find(x => x.id === id) : null);

/** True for a repeater container: data-container="repeater", role "repeater-container" or an instance of the html-repeater element. */
export function isRepeaterNode(el, libElements = null) {
  if (!el) return false;
  if (el.role === 'repeater-container' || el.attrs?.['data-container'] === 'repeater') return true;
  if (el.kind === 'instance' && el.refType === 'element') {
    const t = lookup(libElements, el.refId);
    if (t && (t.key === REPEATER_KEY || t.meta?.containerType === 'repeater')) return true;
  }
  return false;
}

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Normalized repeater settings from a node's attrs. */
export function repeaterConfig(el) {
  const a = el?.attrs || {}, A = REPEATER_ATTR, D = REPEATER_DEFAULTS;
  const layout = REPEATER_LAYOUTS.includes(a[A.layout]) ? a[A.layout] : D.layout;
  return {
    layout,
    dimension: a[A.dimension] === '3d' ? '3d' : '2d',
    itemCount: clampN(Math.round(num(a[A.itemCount], D.itemCount)), 1, REPEATER_MAX_ITEMS),
    gap: clampN(num(a[A.gap], D.gap), 0, 400),
    itemWidth: Math.max(0, num(a[A.itemWidth], 0)),
    itemHeight: Math.max(0, num(a[A.itemHeight], 0)),
    speed: clampN(num(a[A.speed], D.speed), 200, 20000),
    autoplay: a[A.autoplay] !== 'false' && a[A.autoplay] !== false,
    perspective: clampN(num(a[A.perspective], D.perspective), 100, 5000),
    direction: a[A.direction] === 'horizontal' ? 'horizontal' : 'vertical'
  };
}

/** The template child of a repeater (first child by ord), or null. */
export function repeaterTemplate(nodes, repeaterId) {
  return (nodes || []).filter(n => n.parentId === repeaterId).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id)[0] || null;
}

/**
 * The equivalent of dropping a library item onto a repeater: the new node becomes its template, replacing the old one(s).
 * `def` is the node to add (tag/kind/refType/refId/attrs...). `slot` ({x,y,w,h}, optional) places it on the first slot.
 * Returns { removeIds, node } for the caller to persist (delete removeIds, then add node).
 */
export function repeaterTemplateOps(nodes, repeater, def, slot = null) {
  const removeIds = (nodes || []).filter(n => n.parentId === repeater.id).map(n => n.id);
  const node = { ...def, parentId: repeater.id, ord: 0, attrs: { ...(def.attrs || {}) } };
  if (slot && ['use', 'rect', 'image'].includes(node.tag)) {
    node.attrs.x = slot.x; node.attrs.y = slot.y;
    if (!(Number(node.attrs.width) > 0)) node.attrs.width = slot.w;
    if (!(Number(node.attrs.height) > 0)) node.attrs.height = slot.h;
  }
  return { removeIds, node };
}

/**
 * Moving an existing node onto a repeater: it becomes the template (fitted inside the content box `inner`, placed on
 * the first slot) and the previous template(s) are moved out next to the repeater (into the repeater's parent) instead
 * of being deleted. Returns { patches: [{ id, patch }] } in apply order: the parked old templates first, then the node.
 */
export function repeaterAdoptOps(nodes, repeater, moved, inner) {
  const all = nodes || [];
  const { removeIds } = repeaterTemplateOps(all.filter(n => n.id !== moved.id), repeater, moved);
  const patches = [];
  const rb = nodeBBox(repeater, all);
  let maxOrd = all.reduce((m, n) => Math.max(m, Number(n.ord) || 0), 0), px = rb.x + rb.w + 16;
  for (const id of removeIds) {
    const old = all.find(n => n.id === id), b = nodeBBox(old, all);
    patches.push({ id, patch: { parentId: repeater.parentId ?? null, ord: ++maxOrd, attrs: resizeAttrs(old, b, { x: px, y: rb.y, w: b.w, h: b.h }) } });
    px += (b.w || 24) + 16;
  }
  const from = nodeBBox(moved, all);
  const fw = from.w > 0 ? from.w : 24, fh = from.h > 0 ? from.h : 24;
  const k = Math.min(1, inner.w / fw, inner.h / fh);
  const w = Math.max(4, Math.round(fw * k)), h = Math.max(4, Math.round(fh * k));
  const cfg = repeaterConfig(repeater);
  const first = repeaterPlan(cfg, inner, { w: cfg.itemWidth || w, h: cfg.itemHeight || h }).copies[0];
  patches.push({ id: moved.id, patch: { parentId: repeater.id, ord: 0, attrs: resizeAttrs(moved, { ...from, w: fw, h: fh }, { x: first.x, y: first.y, w, h }) } });
  return { patches, parkedIds: removeIds };
}

/**
 * Layout of the copies (self-contained). inner: the container content box {x,y,w,h}; item: slot size {w,h}.
 * Returns { copies: [{ i, x, y, t, o, clone }], track: {axis, from, to} | null, ring: {...} | null, tilt } where (x,y) is
 * the slot's top-left in the first frame, t a static SVG transform around the slot centre and o its opacity.
 */
export function repeaterPlan(cfg, inner, item) {
  var n = Math.max(1, Math.min(50, Math.round(cfg.itemCount) || 1));
  var iw = Math.max(1, item.w), ih = Math.max(1, item.h), gap = Math.max(0, cfg.gap || 0);
  var r = function (v) { return Math.round(v * 100) / 100; };
  var copies = [], track = null, ring = null, tilt = null, i;
  var cx = inner.x + (inner.w - iw) / 2, cy = inner.y + (inner.h - ih) / 2;
  var is3d = cfg.dimension === '3d';
  var layout = cfg.layout;
  if (layout === 'carousel' && is3d || layout === 'roll' && is3d) {
    var horiz = layout === 'carousel', step = horiz ? iw + gap : ih + gap, span = horiz ? inner.w - iw : inner.h - ih;
    var R = Math.max(8, Math.min(Math.max(span / 2, 8), Math.max(step * n / (2 * Math.PI), span * 0.45)));
    // the projection k = P / (P - R cos θ) blows up (or mirrors) once R reaches P, and a copy rotated on its own axis
    // needs P beyond its half extent: keep the effective perspective >= 2.5 × both, so 0.71 <= k <= 1.67 (keyframes use it too)
    var P = Math.max(cfg.perspective || 800, Math.ceil(2.5 * Math.max(R, (horiz ? iw : ih) / 2)));
    ring = { axis: horiz ? 'y' : 'x', radius: r(R), perspective: P, period: cfg.speed * n };
    for (i = 0; i < n; i++) {
      var th = 2 * Math.PI * i / n, s = Math.sin(th), c = Math.cos(th), k = P / (P - R * c);
      var squash = Math.max(0.2, Math.abs(c));
      var d = r(R * s);
      var t = 'translate(' + r(iw / 2 + (horiz ? d : 0)) + ' ' + r(ih / 2 + (horiz ? 0 : d)) + ') scale(' + r(horiz ? k * squash : k) + ' ' + r(horiz ? k : k * squash) + ') translate(' + r(-iw / 2) + ' ' + r(-ih / 2) + ')';
      copies.push({ i: i, x: r(cx), y: r(cy), t: t, o: r(0.3 + 0.7 * (c + 1) / 2), clone: false, angle: r(th * 180 / Math.PI) });
    }
    return { n: n, iw: iw, ih: ih, copies: copies, track: null, ring: ring, tilt: null };
  }
  var axis = layout === 'horizontal' || layout === 'carousel' || ((layout === 'slide' || layout === 'scroll') && cfg.direction === 'horizontal') ? 'x' : 'y';
  var stepA = axis === 'x' ? iw + gap : ih + gap;
  var view = axis === 'x' ? inner.w : inner.h;
  var x0 = inner.x, y0 = inner.y;
  if (layout === 'slide' || layout === 'carousel' || layout === 'roll') { if (axis === 'x') y0 = cy; else x0 = cx; }
  if (layout === 'slide') { if (axis === 'x') x0 = cx; else y0 = cy; }
  var place = function (j) { return axis === 'x' ? { x: r(x0 + j * stepA), y: r(y0) } : { x: r(x0), y: r(y0 + j * stepA) }; };
  for (i = 0; i < n; i++) { var p = place(i); copies.push({ i: i, x: p.x, y: p.y, t: '', o: 1, clone: false }); }
  if (layout === 'carousel' || layout === 'roll') {
    // the loop shifts by one set (n·step); the clone sets must still cover the view at the end of the shift, so a short
    // set gets more than one clone set (capped at ~400 copies for absurdly small items)
    var L = n * stepA, sets = Math.max(2, Math.min(Math.ceil((view + L + gap) / L), Math.max(2, Math.ceil(400 / n))));
    for (var m = 1; m < sets; m++) for (i = 0; i < n; i++) { var q = place(m * n + i); copies.push({ i: i, x: q.x, y: q.y, t: '', o: 1, clone: true }); }
    track = { kind: 'loop', axis: axis, distance: r(n * stepA), period: cfg.speed * n };
  } else if (layout === 'scroll') {
    var overflow = n * stepA - gap - view;
    if (overflow > 0) track = { kind: 'scroll', axis: axis, distance: r(overflow), period: Math.max(cfg.speed, cfg.speed * n / 2) };
  } else if (layout === 'slide') {
    track = { kind: 'slide', axis: axis, distance: r(stepA), count: n, period: cfg.speed * n };
  }
  if (is3d) tilt = axis === 'y' ? 'rotateX(18deg)' : 'rotateY(-18deg)';
  return { n: n, iw: iw, ih: ih, copies: copies, track: track, ring: null, tilt: tilt };
}

/**
 * Markup of the repeated copies plus their CSS (self-contained apart from repeaterPlan).
 * id: unique key for class/keyframe names; tpl: the template markup (already normalized into a 0,0 → item.w,item.h slot);
 * mode: 'animate' (keyframes) or 'static' (first frame only). Returns { markup, css }.
 */
export function repeaterMarkup(id, cfg, inner, item, tpl, mode) {
  var plan = repeaterPlan(cfg, inner, item);
  var anim = mode === 'animate' && cfg.autoplay;
  var key = 'ud-rpt-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  var css = '', body = '';
  var noIds = String(tpl).replace(/\sid="[^"]*"/g, '');
  var P = plan.ring ? plan.ring.perspective : cfg.perspective || 800;
  for (var c = 0; c < plan.copies.length; c++) {
    var cp = plan.copies[c];
    var inner3 = (c === 0 ? tpl : noIds);
    var attrs = ' class="ud-rpt-copy' + (plan.ring && anim ? ' ' + key + '-ring' : '') + '" data-rpt-' + (cp.clone ? 'clone' : 'index') + '="' + cp.i + '"' +
      (cp.t ? ' transform="' + cp.t + '"' : '') + (cp.o !== 1 ? ' opacity="' + cp.o + '"' : '') +
      (c > 0 ? ' aria-hidden="true"' : '') +
      (plan.ring && anim ? ' style="animation-delay:' + Math.round(-plan.ring.period * cp.i / plan.n) + 'ms"' : '');
    body += '<g transform="translate(' + cp.x + ' ' + cp.y + ')"><g' + attrs + '>' + inner3 + '</g></g>';
  }
  var hw = Math.round(plan.iw / 2 * 100) / 100, hh = Math.round(plan.ih / 2 * 100) / 100;
  if (plan.ring && anim) {
    var R = plan.ring.radius, steps = 24, f = '';
    for (var s = 0; s <= steps; s++) {
      var th = 2 * Math.PI * s / steps, sn = Math.sin(th), cs = Math.cos(th), k = Math.round(P / (P - R * cs) * 1000) / 1000;
      var d = Math.round(R * sn * 100) / 100, deg = Math.round(th * 1800 / Math.PI) / 10, ad = Math.round((hw + d) * 100) / 100, bd = Math.round((hh + d) * 100) / 100;
      var tr = plan.ring.axis === 'y'
        ? 'translate(' + ad + 'px,' + hh + 'px) perspective(' + P + 'px) rotateY(' + deg + 'deg) scale(' + k + ')'
        : 'translate(' + hw + 'px,' + bd + 'px) perspective(' + P + 'px) rotateX(' + (-deg) + 'deg) scale(' + k + ')';
      f += Math.round(s * 10000 / steps) / 100 + '%{transform:' + tr + ' translate(' + (-hw) + 'px,' + (-hh) + 'px);opacity:' + Math.round((0.3 + 0.7 * (cs + 1) / 2) * 100) / 100 + '}';
    }
    css += '@keyframes ' + key + '-ring{' + f + '}.' + key + '-ring{transform-box:view-box;transform-origin:0 0;animation:' + key + '-ring ' + plan.ring.period + 'ms linear infinite}';
  }
  var trackAttr = '';
  if (plan.track && anim) {
    var T = plan.track, ax = T.axis === 'x' ? 'translateX' : 'translateY', kf = '';
    if (T.kind === 'loop') { kf = '0%{transform:' + ax + '(0)}100%{transform:' + ax + '(' + (-T.distance) + 'px)}'; css += '@keyframes ' + key + '-track{' + kf + '}.' + key + '-track{animation:' + key + '-track ' + T.period + 'ms linear infinite}'; }
    else if (T.kind === 'scroll') { kf = '0%,10%{transform:' + ax + '(0)}90%,100%{transform:' + ax + '(' + (-T.distance) + 'px)}'; css += '@keyframes ' + key + '-track{' + kf + '}.' + key + '-track{animation:' + key + '-track ' + T.period + 'ms ease-in-out infinite alternate}'; }
    else if (T.kind === 'slide') {
      for (var j = 0; j < T.count; j++) {
        var a0 = j * 100 / T.count, a1 = a0 + 70 / T.count, off = -j * T.distance;
        kf += Math.round(a0 * 100) / 100 + '%,' + Math.round(a1 * 100) / 100 + '%{transform:' + ax + '(' + off + 'px)}';
      }
      kf += '100%{transform:' + ax + '(0)}';
      css += '@keyframes ' + key + '-track{' + kf + '}.' + key + '-track{animation:' + key + '-track ' + T.period + 'ms ease-in-out infinite}';
    }
    if (kf) trackAttr = ' ' + key + '-track';
  }
  if (css) css += '@media (prefers-reduced-motion:reduce){.' + key + '-track,.' + key + '-ring{animation:none!important}}';
  var tiltAttr = plan.tilt ? ' style="transform-box:fill-box;transform-origin:center;transform:perspective(' + P + 'px) ' + plan.tilt + '"' : '';
  var markup = '<g class="ud-rpt-stage" data-rpt-layout="' + cfg.layout + '" data-rpt-dim="' + cfg.dimension + '"' + tiltAttr + '>' +
    '<g class="ud-rpt-track' + trackAttr + '">' + body + '</g></g>';
  return { markup: markup, css: css };
}

/**
 * Exported-page runtime (self-contained; needs repeaterPlan + repeaterMarkup in scope): every `.ud-repeater[data-rpt]`
 * holds its template once; this expands it into the animated copies and injects the keyframes.
 */
export function bindRepeaters(root) {
  var doc = root.ownerDocument || root;
  var style = doc.getElementById('ud-rpt-style');
  if (!style) { style = doc.createElement('style'); style.id = 'ud-rpt-style'; (doc.head || doc.documentElement).appendChild(style); }
  var list = root.querySelectorAll('.ud-repeater[data-rpt]');
  for (var i = 0; i < list.length; i++) {
    var g = list[i], data;
    try { data = JSON.parse(g.getAttribute('data-rpt')); } catch (e) { continue; }
    var tpl = g.querySelector('.ud-rpt-tpl');
    if (!tpl) continue;
    var out = repeaterMarkup(data.id, data.cfg, data.inner, data.item, tpl.innerHTML, 'animate');
    g.innerHTML = out.markup;
    if (style.textContent.indexOf('@keyframes ud-rpt-' + data.id + '-') < 0) style.textContent += out.css;
    g.removeAttribute('data-rpt');
  }
}
