/** Right-hand property inspector of a Designer: design record, selection, geometry, style, animations. */
import { matchesSearch, searchTerms, itemSearchFields } from '/domain/search.js';
import { h, clear, toast, confirmBox, modal } from '../dom.js';
import { ibtn, iconEl } from '../icons.js';
import { state, currentTheme, findDesign } from '../state.js';
import { api } from '../api.js';
import { menuActions, pickButton, libraryBrowseButton } from './menu-editor.js';
import { MENU_LAYOUTS, MENU_KINDS, DEFAULT_MENU, TYPES, DRAWER_SIDES, BUTTON_STYLES, applyButtonStyleAndIconSizeToNodes } from '/domain/entities.js';
import { buildMenuTree, hubDirectionPatch, hubCount, menuConfig, menuOrientation, menuOrientationPatch, resolveMenuLabelPlacement, showLabelsEnabled } from '/domain/menu.js';
import { isVertexEditable } from '/domain/path-data.js';
import {
  nodeBBox, translateAttrs, resizeAttrs, ANCHORS,
  isContainerNode, isCarouselContainerNode, getContainerConfig, containerInnerBox,
  clampNodeToContainer, fitContainerToScreenBox
} from '/domain/geometry.js';
import { ANIMATION_TYPES, TRIGGERS, EASINGS } from '/domain/animation.js';
import { isRepeaterNode, repeaterConfig, repeaterTemplate, repeaterTemplates, repeaterPlan, REPEATER_ATTR, REPEATER_MAX_ITEMS } from '/domain/repeater.js';
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
  'move-up': [['distance', 'distance px']], 'move-down': [['distance', 'distance px']],
  'move-left': [['distance', 'distance px']], 'move-right': [['distance', 'distance px']],
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
  if (isRepeaterNode(e, state.library?.elements)) return `Repeater · ${e.name || 'repeater'}`;
  if (isCarouselContainerNode(e, state.library?.elements)) {
    return `Carousel Container · ${e.name || 'carousel'}`;
  }
  if (isContainerNode(e, state.library?.elements)) {
    return `Container element · ${e.name || 'container'}`;
  }
  if (e.kind === 'instance' && e.refType) {
    const typeLabel = TYPES[e.refType]?.label || e.refType;
    const lib = findDesign(e.refType, e.refId);
    const suffix = lib ? (lib.name || lib.key) : e.name;
    return `${typeLabel} element${suffix ? ` · ${suffix}` : ''}`;
  }
  const tagTitle = TAG_TYPE_NAME[e.tag] || e.tag || 'Shape';
  return `${tagTitle} element${e.name ? ` · ${e.name}` : ''}`;
}

