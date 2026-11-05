/**
 * Visual vertex editing of paths (and of any basic shape, which is converted to a path first).
 *  - drag anchors and bezier handles          - double-click a segment: insert a vertex
 *  - Delete / Alt+click: remove the vertex     - line <-> curve for the selected vertex's segment
 *  - open / close the path                     - Enter / Esc / Done: leave vertex mode
 * Coordinates are shown in design space and edited in the node's local space (translate + scale of the node and its groups).
 */
import { h, toast } from '../dom.js';
import { state } from '../state.js';
import { parsePath, serializePath, editPoints, moveAnchor, moveHandle, insertPoint, deletePoint, convertSegment, toggleClosed,
  shapeToCommands, isVertexEditable, startPoint, mapCommands, arcToCubics } from '/domain/path-data.js';
import { parseTransform, snap } from '/domain/geometry.js';
import { vertexKind, makeSmooth, makeCorner, mirrorHandle, cutAt, reversePath, simplifyPath, roundCorner } from '/domain/path-tools.js';
import { promptBox } from '../dom.js';

const GEOMETRY_ATTRS = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd'];
const deep = o => JSON.parse(JSON.stringify(o));

export class VertexEditor {
  constructor(designer) {
    this.d = designer; this.active = false; this.node = null; this.cmds = []; this.sel = null; this.drag = null; this.bar = null;
  }

  canEdit(node) { return !!node && node.kind !== 'instance' && isVertexEditable(node.tag) && !node.rotation && !node.locked; }

