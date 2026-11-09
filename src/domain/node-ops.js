/**
 * Operations on sets of nodes (pure): group / ungroup, align / distribute, flip, apply (bake) transforms.
 * They return new node lists or attribute patches; the designer persists them.
 */
import { nodeBBox, parseTransform, resizeAttrs, translateAttrs } from './geometry.js';
import { worldCommands } from './path-ops.js';
import { serializePath } from './path-data.js';
import { transformCommands } from './path-tools.js';

const GEOMETRIC = new Set(['rect', 'use', 'text', 'circle', 'ellipse', 'line', 'image']);
const byOrd = (a, b) => a.ord - b.ord || a.id - b.id;
const round = v => Math.round(v * 1000) / 1000;
const fmtTransform = t => (t.tx === 0 && t.ty === 0 && t.sx === 1 && t.sy === 1 ? '' : `translate(${round(t.tx)} ${round(t.ty)}) scale(${round(t.sx)} ${round(t.sy)})`);

export const unionBox = boxes => {
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)), x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** True when `id` is a descendant of any node in `ids`. */
function hasSelectedAncestor(nodes, id, ids) {
  for (let n = nodes.find(x => x.id === id); n && n.parentId != null; n = nodes.find(x => x.id === n.parentId)) if (ids.has(n.parentId)) return true;
  return false;
}

/**
 * Wraps the selected nodes (which must share one parent) in a new group `g`, placed at the top-most selected position.
 * The group gets the temporary id -1 (the repository replaces it).
 */
export function groupNodes(nodes, ids, name = 'group') {
  const set = new Set(ids);
  const sel = nodes.filter(n => set.has(n.id) && !hasSelectedAncestor(nodes, n.id, set)).sort(byOrd);
  if (!sel.length) throw new Error('select something to group');
  if (new Set(sel.map(n => n.parentId ?? null)).size > 1) throw new Error('the selected items must be on the same level to be grouped');
  const parentId = sel[0].parentId ?? null, last = sel.at(-1).id, chosen = new Set(sel.map(n => n.id));
  const group = { id: -1, parentId, ord: 0, kind: 'group', tag: 'g', name, role: null, refType: null, refId: null, rotation: 0, visible: true, locked: false, text: '', attrs: {}, descriptionDev: '' };
  const out = [];
  for (const n of [...nodes].sort(byOrd)) {
    if (!chosen.has(n.id)) { out.push(n); continue; }
    if (n.id === last) { out.push(group); for (const s of sel) out.push({ ...s, parentId: -1 }); }
  }
  return { nodes: out, groupId: -1 };
}

/** Moves a node into a group's former parent, folding the group's translate/scale into it. */
function bakeIntoChild(child, t, all) {
  if (GEOMETRIC.has(child.tag)) {
    const from = nodeBBox(child, all);
    const xa = from.x * t.sx + t.tx, xb = (from.x + from.w) * t.sx + t.tx, ya = from.y * t.sy + t.ty, yb = (from.y + from.h) * t.sy + t.ty;
    return resizeAttrs(child, from, { x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya) });
  }
  const c = parseTransform(child.attrs?.transform);
  const merged = { sx: c.sx * t.sx, sy: c.sy * t.sy, tx: c.tx * t.sx + t.tx, ty: c.ty * t.sy + t.ty };
  const attrs = { ...child.attrs }, s = fmtTransform(merged);
  if (s) attrs.transform = s; else delete attrs.transform;
  return attrs;
}

/** Dissolves a group: its children take its place in the parent (its translate/scale is applied to them). */
export function ungroupNodes(nodes, groupId) {
  const g = nodes.find(n => n.id === groupId);
  if (!g || g.tag !== 'g') return null;
  if (g.rotation) throw new Error('reset the group rotation to 0 before ungrouping');
  const t = parseTransform(g.attrs?.transform);
  const kids = nodes.filter(n => n.parentId === g.id).sort(byOrd);
  const out = [];
  for (const n of [...nodes].sort(byOrd)) {
    if (n.id === g.id) { for (const k of kids) out.push({ ...k, parentId: g.parentId ?? null, attrs: bakeIntoChild(k, t, nodes) }); continue; }
    if (n.parentId === g.id) continue;
    out.push(n);
  }
  return { nodes: out, childIds: kids.map(k => k.id) };
}

