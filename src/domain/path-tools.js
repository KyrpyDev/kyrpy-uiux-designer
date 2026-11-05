/**
 * Vertex-level path tools (pure): vertex kinds (smooth / corner), mirrored handles, cut, reverse, mirror/rotate,
 * simplify, round corner, join, combine / break apart and the pen tool's command builder.
 * Everything works on the absolute command lists of path-data.js and returns new lists.
 */
import { convertSegment, endPoint, startPoint } from './path-data.js';

const clone = cmds => cmds.map(c => ({ ...c }));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = v => { const l = Math.hypot(v.x, v.y); return l ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; };

/** [first, last] command index of the sub-path that contains command i. */
export function subpathRange(cmds, i) {
  let s = i; while (s > 0 && cmds[s].t !== 'M') s--;
  let e = i; while (e + 1 < cmds.length && cmds[e + 1].t !== 'M') e++;
  return [s, e];
}
const closedRange = (cmds, e) => cmds[e].t === 'Z';
const withoutClose = (cmds, s, e) => cmds.slice(s, cmds[e].t === 'Z' ? e : e + 1);

/** Index of the segment that follows vertex i inside its sub-path (wraps around for closed sub-paths), or -1. */
function nextSegment(cmds, i) {
  const [s, e] = subpathRange(cmds, i);
  const n = cmds[i + 1];
  if (n && n.t !== 'M' && n.t !== 'Z') return i + 1;
  if (closedRange(cmds, e) && (!n || n.t === 'Z') && s + 1 < e) { const a = endPoint(cmds, i), m = cmds[s]; if (dist(a, m) < 1e-6) return s + 1; }
  return -1;
}

/** 'smooth' (collinear handles on both sides), 'cusp' (handles that are not collinear), 'corner' (no handles). */
export function vertexKind(cmds, i) {
  const c = cmds[i]; if (!c || c.t === 'Z') return 'corner';
  const a = { x: c.x, y: c.y };
  const inH = c.t === 'C' ? { x: c.x2 - a.x, y: c.y2 - a.y } : c.t === 'Q' ? { x: c.x1 - a.x, y: c.y1 - a.y } : null;
  const ns = nextSegment(cmds, i), nx = ns >= 0 ? cmds[ns] : null;
  const outH = nx && (nx.t === 'C' || nx.t === 'Q') ? { x: nx.x1 - a.x, y: nx.y1 - a.y } : null;
  const has = h => h && Math.hypot(h.x, h.y) > 1e-6;
  if (!has(inH) && !has(outH)) return 'corner';
  if (has(inH) && has(outH)) {
    const cross = inH.x * outH.y - inH.y * outH.x, dot = inH.x * outH.x + inH.y * outH.y;
    return Math.abs(cross) < 1e-3 * Math.hypot(inH.x, inH.y) * Math.hypot(outH.x, outH.y) && dot < 0 ? 'smooth' : 'cusp';
  }
  return 'cusp';
}

/** Gives vertex i collinear handles along the direction of its neighbours (a smooth curve through it). */
export function makeSmooth(cmds, i) {
  let out = clone(cmds);
  const c0 = out[i]; if (!c0 || c0.t === 'Z') return null;
  const [s, e] = subpathRange(out, i);
  const closed = closedRange(out, e);
  // the last vertex of a closed path joins the start through the implicit closing line: make that segment explicit so it can curve
  if (closed && out[i + 1]?.t === 'Z' && dist(endPoint(out, i), out[s]) > 1e-6) out.splice(i + 1, 0, { t: 'L', x: out[s].x, y: out[s].y });
  const ns = nextSegment(out, i);
  if (ns < 0 && i === s) return null;
  if (out[i].t !== 'C' && i > s) out = convertSegment(out, i, 'curve');
  if (ns >= 0 && out[ns].t !== 'C') out = convertSegment(out, ns, 'curve');
  const a = endPoint(out, i);
  const lastVertex = out[e].t === 'Z' ? e - 1 : e;
  const prevIdx = i > s ? i - 1 : (closed ? lastVertex : -1);
  const prev = prevIdx >= 0 ? endPoint(out, prevIdx) : null;
  const next = ns >= 0 ? { x: out[ns].x, y: out[ns].y } : null;
  const dir = norm({ x: (next ? next.x : a.x) - (prev ? prev.x : a.x), y: (next ? next.y : a.y) - (prev ? prev.y : a.y) });
  if (!dir.x && !dir.y) return null;
  if (out[i].t === 'C' && prev) { const l = dist(prev, a) / 3; out[i].x2 = a.x - dir.x * l; out[i].y2 = a.y - dir.y * l; }
  if (ns >= 0 && out[ns].t === 'C' && next) { const l = dist(a, next) / 3; out[ns].x1 = a.x + dir.x * l; out[ns].y1 = a.y + dir.y * l; }
  return out;
}

