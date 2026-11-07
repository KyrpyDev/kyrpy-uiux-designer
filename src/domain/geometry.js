/**
 * Pure geometry helpers shared by the editor (browser) and the exporter (node).
 * Element geometry always lives in SVG attributes (x, y, width, height, cx, cy, r, d, points ...).
 */
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

export function snap(value, grid) {
  if (!grid || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** The nine reference points of a box: tl tc tr / ml mc mr / bl bc br. */
export const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
export function anchorPoints(w, h, x = 0, y = 0) {
  const xs = [x, x + w / 2, x + w], ys = [y, y + h / 2, y + h];
  const out = {};
  ANCHORS.forEach((a, i) => { out[a] = { x: xs[i % 3], y: ys[Math.floor(i / 3)] }; });
  return out;
}

/** Position `box` so its own anchor `anchor` lands on the container's anchor `target` (+margin). */
export function placeAtAnchor(box, container, anchor, margin = 0) {
  const p = anchorPoints(container.w, container.h)[anchor];
  const q = anchorPoints(box.w, box.h)[anchor];
  const dx = anchor.endsWith('l') ? margin : anchor.endsWith('r') ? -margin : 0;
  const dy = anchor.startsWith('t') ? margin : anchor.startsWith('b') ? -margin : 0;
  return { x: p.x - q.x + dx, y: p.y - q.y + dy };
}

/** Nearest of the 9 reference points of the container to a point; returns {anchor, x, y, dist}. */
export function nearestAnchor(point, container) {
  const pts = anchorPoints(container.w, container.h);
  let best = null;
  for (const a of ANCHORS) {
    const d = Math.hypot(pts[a].x - point.x, pts[a].y - point.y);
    if (!best || d < best.dist) best = { anchor: a, x: pts[a].x, y: pts[a].y, dist: d };
  }
  return best;
}

/* ---------- path bounding box (control points are included, which is a safe superset) ---------- */
function pathPoints(d) {
  const tokens = String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  const next = () => parseFloat(tokens[i++]);
  const has = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') { cx = sx; cy = sy; if (!has()) continue; }
    else if (C === 'M' || C === 'L' || C === 'T') {
      do { cx = ox + next(); cy = oy + next(); pts.push([cx, cy]); if (C === 'M') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; } } while (has());
    } else if (C === 'H') { do { cx = (rel ? cx : 0) + next(); pts.push([cx, cy]); } while (has()); }
    else if (C === 'V') { do { cy = (rel ? cy : 0) + next(); pts.push([cx, cy]); } while (has()); }
    else if (C === 'C') {
      do { const bx = cx, by = cy;
        for (let k = 0; k < 3; k++) { const px = (rel ? bx : 0) + next(), py = (rel ? by : 0) + next(); pts.push([px, py]); if (k === 2) { cx = px; cy = py; } }
      } while (has());
    } else if (C === 'S' || C === 'Q') {
      do { const bx = cx, by = cy;
        for (let k = 0; k < 2; k++) { const px = (rel ? bx : 0) + next(), py = (rel ? by : 0) + next(); pts.push([px, py]); if (k === 1) { cx = px; cy = py; } }
      } while (has());
    } else if (C === 'A') {
      do { const rx = next(), ry = next(); next(); next(); next();
        const ex = (rel ? cx : 0) + next(), ey = (rel ? cy : 0) + next();
        pts.push([cx - rx, cy - ry], [cx + rx, cy + ry], [ex, ey]); cx = ex; cy = ey;
      } while (has());
    } else { i++; }
  }
  return pts;
}

function ptsBox(pts) {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Parses a leading translate()/scale() chain from a transform attribute: {tx,ty,sx,sy}. */
export function parseTransform(t) {
  const out = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const s = String(t || '');
  const tr = s.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/);
  if (tr) { out.tx = num(tr[1]); out.ty = num(tr[2]); }
  const sc = s.match(/scale\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?/);
  if (sc) { out.sx = num(sc[1], 1); out.sy = sc[2] === undefined ? out.sx : num(sc[2], 1); }
  return out;
}

