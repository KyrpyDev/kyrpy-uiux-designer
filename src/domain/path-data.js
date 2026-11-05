/**
 * Path data model for visual vertex editing (pure, isomorphic).
 * A path is a list of absolute commands:
 *   {t:'M',x,y} {t:'L',x,y} {t:'C',x1,y1,x2,y2,x,y} {t:'Q',x1,y1,x,y} {t:'A',rx,ry,rot,large,sweep,x,y} {t:'Z'}
 * parsePath() accepts every SVG path command (relative, H/V, S/T, arcs with packed flags) and normalizes to the list above;
 * serializePath() writes it back. Edits return new lists (inputs are never mutated).
 */
const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function parsePath(d) {
  const s = String(d || ''), n = s.length, out = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, prevC = null, prevQ = null;
  const skip = () => { while (i < n && /[\s,]/.test(s[i])) i++; };
  const num = () => { skip(); NUM.lastIndex = i; const m = NUM.exec(s); if (!m) throw new Error(`invalid path data near "${s.slice(i, i + 8)}"`); i += m[0].length; return parseFloat(m[0]); };
  const flag = () => { skip(); const c = s[i]; if (c !== '0' && c !== '1') throw new Error('invalid arc flag'); i++; return c === '1' ? 1 : 0; };
  const more = () => { skip(); return i < n && !/[a-zA-Z]/.test(s[i]); };
  while (true) {
    skip();
    if (i >= n) break;
    if (/[a-zA-Z]/.test(s[i])) { cmd = s[i++]; if (!(cmd.toUpperCase() in ARITY)) throw new Error(`unknown path command ${cmd}`); }
    else if (!cmd) throw new Error('path must start with a command');
    const C = cmd.toUpperCase(), rel = cmd !== C;
    if (C === 'Z') { out.push({ t: 'Z' }); cx = sx; cy = sy; prevC = prevQ = null; cmd = null; continue; }
    do {
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === 'M') { cx = ox + num(); cy = oy + num(); out.push({ t: 'M', x: cx, y: cy }); sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; prevC = prevQ = null; break; }
      if (C === 'L') { cx = ox + num(); cy = oy + num(); out.push({ t: 'L', x: cx, y: cy }); prevC = prevQ = null; }
      else if (C === 'H') { cx = (rel ? cx : 0) + num(); out.push({ t: 'L', x: cx, y: cy }); prevC = prevQ = null; }
      else if (C === 'V') { cy = (rel ? cy : 0) + num(); out.push({ t: 'L', x: cx, y: cy }); prevC = prevQ = null; }
      else if (C === 'C') { const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(); cx = ox + num(); cy = oy + num(); out.push({ t: 'C', x1, y1, x2, y2, x: cx, y: cy }); prevC = [x2, y2]; prevQ = null; }
      else if (C === 'S') { const x1 = prevC ? 2 * cx - prevC[0] : cx, y1 = prevC ? 2 * cy - prevC[1] : cy, x2 = ox + num(), y2 = oy + num(); cx = ox + num(); cy = oy + num(); out.push({ t: 'C', x1, y1, x2, y2, x: cx, y: cy }); prevC = [x2, y2]; prevQ = null; }
      else if (C === 'Q') { const x1 = ox + num(), y1 = oy + num(); cx = ox + num(); cy = oy + num(); out.push({ t: 'Q', x1, y1, x: cx, y: cy }); prevQ = [x1, y1]; prevC = null; }
      else if (C === 'T') { const x1 = prevQ ? 2 * cx - prevQ[0] : cx, y1 = prevQ ? 2 * cy - prevQ[1] : cy; cx = ox + num(); cy = oy + num(); out.push({ t: 'Q', x1, y1, x: cx, y: cy }); prevQ = [x1, y1]; prevC = null; }
      else if (C === 'A') { const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(); cx = ox + num(); cy = oy + num(); out.push({ t: 'A', rx, ry, rot, large, sweep, x: cx, y: cy }); prevC = prevQ = null; }
    } while (more());
  }
  return out;
}

const r = (v, p) => { const k = 10 ** p; const x = Math.round(v * k) / k; return Object.is(x, -0) ? 0 : x; };

export function serializePath(cmds, precision = 2) {
  const f = v => String(r(v, precision));
  return cmds.map(c => {
    switch (c.t) {
      case 'M': case 'L': return `${c.t}${f(c.x)} ${f(c.y)}`;
      case 'C': return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
      case 'Q': return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
      case 'A': return `A${f(c.rx)} ${f(c.ry)} ${f(c.rot)} ${c.large} ${c.sweep} ${f(c.x)} ${f(c.y)}`;
      default: return 'Z';
    }
  }).join('');
}

/** The end point of command i (a Z command ends at the start of its sub-path). */
export function endPoint(cmds, i) {
  const c = cmds[i];
  if (c.t !== 'Z') return { x: c.x, y: c.y };
  for (let k = i - 1; k >= 0; k--) if (cmds[k].t === 'M') return { x: cmds[k].x, y: cmds[k].y };
  return { x: 0, y: 0 };
}
/** Start point of the segment drawn by command i. */
export function startPoint(cmds, i) { return i > 0 ? endPoint(cmds, i - 1) : { x: 0, y: 0 }; }

