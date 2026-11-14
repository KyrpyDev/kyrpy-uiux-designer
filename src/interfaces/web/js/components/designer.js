/**
 * Canvas editor used by every designer: path, icon, button, element and screen.
 * Renders with the shared domain renderer, edits through the API, saves on every change.
 * Interactions: infinite pan/zoom, drag from the library (hierarchy rules apply), move/resize with grid + 9-point snapping,
 * bounding box that scales its contents, marquee select, vertex editing of paths, live button menus, undo/redo.
 */
import { clickTargetOf, withClickTarget, isBackOrCancel, withBackAction } from '/domain/quick-edit.js';
import { popupAutoCloseSecs } from '/domain/theme.js';
import { h, clear, toast, promptBox, confirmBox, choiceBox, modal } from '../dom.js';
import { ibtn, iconEl } from '../icons.js';
import { api } from '../api.js';
import { markEdited, sessionEdited, lastEdited, rememberName, editedName, forgetSessionEdited } from '../edited.js';
import { state, emit, renderContext, currentTheme, findDesign, libOf, projectLabel, canEditOwned, ownerLabel, isPublicLibraryItem } from '../state.js';
import { prefixedVariableName } from '/domain/naming.js';
import { designFingerprint, restoreBody } from '/domain/doc-fingerprint.js';
import { renderDocument, renderIconDocument, renderTree } from '/domain/svg.js';
import {
  nodeBBox, translateAttrs, resizeAttrs, snap, anchorPoints, placeAtAnchor, scaleNodeSet,
  isContainerNode, isCarouselContainerNode, getContainerConfig, containerInnerBox,
  clampBoxToContainer, clampNodeToContainer, fitContainerToScreenBox, fitNodesToScreen
} from '/domain/geometry.js';
import { defaultAnimation } from '/domain/animation.js';
import { reorderLayer, stepLayer, extractNodes } from '/domain/node-ops.js';
import { isRepeaterNode, repeaterConfig, repeaterPlan, repeaterTemplateOps, repeaterAdoptOps, repeaterDefaultAttrs, repeaterTemplate, repeaterTemplates, repeaterFitBox, bindRepeaterScroll, REPEATER_KEY } from '/domain/repeater.js';
import { DEVICES, TYPES, canContain } from '/domain/entities.js';
import { menuConfig, buildMenuTree, menuExtent } from '/domain/menu.js';
import { updateSettings, openGuide, reloadLibrary, revealInLibrary, createEmptyItem, deleteDesign, resetLibraryIconCache, ensureDesignDeps } from '../actions.js';
import { VertexEditor } from './vertex-editor.js';
import { openIconPicker } from './inspector.js';
import { MenuEditor, menuActions, openMenuItemsModal, pickTarget, targetPatch } from './menu-editor.js';
import { PenTool } from './pen-tool.js';
import { installPathTools } from './designer-pathtools.js';
import { installTestActions } from './designer-test-actions.js';
import { openEventsModal, openLineageModal } from './collab-modals.js';
import { openCopyMoveToProjectsModal } from './item-browser.js';
import { popupCfgOf, popupAnimation, makeDraggable, placePopupBox, popupTestControls } from './popup-test-editor.js';

const TOOLS = [
  ['select', 'V', '⌖', 'Select / move'],
  ['node', 'N', '✦', 'Vertex editing of the selected path (Enter)'],
  ['container', 'K', '▣', 'Container: shell box with inner/outer margins that limits child max size'],
  ['carousel', 'U', '🎠', 'Carousel Container: container with 2D/3D horizontal & vertical animated roll effect'],
  ['rect', 'R', '▭', 'Rectangle'],
  ['circle', 'C', '◯', 'Circle'],
  ['ellipse', 'E', '⬭', 'Ellipse'],
  ['polygon', 'G', '⬡', 'Polygon / Hexagon'],
  ['star', 'W', '★', 'Star (5-point)'],
  ['arrow', 'A', '➔', 'Arrow shape'],
  ['callout', 'Q', '💬', 'Callout bubble'],
  ['freehand', 'F', '✍', 'Freehand draw'],
  ['line', 'L', '╱', 'Line'],
  ['pen', 'B', '🖊', 'Pen: click for corners, click-drag for curves, click the first point to close, Enter or right-click to finish'],
  ['text', 'T', 'T', 'Text'],
  ['crop', 'X', '⛶', 'Crop: drag a rectangle, the selected shapes keep only what is inside it'],
  ['path', 'P', '✎', 'New path (enter the d attribute)']
];
const TAB_GLYPH = { path: 'bezier', icon: 'star', button: 'circle', element: 'rect', screen: 'monitor', workflow: 'workflow' };
const MIN_Z = 0.04, MAX_Z = 80;
const GLYPH = new Set(['path', 'icon']);
const deep = o => JSON.parse(JSON.stringify(o));
const NAMES = { path: 'Path designer', icon: 'Icon designer', button: 'Button designer', element: 'Element designer', screen: 'Screen designer' };