/** Own bounding box in the element's parent coordinate space (before rotation), {x,y,w,h}. */
export function nodeBBox(el, all = []) {
  const a = el.attrs || {};
  let box;
  switch (el.tag) {
    case 'rect': case 'use': case 'image': case 'foreignObject':
      box = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) }; break;
    case 'circle': box = { x: num(a.cx) - num(a.r), y: num(a.cy) - num(a.r), w: num(a.r) * 2, h: num(a.r) * 2 }; break;
    case 'ellipse': box = { x: num(a.cx) - num(a.rx), y: num(a.cy) - num(a.ry), w: num(a.rx) * 2, h: num(a.ry) * 2 }; break;
    case 'line': box = ptsBox([[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]); break;
    case 'polyline': case 'polygon': {
      const n = String(a.points || '').match(/-?\d*\.?\d+/g) || [];
      const pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([+n[i], +n[i + 1]]);
      box = ptsBox(pts); break;
    }
    case 'path': box = ptsBox(pathPoints(a.d)); break;
    case 'text': {
      const fs = num(a['font-size'], 16), len = String(el.text || '').length * fs * 0.56;
      const x = num(a.x), y = num(a.y), anchor = a['text-anchor'] || 'start';
      const x0 = anchor === 'middle' ? x - len / 2 : anchor === 'end' ? x - len : x;
      box = { x: x0, y: y - fs * 0.85, w: len, h: fs * 1.05 }; break;
    }
    case 'g': {
      const kids = all.filter(k => k.parentId === el.id);
      const boxes = kids.map(k => nodeBBox(k, all));
      box = boxes.length ? ptsBox(boxes.flatMap(b => [[b.x, b.y], [b.x + b.w, b.y + b.h]])) : { x: 0, y: 0, w: 0, h: 0 };
      break;
    }
    default: box = { x: 0, y: 0, w: 0, h: 0 };
  }
  if (el.tag === 'g' || el.tag === 'path' || el.tag === 'polyline' || el.tag === 'polygon') {
    const t = parseTransform(a.transform);
    if (a.transform) box = { x: box.x * t.sx + t.tx, y: box.y * t.sy + t.ty, w: box.w * t.sx, h: box.h * t.sy };
  }
  return box;
}

function setTranslate(attrs, dx, dy) {
  const t = parseTransform(attrs.transform);
  const rest = String(attrs.transform || '').replace(/translate\([^)]*\)\s*/, '');
  const tx = round(t.tx + dx), ty = round(t.ty + dy);
  attrs.transform = `translate(${tx} ${ty}) ${rest}`.trim();
}
const round = v => Math.round(v * 100) / 100;

/** Returns new attrs with the element moved by (dx, dy). Children of groups move with the group transform. */
export function translateAttrs(el, dx, dy) {
  const a = { ...(el.attrs || {}) };
  switch (el.tag) {
    case 'rect': case 'use': case 'image': case 'text': case 'foreignObject':
      a.x = round(num(a.x) + dx); a.y = round(num(a.y) + dy); break;
    case 'circle': case 'ellipse': a.cx = round(num(a.cx) + dx); a.cy = round(num(a.cy) + dy); break;
    case 'line': a.x1 = round(num(a.x1) + dx); a.y1 = round(num(a.y1) + dy); a.x2 = round(num(a.x2) + dx); a.y2 = round(num(a.y2) + dy); break;
    default: setTranslate(a, dx, dy);
  }
  return a;
}