/** Retracts the handles of vertex i (a sharp corner). */
export function makeCorner(cmds, i) {
  const out = clone(cmds), c = out[i];
  if (!c || c.t === 'Z') return null;
  if (c.t === 'C') { c.x2 = c.x; c.y2 = c.y; }
  if (c.t === 'Q') { c.x1 = c.x; c.y1 = c.y; }
  const ns = nextSegment(out, i);
  if (ns >= 0 && out[ns].t === 'C') { out[ns].x1 = c.x; out[ns].y1 = c.y; }
  return out;
}

/** After a handle was dragged: keep the opposite handle of a smooth vertex collinear ('smooth' keeps its length, 'symmetric' copies it). */
export function mirrorHandle(cmds, i, which, mode = 'smooth') {
  const out = clone(cmds), c = out[i];
  let anchor, mine, opp, keys;
  if (which === 'c2') {
    anchor = { x: c.x, y: c.y }; mine = { x: c.x2, y: c.y2 };
    const ns = nextSegment(out, i);
    if (ns < 0 || out[ns].t !== 'C') return out;
    opp = out[ns]; keys = ['x1', 'y1'];
  } else if (which === 'c1') {
    const [s, e] = subpathRange(out, i);
    anchor = startPoint(out, i); mine = { x: c.x1, y: c.y1 };
    let pi = i - 1;
    if (pi < s || out[pi].t === 'M') {          // first segment of a closed sub-path: the opposite handle is on the closing segment
      const last = out[e].t === 'Z' ? e - 1 : e;
      if (closedRange(out, e) && out[last].t === 'C' && dist(out[last], out[s]) < 1e-6) pi = last; else return out;
    }
    if (out[pi].t !== 'C') return out;
    opp = out[pi]; keys = ['x2', 'y2'];
  } else return out;
  const v = { x: mine.x - anchor.x, y: mine.y - anchor.y }, len = Math.hypot(v.x, v.y);
  if (!len) return out;
  const oldLen = Math.hypot(opp[keys[0]] - anchor.x, opp[keys[1]] - anchor.y);
  const keep = mode === 'symmetric' ? len : (oldLen || len);
  opp[keys[0]] = anchor.x - (v.x / len) * keep; opp[keys[1]] = anchor.y - (v.y / len) * keep;
  return out;
}

/** Opens the path at vertex i: a closed sub-path becomes open (starting and ending at i), an open one is split in two. */
export function cutAt(cmds, i) {
  const [s, e] = subpathRange(cmds, i);
  const c = cmds[i]; if (!c || c.t === 'Z') return null;
  const closed = closedRange(cmds, e), body = withoutClose(cmds, s, e), k = i - s;
  let replacement;
  if (closed) {
    if (k === 0) replacement = body;
    else {
      const start = { x: body[0].x, y: body[0].y }, last = endPoint(body, body.length - 1);
      const tail = body.slice(k + 1), head = body.slice(1, k + 1);
      replacement = [{ t: 'M', x: c.x, y: c.y }, ...tail, ...(dist(last, start) > 1e-6 ? [{ t: 'L', x: start.x, y: start.y }] : []), ...head];
    }
  } else {
    if (k === 0 || k === body.length - 1) return null;
    replacement = [...body.slice(0, k + 1), { t: 'M', x: c.x, y: c.y }, ...body.slice(k + 1)];
  }
  return [...cmds.slice(0, s), ...replacement, ...cmds.slice(e + 1)];
}

/** Reverses the direction of every sub-path (handles swap, arcs flip their sweep). */
export function reversePath(cmds) {
  const out = []; let i = 0;
  while (i < cmds.length) {
    const [s, e] = subpathRange(cmds, i), closed = closedRange(cmds, e), body = withoutClose(cmds, s, e);
    const rev = [{ t: 'M', x: body.at(-1).x, y: body.at(-1).y }];
    for (let k = body.length - 1; k >= 1; k--) {
      const c = body[k], to = { x: body[k - 1].x, y: body[k - 1].y };
      if (c.t === 'C') rev.push({ t: 'C', x1: c.x2, y1: c.y2, x2: c.x1, y2: c.y1, x: to.x, y: to.y });
      else if (c.t === 'Q') rev.push({ t: 'Q', x1: c.x1, y1: c.y1, x: to.x, y: to.y });
      else if (c.t === 'A') rev.push({ ...c, sweep: 1 - c.sweep, x: to.x, y: to.y });
      else rev.push({ t: 'L', x: to.x, y: to.y });
    }
    if (closed) rev.push({ t: 'Z' });
    out.push(...rev); i = e + 1;
  }
  return out;
}

