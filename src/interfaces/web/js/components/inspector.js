/** Right-hand property inspector of a Designer: design record, selection, geometry, style, animations. */
import { h, clear, toast } from '../dom.js';
import { state, currentTheme, findDesign } from '../state.js';
import { api } from '../api.js';
import { menuActions } from './menu-editor.js';
import { MENU_LAYOUTS, MENU_KINDS, DEFAULT_MENU, TYPES, DRAWER_SIDES } from '/domain/entities.js';
import { buildMenuTree } from '/domain/menu.js';
import { isVertexEditable } from '/domain/path-data.js';
import { nodeBBox, translateAttrs, resizeAttrs, ANCHORS } from '/domain/geometry.js';
import { ANIMATION_TYPES, TRIGGERS, EASINGS } from '/domain/animation.js';
import { SURFACE_ROLES } from '/domain/theme.js';
import { DEVICES, VISIBILITY_LEVELS } from '/domain/entities.js';
import { isValidKey } from '/domain/naming.js';
import { openEventsModal, openLineageModal } from './collab-modals.js';

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const PARAM_FIELDS = {
  move: [['fromX', 'from X'], ['fromY', 'from Y'], ['toX', 'to X'], ['toY', 'to Y']],
  rotate: [['from', 'from °'], ['to', 'to °']],
  scale: [['from', 'from'], ['to', 'to'], ['axis', 'axis', ['both', 'x', 'y']], ['origin', 'origin', ['center', 'left', 'top', 'bottom', 'right']]],
  fade: [['from', 'from'], ['to', 'to']], visible: [['from', 'from'], ['to', 'to']],
  blink: [['min', 'min opacity']], pulse: [['amount', 'amount']], bounce: [['amount', 'height px']], draw: [['length', 'path length']],
  glow: [['blur', 'blur px'], ['color', 'colour', 'color']],
  flip: [['deg', 'angle °'], ['axis', 'axis', ['y', 'x']]],
  shake: [['dx', 'offset px']],
  swing: [['deg', 'angle °']],
  float: [['dy', 'float px']],
  shine: [['min', 'min opacity'], ['max', 'max opacity']],
  'contour-blink': [['min', 'min'], ['max', 'max']],
  'slide-in': [['fromX', 'from X px'], ['fromY', 'from Y px']],
  keyframes: [['frames', 'frames (json)', 'json']]
};
const TAG_LABEL = { rect: 'rect', circle: 'circle', ellipse: 'ellipse', path: 'path', line: 'line', polyline: 'poly', polygon: 'poly', text: 'text', g: 'group', use: 'inst' };
const TAG_TYPE_NAME = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  path: 'Path',
  line: 'Line',
  polyline: 'Polyline',
  polygon: 'Polygon',
  text: 'Text',
  g: 'Group',
  use: 'Instance'
};

export function elementTypeTitle(e) {
  if (!e) return 'Element';
  if (e.kind === 'instance' && e.refType) {
    const typeLabel = TYPES[e.refType]?.label || e.refType;
    const lib = findDesign(e.refType, e.refId);
    const suffix = lib ? (lib.name || lib.key) : e.name;
    return `${typeLabel} element${suffix ? ` · ${suffix}` : ''}`;
  }
  const tagTitle = TAG_TYPE_NAME[e.tag] || e.tag || 'Shape';
  return `${tagTitle} element${e.name ? ` · ${e.name}` : ''}`;
}

export class Inspector {
  constructor(root, designer) {
    this.root = root; this.d = designer;
    this.pendingClick = new Map();      // node id -> { type } while the user is still choosing the target
    this.screens = []; this.screensAt = 0;
    designer.on('selection', () => this.render());
    designer.on('loaded', () => this.render());
    designer.on('record', () => this.render());
  }

  /* ---------- small field builders ---------- */
  field(label, input, cls = '') { return h('label', { class: `field ${cls}` }, h('span', {}, label), input); }

  text(key, value, commit, { placeholder = '', list, mono = false } = {}) {
    const i = h('input', { type: 'text', value: value ?? '', placeholder, 'data-f': key, list, style: mono ? { fontFamily: 'Consolas, monospace' } : null });
    i.value = value ?? '';
    i.addEventListener('change', () => commit(i.value));
    return i;
  }