/** Attribute patches that align the selection. `ref` (a box) is used when only one node is selected. */
export function alignPatches(nodes, ids, mode, ref) {
  const sel = nodes.filter(n => ids.includes(n.id));
  if (!sel.length) return [];
  const boxes = sel.map(n => nodeBBox(n, nodes)), R = sel.length > 1 ? unionBox(boxes) : ref;
  return sel.map((n, i) => {
    const b = boxes[i];
    let dx = 0, dy = 0;
    if (mode === 'left') dx = R.x - b.x; else if (mode === 'right') dx = R.x + R.w - (b.x + b.w); else if (mode === 'hcenter') dx = R.x + R.w / 2 - (b.x + b.w / 2);
    else if (mode === 'top') dy = R.y - b.y; else if (mode === 'bottom') dy = R.y + R.h - (b.y + b.h); else if (mode === 'vmiddle') dy = R.y + R.h / 2 - (b.y + b.h / 2);
    return { id: n.id, attrs: translateAttrs(n, dx, dy) };
  });
}

/** Even spacing between three or more nodes along 'h' or 'v'. */
export function distributePatches(nodes, ids, axis) {
  const sel = nodes.filter(n => ids.includes(n.id));
  if (sel.length < 3) return [];
  const items = sel.map(n => ({ n, b: nodeBBox(n, nodes) })).sort((p, q) => (axis === 'h' ? p.b.x + p.b.w / 2 - (q.b.x + q.b.w / 2) : p.b.y + p.b.h / 2 - (q.b.y + q.b.h / 2)));
  const key = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
  const start = items[0].b[key[0]], end = items.at(-1).b[key[0]] + items.at(-1).b[key[1]];
  const total = items.reduce((s, it) => s + it.b[key[1]], 0), gap = (end - start - total) / (items.length - 1);
  let pos = start;
  return items.map(({ n, b }) => { const d = pos - b[key[0]]; pos += b[key[1]] + gap; return { id: n.id, attrs: axis === 'h' ? translateAttrs(n, d, 0) : translateAttrs(n, 0, d) }; });
}

/**
 * Mirrors the selection about its own centre. Paths are mirrored point by point, groups through their transform,
 * other shapes (and placed designs) keep their look and change position. Returns [{id, attrs, rotation?}].
 */
export function flipPatches(nodes, ids, axis) {
  const sel = nodes.filter(n => ids.includes(n.id));
  if (!sel.length) return [];
  const box = unionBox(sel.map(n => nodeBBox(n, nodes))), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return sel.map(n => {
    if (n.tag === 'path') {
      const w = worldCommands(n, nodes);
      if (w) { const attrs = { ...n.attrs, d: serializePath(transformCommands(w, { mirror: axis, cx, cy }), 3) }; delete attrs.transform; return { id: n.id, attrs, rotation: 0 }; }
    }
    if (n.tag === 'g') {
      const t = parseTransform(n.attrs.transform), b = nodeBBox(n, nodes);
      const attrs = { ...n.attrs };
      const nt = axis === 'h' ? { ...t, sx: -t.sx, tx: 2 * cx - t.tx } : { ...t, sy: -t.sy, ty: 2 * cy - t.ty };
      attrs.transform = fmtTransform(nt);
      void b;
      return { id: n.id, attrs };
    }
    const b = nodeBBox(n, nodes);
    return { id: n.id, attrs: axis === 'h' ? translateAttrs(n, 2 * cx - (b.x + b.w) - b.x, 0) : translateAttrs(n, 0, 2 * cy - (b.y + b.h) - b.y) };
  });
}

/** Applies a path's transform and rotation to its points (a path with plain coordinates is easier to edit). */
export function bakePatch(node, nodes) {
  const w = worldCommands(node, nodes);
  if (!w) return null;
  const attrs = { ...node.attrs, d: serializePath(w, 3) };
  delete attrs.transform;
  return { id: node.id, attrs, rotation: 0 };
}