/** Returns new attrs so the element fills `to` ({x,y,w,h}) given its current box `from`. */
export function resizeAttrs(el, from, to) {
  const a = { ...(el.attrs || {}) };
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  switch (el.tag) {
    case 'rect': case 'use': case 'image': case 'foreignObject':
      a.x = round(to.x); a.y = round(to.y); a.width = round(Math.max(1, to.w)); a.height = round(Math.max(1, to.h)); break;
    case 'circle': a.cx = round(to.x + to.w / 2); a.cy = round(to.y + to.h / 2); a.r = round(Math.max(0.5, Math.min(to.w, to.h) / 2)); break;
    case 'ellipse': a.cx = round(to.x + to.w / 2); a.cy = round(to.y + to.h / 2); a.rx = round(Math.max(0.5, to.w / 2)); a.ry = round(Math.max(0.5, to.h / 2)); break;
    case 'line': {
      const m = (px, py) => [round(to.x + (px - from.x) * sx), round(to.y + (py - from.y) * sy)];
      [a.x1, a.y1] = m(num(a.x1), num(a.y1)); [a.x2, a.y2] = m(num(a.x2), num(a.y2)); break;
    }
    case 'text': {
      a['font-size'] = round(Math.max(4, num(a['font-size'], 16) * sy));
      const anchor = a['text-anchor'] || 'start';
      a.x = round(anchor === 'middle' ? to.x + to.w / 2 : anchor === 'end' ? to.x + to.w : to.x);
      a.y = round(to.y + to.h * 0.81); break;
    }
    default: {
      // path / polyline / polygon / g: express the resize as a transform around the unscaled box.
      const t = parseTransform(a.transform);
      const ox = (from.x - t.tx) / (t.sx || 1), oy = (from.y - t.ty) / (t.sy || 1);
      const nsx = (t.sx || 1) * sx, nsy = (t.sy || 1) * sy;
      a.transform = `translate(${round(to.x - ox * nsx)} ${round(to.y - oy * nsy)}) scale(${round(nsx)} ${round(nsy)})`;
    }
  }
  return a;
}

/**
 * Scales the root nodes of a design when its bounding box is resized by (sx, sy), so sub items stay inside the box.
 * Returns [{id, attrs}] patches (text size follows the vertical factor, groups/paths scale through their transform).
 */
export function scaleNodeSet(nodes, sx, sy) {
  const out = [];
  for (const n of nodes) {
    if (n.parentId != null) continue;
    const from = nodeBBox(n, nodes);
    const to = { x: from.x * sx, y: from.y * sy, w: from.w * sx, h: from.h * sy };
    out.push({ id: n.id, attrs: resizeAttrs(n, from, to) });
  }
  return out;
}

/* ---------- Container & Carousel Container Geometry Helpers ---------- */

/** Returns true if a node is a Container or Carousel Container (shell / outer box of sub-elements). */
export function isContainerNode(el, libElements = null) {
  if (!el) return false;
  if (el.role === 'container' || el.role === 'carousel-container' || el.role === 'repeater-container') return true;
  const dc = el.attrs?.['data-container'];
  if (dc === 'true' || dc === 'container' || dc === 'carousel' || dc === 'repeater') return true;
  if (el.kind === 'instance' && el.refType === 'element') {
    const name = String(el.name || '').toLowerCase();
    if (name.startsWith('html-container') || name.startsWith('html-carousel-container') || name.startsWith('container') || name.startsWith('carousel-container')) {
      return true;
    }
    if (libElements) {
      const target = typeof libElements.get === 'function'
        ? libElements.get(el.refId)
        : Array.isArray(libElements) ? libElements.find(x => x.id === el.refId) : null;
      if (target && (target.key === 'html-container' || target.key === 'html-carousel-container' || target.key === 'html-repeater' || target.category === 'containers' || target.meta?.isContainer)) {
        return true;
      }
    }
  }
  return false;
}

/** Returns true if a node is specifically a Carousel Container (with 2D/3D horizontal/vertical animated roll effect). */
export function isCarouselContainerNode(el, libElements = null) {
  if (!el) return false;
  if (el.role === 'carousel-container' || el.attrs?.['data-container'] === 'carousel') return true;
  if (el.kind === 'instance' && el.refType === 'element') {
    const name = String(el.name || '').toLowerCase();
    if (name.startsWith('html-carousel-container') || name.startsWith('carousel-container')) return true;
    if (libElements) {
      const target = typeof libElements.get === 'function'
        ? libElements.get(el.refId)
        : Array.isArray(libElements) ? libElements.find(x => x.id === el.refId) : null;
      if (target && (target.key === 'html-carousel-container' || target.meta?.containerType === 'carousel')) {
        return true;
      }
    }
  }
  return false;
}