/** Draggable things for the overlay: anchors (vertices) and bezier handles with the anchor they hang from. */
export function editPoints(cmds) {
  const anchors = [], handles = [];
  cmds.forEach((c, i) => {
    if (c.t === 'Z') return;
    anchors.push({ i, x: c.x, y: c.y, t: c.t });
    if (c.t === 'C') {
      const s = startPoint(cmds, i);
      handles.push({ i, which: 'c1', x: c.x1, y: c.y1, ax: s.x, ay: s.y }, { i, which: 'c2', x: c.x2, y: c.y2, ax: c.x, ay: c.y });
    } else if (c.t === 'Q') {
      const s = startPoint(cmds, i);
      handles.push({ i, which: 'q', x: c.x1, y: c.y1, ax: s.x, ay: s.y, bx: c.x, by: c.y });
    }
  });
  return { anchors, handles };
}

const clone = cmds => cmds.map(c => ({ ...c }));

/** Moves vertex i; its bezier handles travel with it. */
export function moveAnchor(cmds, i, x, y) {
  const out = clone(cmds), c = out[i];
  const dx = x - c.x, dy = y - c.y;
  c.x = x; c.y = y;
  if (c.t === 'C') { c.x2 += dx; c.y2 += dy; }
  if (c.t === 'Q') { c.x1 += dx / 2; c.y1 += dy / 2; }
  const nx = out[i + 1];
  if (nx?.t === 'C') { nx.x1 += dx; nx.y1 += dy; }
  if (c.t === 'M') { // a closing Z returns here: nothing else to move
  }
  return out;
}

export function moveHandle(cmds, i, which, x, y) {
  const out = clone(cmds), c = out[i];
  if (which === 'c1') { c.x1 = x; c.y1 = y; } else if (which === 'c2') { c.x2 = x; c.y2 = y; } else { c.x1 = x; c.y1 = y; }
  return out;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Splits segment i at t (0..1) and inserts a new vertex. Arcs are converted to cubics first. Returns null when not possible. */
export function insertPoint(cmds, i, t = 0.5) {
  let list = clone(cmds);
  if (list[i].t === 'M') return null;
  if (list[i].t === 'A') list = convertSegment(list, i, 'curve');
  const c = list[i], p0 = startPoint(list, i);
  if (c.t === 'Z') {
    const p1 = endPoint(list, i), m = lerp(p0, p1, t);
    list.splice(i, 0, { t: 'L', x: m.x, y: m.y });
    return list;
  }
  if (c.t === 'L') { const m = lerp(p0, c, t); list.splice(i, 0, { t: 'L', x: m.x, y: m.y }); return list; }
  if (c.t === 'Q') {
    const a = lerp(p0, { x: c.x1, y: c.y1 }, t), b = lerp({ x: c.x1, y: c.y1 }, c, t), m = lerp(a, b, t);
    list.splice(i, 1, { t: 'Q', x1: a.x, y1: a.y, x: m.x, y: m.y }, { t: 'Q', x1: b.x, y1: b.y, x: c.x, y: c.y });
    return list;
  }
  const c1 = { x: c.x1, y: c.y1 }, c2 = { x: c.x2, y: c.y2 };
  const a = lerp(p0, c1, t), b = lerp(c1, c2, t), cc = lerp(c2, c, t), d = lerp(a, b, t), e = lerp(b, cc, t), m = lerp(d, e, t);
  list.splice(i, 1, { t: 'C', x1: a.x, y1: a.y, x2: d.x, y2: d.y, x: m.x, y: m.y }, { t: 'C', x1: e.x, y1: e.y, x2: cc.x, y2: cc.y, x: c.x, y: c.y });
  return list;
}

/** Removes vertex i. Keeps at least two vertices. */
export function deletePoint(cmds, i) {
  const anchors = cmds.filter(c => c.t !== 'Z').length;
  if (anchors <= 2 || cmds[i].t === 'Z') return null;
  const out = clone(cmds);
  if (out[i].t === 'M') {
    const nx = out[i + 1];
    if (!nx || nx.t === 'Z' || nx.t === 'M') return null;
    out.splice(i, 2, { t: 'M', x: nx.x, y: nx.y });
  } else out.splice(i, 1);
  return out;
}

/** Turns the segment that ends at vertex i into a straight line or a curve. */
export function convertSegment(cmds, i, to) {
  const out = clone(cmds), c = out[i], p0 = startPoint(out, i);
  if (c.t === 'M' || c.t === 'Z') return out;
  if (to === 'line') { out[i] = { t: 'L', x: c.x, y: c.y }; return out; }
  if (c.t === 'C') return out;
  if (c.t === 'L') { out[i] = { t: 'C', x1: p0.x + (c.x - p0.x) / 3, y1: p0.y + (c.y - p0.y) / 3, x2: p0.x + 2 * (c.x - p0.x) / 3, y2: p0.y + 2 * (c.y - p0.y) / 3, x: c.x, y: c.y }; return out; }
  if (c.t === 'Q') { out[i] = { t: 'C', x1: p0.x + 2 / 3 * (c.x1 - p0.x), y1: p0.y + 2 / 3 * (c.y1 - p0.y), x2: c.x + 2 / 3 * (c.x1 - c.x), y2: c.y + 2 / 3 * (c.y1 - c.y), x: c.x, y: c.y }; return out; }
  if (c.t === 'A') { out.splice(i, 1, ...arcToCubics(p0, c)); return out; }
  return out;
}

export function toggleClosed(cmds) {
  const out = clone(cmds);
  if (out.length && out[out.length - 1].t === 'Z') out.pop(); else out.push({ t: 'Z' });
  return out;
}

/** SVG elliptical arc -> cubic beziers (endpoint to centre parameterization, split into <= 90 degree pieces). */
export function arcToCubics(p0, a) {
  let { rx, ry } = a;
  const { x, y, large, sweep } = a, phi = (a.rot || 0) * Math.PI / 180;
  if (!rx || !ry || (p0.x === x && p0.y === y)) return [{ t: 'L', x, y }];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - x) / 2, dy = (p0.y - y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cxp = co * (rx * y1) / ry, cyp = co * -(ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + x) / 2, cy = sin * cxp + cos * cyp + (p0.y + y) / 2;
  const ang = (ux, uy, vx, vy) => { const d = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return d; };
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI; else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)), step = dth / n, k = 4 / 3 * Math.tan(step / 4);
  const out = [];
  for (let s = 0; s < n; s++) {
    const t1 = th1 + s * step, t2 = t1 + step;
    const pt = (t, ddx, ddy) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin + ddx, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos + ddy });
    const e1 = { x: -rx * Math.sin(t1) * cos - ry * Math.cos(t1) * sin, y: -rx * Math.sin(t1) * sin + ry * Math.cos(t1) * cos };
    const e2 = { x: -rx * Math.sin(t2) * cos - ry * Math.cos(t2) * sin, y: -rx * Math.sin(t2) * sin + ry * Math.cos(t2) * cos };
    const s0 = pt(t1, 0, 0), s1 = pt(t2, 0, 0);
    out.push({ t: 'C', x1: s0.x + k * e1.x, y1: s0.y + k * e1.y, x2: s1.x - k * e2.x, y2: s1.y - k * e2.y, x: s === n - 1 ? x : s1.x, y: s === n - 1 ? y : s1.y });
  }
  return out;
}

