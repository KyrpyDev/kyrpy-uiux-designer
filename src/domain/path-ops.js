/**
 * Pathfinder operations (pure): union, subtract (cut out), intersect (crop), exclude.
 *
 * Method: flatten both shapes to polygon rings -> split every edge at its intersections with the other shape
 * (including vertices that touch an edge) -> classify each piece as inside / outside / on the other shape's boundary
 * -> keep the pieces the operation needs -> stitch them back into closed rings. Rings are filled with the even-odd rule,
 * so holes are just inner rings. Curves of the result are polylines (the tolerance is the flatten segment length).
 */
import { shapeToCommands, arcToCubics, startPoint, endPoint, serializePath, mapCommands } from './path-data.js';
import { parseTransform, nodeBBox } from './geometry.js';
import { simplifyPoints } from './path-tools.js';

/* ---------- flattening ---------- */
/** Polygon rings of a command list. Open sub-paths are closed (a fill always closes them). seg = longest piece of a curve. */
export function flatten(cmds, seg = 0.5) {
  const rings = []; let ring = null, cur = { x: 0, y: 0 };
  const push = p => { if (!ring.length || Math.hypot(ring.at(-1).x - p.x, ring.at(-1).y - p.y) > 1e-9) ring.push({ x: p.x, y: p.y }); };
  const end = () => { if (ring && ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1).x, ring[0].y - ring.at(-1).y) < 1e-9) ring.pop(); if (ring && ring.length >= 3) rings.push(ring); ring = null; };
  const cubic = (p0, c) => {
    const len = Math.hypot(c.x1 - p0.x, c.y1 - p0.y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
    const n = Math.max(3, Math.min(80, Math.ceil(len / seg)));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      push({ x: u ** 3 * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x, y: u ** 3 * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y });
    }
  };
  for (const c of cmds) {
    if (c.t === 'M') { end(); ring = [{ x: c.x, y: c.y }]; cur = { x: c.x, y: c.y }; continue; }
    if (!ring) ring = [{ ...cur }];
    if (c.t === 'Z') { end(); continue; }
    if (c.t === 'L') push(c);
    else if (c.t === 'Q') cubic(cur, { x1: cur.x + 2 / 3 * (c.x1 - cur.x), y1: cur.y + 2 / 3 * (c.y1 - cur.y), x2: c.x + 2 / 3 * (c.x1 - c.x), y2: c.y + 2 / 3 * (c.y1 - c.y), x: c.x, y: c.y });
    else if (c.t === 'C') cubic(cur, c);
    else if (c.t === 'A') { let p = cur; for (const q of arcToCubics(p, c)) { if (q.t === 'L') push(q); else cubic(p, q); p = { x: q.x, y: q.y }; } }
    cur = { x: c.x, y: c.y };
  }
  end();
  return rings;
}