  /** Starts vertex mode for a node. Non-path shapes are converted to a path first (one undo step). */
  async enter(node) {
    if (!this.canEdit(node)) return toast(node?.rotation ? 'Reset the rotation to 0 to edit vertices' : 'This element has no vertices to edit', 'error');
    let cmds = shapeToCommands(node.tag, node.attrs);
    if (!cmds?.length) return toast('Nothing to edit in this shape', 'error');
    if (node.tag !== 'path') {
      const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !GEOMETRY_ATTRS.includes(k)));
      attrs.d = serializePath(cmds, 3);
      if (node.tag === 'line' || node.tag === 'polyline') attrs.fill = attrs.fill ?? 'none';
      await this.d.patchNode(node.id, { tag: 'path', attrs });
      node = this.d.byId(node.id);
      toast('converted to a path - its vertices are editable now', 'ok', 1800);
    }
    this.node = node; this.cmds = cmds; this.sel = null; this.active = true;
    this.d.select([node.id]);
    this.showBar();
    this.d.renderOverlay();
  }

  exit() {
    if (!this.active) return;
    this.active = false; this.node = null; this.drag = null; this.sel = null;
    this.bar?.remove(); this.bar = null;
    this.d.renderOverlay();
  }

  /* ---------- coordinate mapping (node + ancestor transforms) ---------- */
  transform() {
    let n = this.node, tf = { sx: 1, sy: 1, tx: 0, ty: 0 };
    const all = this.d.nodes;
    for (let guard = 0; n && guard < 10; guard++) {
      const t = parseTransform(n.attrs.transform);
      tf = { sx: tf.sx * t.sx, sy: tf.sy * t.sy, tx: t.tx * tf.sx + tf.tx, ty: t.ty * tf.sy + tf.ty };
      n = n.parentId != null ? all.find(x => x.id === n.parentId) : null;
    }
    return tf;
  }
  toWorld(p) { const t = this.transform(); return { x: p.x * t.sx + t.tx, y: p.y * t.sy + t.ty }; }
  toLocal(p) { const t = this.transform(); return { x: (p.x - t.tx) / (t.sx || 1), y: (p.y - t.ty) / (t.sy || 1) }; }
  step() { return ['path', 'icon'].includes(this.d.type) ? 0.5 : Math.max(1, this.d.gridSize / 4); }
  snapWorld(p, bypass) { if (!state.settings.snapToGrid || bypass) return p; const s = this.step(); return { x: snap(p.x, s), y: snap(p.y, s) }; }

  /* ---------- overlay ---------- */
  renderOverlay(mk) {
    if (!this.active) return;
    const z = this.d.view.z, t = this.transform();
    const world = mapCommands(this.cmds, x => x * t.sx + t.tx, y => y * t.sy + t.ty);
    mk('path', { d: serializePath(world, 3), fill: 'none', stroke: '#2e9bff', 'stroke-width': 1.6 / z, 'stroke-dasharray': `${5 / z} ${3 / z}`, 'pointer-events': 'none' });
    const { anchors, handles } = editPoints(world);
    for (const hd of handles) {
      mk('line', { x1: hd.ax, y1: hd.ay, x2: hd.x, y2: hd.y, stroke: 'rgba(255,255,255,.45)', 'stroke-width': 1 / z });
      if (hd.which === 'q') mk('line', { x1: hd.bx, y1: hd.by, x2: hd.x, y2: hd.y, stroke: 'rgba(255,255,255,.45)', 'stroke-width': 1 / z });
    }
    for (const hd of handles) {
      const el = mk('circle', { cx: hd.x, cy: hd.y, r: 4.5 / z, class: 'vh vh-handle', 'data-v': 'h', 'data-i': hd.i, 'data-which': hd.which });
      if (this.sel?.kind === 'h' && this.sel.i === hd.i && this.sel.which === hd.which) el.classList.add('on');
    }
    for (const a of anchors) {
      const s = 9 / z, el = mk('rect', { x: a.x - s / 2, y: a.y - s / 2, width: s, height: s, class: `vh vh-anchor${a.i === 0 ? ' first' : ''}`, 'data-v': 'a', 'data-i': a.i });
      if (this.sel?.kind === 'a' && this.sel.i === a.i) el.classList.add('on');
    }
  }

  /* ---------- pointer ---------- */
  pointerDown(ev) {
    const t = ev.target;
    if (!t.dataset?.v) return false;
    const kind = t.dataset.v, i = Number(t.dataset.i), which = t.dataset.which;
    if (kind === 'a' && ev.altKey) { this.remove(i); return true; }
    this.sel = { kind, i, which };
    const owner = which === 'c2' ? i : i - 1;
    const smooth = kind === 'h' && !ev.altKey && owner >= 0 && vertexKind(this.cmds, owner) === 'smooth';
    this.drag = { kind, i, which, snap: this.d.snapshot(), moved: false, start: deep(this.cmds), smooth };
    this.d.renderOverlay();
    this.updateBar();
    return true;
  }

  pointerMove(ev, p) {
    if (!this.drag) return false;
    const q = this.toLocal(this.snapWorld(p, ev.ctrlKey));
    this.drag.moved = true; this.d.dragging = true;
    this.cmds = this.drag.kind === 'a' ? moveAnchor(this.drag.start, this.drag.i, q.x, q.y) : moveHandle(this.drag.start, this.drag.i, this.drag.which, q.x, q.y);
    if (this.drag.kind === 'h' && this.drag.smooth) this.cmds = mirrorHandle(this.cmds, this.drag.i, this.drag.which, ev.shiftKey ? 'symmetric' : 'smooth');
    this.applyLocal();
    return true;
  }

  async pointerUp() {
    if (!this.drag) return false;
    const dr = this.drag; this.drag = null; this.d.dragging = false;
    if (dr.moved) await this.commit(dr.snap); else this.d.renderStage();
    return true;
  }

  /** Writes the commands into the node (locally; no persistence) and redraws. */
  applyLocal() {
    this.node.attrs = { ...this.node.attrs, d: serializePath(this.cmds, 3) };
    this.d.renderStage(); this.d.renderOverlay();
  }

  async commit(undoSnap) {
    const d = serializePath(this.cmds, 3);
    this.node.attrs = { ...this.node.attrs, d };
    try {
      await this.d.api.patchNode(this.d.type, this.d.doc.id, this.node.id, { attrs: this.node.attrs });
      if (undoSnap) this.d.pushUndo(undoSnap);
      this.d.changed();
    } catch (e) { toast(e.message, 'error'); await this.d.reload(); this.exit(); return; }
    this.d.renderStage(); this.d.renderOverlay(); this.updateBar();
  }

  async edit(fn) {
    const next = fn(this.cmds);
    if (!next) return toast('That edit is not possible here', 'error');
    const snapshot = this.d.snapshot();
    this.cmds = next; this.applyLocal();
    await this.commit(snapshot);
  }

  async remove(i) { const s = this.d.snapshot(); const next = deletePoint(this.cmds, i); if (!next) return toast('A path needs at least two vertices', 'error'); this.cmds = next; this.sel = null; this.applyLocal(); await this.commit(s); }

  /** Double-click on the path: insert a vertex where the pointer is. */
  async insertAt(p) {
    const local = this.toLocal(p), tol = 12 / this.d.view.z / (this.transform().sx || 1);
    let best = null;
    this.cmds.forEach((c, i) => {
      if (c.t === 'M') return;
      const a = startPoint(this.cmds, i);
      let segs;
      if (c.t === 'A') segs = null;
      const pts = c.t === 'Z' ? [a, this.cmds.slice(0, i).reverse().find(x => x.t === 'M')] : null;
      const sample = k => {
        const t = k / 24;
        if (c.t === 'L') return { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t };
        if (c.t === 'Z') { const m = pts[1]; return { x: a.x + (m.x - a.x) * t, y: a.y + (m.y - a.y) * t }; }
        if (c.t === 'Q') { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * c.x1 + t * t * c.x, y: u * u * a.y + 2 * u * t * c.y1 + t * t * c.y }; }
        if (c.t === 'C') { const u = 1 - t; return { x: u ** 3 * a.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x, y: u ** 3 * a.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y }; }
        const cs = arcToCubics(a, c);   // arcs: sample the equivalent cubics
        const per = 24 / cs.length, idx = Math.min(cs.length - 1, Math.floor(k / per)), tt = (k - idx * per) / per, st = idx ? cs[idx - 1] : a, q = cs[idx], u = 1 - tt;
        if (q.t === 'L') return { x: st.x + (q.x - st.x) * tt, y: st.y + (q.y - st.y) * tt };
        return { x: u ** 3 * st.x + 3 * u * u * tt * q.x1 + 3 * u * tt * tt * q.x2 + tt ** 3 * q.x, y: u ** 3 * st.y + 3 * u * u * tt * q.y1 + 3 * u * tt * tt * q.y2 + tt ** 3 * q.y };
      };
      for (let k = 0; k <= 24; k++) {
        const s = sample(k), dist = Math.hypot(s.x - local.x, s.y - local.y);
        if (!best || dist < best.dist) best = { i, t: k / 24, dist };
      }
      void segs;
    });
    if (!best || best.dist > tol) return false;
    await this.edit(cmds => insertPoint(cmds, best.i, Math.min(0.98, Math.max(0.02, best.t))));
    return true;
  }

  /** Right-click: on a vertex removes it, on the line adds a vertex there. Returns true when handled. */
  async contextMenu(ev, p) {
    const t = ev.target;
    if (t.dataset?.v === 'a') { await this.remove(Number(t.dataset.i)); return true; }
    if (t.dataset?.v === 'h') return true;
    if (await this.insertAt(p)) return true;
    toast('Right-click ON the line to add a vertex, or on a vertex to remove it', 'info', 1800);
    return true;
  }

  /* ---------- vertex tools ---------- */
  needVertex() { if (this.sel?.kind !== 'a') { toast('Select a vertex first (click it)'); return false; } return true; }
  smooth() { if (this.needVertex()) this.edit(c => makeSmooth(c, this.sel.i)); }
  corner() { if (this.needVertex()) this.edit(c => makeCorner(c, this.sel.i)); }
  cutHere() { if (this.needVertex()) { this.edit(c => cutAt(c, this.sel.i)); this.sel = null; } }
  reverse() { this.edit(c => reversePath(c)); }
  simplify() { this.edit(c => { const n = simplifyPath(c, this.step() / 2); return n.length < c.length ? n : (toast('Nothing to simplify', 'info', 1200), null); }); }
  async round() {
    if (this.sel?.kind !== 'a') return toast('Select the corner vertex first (click it)');
    const r = await promptBox('Round corner', { label: 'Radius', value: String(Math.max(1, Math.round(this.d.gridSize))), okLabel: 'Round' });
    const radius = parseFloat(r);
    if (!(radius > 0)) return;
    this.edit(c => roundCorner(c, this.sel.i, radius));
  }

  /* ---------- keyboard ---------- */
  key(ev) {
    const k = ev.key.toLowerCase();
    if (k === 'escape' || k === 'enter') { this.exit(); return true; }
    if ((k === 'delete' || k === 'backspace') && this.sel?.kind === 'a') { this.remove(this.sel.i); return true; }
    if (k === 'c' && this.sel?.kind === 'a') { this.toggleCurve(); return true; }
    if (k === 's' && this.sel?.kind === 'a') { this.smooth(); return true; }
    if (k === 'k' && this.sel?.kind === 'a') { this.corner(); return true; }
    return false;
  }

  toggleCurve() {
    if (this.sel?.kind !== 'a') return toast('Select a vertex first (click it)');
    const c = this.cmds[this.sel.i];
    this.edit(cmds => convertSegment(cmds, this.sel.i, c.t === 'C' ? 'line' : 'curve'));
  }

  /* ---------- floating toolbar ---------- */
  showBar() {
    this.bar?.remove();
    const b = (label, title, fn) => h('button', { class: 'btn small', title, onclick: fn }, label);
    this.info = h('span', { class: 'muted' }, '');
    this.bar = h('div', { class: 'vbar', role: 'toolbar', 'aria-label': 'Vertex editing' },
      h('b', {}, 'Vertex editing'),
      b('Line ⇄ Curve', 'Turn the segment that ends at the selected vertex into a line or a curve (C)', () => this.toggleCurve()),
      b('Smooth', 'Give the selected vertex collinear handles (S)', () => this.smooth()),
      b('Corner', 'Retract the handles of the selected vertex (K)', () => this.corner()),
      b('Round…', 'Round the selected corner with a radius', () => this.round()),
      b('Split', 'Insert a vertex in the middle of the segment that ends at the selected vertex', () => (this.sel?.kind === 'a' ? this.edit(cmds => insertPoint(cmds, this.sel.i, 0.5)) : toast('Select a vertex first (click it)'))),
      b('Delete', 'Delete the selected vertex (Del, Alt+click or right-click it)', () => (this.sel?.kind === 'a' ? this.remove(this.sel.i) : toast('Select a vertex first (click it)'))),
      b('Cut here', 'Open the path at the selected vertex (a closed path becomes open, an open one is split in two)', () => this.cutHere()),
      b('Close / open', 'Close the path with a straight segment, or open it again', () => this.edit(toggleClosed)),
      b('Reverse', 'Reverse the direction of the path', () => this.reverse()),
      b('Simplify', 'Remove redundant vertices from straight runs', () => this.simplify()),
      this.info, h('span', { class: 'grow' }), b('Done', 'Leave vertex mode (Esc / Enter)', () => this.exit()));
    this.d.viewport.appendChild(this.bar);
    this.updateBar();
  }

  updateBar() {
    if (!this.info) return;
    const anchors = this.cmds.filter(c => c.t !== 'Z').length;
    this.info.textContent = `${anchors} vertices${this.sel?.kind === 'a' ? ` · vertex ${this.sel.i} selected` : ''} · right-click the line to add a vertex, right-click a vertex to remove it · Alt breaks a smooth handle, Shift mirrors it · Ctrl = no snapping`;
  }
}

export { parsePath };