/** Extracts normalized container & carousel configuration from a container node's `attrs`. */
export function getContainerConfig(el, libElements = null) {
  const a = el?.attrs || {};
  const isCarousel = isCarouselContainerNode(el, libElements);
  const innerMargin = Math.max(0, num(a['data-inner-margin'], 12));
  const outerMargin = Math.max(0, num(a['data-outer-margin'], 16));
  const sizeMode = a['data-size-mode'] === 'fixed' ? 'fixed' : 'responsive';
  const fitScreen = a['data-fit-screen'] || 'width'; // 'none' | 'width' | 'full'
  const carouselDim = a['data-carousel-dim'] === '2d' ? '2d' : '3d';
  const carouselDir = a['data-carousel-dir'] === 'vertical' ? 'vertical' : 'horizontal';
  const carouselSpeed = Math.max(300, num(a['data-carousel-speed'], 2600));
  const carouselAutoRoll = a['data-carousel-autoroll'] !== 'false' && a['data-carousel-autoroll'] !== false;
  const carouselIndex = Math.max(0, Math.floor(num(a['data-carousel-index'], 0)));
  return {
    isContainer: isContainerNode(el, libElements),
    isCarousel,
    innerMargin,
    outerMargin,
    sizeMode,
    fitScreen,
    carouselDim,
    carouselDir,
    carouselSpeed,
    carouselAutoRoll,
    carouselIndex
  };
}

/** Computes the inner content box `{ x, y, w, h, innerMargin, outerMargin, outerBox }` of a container node. */
export function containerInnerBox(containerNode, allNodes = [], libElements = null) {
  const outerBox = nodeBBox(containerNode, allNodes);
  const cfg = getContainerConfig(containerNode, libElements);
  const padX = Math.min(cfg.innerMargin, Math.max(0, (outerBox.w - 8) / 2));
  const padY = Math.min(cfg.innerMargin, Math.max(0, (outerBox.h - 8) / 2));
  return {
    x: round(outerBox.x + padX),
    y: round(outerBox.y + padY),
    w: round(Math.max(8, outerBox.w - padX * 2)),
    h: round(Math.max(8, outerBox.h - padY * 2)),
    innerMargin: cfg.innerMargin,
    outerMargin: cfg.outerMargin,
    outerBox
  };
}

/**
 * Clamps a child bounding box `{ x, y, w, h }` so that:
 * 1. Its width `w` and height `h` never exceed the container's inner width/height (`outerBox - 2*innerMargin`).
 * 2. Its position `(x, y)` stays inside the container's inner content area.
 */
export function clampBoxToContainer(childBox, containerNode, allNodes = [], libElements = null) {
  const inner = containerInnerBox(containerNode, allNodes, libElements);
  const w = round(Math.max(4, Math.min(num(childBox.w, 24), inner.w)));
  const h = round(Math.max(4, Math.min(num(childBox.h, 24), inner.h)));
  const x = round(Math.max(inner.x, Math.min(num(childBox.x, inner.x), inner.x + inner.w - w)));
  const y = round(Math.max(inner.y, Math.min(num(childBox.y, inner.y), inner.y + inner.h - h)));
  return { x, y, w, h };
}

/** Returns updated `attrs` for `childNode` clamped to fit inside `containerNode`'s inner margin box. */
export function clampNodeToContainer(childNode, containerNode, allNodes = [], libElements = null) {
  if (!childNode || !containerNode) return childNode?.attrs || {};
  const from = nodeBBox(childNode, allNodes);
  const clamped = clampBoxToContainer(from, containerNode, allNodes, libElements);
  return resizeAttrs(childNode, from, clamped);
}

/**
 * Computes the bounding box `{ x, y, w, h }` when a Container is fitted to a device screen
 * using its `outerMargin` setting (`fitMode`: `'width'` fits width with outerMargin; `'full'` fits both width & height).
 */
export function fitContainerToScreenBox(containerNode, screenWidth, screenHeight, { fitMode = 'width', allNodes = [] } = {}) {
  const cur = nodeBBox(containerNode, allNodes);
  const cfg = getContainerConfig(containerNode);
  const om = cfg.outerMargin;
  const w = round(Math.max(32, num(screenWidth, 390) - om * 2));
  const x = round(om);
  if (fitMode === 'full') {
    const h = round(Math.max(32, num(screenHeight, 844) - om * 2));
    return { x, y: round(om), w, h };
  }
  const maxH = Math.max(32, num(screenHeight, 844) - om * 2);
  const h = round(Math.min(Math.max(40, cur.h || 180), maxH));
  const y = round(Math.max(om, Math.min(cur.y || om, num(screenHeight, 844) - om - h)));
  return { x, y, w, h };
}
