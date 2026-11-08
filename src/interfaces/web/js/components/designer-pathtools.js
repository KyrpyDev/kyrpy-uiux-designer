/**
 * Path tools of the Designer, installed onto its prototype:
 * pathfinder (union, cut out, crop, exclude), crop tool, combine / break apart / join, reverse / simplify / apply transform,
 * group / ungroup, align / distribute, flip / rotate, the path tools bar and the right-click shape menu.
 * Structural edits send the whole node list once (one undo step); position edits send attribute patches.
 */
import { h, clear, toast, contextMenu } from '../dom.js';
import { ibtn } from '../icons.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { nodeBBox, translateAttrs } from '/domain/geometry.js';
import { pathfind, cropNode, worldCommands, styleAttrs } from '/domain/path-ops.js';
import { groupNodes, ungroupNodes, alignPatches, distributePatches, flipPatches, bakePatch, rotatePatch, unionBox } from '/domain/node-ops.js';
import { parsePath, serializePath } from '/domain/path-data.js';
import { reversePath, simplifyPath, joinPaths, combinePaths, breakApart } from '/domain/path-tools.js';
import { openEventsModal, openLineageModal } from './collab-modals.js';
import { openCopyMoveToProjectsModal } from './item-browser.js';
import { reloadLibrary } from '../actions.js';

const byOrd = (a, b) => a.ord - b.ord || a.id - b.id;
const OP_LABEL = { union: 'Union', subtract: 'Cut out', intersect: 'Crop', exclude: 'Exclude' };