/** Basic shapes as path commands, so any shape can be edited vertex by vertex. Returns null for unsupported tags. */
export function shapeToCommands(tag, a) {
  const n = k => parseFloat(a[k]) || 0;
  if (tag === 'path') return parsePath(a.d);
  if (tag === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height'), rx = Math.min(parseFloat(a.rx) || parseFloat(a.ry) || 0, w / 2), ry = Math.min(parseFloat(a.ry) || parseFloat(a.rx) || 0, h / 2);
    if (!rx && !ry) return [{ t: 'M', x, y }, { t: 'L', x: x + w, y }, { t: 'L', x: x + w, y: y + h }, { t: 'L', x, y: y + h }, { t: 'Z' }];
    const arc = (px, py) => ({ t: 'A', rx, ry, rot: 0, large: 0, sweep: 1, x: px, y: py });
    return [{ t: 'M', x: x + rx, y }, { t: 'L', x: x + w - rx, y }, arc(x + w, y + ry), { t: 'L', x: x + w, y: y + h - ry }, arc(x + w - rx, y + h),
      { t: 'L', x: x + rx, y: y + h }, arc(x, y + h - ry), { t: 'L', x, y: y + ry }, arc(x + rx, y), { t: 'Z' }];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry');
    return [{ t: 'M', x: cx - rx, y: cy }, { t: 'A', rx, ry, rot: 0, large: 1, sweep: 0, x: cx + rx, y: cy }, { t: 'A', rx, ry, rot: 0, large: 1, sweep: 0, x: cx - rx, y: cy }, { t: 'Z' }];
  }
  if (tag === 'line') return [{ t: 'M', x: n('x1'), y: n('y1') }, { t: 'L', x: n('x2'), y: n('y2') }];
  if (tag === 'polyline' || tag === 'polygon') {
    const nums = String(a.points || '').match(/-?\d*\.?\d+/g) || [];
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push({ t: i ? 'L' : 'M', x: +nums[i], y: +nums[i + 1] });
    if (tag === 'polygon' && out.length) out.push({ t: 'Z' });
    return out.length ? out : null;
  }
  return null;
}

export const isVertexEditable = tag => ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(tag);

/** Applies `x' = x*sx + tx` style transforms (translate+scale from the node) to commands, and the inverse. */
export function mapCommands(cmds, fx, fy) {
  return cmds.map(c => {
    if (c.t === 'Z') return { ...c };
    const o = { ...c, x: fx(c.x), y: fy(c.y) };
    if ('x1' in c) { o.x1 = fx(c.x1); o.y1 = fy(c.y1); }
    if ('x2' in c) { o.x2 = fx(c.x2); o.y2 = fy(c.y2); }
    return o;
  });
}