/** Rotates a path's points by 90 degrees steps about the selection centre (baked into the points). */
export function rotatePatch(node, nodes, degrees, cx, cy) {
  const w = worldCommands(node, nodes);
  if (!w) return null;
  const attrs = { ...node.attrs, d: serializePath(transformCommands(w, { rotate: degrees, cx, cy }), 3) };
  delete attrs.transform;
  return { id: node.id, attrs, rotation: 0 };
}

/**
 * Layers-panel reorder (pure). The panel lists nodes front-most first, so `place: 'above'` puts `dragId` directly in
 * front of `targetId` and `'below'` directly behind it. Only siblings (same parent) can be reordered; returns the full
 * node list in paint order (back to front) with fresh `ord`s for `replaceNodes`, or null when nothing changes.
 */
export function reorderLayer(nodes, dragId, targetId, place = 'above') {
  if (dragId === targetId) return null;
  const list = [...nodes].sort(byOrd);
  const drag = list.find(n => n.id === dragId), target = list.find(n => n.id === targetId);
  if (!drag || !target || (drag.parentId ?? null) !== (target.parentId ?? null)) return null;
  const rest = list.filter(n => n.id !== dragId);
  const at = rest.indexOf(target) + (place === 'below' ? 0 : 1);
  const out = [...rest.slice(0, at), drag, ...rest.slice(at)];
  if (out.every((n, i) => n === list[i])) return null;
  return out.map((n, i) => ({ ...n, ord: i }));
}

/** Moves a layer one step among its siblings: `dir` 1 = toward the front (up in the Layers panel), -1 = toward the back. */
export function stepLayer(nodes, id, dir) {
  const node = nodes.find(n => n.id === id);
  if (!node) return null;
  const sibs = nodes.filter(n => (n.parentId ?? null) === (node.parentId ?? null)).sort(byOrd);
  const next = sibs[sibs.indexOf(node) + (dir > 0 ? 1 : -1)];
  return next ? reorderLayer(nodes, id, next.id, dir > 0 ? 'above' : 'below') : null;
}

/**
 * "Extract as element": the selected node, its sub tree and the shapes of its own level that lie fully inside it (the content
 * drawn on a card / bar), moved to the new element's origin. `bbox(node)` gives a node's box in the design.
 * Returns { box, nodes }: the element size is the box; the nodes keep their ids / parent ids (the store maps them) under one
 * wrapper group that shifts them by -box.x, -box.y. Full-screen backgrounds never come along.
 */
export function extractNodes(all, rootId, bbox) {
  const root = all.find(n => n.id === rootId);
  if (!root) return null;
  const box = bbox(root);
  const inside = b => b.w > 0 && b.h > 0 && b.x >= box.x - 0.5 && b.y >= box.y - 0.5 && b.x + b.w <= box.x + box.w + 0.5 && b.y + b.h <= box.y + box.h + 0.5;
  const take = new Set([root.id]);
  for (const n of all) {
    if (n.id === root.id || (n.parentId ?? null) !== (root.parentId ?? null) || n.role === 'bg' || n.role === 'bg-glow') continue;
    if ((n.ord ?? 0) >= (root.ord ?? 0) && inside(bbox(n))) take.add(n.id);
  }
  for (let grew = true; grew;) { grew = false; for (const n of all) if (!take.has(n.id) && take.has(n.parentId)) { take.add(n.id); grew = true; } }
  const WRAP = -1;
  const nodes = [{ id: WRAP, tag: 'g', name: 'content', parentId: null, ord: 0, visible: true, attrs: { transform: `translate(${-box.x} ${-box.y})` } }];
  for (const n of all.filter(x => take.has(x.id)).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))) {
    nodes.push({ ...n, parentId: take.has(n.parentId) ? n.parentId : WRAP });
  }
  return { box: { x: box.x, y: box.y, w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) }, nodes };
}