const methods = {
  /** Selected nodes that are plain vector shapes. */
  vectorNodes() { return this.selectedNodes().filter(n => n.kind !== 'instance' && !['text', 'g', 'use'].includes(n.tag)); },

  async createPenPath(cmds, closed) {
    const glyph = this.isGlyph;
    await this.addNode({ tag: 'path', name: this.uniqueName('pen-path'), attrs: { d: serializePath(cmds, 3),
      ...(glyph ? {} : { fill: closed ? '{{accent}}' : 'none', stroke: closed ? 'none' : '{{accent}}', 'stroke-width': '{{sw}}', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) } });
  },

  /** Replaces the whole node list (group, boolean results, break apart ...). One undo step. */
  async applyNodeList(list, { select = null } = {}) {
    await this.mutate(async () => {
      this.doc = { ...(await api.replaceNodes(this.type, this.doc.id, list.map(n => ({ ...n })))) };
      this.selected = new Set(select ? select(this.doc.nodes) : []);
    });
  },

  /** Persists attribute patches [{id, attrs, rotation?}]. One undo step. */
  async applyPatches(patches) {
    if (!patches.length) return;
    await this.mutate(async () => {
      await Promise.all(patches.map(async p => {
        const body = { attrs: p.attrs };
        if (p.rotation !== undefined) body.rotation = p.rotation;
        Object.assign(this.byId(p.id), await api.patchNode(this.type, this.doc.id, p.id, body));
      }));
    });
  },

  needShapes(min, hint) {
    this.vtx.exit();
    const sel = this.selectedNodes(), vec = this.vectorNodes();
    if (sel.length !== vec.length) { toast('Select only paths and basic shapes (not text, groups or placed designs)', 'error'); return null; }
    if (vec.length < min) { toast(hint, 'error'); return null; }
    return [...vec].sort(byOrd);
  },

  /** Pathfinder: union | subtract (cut the top shape out of everything behind it) | intersect (crop) | exclude. */
  async pathfinder(op) {
    const sel = this.needShapes(2, op === 'subtract' ? 'Select the shape to cut out (on top) and the shape(s) behind it' : 'Select two or more shapes');
    if (!sel) return;
    let res; try { res = pathfind(op, sel, this.nodes); } catch (e) { return toast(e.message, 'error'); }
    if (!res) return toast('The result is empty: the shapes do not overlap', 'error');
    const back = sel[0], drop = new Set(sel.slice(1).map(n => n.id));
    const merged = { ...back, tag: 'path', kind: 'shape', rotation: 0, text: '', attrs: { ...styleAttrs(back), d: res.d, 'fill-rule': 'evenodd' } };
    const list = [...this.nodes].sort(byOrd).filter(n => !drop.has(n.id)).map(n => (n.id === back.id ? merged : n));
    await this.applyNodeList(list, { select: () => [back.id] });
    toast(`${OP_LABEL[op]}: ${res.rings.length} outline(s)`, 'ok', 1600);
  },

  /** Crop: every selected shape keeps only the part inside the rectangle. */
  async cropSelection(rect) {
    const sel = this.vectorNodes();
    if (!sel.length) return toast('Select the shapes to crop first, then drag the crop rectangle', 'error');
    const gone = new Set(), patched = new Map();
    for (const n of sel) {
      let r; try { r = cropNode(n, this.nodes, rect); } catch (e) { return toast(e.message, 'error'); }
      if (!r) gone.add(n.id); else patched.set(n.id, { ...n, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(n), d: r.d, 'fill-rule': 'evenodd' } });
    }
    const list = [...this.nodes].sort(byOrd).filter(n => !gone.has(n.id)).map(n => patched.get(n.id) || n);
    await this.applyNodeList(list, { select: () => [...patched.keys()] });
    toast(gone.size ? `Cropped; ${gone.size} shape(s) were outside and removed` : 'Cropped', 'ok', 1600);
  },

  cropToBox() { return this.cropSelection({ x: 0, y: 0, w: this.doc.width, h: this.doc.height }); },

  async combineSelected() {
    const sel = this.needShapes(2, 'Select two or more paths to combine'); if (!sel) return;
    const cmds = combinePaths(sel.map(n => worldCommands(n, this.nodes)));
    const back = sel[0], drop = new Set(sel.slice(1).map(n => n.id));
    const merged = { ...back, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(back), d: serializePath(cmds, 3), 'fill-rule': 'evenodd' } };
    await this.applyNodeList([...this.nodes].sort(byOrd).filter(n => !drop.has(n.id)).map(n => (n.id === back.id ? merged : n)), { select: () => [back.id] });
  },

  async breakApartSelected() {
    const sel = this.vectorNodes().filter(n => n.tag === 'path');
    if (!sel.length) return toast('Select a compound path first', 'error');
    let tmp = -10, made = 0;
    const list = [];
    for (const n of [...this.nodes].sort(byOrd)) {
      if (!sel.includes(n)) { list.push(n); continue; }
      const parts = breakApart(parsePath(n.attrs.d));
      if (parts.length < 2) { list.push(n); continue; }
      parts.forEach((p, k) => {
        const attrs = { ...n.attrs, d: serializePath(p, 3) };
        list.push(k === 0 ? { ...n, attrs } : { ...n, id: tmp--, name: this.uniqueName(`${n.name || 'path'}-part`), attrs });
        made++;
      });
    }
    if (!made) return toast('Nothing to break apart: the path has a single outline', 'error');
    await this.applyNodeList(list, { select: () => sel.map(n => n.id) });
  },

  /**
   * Icon tool: explodes the icon into plain, separate paths. Linked path instances become real path nodes (the link to
   * the library path is cut), every other shape becomes a path, compound paths are split into their outlines and
   * groups are dissolved. One undo step. Works on the selection, or on the whole icon when nothing is selected.
   */
  async explodeIcon() {
    if (this.type !== 'icon') return toast('Exploding is a tool of the icon designer', 'error');
    const sel = this.selectedNodes().filter(n => n.tag !== 'g');
    const targets = new Set((sel.length ? sel : this.nodes.filter(n => n.tag !== 'g')).map(n => n.id));
    const base = this.doc.name || this.doc.key || 'icon';
    let tmp = -10, made = 0, k = 0;
    const list = [];
    const push = (src, cmds, extra = {}) => {
      for (const part of breakApart(cmds)) {
        k++; made++;
        list.push({ ...src, ...extra, id: tmp--, parentId: null, kind: 'shape', tag: 'path', rotation: 0, name: `${base}-${k}`, refType: null, refId: null, text: null,
          attrs: { ...styleAttrs(src), ...(extra.attrs || {}), d: serializePath(part, 3) } });
      }
    };
    for (const n of [...this.nodes].sort(byOrd)) {
      if (n.tag === 'g' && n.kind !== 'instance') continue;      // groups are dissolved (their children keep their world position)
      if (!targets.has(n.id)) { list.push({ ...n, parentId: null }); continue; }
      if (n.kind === 'instance' && n.refType === 'path') {
        let rec; try { rec = await api.getDesign('path', n.refId); } catch { rec = null; }
        if (!rec?.nodes?.length) { list.push(n); continue; }
        const a = n.attrs || {}, w = Number(a.width) || rec.width, hh = Number(a.height) || rec.height;
        const tf = `translate(${Number(a.x) || 0} ${Number(a.y) || 0}) scale(${w / rec.width} ${hh / rec.height})`;
        for (const t of rec.nodes) {
          const cmds = worldCommands(t, rec.nodes); if (!cmds) continue;
          const baked = worldCommands({ tag: 'path', kind: 'shape', attrs: { d: serializePath(cmds, 4), transform: tf } }, []);
          if (baked) push(t, baked, { role: t.role ?? null, ord: n.ord, visible: n.visible });
        }
      } else if (n.kind !== 'instance' && n.tag !== 'text') {
        const cmds = worldCommands(n, this.nodes);
        if (cmds) push(n, cmds, { ord: n.ord });
        else list.push({ ...n, parentId: null });
      } else list.push({ ...n, parentId: null });
    }
    if (!made) return toast('Nothing to explode: the icon has no paths or shapes', 'error');
    list.forEach((n, i) => { n.ord = i + 1; });
    await this.applyNodeList(list, { select: () => [] });
    toast(`Exploded into ${made} path(s). Select some and use "Save paths to my library"`, 'ok', 3200);
  },

  /** Saves the selected paths (all paths when nothing is selected) as separate items of the user's own path library, named <icon name>-<icon id>-<n>. */
  async savePathsToLibrary() {
    const chosen = this.selectedNodes().filter(n => n.tag === 'path');
    const paths = chosen.length ? chosen : this.nodes.filter(n => n.tag === 'path' && n.kind !== 'instance');
    if (!paths.length) return toast('No paths to save: explode the icon first', 'error');
    const base = `${this.doc.name || this.doc.key || 'icon'}-${this.doc.id}`;
    let saved = 0;
    for (const [i, n] of paths.entries()) {
      const cmds = worldCommands(n, this.nodes); if (!cmds) continue;
      try {
        await api.createDesign('path', { name: `${base}-${i + 1}`, category: 'custom', visibility: 'private', projectId: state.activeProjectId,
          nodes: [{ tag: 'path', kind: 'shape', role: n.role ?? null, name: 'path', attrs: { ...styleAttrs(n), d: serializePath(cmds, 3) } }] });
        saved++;
      } catch (e) { toast(`${base}-${i + 1}: ${e.message}`, 'error'); }
    }
    if (saved) { await reloadLibrary({ silent: true }).catch(() => {}); toast(`Saved ${saved} path(s) to your path library as "${base}-n"`, 'ok', 3200); }
  },

  async joinSelected() {
    const sel = this.needShapes(2, 'Select two open paths to join'); if (!sel) return;
    if (sel.length !== 2) return toast('Select exactly two open paths', 'error');
    const [a, b] = sel.map(n => worldCommands(n, this.nodes));
    if ([a, b].some(c => c.at(-1).t === 'Z')) return toast('Only open paths can be joined (use "Cut here" on a closed path first)', 'error');
    const merged = { ...sel[0], tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(sel[0]), d: serializePath(joinPaths(a, b), 3) } };
    await this.applyNodeList([...this.nodes].sort(byOrd).filter(n => n.id !== sel[1].id).map(n => (n.id === sel[0].id ? merged : n)), { select: () => [sel[0].id] });
  },

  pathNodes() { const p = this.vectorNodes().filter(n => n.tag === 'path'); if (!p.length) toast('Select a path first', 'error'); return p; },

  reverseSelected() {
    const p = this.pathNodes();
    return this.applyPatches(p.map(n => ({ id: n.id, attrs: { ...n.attrs, d: serializePath(reversePath(parsePath(n.attrs.d)), 3) } })));
  },

  simplifySelected() {
    const p = this.pathNodes(), tol = this.isGlyph ? 0.05 : Math.max(0.3, this.gridSize / 20);
    const patches = p.map(n => ({ id: n.id, attrs: { ...n.attrs, d: serializePath(simplifyPath(parsePath(n.attrs.d), tol), 3) }, was: n.attrs.d })).filter(q => q.attrs.d !== q.was).map(({ was, ...q }) => q);
    return patches.length ? this.applyPatches(patches) : toast('Nothing to simplify', 'info', 1400);
  },

  bakeSelected() {
    const patches = this.vectorNodes().filter(n => n.tag === 'path' && (n.attrs.transform || n.rotation)).map(n => bakePatch(n, this.nodes));
    return patches.length ? this.applyPatches(patches) : toast('Nothing to apply: the path has no transform or rotation', 'info', 1600);
  },

  async groupSelected() {
    if (!this.selected.size) return toast('Select what you want to group', 'error');
    this.vtx.exit();
    try {
      const before = new Set(this.nodes.map(n => n.id));
      const { nodes } = groupNodes(this.nodes, [...this.selected], this.uniqueName('group'));
      await this.applyNodeList(nodes, { select: ns => ns.filter(n => n.tag === 'g' && !before.has(n.id)).map(n => n.id) });
    } catch (e) { toast(e.message, 'error'); }
  },

  async ungroupSelected() {
    const groups = this.selectedNodes().filter(n => n.tag === 'g');
    if (!groups.length) return toast('Select a group first', 'error');
    this.vtx.exit();
    try {
      let list = [...this.nodes]; const kids = [];
      for (const g of groups) { const r = ungroupNodes(list, g.id); list = r.nodes; kids.push(...r.childIds); }
      await this.applyNodeList(list, { select: () => kids });
    } catch (e) { toast(e.message, 'error'); }
  },

  alignSelected(mode) {
    if (!this.selected.size) return toast('Select something to align', 'error');
    return this.applyPatches(alignPatches(this.nodes, [...this.selected], mode, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }));
  },

  distributeSelected(axis) {
    const p = distributePatches(this.nodes, [...this.selected], axis);
    return p.length ? this.applyPatches(p) : toast('Select three or more items to distribute', 'error');
  },

  flipSelected(axis) {
    if (!this.selected.size) return toast('Select something to flip', 'error');
    this.vtx.exit();
    return this.applyPatches(flipPatches(this.nodes, [...this.selected], axis));
  },

  rotateSelected(deg) {
    const sel = this.selectedNodes();
    if (!sel.length) return toast('Select something to rotate', 'error');
    this.vtx.exit();
    const box = unionBox(sel.map(n => nodeBBox(n, this.nodes))), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return this.applyPatches(sel.map(n => (n.tag === 'path' && n.parentId == null ? rotatePatch(n, this.nodes, deg, cx, cy) : { id: n.id, attrs: n.attrs, rotation: ((n.rotation || 0) + deg) % 360 })));
  },

  async toggleLockSelected() {
    const sel = this.selectedNodes();
    if (!sel.length) return toast('Select an element to lock/unlock', 'error');
    const nextLocked = !sel.every(n => n.locked);
    await this.mutate(async () => {
      for (const n of sel) {
        const saved = await api.patchNode(this.type, this.doc.id, n.id, { locked: nextLocked });
        Object.assign(n, saved);
      }
    });
    toast(nextLocked ? `🔒 Locked ${sel.length} element(s)` : `🔓 Unlocked ${sel.length} element(s)`, 'ok', 1400);
  },

  copySelectedStyle() {
    const sel = this.selectedNodes()[0];
    if (!sel) return toast('Select an element to copy its style', 'error');
    state.copiedStyle = {
      role: sel.role,
      fill: sel.attrs?.fill,
      stroke: sel.attrs?.stroke,
      'stroke-width': sel.attrs?.['stroke-width'],
      opacity: sel.attrs?.opacity,
      rx: sel.attrs?.rx
    };
    toast('Copied style from "' + (sel.name || sel.tag) + '"', 'ok', 1400);
  },

  async pasteSelectedStyle() {
    if (!state.copiedStyle) return toast('Copy a style first', 'error');
    const sel = this.selectedNodes();
    if (!sel.length) return toast('Select target element(s) to paste style', 'error');
    const st = state.copiedStyle;
    await this.mutate(async () => {
      for (const n of sel) {
        const attrs = { ...n.attrs };
        for (const k of ['fill', 'stroke', 'stroke-width', 'opacity', 'rx']) {
          if (st[k] !== undefined) attrs[k] = st[k];
        }
        const saved = await api.patchNode(this.type, this.doc.id, n.id, { role: st.role, attrs });
        Object.assign(n, saved);
      }
    });
    toast('Pasted style onto selected element(s)', 'ok', 1400);
  },

  async arrayDuplicateSelected() {
    const sel = this.selectedNodes();
    if (!sel.length) return toast('Select an element to duplicate in a 2×2 grid', 'error');
    const base = sel[0];
    const b = nodeBBox(base, this.nodes);
    const gap = Math.max(12, this.gridSize * 2);
    const offsets = [
      [b.w + gap, 0],
      [0, b.h + gap],
      [b.w + gap, b.h + gap]
    ];
    await this.mutate(async () => {
      for (const [dx, dy] of offsets) {
        const dup = await api.duplicateNode(this.type, this.doc.id, base.id);
        const movedAttrs = translateAttrs(base, dx, dy);
        await api.patchNode(this.type, this.doc.id, dup.id, { attrs: movedAttrs });
      }
      await this.reload(false);
    });
    toast('Created 2×2 grid array duplicate', 'ok', 1600);
  },

  buildPathBar() {
    const bar = this.pathBar; clear(bar);
    const I = (icon, tip, fn, desc = '') => ibtn(icon, tip, fn, { desc, size: 17 });
    const sep = () => h('span', { class: 'sep-v' });
    bar.append(
      I('unite', 'Union', () => this.pathfinder('union'), 'Merge the selected shapes into one outline'),
      I('subtract', 'Cut out', () => this.pathfinder('subtract'), 'Cut the top shape out of the shapes behind it'),
      I('intersect', 'Crop (intersect)', () => this.pathfinder('intersect'), 'Keep only the part where the selected shapes overlap'),
      I('exclude', 'Exclude', () => this.pathfinder('exclude'), 'Keep everything except where the shapes overlap'),
      I('cropBox', 'Crop to box', () => this.cropToBox(), 'Trim the selected shapes to the bounding box of this design'), sep(),
      I('combine', 'Combine', () => this.combineSelected(), 'Make one compound path from the selected paths'),
      I('breakApart', 'Break apart', () => this.breakApartSelected(), 'Split a compound path into separate paths'),
      I('join', 'Join', () => this.joinSelected(), 'Join two open paths end to end'),
      ...(this.type === 'icon' ? [I('breakApart', 'Explode icon into paths', () => this.explodeIcon(), 'Break the icon (or the selection) apart into separate plain paths: linked path items become real paths, shapes become paths, compound paths are split'),
        I('export', 'Save paths to my library', () => this.savePathsToLibrary(), 'Save the selected paths (all when nothing is selected) as your own paths, auto-named <icon name>-<icon id>-<n>')] : []),
      I('reverse', 'Reverse', () => this.reverseSelected(), 'Reverse the direction of the selected path'),
      I('simplify', 'Simplify', () => this.simplifySelected(), 'Remove redundant vertices'),
      I('applyT', 'Apply transform', () => this.bakeSelected(), "Bake the path's transform and rotation into its points"), sep(),
      I('group', 'Group', () => this.groupSelected(), 'Group the selection (Ctrl+G)'),
      I('ungroup', 'Ungroup', () => this.ungroupSelected(), 'Dissolve the selected group (Ctrl+Shift+G)'), sep(),
      I('alignLeft', 'Align left', () => this.alignSelected('left'), 'Align to the selection (or to the box when one item is selected)'),
      I('alignHCenter', 'Align horizontal centres', () => this.alignSelected('hcenter')),
      I('alignRight', 'Align right', () => this.alignSelected('right')),
      I('alignTop', 'Align top', () => this.alignSelected('top')),
      I('alignVMiddle', 'Align vertical centres', () => this.alignSelected('vmiddle')),
      I('alignBottom', 'Align bottom', () => this.alignSelected('bottom')),
      I('distH', 'Distribute horizontally', () => this.distributeSelected('h'), '3+ items'),
      I('distV', 'Distribute vertically', () => this.distributeSelected('v'), '3+ items'), sep(),
      I('flip', 'Flip horizontally', () => this.flipSelected('h')),
      I('flipV', 'Flip vertically', () => this.flipSelected('v')),
      I('rotate', 'Rotate 90° clockwise', () => this.rotateSelected(90)),
      I('rotateCcw', 'Rotate 90° counter-clockwise', () => this.rotateSelected(-90)), sep(),
      I('lock', 'Lock / unlock position', () => this.toggleLockSelected(), 'Lock or unlock the selected element position (Ctrl+L)'),
      I('zap', 'Events', () => {
        const one = this.selectedNodes()[0];
        if (!one) return toast('Select an element first', 'error');
        openEventsModal({ node: one, docType: this.type, docId: this.doc.id, onSave: patch => this.patchNode(one.id, patch) });
      }, 'Configure element events (click, mouseover, release, drag&drop)'),
      I('grid', '2×2 grid array', () => this.arrayDuplicateSelected(), 'Duplicate the selected element into a 2×2 grid'),
      I('copy', 'Copy style', () => this.copySelectedStyle(), 'Copy fill / stroke / role style from the selected element'),
      I('paste', 'Paste style', () => this.pasteSelectedStyle(), 'Paste the copied style onto the selected element(s)')
    );
  },

  /** Reference point (9-point grid) of this design; centre ('mc') by default. Stored in the design's meta. */
  getRefPoint() {
    return this.doc?.meta?.refPoint || this._refPointLocal || 'mc';
  },
  setRefPoint(a) {
    this._refPointLocal = a;
    if (this.doc && this.isOwnedByCurrentUser(this.doc)) this.updateDoc({ meta: { ...(this.doc.meta || {}), refPoint: a } });
  },

  /** Right-click: in vertex mode adds / removes vertices; otherwise the enhanced element & shape context menu. */
  async onContext(ev) {
    ev.preventDefault();
    if (!this.doc || ev.target.closest?.('.vbar, .rm-toolbar, .el-hover-toolbar')) return;
    if (this.vtx.active) { await this.vtx.contextMenu(ev, this.worldPoint(ev)); return; }
    if (this.tool === 'pen') { if (this.pen.pts.length) await this.pen.finish(false); return; }
    const hit = this.hitNode(ev.target);
    if (hit && hit.role !== 'bg' && hit.role !== 'bg-glow') this.toolbarNodeId = hit.id;   // right-click also opens the quick toolbar
    if (hit && !this.selected.has(hit.id)) this.select([hit.id]); else this.updateHoverToolbar();
    const sel = this.selectedNodes(), one = sel.length === 1 ? sel[0] : null, editor = one ? this.editorFor(one) : null, vec = this.vectorNodes(), many = vec.length > 1 && vec.length === sel.length, has = sel.length > 0;
    contextMenu(ev.clientX, ev.clientY, [
      { label: '✎ Open editor', kbd: editor ? editor.label : '', disabled: !editor || editor.disabled, fn: () => this.openEditor(one) },
      { label: '✦ Edit vertices', kbd: 'Enter', disabled: !(one && this.vtx.canEdit(one)), fn: () => this.vtx.enter(one) },
      '-',
      {
        label: '⚡ Configure Events (click, mouseover, release, drag&drop)…',
        disabled: !one,
        fn: () => openEventsModal({ node: one, docType: this.type, docId: this.doc.id, onSave: patch => this.patchNode(one.id, patch) })
      },
      {
        label: '🧰 Attach Small Element Floating Toolbar',
        disabled: !one,
        fn: async () => {
          const tbEl = state.library.elements.find(x => x.key === 'html-floating-toolbar');
          const evs = [...(one.events || []).filter(x => !(x.trigger === 'click' && x.type === 'toolbar')), { trigger: 'click', type: 'toolbar', ...(tbEl ? { targetId: tbEl.id } : {}), position: 'top' }];
          await this.patchNode(one.id, { events: evs });
          this.showToolbarPreview(one, { type: 'toolbar', targetId: tbEl?.id, position: 'top' });
        }
      },
      {
        label: '✨ Add Animation (3D Flip / Pulse)',
        disabled: !one,
        fn: () => this.addAnimation(one.id, 'flip')
      },
      {
        label: one?.locked ? '🔓 Unlock Position' : '🔒 Lock Position on Screen',
        kbd: 'Ctrl+L',
        disabled: !has,
        fn: () => this.toggleLockSelected()
      },
      '-',
      { label: '🎨 Copy Style', disabled: !one, fn: () => this.copySelectedStyle() },
      { label: '🖌 Paste Style', disabled: !has || !state.copiedStyle, fn: () => this.pasteSelectedStyle() },
      { label: '⊞ Array Duplicate (2×2 Grid)', disabled: !one, fn: () => this.arrayDuplicateSelected() },
      { label: '⌖ Place at Centre of Screen', disabled: !has, fn: () => this.placeSelected('MC', 0) },
      '-',
      { label: 'Group', kbd: 'Ctrl+G', disabled: !has, fn: () => this.groupSelected() },
      { label: 'Ungroup', kbd: 'Ctrl+Shift+G', disabled: !sel.some(n => n.tag === 'g'), fn: () => this.ungroupSelected() },
      '-',
      { label: '∪ Union', disabled: !many, fn: () => this.pathfinder('union') },
      { label: '✂ Cut out (top shape)', disabled: !many, fn: () => this.pathfinder('subtract') },
      { label: '∩ Crop (intersect)', disabled: !many, fn: () => this.pathfinder('intersect') },
      { label: '⊻ Exclude', disabled: !many, fn: () => this.pathfinder('exclude') },
      { label: 'Combine', disabled: !many, fn: () => this.combineSelected() },
      { label: 'Break apart', disabled: !vec.some(n => n.tag === 'path'), fn: () => this.breakApartSelected() },
      '-',
      { label: '⇋ Flip horizontally', disabled: !has, fn: () => this.flipSelected('h') },
      { label: '⇵ Flip vertically', disabled: !has, fn: () => this.flipSelected('v') },
      { label: '↻ Rotate 90°', disabled: !has, fn: () => this.rotateSelected(90) },
      '-',
      { label: 'Bring to front', disabled: !has, fn: () => this.reorder('front') }, { label: 'Send to back', disabled: !has, fn: () => this.reorder('back') },
      { label: 'Duplicate', kbd: 'Ctrl+D', disabled: !has, fn: () => this.duplicateSelected() }, { label: 'Delete', kbd: 'Del', disabled: !has, fn: () => this.deleteSelected() },
      '-',
      {
        label: '📥 Copy Item to Projects (with sub-items)…',
        fn: () => {
          const itemRef = (one && one.kind === 'instance' && one.refType && one.refId)
            ? { type: one.refType, id: one.refId, name: one.name }
            : { type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key };
          openCopyMoveToProjectsModal({ items: [itemRef], mode: 'copy' });
        }
      },
      {
        label: '📤 Move Item to Projects (with sub-items)…',
        fn: () => {
          const itemRef = (one && one.kind === 'instance' && one.refType && one.refId)
            ? { type: one.refType, id: one.refId, name: one.name }
            : { type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key };
          openCopyMoveToProjectsModal({ items: [itemRef], mode: 'move' });
        }
      },
      { label: '🧬 View Item Lineage & Root Owner…', fn: () => openLineageModal(this.type, this.doc.id) }
    ]);
  }
};

export function installPathTools(DesignerClass) {
  for (const [name, fn] of Object.entries(methods)) Object.defineProperty(DesignerClass.prototype, name, { value: fn, writable: true, configurable: true });
}