/** Searchable modal listing every library icon; resolves through onPick(icon) when one is chosen. */
export function openIconPicker(currentId, onPick) {
  const icons = [...(state.library.icons || [])].sort((a, b) => String(a.label || a.key).localeCompare(String(b.label || b.key)));
  let query = '';
  const search = h('input', { type: 'search', class: 'grow', placeholder: 'Search icons by name, key or category…', 'aria-label': 'Search icons' });
  const count = h('span', { class: 'muted', style: { whiteSpace: 'nowrap', fontSize: '11px' } });
  const grid = h('div', { class: 'icon-pick-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '8px', maxHeight: '62vh', overflowY: 'auto', paddingTop: '4px' } });
  const render = () => {
    clear(grid);
    const terms = searchTerms(query);
    const list = icons.filter(it => matchesSearch(terms, ...itemSearchFields(it)));
    // thousands of pack icons: draw the first 300 matches only (each is an <img> of the icon svg)
    const shown = list.slice(0, 300);
    count.textContent = shown.length < list.length ? `${shown.length} shown · ${list.length} of ${icons.length}` : `${list.length} of ${icons.length}`;
    if (!list.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No icon matches that search.'));
    for (const it of shown) {
      grid.append(h('button', {
        class: `icon-pick${it.id === currentId ? ' on' : ''}`,
        title: it.key,
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 6px', border: '1px solid var(--line)', borderRadius: '8px', background: it.id === currentId ? 'rgba(46,155,255,.14)' : 'transparent', color: 'inherit', cursor: 'pointer' },
        onclick: async () => { m.close(); await onPick(it); }
      },
        h('img', { src: api.svgUrl('icon', it.id, { theme: state.themeKey, animated: 0 }), alt: '', loading: 'lazy', style: { width: '48px', height: '48px', objectFit: 'contain' } }),
        h('span', { style: { fontSize: '11px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' } }, it.label || it.key)));
    }
  };
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  const m = modal({
    title: 'Change icon',
    wide: true,
    content: h('div', {}, h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, search, count), grid)
  });
  render();
  search.focus();
}

export class Inspector {
  constructor(root, designer) {
    this.root = root; this.d = designer;
    this.pendingClick = new Map();      // node id -> { type } while the user is still choosing the target
    this.screens = []; this.screensAt = 0;
    this.scriptCache = new Map();       // element id -> { loaded: boolean, script: object | null }
    this.scriptLoading = new Set();
    designer.on('selection', () => this.render());
    designer.on('loaded', () => { this.scriptCache.clear(); this.render(); });
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
    this.lowSections = [];
    if (d.type === 'button') root.append(this.buttonStyleSection());
    if (sel.length === 1) root.append(...this.nodeSections(sel[0]));
    else if (sel.length > 1) root.append(this.multiSection(sel));
    if (d.type === 'button') root.append(this.menuSection(d.doc.id));
    root.append(this.designSection());
    if (d.type === 'element') root.append(this.elementScriptSection());
    root.append(this.nodesList());
    if (this.lowSections.length) root.append(...this.lowSections);
    root.scrollTop = scroll;
    if (wasIn && focusKey) { const f = root.querySelector(`[data-f="${focusKey}"]`); f?.focus(); f?.select?.(); }
    d.fitInspectorToContent?.();   // first render only: fit the panel to its content
  }

  /** Top of the button inspector: change the button style (shape) of the open button. */
  buttonStyleSection() {
    const d = this.d, doc = d.doc;
    const surface = d.nodes.find(n => n.role === 'button' || n.name === 'surface');
    const minDim = Math.min(doc.width, doc.height) || 64;
    const rx = Number(surface?.attrs?.rx) || (surface?.tag === 'circle' ? minDim / 2 : 0);
    const guess = surface?.attrs?.fill === 'none' ? 'outline' : [...BUTTON_STYLES].sort((a, b) => Math.abs(a.rxRatio * minDim - rx) - Math.abs(b.rxRatio * minDim - rx))[0]?.key;
    const cur = doc.meta?.buttonStyle || guess || 'circle';
    const sel = this.select('btn-style', cur, BUTTON_STYLES.map(b => [b.key, b.label]), async v => {
      const nodes = applyButtonStyleAndIconSizeToNodes(d.nodes.map(n => ({ ...n })), { width: doc.width, height: doc.height, buttonStyle: v, buttonIconSizePct: 100 * (d.nodes.find(n => n.refType === 'icon')?.attrs?.width || minDim) / minDim });
      await d.mutate(async () => { await api.replaceNodes('button', doc.id, nodes); await api.updateDesign?.('button', doc.id, { meta: { ...doc.meta, buttonStyle: v } }); });
      await d.reload();
      toast(`Button style: ${BUTTON_STYLES.find(b => b.key === v)?.label || v}`, 'ok', 1400);
    });
    const rows = doc.menuItems || [];
    if (!rows.length) return this.section('', this.field('Button style', sel));
    // APPLY: every menu item (hub ring, fans, sub items) is drawn with this button's style: drop the menu-wide and per-item button picks
    const apply = ibtn('check', 'Apply this button style to all menu items', () => this.applyStyleToMenuItems(doc.id), { desc: 'Every menu item (hub buttons, fans, sub items) is drawn with this button\'s style; items keep their own icon', cls: 'primary' });
    return this.section('', this.field('Button style', h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('div', { class: 'grow' }, sel), apply)));
  }

  async applyStyleToMenuItems(bid) {
    const d = this.d, doc = d.doc?.id === bid ? d.doc : findDesign('button', bid);
    const rows = (doc?.menuItems || []).filter(r => r.refButtonId != null);
    const cfg = { ...DEFAULT_MENU, ...(doc?.meta?.menu || {}) };
    if (!rows.length && cfg.itemButtonId == null) return toast('All menu items already use this button style', 'ok', 1600);
    for (const r of rows) await api.updateMenuItem(bid, r.id, { refButtonId: null });
    if (cfg.itemButtonId != null) await menuActions.config(d, { itemButtonId: null }, bid);
    else await menuActions.refresh(d, bid);
    toast(`Button style applied to all menu items${rows.length ? ` (${rows.length} reset)` : ''}`, 'ok', 1600);
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
    if (type === 'button') {
      // the button's icon: preview + change / add, right in the inspector (same picker as the hover bar's search button)
      const inst = (d.nodes || []).find(n => n.kind === 'instance' && n.refType === 'icon');
      const ic = inst ? findDesign('icon', inst.refId) : null;
      kids.splice(1, 0, this.field('Icon', h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' }, 'data-f': 'doc-icon' },
        ic ? h('img', { class: 'thumb small', alt: ic.label || ic.key, src: api.svgUrl('icon', ic.id, { theme: state.themeKey, animated: 0 }), style: { width: '36px', height: '36px', objectFit: 'contain' } }) : null,
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ic ? (ic.label || ic.key) : inst ? `icon #${inst.refId}` : 'No icon'),
          ic ? h('div', { class: 'muted', style: { fontSize: '11px' } }, ic.key) : null),
        ibtn('search', inst ? 'Change icon…' : 'Add an icon…', () => d.changeButtonIcon(inst), { cls: 'primary', desc: 'Search the library and pick the icon of this button', dataset: { act: 'doc-change-icon' } }))));
    }
    if (!TYPES[type].fixedSize) {
      const row = [this.field('Width', this.num('doc-w', doc.width, v => d.updateDoc({ width: v }), { min: 8 })), this.field('Height', this.num('doc-h', doc.height, v => d.updateDoc({ height: v }), { min: 8 }))];
      kids.push(h('div', { class: 'grid2' }, ...row));
      if (type !== 'screen') kids.push(h('label', { class: 'row', title: 'Resizing the bounding box scales every sub element with it' }, h('input', { type: 'checkbox', checked: d.scaleContent, onchange: e => { d.scaleContent = e.target.checked; d.buildBar(); } }), h('span', { class: 'muted' }, 'Scale the contents with the bounding box')));
    }
    // screen device selection lives in the designer top bar (device icon button)
    if (type === 'element') kids.push(this.field('HTML element', this.text('doc-tag', doc.meta?.htmlTag, v => d.updateDoc({ meta: { ...doc.meta, htmlTag: v.trim() } }), { placeholder: 'button, input, div…' })));
    const lockField = this.field('Lock design', h('label', { class: 'row', style: { paddingTop: '5px' } }, h('input', { type: 'checkbox', checked: !!doc.locked, onchange: e => d.updateDoc({ locked: e.target.checked }) }), h('span', {}, doc.locked ? '🔒 Locked' : '🔓 Editable')));
    kids.push(
      type === 'screen'
        ? lockField
        : h('div', { class: 'grid2' },
            this.field('Visibility', this.select('doc-vis', doc.visibility || 'public', [
              ['public', '🌐 Public (all users)'],
              ['private', '🗂 All Projects (user\'s all projects)'],
              ['project', '📁 Project-only']
            ], v => d.updateDoc(v === 'project' ? { visibility: v, projectId: state.activeProjectId || state.currentProjectId || doc.projectId || 1 } : { visibility: v }))),
            lockField
          ),
      h('div', { class: 'row wrap', style: { fontSize: '11px' } },
        h('span', { class: 'badge' }, `Owner ID: #${doc.rootOwnerId || doc.creatorId || 1}`),
        doc.clonedFromId ? h('span', { class: 'badge accent' }, `Cloned from #${doc.clonedFromId}`) : null,
        ibtn('collab', 'Lineage & root owner', () => openLineageModal(type, doc.id), { desc: 'View the creator and root owner chain' })
      )
    );
    const dev = h('textarea', { rows: 6, 'data-f': 'doc-dev', placeholder: 'Instructions for the dev team / coding agents…' });
    dev.value = doc.descriptionDev || '';
    dev.addEventListener('change', () => d.updateDoc({ descriptionDev: dev.value }));
    kids.push(this.field('description-dev (for the dev team)', dev));
    return this.section(`${type} · ${doc.key}${doc.builtin ? ' · built-in' : ''}`, ...kids);
  }

  /** Button style tool: one library button used as the frame of EVERY menu item (items with their own button can be reset to follow it). */
  menuStyleTool(bid, cfg, rows, set) {
    const cur = cfg.itemButtonId ? findDesign('button', cfg.itemButtonId) : null;
    const own = rows.filter(r => r.refButtonId).length;
    return h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
      cur ? h('img', { class: 'thumb small', alt: cur.label || cur.key, src: api.svgUrl('button', cur.id, { theme: state.themeKey, animated: 0, size: 48 }), style: { width: '36px', height: '36px', objectFit: 'contain' } }) : null,
      h('span', { class: 'grow', style: { fontSize: '12px' } }, cur ? `Item style: ${cur.label || cur.key}` : 'Item style: this button\'s own body'),
      ibtn('search', 'Pick the button style of all menu items', async () => { const r = await pickButton(cfg.itemButtonId, bid); if (r !== null) await set({ itemButtonId: r || null }); }, { desc: 'Every menu item is drawn with this button (items keep their own icon)', cls: 'primary' }),
      cur ? ibtn('close', 'Back to the default style', () => set({ itemButtonId: null })) : null,
      own ? ibtn('copy', `Apply to all items (clears ${own} item button${own === 1 ? '' : 's'})`, async () => {
        for (const r of rows.filter(x => x.refButtonId)) await api.updateMenuItem(bid, r.id, { refButtonId: null });
        await menuActions.refresh(this.d, bid); toast('All items now follow the menu button style', 'ok', 1600);
      }, { desc: 'Items that picked their own button switch to the menu button style' }) : null);
  }

  /** Buttons & Button Instances: action/menu modes (radial, drawer, vertical/horizontal slider, carousel animated roll, show element) and nested menu items. */
  menuSection(buttonId = null) {
    const d = this.d;
    const bid = buttonId || (d.type === 'button' ? d.doc.id : null);
    const btnDoc = (d.type === 'button' && d.doc.id === bid) ? d.doc : findDesign('button', bid);
    if (!btnDoc) return h('div');
    const cfg = menuConfig(btnDoc.meta), rows = btnDoc.menuItems || [];
    const set = patch => menuActions.config(d, patch, bid);
    const num = (k, label, step = 0.05) => this.field(label, this.num(`mc-${bid}-${k}`, cfg[k], v => set({ [k]: v }), { step }));
    const els = [...(state.library.elements || [])].sort((a, b) => a.name.localeCompare(b.name));
    const curOrient = menuOrientation(cfg);
    const autoLabelPos = resolveMenuLabelPlacement(cfg, { isHubRoot: cfg.kind === 'hub' }).pos;
    const labelsOn = showLabelsEnabled(cfg);
    const settings = [
      h('div', { class: 'grid2' },
        this.field('Button Action / Menu Mode', this.select(`mc-${bid}-kind`, cfg.kind, [
          ['popup', 'Popup Menu (opens in place)'],
          ['rotating', 'Rotating Radial Hub'],
          ['radial', 'Radial Menu (arc fan)'],
          ['drawer', 'Drawer Menu (slide-in panel)'],
          ['slider-vertical', 'Vertical Slider Menu'],
          ['slider-horizontal', 'Horizontal Slider Menu'],
          ['carousel', 'Carousel Animated Roll Menu (2D/3D)'],
          ['show-element', 'Show Element (Popup / Modal / Drawer)'],
          ['hub', 'Hub Menu (3-button scrolling bar, min 3 items)']
        ], v => {
          const autoLayout = v === 'radial' || v === 'rotating' || v === 'hub'
            ? 'fan'
            : ['drawer', 'slider-vertical', 'slider-horizontal', 'carousel'].includes(v)
              ? v
              : cfg.layout;
          set({ kind: v, layout: autoLayout });
        })),
        this.field('Menu Layout', this.select(`mc-${bid}-layout`, cfg.layout, [
          ['fan', 'Radial / Fan Arc'],
          ['radial', 'Radial Circle'],
          ['list', 'Directional List'],
          ['drawer', 'Slide-Out Drawer'],
          ['slider-vertical', 'Vertical Slider'],
          ['slider-horizontal', 'Horizontal Slider'],
          ['carousel', 'Carousel Animated Roll']
        ], v => set({ layout: v })))
      ),
      cfg.kind !== 'show-element'
        ? h('div', { class: 'grid2' },
            this.field('Orientation', this.select(`mc-${bid}-orientation`, curOrient, [
              ['horizontal', cfg.kind === 'hub' ? 'Horizontal (left / centre / right)' : 'Horizontal'],
              ['vertical', cfg.kind === 'hub' ? 'Vertical (top / centre / bottom)' : 'Vertical']
            ], v => set(menuOrientationPatch(cfg, v)))),
            this.field('Item Labels', this.select(`mc-${bid}-labels`, labelsOn ? (cfg.labelPosition || 'auto') : 'off', [
              ['off', 'Hidden (icons only)'],
              ['auto', `Auto (${autoLabelPos === 'beside' ? 'Beside' : 'Over'} · by menu mechanism)`],
              ['beside', 'Beside button'],
              ['over', 'Over button']
            ], v => set(v === 'off' ? { showLabels: false } : { showLabels: true, labelPosition: v })))
          )
        : null,
      cfg.kind === 'show-element'
        ? this.field('Element or Screen to Show', h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
            h('span', { class: 'muted', 'data-f': `mc-${bid}-target-el-name`, style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              (() => {
                if (cfg.targetScreenId && !cfg.targetElementId) { const s = findDesign('screen', cfg.targetScreenId); return `🖥 ${s?.name ?? `screen #${cfg.targetScreenId}`}`; }
                const cur = els.find(el => el.id === cfg.targetElementId);
                return cur ? `▣ ${cur.name} (${cur.key})` : '(choose an element or screen…)';
              })()),
            libraryBrowseButton({
              dataF: `mc-${bid}-target-el-browse`, title: 'Browse screens and elements',
              currentScreenId: cfg.targetScreenId ?? null, currentElementId: cfg.targetElementId ?? null, projectId: d.doc?.projectId ?? state.activeProjectId,
              onPick: ({ screenId, elementId }) => set(screenId ? { targetScreenId: screenId, targetElementId: null } : { targetElementId: elementId, targetScreenId: null })
            })
          ))
        : null,
      cfg.kind === 'hub'
        ? h('div', { class: 'grid2' },
            this.field('Buttons shown at once (the rest: turn the ring)', this.select(`mc-${bid}-hubcount`, hubCount(cfg), [1, 2, 3, 4, 5, 6].map(n => [n, String(n)]), async v => {
              await set({ hubCount: Number(v) });
              d.fit?.();
            })),
            this.field('Icon size inside the buttons (0 = auto … 1 = fills the button)', this.num(`mc-${bid}-hubiconsize`, cfg.hubIconSize ?? 0, v => set({ hubIconSize: Math.max(0, Math.min(1, Number(v) || 0)) }), { step: 0.05, min: 0, max: 1 })),
            num('centerScale', 'Centre item size × button (0 = 2 × base small)'), num('hubCenterSize', 'Bar: centre size × centre (even bars: both middle ones)'), num('hubSideSize', 'Bar: side size × centre'), num('hubEdgeSize', 'Bar: edge size × centre'), num('hubScale', 'Base small size × button (gaps, back button)'), num('gap', 'Gap small ↔ centre × button'), num('radius', 'Sub items distance from centre ×'), num('itemScale', 'Sub items size × centre'), num('startAngle', 'Fan start angle °', 5), num('sweep', 'Fan sweep °', 5),
            h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'Menu items stay at their fixed preset positions along the bar and do not move to the center position when clicked' },
              h('input', { type: 'checkbox', checked: !!cfg.hubFixedPositions, 'data-f': `mc-${bid}-hubfixed`, onchange: async e => { await set({ hubFixedPositions: e.target.checked }); d.fit?.(); } }), h('span', {}, 'Fix item positions (do not move to center)')),
            h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'The centre stays where it is and the sub items use only the part of the ring around it that is inside the device screen. Sub items without room are not drawn: the first and last (smaller) ones turn the ring to reach them.' },
              h('input', { type: 'checkbox', checked: cfg.hubSubInside !== false, 'data-f': `mc-${bid}-hubsubinside`, onchange: e => set({ hubSubInside: e.target.checked }) }), h('span', {}, 'Sub items stay inside the screen (centre fixed)')),
            h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'When the sub items would not fit the screen they are scaled down (size and distance) until they do' },
              h('input', { type: 'checkbox', checked: !!cfg.hubFit, 'data-f': `mc-${bid}-hubfit`, onchange: e => set({ hubFit: e.target.checked }) }), h('span', {}, 'Auto downsize sub items to fit the screen')),
            h('div', { class: 'muted', 'data-f': `mc-${bid}-hubscroll-note`, style: { gridColumn: '1 / -1' } }, 'Slide-to-scroll is set per menu item: edit an item (✎) and tick “Slide this item to scroll a container”, then choose the container on the screen.'),
            this.field('When clicked rotate (° per click, 0 = off, 360 = full turn)', this.num(`mc-${bid}-hubspin`, cfg.hubSpin, v => set({ hubSpin: v }), { step: 45 })))
        : (cfg.layout === 'fan' || cfg.layout === 'radial' || cfg.kind === 'radial')
        ? h('div', { class: 'grid2' }, num('radius', 'Distance from parent (radius) × button'), num('itemScale', 'Item size × button'), num('startAngle', 'Start angle °', 5), num('sweep', 'Sweep °', 5))
        : (cfg.layout === 'carousel' || cfg.kind === 'carousel')
          ? h('div', { class: 'grid2' },
              this.field('Roll Dimension', this.select(`mc-${bid}-dim`, cfg.dimension || '3d', [['3d', '3D Perspective Roll'], ['2d', '2D Flat Roll']], v => set({ dimension: v }))),
              this.field('Roll Direction', this.select(`mc-${bid}-dir`, cfg.direction === 'vertical' ? 'vertical' : 'horizontal', [['horizontal', 'Horizontal Roll'], ['vertical', 'Vertical Roll']], v => set({ direction: v }))),
              num('itemScale', 'Item size × button'),
              num('distance', 'Distance from parent × button'),
              num('gap', 'Gap between items × button')
            )
          : (cfg.layout === 'drawer' || cfg.kind === 'drawer')
            ? h('div', { class: 'grid2' },
                this.field('Drawer Side', this.select(`mc-${bid}-side`, cfg.side || 'right', DRAWER_SIDES, v => set({ side: v, direction: v }))),
                num('itemScale', 'Item size × button'),
                num('distance', 'Distance from parent × button'),
                num('gap', 'Gap between items × button')
              )
            : h('div', { class: 'grid2' }, this.field('Direction', this.select(`mc-${bid}-dir`, cfg.direction, ['up', 'down', 'left', 'right'], v => set({ direction: v }))), num('itemScale', 'Item size × button'), num('distance', 'Distance from parent × button'), num('gap', 'Gap between items × button')),
      ['hub', 'radial', 'rotating', 'popup'].includes(cfg.kind)
        ? this.field(cfg.kind === 'hub' ? 'Sub items open (e.g. the burger item)' : 'Items open', this.select(`mc-${bid}-corner`, cfg.fanCorner || '', [
            ['', 'Around the button'],
            ['bottom-right', 'Radial fan · bottom right corner of the screen'],
            ['bottom-left', 'Radial fan · bottom left corner of the screen'],
            ['top-right', 'Radial fan · top right corner of the screen'],
            ['top-left', 'Radial fan · top left corner of the screen']
          ], v => set({ fanCorner: v })))
        : null,
      this.menuStyleTool(bid, cfg, rows, set),
      h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'When the opened menu would leave the device screen it is shifted back inside' },
        h('input', { type: 'checkbox', checked: cfg.keepInside !== false, 'data-f': `mc-${bid}-keep`, onchange: e => set({ keepInside: e.target.checked }) }), h('span', {}, 'Keep the menu inside the device screen')),
      this.field('Centre icon turns while open (°, 0 = off)', this.num(`mc-${bid}-rot`, cfg.rotateOnOpen, v => set({ rotateOnOpen: v }), { step: 5 }))
    ];
    const tree = buildMenuTree(rows, { includeHidden: true });
    const lines = [];
    const walk = (list, depth) => list.forEach(n => {
      const ic = findDesign('icon', n.iconId);
      const popEl = n.targetElementId ? findDesign('element', n.targetElementId) : null;
      const scr = n.targetScreenId ? this.screenChoices().find(s => s.id === n.targetScreenId) : null;
      const isVisible = n.visible !== false, offByParent = !!n.hiddenByParent;   // a hidden parent disables its whole sub tree
      const canFocus = d.menu?.focusItem && d.doc?.id === bid;
      lines.push(h('div', {
        draggable: 'true', dataset: { menuItem: String(n.id) },
        ondragstart: e => { e.dataTransfer.setData('text/plain', String(n.id)); e.dataTransfer.effectAllowed = 'move'; this.dragMenuItem = n.id; },
        ondragend: () => { this.dragMenuItem = null; document.querySelectorAll('.mi-drop-before,.mi-drop-after,.mi-drop-inside').forEach(x => x.classList.remove('mi-drop-before', 'mi-drop-after', 'mi-drop-inside')); },
        ondragover: e => {
          if (this.dragMenuItem == null || this.dragMenuItem === n.id) return;
          e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
          const el = e.currentTarget, r = el.getBoundingClientRect(), y = (e.clientY - r.top) / (r.height || 1);
          el.classList.remove('mi-drop-before', 'mi-drop-after', 'mi-drop-inside');
          el.classList.add(y < 0.28 ? 'mi-drop-before' : y > 0.72 ? 'mi-drop-after' : 'mi-drop-inside');
        },
        ondragleave: e => e.currentTarget.classList.remove('mi-drop-before', 'mi-drop-after', 'mi-drop-inside'),
        ondrop: async e => {
          e.preventDefault(); e.stopPropagation();
          const el = e.currentTarget, id = this.dragMenuItem;
          const where = el.classList.contains('mi-drop-before') ? 'before' : el.classList.contains('mi-drop-after') ? 'after' : 'inside';
          el.classList.remove('mi-drop-before', 'mi-drop-after', 'mi-drop-inside');
          this.dragMenuItem = null;
          if (id != null) await menuActions.moveTo(d, id, n.id, where, bid);
        },
        class: `el-row${canFocus ? ' mi-focusable' : ''}${canFocus && d.menu.focusedId === n.id ? ' on' : ''}`, style: { paddingLeft: `${7 + depth * 14}px`, opacity: isVisible && !offByParent ? 1 : 0.45, fontStyle: offByParent ? 'italic' : '' },
        title: offByParent ? 'Hidden because a parent item is hidden (shows again with it)' : canFocus ? 'Click to show this item on the canvas' : undefined,
        onclick: canFocus ? e => {
          if (e.target.closest('button, input, select, a')) return;
          e.currentTarget.parentElement?.querySelectorAll(':scope > .el-row.on').forEach(r => r.classList.remove('on'));
          e.currentTarget.classList.add('on');
          setTimeout(() => d.menu.focusItem(n.id), 0);   // after this click: the menu's outside-click rule would close the level again
        } : undefined
      },
        h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: n.descriptionDev || n.name },
          `${n.label || n.name}`,
          h('span', { class: 'dim' }, ic ? ` · ${ic.key}` : ''),
          popEl ? h('span', { class: 'badge', style: { marginLeft: '4px' }, title: `Opens popup element: ${popEl.name}` }, `🗔 ${popEl.key}`) : null,
          scr ? h('span', { class: 'badge', style: { marginLeft: '4px' }, title: `Routes to screen: ${scr.name}` }, `➜ ${scr.name}`) : null
        ),
        ibtn(isVisible ? 'view' : 'close', isVisible ? 'Visible' : 'Hidden', () => menuActions.toggleVisible(d, n.id, bid), { desc: isVisible ? 'Click to hide this item' : 'Click to show this item' }),
        ibtn('plus', 'Add sub item', () => menuActions.add(d, n.id, bid)),
        // hub: the top-level item the bar starts with in the centre (first visible item when none is set)
        cfg.kind === 'hub' && depth === 0
          ? ibtn('target', 'Default centre button', () => d.menu?.setDefaultCentre ? d.menu.setDefaultCentre(n.id, bid, tree.filter(x => x.visible !== false).findIndex(x => x.id === n.id)) : set({ hubCenterItemId: n.id }), { active: Number(cfg.hubCenterItemId) === n.id || (cfg.hubCenterItemId == null && tree.find(x => x.visible !== false)?.id === n.id), desc: 'The hub menu starts with this item in the centre, between its neighbours' })
          : null,
        ibtn('pencil', 'Edit menu item', () => menuActions.edit(d, n.id, bid)),
        ibtn('arrowUp', 'Move earlier', () => menuActions.move(d, n.id, -1, bid), { desc: 'Order up' }),
        ibtn('arrowDown', 'Move later', () => menuActions.move(d, n.id, 1, bid), { desc: 'Order down' }),
        ibtn('trash', 'Remove menu item', () => menuActions.remove(d, n.id, bid))));
      walk(n.children, depth + 1);
    });
    walk(tree, 0);
    return this.section(`Menu Items · ${rows.length} item(s)`,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Order items (↑/↓) or drag them (top / bottom edge = before / after, middle = inside), add (＋), edit (✎, also changes the parent), toggle visible (👁), or remove (🗑). Each item can route to a screen or show an element as a popup/modal box.'),
      ...settings,
      h('div', { class: 'el-list',
        ondragover: e => { if (this.dragMenuItem != null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } },
        ondrop: async e => { e.preventDefault(); const id = this.dragMenuItem; this.dragMenuItem = null; if (id != null) await menuActions.moveTo(d, id, null, 'after', bid); }   // dropped on the empty area: end of the top level
      }, lines.length ? lines : h('div', { class: 'empty' }, 'No menu items yet.')),
      ibtn('plus', 'Add menu item', () => menuActions.add(d, null, bid), { cls: 'primary' }));
  }

  nodesList() {
    const d = this.d;
    // tree order: groups (anything with sub items) first among their siblings, each followed by its sub items, indented
    const ids = new Set(d.nodes.map(n => n.id));
    const kidsOf = new Map();
    for (const n of d.nodes) { const p = n.parentId != null && ids.has(n.parentId) ? n.parentId : null; if (!kidsOf.has(p)) kidsOf.set(p, []); kidsOf.get(p).push(n); }
    const isGroup = n => n.tag === 'g' || kidsOf.has(n.id);
    const depthOf = new Map(), ordered = [];
    const walk = (p, depth) => (kidsOf.get(p) || []).sort((a, b) => isGroup(b) - isGroup(a) || b.ord - a.ord || b.id - a.id)
      .forEach(n => { depthOf.set(n.id, depth); ordered.push(n); walk(n.id, depth + 1); });
    walk(null, 0);
    const rows = ordered.map(e => {
      const label = e.kind === 'instance' ? `${e.refType}: ${findDesign(e.refType, e.refId)?.key ?? '?'}` : e.tag === 'text' ? `"${e.text}"` : (e.name || e.tag);
      return h('div', {
        class: `el-row${d.selected.has(e.id) ? ' on' : ''}`, tabindex: '0', dataset: { layer: String(e.id) },
        title: 'Drag (or Alt+↑/↓) to change the stacking order',
        style: { paddingLeft: `${3 + 12 * (depthOf.get(e.id) || 0)}px`, opacity: e.visible ? 1 : 0.45 },
        onclick: ev => { if (this.layerDragEnded) { this.layerDragEnded = false; return; } if (e.parentId != null) d.enteredGroupId = e.parentId; d.select([e.id], { add: ev.shiftKey }); },
        onkeydown: async ev => {
          if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
          ev.preventDefault(); ev.stopPropagation();
          this.layerFocusId = e.id;      // the rows are rebuilt (twice: shown, then saved); keep the focus on this one
          await d.stepLayer(e.id, ev.key === 'ArrowUp' ? 1 : -1);
          this.layerFocusId = null;
          this.root.querySelector(`.el-layers [data-layer="${e.id}"]`)?.focus();
        }
      },
        h('span', { class: 'el-grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, iconEl('grip', { size: 14 })),
        h('span', { class: 't' }, TAG_LABEL[e.tag] || e.tag), h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: e.name }, e.name ? `${e.name} · ${label}` : label),
        e.role ? h('span', { class: 'badge' }, e.role) : null,
        e.onClick ? h('span', { class: 'badge', title: `click: ${e.onClick.type}` }, `⚡ ${e.onClick.type}`) : null,
        ibtn(e.visible ? 'view' : 'close', e.visible ? 'Hide' : 'Show', ev => { ev.stopPropagation(); d.patchNode(e.id, { visible: !e.visible }); }),
        ibtn(e.locked ? 'lock' : 'unlock', e.locked ? 'Unlock' : 'Lock', ev => { ev.stopPropagation(); d.patchNode(e.id, { locked: !e.locked }); }, { active: !!e.locked }),
        ibtn('pencil', 'Edit layer', ev => { ev.stopPropagation(); d.select([e.id]); }, { desc: 'Select this layer and open its properties' }),
        ibtn('trash', 'Delete layer', async ev => {
          ev.stopPropagation();
          if (!await confirmBox(`Delete layer "${e.name || label}"?`)) return;
          d.select([e.id]);
          await d.deleteSelected();
        }, { cls: 'danger' }));
    });
    const list = h('div', { class: 'el-list el-layers' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nothing here yet. Use the tools or drag from the library.'));
    this.installLayerDrag(list);
    // keep the list scroll and the keyboard focus across the re-render that follows a reorder
    const scroll = this.layersScroll || 0, focusId = this.layerFocusId;
    requestAnimationFrame(() => {
      list.scrollTop = scroll;
      if (focusId != null) list.querySelector(`[data-layer="${focusId}"]`)?.focus();
    });
    list.addEventListener('scroll', () => { this.layersScroll = list.scrollTop; });
    return this.section(`Layers (${d.nodes.length})`, list);
  }

  /**
   * Pointer-driven reordering of Layers rows: drag from the grip (mouse, pen or touch) or the row body (mouse, after a
   * few pixels). A line shows the drop slot; only siblings accept a drop. The list auto-scrolls near its edges.
   */
  installLayerDrag(list) {
    const d = this.d;
    const line = h('div', { class: 'el-drop-line', hidden: true });
    list.append(line);
    let drag = null;
    const nodeOf = id => d.nodes.find(n => n.id === id);
    const slotAt = y => {
      const rows = [...list.querySelectorAll('.el-row[data-layer]')].filter(r => Number(r.dataset.layer) !== drag.id);
      const src = nodeOf(drag.id);
      const sib = rows.filter(r => (nodeOf(Number(r.dataset.layer))?.parentId ?? null) === (src?.parentId ?? null));
      let best = null;
      for (const r of sib) {
        const b = r.getBoundingClientRect();
        for (const [place, edge] of [['above', b.top], ['below', b.bottom]]) {
          const dist = Math.abs(y - edge);
          if (!best || dist < best.dist) best = { row: r, place, edge, dist };
        }
      }
      return best;
    };
    const autoScroll = () => {
      if (!drag) return;
      const b = list.getBoundingClientRect(), zone = 28;
      const dy = drag.y < b.top + zone ? -(b.top + zone - drag.y) : drag.y > b.bottom - zone ? drag.y - (b.bottom - zone) : 0;
      if (dy && drag.active) { list.scrollTop += Math.max(-14, Math.min(14, dy / 2)); showSlot(); }
      drag.raf = requestAnimationFrame(autoScroll);
    };
    const showSlot = () => {
      const s = slotAt(drag.y);
      drag.slot = s;
      if (!s) { line.hidden = true; return; }
      const lb = list.getBoundingClientRect();
      line.hidden = false;
      line.style.top = `${Math.round(s.edge - lb.top + list.scrollTop - 1)}px`;
    };
    const end = async (ev, cancel = false) => {
      if (!drag) return;
      const g = drag; drag = null;
      cancelAnimationFrame(g.raf);
      line.hidden = true;
      g.row.classList.remove('dragging');
      try { g.row.releasePointerCapture?.(ev.pointerId); } catch { /* already released */ }
      if (!g.active) return;
      this.layerDragEnded = true;   // swallow the click that follows the drag
      setTimeout(() => { this.layerDragEnded = false; }, 0);
      if (cancel || !g.slot) return;
      await d.moveLayer(g.id, Number(g.slot.row.dataset.layer), g.slot.place);
    };
    list.addEventListener('pointerdown', ev => {
      const row = ev.target.closest('.el-row[data-layer]');
      if (!row || ev.button !== 0 || ev.target.closest('button')) return;
      const onGrip = !!ev.target.closest('.el-grip');
      if (!onGrip && ev.pointerType !== 'mouse') return;   // touch on the row body keeps scrolling the list
      drag = { id: Number(row.dataset.layer), row, x: ev.clientX, y: ev.clientY, y0: ev.clientY, active: false, onGrip, slot: null, raf: 0 };
      if (onGrip) ev.preventDefault();
      try { row.setPointerCapture(ev.pointerId); } catch { /* synthetic event */ }
      drag.raf = requestAnimationFrame(autoScroll);
    });
    list.addEventListener('pointermove', ev => {
      if (!drag) return;
      drag.y = ev.clientY;
      if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y0) < (drag.onGrip ? 2 : 5)) return;
        drag.active = true;
        drag.row.classList.add('dragging');
      }
      ev.preventDefault();
      showSlot();
    });
    list.addEventListener('pointerup', ev => end(ev));
    list.addEventListener('pointercancel', ev => end(ev, true));
    list.addEventListener('keydown', ev => { if (ev.key === 'Escape' && drag?.active) { ev.stopPropagation(); end(ev, true); } });
  }

  multiSection(sel) {
    const d = this.d;
    return this.section(`${sel.length} nodes selected`,
      this.anchorGrid(), h('div', { class: 'row wrap' },
        ibtn('copy', 'Duplicate', () => d.duplicateSelected(), { kbd: 'Ctrl+D' }), ibtn('trash', 'Delete', () => d.deleteSelected(), { kbd: 'Del', cls: 'danger' }),
        ibtn('arrowUp', 'Move up', () => d.reorder('up')), ibtn('arrowDown', 'Move down', () => d.reorder('down'))));
  }

  anchorGrid() {
    const d = this.d;
    const names = { tl: 'top-left', tc: 'top-center', tr: 'top-right', ml: 'middle-left', mc: 'center', mr: 'middle-right', bl: 'bottom-left', bc: 'bottom-center', br: 'bottom-right' };
    const order = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
    const margin = this.d.type === 'icon' ? 1 : (state.settings.grid || 24) / 2;
    const active = d.getRefPoint?.() || 'mc';   // reference point: centre by default
    return h('div', { class: 'row' },
      h('div', { class: 'ref-grid', role: 'radiogroup', 'aria-label': '9 reference points' },
        order.map(a => ibtn(a === active ? 'check' : 'dot', `Reference point: ${names[a]}`, () => { d.setRefPoint?.(a); d.placeSelected(a, margin); },
          { active: a === active, desc: a === active ? 'Current reference point (default: centre)' : 'Use as reference point and place the selection here', cls: 'ref-cell', size: 12 }))),
      h('span', { class: 'muted', style: { fontSize: '11px' } }, `Reference: ${names[active]}`));
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

    // library icon at the very top: shows the icon in use and opens the searchable icon picker to change it
    if (e.kind === 'instance' && e.refType === 'icon') {
      const cur = findDesign('icon', e.refId);
      secs.push(this.section('Icon from library',
        h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          cur ? h('img', { class: 'thumb small', alt: cur.label || cur.key, src: api.svgUrl('icon', cur.id, { theme: state.themeKey, animated: 0 }), style: { width: '44px', height: '44px', objectFit: 'contain' } }) : null,
          h('div', { class: 'grow', style: { minWidth: 0 } },
            h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur?.label || 'Missing icon'),
            h('div', { class: 'muted', style: { fontSize: '11px' } }, cur?.key || `icon #${e.refId}`)),
          ibtn('search', 'Change icon…', () => openIconPicker(e.refId, async icon => {
            if (icon.id === e.refId) return;
            await d.patchNode(e.id, { refId: icon.id });
            toast(`Icon changed to "${icon.label || icon.key}"`, 'ok', 1400);
          }), { cls: 'primary', desc: 'Search the library and pick another icon' }))));
    }

    // identity (placed at the very top of the inspector panel when any element is selected, with dynamic element type title)
    const ed = d.editorFor(e);
    secs.push(this.section(elementTypeTitle(e),
      h('div', { class: 'row wrap' }, ibtn('pencil', ed?.label || 'Open editor', () => d.openEditor(e), { desc: ed?.hint || '', disabled: !ed || ed.disabled, cls: 'primary' }),
        h('span', { class: 'muted', style: { fontSize: '11px' } }, ed?.hint || '')),
      this.field('Variable name', this.text('el-name', e.name, v => patch({ name: v.trim() }), { mono: true })),
      h('div', { class: 'grid2' },
        this.field('Surface role', this.select('el-role', e.role || '', [['', '(none)'], ...SURFACE_ROLES], v => patch({ role: v || null }))),
        this.field('Rotation °', this.num('el-rot', e.rotation, v => patch({ rotation: v })))),
      e.role === 'popup' ? this.field('Auto close after (sec, 0 = never)', this.num('el-autoclose', Number(e.attrs?.['data-autoclose']) || 0, v => patch({ attrs: { ...(e.attrs || {}), 'data-autoclose': v > 0 ? String(v) : null } }))) : null,
      e.role ? h('div', { class: 'muted', style: { fontSize: '11px' } }, 'The theme draws this element (fill, border, shadow). Setting colours below overrides the theme.') : null,
      (() => { const t = h('textarea', { rows: 3, placeholder: 'description-dev for this element…', 'data-f': 'el-dev' }); t.value = e.descriptionDev || ''; t.addEventListener('change', () => patch({ descriptionDev: t.value })); return this.field('description-dev', t); })()));

    if (e.kind === 'instance' && e.refType === 'button' && e.refId) {
      secs.push(this.menuSection(e.refId));
    }

    if (isRepeaterNode(e, state.library.elements)) {
      secs.push(this.repeaterSection(e));
    } else if (isContainerNode(e, state.library.elements)) {
      secs.push(...this.containerSections(e));
    } else if (e.parentId != null && isRepeaterNode(d.byId(e.parentId), state.library.elements)) {
      const rep = d.byId(e.parentId);
      secs.push(this.section(`Repeater template · ${rep.name || 'repeater'}`,
        h('div', { class: 'muted', style: { fontSize: '11px' } }, `This item is repeated ${repeaterConfig(rep).itemCount}× by its repeater; edit it once, every copy follows. Drop another item on the repeater to replace it.`),
        h('div', { class: 'row wrap' }, ibtn('selectBox', 'Select repeater', () => d.select([rep.id])))));
    } else if (e.parentId != null) {
      const parentCont = d.byId(e.parentId);
      if (parentCont && isContainerNode(parentCont, state.library.elements)) {
        const ib = containerInnerBox(parentCont, d.nodes, state.library.elements);
        secs.push(this.section(`Inside Container · ${parentCont.name || parentCont.tag}`,
          h('div', { class: 'muted', style: { fontSize: '11px' } },
            `Max child size limited to ${Math.round(ib.w)}×${Math.round(ib.h)}px (inner margin ${getContainerConfig(parentCont, state.library.elements).innerMargin}px).`),
          h('div', { class: 'row wrap' },
            ibtn('selectBox', 'Select container', () => d.select([parentCont.id])),
            ibtn('fitBox', 'Fit inside container', () => patch({ attrs: clampNodeToContainer(e, parentCont, d.nodes, state.library.elements) }), { desc: 'Clamp this element inside its container' }),
            ibtn('unlink', 'Detach from container', () => patch({ parentId: null }))
          )
        ));
      }
    }

    // geometry
    const geo = [h('div', { class: 'grid4' },
      this.field('X', this.num('g-x', box.x, v => setBox({ x: v }))), this.field('Y', this.num('g-y', box.y, v => setBox({ y: v }))),
      this.field('W', this.num('g-w', box.w, v => setBox({ w: Math.max(0.5, v) }))), this.field('H', this.num('g-h', box.h, v => setBox({ h: Math.max(0.5, v) })))),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!e.locked, onchange: ev => patch({ locked: ev.target.checked }) }), h('span', { class: 'muted' }, e.locked ? '🔒 Position locked (cannot be dragged)' : '🔓 Position unlocked (check to lock position)')),
      this.anchorGrid(),
      h('div', { class: 'row wrap' }, ['front', 'up', 'down', 'back'].map(w => ibtn(w === 'front' ? 'bringFront' : w === 'back' ? 'sendBack' : w === 'up' ? 'arrowUp' : 'arrowDown', w === 'front' ? 'To front' : w === 'back' ? 'To back' : w === 'up' ? 'Forward' : 'Backward', () => d.reorder(w))),
        ibtn('copy', 'Duplicate', () => d.duplicateSelected(), { kbd: 'Ctrl+D' }), ibtn('trash', 'Delete', () => d.deleteSelected(), { kbd: 'Del', cls: 'danger' }))];
    if (isVertexEditable(e.tag) && e.kind !== 'instance') geo.unshift(h('div', { class: 'row wrap' }, h('button', { class: 'btn small primary', title: 'Drag vertices and bezier handles (Enter / N)', onclick: () => d.vtx.enter(e) }, e.tag === 'path' ? '✦ Edit vertices' : '✦ Convert to path & edit vertices'), h('span', { class: 'muted', style: { fontSize: '11px' } }, 'double-click on the canvas')));
    if (e.tag === 'path' && (e.attrs.transform || e.rotation)) geo.unshift(h('div', { class: 'row wrap' }, ibtn('sliders', 'Apply transform to points', () => d.bakeSelected(), { desc: "Bake the path's transform and rotation into its points (needed for vertex editing of rotated paths)" }), h('span', { class: 'muted', style: { fontSize: '11px' } }, 'this path is transformed')));
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
    // (shown at the bottom of the inspector, below the design / menu / layers sections)
    this.lowSections = [this.clickSection(e), this.animationSection(e)];
    return secs;
  }

  /** Repeater controls: layout, 2D/3D, item count, gap, slot size, speed, autoplay, perspective. Shows all sub-items added into the repeater. */
  repeaterSection(e) {
    const d = this.d, cfg = repeaterConfig(e), A = REPEATER_ATTR;
    const tpls = repeaterTemplates(d.nodes, e.id);
    const topOutside = d.nodes.filter(n => n.id !== e.id && n.parentId == null && n.role !== 'bg' && n.role !== 'bg-glow');
    const set = async patchAttrs => {
      await d.patchNode(e.id, { attrs: { ...(e.attrs || {}), ...patchAttrs } });
      // the repeater grows / shrinks around its copies and keeps templates on slots (count, layout, gap ... changed)
      await d.fitRepeater(e.id);
    };
    const ring = (cfg.layout === 'carousel' || cfg.layout === 'roll') && cfg.dimension === '3d';
    const dimToggle = h('div', { class: 'row', role: 'group', 'aria-label': '2D or 3D' },
      ...['2d', '3d'].map(v => h('button', { type: 'button', class: `btn small${cfg.dimension === v ? ' primary' : ''}`, 'aria-pressed': String(cfg.dimension === v), 'data-f': `rp-dim-${v}`,
        onclick: () => set({ [A.dimension]: v }) }, v.toUpperCase())));

    const adoptSel = h('select', { 'aria-label': 'Add existing element into repeater' },
      h('option', { value: '' }, '＋ Add item into this repeater…'),
      ...topOutside.map(n => h('option', { value: n.id }, `${n.name || n.tag} (#${n.id})`))
    );
    adoptSel.addEventListener('change', async () => {
      const targetId = Number(adoptSel.value);
      if (!targetId) return;
      const ch = d.byId(targetId);
      if (!ch) return;
      const nextOrd = tpls.reduce((m, n) => Math.max(m, (n.ord ?? 0) + 1), 0);
      await d.patchNode(ch.id, { parentId: e.id, ord: nextOrd });
      await d.fitRepeater(e.id);
      toast(`Added "${ch.name || ch.tag}" into repeater "${e.name || 'repeater'}"`, 'ok', 1500);
    });

    const childRows = tpls.map((ch, idx) => h('div', { class: 'el-row' },
      h('span', { class: 't' }, `#${idx + 1} ${TAG_LABEL[ch.tag] || ch.tag}`),
      h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ch.name || ch.tag),
      ibtn('pointer', 'Select sub-item', () => d.select([ch.id])),
      ibtn('unlink', 'Detach sub-item', async () => {
        await d.patchNode(ch.id, { parentId: null });
        await d.fitRepeater(e.id);
      })
    ));

    return this.section(`Repeater · ${cfg.layout} · ${cfg.dimension.toUpperCase()} · ${cfg.itemCount}×`,
      h('div', { class: 'muted', style: { fontSize: '11px' } },
        tpls.length
          ? `${tpls.length} item type(s) configured. Repeater randomly distributes all types (at least 1 copy each) across ${cfg.itemCount} slots.`
          : 'Drop any icon, button or element onto this repeater to add template items.'),
      h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'The item last selected in the list (tapped, or reached by a menu item that slides this repeater in focus mode) gets a red edge.' },
        h('input', { type: 'checkbox', 'data-f': `rp-focus-ring-${e.id}`, checked: e.attrs?.['data-focus-ring'] === 'true', onchange: ev => set({ 'data-focus-ring': ev.target.checked ? 'true' : 'false' }) }), h('span', {}, 'Red edge on the focused (last selected) item')),
      h('div', { class: 'grid2' },
        this.field('Layout', this.select(`rp-layout-${e.id}`, cfg.layout, [
          ['vertical', 'Vertical list'], ['horizontal', 'Horizontal row'], ['carousel', 'Carousel'], ['roll', 'Roll (ticker / wheel)'], ['slide', 'Slide (one at a time)'], ['scroll', 'Scroll (infinite loop)']
        ], v => set({ [A.layout]: v }))),
        this.field('Dimension', dimToggle)),
      h('div', { class: 'grid2' },
        this.field(`Item count (1–${REPEATER_MAX_ITEMS})`, this.num(`rp-count-${e.id}`, cfg.itemCount, v => set({ [A.itemCount]: Math.max(1, Math.min(REPEATER_MAX_ITEMS, Math.round(v))) }), { min: 1, max: REPEATER_MAX_ITEMS, step: 1 })),
        this.field('Gap (px)', this.num(`rp-gap-${e.id}`, cfg.gap, v => set({ [A.gap]: Math.max(0, v) }), { min: 0, step: 2 }))),
      h('div', { class: 'grid2' },
        this.field('Item width (0 = template)', this.num(`rp-iw-${e.id}`, cfg.itemWidth, v => set({ [A.itemWidth]: Math.max(0, v) }), { min: 0, step: 1 })),
        this.field('Item height (0 = template)', this.num(`rp-ih-${e.id}`, cfg.itemHeight, v => set({ [A.itemHeight]: Math.max(0, v) }), { min: 0, step: 1 }))),
      h('div', { class: 'grid2' },
        this.field('Speed (ms per item)', this.num(`rp-speed-${e.id}`, cfg.speed, v => set({ [A.speed]: Math.max(200, v) }), { min: 200, step: 100 })),
        this.field('Autoplay', h('label', { class: 'row', style: { paddingTop: '5px' } },
          h('input', { type: 'checkbox', checked: cfg.autoplay, 'data-f': `rp-auto-${e.id}`, onchange: ev => set({ [A.autoplay]: ev.target.checked ? 'true' : 'false' }) }),
          h('span', {}, cfg.autoplay ? 'Playing' : 'Paused')))),
      h('div', { class: 'grid2' },
        cfg.layout === 'vertical' ? this.field('Columns (0 = auto, 1 = one column)', this.num(`rp-cols-${e.id}`, cfg.columns, v => set({ [A.columns]: Math.max(0, Math.min(12, Math.round(v))) }), { min: 0, max: 12, step: 1 })) : null,
        tpls.length > 1 ? h('button', { class: 'btn small', type: 'button', 'data-f': `rp-shuffle-${e.id}`, title: 'Pick which sub-item appears where at random again (each sub-item still shows at least once)', onclick: () => set({ [A.seed]: String(Math.floor(Math.random() * 1e9)) }) }, '🔀 Shuffle items') : null,
        this.field('Items shown as', this.select(`rp-display-${e.id}`, cfg.display, [['list', 'List (plain rows)'], ['card', 'Card (each item on its own card)']], v => set({ [A.display]: v }))),
        ['slide', 'scroll'].includes(cfg.layout) ? this.field('Direction', this.select(`rp-dir-${e.id}`, cfg.direction, [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], v => set({ [A.direction]: v }))) : null,
        cfg.dimension === '3d' ? this.field('Perspective (px)', this.num(`rp-persp-${e.id}`, cfg.perspective, v => set({ [A.perspective]: Math.max(100, v) }), { min: 100, step: 50 })) : null),
      ring ? h('div', { class: 'muted', style: { fontSize: '11px' } }, cfg.layout === 'carousel' ? '3D carousel: the copies turn on a ring around the vertical axis.' : '3D roll: the copies turn on a cylinder around the horizontal axis (picker wheel).') : null,
      h('div', { style: { marginTop: '8px', borderTop: '1px solid var(--line)', paddingTop: '8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
          h('b', { style: { fontSize: '11px' } }, `Sub-items in repeater (${tpls.length})`),
          adoptSel
        ),
        h('div', { class: 'el-list' },
          childRows.length ? childRows : h('div', { class: 'empty' }, 'No sub-items yet. Drop icons, buttons or elements onto this repeater.')
        )
      ),
      h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px' } }, 'Animations follow the canvas "Animate" toggle; multiple item types are distributed across total item count bounded by the screen.'));
  }

  /** Container & Carousel Container Inspector Sections (inner/outer margins, fixed/responsive, fit to device screen, sub-elements, 2D/3D roll). */
  containerSections(e) {
    const d = this.d;
    const cfg = getContainerConfig(e, state.library.elements);
    const isCarousel = cfg.isCarousel;
    const setContainerAttrs = patchAttrs => {
      const nextAttrs = { ...(e.attrs || {}), ...patchAttrs };
      return d.patchNode(e.id, { attrs: nextAttrs });
    };
    const fitToScreen = async fitMode => {
      const from = nodeBBox(e, d.nodes);
      const tempNode = { ...e, attrs: { ...(e.attrs || {}), 'data-fit-screen': fitMode } };
      const to = fitContainerToScreenBox(tempNode, d.doc.width, d.doc.height, { fitMode, allNodes: d.nodes });
      const nextAttrs = { ...resizeAttrs(e, from, to), 'data-fit-screen': fitMode };
      await d.patchNode(e.id, { attrs: nextAttrs });
      toast(fitMode === 'full' ? 'Fitted container to full device screen (with outer margin)' : 'Fitted container width to device screen (with outer margin)', 'ok', 1600);
    };

    const children = d.nodes.filter(n => n.parentId === e.id);
    const topOutside = d.nodes.filter(n => n.id !== e.id && n.parentId == null && n.role !== 'bg' && n.role !== 'bg-glow');
    const ib = containerInnerBox(e, d.nodes, state.library.elements);

    const adoptSel = h('select', { 'aria-label': 'Add existing element into container' },
      h('option', { value: '' }, '＋ Move element into this container…'),
      ...topOutside.map(n => h('option', { value: n.id }, `${n.name || n.tag} (#${n.id})`))
    );
    adoptSel.addEventListener('change', async () => {
      const targetId = Number(adoptSel.value);
      if (!targetId) return;
      const ch = d.byId(targetId);
      if (!ch) return;
      const clamped = clampNodeToContainer(ch, e, d.nodes, state.library.elements);
      await d.patchNode(ch.id, { parentId: e.id, attrs: clamped });
      toast(`Moved "${ch.name || ch.tag}" into container "${e.name || 'container'}"`, 'ok', 1500);
    });

    const childRows = children.map(ch => h('div', { class: 'el-row' },
      h('span', { class: 't' }, TAG_LABEL[ch.tag] || ch.tag),
      h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ch.name || ch.tag),
      ibtn('pointer', 'Select sub-element', () => d.select([ch.id])),
      ibtn('unlink', 'Detach sub-element', () => d.patchNode(ch.id, { parentId: null }))
    ));

    const out = [
      this.section(`Container Shell · ${cfg.sizeMode.toUpperCase()}`,
        h('div', { class: 'muted', style: { fontSize: '11px' } },
          `Outer shell box that limits child max size to ${Math.round(ib.w)}×${Math.round(ib.h)}px. Drop any element inside this container on the canvas.`),
        h('div', { class: 'row wrap', style: { gap: '14px' }, title: 'Content larger than the container scrolls (by drag / wheel, or by a menu item set to slide-scroll this container). On by default.' },
          ...[['data-scroll-y', 'Scroll vertical'], ['data-scroll-x', 'Scroll horizontal']].map(([k, l]) => h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
            h('input', { type: 'checkbox', 'data-f': `ct-${k}-${e.id}`, checked: e.attrs?.[k] !== 'false', onchange: ev => setContainerAttrs({ [k]: ev.target.checked ? 'true' : 'false' }) }), h('span', {}, l))),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: 'The item last selected in this list (tapped, or reached by a menu item that slides this container in focus mode) gets a red edge.' },
            h('input', { type: 'checkbox', 'data-f': `ct-focus-ring-${e.id}`, checked: e.attrs?.['data-focus-ring'] === 'true', onchange: ev => setContainerAttrs({ 'data-focus-ring': ev.target.checked ? 'true' : 'false' }) }), h('span', {}, 'Red edge on the focused item'))),
        h('div', { class: 'grid2' },
          this.field('Container mode', this.select(`ct-kind-${e.id}`, isCarousel ? 'carousel' : 'container', [
            ['container', '▣ Standard Container'],
            ['carousel', '🎠 Carousel Container (2D/3D Roll)']
          ], v => d.patchNode(e.id, {
            role: v === 'carousel' ? 'carousel-container' : 'container',
            attrs: {
              ...(e.attrs || {}),
              'data-container': v,
              ...(v === 'carousel' ? {
                'data-carousel-dim': e.attrs?.['data-carousel-dim'] || '3d',
                'data-carousel-dir': e.attrs?.['data-carousel-dir'] || 'horizontal',
                'data-carousel-speed': e.attrs?.['data-carousel-speed'] || 2600,
                'data-carousel-autoroll': e.attrs?.['data-carousel-autoroll'] ?? 'true'
              } : {})
            }
          }))),
          this.field('Size mode', this.select(`ct-size-${e.id}`, cfg.sizeMode, [
            ['responsive', 'Responsive (scales with screen)'],
            ['fixed', 'Fixed size']
          ], v => setContainerAttrs({ 'data-size-mode': v })))
        ),
        h('div', { class: 'grid2' },
          this.field('Outer margin (px)', this.num(`ct-om-${e.id}`, cfg.outerMargin, v => setContainerAttrs({ 'data-outer-margin': Math.max(0, v) }), { min: 0, step: 2 })),
          this.field('Inner margin (px)', this.num(`ct-im-${e.id}`, cfg.innerMargin, v => setContainerAttrs({ 'data-inner-margin': Math.max(0, v) }), { min: 0, step: 2 }))
        ),
        h('div', { class: 'row wrap' },
          ibtn('fit', 'Fit screen width', () => fitToScreen('width'), { desc: 'Fit container width to the device screen, respecting outer margin', cls: 'primary' }),
          ibtn('monitor', 'Fit full screen', () => fitToScreen('full'), { desc: 'Fit container to the full device screen, respecting outer margin' })
        ),
        h('div', { class: 'el-list', style: { marginTop: '4px' } },
          childRows.length ? childRows : h('div', { class: 'empty' }, 'No sub-elements yet. Drag & drop items onto this container.')
        ),
        topOutside.length ? adoptSel : null
      )
    ];

    if (isCarousel) {
      const stepCarousel = async delta => {
        const nextIdx = Math.max(0, (cfg.carouselIndex + delta + Math.max(1, children.length)) % Math.max(1, children.length || 3));
        await setContainerAttrs({ 'data-carousel-index': nextIdx });
        toast(`Carousel roll index: ${nextIdx + 1}`, 'info', 1000);
      };
      out.push(
        this.section(`Carousel Roll · ${cfg.carouselDim.toUpperCase()} ${cfg.carouselDir}`,
          h('div', { class: 'muted', style: { fontSize: '11px' } },
            'Animates sub-elements with a 3D perspective or 2D flat horizontal/vertical roll effect.'),
          h('div', { class: 'grid2' },
            this.field('Roll dimension', this.select(`cr-dim-${e.id}`, cfg.carouselDim, [
              ['3d', '3D Perspective Roll'],
              ['2d', '2D Flat Roll']
            ], v => setContainerAttrs({ 'data-carousel-dim': v }))),
            this.field('Roll direction', this.select(`cr-dir-${e.id}`, cfg.carouselDir, [
              ['horizontal', 'Horizontal (Left ↔ Right)'],
              ['vertical', 'Vertical (Up ↕ Down)']
            ], v => setContainerAttrs({ 'data-carousel-dir': v })))
          ),
          h('div', { class: 'grid2' },
            this.field('Roll speed (ms)', this.num(`cr-spd-${e.id}`, cfg.carouselSpeed, v => setContainerAttrs({ 'data-carousel-speed': Math.max(300, v) }), { min: 300, step: 100 })),
            this.field('Auto-roll', h('label', { class: 'row', style: { paddingTop: '5px' } },
              h('input', {
                type: 'checkbox',
                checked: cfg.carouselAutoRoll,
                onchange: ev => setContainerAttrs({ 'data-carousel-autoroll': ev.target.checked ? 'true' : 'false' })
              }),
              h('span', {}, cfg.carouselAutoRoll ? 'Rolling active' : 'Paused')
            ))
          ),
          h('div', { class: 'row wrap' },
            ibtn(cfg.carouselDir === 'vertical' ? 'arrowUp' : 'arrowLeft', cfg.carouselDir === 'vertical' ? 'Roll up' : 'Roll left', () => stepCarousel(-1)),
            ibtn(cfg.carouselDir === 'vertical' ? 'arrowDown' : 'arrowRight', cfg.carouselDir === 'vertical' ? 'Roll down' : 'Roll right', () => stepCarousel(1))
          )
        )
      );
    }

    return out;
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
      ['show-element', 'Show element (Popup / Modal / Drawer / Inline)'],
      ['element', 'Open an element'],
      ['popup', 'Open a popup'],
      ['toolbar', 'Open a small element toolbar'],
      ['drawer', 'Open a drawer'],
      ['radial-menu', 'Act as Radial Menu'],
      ['drawer-menu', 'Act as Drawer Menu'],
      ['slider-vertical', 'Act as Vertical Slider Menu'],
      ['slider-horizontal', 'Act as Horizontal Slider Menu'],
      ['carousel-menu', 'Act as Carousel Animated Roll Menu (2D/3D)'],
      ['animate', 'Trigger animation'],
      ['toggle', 'Toggle visibility / flip'],
      ['swap', 'Change to the target item (icon / button, e.g. asc ↔ desc)'],
      ['back', 'Go back']
    ], v => {
      if (v === 'none') return save(null);
      if (v === 'back') return save({ type: 'back' });
      if (['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu'].includes(v)) {
        return save({
          type: v,
          ...(cur?.targetId ? { targetId: cur.targetId } : {}),
          ...(v === 'drawer-menu' ? { side: cur?.side || 'right' } : {}),
          ...(v === 'slider-vertical' ? { direction: cur?.direction || 'down' } : {}),
          ...(v === 'slider-horizontal' ? { direction: cur?.direction || 'right' } : {}),
          ...(v === 'carousel-menu' ? { dimension: cur?.dimension || '3d', direction: cur?.direction || 'horizontal' } : {})
        });
      }
      const isEl = ['element', 'show-element', 'popup', 'toolbar', 'drawer'].includes(v);
      const wasEl = ['element', 'show-element', 'popup', 'toolbar', 'drawer'].includes(cur?.type);
      const keep = cur?.targetId && ((v === 'screen' && cur.type === 'screen') || (isEl && wasEl)) ? cur.targetId : null;
      if (keep) return save({ type: v, targetId: keep, ...(v === 'drawer' ? { side: cur.side || 'right' } : {}), ...(v === 'show-element' ? { displayMode: cur.displayMode || 'popup' } : {}) });
      if (v === 'animate' || v === 'toggle') return save({ type: v, animationType: 'pulse' });
      this.pendingClick.set(e.id, { type: v }); this.render();
    });
    const kids = [this.field('Primary click action', typeSel)];
    const open = [];
    if (type === 'screen') {
      const screens = this.screenChoices();
      kids.push(this.field('Target screen or element', h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'muted', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.targetId ? `🖥 ${findDesign('screen', cur.targetId)?.name ?? `#${cur.targetId}`}` : '(choose a screen…)'),
        libraryBrowseButton({
          currentScreenId: cur.targetId ?? null, projectId: d.doc?.projectId ?? state.activeProjectId,
          onPick: ({ screenId, elementId }) => screenId ? save({ type: 'screen', targetId: screenId }) : save({ type: 'element', targetId: elementId })
        }))));
      if (cur.targetId) open.push(ibtn('monitor', 'Open that screen', () => d.opts.openDesign?.('screen', cur.targetId)));
    } else if (type === 'swap') {
      kids.push(this.field('Target item (shown on click, a second click restores this one)', h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'muted', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.targetId ? `▣ ${findDesign('element', cur.targetId)?.name ?? `#${cur.targetId}`}` : '(choose the target item…)'),
        libraryBrowseButton({
          currentElementId: cur.targetId ?? null, projectId: d.doc?.projectId ?? state.activeProjectId,
          onPick: ({ elementId }) => { if (elementId) save({ type: 'swap', targetId: elementId }); }
        }))));
    } else if (['element', 'show-element', 'popup', 'toolbar', 'drawer'].includes(type)) {
      const els = [...state.library.elements].sort((a, b) => a.name.localeCompare(b.name));
      kids.push(this.field('Element / Toolbar or screen to open', h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'muted', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.targetId ? `▣ ${findDesign('element', cur.targetId)?.name ?? `#${cur.targetId}`}` : '(choose an element…)'),
        libraryBrowseButton({
          currentElementId: cur.targetId ?? null, projectId: d.doc?.projectId ?? state.activeProjectId,
          onPick: ({ screenId, elementId }) => screenId
            ? save({ type: 'screen', targetId: screenId })
            : save({ type, targetId: elementId, ...(type === 'drawer' ? { side: cur.side || 'right' } : {}), ...(type === 'show-element' ? { displayMode: cur.displayMode || 'popup' } : {}) })
        }))));
      if (type === 'drawer') kids.push(this.field('Slides in from', this.select('ck-side', cur.side || 'right', DRAWER_SIDES, v => cur.targetId && save({ type, targetId: cur.targetId, side: v }))));
      if (type === 'show-element') kids.push(this.field('Display Mode', this.select('ck-display-mode', cur.displayMode || 'popup', [['popup', 'Popup / Modal Box'], ['drawer', 'Slide-In Drawer'], ['inline', 'Inline Overlay']], v => cur.targetId && save({ type, targetId: cur.targetId, displayMode: v }))));
      if (cur.targetId) open.push(ibtn('layers', 'Open that element', () => d.opts.openDesign?.('element', cur.targetId)));
    } else if (type === 'drawer-menu') {
      kids.push(this.field('Drawer Side', this.select('ck-drawer-menu-side', cur?.side || 'right', DRAWER_SIDES, v => save({ ...cur, type, side: v }))));
    } else if (type === 'slider-vertical') {
      kids.push(this.field('Slider Direction', this.select('ck-slider-v-dir', cur?.direction || 'down', [['down', 'Slide Down'], ['up', 'Slide Up']], v => save({ ...cur, type, direction: v }))));
    } else if (type === 'slider-horizontal') {
      kids.push(this.field('Slider Direction', this.select('ck-slider-h-dir', cur?.direction || 'right', [['right', 'Slide Right'], ['left', 'Slide Left']], v => save({ ...cur, type, direction: v }))));
    } else if (type === 'carousel-menu') {
      kids.push(
        h('div', { class: 'grid2' },
          this.field('Roll Dimension', this.select('ck-car-dim', cur?.dimension || '3d', [['3d', '3D Perspective Roll'], ['2d', '2D Flat Roll']], v => save({ ...cur, type, dimension: v, direction: cur?.direction || 'horizontal' }))),
          this.field('Roll Direction', this.select('ck-car-dir', cur?.direction || 'horizontal', [['horizontal', 'Horizontal Roll'], ['vertical', 'Vertical Roll']], v => save({ ...cur, type, dimension: cur?.dimension || '3d', direction: v })))
        )
      );
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
      'show-element': 'Shows the chosen element as a popup/modal box, drawer, or inline overlay.',
      element: 'Opens the chosen element overlay.',
      popup: 'Opens the element in a modal dialog over the page.',
      toolbar: 'Opens a floating small element toolbar anchored near this element.',
      drawer: 'Slides the element in from the chosen edge.',
      'radial-menu': 'Acts as a radial fan menu around the button.',
      'drawer-menu': 'Acts as a slide-in drawer menu.',
      'slider-vertical': 'Acts as a vertical sliding menu bar.',
      'slider-horizontal': 'Acts as a horizontal sliding menu bar.',
      'carousel-menu': 'Acts as a 2D/3D horizontal or vertical animated roll carousel menu.',
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
        ibtn('trash', 'Remove animation', () => d.removeAnimation(a))),
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

  /** Sandboxed custom ES module JS & pinned public JS imports for `element` designs (zero execution on Designer origin). */
  elementScriptSection() {
    const doc = this.d.doc;
    if (!doc || this.d.type !== 'element') return h('div');
    const id = doc.id;
    if (!this.scriptCache.has(id) && !this.scriptLoading.has(id)) {
      this.scriptLoading.add(id);
      api.elementScript(id)
        .then(res => { this.scriptCache.set(id, { loaded: true, script: res?.script || null }); })
        .catch(() => { this.scriptCache.set(id, { loaded: true, script: null }); })
        .finally(() => { this.scriptLoading.delete(id); if (this.d.doc?.id === id) this.render(); });
    }
    const cached = this.scriptCache.get(id);
    const sc = cached?.script || null;
    const defaultCode = `export function mount(container, props, bridge) {\n  // Runs strictly inside an opaque-origin <iframe sandbox="allow-scripts">\n  const btn = document.createElement('button');\n  btn.textContent = props.label || 'Interact';\n  btn.addEventListener('click', () => bridge.emit('select', { ts: Date.now() }));\n  container.replaceChildren(btn);\n}`;
    const enabledChk = h('input', { type: 'checkbox', checked: sc ? sc.enabled !== false : true });
    const verifyOnSaveChk = h('input', { type: 'checkbox', checked: Boolean(sc?.imports?.length) });
    const entryInput = h('input', { type: 'text', value: sc?.entryExport || 'mount', placeholder: 'mount', 'data-f': 'el-sc-entry', style: { fontFamily: 'Consolas, monospace' } });
    entryInput.value = sc?.entryExport || 'mount';
    const codeArea = h('textarea', { rows: 7, 'data-f': 'el-sc-code', style: { fontFamily: 'Consolas, monospace', fontSize: '11.5px' }, placeholder: defaultCode });
    codeArea.value = sc?.moduleCode || '';
    const importsArea = h('textarea', {
      rows: 4,
      'data-f': 'el-sc-imports',
      style: { fontFamily: 'Consolas, monospace', fontSize: '11.5px' },
      placeholder: '[\n  { "package": "canvas-confetti", "version": "1.9.3", "specifier": "canvas-confetti" }\n]'
    });
    importsArea.value = sc?.imports?.length ? JSON.stringify(sc.imports, null, 2) : '';

    const parsePayload = (humanApproved = false) => {
      let imports = [];
      const rawImp = importsArea.value.trim();
      if (rawImp) {
        try {
          imports = JSON.parse(rawImp);
          if (!Array.isArray(imports)) throw new Error('imports must be a JSON array');
        } catch (err) {
          toast(`Invalid imports JSON: ${err.message}`, 'error');
          return null;
        }
      }
      const moduleCode = codeArea.value.trim() || defaultCode;
      return {
        enabled: enabledChk.checked,
        runtime: 'esm',
        entryExport: entryInput.value.trim() || 'mount',
        moduleCode,
        imports,
        capabilities: sc?.capabilities || { allowNetwork: false, allowedConnectOrigins: [], allowTimers: true, allowCanvas: true },
        propsSchema: sc?.propsSchema || {},
        emits: sc?.emits || [],
        verifyIntegrity: verifyOnSaveChk.checked && imports.length > 0,
        ...(humanApproved ? { humanApproved: true } : {})
      };
    };

    const onSave = async (humanApproved = false) => {
      const payload = parsePayload(humanApproved);
      if (!payload) return;
      try {
        const res = await api.setElementScript(id, payload);
        this.scriptCache.set(id, { loaded: true, script: res.script });
        toast(humanApproved ? 'Element script saved & network capability approved' : 'Sandboxed element script saved', 'ok', 1800);
        this.render();
      } catch (err) {
        toast(err.message || 'Failed to save element script', 'error', 3600);
      }
    };

    const onVerifySri = async () => {
      try {
        const res = await api.verifyElementScriptSri(id, {});
        this.scriptCache.set(id, { loaded: true, script: res.script });
        toast(`Verified sha384 SRI for ${res.script?.imports?.length || 0} CDN import(s)`, 'ok', 2000);
        this.render();
      } catch (err) {
        toast(err.message || 'SRI verification failed', 'error', 3600);
      }
    };

    const onRemove = async () => {
      if (!(await confirmBox(`Remove custom JS module from element "${doc.key}"?`))) return;
      try {
        await api.deleteElementScript(id);
        this.scriptCache.set(id, { loaded: true, script: null });
        toast('Removed custom element script', 'ok', 1600);
        this.render();
      } catch (err) {
        toast(err.message || 'Failed to remove script', 'error', 3000);
      }
    };

    const statusBadge = !cached?.loaded
      ? h('span', { class: 'badge' }, 'Loading…')
      : sc
        ? h('span', { class: `badge ${sc.reviewStatus === 'needs-human-review' ? '' : 'accent'}`, style: sc.reviewStatus === 'needs-human-review' ? { color: 'var(--warn)' } : null },
            `${sc.enabled ? '● Active' : '○ Disabled'} · ${sc.reviewStatus}${sc.imports?.length ? ` · ${sc.imports.length} pkg` : ''}`)
        : h('span', { class: 'badge' }, 'None');

    const reviewBanner = sc?.reviewStatus === 'needs-human-review'
      ? h('div', { style: { padding: '8px', borderRadius: '6px', border: '1px solid var(--warn, #f59e0b)', fontSize: '11px', marginBottom: '6px' } },
          h('div', { style: { marginBottom: '6px' } }, '⚠ This script requested network capability via AI/MCP. CSP keeps connect-src \'none\' until a signed-in human approves it.'),
          h('button', { class: 'btn small primary', onclick: () => onSave(true) }, '✓ Approve Network Capability'))
      : null;

    return this.section(
      `Custom JS & Public Libs${sc ? ' · Sandboxed' : ''}`,
      h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
        statusBadge,
        sc?.sriVerified && sc?.imports?.length ? h('span', { class: 'muted', style: { fontSize: '10.5px' } }, '✓ sha384 SRI verified') : null
      ),
      reviewBanner,
      h('div', { class: 'grid2' },
        h('label', { class: 'row', style: { paddingTop: '14px' } }, enabledChk, h('span', {}, 'Enabled')),
        this.field('Entry export', entryInput)
      ),
      this.field('ES Module (mount(container, props, bridge))', codeArea, 'full'),
      this.field('Pinned Public JS Imports (exact x.y.z · jsdelivr / esm.sh / unpkg)', importsArea, 'full'),
      h('label', { class: 'row', style: { fontSize: '11.5px' } }, verifyOnSaveChk, h('span', { class: 'muted' }, 'Fetch & pin sha384 Subresource Integrity (SRI) on save')),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '4px' } },
        h('button', { class: 'btn small primary', onclick: () => onSave(false) }, sc ? 'Save Script' : 'Attach Script'),
        sc?.imports?.length ? h('button', { class: 'btn small', onclick: onVerifySri }, 'Verify SRI') : null,
        sc ? h('button', { class: 'btn small', onclick: () => this.openElementSandboxModal(id) }, '▶ Sandbox Preview') : null,
        sc ? h('button', { class: 'btn small danger', onclick: onRemove }, 'Remove') : null
      ),
      h('div', { class: 'muted', style: { fontSize: '10.5px' } }, 'Never runs on the Designer origin: executes strictly inside <iframe sandbox="allow-scripts" referrerpolicy="no-referrer"> with nonce CSP.')
    );
  }

  async openElementSandboxModal(elementId) {
    try {
      const sb = await api.elementScriptSandbox(elementId, { style: state.themeKey });
      const logBox = h('pre', { style: { margin: 0, padding: '8px', maxHeight: '140px', overflowY: 'auto', fontSize: '11px', background: 'rgba(0,0,0,0.28)', borderRadius: '6px' } }, 'Waiting for opaque-origin sandbox events…\n');
      const frame = h('iframe', {
        sandbox: 'allow-scripts',
        referrerpolicy: 'no-referrer',
        srcdoc: sb.html,
        title: `Sandboxed preview · ${sb.element?.key || elementId}`,
        style: { width: '100%', height: `${Math.min(540, Math.max(220, (sb.element?.height || 240) + 48))}px`, border: '1px solid var(--line)', borderRadius: '8px', background: 'transparent' }
      });
      const onMsg = ev => {
        if (ev.source !== frame.contentWindow) return;
        const d = ev.data;
        if (!d || d.__uiuxSandbox !== 1) return;
        logBox.textContent += `[${new Date().toISOString().slice(11, 19)}] ${d.event}: ${JSON.stringify(d.detail ?? {})}\n`;
        logBox.scrollTop = logBox.scrollHeight;
      };
      window.addEventListener('message', onMsg);
      const m = modal({
        title: `Sandboxed Element Preview · ${sb.element?.key || elementId}`,
        wide: true,
        content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { class: 'muted', style: { fontSize: '11px', wordBreak: 'break-all' } }, `Isolation: sandbox="allow-scripts" (opaque null origin) · CSP: ${sb.csp}`),
          frame,
          h('div', { style: { fontSize: '11px', fontWeight: '600' } }, 'postMessage Bridge Log'),
          logBox
        )
      });
      const origClose = m.close?.bind(m);
      if (origClose) m.close = () => { window.removeEventListener('message', onMsg); origClose(); };
    } catch (err) {
      toast(err.message || 'Could not open sandbox preview', 'error', 3200);
    }
  }
}