export function evenOddInside(pt, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

export const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j].x * r[i].y - r[i].x * r[j].y); return s / 2; };
/** Area of the even-odd region of a set of rings (outer rings add, rings nested an odd number of times subtract). */
export function regionArea(rings) {
  let total = 0;
  for (const r of rings) {
    const depth = rings.filter(o => o !== r && evenOddInside(r[0], [o])).length;
    total += (depth % 2 ? -1 : 1) * Math.abs(ringArea(r));
  }
  return total;
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function paramOn(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; return l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0; }

/* ---------- boolean operation ---------- */
/** @param op 'union' | 'subtract' (A minus B) | 'intersect' | 'exclude'   @returns rings */
export function booleanOp(op, ringsA, ringsB, { tol } = {}) {
  const pts = [...ringsA.flat(), ...ringsB.flat()];
  if (!pts.length) return [];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const size = Math.max(1e-9, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const q = size * 1e-7, onTol = size * 1e-6, delta = size * 1e-4;
  const reg = new Map();
  const P = (x, y) => { const k = `${Math.round(x / q)},${Math.round(y / q)}`; let p = reg.get(k); if (!p) { p = { x, y, k }; reg.set(k, p); } return p; };

  const edgesOf = rings => { const out = []; for (const r of rings) for (let i = 0; i < r.length; i++) { const a = P(r[i].x, r[i].y), b = P(r[(i + 1) % r.length].x, r[(i + 1) % r.length].y); if (a !== b) out.push({ a, b, splits: [] }); } return out; };
  const EA = edgesOf(ringsA), EB = edgesOf(ringsB);

  // crossings and touching vertices
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  for (const ea of EA) {
    const ax0 = Math.min(ea.a.x, ea.b.x) - onTol, ax1 = Math.max(ea.a.x, ea.b.x) + onTol, ay0 = Math.min(ea.a.y, ea.b.y) - onTol, ay1 = Math.max(ea.a.y, ea.b.y) + onTol;
    for (const eb of EB) {
      if (Math.max(eb.a.x, eb.b.x) < ax0 || Math.min(eb.a.x, eb.b.x) > ax1 || Math.max(eb.a.y, eb.b.y) < ay0 || Math.min(eb.a.y, eb.b.y) > ay1) continue;
      const r = { x: ea.b.x - ea.a.x, y: ea.b.y - ea.a.y }, s = { x: eb.b.x - eb.a.x, y: eb.b.y - eb.a.y }, den = cross(r, s);
      if (Math.abs(den) > 1e-12 * size * size) {
        const qp = { x: eb.a.x - ea.a.x, y: eb.a.y - ea.a.y }, t = cross(qp, s) / den, u = cross(qp, r) / den, E = 1e-9;
        if (t > -E && t < 1 + E && u > -E && u < 1 + E) { const p = P(ea.a.x + r.x * t, ea.a.y + r.y * t); ea.splits.push({ t, p }); eb.splits.push({ t: u, p }); }
      }
      for (const v of [eb.a, eb.b]) if (segDist(v, ea.a, ea.b) < onTol) ea.splits.push({ t: paramOn(v, ea.a, ea.b), p: v });
      for (const v of [ea.a, ea.b]) if (segDist(v, eb.a, eb.b) < onTol) eb.splits.push({ t: paramOn(v, eb.a, eb.b), p: v });
    }
  }
  const pieces = (edges, src) => {
    const out = [];
    for (const e of edges) {
      const chain = [e.a, ...e.splits.filter(s => s.p !== e.a && s.p !== e.b).sort((m, n) => m.t - n.t).map(s => s.p), e.b];
      for (let i = 0; i + 1 < chain.length; i++) if (chain[i] !== chain[i + 1]) out.push({ a: chain[i], b: chain[i + 1], src });
    }
    return out;
  };
  const PA = pieces(EA, 'A'), PB = pieces(EB, 'B');

  const kept = [];
  const classify = (piece, otherEdges, otherRings, ownRings) => {
    const m = { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 };
    if (otherEdges.some(e => segDist(m, e.a, e.b) < onTol)) {
      // on the boundary of the other shape: which side is each shape's interior?
      const dx = piece.b.x - piece.a.x, dy = piece.b.y - piece.a.y, l = Math.hypot(dx, dy) || 1, n = { x: -dy / l * delta, y: dx / l * delta };
      const plus = { x: m.x + n.x, y: m.y + n.y };
      return { kind: 'on', same: evenOddInside(plus, ownRings) === evenOddInside(plus, otherRings) };
    }
    return { kind: evenOddInside(m, otherRings) ? 'in' : 'out' };
  };
  for (const p of PA) {
    const c = classify(p, EB, ringsB, ringsA);
    if (c.kind === 'on') {
      const keep = op === 'union' || op === 'intersect' ? c.same : op === 'subtract' ? !c.same : false;
      if (keep) kept.push(p);
    } else if ((op === 'union' && c.kind === 'out') || (op === 'intersect' && c.kind === 'in') || (op === 'subtract' && c.kind === 'out') || op === 'exclude') kept.push(p);
  }
  for (const p of PB) {
    const c = classify(p, EA, ringsA, ringsB);
    if (c.kind === 'on') continue;          // the A copy of a shared edge decides
    if ((op === 'union' && c.kind === 'out') || (op === 'intersect' && c.kind === 'in') || (op === 'subtract' && c.kind === 'in') || op === 'exclude') kept.push(p);
  }

  // stitch the kept pieces into closed rings (undirected walk)
  const at = new Map();
  kept.forEach((e, i) => { for (const p of [e.a, e.b]) { if (!at.has(p.k)) at.set(p.k, []); at.get(p.k).push(i); } });
  const used = new Array(kept.length).fill(false), rings = [];
  for (let i = 0; i < kept.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const ring = [kept[i].a]; let cur = kept[i].b;
    while (cur !== kept[i].a) {
      ring.push(cur);
      const next = (at.get(cur.k) || []).find(j => !used[j]);
      if (next === undefined) { ring.length = 0; break; }
      used[next] = true;
      cur = kept[next].a === cur ? kept[next].b : kept[next].a;
    }
    if (ring.length >= 3) rings.push(ring.map(p => ({ x: p.x, y: p.y })));
  }
  const simplifyTol = tol ?? size * 2e-4;
  return rings.map(r => { const s = simplifyPoints([...r, r[0]], simplifyTol).slice(0, -1); return s.length >= 3 ? s : r; }).filter(r => Math.abs(ringArea(r)) > size * size * 1e-10);
}

export function ringsToCommands(rings) {
  const out = [];
  for (const r of rings) { r.forEach((p, i) => out.push({ t: i ? 'L' : 'M', x: p.x, y: p.y })); out.push({ t: 'Z' }); }
  return out;
}

/** Crop rectangle as rings (for the crop tool and "crop to box"). */
export const rectRings = (x, y, w, h) => [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]];

/* ---------- nodes -> geometry in design coordinates ---------- */
const applyTf = (cmds, t) => mapCommands(cmds, x => x * t.sx + t.tx, y => y * t.sy + t.ty);

function arcsToCubics(cmds) {
  const out = [];
  for (const c of cmds) {
    if (c.t === 'A') { const p = out.length ? endPoint(out, out.length - 1) : { x: 0, y: 0 }; out.push(...arcToCubics(p, c)); } else out.push(c);
  }
  return out;
}

/** Commands of a vector node in design coordinates (own transform, ancestor transforms and rotation applied). Null for non-vector nodes. */
export function worldCommands(node, all = []) {
  if (!node || node.kind === 'instance' || ['text', 'g', 'use'].includes(node.tag)) return null;
  let cmds = shapeToCommands(node.tag, node.attrs || {});
  if (!cmds?.length) return null;
  cmds = arcsToCubics(cmds);
  let n = node;
  for (let guard = 0; n && guard < 10; guard++) {
    cmds = applyTf(cmds, parseTransform(n.attrs?.transform));
    n = n.parentId != null ? all.find(x => x.id === n.parentId) : null;
  }
  if (node.rotation) {
    const b = nodeBBox({ ...node, rotation: 0 }, all), cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = node.rotation * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    cmds = mapCommands(cmds, x => x, y => y).map(c => {
      if (c.t === 'Z') return c;
      const rot = (x, y) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs];
      const o = { ...c }; [o.x, o.y] = rot(c.x, c.y);
      if ('x1' in c) [o.x1, o.y1] = rot(c.x1, c.y1);
      if ('x2' in c) [o.x2, o.y2] = rot(c.x2, c.y2);
      return o;
    });
  }
  return cmds;
}