/** Mirrors or rotates the path in place (arcs follow). mirror: 'h' | 'v' about (cx, cy); rotate: degrees about (cx, cy). */
export function transformCommands(cmds, { mirror = null, rotate = 0, cx = 0, cy = 0 } = {}) {
  const rad = rotate * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  const pt = (x, y) => {
    if (mirror === 'h') x = 2 * cx - x;
    if (mirror === 'v') y = 2 * cy - y;
    if (rotate) { const dx = x - cx, dy = y - cy; return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs]; }
    return [x, y];
  };
  return cmds.map(c => {
    if (c.t === 'Z') return { ...c };
    const o = { ...c }; [o.x, o.y] = pt(c.x, c.y);
    if ('x1' in c) [o.x1, o.y1] = pt(c.x1, c.y1);
    if ('x2' in c) [o.x2, o.y2] = pt(c.x2, c.y2);
    if (c.t === 'A') { if (mirror) { o.sweep = 1 - c.sweep; o.rot = -(c.rot || 0); } if (rotate) o.rot = (c.rot || 0) + rotate; }
    return o;
  });
}

/** Ramer-Douglas-Peucker on a list of points. */
export function simplifyPoints(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts.at(-1);
  let idx = -1, max = 0;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-12;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / len;
    if (d > max) { max = d; idx = k; }
  }
  if (max <= tol) return [a, b];
  return [...simplifyPoints(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyPoints(pts.slice(idx), tol)];
}

/** Removes redundant vertices from runs of straight segments (curves are left alone). */
export function simplifyPath(cmds, tol = 0.05) {
  const out = []; let run = null;
  const flush = () => { if (!run) return; for (const p of simplifyPoints(run, tol).slice(1)) out.push({ t: 'L', x: p.x, y: p.y }); run = null; };
  for (const c of cmds) {
    if (c.t === 'L') { if (!run) run = [{ x: out.at(-1).x, y: out.at(-1).y }]; run.push({ x: c.x, y: c.y }); continue; }
    flush(); out.push({ ...c });
  }
  flush();
  return out;
}

/** Rounds the corner at vertex i (between two straight segments) with a curve of radius r. */
export function roundCorner(cmds, i, r) {
  const c = cmds[i], n = cmds[i + 1];
  if (!c || c.t !== 'L' || !n || n.t !== 'L') return null;
  const p = startPoint(cmds, i), a = { x: c.x, y: c.y }, q = { x: n.x, y: n.y };
  const l1 = dist(p, a), l2 = dist(a, q);
  if (!l1 || !l2) return null;
  const v1 = norm({ x: p.x - a.x, y: p.y - a.y }), v2 = norm({ x: q.x - a.x, y: q.y - a.y });
  const theta = Math.acos(Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y)));
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null;
  const d = Math.min(r / Math.tan(theta / 2), l1 / 2, l2 / 2);
  const out = clone(cmds);
  out.splice(i, 1, { t: 'L', x: a.x + v1.x * d, y: a.y + v1.y * d }, { t: 'Q', x1: a.x, y1: a.y, x: a.x + v2.x * d, y: a.y + v2.y * d });
  return out;
}

/** First and last vertex of the first sub-path. */
function pathEnds(cmds) {
  const [s, e] = subpathRange(cmds, 0), body = withoutClose(cmds, s, e);
  return { first: { x: body[0].x, y: body[0].y }, last: endPoint(body, body.length - 1) };
}

/** Joins two open paths end to end (the closest pair of end points is connected; either path may be reversed). */
export function joinPaths(a, b) {
  const A = pathEnds(a), B = pathEnds(b);
  const opts = [[dist(A.last, B.first), false, false], [dist(A.last, B.last), false, true], [dist(A.first, B.first), true, false], [dist(A.first, B.last), true, true]].sort((x, y) => x[0] - y[0]);
  const [gap, revA, revB] = opts[0];
  const first = (revA ? reversePath(a) : clone(a)).filter(c => c.t !== 'Z'), second = (revB ? reversePath(b) : clone(b)).filter(c => c.t !== 'Z');
  return [...first, ...(gap > 1e-6 ? [{ t: 'L', x: second[0].x, y: second[0].y }] : []), ...second.slice(1)];
}

export const combinePaths = list => list.flatMap(c => clone(c));

/** Splits a compound path into one command list per sub-path. */
export function breakApart(cmds) {
  const out = []; let i = 0;
  while (i < cmds.length) { const [s, e] = subpathRange(cmds, i); out.push(clone(cmds.slice(s, e + 1))); i = e + 1; }
  return out;
}

/** Pen tool: anchors with optional bezier handles -> commands. pts: [{x, y, out?: {x,y}, in?: {x,y}}] */
export function penToCommands(pts, closed = false) {
  if (!pts.length) return [];
  const cmds = [{ t: 'M', x: pts[0].x, y: pts[0].y }];
  const seg = (p, q) => {
    if (p.out || q.in) cmds.push({ t: 'C', x1: (p.out || p).x, y1: (p.out || p).y, x2: (q.in || q).x, y2: (q.in || q).y, x: q.x, y: q.y });
    else cmds.push({ t: 'L', x: q.x, y: q.y });
  };
  for (let k = 1; k < pts.length; k++) seg(pts[k - 1], pts[k]);
  if (closed && pts.length > 2) { const p = pts.at(-1), q = pts[0]; if (p.out || q.in) seg(p, q); cmds.push({ t: 'Z' }); }
  return cmds;
}
