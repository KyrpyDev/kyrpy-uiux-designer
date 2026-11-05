/**
 * Pen tool: draws a new path with bezier curves.
 *   click                 corner point                click + drag         smooth point (handles follow the drag)
 *   click the first point close the path              Enter / double-click finish an open path
 *   Backspace             remove the last point       Esc                  cancel
 * Hold Ctrl to bypass the grid snap.
 */
import { serializePath } from '/domain/path-data.js';
import { penToCommands } from '/domain/path-tools.js';
import { toast } from '../dom.js';

export class PenTool {
  constructor(designer) { this.d = designer; this.reset(); }

  reset() { this.pts = []; this.cursor = null; this.drag = null; }
  get drawing() { return this.d.tool === 'pen' && this.pts.length > 0; }

  nearFirst(p) { return this.pts.length >= 2 && Math.hypot(p.x - this.pts[0].x, p.y - this.pts[0].y) < 10 / this.d.view.z; }

  pointerDown(ev, p) {
    if (this.nearFirst(p)) { this.finish(true); return; }
    const q = this.d.snapPoint(p, ev.ctrlKey);
    this.pts.push({ x: q.x, y: q.y });
    this.drag = { i: this.pts.length - 1, start: p, moved: false };
    this.d.renderOverlay();
  }

  pointerMove(ev, p) {
    this.cursor = this.d.snapPoint(p, ev.ctrlKey);
    if (this.drag) {
      const pt = this.pts[this.drag.i];
      if (!this.drag.moved && Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) * this.d.view.z < 4) return true;
      this.drag.moved = true;
      pt.out = { x: this.cursor.x, y: this.cursor.y };
      pt.in = { x: 2 * pt.x - this.cursor.x, y: 2 * pt.y - this.cursor.y };
    }
    if (this.pts.length) this.d.renderOverlay();
    return this.pts.length > 0;
  }

  pointerUp() { this.drag = null; }

  /** Returns true when the key was used. */
  key(ev) {
    if (!this.pts.length) return false;
    const k = ev.key.toLowerCase();
    if (k === 'enter') { this.finish(false); return true; }
    if (k === 'escape') { this.reset(); this.d.renderOverlay(); toast('pen cancelled', 'info', 1200); return true; }
    if (k === 'backspace') { this.pts.pop(); this.drag = null; this.d.renderOverlay(); return true; }
    return false;
  }

  cancel() { if (this.pts.length) { this.reset(); this.d.renderOverlay(); } }

  async finish(closed) {
    // a double-click adds the same point twice: drop consecutive duplicates
    const pts = this.pts.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-6);
    this.reset();
    if (pts.length < 2) { this.d.renderOverlay(); return toast('A path needs at least two points'); }
    await this.d.createPenPath(penToCommands(pts, closed), closed);
    this.d.setTool('select');
  }

  /** Preview of the path being drawn (anchors, handles and the segment that follows the cursor). */
  renderOverlay(mk) {
    if (this.d.tool !== 'pen' || !this.pts.length) return;
    const z = this.d.view.z, pts = this.pts, last = pts.at(-1);
    const preview = [...pts];
    if (this.cursor && !this.drag) preview.push({ x: this.cursor.x, y: this.cursor.y });
    mk('path', { d: serializePath(penToCommands(preview, false), 3), fill: 'none', stroke: '#2e9bff', 'stroke-width': 1.8 / z, 'pointer-events': 'none' });
    for (const p of pts) {
      for (const h of [p.in, p.out]) if (h) {
        mk('line', { x1: p.x, y1: p.y, x2: h.x, y2: h.y, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 1 / z });
        mk('circle', { cx: h.x, cy: h.y, r: 4 / z, fill: '#ff4fd8', stroke: '#fff', 'stroke-width': 1 / z });
      }
    }
    pts.forEach((p, i) => {
      const s = 9 / z, close = i === 0 && this.cursor && this.nearFirst(this.cursor);
      mk('rect', { x: p.x - s / 2, y: p.y - s / 2, width: s, height: s, fill: close ? '#22c55e' : (p === last ? '#2e9bff' : '#fff'), stroke: '#2e9bff', 'stroke-width': 1.5 / z });
    });
  }
}