export const GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'transform'];

/** Style attributes of a node (everything that is not geometry), to give to a derived path. */
export function styleAttrs(node) { return Object.fromEntries(Object.entries(node.attrs || {}).filter(([k]) => !GEOMETRY_KEYS.includes(k))); }

/**
 * Runs a pathfinder operation on nodes (z-order bottom -> top). 'subtract' cuts the TOP shape out of everything below it.
 * Returns { d, rings } for the result, or null when nothing is left.
 */
export function pathfind(op, nodes, all, { seg } = {}) {
  const ordered = [...nodes].sort((a, b) => a.ord - b.ord || a.id - b.id);
  const geos = ordered.map(n => worldCommands(n, all));
  if (geos.some(g => !g)) throw new Error('only paths and basic shapes can be combined (text, groups and placed designs cannot)');
  const size = Math.max(...geos.flatMap(g => g.map(c => Math.abs(c.x ?? 0) + Math.abs(c.y ?? 0))), 1);
  const s = seg ?? Math.max(0.25, size / 400);
  const rings = geos.map(g => flatten(g, s));
  let acc;
  if (op === 'subtract') {
    const top = rings.pop();
    acc = rings.reduce((a, r) => (a ? booleanOp('union', a, r) : r), null);
    acc = booleanOp('subtract', acc, top);
  } else acc = rings.reduce((a, r) => (a ? booleanOp(op, a, r) : r), null);
  if (!acc.length) return null;
  return { rings: acc, d: serializePath(ringsToCommands(acc), 3) };
}

/** Intersects one node with a rectangle (crop). */
export function cropNode(node, all, rect, { seg } = {}) {
  const g = worldCommands(node, all);
  if (!g) throw new Error('only paths and basic shapes can be cropped');
  const size = Math.max(rect.w, rect.h, 1);
  const rings = booleanOp('intersect', flatten(g, seg ?? Math.max(0.25, size / 400)), rectRings(rect.x, rect.y, rect.w, rect.h));
  return rings.length ? { rings, d: serializePath(ringsToCommands(rings), 3) } : null;
}

export { startPoint };