  num(key, value, commit, { min, max, step = 'any' } = {}) {
    const i = h('input', { type: 'number', step, min, max, 'data-f': key });
    i.value = value === undefined || value === null || value === '' ? '' : r2(value);
    i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) commit(v); });
    return i;
  }

  select(key, value, options, commit) {
    const s = h('select', { 'data-f': key }, options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
    s.value = value ?? '';
    s.addEventListener('change', () => commit(s.value));
    return s;
  }

  tokenList() {
    let dl = document.getElementById('token-list');
    if (!dl) { dl = h('datalist', { id: 'token-list' }); document.body.appendChild(dl); }
    clear(dl);
    for (const k of Object.keys(currentTheme().tokens)) dl.append(h('option', { value: `{{${k}}}` }));
    for (const v of ['none', 'url(#lgS)', 'url(#gPri)', 'url(#gFill)', 'url(#gBtn)', 'url(#glow)']) dl.append(h('option', { value: v }));
  }

  colorField(key, label, value, commit) {
    const resolved = this.previewColor(value);
    const txt = this.text(key, value, commit, { list: 'token-list', mono: true, placeholder: 'none · #hex · {{token}}' });
    const pick = h('input', { type: 'color', value: resolved, title: 'Pick a custom colour (replaces the token)' });
    pick.addEventListener('change', () => commit(pick.value));
    return this.field(label, h('div', { class: 'row' }, txt, pick));
  }

  previewColor(v) {
    const t = currentTheme().tokens;
    const m = /^\{\{(\w+)(?:\*[\d.]+)?\}\}$/.exec(v || '');
    const c = m ? String(t[m[1]] ?? '') : String(v || '');
    return /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080';
  }

  section(title, ...kids) { return h('div', { class: 'insp-sec' }, title ? h('h4', {}, title) : null, ...kids); }

  /* ---------- render ---------- */
  render() {
    const d = this.d, root = this.root;
    if (!d.doc) { clear(root); return; }
    const focusKey = document.activeElement?.dataset?.f, wasIn = root.contains(document.activeElement);
    const scroll = root.scrollTop;
    this.tokenList();
    clear(root);
    const sel = d.selectedNodes();
    if (sel.length === 1) root.append(...this.nodeSections(sel[0]));
    else if (sel.length > 1) root.append(this.multiSection(sel));
    if (d.type === 'button') root.append(this.menuSection(d.doc.id));
    root.append(this.designSection());
    root.append(this.nodesList());
    root.scrollTop = scroll;
    if (wasIn && focusKey) { const f = root.querySelector(`[data-f="${focusKey}"]`); f?.focus(); f?.select?.(); }
  }

  designSection() {
    const d = this.d, doc = d.doc, type = d.type;
    const keyInput = this.text('doc-key', doc.key, v => {
      if (!isValidKey(v)) { toast('Variable name: dashed lowercase words (a-z, 0-9, -)', 'error'); return this.render(); }
      d.updateDoc({ key: v });
    }, { mono: true });
    const kids = [
      this.field('Name', this.text('doc-name', doc.name, v => v.trim() && d.updateDoc({ name: v.trim() }))),
      this.field('Variable name (code)', keyInput),
      this.field('Label (shown to users)', this.text('doc-label', doc.label, v => d.updateDoc({ label: v }))),
      this.field('Category', this.text('doc-category', doc.category, v => d.updateDoc({ category: v.trim() || 'general' }))),
    ];
    if (!TYPES[type].fixedSize) {
      const row = [this.field('Width', this.num('doc-w', doc.width, v => d.updateDoc({ width: v }), { min: 8 })), this.field('Height', this.num('doc-h', doc.height, v => d.updateDoc({ height: v }), { min: 8 }))];
      kids.push(h('div', { class: 'grid2' }, ...row));
      if (type !== 'screen') kids.push(h('label', { class: 'row', title: 'Resizing the bounding box scales every sub element with it' }, h('input', { type: 'checkbox', checked: d.scaleContent, onchange: e => { d.scaleContent = e.target.checked; d.buildBar(); } }), h('span', { class: 'muted' }, 'Scale the contents with the bounding box')));
    }
    if (type === 'screen') {
      const devList = state.templateDevices?.length
        ? state.templateDevices.map(dv => [dv.key, `${dv.name} (${dv.width}×${dv.height})`])
        : Object.entries(DEVICES).map(([k, v]) => [k, `${v.name} (${v.width}×${v.height})`]);
      kids.push(this.field('Device', this.select('doc-device', doc.meta?.device, devList, v => {
        const dev = state.templateDevices?.find(dv => dv.key === v) || DEVICES[v];
        if (dev) d.updateDoc({ meta: { ...doc.meta, device: v }, width: dev.width, height: dev.height });
      })));
    }
    if (type === 'element') kids.push(this.field('HTML element', this.text('doc-tag', doc.meta?.htmlTag, v => d.updateDoc({ meta: { ...doc.meta, htmlTag: v.trim() } }), { placeholder: 'button, input, div…' })));
    kids.push(
      h('div', { class: 'grid2' },
        this.field('Visibility', this.select('doc-vis', doc.visibility || 'public', [['public', '🌐 Public (all projects)'], ['project', '📁 Project-only']], v => d.updateDoc({ visibility: v, projectId: state.currentProjectId || doc.projectId || 1 }))),
        this.field('Lock design', h('label', { class: 'row', style: { paddingTop: '5px' } }, h('input', { type: 'checkbox', checked: !!doc.locked, onchange: e => d.updateDoc({ locked: e.target.checked }) }), h('span', {}, doc.locked ? '🔒 Locked' : '🔓 Editable')))
      ),
      h('div', { class: 'row wrap', style: { fontSize: '11px' } },
        h('span', { class: 'badge' }, `Owner ID: #${doc.rootOwnerId || doc.creatorId || 1}`),
        doc.clonedFromId ? h('span', { class: 'badge accent' }, `Cloned from #${doc.clonedFromId}`) : null,
        h('button', { class: 'btn small', onclick: () => openLineageModal(type, doc.id) }, '🌳 Lineage & Root Owner')
      )
    );
    const dev = h('textarea', { rows: 6, 'data-f': 'doc-dev', placeholder: 'Instructions for the dev team / coding agents…' });
    dev.value = doc.descriptionDev || '';
    dev.addEventListener('change', () => d.updateDoc({ descriptionDev: dev.value }));
    kids.push(this.field('description-dev (for the dev team)', dev));
    return this.section(`${type} · ${doc.key}${doc.builtin ? ' · built-in' : ''}`, ...kids);
  }

  /** Buttons & Button Instances: popup / rotating menu settings and the nested menu items (order, add, remove, visible). */
  menuSection(buttonId = null) {
    const d = this.d;
    const bid = buttonId || (d.type === 'button' ? d.doc.id : null);
    const btnDoc = (d.type === 'button' && d.doc.id === bid) ? d.doc : findDesign('button', bid);
    if (!btnDoc) return h('div');
    const cfg = { ...DEFAULT_MENU, ...(btnDoc.meta?.menu || {}) }, rows = btnDoc.menuItems || [];
    const set = patch => menuActions.config(d, patch, bid);
    const num = (k, label, step = 0.05) => this.field(label, this.num(`mc-${bid}-${k}`, cfg[k], v => set({ [k]: v }), { step }));
    const settings = [
      h('div', { class: 'grid2' },
        this.field('Menu type', this.select(`mc-${bid}-kind`, cfg.kind, [['popup', 'popup (opens in place)'], ['rotating', 'rotating (centre takes the clicked icon)']], v => set({ kind: v }))),
        this.field('Layout', this.select(`mc-${bid}-layout`, cfg.layout, MENU_LAYOUTS, v => set({ layout: v })))),
      cfg.layout === 'fan'
        ? h('div', { class: 'grid2' }, num('radius', 'Radius × button'), num('itemScale', 'Item size × button'), num('startAngle', 'Start angle °', 5), num('sweep', 'Sweep °', 5))
        : h('div', { class: 'grid2' }, this.field('Direction', this.select(`mc-${bid}-dir`, cfg.direction, ['up', 'down', 'left', 'right'], v => set({ direction: v }))), num('itemScale', 'Item size × button'), num('gap', 'Gap × button')),
      this.field('Centre icon turns while open (°, 0 = off)', this.num(`mc-${bid}-rot`, cfg.rotateOnOpen, v => set({ rotateOnOpen: v }), { step: 5 }))
    ];
    const tree = buildMenuTree(rows, { includeHidden: true });
    const lines = [];
    const walk = (list, depth) => list.forEach(n => {
      const ic = findDesign('icon', n.iconId);
      const popEl = n.targetElementId ? findDesign('element', n.targetElementId) : null;
      const scr = n.targetScreenId ? this.screenChoices().find(s => s.id === n.targetScreenId) : null;
      const isVisible = n.visible !== false;
      lines.push(h('div', { class: 'el-row', style: { paddingLeft: `${7 + depth * 14}px`, opacity: isVisible ? 1 : 0.45 } },
        h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: n.descriptionDev || n.name },
          `${n.label || n.name}`,
          h('span', { class: 'dim' }, ic ? ` · ${ic.key}` : ''),
          popEl ? h('span', { class: 'badge', style: { marginLeft: '4px' }, title: `Opens popup element: ${popEl.name}` }, `🗔 ${popEl.key}`) : null,
          scr ? h('span', { class: 'badge', style: { marginLeft: '4px' }, title: `Routes to screen: ${scr.name}` }, `➜ ${scr.name}`) : null
        ),
        h('button', { class: 'icon-btn small', title: isVisible ? 'Visible (click to hide)' : 'Hidden (click to show)', onclick: () => menuActions.toggleVisible(d, n.id, bid) }, isVisible ? '👁' : '—'),
        h('button', { class: 'icon-btn small', title: 'Add sub item', onclick: () => menuActions.add(d, n.id, bid) }, '＋'),
        h('button', { class: 'icon-btn small', title: 'Edit menu item', onclick: () => menuActions.edit(d, n.id, bid) }, '✎'),
        h('button', { class: 'icon-btn small', title: 'Move earlier (order up)', onclick: () => menuActions.move(d, n.id, -1, bid) }, '↑'),
        h('button', { class: 'icon-btn small', title: 'Move later (order down)', onclick: () => menuActions.move(d, n.id, 1, bid) }, '↓'),
        h('button', { class: 'icon-btn small', title: 'Remove menu item', onclick: () => menuActions.remove(d, n.id, bid) }, '🗑')));
      walk(n.children, depth + 1);
    });
    walk(tree, 0);
    return this.section(`Menu Items · ${rows.length} item(s)`,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Order items (↑/↓), add (＋), edit (✎), toggle visible (👁), or remove (🗑). Each item can route to a screen or show an element as a popup/modal box.'),
      ...settings,
      h('div', { class: 'el-list' }, lines.length ? lines : h('div', { class: 'empty' }, 'No menu items yet.')),
      h('button', { class: 'btn small primary', onclick: () => menuActions.add(d, null, bid) }, '＋ Add menu item'));
  }

  nodesList() {
    const d = this.d;
    const rows = [...d.nodes].sort((a, b) => b.ord - a.ord || b.id - a.id).map(e => {
      const label = e.kind === 'instance' ? `${e.refType}: ${findDesign(e.refType, e.refId)?.key ?? '?'}` : e.tag === 'text' ? `"${e.text}"` : (e.name || e.tag);
      return h('div', { class: `el-row${d.selected.has(e.id) ? ' on' : ''}`, style: { paddingLeft: `${7 + (e.parentId ? 12 : 0)}px`, opacity: e.visible ? 1 : 0.45 }, onclick: ev => d.select([e.id], { add: ev.shiftKey }) },
        h('span', { class: 't' }, TAG_LABEL[e.tag] || e.tag), h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: e.name }, e.name ? `${e.name} · ${label}` : label),
        e.role ? h('span', { class: 'badge' }, e.role) : null,
        e.onClick ? h('span', { class: 'badge', title: `click: ${e.onClick.type}` }, `⚡ ${e.onClick.type}`) : null,
        h('button', { class: 'icon-btn small', title: e.visible ? 'Hide' : 'Show', onclick: ev => { ev.stopPropagation(); d.patchNode(e.id, { visible: !e.visible }); } }, e.visible ? '👁' : '—'),
        h('button', { class: 'icon-btn small', title: e.locked ? 'Unlock' : 'Lock', onclick: ev => { ev.stopPropagation(); d.patchNode(e.id, { locked: !e.locked }); } }, e.locked ? '🔒' : '🔓'));
    });
    return this.section(`Layers (${d.nodes.length})`, h('div', { class: 'el-list' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nothing here yet. Use the tools or drag from the library.')));
  }

  multiSection(sel) {
    const d = this.d;
    return this.section(`${sel.length} nodes selected`,
      this.anchorGrid(), h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => d.duplicateSelected() }, 'Duplicate'), h('button', { class: 'btn small danger', onclick: () => d.deleteSelected() }, 'Delete'),
        h('button', { class: 'btn small', onclick: () => d.reorder('up') }, 'Up'), h('button', { class: 'btn small', onclick: () => d.reorder('down') }, 'Down')));
  }

  anchorGrid() {
    const d = this.d;
    const names = { tl: 'top-left', tc: 'top-center', tr: 'top-right', ml: 'middle-left', mc: 'center', mr: 'middle-right', bl: 'bottom-left', bc: 'bottom-center', br: 'bottom-right' };
    const margin = this.d.type === 'icon' ? 1 : (state.settings.grid || 24) / 2;
    return h('div', { class: 'row' }, h('div', { class: 'anchors', role: 'group', 'aria-label': '9 reference points' }, ANCHORS.map(a => h('button', { title: `Place at ${names[a]}`, onclick: () => d.placeSelected(a, margin) }, '·'))),
      h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Place on the 9 reference points'));
  }

  /* ---------- single element ---------- */
  nodeSections(e) {
    const d = this.d, id = e.id;
    const patch = p => d.patchNode(id, p);
    const setAttr = (k, v) => { const a = { ...e.attrs }; if (v === '' || v === null || v === undefined) delete a[k]; else a[k] = v; return patch({ attrs: a }); };
    const box = nodeBBox(e, d.nodes);
    const setBox = (nb) => {
      const to = { ...box, ...nb };
      const moved = nb.w === undefined && nb.h === undefined;
      patch({ attrs: moved ? translateAttrs(e, to.x - box.x, to.y - box.y) : resizeAttrs(e, box, to) });
    };
    const secs = [];

    // identity (placed at the very top of the inspector panel when any element is selected, with dynamic element type title)
    const ed = d.editorFor(e);
    secs.push(this.section(elementTypeTitle(e),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn small primary', disabled: !ed || ed.disabled, title: ed?.hint, onclick: () => d.openEditor(e) }, `✎ ${ed?.label || 'Open editor'}`),
        h('span', { class: 'muted', style: { fontSize: '11px' } }, ed?.hint || '')),
      this.field('Variable name', this.text('el-name', e.name, v => patch({ name: v.trim() }), { mono: true })),
      h('div', { class: 'grid2' },
        this.field('Surface role', this.select('el-role', e.role || '', [['', '(none)'], ...SURFACE_ROLES], v => patch({ role: v || null }))),
        this.field('Rotation °', this.num('el-rot', e.rotation, v => patch({ rotation: v })))),
      e.role ? h('div', { class: 'muted', style: { fontSize: '11px' } }, 'The theme draws this element (fill, border, shadow). Setting colours below overrides the theme.') : null,
      (() => { const t = h('textarea', { rows: 3, placeholder: 'description-dev for this element…', 'data-f': 'el-dev' }); t.value = e.descriptionDev || ''; t.addEventListener('change', () => patch({ descriptionDev: t.value })); return this.field('description-dev', t); })()));

    if (e.kind === 'instance' && e.refType === 'button' && e.refId) {
      secs.push(this.menuSection(e.refId));
    }

    // geometry
    const geo = [h('div', { class: 'grid4' },
      this.field('X', this.num('g-x', box.x, v => setBox({ x: v }))), this.field('Y', this.num('g-y', box.y, v => setBox({ y: v }))),
      this.field('W', this.num('g-w', box.w, v => setBox({ w: Math.max(0.5, v) }))), this.field('H', this.num('g-h', box.h, v => setBox({ h: Math.max(0.5, v) })))),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!e.locked, onchange: ev => patch({ locked: ev.target.checked }) }), h('span', { class: 'muted' }, e.locked ? '🔒 Position locked (cannot be dragged)' : '🔓 Position unlocked (check to lock position)')),
      this.anchorGrid(),
      h('div', { class: 'row wrap' }, ['front', 'up', 'down', 'back'].map(w => h('button', { class: 'btn small', onclick: () => d.reorder(w) }, w === 'front' ? 'To front' : w === 'back' ? 'To back' : w === 'up' ? 'Forward' : 'Backward')),
        h('button', { class: 'btn small', onclick: () => d.duplicateSelected() }, 'Duplicate'), h('button', { class: 'btn small danger', onclick: () => d.deleteSelected() }, 'Delete'))];
    if (isVertexEditable(e.tag) && e.kind !== 'instance') geo.unshift(h('div', { class: 'row wrap' }, h('button', { class: 'btn small primary', title: 'Drag vertices and bezier handles (Enter / N)', onclick: () => d.vtx.enter(e) }, e.tag === 'path' ? '✦ Edit vertices' : '✦ Convert to path & edit vertices'), h('span', { class: 'muted', style: { fontSize: '11px' } }, 'double-click on the canvas')));
    if (e.tag === 'path' && (e.attrs.transform || e.rotation)) geo.unshift(h('div', { class: 'row wrap' }, h('button', { class: 'btn small', title: "Bake the path's transform and rotation into its points (needed for vertex editing of rotated paths)", onclick: () => d.bakeSelected() }, 'Apply transform to points'), h('span', { class: 'muted', style: { fontSize: '11px' } }, 'this path is transformed')));
    secs.push(this.section('Position & size', ...geo));

    // content & style
    const style = [];
    if (e.tag === 'text') {
      const t = h('textarea', { rows: 2, 'data-f': 'el-text' }); t.value = e.text; t.addEventListener('change', () => patch({ text: t.value }));
      style.push(this.field('Text', t),
        h('div', { class: 'grid2' }, this.field('Size', this.num('t-size', e.attrs['font-size'] ?? 16, v => setAttr('font-size', v))), this.field('Weight', this.select('t-weight', e.attrs['font-weight'] ?? 400, [300, 400, 500, 600, 700, 800], v => setAttr('font-weight', v)))),
        this.field('Align', this.select('t-anchor', e.attrs['text-anchor'] || 'start', [['start', 'left'], ['middle', 'center'], ['end', 'right']], v => setAttr('text-anchor', v))));
    }
    if (e.tag === 'path') {
      const t = h('textarea', { rows: 4, 'data-f': 'el-d', style: { fontFamily: 'Consolas, monospace' } }); t.value = e.attrs.d || ''; t.addEventListener('change', () => setAttr('d', t.value.trim()));
      style.push(this.field('Path data (d)', t));
    }
    if (e.kind === 'instance') {
      const lib = findDesign(e.refType, e.refId);
      style.push(h('div', { class: 'muted' }, `${e.refType}: ${lib ? `${lib.label} (${lib.key})` : 'missing'}`));
    }
    style.push(this.colorField('s-fill', 'Fill', e.attrs.fill, v => setAttr('fill', v)), this.colorField('s-stroke', 'Stroke', e.attrs.stroke, v => setAttr('stroke', v)));
    const sw = e.attrs['stroke-width'], ratio = /^\{\{sw\*([\d.]+)\}\}$/.exec(sw || '');
    style.push(h('div', { class: 'grid2' },
      this.field('Line size × global', this.num('s-ratio', ratio ? Number(ratio[1]) : (sw === '{{sw}}' ? 1 : ''), v => setAttr('stroke-width', v === 1 ? '{{sw}}' : `{{sw*${v}}}`), { min: 0, step: 0.05 })),
      this.field('Stroke width (raw)', this.text('s-sw', sw, v => setAttr('stroke-width', v)))),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, `Line size is stored as a ratio of the theme's global value (${currentTheme().tokens.sw}), never a fixed number.`),
      h('div', { class: 'grid2' }, this.field('Opacity', this.num('s-op', e.attrs.opacity ?? 1, v => setAttr('opacity', v), { min: 0, max: 1, step: 0.05 })),
        this.field('Corner radius', this.num('s-rx', e.attrs.rx ?? '', v => setAttr('rx', v), { min: 0 }))));
    const raw = h('textarea', { rows: 5, 'data-f': 'el-raw', style: { fontFamily: 'Consolas, monospace' } }); raw.value = JSON.stringify(e.attrs, null, 1);
    raw.addEventListener('change', () => { try { patch({ attrs: JSON.parse(raw.value) }); } catch { toast('Attributes must be valid JSON', 'error'); } });
    style.push(h('details', {}, h('summary', { class: 'muted' }, 'All attributes (json)'), raw));
    secs.push(this.section('Content & style', ...style));

    // events & click action (every element on any design can have click, mouseover, release, drag&drop events)
    secs.push(this.clickSection(e));

    // animations
    secs.push(this.animationSection(e));
    return secs;
  }

  /** Screens for the target picker (cached; refreshed in the background). */
  screenChoices() {
    if (Date.now() - this.screensAt > 4000) {
      this.screensAt = Date.now();
      api.list('screen').then(list => { const changed = list.length !== this.screens.length || list.some((s, i) => s.id !== this.screens[i]?.id || s.name !== this.screens[i]?.name); this.screens = list; if (changed) this.render(); }).catch(() => {});
    }
    return this.screens;
  }

  /**
   * Click & multi-event action: route to a screen, open an element, popup, small element toolbar, drawer, go back, or animate.
   */
  clickSection(e) {
    const d = this.d, saved = e.onClick, cur = saved || this.pendingClick.get(e.id) || null, type = cur?.type || 'none';
    const save = c => { this.pendingClick.delete(e.id); return d.patchNode(e.id, { onClick: c }); };
    const typeSel = this.select('ck-type', type, [
      ['none', '(nothing)'],
      ['screen', 'Route to a screen'],
      ['element', 'Open an element'],
      ['popup', 'Open a popup'],
      ['toolbar', 'Open a small element toolbar'],
      ['drawer', 'Open a drawer'],
      ['animate', 'Trigger animation'],
      ['toggle', 'Toggle visibility / flip'],
      ['back', 'Go back']
    ], v => {
      if (v === 'none') return save(null);
      if (v === 'back') return save({ type: 'back' });
      const isEl = ['element', 'popup', 'toolbar', 'drawer'].includes(v);
      const wasEl = ['element', 'popup', 'toolbar', 'drawer'].includes(cur?.type);
      const keep = cur?.targetId && ((v === 'screen' && cur.type === 'screen') || (isEl && wasEl)) ? cur.targetId : null;
      if (keep) return save({ type: v, targetId: keep, ...(v === 'drawer' ? { side: cur.side || 'right' } : {}) });
      if (v === 'animate' || v === 'toggle') return save({ type: v, animationType: 'pulse' });
      this.pendingClick.set(e.id, { type: v }); this.render();
    });
    const kids = [this.field('Primary click action', typeSel)];
    const open = [];
    if (type === 'screen') {
      const screens = this.screenChoices();
      kids.push(this.field('Target screen', this.select('ck-screen', cur.targetId ?? '', [['', '(choose a screen…)'], ...screens.filter(s => s.id !== d.doc.id).map(s => [s.id, s.name])], v => v && save({ type: 'screen', targetId: Number(v) }))));
      if (cur.targetId) open.push(h('button', { class: 'btn small', onclick: () => d.opts.openDesign?.('screen', cur.targetId) }, 'Open that screen'));
    } else if (['element', 'popup', 'toolbar', 'drawer'].includes(type)) {
      const els = [...state.library.elements].sort((a, b) => a.name.localeCompare(b.name));
      kids.push(this.field('Element / Toolbar to open', this.select('ck-element', cur.targetId ?? '', [['', '(choose an element…)'], ...els.map(x => [x.id, x.name])], v => v && save({ type, targetId: Number(v), ...(type === 'drawer' ? { side: cur.side || 'right' } : {}) }))));
      if (type === 'drawer') kids.push(this.field('Slides in from', this.select('ck-side', cur.side || 'right', DRAWER_SIDES, v => cur.targetId && save({ type, targetId: cur.targetId, side: v }))));
      if (cur.targetId) open.push(h('button', { class: 'btn small', onclick: () => d.opts.openDesign?.('element', cur.targetId) }, 'Open that element'));
    } else if (type === 'animate' || type === 'toggle') {
      kids.push(this.field('Animation preset', this.select('ck-anim', cur.animationType || 'pulse', ['pulse', 'bounce', 'flip', 'shake', 'swing', 'glow', 'fade'], v => save({ type, animationType: v }))));
    }
    if (open.length) kids.push(h('div', { class: 'row wrap' }, ...open));
    const evList = Array.isArray(e.events) ? e.events : [];
    kids.push(
      h('div', { class: 'row wrap', style: { marginTop: '4px' } },
        h('button', { class: 'btn small primary', onclick: () => openEventsModal({
          node: e,
          screens: this.screenChoices(),
          elements: state.library.elements,
          onSave: patch => d.patchNode(e.id, patch)
        }) }, `⚡ Multi-Events (${evList.length}) · click, mouseover, release, drag&drop…`)
      )
    );
    if (evList.length) {
      kids.push(h('div', { class: 'row wrap', style: { gap: '4px' } }, ...evList.map(ev => h('span', { class: 'badge' }, `${ev.trigger} → ${ev.type}`))));
    }
    const hint = {
      none: 'Pick what happens on click, or open Multi-Events for mouseover, release, drag&drop, etc.',
      screen: 'Routes to the target screen.',
      element: 'Opens the chosen element overlay.',
      popup: 'Opens the element in a modal dialog over the page.',
      toolbar: 'Opens a floating small element toolbar anchored near this element.',
      drawer: 'Slides the element in from the chosen edge.',
      animate: 'Runs an interactive animation on this element.',
      toggle: 'Toggles visibility or flips a flip-box.',
      back: 'Navigates back one screen.'
    }[type] || '';
    kids.push(h('div', { class: 'muted', style: { fontSize: '11px' } }, `${hint} Test with “▶ Test actions” in the toolbar.`));
    if (cur && !saved && type !== 'none') kids.push(h('div', { class: 'muted', style: { fontSize: '11px', color: 'var(--warn)' } }, 'Not saved yet: choose a target.'));
    return this.section(`Events & Click${saved ? ` · ${saved.type}` : ''}${evList.length ? ` (+${evList.length})` : ''}`, ...kids);
  }

  animationSection(e) {
    const d = this.d, anims = d.animationsOf(e.id);
    const add = h('select', { 'aria-label': 'Add animation' }, h('option', { value: '' }, '+ Add animation…'), ANIMATION_TYPES.map(t => h('option', { value: t }, t)));
    add.addEventListener('change', () => { if (add.value) d.addAnimation(e.id, add.value); });
    return this.section('Animations', add, ...anims.map(a => this.animCard(a)),
      anims.length ? null : h('div', { class: 'muted' }, 'None. Animations are exported with the SVG (CSS keyframes).'));
  }

  animCard(a) {
    const d = this.d, up = p => d.updateAnimation(a, p);
    const params = (PARAM_FIELDS[a.type] || []).map(([k, label, opt]) => {
      if (Array.isArray(opt)) return this.field(label, this.select(`a${a.id}-${k}`, a.params[k], opt, v => up({ params: { ...a.params, [k]: v } })));
      if (opt === 'color') return this.field(label, this.text(`a${a.id}-${k}`, a.params[k], v => up({ params: { ...a.params, [k]: v } })));
      if (opt === 'json') { const t = h('textarea', { rows: 5, 'data-f': `a${a.id}-${k}` }); t.value = JSON.stringify(a.params[k], null, 1); t.addEventListener('change', () => { try { up({ params: { ...a.params, [k]: JSON.parse(t.value) } }); } catch { toast('Frames must be valid JSON', 'error'); } }); return this.field(label, t, 'full'); }
      return this.field(label, this.num(`a${a.id}-${k}`, a.params[k], v => up({ params: { ...a.params, [k]: v } })));
    });
    const infinite = a.iterations === 'infinite';
    return h('div', { class: 'anim-card' },
      h('div', { class: 'row' }, h('input', { type: 'checkbox', checked: a.enabled, title: 'Enabled', onchange: ev => up({ enabled: ev.target.checked }) }),
        h('b', { class: 'grow' }, `${a.type}`), this.text(`a${a.id}-name`, a.name, v => up({ name: v }), { placeholder: 'name' }),
        h('button', { class: 'icon-btn small', title: 'Remove animation', onclick: () => d.removeAnimation(a) }, '🗑')),
      h('div', { class: 'grid2' }, params),
      h('div', { class: 'grid2' },
        this.field('Duration ms', this.num(`a${a.id}-dur`, a.durationMs, v => up({ durationMs: Math.max(50, v) }), { min: 50 })),
        this.field('Delay ms', this.num(`a${a.id}-del`, a.delayMs, v => up({ delayMs: Math.max(0, v) }), { min: 0 })),
        this.field('Easing', this.select(`a${a.id}-ease`, a.easing, EASINGS, v => up({ easing: v }))),
        this.field('Direction', this.select(`a${a.id}-dir`, a.direction, ['normal', 'reverse', 'alternate', 'alternate-reverse'], v => up({ direction: v }))),
        this.field('Trigger', this.select(`a${a.id}-trg`, a.trigger, TRIGGERS, v => up({ trigger: v }))),
        this.field(infinite ? 'Repeat' : 'Repeat (times)', infinite ? this.select(`a${a.id}-it`, 'infinite', ['infinite', 'once'], v => up({ iterations: v === 'once' ? 1 : 'infinite' }))
          : this.num(`a${a.id}-it`, a.iterations, v => up({ iterations: Math.max(1, Math.round(v)) }), { min: 1 }))));
  }
}