export class Designer {
  /**
   * @param {HTMLElement} root
   * @param {{onClose?:Function, openDesign?:(type,id)=>void, onBack?:Function, canBack?:()=>boolean, modal?:boolean}} opts
   *   onBack/canBack show the Back button; modal = inside a dialog (Save as stays in the library instead of opening the copy)
   */
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts; this.api = api;
    this.type = null; this.doc = null;
    this.baseline = null; this.baselineFp = ''; this.dirty = false;   // last saved version of the open design
    this.selected = new Set();
    this.hoveredNodeId = null;
    this.toolbarNodeId = null;   // element whose quick toolbar is open (click toggles it; never opened by hover)
    this.tool = 'select';
    this.view = { tx: 0, ty: 0, z: 1 };
    this.undoStack = []; this.redoStack = [];
    this.listeners = new Map();
    this.guides = []; this.marquee = null; this.ghost = null;
    this.dragging = false; this.inspectorOpen = true; this.scaleContent = true; this.menuLive = false; this.actionsLive = false; this.pv = null; this.tbPv = null;
    this.build();
    this.vtx = new VertexEditor(this);
    this.menu = new MenuEditor(this);
    this.pen = new PenTool(this);
  }

  on(evt, fn) { if (!this.listeners.has(evt)) this.listeners.set(evt, new Set()); this.listeners.get(evt).add(fn); }
  emit(evt, data) {
    if (evt === 'doc' || evt === 'changed' || evt === 'record') this.checkDirty();   // every edit announces itself this way
    for (const fn of this.listeners.get(evt) || []) fn(data);
  }

  /* ================= structure ================= */
  build() {
    clear(this.root);
    this.root.classList.add('dz');
    this.docbar = h('div', { class: 'dz-docbar', role: 'toolbar', 'aria-label': 'Document' });
    this.bar = h('div', { class: 'dz-bar', role: 'toolbar' });
    this.viewport = h('div', { class: 'dz-viewport', tabindex: '0', 'aria-label': 'Design canvas' });
    this.world = h('div', { class: 'dz-world' });
    this.frame = h('div', { class: 'dz-device-frame' });
    this.stage = h('div', { class: 'dz-stage' });
    // test mode: a wheel / drag inside a repeater's area scrolls its copies instead of zooming the canvas
    bindRepeaterScroll(this.stage, () => this.actionsLive);
    this.liveLayer = h('div', { class: 'dz-live-layer', hidden: true });
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'dz-overlay');
    this.inPlaceBackdrop = h('div', { class: 'dz-inplace-backdrop', hidden: true, 'aria-hidden': 'true' });
    this.world.append(this.frame, this.inPlaceBackdrop, this.stage, this.liveLayer, this.overlay);
    this.liveHud = h('div', { class: 'dz-live-hud', hidden: true });
    this.hoverBar = h('div', { class: 'el-hover-toolbar', hidden: true });
    this.hint = h('div', { class: 'dz-hint' }, 'Wheel: zoom · Space/middle-drag: pan · Click element: open/close quick toolbar · Right-click: menu & events · Del: delete · Enter: edit vertices');
    this.previewBanner = h('div', { class: 'dz-preview-banner', hidden: true, role: 'status' });
    this.inPlaceBanner = h('div', { class: 'dz-preview-banner dz-inplace-banner', hidden: true, role: 'status' });
    this.viewport.append(this.world, this.hoverBar, this.hint, this.previewBanner, this.inPlaceBanner);
    this.inspectorEl = h('aside', { class: 'dz-inspector' });
    this.inspectorFitted = false;
    // drag handle on the inspector's left edge: drag to resize, the width is clamped
    this.inspSplit = h('div', { class: 'insp-splitter', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize the inspector' });
    this.inspSplit.addEventListener('pointerdown', ev => {
      this.inspSplit.setPointerCapture(ev.pointerId);
      const startX = ev.clientX, startW = this.inspectorEl.getBoundingClientRect().width;
      const mv = e => this.setInspectorWidth(startW - (e.clientX - startX));
      const up = () => {
        this.inspSplit.removeEventListener('pointermove', mv);
        this.inspSplit.removeEventListener('pointerup', up);
        this.fitted = false; this.fit();
      };
      this.inspSplit.addEventListener('pointermove', mv);
      this.inspSplit.addEventListener('pointerup', up);
    });
    this.body = h('div', { class: 'dz-body' }, this.viewport, this.inspSplit, this.inspectorEl);
    this.pathBar = h('div', { class: 'dz-bar dz-pathbar', role: 'toolbar', 'aria-label': 'Path tools' });
    this.topRow = h('div', { class: 'dz-toprow' }, this.docbar, this.pathBar);
    this.root.append(this.topRow, this.bar, this.liveHud, this.body);
    this.bindViewport();
    new ResizeObserver(() => { if (this.doc && !this.fitted) this.fit(); }).observe(this.viewport);
  }

  async load(type, id) {
    if (this.menu) { this.menu.pinned = null; this.menu.hideToolbar(); }   // no menu toolbar left over from the previous document
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
    this._loadingTarget = { type, id: Number(id), seq };
    let rec;
    try {
      rec = await api.getDesign(type, id);
    } finally {
      if (this._loadingTarget?.seq === seq) this._loadingTarget = null;
    }
    if (this._loadSeq !== seq) return;
    // placed items that are not in the loaded library (another project, library filter) are fetched before the first draw
    await ensureDesignDeps(rec).catch(e => console.warn('dependencies not loaded', e));
    if (this._loadSeq !== seq) return;
    this.vtx?.exit();
    const keepLive = Boolean((this._keepActionsLive || this.actionsLive) && ['button', 'element', 'screen'].includes(type));
    this._keepActionsLive = false;
    this.type = type; this.doc = rec;
    if (!(this._enteringInPlace && type === 'element' && Number(id) === this.inPlace?.elementId)) this.inPlace = null;
    this.syncInPlaceUi();
    this.devicePreview = null; this.syncDevicePreviewUi();
    this.selected = new Set(); this.undoStack = []; this.redoStack = []; this.fitted = false;
    this.scaleContent = ['button', 'element'].includes(type);
    this.menuLive = false;
    this.actionsLive = keepLive;
    this.root.classList.toggle('actions-live', this.actionsLive);
    this.closePreview();
    this.menu.menuState = { open: true, path: [] };
    this.markBaseline();
    this.buildBar();
    this.renderAll();
    requestAnimationFrame(() => { this.fit(); this.fitted = true; });
    this.emit('loaded', rec);
  }

  async reload(keepSelection = true) {
    const sel = keepSelection ? [...this.selected] : [];
    const rec = await api.getDesign(this.type, this.doc.id);
    await ensureDesignDeps(rec).catch(e => console.warn('dependencies not loaded', e));
    this.doc = rec;
    if (this.devicePreview) this.layoutDevicePreview();   // a device preview stays on while the stored screen is re-read
    this.selected = new Set(sel.filter(i => this.doc.nodes.some(e => e.id === i)));
    this.renderAll();
    this.emit('doc', this.doc);
  }

  /* ================= device preview =================
   * The device picker only PREVIEWS the open screen on another device: the frame takes that size and the contents are laid out
   * for it in memory (fitNodesToScreen). Nothing is written, the screen keeps its own device and its saved / unsaved state.
   * While a preview is on the canvas is view-only (an edit made in preview coordinates would be stored in the wrong place);
   * "Apply to this screen" in the same menu is the explicit, undoable way to really change the screen's device. */
  layoutDevicePreview() {
    const dv = this.devicePreview, d = this.doc;
    if (!dv || !d) return;
    const attrs = new Map(fitNodesToScreen(d.nodes || [], { w: d.width || 1, h: d.height || 1 }, { w: dv.width, h: dv.height }).map(p => [p.id, p.attrs]));
    this.doc = { ...d, nodes: (d.nodes || []).map(n => (attrs.has(n.id) ? { ...n, attrs: attrs.get(n.id) } : n)),
      width: dv.width, height: dv.height, meta: { ...(d.meta || {}), device: dv.key } };
  }

  /** dv = null (or the screen's own device) goes back to the stored screen. Never writes anything. */
  async setDevicePreview(dv) {
    if (!this.doc || this.type !== 'screen') return;
    const targetType = this.type, targetId = this.doc.id;
    this.devicePreview = null;
    const rec = await api.getDesign(targetType, targetId);
    if (this.type !== targetType || this.doc?.id !== targetId) return;
    this.doc = rec;
    const own = dv && dv.key === rec.meta?.device && dv.width === rec.width && dv.height === rec.height;
    if (dv && !own) { this.devicePreview = { key: dv.key, name: dv.name, width: dv.width, height: dv.height }; this.layoutDevicePreview(); }
    this.selected = new Set(); this.toolbarNodeId = null; this.vtx?.exit();
    this.syncDevicePreviewUi();
    this.buildDocBar();
    this.renderAll();
    this.fitted = false; this.fit();
  }

  syncDevicePreviewUi() {
    const dv = this.devicePreview;
    this.root.classList.toggle('device-preview', !!dv);
    if (!this.previewBanner) return;
    this.previewBanner.hidden = !dv;
    if (!dv) return;
    clear(this.previewBanner);
    this.previewBanner.append(
      h('span', {}, `Preview on ${dv.name} (${dv.width}×${dv.height}) — view only, nothing is saved`),
      h('button', { class: 'btn small', dataset: { act: 'device-preview-exit' }, onclick: () => this.setDevicePreview(null) }, 'Back to editing'));
  }

  /** True (with a hint) while a device preview is shown: the canvas is view-only then. */
  previewLocked() {
    if (!this.devicePreview) return false;
    const now = Date.now();
    if (now - (this._previewHintAt || 0) > 2500) { this._previewHintAt = now; toast('Device preview is view-only. Press "Back to editing" to change the screen.', 'info', 2600); }
    return true;
  }

  /* ================= save / save as / reset =================
   * Every edit is stored in the database at once (a draft). "Saved" is a bookmark on top of that: the baseline is the version at the
   * last Save (or when the design was opened). Reset puts the baseline back, Save as copies the current state and puts the original
   * back to its baseline, and the Save button blinks while the design differs from the baseline. */
  markBaseline() { this.baseline = deep(this.doc); this.baselineFp = designFingerprint(this.doc); this.dirty = false; this.updateDocBar(); }

  checkDirty() {
    if (!this.doc || !this.baseline || this.devicePreview) return;
    const dirty = designFingerprint(this.doc) !== this.baselineFp;
    if (dirty === this.dirty) return;
    this.dirty = dirty; this.updateDocBar(); this.emit('dirty', dirty);
  }

  /** The owner, or an admin curating a public-library item (owned by the `public` system user). */
  isOwnedByCurrentUser(rec = this.doc) {
    return canEditOwned(rec);
  }

  canMoveRecord(rec = this.doc) {
    if (!rec) return false;
    return !rec.builtin && this.isOwnedByCurrentUser(rec);
  }

  buildSaveTargetsDropdown() {
    const projects = state.projects?.length
      ? state.projects
      : [{ id: 1, name: 'Default Public Project', ownerId: 1, visibility: 'public' }];
    const selSet = state.saveTargetProjectIds || (state.saveTargetProjectIds = new Set());
    const count = selSet.size + (state.saveToUserPrivateLibrary ? 1 : 0);
    const labelText = count > 0
      ? `🎯 Targets (${count})`
      : '🎯 Targets…';

    const panel = h('div', {
      class: 'menu-panel save-targets-panel',
      role: 'menu',
      style: { minWidth: '295px', padding: '8px', zIndex: '1200' },
      onclick: e => e.stopPropagation()
    });
    const wrap = h('div', { class: 'menu save-targets-dd', style: { position: 'relative', display: 'inline-flex' } });
    const triggerBtn = h('button', {
      class: `btn small ib save-targets-trigger${count > 0 ? ' active' : ''}`,
      'aria-label': 'Save targets',
      'data-tip': 'Save targets — also save into multiple projects and/or your All Projects library (with all sub-items)',
      onclick: e => {
        e.stopPropagation();
        const isOpen = wrap.classList.contains('open');
        document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) {
          wrap.classList.add('open');
          rebuildPanel();
        }
      }
    }, iconEl('target', { size: 16 }), h('span', { class: 'tb-badge', hidden: count === 0 }, String(count)));

    const updateTriggerText = () => {
      const c = selSet.size + (state.saveToUserPrivateLibrary ? 1 : 0);
      const badge = triggerBtn.querySelector('.tb-badge');
      if (badge) { badge.textContent = String(c); badge.hidden = c === 0; }
      triggerBtn.classList.toggle('active', c > 0);
    };

    const rebuildPanel = () => {
      clear(panel);
      panel.append(
        h('div', { class: 'row spread', style: { padding: '2px 4px 6px', borderBottom: '1px solid var(--line)', marginBottom: '6px' } },
          h('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '700' } }, 'MULTI-TARGET SAVE OPTIONS'),
          h('div', { class: 'row', style: { gap: '4px' } },
            h('button', {
              class: 'btn small',
              onclick: () => {
                projects.forEach(p => selSet.add(Number(p.id)));
                updateTriggerText();
                rebuildPanel();
              }
            }, 'All'),
            h('button', {
              class: 'btn small',
              onclick: () => {
                selSet.clear();
                updateTriggerText();
                rebuildPanel();
              }
            }, 'Clear')
          )
        )
      );

      for (const p of projects) {
        const pid = Number(p.id);
        const checked = selSet.has(pid);
        const chk = h('input', {
          type: 'checkbox',
          class: 'save-target-proj-chk',
          dataset: { targetProjectId: String(pid) },
          checked,
          onchange: () => {
            if (chk.checked) selSet.add(pid);
            else selSet.delete(pid);
            updateTriggerText();
            rebuildPanel();
          }
        });
        panel.append(
          h('label', {
            class: 'row spread save-target-row',
            style: {
              padding: '5px 8px',
              borderRadius: '6px',
              background: checked ? 'rgba(46,155,255,0.14)' : 'transparent',
              cursor: 'pointer',
              gap: '6px',
              fontSize: '12px'
            }
          },
          h('span', { class: 'row', style: { gap: '6px' } }, chk, `📁 ${projectLabel(p)}`),
          h('span', { class: 'muted', style: { fontSize: '10px' } }, `#${pid}`)
          )
        );
      }
    };

    wrap.append(triggerBtn, panel);
    return wrap;
  }

  /**
   * Switches a screen to another device: the frame takes the device size and the contents are laid out responsively
   * for it (full-width / full-height items keep spanning the screen, the others keep their shape and relative place;
   * see fitNodesToScreen). One undo step.
   */
  async applyDevice(dv) {
    if (!this.doc) return;
    if (this.devicePreview) await this.setDevicePreview(null);   // work on the stored screen, not on the preview copy
    const patches = fitNodesToScreen(this.nodes, { w: this.doc.width || 1, h: this.doc.height || 1 }, { w: dv.width, h: dv.height });
    await this.mutate(async () => {
      const saved = await api.updateDesign(this.type, this.doc.id, {
        meta: { ...(this.doc.meta || {}), device: dv.key }, width: dv.width, height: dv.height, scaleContent: false
      });
      this.doc = { ...this.doc, ...saved };
      await Promise.all(patches.map(p => api.patchNode(this.type, this.doc.id, p.id, { attrs: p.attrs })));
      await this.reload(false);
    });
    this.fitted = false; this.fit();   // re-centre the canvas on the new device frame
  }

  /** Screen device picker as an icon button in the top bar (sets the device frame size). */
  buildDeviceMenu() {
    const list = () => state.templateDevices?.length
      ? state.templateDevices.map(dv => ({ key: dv.key, name: dv.name, width: dv.width, height: dv.height }))
      : Object.entries(DEVICES).map(([k, v]) => ({ key: k, name: v.name, width: v.width, height: v.height }));
    const pv = this.devicePreview;
    const curKey = this.doc?.meta?.device;
    const curName = list().find(x => x.key === curKey)?.name || 'No device';
    const item = (label, tip, fn, tick = '') => h('button', {
      class: 'menu-item', role: 'menuitem', 'data-tip': tip,
      onclick: async () => { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); if (this.doc) await fn(); }
    }, h('span', { class: 'tick' }, tick), h('span', { class: 'mi-label' }, label));
    const ddWrap = h('div', { class: 'menu device-menu' });
    const panel = h('div', {
      class: 'menu-panel device-menu-panel',
      role: 'menu',
      style: { minWidth: '260px', maxHeight: '70vh', overflowY: 'auto', padding: '6px' },
      onclick: e => e.stopPropagation()
    });
    const trigger = h('button', {
      class: `btn small ib device-menu-trigger${pv ? ' active' : ''}`,
      'aria-label': `Device — ${curName}${pv ? ' (preview)' : ''}`,
      'data-tip': `Device — ${curName}${pv ? ' (preview)' : ''}\nPreview the screen on another device (nothing is saved)`,
      'aria-haspopup': 'true',
      onclick: e => {
        e.stopPropagation();
        const open = !ddWrap.classList.contains('open');
        document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
        if (!open) return;
        ddWrap.classList.add('open');
        clear(panel);
        panel.append(h('div', { class: 'menu-note' }, 'Preview only: the screen is not changed or saved.'));
        for (const dv of list()) {
          const active = dv.key === curKey;
          panel.append(h('button', {
            class: 'menu-item',
            role: 'menuitemradio',
            'aria-checked': String(active),
            onclick: async () => {
              document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
              if (!this.doc) return;
              await this.setDevicePreview(dv);
            }
          }, h('span', { class: 'tick' }, active ? '✓' : ''), h('span', { class: 'mi-label' }, `${dv.name} (${dv.width}×${dv.height})`)));
        }
        if (pv) {
          panel.append(h('div', { class: 'menu-sep' }),
            item('Back to the screen\'s own device', 'Leave the preview and edit the screen again', () => this.setDevicePreview(null), '↩'),
            item(`Apply ${pv.name} to this screen…`, 'Really change the screen to this device: its size and layout change (one undo step, saved like any other edit)',
              async () => { await this.applyDevice(pv); this.buildDocBar(); }, '⤓'));
        }
      }
    }, iconEl('monitor', { size: 16 }));
    ddWrap.append(trigger, panel);
    return ddWrap;
  }

  buildDocBar() {
    clear(this.docbar);
    if (this.doc) rememberName(this.type, this.doc.id, this.doc.name);
    const o = this.opts;
    const d = this.doc || {};
    const ownedByMe = this.isOwnedByCurrentUser(d);
    const canMove = this.canMoveRecord(d);
    this.backBtn = o.onBack ? ibtn('back', 'Back', () => o.onBack(), { desc: 'Return to the previous page', kbd: 'Alt+←', dataset: { act: 'back' } }) : null;
    this.saveBtn = ibtn('save', 'Save', () => this.save(), {
      desc: ownedByMe
        ? this.saveTargetNames()
        : `Disabled: owned by ${ownerLabel(d.creatorUsername, d.creatorId)}. Use Save as… to save a copy.`,
      disabled: !ownedByMe, cls: 'save'
    });
    this.saveAsBtn = ibtn('copy', 'Save as…', () => this.saveAs(), { desc: 'Save a copy (with all cascading sub-items) to your All Projects library and any selected Multi-Target projects.' });
    this.saveTargetsDropdown = this.buildSaveTargetsDropdown();
    this.resetBtn = ibtn('undo', 'Reset', () => this.reset(), { desc: 'Throw away every change since the last save' });
    this.deviceMenu = this.type === 'screen' ? this.buildDeviceMenu() : null;
    this.docState = h('span', { class: 'doc-state', role: 'status' });
    // Trash: moves the open item to the trash (restorable); the owner / admin only, library items follow the same rules as the library panel
    const trashBtn = ibtn('trash', 'Move to trash', () => this.doc && deleteDesign(this.type, this.doc), {
      disabled: !ownedByMe || !!d.builtin,
      desc: d.builtin ? 'Default basic items cannot be deleted' : 'Move this item to the Trash (restore or purge it there)', cls: 'doc-trash'
    });
    // Publish to public: admins publish at once; everybody else files a request the admins approve first
    const isAdminNow = state.user && ['admin', 'superadmin'].includes(state.user.role);
    const publishBtn = ibtn('globe', 'Publish to public', async () => {
      if (!this.doc) return;
      try {
        const r = await api.publishToPublic(this.type, this.doc.id);
        if (r.status === 'published') toast(`"${this.doc.name}" published to the public library (+${r.subItemsCount || 0} sub-items)`, 'ok', 3200);
        else toast(r.duplicate ? 'A publish request for this item is already waiting for admin approval' : 'Publish request sent: an admin must approve it; the item becomes public after approval', 'ok', 4200);
        await reloadLibrary({ silent: true });
      } catch (e) { toast(e.message, 'error'); }
    }, {
      disabled: !ownedByMe || (d.visibility === 'public' && !d.projectId),
      desc: isAdminNow ? 'Copy this item (with all sub-items) into the public library now' : 'Ask the admins to publish this item (with all sub-items) to the public library; it goes public after their approval',
      cls: 'doc-publish'
    });

    const visOrder = ['public', 'private', 'project'];
    const visLabel = d.visibility === 'project'
      ? '📁 Project-Only'
      : d.visibility === 'private'
        ? '🗂 All Projects (user\'s all projects)'
        : '🌐 Public';
    // visibility as a three-way icon group (Public / Private / Project-only); the active one is highlighted
    const setVis = async next => {
      if (!this.doc || next === (this.doc.visibility || 'public')) return;
      await this.updateDoc(next === 'project' ? { visibility: next, projectId: state.activeProjectId || this.doc.projectId || 1 } : { visibility: next });
      await revealInLibrary(this.doc);
      this.buildDocBar();
      toast(`Visibility set to ${next.toUpperCase()}`, 'ok');
    };
    const visSeg = h('div', { class: 'vis-seg', role: 'radiogroup', 'aria-label': 'Visibility scope' },
      [['public', 'globe', 'Public', 'Visible to all users'], ['private', 'user', 'All Projects', 'My global library: available in all of my projects'], ['project', 'folder', 'Project-only', 'Only the active project']].map(([v, icon, name, desc]) =>
        ibtn(icon, name, () => setVis(v), { desc, active: (d.visibility || 'public') === v, cls: 'vis-btn', dataset: { act: `vis-${v}` } })));

    const lockDocBtn = ibtn(d.locked ? 'lock' : 'unlock', d.locked ? 'Positions locked' : 'Positions unlocked', async () => {
      if (!this.doc) return;
      await this.updateDoc({ locked: !this.doc.locked });
      this.buildDocBar();
      toast(this.doc.locked ? '🔒 Design positions locked' : '🔓 Design positions unlocked', 'ok');
    }, { desc: 'Lock / unlock positions on this design', active: !!d.locked });

    const lineageBtn = ibtn('collab', 'Lineage', () => this.doc && openLineageModal(this.type, this.doc.id),
      { desc: `Root owner: ${ownerLabel(d.rootOwnerUsername || d.creatorUsername || 'superadmin', d.rootOwnerId)}${d.clonedFromId ? ` · cloned from #${d.clonedFromId}` : ''}\nView the creator & root owner lineage chain` });

    const copyToProjBtn = ibtn('copy', 'Copy to…', () => this.doc && openCopyMoveToProjectsModal({
      items: [{ type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key, builtin: d.builtin, creatorId: d.creatorId }],
      mode: 'copy'
    }), { desc: 'Copy this item (and all its sub-items) to one or multiple projects' });

    const moveToProjBtn = ibtn('import', 'Move to…', () => this.doc && canMove && openCopyMoveToProjectsModal({
      items: [{ type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key, builtin: d.builtin, creatorId: d.creatorId }],
      mode: 'move'
    }), {
      disabled: !canMove,
      desc: canMove
        ? 'Move this item (and all its sub-items) to one or multiple of your own projects'
        : (d.builtin ? 'Default basic items cannot be moved (only copied)' : 'Items owned by other users cannot be moved (only copied)')
    });

    this.docbar.append(...[
      this.historyMenu(),
      h('span', { class: 'sep-v' }),
      this.saveBtn,
      this.saveAsBtn,
      moveToProjBtn,
      this.saveTargetsDropdown,
      this.resetBtn,
      trashBtn,
      publishBtn,
      this.deviceMenu,
      h('span', { class: 'sep-v' }),
      lockDocBtn,
      copyToProjBtn,
      lineageBtn,
      this.type === 'screen' ? ibtn('workflow', 'Generate workflow', () => this.generateWorkflow(), { desc: 'New workflow from this screen: follows every menu item and click action that goes to another screen, screen after screen, and links them all as routes' }) : null
    ].filter(Boolean)); // Element.append() would render a null slot (no back button / device menu) as the text "null"
    emit('topbar:refresh');
    this.updateDocBar();
  }

  async patchRecord(patch) {
    return this.updateDoc(patch);
  }

  /** Tooltip text of the Save button: only the name(s) of the project(s) the save goes to (own project + checked targets). */
  saveTargetNames() {
    const projects = state.projects || [];
    const ids = new Set([this.doc?.projectId, ...(state.saveTargetProjectIds || [])].filter(v => v != null));
    const names = [...ids].map(id => projectLabel(projects.find(p => p.id === id) || { id }));
    return names.join(', ') || projectLabel(projects.find(p => p.id === state.activeProjectId));
  }

  updateDocBar() {
    if (!this.saveBtn) return;
    const ownedByMe = this.isOwnedByCurrentUser(this.doc);
    this.saveBtn.dataset.tip = ownedByMe ? `Save\n${this.saveTargetNames()}` : this.saveBtn.dataset.tip;
    this.saveBtn.disabled = !ownedByMe;
    this.saveBtn.classList.toggle('dirty', this.dirty && ownedByMe);
    this.resetBtn.disabled = !this.dirty;
    this.docState.classList.toggle('dirty', this.dirty);
    if (!ownedByMe) {
      this.docState.textContent = `🔒 Owned by ${ownerLabel(this.doc?.creatorUsername, this.doc?.creatorId)} — use Save as…`;
    } else {
      this.docState.textContent = this.dirty ? '● Unsaved changes: press Save' : '✓ All changes saved';
    }
    this.refreshBack();
  }

  /** The old Back button, now a history tool: a scrollable drop-down of the items edited in this session (most recent first), plus Back. */
  /**
   * The designer name in the tool bar. On the main page it is a drop-down that switches to another designer and opens the
   * item of that type that was edited last (a dialog designer keeps the plain label).
   */
  typeSwitch() {
    // a text menu: the name of the designer that is open (at most 20 characters)
    const full = NAMES[this.type] || '', short = full.length > 20 ? `${full.slice(0, 19)}…` : full;
    const label = h('span', { class: 'text-menu-label' }, short);
    if (!this.opts.openPage) { label.className = 'badge'; label.style.marginLeft = '6px'; return label; }
    const btn = this.toolMenu(TAB_GLYPH[this.type] || 'dot', 'Switch designer: opens the item of that type you edited last', () =>
      ['path', 'icon', 'button', 'element', 'screen', 'workflow'].map(t => {
        const id = lastEdited(t), name = id != null ? (findDesign(t, id)?.name || editedName(t, id)) : '';
        const title = t === 'workflow' ? 'Workflow designer' : NAMES[t];
        return [TAB_GLYPH[t] || 'dot', `${title}${t === this.type ? '  ·  current' : name ? `  ·  ${name}` : ''}`, () => { if (t !== this.type) this.opts.openPage(t); }, name ? `Open the ${t} edited last: "${name}"` : `Open the ${t} designer`];
      }));
    btn.classList.add('type-switch', 'text-menu'); btn.dataset.act = 'type-switch'; btn.style.marginLeft = '6px';
    btn.firstChild.replaceWith(label);
    return btn;
  }

  historyMenu() {
    // the history of this designer: the items of its own type that were edited in this session, most recent first
    const btn = this.toolMenu('back', `History: ${this.type}s edited in this session`, () => {
      const rows = [];
      if (this.opts.canBack?.()) rows.push(['back', `Back to ${this.opts.backTarget?.() || 'the previous page'}`, () => this.opts.onBack?.(), 'Alt+←']);
      for (const k of sessionEdited(this.type)) {
        const id = Number(k.split(':')[1]), name = findDesign(this.type, id)?.name || editedName(this.type, id);
        if (!name) continue;
        const here = this.doc && id === Number(this.doc.id);
        rows.push([TAB_GLYPH[this.type] || 'dot', `${name}${here ? '  ·  open now' : ''}`, () => { if (!here) this.opts.openDesign?.(this.type, id); }, here ? 'This is the item that is open' : `Open ${this.type} "${name}"`]);
      }
      return rows;
    });
    btn.classList.add('history-tool'); btn.dataset.act = 'back';
    this.backBtn = btn;
    return btn;
  }

  /** Enables/disables Back and says where it goes (the app calls this whenever the page history changes). */
  refreshBack() {
    if (!this.backBtn) return;
    const target = this.opts.backTarget?.();
    this.backBtn.title = target ? `Back to ${target} (Alt+←)` : 'Back to the previous page (Alt+←)';
  }

  /** Lets a text field that is still being edited commit its change before we look at the stored design. */
  async settle() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && this.docbar.parentElement?.contains(a)) a.blur();
    await new Promise(r => setTimeout(r, 80));
  }

  async save() {
    if (!this.doc) return false;
    if (!this.isOwnedByCurrentUser(this.doc)) {
      toast('This item is owned by another user — Save is disabled. Please use "Save as…".', 'error');
      return false;
    }
    await this.settle();
    try {
      if (this.devicePreview) await this.setDevicePreview(null);
      await this.reload();
      const had = designFingerprint(this.doc) !== this.baselineFp;
      this.markBaseline();
      // Save copies into the checked projects only; the locked private-library target applies to Save as…
      // (otherwise every Save would add another private copy)
      const targetPids = [...(state.saveTargetProjectIds || [])].filter(pid => Number(pid) !== Number(this.doc.projectId));
      const includePriv = false;
      let multiRes = null;
      if (targetPids.length > 0 || includePriv) {
        multiRes = await api.saveToTargets({
          type: this.type,
          id: this.doc.id,
          name: this.doc.name,
          projectIds: targetPids,
          visibility: 'project',
          includeUserPrivate: includePriv
        });
      }
      if (this.type === 'icon') resetLibraryIconCache();
      if (!(await revealInLibrary(this.doc))) await reloadLibrary({ silent: false });
      this.renderStage();
      this.emit('saved', this.doc);
      if (this.type === 'screen') emit('screen:saved', this.doc);
      emit('item:saved', { type: this.type, doc: this.doc });
      if (multiRes?.savedCount) {
        toast(`Saved "${this.doc.name}" + ${multiRes.savedCount} target copy(s) (+${multiRes.subItemsCount || 0} sub-items)`, 'ok', 2800);
      } else {
        toast(had ? `Saved "${this.doc.name}"` : `"${this.doc.name}" has no unsaved changes`, had ? 'ok' : 'info', 2200);
      }
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  async reset({ confirm = true } = {}) {
    if (!this.doc || !this.baseline) return false;
    if (this.devicePreview) await this.setDevicePreview(null);
    if (!this.dirty) { toast('Nothing to reset: no changes since the last save'); return false; }
    if (confirm && !(await confirmBox(`Throw away every change to "${this.doc.name}" since the last save?`, { okLabel: 'Reset' }))) return false;
    await this.settle();
    try {
      this.vtx.exit(); this.pen.cancel?.();
      await api.restoreDesign(this.type, this.doc.id, restoreBody(this.baseline));
      this.undoStack = []; this.redoStack = [];
      this.menu.menuState = this.menuLive ? { open: false, path: [] } : { open: true, path: [] };
      await this.reload(false);
      this.changed();
      toast('Back to the last saved version', 'ok', 2200);
      return true;
    } catch (e) { toast(e.message, 'error'); await this.reload(); return false; }
  }

  /** The copy gets the current state (unsaved edits included); the original goes back to its last saved version. */
  async saveAs() {
    if (!this.doc) return false;
    if (this.devicePreview) await this.setDevicePreview(null);
    const name = await promptBox('Save as', { value: `${this.doc.name} copy`, label: `Name of the new ${TYPES[this.type].label.toLowerCase()}`, okLabel: 'Save as' });
    if (!name?.trim()) return false;
    await this.settle();
    try {
      // The copy always goes to the All Projects library (locked target) plus any checked projects, cascading every sub-item
      const targetPids = [...(state.saveTargetProjectIds || [])];
      const includePriv = Boolean(state.saveToUserPrivateLibrary);
      const reverted = this.dirty;
      let copy;
      if (targetPids.length > 0 || includePriv) {
        const res = await api.saveToTargets({
          type: this.type,
          id: this.doc.id,
          name: name.trim(),
          projectIds: targetPids,
          visibility: targetPids.length ? 'project' : 'private',
          includeUserPrivate: includePriv,
          restoreBaseline: reverted ? restoreBody(this.baseline) : null
        });
        copy = res.primaryCopy || res.copied?.[0]?.item;
        toast(`Saved "${name.trim()}" to ${res.savedCount} target(s) (+${res.subItemsCount || 0} sub-items)`, 'ok', 4200);
      } else {
        copy = await api.cloneDesign(this.type, this.doc.id, {
          name: name.trim(),
          projectId: state.activeProjectId || this.doc.projectId || 1
        });
        if (reverted) await api.restoreDesign(this.type, this.doc.id, restoreBody(this.baseline));
        toast(`Saved as "${copy.name}"${reverted ? `; "${this.doc.name}" is back to its last saved version` : ''}`, 'ok', 4200);
      }
      this.undoStack = []; this.redoStack = []; this.vtx.exit();
      await this.reload(false);
      this.changed();
      if (!(await revealInLibrary(copy))) await reloadLibrary({ silent: true });
      if (!this.opts.modal && copy?.id) this.opts.openDesign?.(this.type, copy.id);
      return copy;
    } catch (e) { toast(e.message, 'error'); await this.reload(); return false; }
  }

  async closeDoc() {
    if (!(await this.confirmLeave())) return false;
    // closing takes the item off the canvas and out of this designer's history list (a dialog / test designer keeps it)
    if (this.doc && !this.opts.modal) forgetSessionEdited(this.type, this.doc.id);
    if (this.opts.onClose) {
      this.opts.onClose();
      return true;
    }
    this.doc = null;
    this.baseline = null;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.selected.clear();
    clear(this.stage);
    this.renderOverlay();
    this.buildDocBar();
    this.buildBar();
    this.emit('doc:closed');
    emit('topbar:refresh');
    return true;
  }

  /** Called before the design is replaced or its dialog closes. Resolves true when it is fine to go on. */
  async confirmLeave() {
    if (!this.doc || !this.dirty) return true;
    const c = await choiceBox('Unsaved changes', `"${this.doc.name}" has changes that were not saved. Save them, or go back to the last saved version?`,
      [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard changes', value: 'discard', kind: 'danger' }, { label: 'Save', value: 'save', kind: 'primary' }]);
    if (c === 'save') return this.save();
    if (c === 'discard') return this.reset({ confirm: false });
    return false;
  }

  get gridSize() { return TYPES[this.type]?.grid ?? 1; }
  get nodes() { return this.doc?.nodes || []; }
  get els() { return this.nodes; }
  byId(id) { return this.nodes.find(e => e.id === id); }
  get isGlyph() { return GLYPH.has(this.type); }
  get boxResizable() { return !TYPES[this.type]?.fixedSize && this.type !== 'screen'; }

  /** The item name in the bar: editable by whoever may edit the item (Enter / blur saves, Escape reverts). */
  titleField() {
    const name = this.doc.name;
    if (!this.isOwnedByCurrentUser(this.doc)) {
      return h('b', { style: { padding: '0 8px', maxWidth: '20ch', minWidth: '12ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: `${this.doc.key} (read-only: not your item)` }, name);
    }
    const input = h('input', { class: 'doc-title', type: 'text', value: name, title: `Click to rename · variable name: ${this.doc.key}`, 'aria-label': 'Item name', maxlength: '80', spellcheck: 'false' });
    const fit = () => { input.style.width = '20ch'; };
    const commit = async () => {
      const v = input.value.trim();
      if (!v || v === this.doc.name) { input.value = this.doc.name; fit(); return; }
      await this.updateDoc({ name: v });
    };
    input.addEventListener('input', fit);
    input.addEventListener('keydown', e => {
      e.stopPropagation();                               // typing must not trigger tool shortcuts
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = this.doc.name; fit(); input.blur(); }
    });
    input.addEventListener('blur', commit);
    fit();
    return input;
  }

  /* ================= toolbar ================= */
  /** Collapses / expands the two tool rows (path tools and drawing tools) to save screen space; remembered in the browser. */
  toolsCollapsedGet() { try { return localStorage.getItem('ud_tools_collapsed') === '1'; } catch { return false; } }
  applyToolsCollapsed(v) {
    document.body.classList.toggle('dz-tools-collapsed', !!v);
    try { localStorage.setItem('ud_tools_collapsed', v ? '1' : '0'); } catch { /* storage blocked */ }
    this.fitted = false;
  }

  /** The path-tools row and the drawing-tools row hide separately (body classes dz-hide-pathbar / dz-hide-drawbar); remembered in the browser. */
  toolRowHidden(key) { if (key === 'draw') return false; try { return localStorage.getItem(`ud_hide_${key}bar`) === '1'; } catch { return false; } }   // the drawing-tools row has no toggle any more: always shown
  setToolRowHidden(key, v) {
    document.body.classList.toggle(`dz-hide-${key}bar`, !!v);
    try { localStorage.setItem(`ud_hide_${key}bar`, v ? '1' : '0'); } catch { /* storage blocked */ }
    this.fitted = false;
  }

  buildBar() {
    for (const k of ['path', 'draw']) document.body.classList.toggle(`dz-hide-${k}bar`, this.toolRowHidden(k));
    clear(this.bar);
    this.buildDocBar();
    const s = state.settings;
    const tools = TOOLS.filter(t => !(this.isGlyph && ['text', 'container', 'carousel'].includes(t[0])));
    const GROUPS = [['Select and containers', ['select', 'node', 'container', 'carousel']], ['Shapes', ['rect', 'circle', 'ellipse', 'polygon', 'star', 'arrow', 'callout']], ['Draw, text and crop', ['freehand', 'line', 'pen', 'text', 'crop', 'path']]];
    this.toolGroupBtns = [];
    const toolGroups = GROUPS.map(([label, keys]) => {
      const items = tools.filter(t => keys.includes(t[0]));
      if (!items.length) return null;
      const entries = items.map(([k, key, glyph, tip]) => [`@${glyph}`, `${tip.split(':')[0]} (${key})`, () => (k === 'node' ? this.vtx.enter(this.selectedNodes()[0]) : this.setTool(k)), tip]);
      const btn = this.toolMenu(`@${items[0][2]}`, label, entries);
      btn.dataset.group = items.map(t => t[0]).join(',');
      btn.dataset.glyphs = JSON.stringify(Object.fromEntries(items.map(t => [t[0], t[2]])));
      this.toolGroupBtns.push(btn);
      return btn;
    }).filter(Boolean);
    const tool = ([k, key, glyph, tip]) => h('button', { class: `icon-btn${this.tool === k ? ' active' : ''}`, title: `${tip} (${key})`, dataset: { tool: k }, onclick: () => (k === 'node' ? this.vtx.enter(this.selectedNodes()[0]) : this.setTool(k)) }, glyph);
    const toggle = (icon, tip, get, set, desc = '') => { const b = ibtn(icon, tip, () => { set(!get()); b.classList.toggle('active', get()); }, { desc, active: get() }); b.dataset.view = '1'; return b; };
    this.zoomLabel = h('span', { class: 'muted', style: { minWidth: '46px', textAlign: 'center' } }, '100%');
    const kids = [
      this.typeSwitch(),
      this.titleField(),
      h('span', { class: 'sep-v' }), ...toolGroups, h('span', { class: 'sep-v' }),
      this.toolMenu('undo', 'Edit: undo, redo, duplicate, delete, order', [
        ['undo', 'Undo (Ctrl+Z)', () => this.undo()], ['redo', 'Redo (Ctrl+Y)', () => this.redo()],
        ['copy', 'Duplicate (Ctrl+D)', () => this.duplicateSelected()], ['trash', 'Delete (Del)', () => this.deleteSelected()],
        ['bringFront', 'Bring to front', () => this.reorder('front')], ['sendBack', 'Send to back', () => this.reorder('back')]]),
      h('span', { class: 'sep-v' }),
      this.toolMenu('zoomIn', 'Zoom: in, out, fit, actual size', [
        ['zoomIn', 'Zoom in (+)', () => this.zoomBy(1.25)], ['zoomOut', 'Zoom out (-)', () => this.zoomBy(1 / 1.25)],
        ['fit', 'Fit to window (0)', () => this.fit()], ['actual', 'Actual size (100%)', () => this.setZoom(1)]]), this.zoomLabel,
      h('span', { class: 'sep-v' }),
      toggle('grid2', 'Show grid', () => s.showGrid, v => { updateSettings({ showGrid: v }); this.renderOverlay(); }),
      toggle('magnet', 'Snap to grid', () => s.snapToGrid, v => updateSettings({ snapToGrid: v })),
      toggle('anchor', 'Snap to 9 points', () => s.snapToAnchors, v => { updateSettings({ snapToAnchors: v }); this.renderOverlay(); }, 'Snap to the 9 reference points (corners, edges, centre)'),
      toggle('play', 'Animate', () => state.playAnimations, v => { state.playAnimations = v; this.renderStage(); }, 'Play animations on the canvas')
    ];
    if (this.boxResizable) kids.push(toggle('scale', 'Scale contents', () => this.scaleContent, v => { this.scaleContent = v; }, 'Resizing the bounding box scales everything inside it'));
    if (this.type === 'button') kids.push(toggle('tools', 'Test menu', () => this.menuLive, v => {
      this.menuLive = v; this.stage.classList.toggle('menu-live', v || this.actionsLive);
      this.menu.menuState = v ? { open: false, path: [] } : { open: true, path: [] }; this.renderStage();
    }, 'Click the button and its items like in the finished app (off = edit mode, the menu stays open)'));
    if (['button', 'element', 'screen'].includes(this.type) && !this.opts.testRunner) {
      // the test runner: a modal that runs this design live (menus, popups, actions; routes are announced, not followed)
      kids.push(ibtn('testMode', 'Test', () => (this.opts.openTest ? this.opts.openTest(this.type, this.doc.id) : this.setTestActions(!this.actionsLive)), {
        desc: 'Run this design in a test window: menus with their effects, popups and actions work; routes say where they would go. Edit items in a new tab while it runs.',
        active: this.actionsLive, dataset: { act: 'test-actions', view: '1' }
      }));
    }
    kids.push(h('span', { class: 'grow' }),
      ibtn('inspector', 'Inspector', () => { this.inspectorOpen = !this.inspectorOpen; this.inspectorEl.classList.toggle('collapsed', !this.inspectorOpen); this.fitted = false; }, { desc: 'Show / hide the inspector panel', active: this.inspectorOpen, dataset: { view: '1' } }),
      ibtn('close', 'Close item', () => this.closeDoc(), { desc: 'Close this item: it leaves the canvas and this designer\'s history list', dataset: { view: '1', act: 'close-designer' } }));
    this.viewControls = kids.filter(k => k.dataset?.view === '1');
    this.toolToggles = kids.filter(k => k.dataset?.tools === '1');
    // the tools live in the top (page) toolbar: main.js moves them there; the emptied second bar is hidden
    const rest = kids.filter(k => k.dataset?.view !== '1' && k.dataset?.tools !== '1');
    this.barHead = rest.slice(0, 2);     // design type label + editable name: first in the toolbar
    this.barTools = rest.slice(2);
    clear(this.bar);
    this.buildPathBar();
    this.setTool(this.tool);
    emit('topbar:refresh');
  }

  setTool(t) {
    if (this.tool === 'pen' && t !== 'pen') this.pen.cancel();
    if (t === 'pen' || t === 'crop') this.vtx.exit();
    this.tool = t;
    this.bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    for (const b of this.toolGroupBtns || []) {
      const on = b.dataset.group.split(',').includes(t);
      b.classList.toggle('active', on);
      if (on) { const g = JSON.parse(b.dataset.glyphs)[t]; const sp = b.querySelector('.tm-glyph'); if (sp && g) sp.textContent = g; }
    }
    this.viewport.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }

  /* ================= rendering ================= */
  renderAll() { this.renderStage(); this.renderOverlay(); this.applyView(); this.emit('selection', this.selectedNodes()); }

  animationsForRender() {
    if (this.dragging) return [];
    const own = new Set(this.nodes.map(e => e.id));
    return state.library.animations.filter(a => !own.has(a.nodeId)).concat(this.doc.animations || []);
  }

  /** Menu rows of the open button with the target screen keys the renderer expects. */
  menuRows() { return (this.doc.menuItems || []).map(m => ({ ...m, targetKey: findDesign('screen', m.targetScreenId)?.key || '' })); }

  renderStage() {
    if (!this.doc) return;
    // repeaters simulate their item count on the canvas; with "Animate" off they hold their first frame
    const d = this.doc, ctx = renderContext({ editor: true, animations: this.animationsForRender(), repeaterMode: state.playAnimations ? 'animate' : 'static' });
    const theme = currentTheme();
    let svg;
    if (this.isGlyph) svg = renderIconDocument({ icon: d, nodes: d.nodes, ctx, size: 24 });
    else if (this.type === 'button') {
      // the live button: its own nodes plus its menu, exactly as it appears when placed on a screen
      const rows = this.menuRows();
      ctx.lib.button.set(d.id, { key: d.key, width: d.width, height: d.height, nodes: d.nodes, menu: rows.length ? { cfg: menuConfig(d.meta), items: rows } : null });
      const inst = [{ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId: d.id, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: d.width, height: d.height } }];
      svg = renderDocument({ owner: d, nodes: inst, ctx, background: false });
    } else svg = renderDocument({ owner: d, nodes: d.nodes, ctx, background: false });
    this.stage.innerHTML = svg;      // markup comes from the domain renderer: tags/attributes are whitelisted and escaped
    this.stage.style.width = `${d.width}px`; this.stage.style.height = `${d.height}px`;
    this.stage.style.background = 'transparent';
    this.viewport.style.background = this.type === 'screen' ? '#03050a' : String(theme.tokens.bg);
    const dev = DEVICES[d.meta?.device];
    const radius = this.type !== 'screen' ? 0 : (dev && d.meta.device === 'web') ? 8 : 44;
    Object.assign(this.frame.style, { left: '-14px', top: '-14px', width: `${d.width + 28}px`, height: `${d.height + 28}px`, borderRadius: `${radius + 14}px`,
      background: '#000', display: this.type === 'screen' ? 'block' : 'none' });
    this.stage.style.borderRadius = `${radius}px`; this.stage.style.overflow = this.type === 'button' ? 'visible' : 'hidden';
    this.renderInPlaceBackdrop();
    this.stage.classList.toggle('menu-live', !!(this.menuLive || this.actionsLive));
    this.menu.afterRender();
    this.renderLiveTestLayer?.();
  }

  /** In-place editing of a stretched element: the canvas is stretched vertically by the element's placement aspect (1 otherwise). */
  ay() { const ip = this.inPlace; return ip && this.type === 'element' && ip.sx > 0 && ip.sy > 0 ? ip.sy / ip.sx : 1; }
  worldPoint(ev) {
    const r = this.viewport.getBoundingClientRect();
    return { x: (ev.clientX - r.left - this.view.tx) / this.view.z, y: (ev.clientY - r.top - this.view.ty) / (this.view.z * this.ay()) };
  }

  selectedNodes() { return this.nodes.filter(e => this.selected.has(e.id)); }

  selectionBox(sel = this.selectedNodes()) {
    if (!sel.length) return null;
    const bs = sel.map(e => nodeBBox(e, this.nodes));
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
    const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  renderOverlay() {
    if (!this.doc) return;
    const { z } = this.view, W = this.doc.width, H = this.doc.height;
    const ns = 'http://www.w3.org/2000/svg';
    const o = this.overlay; clear(o);
    o.setAttribute('width', W); o.setAttribute('height', H); o.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const mk = (tag, attrs, parent = o) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.appendChild(n); return n; };
    const g = this.gridSize;
    if (state.settings.showGrid && g * z >= 4) {
      const defs = mk('defs', {});
      const p = mk('pattern', { id: 'dzgrid', width: g, height: g, patternUnits: 'userSpaceOnUse' }, defs);
      mk('path', { d: `M ${g} 0 H 0 V ${g}`, fill: 'none', stroke: 'rgba(140,190,255,.16)', 'stroke-width': 1 / z }, p);
      mk('rect', { width: W, height: H, fill: 'url(#dzgrid)' });
    }
    // the bounding box: every element/button/path starts as a box, everything inside is placed within it
    if (this.type !== 'screen') mk('rect', { width: W, height: H, fill: 'none', stroke: 'rgba(140,190,255,.45)', 'stroke-width': 1 / z, 'stroke-dasharray': `${6 / z} ${4 / z}` });
    if (state.settings.snapToAnchors && !this.isGlyph) for (const pt of Object.values(anchorPoints(W, H))) mk('circle', { cx: pt.x, cy: pt.y, r: 4 / z, class: 'anchor' });
    for (const gd of this.guides) mk('line', { x1: gd.x1, y1: gd.y1, x2: gd.x2, y2: gd.y2, class: 'guide' });
    // selection & hovered boundary lines
    const sel = this.selectedNodes();
    const hovNode = this.hoveredNodeId && !this.selected.has(this.hoveredNodeId) ? this.byId(this.hoveredNodeId) : null;
    if (hovNode && hovNode.role !== 'bg' && hovNode.role !== 'bg-glow') {
      const hb = nodeBBox(hovNode, this.nodes);
      const hr = mk('rect', {
        x: hb.x,
        y: hb.y,
        width: Math.max(hb.w, 0.01),
        height: Math.max(hb.h, 0.01),
        class: 'selbox hover-boundary',
        style: 'cursor: move; pointer-events: stroke;'
      });
      if (hovNode.rotation) hr.setAttribute('transform', `rotate(${hovNode.rotation} ${hb.x + hb.w / 2} ${hb.y + hb.h / 2})`);
    }
    for (const e of sel) {
      const b = nodeBBox(e, this.nodes);
      const r = mk('rect', {
        x: b.x,
        y: b.y,
        width: Math.max(b.w, 0.01),
        height: Math.max(b.h, 0.01),
        class: 'selbox el-boundary',
        style: 'cursor: move; pointer-events: stroke;'
      });
      if (e.rotation) r.setAttribute('transform', `rotate(${e.rotation} ${b.x + b.w / 2} ${b.y + b.h / 2})`);
      if (isContainerNode(e, state.library.elements)) {
        const ib = containerInnerBox(e, this.nodes, state.library.elements);
        mk('rect', {
          x: ib.x,
          y: ib.y,
          width: Math.max(ib.w, 0.01),
          height: Math.max(ib.h, 0.01),
          fill: 'none',
          stroke: 'rgba(16,185,129,.7)',
          'stroke-width': 1.2 / z,
          'stroke-dasharray': `${5 / z} ${3 / z}`,
          style: 'pointer-events: none;'
        });
      }
    }
    const box = this.selectionBox(sel);
    if (box && sel.length === 1 && !sel[0].rotation && !sel[0].locked && !this.vtx.active) {
      const s = 8 / z, pts = [['nw', box.x, box.y], ['n', box.x + box.w / 2, box.y], ['ne', box.x + box.w, box.y], ['e', box.x + box.w, box.y + box.h / 2],
        ['se', box.x + box.w, box.y + box.h], ['s', box.x + box.w / 2, box.y + box.h], ['sw', box.x, box.y + box.h], ['w', box.x, box.y + box.h / 2]];
      for (const [k, x, y] of pts) mk('rect', { x: x - s / 2, y: y - s / 2 / this.ay(), width: s, height: s / this.ay(), class: 'handle', 'data-h': k }).style.cursor = `${k}-resize`;
    } else if (!sel.length && this.boxResizable) {
      // no selection: the handles resize the bounding box and scale the contents with it
      const s = 9 / z;
      for (const [k, x, y, cur] of [['e', W, H / 2, 'e-resize'], ['s', W / 2, H, 's-resize'], ['se', W, H, 'se-resize']])
        mk('rect', { x: x - s / 2, y: y - s / 2, width: s, height: s, class: 'handle box-handle', 'data-b': k }).style.cursor = cur;
    }
    this.vtx.renderOverlay(mk);
    this.pen.renderOverlay(mk);
    if (this.ghost) this.drawGhost(mk);
    if (this.marquee) { const m = this.marquee; mk('rect', { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0), fill: 'rgba(46,155,255,.12)', stroke: '#2e9bff', 'stroke-width': 1 / z }); }
    this.world.style.setProperty('--z', z);
    this.updateHoverToolbar();
  }

  setInspectorWidth(w) {
    this.inspectorEl.style.width = `${Math.min(720, Math.max(190, Math.round(w)))}px`;
  }

  /** First load: size the inspector to the width its content needs (clamped), then the user can drag it. */
  fitInspectorToContent() {
    if (this.inspectorFitted || !this.inspectorOpen) return;
    this.inspectorFitted = true;
    const el = this.inspectorEl;
    el.style.width = 'max-content';
    const natural = el.getBoundingClientRect().width;
    el.style.width = '';
    this.setInspectorWidth(Math.min(natural + 16, 270));
    this.fitted = false;
  }

  /** Quick-toolbar target: the clicked element while it is the single selection (hovering never opens it). */
  toolbarTarget() {
    const id = this.toolbarNodeId;
    if (id == null || this.selected.size !== 1 || !this.selected.has(id)) return null;
    return this.byId(id) || null;
  }

  /** A plain click (no drag) on an element toggles its quick toolbar; a click on another element moves it there. */
  toggleToolbarFor(id, { shift = false, wasOpen = false } = {}) {
    this.toolbarNodeId = shift || wasOpen ? null : id;
    this.updateHoverToolbar();
  }

  /** Renders the floating quick toolbar above the clicked element on the canvas. */
  updateHoverToolbar() {
    if (!this.hoverBar || !this.doc || this.dragging || this.vtx?.active || this.actionsLive || this.devicePreview) {
      if (this.hoverBar) this.hoverBar.hidden = true;
      return;
    }
    const target = this.toolbarTarget();
    if (!target || target.role === 'bg' || target.role === 'bg-glow') {
      this.hoverBar.hidden = true;
      return;
    }
    const b = nodeBBox(target, this.nodes);
    const sx = this.view.tx + (b.x + b.w / 2) * this.view.z;
    // sit above the bounding box with a 20px gap so the top-edge vertices stay clickable
    const barH = this.hoverBar.offsetHeight || 34;
    const sy = Math.max(4, this.view.ty + b.y * this.view.z * this.ay() - barH - 20);
    this.hoverBar.style.left = `${Math.round(sx)}px`;
    this.hoverBar.style.top = `${Math.round(sy)}px`;

    if (this.hoverBar.dataset.nodeId !== `${target.id}-${target.locked}-${(target.events || []).length}`) {
      this.hoverBar.dataset.nodeId = `${target.id}-${target.locked}-${(target.events || []).length}`;
      clear(this.hoverBar);
      const evCount = (target.events?.length || (target.onClick ? 1 : 0));
      const isMenuButton = (target.kind === 'instance' && target.refType === 'button' && target.refId) || this.type === 'button';
      const menuBtnId = (target.kind === 'instance' && target.refType === 'button') ? target.refId : (this.type === 'button' ? this.doc.id : null);
      const menuBtnItems = menuBtnId
        ? (this.type === 'button' && this.doc.id === menuBtnId ? (this.doc.menuItems || []) : (findDesign('button', menuBtnId)?.menuItems || []))
        : [];
      const isMenuItemRole = target.role === 'menu-item' || /menu/i.test(target.name || '') || isMenuButton;

      this.hoverBar.append(...[
        h('span', { class: 'hb-title', title: `${target.name || target.tag} (#${target.id})` }, target.name || target.tag),
        ibtn('pencil', 'Open Editor (Double-click)', e => { e.stopPropagation(); this.select([target.id]); this.openEditor(target); }, { cls: 'hb-btn' }),
        this.type === 'screen' || this.type === 'element' ? (() => {
          const ct = clickTargetOf(target), on = ct.screenId != null || ct.elementId != null;
          const what = ct.screenId != null ? `go to “${findDesign('screen', ct.screenId)?.label || 'screen ' + ct.screenId}”` : ct.elementId != null ? `show “${findDesign('element', ct.elementId)?.label || 'element ' + ct.elementId}” as popup` : 'nothing set';
          return ibtn('monitor', `When clicked: go to a screen or show a popup (now: ${what})`, e => { e.stopPropagation(); this.select([target.id]); this.pickClickTarget(target); }, { cls: `hb-btn${on ? ' active' : ''}` });
        })() : null,
        this.type === 'button' ? ibtn('search', 'Change the icon of this button', e => { e.stopPropagation(); this.changeButtonIcon(target); }, { cls: 'hb-btn' }) : null,
        isMenuItemRole ? h('button', {
          class: `hb-btn${menuBtnItems.length ? ' active' : ''}`,
          'aria-label': 'Menu items',
          'data-tip': menuBtnItems.length ? `Edit menu item (${menuBtnItems.length} item(s))` : 'Add / Edit menu item',
          title: menuBtnItems.length ? `Edit menu item (${menuBtnItems.length} item(s))` : 'Add / Edit menu item',
          onclick: async e => {
            e.stopPropagation();
            this.select([target.id]);
            if (menuBtnId) {
              await openMenuItemsModal(this, menuBtnId);
            } else {
              openEventsModal({ node: target, docType: this.type, docId: this.doc.id, onSave: patch => this.patchNode(target.id, patch) });
            }
          }
        }, iconEl('sliders', { size: 15 }), menuBtnItems.length ? h('span', { class: 'hb-count' }, String(menuBtnItems.length)) : null) : null,
        ibtn('zap', `Configure Events (click, mouseover, release, drag&drop -> open element, popup, toolbar, route)${evCount ? ` · ${evCount} set` : ''}`, e => {
          e.stopPropagation();
          this.select([target.id]);
          openEventsModal({ node: target, docType: this.type, docId: this.doc.id, onSave: patch => this.patchNode(target.id, patch) });
        }, { cls: `hb-btn${evCount ? ' active' : ''}` }),
        ibtn('layers', (target.events || []).some(x => x.trigger === 'click' && x.type === 'toolbar') ? 'Remove the attached Small Element Floating Toolbar (click event)' : 'Attach Small Element Floating Toolbar (opens on click)', async e => {
            e.stopPropagation();
            this.select([target.id]);
            // a second click detaches it again: the toolbar is a real click event, not only a preview
            if ((target.events || []).some(x => x.trigger === 'click' && x.type === 'toolbar')) {
              await this.patchNode(target.id, { events: (target.events || []).filter(x => !(x.trigger === 'click' && x.type === 'toolbar')) });
              this.tbPv?.remove(); this.tbPv = null;
              return toast('Floating toolbar removed from this item', 'ok', 1800);
            }
            const tbEl = state.library.elements.find(x => x.key === 'html-floating-toolbar');
            const evs = [...(target.events || []).filter(x => !(x.trigger === 'click' && x.type === 'toolbar')), { trigger: 'click', type: 'toolbar', ...(tbEl ? { targetId: tbEl.id } : {}), position: 'top' }];
            await this.patchNode(target.id, { events: evs });
            this.showToolbarPreview(target, { type: 'toolbar', targetId: tbEl?.id, position: 'top' });
          }, { cls: 'hb-btn' }),
        ibtn('play', 'Add Pulse / Flip Animation', async e => {
          e.stopPropagation();
          this.select([target.id]);
          await this.addAnimation(target.id, 'pulse');
          toast('Added animation to element', 'ok', 1400);
        }, { cls: 'hb-btn' }),
        ibtn(target.locked ? 'lock' : 'unlock', target.locked ? 'Unlock element position (Ctrl+L)' : 'Lock element position on screen (Ctrl+L)', async e => {
          e.stopPropagation();
          await this.patchNode(target.id, { locked: !target.locked });
          this.hoverBar.dataset.nodeId = '';
          this.updateHoverToolbar();
          toast(target.locked ? '🔒 Position locked' : '🔓 Position unlocked', 'ok', 1200);
        }, { cls: 'hb-btn', active: !!target.locked }),
        ibtn('import', 'Copy item (and sub-items) to project(s)', e => {
            e.stopPropagation();
            const refItem = (target.kind === 'instance' && target.refType && target.refId)
              ? (findDesign(target.refType, target.refId) || { id: target.refId, name: target.name })
              : this.doc;
            const itemRef = (target.kind === 'instance' && target.refType && target.refId)
              ? { type: target.refType, id: target.refId, name: target.name, builtin: refItem?.builtin, creatorId: refItem?.creatorId }
              : { type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key, builtin: this.doc.builtin, creatorId: this.doc.creatorId };
            openCopyMoveToProjectsModal({ items: [itemRef], mode: 'copy' });
        }, { cls: 'hb-btn' }),
        (() => {
          const refItem = (target.kind === 'instance' && target.refType && target.refId)
            ? (findDesign(target.refType, target.refId) || { id: target.refId, name: target.name, creatorId: this.doc.creatorId })
            : this.doc;
          const canMoveRef = this.canMoveRecord(refItem);
          return ibtn('export', canMoveRef
              ? 'Move item (and sub-items) to your project(s)'
              : 'Default basic items and items owned by other users cannot be moved (only copied)', e => {
            e.stopPropagation();
            if (!canMoveRef) return;
            const itemRef = (target.kind === 'instance' && target.refType && target.refId)
              ? { type: target.refType, id: target.refId, name: target.name, builtin: refItem?.builtin, creatorId: refItem?.creatorId }
              : { type: this.type, id: this.doc.id, name: this.doc.name, key: this.doc.key, builtin: this.doc.builtin, creatorId: this.doc.creatorId };
            openCopyMoveToProjectsModal({ items: [itemRef], mode: 'move' });
          }, { cls: 'hb-btn', disabled: !canMoveRef });
        })(),
        // labelled: the export / download glyphs are already used by "copy / move to project" on this toolbar
        ['screen', 'element'].includes(this.type) ? h('button', { type: 'button', class: 'hb-btn hb-extract', 'data-act': 'extract-element', title: 'Extract as element: save this shape (with what is drawn inside it) as a new element in the library', 'aria-label': 'Extract as element',
          onclick: async e => { e.stopPropagation(); await this.extractAsElement(target); } }, iconEl('template', { size: 15 }), h('span', { style: { fontSize: '11px', fontWeight: 700, marginLeft: '3px' } }, 'Extract')) : null,
        ibtn('copy', 'Duplicate element (Ctrl+D)', async e => { e.stopPropagation(); this.select([target.id]); await this.duplicateSelected(); }, { cls: 'hb-btn' }),
        ibtn('trash', 'Delete element (Del)', async e => { e.stopPropagation(); this.select([target.id]); await this.deleteSelected(); }, { cls: 'hb-btn danger' })
      ].filter(Boolean));   // Element.append() would render a skipped (null) tool as the text "null"
    }
    this.hoverBar.hidden = false;
    // measure after the content is built and shown, then sit 20px above the bounding box
    this.hoverBar.style.left = `${Math.round(sx)}px`;
    this.hoverBar.style.top = `${Math.max(4, Math.round(this.view.ty + b.y * this.view.z * this.ay() - this.hoverBar.offsetHeight - 20))}px`;
  }

  drawGhost(mk) {
    const g = this.ghost, z = this.view.z;
    const st = { fill: 'rgba(46,155,255,.2)', stroke: '#2e9bff', 'stroke-width': 1.5 / z };
    const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), h2 = Math.abs(g.y1 - g.y0);
    if (g.tool === 'rect' || g.tool === 'callout' || g.tool === 'container' || g.tool === 'carousel') mk('rect', { x, y, width: w, height: h2, ...st });
    if (g.tool === 'circle' || g.tool === 'ellipse' || g.tool === 'polygon' || g.tool === 'star') mk('ellipse', { cx: (g.x0 + g.x1) / 2, cy: (g.y0 + g.y1) / 2, rx: w / 2, ry: h2 / 2, ...st });
    if (g.tool === 'line' || g.tool === 'arrow') mk('line', { x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, stroke: '#2e9bff', 'stroke-width': 2 / z });
    if (g.tool === 'freehand' && g.pts?.length > 1) {
      const d = g.pts.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${Math.round(pt.x * 10) / 10} ${Math.round(pt.y * 10) / 10}`).join(' ');
      mk('path', { d, fill: 'none', stroke: '#2e9bff', 'stroke-width': 2 / z });
    }
    if (g.tool === 'crop') mk('rect', { x, y, width: w, height: h2, fill: 'rgba(255,213,74,.12)', stroke: '#ffd54a', 'stroke-width': 1.5 / z, 'stroke-dasharray': `${6 / z} ${4 / z}` });
  }

  /* ================= view ================= */
  applyView() {
    const { tx, ty, z } = this.view;
    this.world.style.transform = `translate(${tx}px, ${ty}px) scale(${z}, ${z * this.ay()})`;
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }
  /** Area to bring into view: the box, plus the menu ring of a button. */
  focusRect() {
    const d = this.doc;
    if (this.type === 'button' && d.menuItems?.length) { const e = menuExtent(d, menuConfig(d.meta), buildMenuTree(d.menuItems)); return { x: e.x, y: e.y, w: e.w, h: e.h }; }
    return { x: 0, y: 0, w: d.width, h: d.height };
  }
  fit() {
    if (!this.doc) return;
    const r = this.viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const f = this.focusRect(), pad = this.isGlyph ? 40 : 56, ay = this.ay();
    const z = Math.min((r.width - pad * 2) / f.w, (r.height - pad * 2) / (f.h * ay), 40);
    this.view = { z: Math.max(MIN_Z, z), tx: (r.width - f.w * z) / 2 - f.x * z, ty: (r.height - f.h * z * ay) / 2 - f.y * z * ay };
    this.applyView(); this.renderOverlay();
  }
  setZoom(z, cx, cy) {
    const r = this.viewport.getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    z = Math.min(MAX_Z, Math.max(MIN_Z, z));
    const k = z / this.view.z;
    this.view = { z, tx: cx - (cx - this.view.tx) * k, ty: cy - (cy - this.view.ty) * k };
    this.applyView(); this.renderOverlay();
  }
  zoomBy(f, cx, cy) { this.setZoom(this.view.z * f, cx, cy); }

  /* ================= selection ================= */
  select(ids, { add = false } = {}) {
    if (!add) this.selected = new Set();
    for (const id of ids) this.selected.add(id);
    // the quick toolbar belongs to its clicked element only while it stays the single selection; only a canvas click reopens it
    if (this.toolbarNodeId != null && !(this.selected.size === 1 && this.selected.has(this.toolbarNodeId))) this.toolbarNodeId = null;
    if (this.vtx.active && !(ids.length === 1 && ids[0] === this.vtx.node?.id)) this.vtx.exit();
    this.renderOverlay();
    this.emit('selection', this.selectedNodes());
  }
  clearSelection() { this.select([]); }

  /** Maps an event target to the node the user means: the top-level ancestor (or the exact node with Alt). Sub-elements inside a Container are directly selectable. */
  hitNode(target, exact = false) {
    let n = target;
    while (n && n !== this.stage) {
      const id = n.dataset?.el ? Number(n.dataset.el) : null;
      if (id && this.byId(id)) {
        let e = this.byId(id);
        if (!exact) {
          while (e.parentId != null && e.parentId !== this.enteredGroupId && this.byId(e.parentId) && !isContainerNode(this.byId(e.parentId), state.library.elements)) {
            e = this.byId(e.parentId);
          }
        }
        return e;
      }
      n = n.parentNode;
    }
    return null;
  }

  /** One-step click action of a placed item: pick a screen to go to or an element to show as a popup (or none). */
  async pickClickTarget(node) {
    if (!node) return;
    const cur = clickTargetOf(node), projectId = this.doc?.projectId ?? state.project?.id ?? null;
    const r = await pickTarget({ currentScreenId: cur.screenId, currentElementId: cur.elementId, projectId, allowCreate: false });
    if (!r) return;
    const p = await targetPatch(r, projectId);
    if (!p) return;
    if (p.action === 'scroll-repeater') return toast('Scrolling a container is a menu item action; pick a screen or a popup here', 'error');
    await this.patchNode(node.id, { events: withClickTarget(node.events, { screenId: p.targetScreenId, elementId: p.targetElementId }), onClick: null });
    toast(p.targetScreenId ? `Click goes to “${p.target?.name || 'screen'}”` : p.targetElementId ? `Click shows “${p.target?.name || 'element'}” as popup` : 'Click action removed', 'ok', 1800);
  }

  /**
   * Bulk "go to screen": pick a screen once and make it the click target of the selected buttons on this screen (all of
   * its buttons when none is selected). Their other events stay; buttons with another click action are only changed when
   * asked. One undo step.
   */
  async setButtonsGoToScreen() {
    if (this.type !== 'screen' || !this.doc) return;
    const isBtn = n => n.kind === 'instance' && n.refType === 'button';
    const picked = this.selectedNodes().filter(isBtn), all = this.nodes.filter(isBtn);
    if (!all.length) return toast('This screen has no buttons', 'error');
    const screens = await api.list('screen').catch(() => []);
    const choices = screens.filter(s => s.id !== this.doc.id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const scrSel = h('select', { 'data-f': 'bulk-goto-screen', style: { width: '100%' } }, h('option', { value: '' }, '(choose a screen…)'), ...choices.map(s => h('option', { value: String(s.id) }, s.name)));
    const scope = h('select', { 'data-f': 'bulk-goto-scope', style: { width: '100%' } },
      h('option', { value: 'selected', disabled: !picked.length, selected: !!picked.length }, `The selected buttons (${picked.length})`),
      h('option', { value: 'all', selected: !picked.length }, `All buttons on this screen (${all.length})`));
    const replace = h('input', { type: 'checkbox', 'data-f': 'bulk-goto-replace' });
    const busy = { v: false };
    await new Promise(resolve => {
      let m;
      const apply = async () => {
        if (busy.v) return;
        const sid = Number(scrSel.value);
        if (!sid) return toast('Choose a screen', 'error');
        busy.v = true;
        const targets = (scope.value === 'selected' ? picked : all).filter(n => {
          const c = clickTargetOf(n);
          return replace.checked || (!c.elementId && !c.other) || c.screenId != null;
        });
        const snap = this.snapshot();
        let n = 0;
        try {
          for (const node of targets) {
            const saved = await api.patchNode(this.type, this.doc.id, node.id, { events: withClickTarget(node.events, { screenId: sid }), onClick: null });
            Object.assign(node, saved); n++;
          }
        } catch (err) { toast(err.message, 'error'); }
        if (n) { this.pushUndo(snap); this.renderStage(); this.renderOverlay(); this.emit('selection', this.selectedNodes()); this.changed(); }
        const skipped = (scope.value === 'selected' ? picked : all).length - targets.length;
        toast(`${n} button(s) now go to "${choices.find(s => s.id === sid)?.name}"${skipped ? ` · ${skipped} kept their own click action` : ''}`);
        m.close();
      };
      m = modal({ title: 'Go to screen: set on buttons', onClose: resolve,
        content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '360px' } },
          h('label', { class: 'field' }, h('span', {}, 'When clicked, go to'), scrSel),
          h('label', { class: 'field' }, h('span', {}, 'Buttons'), scope),
          h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, replace, h('span', {}, 'Also replace other click actions (popup, menu, animation …)')),
          h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Other events (mouseover, double click …) are kept. Undo reverts all of them at once.'),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
            h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
            h('button', { class: 'btn primary', 'data-f': 'bulk-goto-apply', onclick: apply }, 'Apply')))
      });
    });
  }

  /** Back / cancel / close buttons among `nodes`: { matches, already (go back now), busy (another click action) }. */
  backCancelButtons(nodes) {
    const matches = (nodes || []).filter(n => n.kind === 'instance' && n.refType === 'button').filter(n => {
      const b = findDesign('button', n.refId) || {};
      return isBackOrCancel(n.name, n.label, n.attrs?.label, n.attrs?.text, b.name, b.label, b.key, b.icon, b.iconKey);
    });
    const already = matches.filter(n => clickTargetOf(n).other === 'back');
    const busy = matches.filter(n => { const c = clickTargetOf(n); return c.other !== 'back' && (c.screenId != null || c.elementId != null || !!c.other); });
    return { matches, already, busy };
  }

  /**
   * Bulk "go back": every button whose name, label, key or icon says back, cancel or close gets the click action
   * "Go back" — on this screen / element, or on every screen of the project. Buttons that already go somewhere else are
   * kept unless asked. This screen is one undo step; other screens are saved directly.
   */
  async setBackCancelButtons() {
    if (!this.doc || (this.type !== 'screen' && this.type !== 'element')) return;
    let scope = 'this';
    const projectId = this.doc?.projectId ?? state.project?.id ?? null;
    if (this.type === 'screen') {
      scope = await choiceBox('Back / Cancel buttons', 'Set "Go back" on the back, cancel and close buttons of:', [
        { value: 'this', label: 'This screen' }, { value: 'project', label: 'All screens of the project', kind: 'primary' }]);
      if (!scope) return;
      if (scope === 'project' && !projectId) return toast('This screen belongs to no project', 'error');
    }
    // collect the docs to change: [{ id, nodes, current }]
    const docs = [{ id: this.doc.id, nodes: this.nodes, current: true }];
    if (scope === 'project') {
      const list = await api.list('screen', '', projectId ? { projectId, includePublic: false } : {}).catch(() => []);
      for (const sc of list) {
        if (sc.id === this.doc.id || (projectId && sc.projectId != null && sc.projectId !== projectId)) continue;
        const full = await api.getDesign('screen', sc.id).catch(() => null);
        if (full?.nodes) docs.push({ id: sc.id, nodes: full.nodes, current: false });
      }
    }
    const found = docs.map(d => ({ ...d, ...this.backCancelButtons(d.nodes) }));
    const total = found.reduce((t, d) => t + d.matches.length, 0);
    if (!total) return toast('No back / cancel / close buttons found', 'error');
    const busyN = found.reduce((t, d) => t + d.busy.length, 0), alreadyN = found.reduce((t, d) => t + d.already.length, 0);
    let replace = false;
    if (busyN) {
      const ch = await choiceBox('Back / Cancel buttons', `${busyN} of the ${total} back / cancel buttons already have another click action.`, [
        { value: 'keep', label: 'Keep those' }, { value: 'replace', label: 'Replace them with Go back', kind: 'primary' }]);
      if (!ch) return;
      replace = ch === 'replace';
    }
    const snap = this.snapshot();
    let n = 0, screens = 0, curChanged = false;
    try {
      for (const d of found) {
        const targets = d.matches.filter(x => !d.already.includes(x) && (replace || !d.busy.includes(x)));
        for (const node of targets) {
          const saved = await api.patchNode(this.type === 'element' && d.current ? 'element' : 'screen', d.id, node.id, { events: withBackAction(node.events), onClick: null });
          if (d.current) { Object.assign(node, saved); curChanged = true; }
          n++;
        }
        if (targets.length) screens++;
      }
    } catch (err) { toast(err.message, 'error'); }
    if (curChanged) { this.pushUndo(snap); this.renderStage(); this.renderOverlay(); this.emit('selection', this.selectedNodes()); this.changed(); }
    if (!n) return toast(`All ${total} back / cancel buttons already go back`, 'ok');
    toast(`${n} back / cancel button(s) on ${screens} ${this.type === 'element' ? 'element' : 'screen(s)'} now go back${alreadyN ? ` · ${alreadyN} already did` : ''}${!replace && busyN ? ` · ${busyN} kept their own action` : ''}`);
  }

  /* ================= in-place element editing =================
   * Double-click a part of a placed element on a screen: the library element loads into this canvas where it sits on the
   * screen, the rest of the screen shows dimmed behind it, and the part under the cursor is selected. Edits are the library
   * element's own (every screen using it updates). Done (or a double-click outside) reloads the screen with it selected. */
  async enterInPlace(inst, chain) {
    const lib = findDesign('element', inst.refId);
    if (!lib || (this.confirmLeave && !(await this.confirmLeave()))) return;
    const screen = this.doc, a = inst.attrs || {};
    const ew = Number(lib.width) || 1, eh = Number(lib.height) || 1;
    this.inPlace = { elementId: Number(inst.refId), elementName: lib.label || lib.key, screenId: screen.id, screenName: screen.name, instId: inst.id,
      screen: { ...screen, nodes: (screen.nodes || []).filter(n => n.id !== inst.id) },
      x: Number(a.x) || 0, y: Number(a.y) || 0, sx: (Number(a.width) || ew) / ew, sy: (Number(a.height) || eh) / eh };
    this._enteringInPlace = true;
    try { await this.load('element', inst.refId); } finally { this._enteringInPlace = false; }
    if (!this.inPlace) return;
    const hit = chain.map(id => this.byId(id)).find(Boolean);
    if (hit) { if (hit.parentId != null) this.enteredGroupId = hit.parentId; this.select([hit.id]); }
  }

  async exitInPlace() {
    const ip = this.inPlace;
    if (!ip || (this.confirmLeave && !(await this.confirmLeave()))) return;
    this.inPlace = null;
    await this.load('screen', ip.screenId);
    if (this.byId(ip.instId)) this.select([ip.instId]);
  }

  syncInPlaceUi() {
    const ip = this.inPlace;
    if (!this.inPlaceBanner) return;
    this.inPlaceBanner.hidden = !ip;
    if (this.frame) this.frame.style.visibility = ip ? 'hidden' : '';
    if (!ip) return;
    clear(this.inPlaceBanner);
    this.inPlaceBanner.append(
      h('span', {}, `Editing "${ip.elementName}" in place on "${ip.screenName}": changes apply to every screen that uses it`),
      h('button', { class: 'btn small primary', onclick: () => this.exitInPlace() }, 'Done'));
  }

  /** The screen around the element being edited in place, in the element's coordinates (placement inverted), dimmed and not clickable. */
  renderInPlaceBackdrop() {
    const ip = this.inPlace, bd = this.inPlaceBackdrop;
    if (!bd) return;
    if (!ip || this.type !== 'element') { bd.hidden = true; bd.innerHTML = ''; return; }
    if (bd.dataset.key !== `${ip.screenId}-${ip.instId}`) {
      const ctx = renderContext({ editor: false, animations: [], repeaterMode: 'static' });
      bd.innerHTML = renderDocument({ owner: ip.screen, nodes: ip.screen.nodes, ctx, background: true });
      bd.dataset.key = `${ip.screenId}-${ip.instId}`;
    }
    Object.assign(bd.style, { position: 'absolute', left: '0', top: '0', width: `${ip.screen.width}px`, height: `${ip.screen.height}px`,
      transformOrigin: '0 0', transform: `scale(${1 / ip.sx}, ${1 / ip.sy}) translate(${-ip.x}px, ${-ip.y}px)`, opacity: '0.4', pointerEvents: 'none' });
    bd.hidden = false;
  }

  /** The sub item of a selected (or entered) group under `target`: hovering outlines it, a click without a drag selects it. */
  groupSubHit(target) {
    const top = this.hitNode(target);
    if (!top || top.tag !== 'g' || !(this.selected.has(top.id) || this.enteredGroupId === top.id)) return null;
    let c = this.hitNode(target, true);
    if (!c || c.id === top.id) return null;
    while (c.parentId != null && c.parentId !== top.id && this.byId(c.parentId)) c = this.byId(c.parentId);
    return c.parentId === top.id ? { group: top, sub: c } : null;
  }

  /** Finds the top-most visible Container node containing world point `p` (or the selected Container if `p` is null). */
  containerAtPoint(p, excludeId = null) {
    if (!this.doc) return null;
    if (p) {
      const containers = [...this.nodes]
        .filter(e => e.id !== excludeId && e.visible !== false && isContainerNode(e, state.library.elements))
        .sort((a, b) => (b.ord - a.ord) || (b.id - a.id));
      for (const c of containers) {
        const b = nodeBBox(c, this.nodes);
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return c;
      }
    }
    const sel = this.selectedNodes();
    if (sel.length === 1 && sel[0].id !== excludeId && isContainerNode(sel[0], state.library.elements)) {
      return sel[0];
    }
    return null;
  }

  /** Detects if world point `p` is hovering over the boundary lines of any visible top-level element (top-most first). */
  hitBoundaryNode(p) {
    if (!this.doc || !p) return null;
    const tol = Math.max(2, 6 / (this.view.z || 1));
    const topDown = [...this.nodes]
      .filter(e => e.parentId == null && e.role !== 'bg' && e.role !== 'bg-glow' && e.visible !== false)
      .sort((a, b) => (b.ord - a.ord) || (b.id - a.id));
    for (const e of topDown) {
      const b = nodeBBox(e, this.nodes);
      const inX = p.x >= b.x - tol && p.x <= b.x + b.w + tol;
      const inY = p.y >= b.y - tol && p.y <= b.y + b.h + tol;
      if (!inX || !inY) continue;
      const nearLeft = Math.abs(p.x - b.x) <= tol;
      const nearRight = Math.abs(p.x - (b.x + b.w)) <= tol;
      const nearTop = Math.abs(p.y - b.y) <= tol;
      const nearBottom = Math.abs(p.y - (b.y + b.h)) <= tol;
      if (nearLeft || nearRight || nearTop || nearBottom) return e;
    }
    return null;
  }

  /* ================= pointer interaction ================= */
  bindViewport() {
    const vp = this.viewport;
    vp.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = vp.getBoundingClientRect();
      this.zoomBy(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
    vp.addEventListener('pointerdown', ev => this.onPointerDown(ev));
    vp.addEventListener('pointermove', ev => this.onPointerMove(ev));
    vp.addEventListener('pointerup', ev => this.onPointerUp(ev));
    vp.addEventListener('pointercancel', ev => this.onPointerUp(ev));
    vp.addEventListener('dragover', ev => { if (ev.dataTransfer.types.includes('application/x-ud')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    vp.addEventListener('drop', ev => {
      const raw = ev.dataTransfer.getData('application/x-ud');
      if (!raw) return;
      ev.preventDefault();
      const { type, id } = JSON.parse(raw);
      if (this.previewLocked()) return;
      this.addInstance(type, id, this.worldPoint(ev));
    });
    vp.addEventListener('keydown', ev => this.onKey(ev));
    vp.addEventListener('keyup', ev => { if (ev.code === 'Space') this.spaceDown = false; });
    vp.addEventListener('dblclick', ev => this.onDblClick(ev));
    vp.addEventListener('contextmenu', ev => this.onContext(ev));
  }

  async onDblClick(ev) {
    if (this.tool === 'pen') { if (this.pen.pts.length) await this.pen.finish(false); return; }
    if (this.vtx.active) { await this.vtx.insertAt(this.worldPoint(ev)); return; }
    // double-click on a group: enter it and select the sub item under the cursor (clicks then pick sub items until you click outside)
    // the first click may have opened an overlay (quick toolbar, selection box) over the point: use the drawing underneath
    let tgt = ev.target;
    if (!this.stage.contains(tgt) && typeof document !== 'undefined' && document.elementsFromPoint) tgt = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => this.stage.contains(x) && x.closest?.('[data-el]')) || tgt;
    const top = this.hitNode(tgt), exact = this.hitNode(tgt, true);
    if (top && exact && top.id !== exact.id && top.tag === 'g') {
      let c = exact; while (c.parentId != null && c.parentId !== top.id && this.byId(c.parentId)) c = this.byId(c.parentId);
      this.enteredGroupId = top.id; this.select([c.id]); return;
    }
    // double-click inside a placed library element: edit its parts in place, on top of the screen (edits save to the library element)
    if (top && top.kind === 'instance' && top.refType === 'element' && this.type === 'screen' && findDesign('element', top.refId)) {
      const chain = [];
      for (let n = tgt; n && n !== this.stage; n = n.parentNode) {
        const id = n.dataset?.el ? Number(n.dataset.el) : null;
        if (id === top.id) break;
        if (id != null) chain.push(id);
      }
      if (chain.length) return this.enterInPlace(top, chain);
    }
    // in-place editing: a double-click outside the element goes back to the screen
    if (this.inPlace && !exact && !top) return this.exitInPlace();
    const e = exact || top;
    if (!e) return;
    this.select([e.id]);
    return this.openEditor(e);
  }

  /**
   * "Open editor" for any element: what it is and what opening it does. Used by double-click, the inspector button and the right-click menu.
   * text → edit the words · placed library design → its own designer · group → select what is inside · shape / path → vertex editor
   */
  editorFor(e) {
    if (!e) return null;
    if (e.tag === 'text') return { label: 'Edit text', hint: 'change the words', run: () => this.editText(e) };
    if (e.kind === 'instance') {
      const lib = findDesign(e.refType, e.refId), what = (TYPES[e.refType]?.label || e.refType).toLowerCase();
      return { label: `Open ${what} designer`, hint: lib ? `${lib.label} (${lib.key}) in its own designer` : 'this design no longer exists', disabled: !lib || !this.opts.openDesign, run: () => this.opts.openDesign(e.refType, e.refId) };
    }
    if (e.tag === 'g') return { label: 'Enter group', hint: 'select the items inside the group', run: () => { const kids = this.nodes.filter(n => n.parentId === e.id); if (kids.length) { this.enteredGroupId = e.id; this.select(kids.map(k => k.id)); } else toast('This group is empty'); } };
    if (this.vtx.canEdit(e)) return { label: 'Edit vertices', hint: 'drag the points and bezier handles (Enter)', run: () => this.vtx.enter(e) };
    return { label: 'Open editor', hint: 'this element has no editor', disabled: true, run: () => {} };
  }

  /** Button designer: pick another library icon for the button (swaps the placed icon, or places one if the button has none). */
  async changeButtonIcon(target) {
    const cur = target?.kind === 'instance' && target.refType === 'icon' ? target
      : this.nodes.find(n => n.kind === 'instance' && n.refType === 'icon');
    openIconPicker(cur?.refId ?? null, async icon => {
      if (cur) await this.patchNode(cur.id, { refId: icon.id }); else await this.addInstance('icon', icon.id);
      toast(`Button icon: "${icon.label || icon.key}"`, 'ok', 1400);
    });
  }

  openEditor(e = this.selectedNodes()[0]) {
    const ed = this.editorFor(e);
    if (!ed || ed.disabled) return toast(ed?.hint || 'Select an element first');
    return ed.run();
  }

  /* ================= multi-event & click actions ================= */
  /** Finds the node (or ancestor group) carrying an event for `trigger` (click, mouseover, release, drag, drop, dblclick, etc.). */
  eventNodeFor(e, trigger = 'click') {
    for (let n = e; n; n = n.parentId != null ? this.byId(n.parentId) : null) {
      if (Array.isArray(n.events)) {
        const hitEv = n.events.find(ev => ev.trigger === trigger);
        if (hitEv) return { node: n, ev: hitEv };
      }
      if (trigger === 'click' && n.onClick) return { node: n, ev: { trigger: 'click', ...n.onClick } };
    }
    return null;
  }

  actionNode(e) {
    const found = this.eventNodeFor(e, 'click');
    return found ? found.node : null;
  }

  async runAction(n, evOverride = null) {
    const c = evOverride || (Array.isArray(n.events) && n.events.find(x => x.trigger === 'click')) || n.onClick;
    if (!c) return;
    if (c.type === 'back') { if (this.opts.onBack) return this.opts.onBack(); return toast('Go back (in the finished app this is history.back())'); }
    if (c.type === 'screen') {
      return this.navigateLiveToScreen(c.targetId);
    }
    if (c.type === 'swap') return this.swapToTarget(n, c);
    if (c.type === 'animate' || c.type === 'toggle') {
      const domEl = this.stage.querySelector(`[data-el="${n.id}"]`);
      if (domEl) domEl.classList.toggle('ud-on');
      toast(`Triggered ${c.type} on "${n.name || n.tag}"`, 'info', 1200);
      return;
    }
    if (c.type === 'toolbar') {
      const el = c.targetId ? findDesign('element', c.targetId) : state.library.elements.find(x => x.key === 'html-floating-toolbar');
      this.showToolbarPreview(n, c, el);
      return;
    }
    if (['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu'].includes(c.type)) {
      const domEl = this.stage.querySelector(`[data-el="${n.id}"]`);
      const udBtn = domEl?.classList?.contains('ud-btn') ? domEl : domEl?.querySelector?.('.ud-btn') || this.stage.querySelector('.ud-btn');
      if (udBtn && this.menu?.ctl) {
        const curSt = this.menu.ctl.get(udBtn);
        this.menu.ctl.set(udBtn, { open: !curSt.open, path: [] });
        toast(`⚡ ${c.type}: ${!curSt.open ? 'opened' : 'closed'}`, 'ok', 1400);
        return;
      }
      if (c.targetId) {
        const el = findDesign('element', c.targetId);
        if (el) return this.showPreview(c.type === 'drawer-menu' ? 'drawer' : 'popup', c.side || 'right', el);
      }
      toast(`⚡ Triggered ${c.type} on "${n.name || n.tag}"`, 'ok', 1400);
      return;
    }
    const el = findDesign('element', c.targetId);
    if (!el) return toast('The element to open no longer exists', 'error');
    const pvKind = c.type === 'show-element' ? (c.displayMode === 'drawer' ? 'drawer' : 'popup') : c.type;
    this.showPreview(pvKind, c.side || c.position, el, { node: n, binding: c });
  }

  /**
   * "Change to the target item" (test phase): the item's drawing is replaced by the target's (e.g. the asc icon
   * becomes the desc icon). A second click restores the original drawing.
   */
  swapToTarget(n, c) {
    this.swapState = this.swapState || new Map();
    const prev = this.swapState.get(n.id);
    if (prev) {                                  // second click: put the original drawing back
      prev.current.replaceWith(prev.orig);
      this.swapState.delete(n.id);
      return toast('Back to the original', 'info', 1000);
    }
    const domEl = this.stage.querySelector(`[data-el="${n.id}"]`);
    const target = c.targetId ? findDesign('element', c.targetId) : null;
    if (!domEl || !target) return toast('Nothing to change to: pick the target item first', 'info');
    // the target's drawing (markup from the domain renderer), scaled and placed where this item is
    const bb = domEl.getBBox ? domEl.getBBox() : { x: 0, y: 0, width: target.width, height: target.height };
    const k = Math.min(bb.width / (target.width || bb.width || 1), bb.height / (target.height || bb.height || 1)) || 1;
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${renderTree(target.nodes, renderContext({}))}</svg>`, 'image/svg+xml');
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('data-el', String(n.id));
    group.setAttribute('data-swapped', String(c.targetId));
    group.setAttribute('transform', `translate(${bb.x} ${bb.y}) scale(${k})`);
    for (const kid of [...parsed.documentElement.childNodes]) group.appendChild(document.importNode(kid, true));
    this.swapState.set(n.id, { orig: domEl, current: group });
    domEl.replaceWith(group);
    toast(`Changed to “${target.name}”`, 'ok', 1000);
  }

  /** Saves the popup settings (position, animations, durations) onto the click binding that opened it. */
  async savePopupCfg(node, binding, patch) {
    if (!node || !binding) return toast('Nothing to save: this popup has no click action', 'error');
    const popup = { ...popupCfgOf(binding), ...patch };
    const inEvents = Array.isArray(node.events) && node.events.includes(binding);
    const body = inEvents ? { events: node.events.map(x => (x === binding ? { ...x, popup } : x)) } : { onClick: { ...binding, popup } };
    await this.patchNode(node.id, body);
    binding.popup = popup;
    toast('Popup settings saved', 'ok', 1400);
  }

  /** Renders a small element floating toolbar near the target node on the canvas. */
  showToolbarPreview(node, evBinding, el = null) {
    this.tbPv?.remove();
    const b = nodeBBox(node, this.nodes);
    const pos = evBinding?.position || 'top';
    const sx = this.view.tx + (b.x + b.w / 2) * this.view.z;
    const sy = pos === 'bottom'
      ? this.view.ty + (b.y + b.h) * this.view.z * this.ay() + 10
      : this.view.ty + b.y * this.view.z * this.ay() - 54;

    const content = h('div', { class: 'dz-mini-toolbar-inner' });
    if (el) {
      const svg = renderDocument({ owner: el, nodes: el.nodes, ctx: renderContext({}), background: false });
      const svgWrap = h('div', { style: { width: `${Math.min(260, el.width)}px` } });
      svgWrap.innerHTML = svg;
      content.append(svgWrap);
    } else {
      content.append(
        h('button', { class: 'hb-btn', onclick: () => { toast('Action: Edit', 'info'); this.tbPv?.remove(); } }, '✎ Edit'),
        h('button', { class: 'hb-btn', onclick: () => { toast('Action: Copy', 'info'); this.tbPv?.remove(); } }, '⧉ Copy'),
        h('button', { class: 'hb-btn', onclick: () => { toast('Action: Share', 'info'); this.tbPv?.remove(); } }, '↗ Share'),
        h('button', { class: 'hb-btn', onclick: () => { this.tbPv?.remove(); } }, '✕')
      );
    }
    this.tbPv = h('div', {
      class: 'dz-mini-toolbar',
      style: { left: `${Math.round(sx)}px`, top: `${Math.round(Math.max(8, sy))}px` }
    }, content);
    this.viewport.append(this.tbPv);
  }

  /** A popup, drawer, or inline element drawn over the canvas, like the finished app shows it. */
  showPreview(kind, side, el, ctx = null) {
    this.closePreview();
    const svg = renderDocument({ owner: el, nodes: el.nodes, ctx: renderContext({}), background: false });
    const panel = h('div', { class: 'dz-pv-panel' });
    panel.innerHTML = svg;      // markup comes from the domain renderer: tags/attributes are whitelisted and escaped
    const w = Math.min(this.viewport.clientWidth * 0.94, Math.max(160, el.width * this.view.z));
    const isPopup = kind === 'popup' && !!ctx?.node;
    const cfg = isPopup ? popupCfgOf(ctx.binding) : null;
    const box = h('div', { class: 'dz-pv-box', style: { width: `${w}px` } }, h('button', { class: 'icon-btn dz-pv-x', title: 'Close (Esc)', onclick: () => this.closePreview() }, '✕'), panel);
    let grip = null;
    if (isPopup) {
      // test phase: the popup can be dragged to its real place (snap applies) and its animations / durations saved
      grip = h('div', { class: 'dz-pv-grip', 'data-f': 'pv-grip', title: 'Drag to move the popup (snaps when snap is on)' }, '⠿ drag to place');
      const controls = popupTestControls({
        cfg,
        onChange: patch => this.applyPopupCfg(box, patch),
        onSave: patch => this.savePopupCfg(ctx.node, ctx.binding, { ...patch, ...(this.pvCfg?.pos || {}) }),
        onReset: () => {
          box.style.position = ''; box.style.left = ''; box.style.top = ''; box.style.margin = '';
          if (this.pvCfg) this.pvCfg.pos = { x: null, y: null };
        }
      });
      box.prepend(grip);
      box.append(controls);
    }
    this.pv = h('div', { class: `dz-pv ${kind}${kind === 'drawer' ? ` from-${side || 'right'}` : ''}` }, h('div', { class: 'dz-pv-scrim', onclick: () => this.closePreview() }), box);
    this.viewport.append(this.pv);
    if (isPopup) {
      placePopupBox(box, cfg, this.viewport);
      box.style.animation = popupAnimation('in', cfg.showAnim, cfg.showMs);
      this.pvCfg = { close: { name: cfg.closeAnim, ms: cfg.closeMs } };
      makeDraggable(box, grip, {
        snap: () => ({ grid: state.settings.snapToGrid ? this.gridSize * this.view.z : 0, anchors: !!state.settings.snapToAnchors }),
        size: () => ({ w: this.viewport.clientWidth, h: this.viewport.clientHeight }),
        onEnd: pos => { if (this.pvCfg) this.pvCfg.pos = pos; }
      });
    }
    const secs = popupAutoCloseSecs(el.nodes);
    if (secs > 0) { const pv = this.pv; this.pvTimer = setTimeout(() => { if (this.pv === pv) this.closePreview(); }, secs * 1000); }
  }

  /** Live update of the open popup while its controls change (animation names and durations take effect on the next show / close). */
  applyPopupCfg(box, patch) {
    if (!this.pvCfg) return;
    if (patch.closeAnim !== undefined || patch.closeMs !== undefined) {
      this.pvCfg.close = { name: patch.closeAnim ?? this.pvCfg.close.name, ms: patch.closeMs ?? this.pvCfg.close.ms };
    }
  }

  closePreview() {
    clearTimeout(this.pvTimer); this.pvTimer = null;
    const pv = this.pv, cfg = this.pvCfg;
    this.pv = null; this.pvCfg = null;
    this.tbPv?.remove(); this.tbPv = null;
    if (!pv) return;
    const box = pv.querySelector('.dz-pv-box');
    const anim = popupAnimation('out', cfg?.close?.name, cfg?.close?.ms);
    if (box && anim) {
      box.style.animation = anim;
      setTimeout(() => pv.remove(), cfg.close.ms);
    } else pv.remove();
  }

  onPointerDown(ev) {
    if (ev.target.closest?.('.dz-live-hud, .dz-live-input, .dz-live-widget, .dz-live-hotspot, .vbar, .rm-toolbar, .dz-pv, .el-hover-toolbar, .dz-mini-toolbar, .dz-preview-banner')) return;
    this.viewport.focus({ preventScroll: true });
    this.tbClick = null;
    if (!this.doc) return;
    const p = this.worldPoint(ev);
    if (ev.button === 1 || (ev.button === 0 && this.spaceDown)) {
      this.pan = { x: ev.clientX, y: ev.clientY, tx: this.view.tx, ty: this.view.ty };
      capture(this.viewport, ev); ev.preventDefault(); return;
    }
    if (ev.button !== 0) return;
    if (this.devicePreview) {      // view-only: a plain drag pans the canvas
      this.pan = { x: ev.clientX, y: ev.clientY, tx: this.view.tx, ty: this.view.ty };
      capture(this.viewport, ev); ev.preventDefault(); return;
    }
    if (ev.target.closest?.('.rm-item, [data-rm="center"]')) return;   // radial/popup menu items handle their own clicks
    if (this.actionsLive) {        // test mode: events do what they do in the finished app
      const rawHit = this.hitNode(ev.target, true) || this.hitNode(ev.target);
      const clickHit = this.eventNodeFor(rawHit, 'click') || this.eventNodeFor(rawHit, 'mousedown');
      if (clickHit) { ev.preventDefault(); this.runAction(clickHit.node, clickHit.ev); return; }
      if (rawHit && this.type === 'screen' && Array.isArray(this.doc.links)) {
        const directLink = this.doc.links.find(l => l.fromNodeId === rawHit.id);
        if (directLink) { ev.preventDefault(); this.navigateLiveToScreen(directLink.toScreenId, directLink.name); return; }
      }
      return;
    }
    if (this.vtx.active) {
      if (this.vtx.pointerDown(ev)) { capture(this.viewport, ev); return; }
      const hit = this.hitNode(ev.target);
      if (hit?.id === this.vtx.node?.id) return;       // clicking the edited path itself keeps vertex mode
      this.vtx.exit();
    }
    if (this.type === 'button' && ev.target.closest?.('.rm-item, [data-rm="center"]')) return;   // menu items handle their own clicks
    if (this.tool === 'pen') { this.pen.pointerDown(ev, p); capture(this.viewport, ev); return; }
    const boxH = ev.target.dataset?.b;
    if (boxH && !this.doc.locked) {
      this.op = { kind: 'box', handle: boxH, start: p, w: this.doc.width, h: this.doc.height, nodes0: deep(this.nodes), snap: this.snapshot() };
      capture(this.viewport, ev); return;
    }
    const handle = ev.target.dataset?.h;
    if (handle && !this.doc.locked) {
      const e = this.selectedNodes()[0];
      this.op = { kind: 'resize', handle, el: e, from: nodeBBox(e, this.nodes), start: p, orig: deep(e.attrs), snap: this.snapshot() };
      capture(this.viewport, ev); return;
    }
    if (this.tool !== 'select') {
      const q = this.snapPoint(p);
      this.ghost = { tool: this.tool, x0: q.x, y0: q.y, x1: q.x, y1: q.y, pts: [q] };
      capture(this.viewport, ev);
      if (this.tool === 'text') { this.ghost = null; this.createText(q); }
      else if (this.tool === 'path') { this.ghost = null; this.createPath(q); }
      return;
    }
    // leave an entered group when the click lands outside it
    if (this.enteredGroupId != null) { let c = this.hitNode(ev.target, true); while (c && c.id !== this.enteredGroupId) c = c.parentId != null ? this.byId(c.parentId) : null; if (!c) this.enteredGroupId = null; }
    const hit = this.hitNode(ev.target, ev.altKey) || this.hitBoundaryNode(p);
    const isBg = hit && (hit.role === 'bg' || hit.role === 'bg-glow');
    if (hit && !isBg) {
      const gs = !ev.shiftKey && !ev.altKey ? this.groupSubHit(ev.target) : null;
      this.tbClick = { id: hit.id, shift: ev.shiftKey, wasOpen: this.toolbarTarget()?.id === hit.id, sub: gs && gs.group.id === hit.id ? gs : null };   // resolved on pointer-up: a click without a drag toggles the quick toolbar
      if (ev.shiftKey) { this.selected.has(hit.id) ? this.selected.delete(hit.id) : this.selected.add(hit.id); this.select([...this.selected]); }
      else if (!this.selected.has(hit.id)) this.select([hit.id]);
      if (this.doc.locked) return;
      const sel = this.selectedNodes().filter(e => !e.locked);
      if (!sel.length) return;
      const moveSet = new Map();
      const collectWithContainerKids = node => {
        if (!node || moveSet.has(node.id)) return;
        moveSet.set(node.id, { id: node.id, orig: deep(node.attrs), tag: node.tag, parentId: node.parentId });
        if (isContainerNode(node, state.library.elements) && node.tag !== 'g') {
          for (const ch of this.nodes.filter(c => c.parentId === node.id)) collectWithContainerKids(ch);
        }
      };
      for (const sNode of sel) collectWithContainerKids(sNode);
      this.op = { kind: 'move', start: p, els: [...moveSet.values()], box: this.selectionBox(sel), snap: this.snapshot(), moved: false };
      capture(this.viewport, ev);
    } else {
      if (!ev.shiftKey) { this.toolbarNodeId = null; this.clearSelection(); }
      this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: ev.shiftKey };
      capture(this.viewport, ev);
    }
  }

  onPointerMove(ev) {
    if (this.pan) {
      this.view.tx = this.pan.tx + ev.clientX - this.pan.x; this.view.ty = this.pan.ty + ev.clientY - this.pan.y;
      this.applyView(); this.updateHoverToolbar(); return;
    }
    const p = this.worldPoint(ev);
    const sb = document.getElementById('statusbar-xy'); if (sb) sb.textContent = `x ${Math.round(p.x * 10) / 10}  y ${Math.round(p.y * 10) / 10}`;
    if (this.vtx.pointerMove(ev, p)) return;
    if (this.tool === 'pen' && this.pen.pointerMove(ev, p)) return;
    if (this.type === 'button') this.menu.onMove(ev, p);
    if (this.ghost) {
      const q = this.snapPoint(p);
      this.ghost.x1 = q.x; this.ghost.y1 = q.y;
      if (this.ghost.tool === 'freehand') this.ghost.pts.push(p);
      this.renderOverlay();
      return;
    }
    if (this.marquee) { this.marquee.x1 = p.x; this.marquee.y1 = p.y; this.renderOverlay(); return; }
    const op = this.op;
    if (!op) {
      // Track hovered node & boundary lines for mouse-over floating toolbar, move cursor, and live mouseover events
      if (!ev.target.closest?.('.el-hover-toolbar, .dz-mini-toolbar, .dz-pv')) {
        const bHit = (this.tool === 'select' && !this.actionsLive) ? this.hitBoundaryNode(p) : null;
        const hNode = (!this.actionsLive && this.groupSubHit(ev.target)?.sub) || this.hitNode(ev.target) || bHit;   // inside a selected group the hover outlines the sub item
        const hId = hNode && hNode.role !== 'bg' && hNode.role !== 'bg-glow' ? hNode.id : null;
        if (this.tool === 'select' && !this.actionsLive && !ev.target.dataset?.h && !ev.target.dataset?.b) {
          this.viewport.style.cursor = (bHit || hId) ? 'move' : 'default';
        }
        if (hId !== this.hoveredNodeId) {
          this.hoveredNodeId = hId;
          this.renderOverlay();
          if (this.actionsLive && hNode) {
            const overHit = this.eventNodeFor(hNode, 'mouseover');
            if (overHit) this.runAction(overHit.node, overHit.ev);
          }
        }
      }
      return;
    }
    if (op.kind === 'move') {
      let dx = p.x - op.start.x, dy = p.y - op.start.y;
      if (!op.moved && Math.hypot(dx, dy) * this.view.z < 3) return;
      if (!op.moved) { op.moved = true; this.dragging = true; }
      ({ dx, dy } = this.snapMove(op.box, dx, dy, ev.ctrlKey));
      const movingIds = new Set(op.els.map(o => o.id));
      for (const o of op.els) {
        const e = this.byId(o.id);
        e.attrs = translateAttrs({ tag: o.tag, attrs: o.orig }, dx, dy);
        if (e.parentId != null && !movingIds.has(e.parentId)) {
          const parent = this.byId(e.parentId);
          if (parent && isContainerNode(parent, state.library.elements)) {
            e.attrs = clampNodeToContainer(e, parent, this.nodes, state.library.elements);
          }
        }
      }
      this.renderStage(); this.renderOverlay();
    } else if (op.kind === 'resize') {
      const f = op.from, s = this.snapPoint(p, ev.ctrlKey), k = op.handle;
      let x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h;
      if (k.includes('w')) x0 = Math.min(s.x, x1 - 1); if (k.includes('e')) x1 = Math.max(s.x, x0 + 1);
      if (k.includes('n')) y0 = Math.min(s.y, y1 - 1); if (k.includes('s')) y1 = Math.max(s.y, y0 + 1);
      if (ev.shiftKey && f.w && f.h && k.length === 2) { const r = f.w / f.h; const w = x1 - x0, hh = y1 - y0; if (w / hh > r) { const nw = hh * r; if (k.includes('w')) x0 = x1 - nw; else x1 = x0 + nw; } else { const nh = w / r; if (k.includes('n')) y0 = y1 - nh; else y1 = y0 + nh; } }
      let targetBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (op.el.parentId != null) {
        const parent = this.byId(op.el.parentId);
        if (parent && isContainerNode(parent, state.library.elements)) {
          targetBox = clampBoxToContainer(targetBox, parent, this.nodes, state.library.elements);
        }
      }
      op.el.attrs = resizeAttrs({ tag: op.el.tag, attrs: op.orig }, f, targetBox);
      if (isContainerNode(op.el, state.library.elements)) {
        for (const ch of this.nodes.filter(c => c.parentId === op.el.id)) {
          ch.attrs = clampNodeToContainer(ch, op.el, this.nodes, state.library.elements);
        }
      }
      this.dragging = true;
      this.renderStage(); this.renderOverlay();
    } else if (op.kind === 'box') {
      const q = this.snapPoint(p, ev.ctrlKey);
      const w = op.handle.includes('e') ? Math.max(8, q.x) : op.w, hh = op.handle.includes('s') ? Math.max(8, q.y) : op.h;
      this.dragging = true;
      this.doc.width = w; this.doc.height = hh;
      if (this.scaleContent) {                                   // live preview of the contents scaling with the box
        for (const pch of scaleNodeSet(op.nodes0, w / op.w, hh / op.h)) this.byId(pch.id).attrs = pch.attrs;
      }
      this.renderStage(); this.renderOverlay();
    }
  }

  async onPointerUp(ev) {
    if (this.pan) { this.pan = null; return; }
    if (this.actionsLive) {
      const rawHit = this.hitNode(ev.target, true);
      const relHit = this.eventNodeFor(rawHit, 'release') || this.eventNodeFor(rawHit, 'drop');
      if (relHit) this.runAction(relHit.node, relHit.ev);
      return;
    }
    if (await this.vtx.pointerUp()) return;
    if (this.tool === 'pen' && this.pen.drag) { this.pen.pointerUp(); return; }
    if (this.ghost) { const g = this.ghost; this.ghost = null; this.renderOverlay(); await this.createShape(g); return; }
    if (this.marquee) {
      const m = this.marquee; this.marquee = null;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (x1 - x0 > 2 && y1 - y0 > 2) {
        const hits = this.nodes.filter(e => e.parentId == null && e.role !== 'bg' && e.role !== 'bg-glow' && e.visible).filter(e => { const b = nodeBBox(e, this.nodes); return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0; }).map(e => e.id);
        this.select(hits, { add: m.add });
      } else this.renderOverlay();
      return;
    }
    const op = this.op; this.op = null; this.guides = [];
    const tbClick = this.tbClick; this.tbClick = null;
    if (!op) { if (tbClick) this.toggleToolbarFor(tbClick.id, tbClick); return; }   // locked element / design: still a click
    const wasDragging = this.dragging; this.dragging = false;
    if (op.kind === 'move' && !op.moved && tbClick?.sub) { this.enteredGroupId = tbClick.sub.group.id; this.select([tbClick.sub.sub.id]); return; }   // a second click on a selected group picks the sub item under the cursor
    if (op.kind === 'move' && !op.moved) { if (tbClick) this.toggleToolbarFor(tbClick.id, tbClick); this.renderOverlay(); return; }
    if (op.kind === 'box') {
      const w = this.doc.width, hh = this.doc.height;
      this.doc.width = op.w; this.doc.height = op.h; this.nodes.splice(0, this.nodes.length, ...op.nodes0);
      await this.updateDoc({ width: w, height: hh }, { undo: op.snap });
      return;
    }
    if (wasDragging) {
      const ids = op.kind === 'move' ? op.els.map(o => o.id) : [op.el.id];
      const dropPt = ev ? this.worldPoint(ev) : null;
      this.pushUndo(op.snap);
      try {
        // a node moved onto a repeater becomes a template child in the repeater
        let adopted = null;
        if (op.kind === 'move' && dropPt) {
          const cand = ids.map(id => this.byId(id)).find(n => n && n.parentId == null && !isContainerNode(n, state.library.elements));
          const hitCont = cand ? this.containerAtPoint(dropPt, cand.id) : null;
          const hb = hitCont ? nodeBBox(hitCont, this.nodes) : null;
          if (hitCont && isRepeaterNode(hitCont, state.library.elements) && dropPt.x >= hb.x && dropPt.x <= hb.x + hb.w && dropPt.y >= hb.y && dropPt.y <= hb.y + hb.h) {
            const { patches, parkedIds } = repeaterAdoptOps(this.nodes, hitCont, cand, containerInnerBox(hitCont, this.nodes, state.library.elements), { keepSize: true, replace: false });
            for (const { id, patch } of patches) Object.assign(this.byId(id), await api.patchNode(this.type, this.doc.id, id, patch));
            adopted = { id: cand.id, rep: hitCont, parked: parkedIds.length };
          }
        }
        await Promise.all(ids.filter(id => id !== adopted?.id).map(async id => {
          const node = this.byId(id);
          const patch = { attrs: node.attrs };
          if (op.kind === 'move' && node.parentId == null && !isContainerNode(node, state.library.elements) && dropPt) {
            const hitCont = this.containerAtPoint(dropPt, node.id);
            if (hitCont && isRepeaterNode(hitCont, state.library.elements)) {
              // Add as additional template into repeater container
              const { patches } = repeaterAdoptOps(this.nodes, hitCont, node, containerInnerBox(hitCont, this.nodes, state.library.elements), { keepSize: true, replace: false });
              for (const { id: pid, patch: p } of patches) {
                if (pid === node.id) Object.assign(patch, p);
                else Object.assign(this.byId(pid), await api.patchNode(this.type, this.doc.id, pid, p));
              }
            } else if (hitCont) {
              node.parentId = hitCont.id;
              node.attrs = clampNodeToContainer(node, hitCont, this.nodes, state.library.elements);
              patch.parentId = hitCont.id;
              patch.attrs = node.attrs;
            }
          }
          const saved = await api.patchNode(this.type, this.doc.id, id, patch);
          Object.assign(node, saved);
        }));
        if (adopted) await this.fitRepeater(adopted.rep.id);
        if (adopted) {
          const tpls = repeaterTemplates(this.nodes, adopted.rep.id);
          toast(`Added "${this.byId(adopted.id)?.name || 'node'}" into repeater "${adopted.rep.name || 'repeater'}" (${tpls.length} item types)`, 'ok', 2200);
        }
      }
      catch (e) { toast(e.message, 'error'); await this.reload(); return; }
      this.changed();
    }
    this.renderStage(); this.renderOverlay();
  }

  /* ================= snapping ================= */
  snapPoint(p, bypass = false) {
    if (!state.settings.snapToGrid || bypass) return p;
    const g = this.gridSize;
    return { x: snap(p.x, g), y: snap(p.y, g) };
  }

  /** Snaps a moving box (grid, then the 9 reference lines of the design); fills this.guides. */
  snapMove(box, dx, dy, bypass) {
    this.guides = [];
    if (bypass) return { dx, dy };
    const W = this.doc.width, H = this.doc.height, th = 8 / this.view.z;
    let nx = box.x + dx, ny = box.y + dy, sx = false, sy = false;
    if (state.settings.snapToAnchors && !this.isGlyph) {
      const xs = [0, W / 2, W], ys = [0, H / 2, H];
      const cand = (pos, size, lines) => { let best = null; for (const off of [0, size / 2, size]) for (const l of lines) { const d = l - (pos + off); if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l }; } return best; };
      const bx = cand(nx, box.w, xs), by = cand(ny, box.h, ys);
      if (bx) { nx += bx.d; sx = true; this.guides.push({ x1: bx.line, y1: 0, x2: bx.line, y2: H }); }
      if (by) { ny += by.d; sy = true; this.guides.push({ x1: 0, y1: by.line, x2: W, y2: by.line }); }
    }
    if (state.settings.snapToGrid) { const g = this.gridSize; if (!sx) nx = snap(nx, g); if (!sy) ny = snap(ny, g); }
    return { dx: nx - box.x, dy: ny - box.y };
  }

  /* ================= keyboard ================= */
  onKey(ev) {
    if (ev.target !== this.viewport) return;
    if (this.vtx.active && this.vtx.key(ev)) { ev.preventDefault(); return; }
    if (this.tool === 'pen' && this.pen.key(ev)) { ev.preventDefault(); return; }
    const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
    if (k === 'escape' && (this.pv || this.tbPv)) { this.closePreview(); return; }
    if (k === 'escape' && this.toolbarTarget()) { this.toolbarNodeId = null; this.updateHoverToolbar(); return; }
    if (ctrl && k === 'g') { ev.preventDefault(); ev.shiftKey ? this.ungroupSelected() : this.groupSelected(); return; }
    if (ctrl && k === 'l') { ev.preventDefault(); this.toggleLockSelected?.(); return; }
    if (ev.code === 'Space') { this.spaceDown = true; ev.preventDefault(); return; }
    if (this.devicePreview) {      // view-only: zoom, fit and Esc (leave the preview) still work
      if (k === 'escape') return void this.setDevicePreview(null);
      if (k === '+' || k === '=') return this.zoomBy(1.25);
      if (k === '-') return this.zoomBy(1 / 1.25);
      if (k === '0') return this.fit();
      if (ctrl || ['delete', 'backspace', 'enter'].includes(k) || k.startsWith('arrow')) { ev.preventDefault(); this.previewLocked(); }
      return;
    }
    if (ctrl && k === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && k === 'y') { ev.preventDefault(); this.redo(); return; }
    if (ctrl && k === 'd') { ev.preventDefault(); this.duplicateSelected(); return; }
    if (ctrl && k === 'a') { ev.preventDefault(); this.select(this.nodes.filter(e => e.parentId == null && e.role !== 'bg' && e.role !== 'bg-glow').map(e => e.id)); return; }
    if (k === 'enter' && this.selected.size === 1) { ev.preventDefault(); this.vtx.enter(this.selectedNodes()[0]); return; }
    if (k === 'delete' || k === 'backspace') { ev.preventDefault(); this.deleteSelected(); return; }
    if (k === 'escape') { this.clearSelection(); this.setTool('select'); return; }
    if (k.startsWith('arrow') && this.selected.size) {
      ev.preventDefault();
      const step = ev.shiftKey ? this.gridSize : (this.isGlyph ? 0.5 : 1);
      this.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      return;
    }
    if (k === '+' || k === '=') return this.zoomBy(1.25);
    if (k === '-') return this.zoomBy(1 / 1.25);
    if (k === '0') return this.fit();
    if (!ctrl) {
      if (k === 'n') return this.selected.size === 1 ? this.vtx.enter(this.selectedNodes()[0]) : toast('Select one path (or shape) first');
      const t = TOOLS.find(t => t[1].toLowerCase() === k && t[0] !== 'node'); if (t) this.setTool(t[0]);
    }
  }

  /* ================= history ================= */
  snapshot() { return { nodes: deep(this.nodes), animations: deep(this.doc.animations || []), width: this.doc.width, height: this.doc.height }; }
  pushUndo(snap) { this.undoStack.push(snap); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; }

  async restore(snap) {
    const withAnims = snap.nodes.map(e => ({ ...e, animations: snap.animations.filter(a => a.nodeId === e.id).map(({ id, nodeId, ...a }) => a) }));
    if (snap.width !== this.doc.width || snap.height !== this.doc.height) await api.updateDesign(this.type, this.doc.id, { width: snap.width, height: snap.height, scaleContent: false });
    await api.replaceNodes(this.type, this.doc.id, withAnims);
    await this.reload(false);
    this.changed();
  }
  async undo() { if (this.previewLocked()) return; const s = this.undoStack.pop(); if (!s) return toast('nothing to undo'); this.vtx.exit(); this.redoStack.push(this.snapshot()); await this.restore(s); }
  async redo() { if (this.previewLocked()) return; const s = this.redoStack.pop(); if (!s) return toast('nothing to redo'); this.vtx.exit(); this.undoStack.push(this.snapshot()); await this.restore(s); }

  changed() { this.emit('doc', this.doc); this.emit('changed', this.doc); }

  /* ================= edit operations ================= */
  async mutate(fn) {
    if (this.previewLocked()) return null;
    const snap = this.snapshot(), targetType = this.type, targetId = this.doc?.id;
    try {
      const r = await fn();
      if (this.type !== targetType || this.doc?.id !== targetId) return r;
      this.pushUndo(snap); this.renderAll(); this.changed(); return r;
    } catch (e) {
      toast(e.message, 'error');
      if (this.type === targetType && this.doc?.id === targetId) await this.reload();
      return null;
    }
  }

  /**
   * Variable name of a library item placed on this screen. A public item gets the target project's global prefix:
   * projectprefix-[itemtype]-itemname (e.g. untrap-element-scan-button). Other items keep their own key.
   */
  instanceVariableName(refType, lib) {
    const prefix = isPublicLibraryItem(lib) ? (state.projects || []).find(p => Number(p.id) === Number(this.doc?.projectId))?.settings?.prefix : null;
    return prefixedVariableName(prefix || null, refType, lib.key);
  }

  uniqueName(base) {
    const names = new Set(this.nodes.map(e => e.name));
    if (!names.has(base)) return base;
    let n = 2; while (names.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async addNode(def, { select = true } = {}) {
    const targetType = this.type, targetId = this.doc?.id;
    return this.mutate(async () => {
      const maxOrd = this.nodes.reduce((m, n) => Math.max(m, Number(n.ord) || 0), 0);
      const el = await api.addNode(targetType, targetId, { ...def, ord: maxOrd + 1 });
      if (this.type === targetType && this.doc?.id === targetId) {
        this.doc.nodes.push(el);
        if (select) this.selected = new Set([el.id]);
      }
      return el;
    });
  }

  /** Default size and position of a placed design, by what is placed where. */
  placement(refType, lib, at) {
    const D = this.doc;
    if (refType === 'path') return { x: 0, y: 0, w: 24, h: 24 };                       // a path group fills its 24 grid
    let w, hh;
    if (refType === 'icon') w = hh = this.type === 'button' ? Math.round(Math.min(D.width, D.height) * 0.625) : this.type === 'screen' ? 48 : 24;
    else { w = lib.width; hh = lib.height; }
    if (refType === 'icon' && this.type === 'button' && !at) return { x: Math.round((D.width - w) / 2), y: Math.round((D.height - hh) / 2), w, h: hh };
    const r = this.viewport.getBoundingClientRect();
    const c = at || this.worldPoint({ clientX: r.left + this.viewport.clientWidth / 2, clientY: r.top + this.viewport.clientHeight / 2 });
    const q = this.snapPoint({ x: c.x - w / 2, y: c.y - hh / 2 });
    return { x: q.x, y: q.y, w, h: hh };
  }

  /**
   * Screen → workflow: the server follows the routes of this screen (menu items and click actions that go to another
   * screen, also inside the buttons / elements / popups it shows) screen after screen and lays them all out, linked.
   */
  async generateWorkflow() {
    if (!this.doc || this.type !== 'screen') return;
    const name = await promptBox('Generate workflow from this screen', { label: 'Workflow name', value: `${this.doc.name} workflow`, okLabel: 'Generate' });
    if (!name?.trim()) return;
    const activeProj = state.projects.find(p => p.id === state.activeProjectId);
    try {
      await this.settle();   // routes are read on the server: pending edits first
      const wf = await api.workflowFromScreen({ screenId: this.doc.id, name: name.trim(), projectId: state.activeProjectId, visibility: activeProj?.visibility === 'project' ? 'project' : 'private' });
      markEdited('workflow', wf.id);
      emit('workflows:changed');
      toast(`Workflow “${wf.name}”: ${wf.nodes.length} screen(s), ${wf.links.length} route(s)`, 'ok', 3200);
      emit('workflow:select', wf.id);
    } catch (e) { toast(e.message, 'error', 3600); }
  }

  /** Saves the node (its sub tree and the shapes drawn inside it) as a new element in the library; the design stays as it is. */
  async extractAsElement(target) {
    const ex = extractNodes(this.nodes, target.id, n => nodeBBox(n, this.nodes));
    if (!ex) return;
    const name = await promptBox('Extract as element', { label: 'Element name', value: `${target.name || target.tag} element`, okLabel: 'Extract' });
    if (!name?.trim()) return;
    const activeProj = state.projects.find(p => p.id === state.activeProjectId);
    try {
      const rec = await api.createDesign('element', { name: name.trim(), category: 'custom', projectId: state.activeProjectId, visibility: activeProj?.visibility === 'project' ? 'project' : 'private',
        width: ex.box.w, height: ex.box.h, meta: { htmlTag: 'div', extractedFrom: { type: this.type, id: this.doc.id, nodeId: target.id } },
        descriptionDev: `Extracted from ${this.type} "${this.doc.name}" (${ex.nodes.length - 1} node(s)).`, nodes: ex.nodes });
      // show it at once: first in the Elements library (red edge), whatever tab / scope filter the panel was on
      markEdited('element', rec.id);
      state.tab = 'element';
      if (!(await revealInLibrary(rec))) await reloadLibrary({ silent: true });
      emit('library:changed');
      document.querySelector('.lib-body .lib-scroll')?.scrollTo?.(0, 0);
      toast(`Saved as element “${rec.name}” (${ex.box.w}×${ex.box.h}) in the library`, 'ok', 2600);
    } catch (e) { toast(e.message, 'error'); }
  }

  /**
   * Places a picture of the image library as an image node (a raster picture, not a library instance): its own size scaled
   * to fit 60 % of the design, centred on the drop point (or the design). Paths and icons draw vectors only.
   */
  async addImage(imageId, at) {
    if (this.previewLocked?.()) return;
    if (this.type === 'path' || this.type === 'icon') return toast('Images go on buttons, elements and screens (paths and icons are vector only)', 'error');
    let img;
    try { img = await api.image(imageId); } catch (e) { return toast(e.message, 'error'); }
    const W = Number(this.doc.width) || 390, H = Number(this.doc.height) || 844;
    const iw = img.width || 400, ih = img.height || 300, k = Math.min(1, (W * 0.6) / iw, (H * 0.6) / ih);
    const w = Math.max(8, Math.round(iw * k)), hgt = Math.max(8, Math.round(ih * k));
    const cx = at?.x ?? W / 2, cy = at?.y ?? H / 2;
    await this.addNode({ tag: 'image', kind: 'shape', name: img.key, descriptionDev: img.descriptionDev || '',
      attrs: { x: Math.round(cx - w / 2), y: Math.round(cy - hgt / 2), width: w, height: hgt, imageId: img.id, preserveAspectRatio: 'xMidYMid slice' } });
    toast(`Image “${img.label || img.name}” added`, 'ok', 1200);
  }

  async addInstance(refType, id, at) {
    if (this._loadingTarget && this._loadingTarget.type === refType && this._loadingTarget.id === Number(id)) return;
    if (!this.doc) return toast('Open a design first', 'error');
    if (refType === 'image') return this.addImage(id, at);
    if (refType === this.type && Number(id) === Number(this.doc.id)) return;
    if (!canContain(this.type, refType)) {
      const ok = TYPES[this.type].accepts.join(', ') || 'only its own vector shapes';
      return toast(`A ${this.type} can contain ${ok} (hierarchy: path → icon → button → element → screen)`, 'error');
    }
    const lib = libOf(refType).find(d => d.id === id);
    if (!lib) return;
    let pl = this.placement(refType, lib, at);
    const isContainerItem = refType === 'element' && (lib.key === 'html-container' || lib.key === 'html-carousel-container' || lib.category === 'containers');
    const isCarouselItem = refType === 'element' && (lib.key === 'html-carousel-container' || lib.meta?.containerType === 'carousel');
    const isRepeaterItem = refType === 'element' && (lib.key === REPEATER_KEY || lib.meta?.containerType === 'repeater');
    let targetContainer = this.containerAtPoint(at);
    // dropping onto a repeater sets / replaces its template (the item it repeats) instead of adding a sibling; a drop
    // that lands outside it (containerAtPoint falls back to the selected container) is a normal top-level drop
    if (targetContainer && isRepeaterNode(targetContainer, state.library.elements)) {
      const b = at ? nodeBBox(targetContainer, this.nodes) : null;
      if (!at || (at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h)) return this.setRepeaterTemplate(targetContainer, refType, id, lib, pl);
      targetContainer = null;
    }
    let parentId = null;
    const extraAttrs = {};

    if (isContainerItem) {
      extraAttrs['data-container'] = isCarouselItem ? 'carousel' : 'container';
      extraAttrs['data-size-mode'] = 'responsive';
      extraAttrs['data-outer-margin'] = 16;
      extraAttrs['data-inner-margin'] = 12;
      extraAttrs['data-fit-screen'] = 'width';
      if (isCarouselItem) {
        extraAttrs['data-carousel-dim'] = '3d';
        extraAttrs['data-carousel-dir'] = 'horizontal';
        extraAttrs['data-carousel-speed'] = 2600;
        extraAttrs['data-carousel-autoroll'] = 'true';
        extraAttrs['data-carousel-index'] = 0;
      }
      if (isRepeaterItem) Object.assign(extraAttrs, repeaterDefaultAttrs());
      if (this.type === 'screen' && !targetContainer) {
        const om = 16;
        pl = {
          x: om,
          y: Math.max(om, Math.min(pl.y, this.doc.height - lib.height - om)),
          w: Math.max(64, this.doc.width - om * 2),
          h: lib.height
        };
      }
    }

    if (targetContainer) {
      parentId = targetContainer.id;
      pl = clampBoxToContainer(pl, targetContainer, this.nodes, state.library.elements);
    }

    const el = await this.addNode({
      tag: 'use',
      kind: 'instance',
      refType,
      refId: id,
      parentId,
      role: isRepeaterItem ? 'repeater-container' : isCarouselItem ? 'carousel-container' : isContainerItem ? 'container' : null,
      name: this.uniqueName(this.instanceVariableName(refType, lib)),
      attrs: { x: pl.x, y: pl.y, width: pl.w, height: pl.h, ...extraAttrs }
    });
    if (el) toast(parentId ? `Added ${refType} "${lib.key}" inside container "${targetContainer.name}" (clamped to inner margin)` : `added ${refType} ${lib.key}`, 'ok', 1800);
  }

  /**
   * Resizes a repeater around its templates: lists hold every copy (count × item + gaps), moving layouts fit the item
   * across their viewport; the template moves to the first slot.
   * Clamps the repeater's total dimensions so it does not exceed the design screen bounding box.
   */
  async fitRepeater(repId, { quiet = true } = {}) {
    const rep = this.byId(repId), tpls = rep && repeaterTemplates(this.nodes, rep.id);
    const tpl = tpls?.[0] || null;
    if (!rep || !tpl) return;
    const cfg = repeaterConfig(rep), outer = nodeBBox(rep, this.nodes), inner = containerInnerBox(rep, this.nodes, state.library.elements);
    let maxW = 0, maxH = 0;
    for (const tn of tpls) {
      const b = nodeBBox(tn, this.nodes);
      if (b.w > maxW) maxW = b.w;
      if (b.h > maxH) maxH = b.h;
    }
    const tb = nodeBBox(tpl, this.nodes);
    const item = { w: cfg.itemWidth || maxW || tb.w || 64, h: cfg.itemHeight || maxH || tb.h || 64 };

    // Limit repeater container so it does not exceed the design screen's bounding box
    const maxScreenBox = {
      w: Math.max(32, this.doc.width - outer.x),
      h: Math.max(32, this.doc.height - outer.y)
    };
    const box = repeaterFitBox(cfg, outer, inner, item, maxScreenBox);
    if (Math.abs(box.w - outer.w) > 0.5 || Math.abs(box.h - outer.h) > 0.5) await this.patchNode(rep.id, { attrs: resizeAttrs(rep, outer, box) }, { quiet });
    const cur = this.byId(rep.id), t2 = repeaterTemplate(this.nodes, rep.id);
    if (!cur || !t2 || !['use', 'rect', 'image'].includes(t2.tag)) return;
    const b = nodeBBox(t2, this.nodes), first = repeaterPlan(repeaterConfig(cur), containerInnerBox(cur, this.nodes, state.library.elements), item).copies[0];
    if (Math.abs(first.x - b.x) > 0.5 || Math.abs(first.y - b.y) > 0.5) await this.patchNode(t2.id, { attrs: { ...t2.attrs, x: first.x, y: first.y } }, { quiet });
  }

  /** The library item is added as a template child into the repeater at its own size; the repeater grows to hold copies without exceeding screen bounds. */
  async setRepeaterTemplate(rep, refType, refId, lib, pl) {
    const inner = containerInnerBox(rep, this.nodes, state.library.elements);
    const k = Math.min(1, (this.doc.width - 32) / Math.max(1, pl.w));   // only a template wider than the design shrinks
    const w = Math.max(4, Math.round(pl.w * k)), hh = Math.max(4, Math.round(pl.h * k));
    const cfg = repeaterConfig(rep);
    const first = repeaterPlan(cfg, inner, { w: cfg.itemWidth || w, h: cfg.itemHeight || hh }).copies[0];
    const def = { tag: 'use', kind: 'instance', refType, refId, role: null, name: this.uniqueName(this.instanceVariableName(refType, lib)), attrs: { x: first.x, y: first.y, width: w, height: hh } };
    const { removeIds, node } = repeaterTemplateOps(this.nodes, rep, def, null, { replace: false });
    const el = await this.mutate(async () => {
      for (const rid of removeIds) await api.deleteNode(this.type, this.doc.id, rid);
      const made = await api.addNode(this.type, this.doc.id, node);
      await this.reload(false);
      this.selected = new Set([rep.id]);
      return made;
    });
    if (el) {
      await this.fitRepeater(rep.id);
      this.emit('selection', this.selectedNodes());
      const allTpls = repeaterTemplates(this.nodes, rep.id);
      toast(`Added "${lib.key}" to repeater (${allTpls.length} item types · ${cfg.itemCount} copies)`, 'ok', 1800);
    }
    return el;
  }

  async createShape(g) {
    const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), hh = Math.abs(g.y1 - g.y0);
    if (g.tool === 'crop') { this.setTool('select'); if (w < 2 || hh < 2) return toast('Drag a rectangle over the shapes to crop'); return this.cropSelection({ x, y, w, h: hh }); }
    const glyph = this.isGlyph;
    const rw = w < 2 ? (glyph ? 8 : 80) : w;
    const rh = hh < 2 ? (glyph ? 8 : 64) : hh;
    const cx = x + rw / 2, cy = y + rh / 2;
    const targetContainer = (g.tool !== 'container' && g.tool !== 'carousel') ? this.containerAtPoint({ x: cx, y: cy }) : null;
    let def;
    if (g.tool === 'container' || g.tool === 'carousel') {
      const isCarousel = g.tool === 'carousel';
      const om = 16;
      const box = (w < 8 || hh < 8)
        ? {
            x: this.type === 'screen' ? om : Math.max(0, x),
            y: Math.max(om, Math.min(y, Math.max(om, this.doc.height - 220 - om))),
            width: this.type === 'screen' ? Math.max(80, this.doc.width - om * 2) : Math.max(80, this.doc.width - 24),
            height: isCarousel ? 220 : 200
          }
        : { x, y, width: w, height: hh };
      def = {
        tag: 'rect',
        role: isCarousel ? 'carousel-container' : 'container',
        name: this.uniqueName(isCarousel ? 'carousel-container' : 'container'),
        attrs: {
          ...box,
          rx: 18,
          'data-container': isCarousel ? 'carousel' : 'container',
          'data-size-mode': 'responsive',
          'data-outer-margin': om,
          'data-inner-margin': 12,
          'data-fit-screen': 'width',
          ...(isCarousel ? {
            'data-carousel-dim': '3d',
            'data-carousel-dir': 'horizontal',
            'data-carousel-speed': 2600,
            'data-carousel-autoroll': 'true',
            'data-carousel-index': 0
          } : {})
        }
      };
    } else if (g.tool === 'rect') {
      const r = (w < 1 || hh < 1) ? { x, y, width: glyph ? 6 : 96, height: glyph ? 6 : 64 } : { x, y, width: w, height: hh };
      def = { tag: 'rect', name: this.uniqueName('rect'), attrs: { ...r, rx: glyph ? 1 : 12, ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'circle') {
      const r = Math.max(w, hh) / 2 || (glyph ? 3 : 32);
      def = { tag: 'circle', name: this.uniqueName('circle'), attrs: { cx: x + (w ? w / 2 : r), cy: y + (hh ? hh / 2 : r), r, ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'ellipse') {
      def = { tag: 'ellipse', name: this.uniqueName('ellipse'), attrs: { cx, cy, rx: Math.round(rw / 2), ry: Math.round(rh / 2), ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'polygon') {
      const sides = 6, rx = rw / 2, ry = rh / 2;
      const pts = Array.from({ length: sides }, (_, i) => {
        const ang = (i * 2 * Math.PI) / sides - Math.PI / 2;
        return `${Math.round((cx + rx * Math.cos(ang)) * 10) / 10} ${Math.round((cy + ry * Math.sin(ang)) * 10) / 10}`;
      });
      def = { tag: 'path', name: this.uniqueName('polygon'), attrs: { d: `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`, ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'star') {
      const spikes = 5, outerX = rw / 2, outerY = rh / 2, innerX = outerX * 0.42, innerY = outerY * 0.42;
      const pts = [];
      for (let i = 0; i < spikes * 2; i++) {
        const rx = i % 2 === 0 ? outerX : innerX;
        const ry = i % 2 === 0 ? outerY : innerY;
        const ang = (i * Math.PI) / spikes - Math.PI / 2;
        pts.push(`${Math.round((cx + rx * Math.cos(ang)) * 10) / 10} ${Math.round((cy + ry * Math.sin(ang)) * 10) / 10}`);
      }
      def = { tag: 'path', name: this.uniqueName('star'), attrs: { d: `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`, ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'arrow') {
      const x0 = g.x0, y0 = g.y0, x1 = w < 2 && hh < 2 ? x0 + (glyph ? 12 : 96) : g.x1, y1 = w < 2 && hh < 2 ? y0 : g.y1;
      const ang = Math.atan2(y1 - y0, x1 - x0), head = glyph ? 3.5 : 14;
      const hx1 = Math.round((x1 - head * Math.cos(ang - Math.PI / 6)) * 10) / 10;
      const hy1 = Math.round((y1 - head * Math.sin(ang - Math.PI / 6)) * 10) / 10;
      const hx2 = Math.round((x1 - head * Math.cos(ang + Math.PI / 6)) * 10) / 10;
      const hy2 = Math.round((y1 - head * Math.sin(ang + Math.PI / 6)) * 10) / 10;
      def = { tag: 'path', name: this.uniqueName('arrow'), attrs: { d: `M ${x0} ${y0} L ${x1} ${y1} M ${hx1} ${hy1} L ${x1} ${y1} L ${hx2} ${hy2}`, fill: 'none', stroke: glyph ? undefined : '{{accent}}', 'stroke-width': glyph ? undefined : 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } };
    } else if (g.tool === 'callout') {
      const bh = Math.round(rh * 0.78), tx = Math.round(x + rw * 0.28);
      const d = `M ${x} ${y} H ${x + rw} V ${y + bh} H ${tx + 16} L ${tx} ${y + rh} L ${tx + 4} ${y + bh} H ${x} Z`;
      def = { tag: 'path', name: this.uniqueName('callout'), attrs: { d, ...(glyph ? {} : { fill: '{{accent}}' }) } };
    } else if (g.tool === 'freehand') {
      const pts = g.pts?.length > 1 ? g.pts : [{ x, y }, { x: x + rw, y: y + rh }];
      const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(pt.x * 10) / 10} ${Math.round(pt.y * 10) / 10}`).join(' ');
      def = { tag: 'path', name: this.uniqueName('freehand'), attrs: { d, fill: 'none', stroke: glyph ? undefined : '{{accent}}', 'stroke-width': glyph ? undefined : 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } };
    } else if (g.tool === 'line') {
      if (!w && !hh) return;
      def = { tag: 'line', name: this.uniqueName('line'), attrs: { x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, stroke: glyph ? undefined : '{{text}}', 'stroke-width': glyph ? undefined : 2, 'stroke-linecap': 'round' } };
    }
    if (def) {
      if (targetContainer) def.parentId = targetContainer.id;
      Object.keys(def.attrs).forEach(k => def.attrs[k] === undefined && delete def.attrs[k]);
      await this.addNode(def);
      this.setTool('select');
    }
  }

  async createText(p) {
    const text = await promptBox('New text', { label: 'Text', value: 'Text', okLabel: 'Add' });
    if (!text) return;
    await this.addNode({ tag: 'text', kind: 'text', text, name: this.uniqueName('text'), attrs: { x: p.x, y: p.y + 16, 'font-size': 16, 'font-weight': 600, 'text-anchor': 'start', fill: '{{text}}' } });
    this.setTool('select');
  }

  async createPath(p) {
    const d = await promptBox('New path', { label: 'Path data (d attribute) — you can edit the vertices visually afterwards', value: 'M4 12h16M12 4v16', okLabel: 'Add', multiline: true });
    if (!d?.trim()) return;
    const glyph = this.isGlyph;
    await this.addNode({ tag: 'path', name: this.uniqueName('path'), attrs: { d: d.trim(), ...(glyph ? {} : { fill: 'none', stroke: '{{accent}}', 'stroke-width': '{{sw}}', 'stroke-linecap': 'round', transform: `translate(${p.x} ${p.y})` }) } });
    this.setTool('select');
  }

  async editText(e) {
    const t = await promptBox('Edit text', { label: 'Text', value: e.text, okLabel: 'Apply' });
    if (t !== null) await this.patchNode(e.id, { text: t });
  }

  /** Patch one node (used by the inspector and the vertex editor). */
  async patchNode(id, patch, { quiet = false } = {}) {
    const e = this.byId(id);
    if (!e) return;
    const snap = this.snapshot();
    try {
      const saved = await api.patchNode(this.type, this.doc.id, id, patch);
      Object.assign(e, saved);
      if (isContainerNode(e, state.library.elements) && !isRepeaterNode(e, state.library.elements)) {   // a repeater's template keeps its own size
        for (const ch of this.nodes.filter(c => c.parentId === e.id)) {
          ch.attrs = clampNodeToContainer(ch, e, this.nodes, state.library.elements);
        }
      }
      const now = Date.now();
      if (!this.lastPatch || now - this.lastPatch > 900 || this.lastPatchId !== id) this.pushUndo(snap);
      this.lastPatch = now; this.lastPatchId = id;
      this.renderStage(); this.renderOverlay(); if (!quiet) this.emit('selection', this.selectedNodes());
      this.changed();
    } catch (err) { toast(err.message, 'error'); await this.reload(); }
  }

  async nudge(dx, dy) {
    const sel = this.selectedNodes().filter(e => !e.locked);
    if (!sel.length) return;
    const snapshot = this.snapshot();
    for (const e of sel) e.attrs = translateAttrs(e, dx, dy);
    this.renderStage(); this.renderOverlay(); this.checkDirty();   // the edit counts at once, it is stored a moment later
    clearTimeout(this.nudgeT);
    this.nudgeT = setTimeout(async () => {
      this.pushUndo(snapshot);
      try { await Promise.all(sel.map(e => api.patchNode(this.type, this.doc.id, e.id, { attrs: e.attrs }))); this.changed(); } catch (err) { toast(err.message, 'error'); await this.reload(); }
    }, 350);
  }

  /** Moves the selection onto one of the 9 reference points of the design's bounding box. */
  async placeSelected(anchor, margin = 0) {
    const sel = this.selectedNodes().filter(e => !e.locked);
    if (!sel.length) return toast('Select something first');
    const box = this.selectionBox(sel), at = placeAtAnchor({ w: box.w, h: box.h }, { w: this.doc.width, h: this.doc.height }, anchor, margin);
    const dx = at.x - box.x, dy = at.y - box.y;
    await this.mutate(async () => {
      await Promise.all(sel.map(async e => { const a = translateAttrs(e, dx, dy); const saved = await api.patchNode(this.type, this.doc.id, e.id, { attrs: a }); Object.assign(e, saved); }));
    });
  }

  async deleteSelected() {
    const sel = this.selectedNodes();
    if (!sel.length) return;
    this.vtx.exit();
    await this.mutate(async () => {
      for (const e of sel) await api.deleteNode(this.type, this.doc.id, e.id);
      await this.reload(false);
    });
  }

  async duplicateSelected() {
    const sel = this.selectedNodes();
    if (!sel.length) return;
    await this.mutate(async () => {
      const ids = [];
      for (const e of sel) ids.push((await api.duplicateNode(this.type, this.doc.id, e.id)).id);
      await this.reload(false);
      this.selected = new Set(ids);
    });
    this.renderOverlay(); this.emit('selection', this.selectedNodes());
  }

  /** z-order: 'front' | 'back' | 'up' | 'down' among siblings. */
  async reorder(where) {
    const sel = this.selectedNodes();
    if (!sel.length) return;
    const list = [...this.nodes].sort((a, b) => a.ord - b.ord || a.id - b.id);
    const ids = new Set(sel.map(e => e.id));
    let out;
    if (where === 'front') out = [...list.filter(e => !ids.has(e.id)), ...list.filter(e => ids.has(e.id))];
    else if (where === 'back') out = [...list.filter(e => ids.has(e.id)), ...list.filter(e => !ids.has(e.id))];
    else { out = [...list]; const dir = where === 'up' ? 1 : -1; const order = dir > 0 ? [...out.keys()].reverse() : [...out.keys()]; for (const i of order) { const j = i + dir; if (ids.has(out[i].id) && out[j] && !ids.has(out[j].id)) [out[i], out[j]] = [out[j], out[i]]; } }
    await this.mutate(async () => {
      this.doc = { ...(await api.replaceNodes(this.type, this.doc.id, out.map(e => ({ ...e })))) };
    });
  }

  /** Layers panel drag/keyboard reorder among siblings (`place` 'above' = in front of `targetId`); one replaceNodes request, undoable. */
  async moveLayer(dragId, targetId, place) { return this.saveLayerOrder(reorderLayer(this.nodes, dragId, targetId, place)); }
  async stepLayer(id, dir) { return this.saveLayerOrder(stepLayer(this.nodes, id, dir)); }
  async saveLayerOrder(out) {
    if (!out || this.layerSaving) return false;     // one reorder at a time: the next one builds on the saved order
    this.layerSaving = true;
    const snap = this.snapshot(), ord = new Map(out.map(n => [n.id, n.ord]));
    for (const n of this.nodes) if (ord.has(n.id)) n.ord = ord.get(n.id);   // show the new order right away
    this.renderAll();
    try {
      this.doc = { ...(await api.replaceNodes(this.type, this.doc.id, out.map(e => ({ ...e })))) };
      this.pushUndo(snap); this.renderAll(); this.changed();
      return true;
    } catch (e) { toast(e.message, 'error'); await this.reload(); return false; }
    finally { this.layerSaving = false; }
  }

  /* ================= animations (used by the inspector) ================= */
  animationsOf(nodeId) { return (this.doc.animations || []).filter(a => a.nodeId === nodeId); }

  async addAnimation(nodeId, type) {
    await this.mutate(async () => { const a = await api.addAnimation(this.type, this.doc.id, nodeId, defaultAnimation(type)); this.doc.animations.push(a); });
  }
  async updateAnimation(anim, patch) {
    try { const saved = await api.updateAnimation(this.type, this.doc.id, anim.id, patch); Object.assign(anim, saved); this.renderStage(); this.changed(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async removeAnimation(anim) {
    await this.mutate(async () => { await api.deleteAnimation(this.type, this.doc.id, anim.id); this.doc.animations = this.doc.animations.filter(a => a.id !== anim.id); });
  }

  /**
   * Updates the design record (name, key, label, description-dev, size ...). A size change scales the contents with the
   * bounding box (unless "Scale contents" is off): the server scales every sub node and we reload them.
   */
  async updateDoc(patch, { undo = null } = {}) {
    const sizing = patch.width !== undefined || patch.height !== undefined;
    const snap = undo || (sizing ? this.snapshot() : null);
    try {
      const body = sizing && this.boxResizable ? { scaleContent: this.scaleContent, ...patch } : patch;
      const saved = await api.updateDesign(this.type, this.doc.id, body);
      if (sizing && snap) this.pushUndo(snap);
      this.doc = { ...saved };
      this.renderAll();
      this.changed(); this.emit('record', this.doc);
    } catch (e) { toast(e.message, 'error'); await this.reload(); }
  }
}

/** Pointer capture keeps drags alive outside the canvas; it throws for synthetic events, which is harmless. */
function capture(el, ev) { try { el.setPointerCapture(ev.pointerId); } catch { /* no active pointer */ } }

installPathTools(Designer);
installTestActions(Designer);
