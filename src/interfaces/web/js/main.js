/** App shell: top menu bar, left panel (libraries/catalog), right panel (screen designer | workflow designer). */
import { h, clear, modal, toast, debounce, promptBox, $ } from './dom.js';
import { api } from './api.js';
import { state, on, emit } from './state.js';
import { reloadLibrary, applyThemeChrome, setTheme, updateSettings, newDesign, importSvgDialog, importFolderOrFontDialog, downloadSvg, openGuide, downloadGuide, setActiveProject } from './actions.js';
import { LibraryPanel } from './components/library-panel.js';
import { Designer } from './components/designer.js';
import { Inspector } from './components/inspector.js';
import { WorkflowDesigner } from './components/workflow-designer.js';
import { openExportDialog } from './components/export-dialog.js';
import { openThemeEditor } from './components/theme-editor.js';
import {
  openAuthModal,
  openAdminUsersModal,
  openProjectsModal,
  openChangesModal,
  openTemplatesModal,
  openEventsModal,
  openLineageModal,
  openSyncModal
} from './components/collab-modals.js';
import {
  ItemBrowserView,
  openItemBrowserModal,
  openTrashModal,
  openCopyMoveToProjectsModal,
  refreshGlobalLibraryAndCounts
} from './components/item-browser.js';

/**
 * Page history. Every design / workflow that is opened becomes a history entry (history.pushState), so the Back button of the
 * designers, Alt+← and the browser's own Back button all move to the previous page. `idx` is the position in that stack.
 */
const nav = { idx: 0, labels: [], restoring: false };

function recordView(mode, view, label) {
  if (mode === 'replace') nav.labels[nav.idx] = label;
  else { nav.idx += 1; nav.labels.length = nav.idx; nav.labels[nav.idx] = label; }
  history[mode === 'replace' ? 'replaceState' : 'pushState']({ view, idx: nav.idx, label }, '');
  updateBackButtons();
}
function updateBackButtons() { app.designer?.refreshBack(); app.workflow?.refreshBack(); }

const app = {
  designer: null, library: null, workflow: null, current: null,
  modals: [],     // designers open in dialogs (the last one is the active one)

  canBack: () => nav.idx > 0,
  backTarget: () => nav.labels[nav.idx - 1] || '',
  back() { if (nav.idx > 0) history.back(); else toast('There is no previous page'); },

  /** The document the Save / Save as / Reset commands act on: the dialog on top, else what the right panel shows. */
  activeDoc() { return this.modals.at(-1) || (state.mode === 'workflow' ? this.workflow : this.designer); },

  /**
   * Opens a design (path, icon, button, element or screen) in the main designer; the libraries on the left stay available for drag & drop.
   * If the design that is open has unsaved changes the user is asked first. `push`: true = new history entry, 'replace', false = from history.
   * Resolves true when the design is open.
   */
  async openDesign(type, id, { push = true } = {}) {
    if (this.current && this.current.type === type && Number(this.current.id) === Number(id) && this.designer.doc) { state.mode = 'screen'; renderMode(); return true; }
    if (!(await this.designer.confirmLeave())) return false;
    state.mode = 'screen'; renderMode();
    try {
      await this.designer.load(type, id); this.current = { type, id };
      const name = this.designer.doc.name;
      setStatus(`${type} "${name}" opened`);
      if (push) recordView(push === 'replace' ? 'replace' : 'push', { k: 'design', type, id: Number(id) }, `${type} "${name}"`);
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  },

  async openWorkflow(id, { push = true } = {}) {
    id = Number(id);
    const same = this.workflow.wf?.id === id;
    if (!same && !(await this.workflow.confirmLeave())) return false;
    state.mode = 'workflow'; state.workflowId = id; renderMode();
    this.library.renderBody();
    try {
      if (same) await this.workflow.refresh(); else await this.workflow.load(id);
      if (push && !same) recordView(push === 'replace' ? 'replace' : 'push', { k: 'workflow', id }, `workflow "${this.workflow.wf.name}"`);
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  },

  /** Goes to a history entry. Leaving the page that is on screen (even for the other kind of page) asks about its unsaved changes first. */
  async openView(view, opts) {
    const visible = state.mode === 'workflow' ? this.workflow : this.designer, target = view.k === 'workflow' ? this.workflow : this.designer;
    if (visible !== target && !(await visible.confirmLeave())) return false;
    return view.k === 'workflow' ? this.openWorkflow(view.id, opts) : this.openDesign(view.type, view.id, opts);
  },

  addInstance(type, id) {
    if (state.mode !== 'screen' || !this.designer.doc) return toast('Open a design first, then add to it', 'error');
    return this.designer.addInstance(type, id);
  },

  openScreenModal(id, onClose, opts) { return this.openModalDesigner('screen', id, 'Screen designer', onClose, opts); },

  /** A designer + inspector inside a modal (icon editor, screen editor from the workflow). */
  async openModalDesigner(type, id, title, onClose, opts = {}) {
    const root = h('div', { style: { display: 'flex', flex: 1, minHeight: 0, height: '100%' } });
    let d = null;
    // closing (✕, Esc, Close) asks about unsaved changes first
    const m = modal({ title, full: true, content: root, beforeClose: () => d.confirmLeave(), onClose: () => { this.modals = this.modals.filter(x => x !== d); onClose?.(); } });
    d = new Designer(root, { modal: true, onClose: () => m.requestClose(),
      openDesign: async (t, i) => {
        if (d.actionsLive && t === 'screen') {
          d._keepActionsLive = true;
          await d.load('screen', i);
          return;
        }
        if (await d.confirmLeave()) { m.close(); this.openDesign(t, i); }
      }
    });
    this.modals.push(d);
    new Inspector(d.inspectorEl, d);
    d.on('changed', debounce(() => { if (type !== 'screen') reloadLibrary({ silent: true }).then(() => { d.renderStage(); }); }, 500));
    try {
      await d.load(type, id);
      if (opts?.testActions) d.setTestActions(true);
    } catch (e) { toast(e.message, 'error'); m.close(); }
    return d;
  }
};

/** The guide topic that matches what is open: the designer's type, or the workflow designer. */
function guideTab() { return state.mode === 'workflow' ? 'workflow' : (app.designer?.doc ? app.designer.type : 'start'); }

function setStatus(msg) { const s = $('#status-msg'); if (s) s.textContent = msg; }

/* ---------- top bar ---------- */
async function insertPresetElement(key) {
  const el = state.library.elements.find(e => e.key === key);
  if (!el) return toast(`Element preset "${key}" not found`, 'error');
  if (state.mode === 'screen' && app.designer?.doc) {
    await app.designer.addInstance('element', el.id);
    toast(`Inserted "${el.name}" onto canvas`, 'ok');
  } else {
    await app.openDesign('element', el.id);
  }
}

function menuDef() {
  const s = state.settings, d = () => app.designer;
  const tick = v => (v ? '✓' : '');
  const curDoc = d()?.doc;
  const selOne = d()?.selectedNodes?.()[0] || null;
  return [
    ['Project', [
      ['Projects & Collaborators…', () => openProjectsModal()],
      ['Collaborative Change List (Approve / Reject)…', () => openChangesModal()],
      '-',
      ...(state.projects || []).map(p => [`${tick(p.id === state.activeProjectId)}|Project: ${p.name} (${p.visibility})`, () => setActiveProject(p.id)]),
      '-',
      ['Set Open Design to Public', async () => {
        if (!curDoc) return toast('Open a design first', 'error');
        await d().patchRecord({ visibility: 'public' });
        toast(`"${curDoc.name}" is now PUBLIC`, 'ok');
      }],
      ['Set Open Design to Project-Specific', async () => {
        if (!curDoc) return toast('Open a design first', 'error');
        await d().patchRecord({ visibility: 'project', projectId: state.activeProjectId });
        toast(`"${curDoc.name}" is now PROJECT-SPECIFIC`, 'ok');
      }],
      ['View Item Lineage & Root Owner…', () => curDoc ? openLineageModal(d().type, curDoc.id) : toast('Open a design first', 'error')],
      '-',
      ['Offline-First & PostgreSQL Sync…', () => openSyncModal('sync')],
      ['Multi-Language Translations (i18n)…', () => openSyncModal('i18n')]
    ]],
    ['Design', [
      ['New path…', async () => { const r = await newDesign('path'); if (r) app.openDesign('path', r.id); }],
      ['New icon…', async () => { const r = await newDesign('icon'); if (r) app.openDesign('icon', r.id); }],
      ['New button (from template)…', async () => { const r = await newDesign('button'); if (r) app.openDesign('button', r.id); }],
      ['New element…', async () => { const r = await newDesign('element'); if (r) app.openDesign('element', r.id); }],
      ['New screen (from device template)…', async () => { const r = await newDesign('screen'); if (r) app.openDesign('screen', r.id); }],
      ['New workflow…', async () => { state.tab = 'workflow'; app.library.renderTabs(); app.library.renderBody(); toast('Use “+ New workflow” in the Workflows tab'); }],
      '-',
      ['Import from SVG Folder to Current Library…', async () => { const r = await importFolderOrFontDialog(state.tab, 'folder'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      ['Import from Fonts (.svg / .ttf / .woff / Glyphs) to Current Library…', async () => { const r = await importFolderOrFontDialog(state.tab, 'font'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      ['Import SVG as path group…', async () => { const r = await importSvgDialog('path'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      ['Import SVG as icon…', async () => { const r = await importSvgDialog('icon'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      ['Import SVG as button…', async () => { const r = await importSvgDialog('button'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      ['Import SVG as element…', async () => { const r = await importSvgDialog('element'); if (r?.rec) app.openDesign(r.type, r.rec.id); }],
      '-',
      [`${tick(curDoc?.locked)}|Lock / Unlock Open Design Position`, async () => {
        if (!curDoc) return toast('Open a design first', 'error');
        await d().patchRecord({ locked: !curDoc.locked });
        toast(curDoc.locked ? 'Design locked' : 'Design unlocked', 'ok');
      }],
      ['Save', () => app.activeDoc()?.save(), 'Ctrl+S'],
      ['Save as (Clone with Root Owner Lineage)…', () => app.activeDoc()?.saveAs()],
      ['Reset to the last saved version', () => app.activeDoc()?.reset()],
      ['Back to the previous page', () => app.back(), 'Alt+←']
    ]],
    ['Edit', [
      ['Undo', () => d().undo(), 'Ctrl+Z'], ['Redo', () => d().redo(), 'Ctrl+Y'], '-',
      ['Edit vertices of the selected path', () => (d().selectedNodes().length === 1 ? d().vtx.enter(d().selectedNodes()[0]) : toast('Select one path or shape first')), 'Enter'], '-',
      ['Copy Selected Style', () => d().copySelectedStyle?.()],
      ['Paste Style onto Selected', () => d().pasteSelectedStyle?.()],
      ['Lock / Unlock Selected Element Position', () => d().toggleLockSelected?.(), 'Ctrl+L'],
      ['Array Duplicate (2×2 Grid)', () => d().arrayDuplicateSelected?.()],
      '-',
      ['Duplicate', () => d().duplicateSelected(), 'Ctrl+D'], ['Delete', () => d().deleteSelected(), 'Del'],
      ['Select all', () => d().select(d().els.filter(e => e.parentId == null && e.role !== 'bg' && e.role !== 'bg-glow').map(e => e.id)), 'Ctrl+A']
    ]],
    ['Insert', [
      ['Flip Box (3D Interactive Card)', () => insertPresetElement('html-flip-box')],
      ['Carousel Slider', () => insertPresetElement('html-carousel')],
      ['Small Element Floating Toolbar', () => insertPresetElement('html-floating-toolbar')],
      ['Record Viewer (List)', () => insertPresetElement('html-record-viewer-list')],
      ['Record Viewer (Grid)', () => insertPresetElement('html-record-viewer-grid')],
      ['Choice Chips Bar', () => insertPresetElement('html-choice-chips')],
      ['Multi-Choice Question Card', () => insertPresetElement('html-multi-choice')],
      ['Dropdown Menu Panel', () => insertPresetElement('html-dropdown-menu')],
      ['Drag & Drop Canvas Zone', () => insertPresetElement('html-drag-drop-zone')],
      ['Bottom Sheet Drawer', () => insertPresetElement('html-bottom-sheet')],
      ['Audio / Media Player', () => insertPresetElement('html-audio-player')],
      ['Calendar Date Picker', () => insertPresetElement('html-calendar-picker')],
      ['Color Swatch Picker', () => insertPresetElement('html-color-picker')],
      ['Chat / Comment Bubble', () => insertPresetElement('html-chat-bubble')],
      ['AdMob Smart Banner', () => insertPresetElement('html-admob-banner')],
      '-',
      ['Editable Button Templates…', () => openTemplatesModal('buttons')],
      ['Editable Device Templates…', () => openTemplatesModal('devices')]
    ]],
    ['Tools', [
      ['Select / Move Tool', () => d().setTool('select'), 'V'],
      ['Rectangle Tool', () => d().setTool('rect'), 'R'],
      ['Circle Tool', () => d().setTool('circle'), 'C'],
      ['Ellipse Tool', () => d().setTool('ellipse'), 'E'],
      ['Polygon (Hexagon) Tool', () => d().setTool('polygon'), 'G'],
      ['Star Tool', () => d().setTool('star'), 'W'],
      ['Arrow Tool', () => d().setTool('arrow'), 'A'],
      ['Callout Bubble Tool', () => d().setTool('callout'), 'Q'],
      ['Freehand Pencil Tool', () => d().setTool('freehand'), 'F'],
      ['Line Tool', () => d().setTool('line'), 'L'],
      ['Text Tool', () => d().setTool('text'), 'T'],
      ['Path Data Tool', () => d().setTool('path'), 'P'],
      ['Pen Bezier Tool', () => d().setTool('pen'), 'B'],
      ['Crop Tool', () => d().setTool('crop'), 'X'],
      '-',
      ['Lock / Unlock Selected Position', () => d().toggleLockSelected?.(), 'Ctrl+L'],
      ['Copy Style from Selected', () => d().copySelectedStyle?.()],
      ['Paste Style to Selected', () => d().pasteSelectedStyle?.()]
    ]],
    ['Path', [
      ['Edit vertices', () => (d().selectedNodes().length === 1 ? d().vtx.enter(d().selectedNodes()[0]) : toast('Select one path or shape first')), 'Enter'],
      ['Pen tool (draw bezier curves)', () => d().setTool('pen'), 'B'],
      ['Crop tool (drag a rectangle)', () => d().setTool('crop'), 'X'], '-',
      ['Union', () => d().pathfinder('union')], ['Cut out (top shape from the shapes behind)', () => d().pathfinder('subtract')],
      ['Crop / intersect', () => d().pathfinder('intersect')], ['Exclude', () => d().pathfinder('exclude')], ['Crop to bounding box', () => d().cropToBox()], '-',
      ['Combine paths', () => d().combineSelected()], ['Break apart', () => d().breakApartSelected()], ['Join open paths', () => d().joinSelected()],
      ['Reverse direction', () => d().reverseSelected()], ['Simplify', () => d().simplifySelected()], ['Apply transform to points', () => d().bakeSelected()], '-',
      ['Group', () => d().groupSelected(), 'Ctrl+G'], ['Ungroup', () => d().ungroupSelected(), 'Ctrl+Shift+G'], '-',
      ['Align left', () => d().alignSelected('left')], ['Align horizontal centres', () => d().alignSelected('hcenter')], ['Align right', () => d().alignSelected('right')],
      ['Align top', () => d().alignSelected('top')], ['Align vertical centres', () => d().alignSelected('vmiddle')], ['Align bottom', () => d().alignSelected('bottom')],
      ['Distribute horizontally', () => d().distributeSelected('h')], ['Distribute vertically', () => d().distributeSelected('v')], '-',
      ['Flip horizontally', () => d().flipSelected('h')], ['Flip vertically', () => d().flipSelected('v')], ['Rotate 90° clockwise', () => d().rotateSelected(90)], ['Rotate 90° counter-clockwise', () => d().rotateSelected(-90)]
    ]],
    ['Events & Anim', [
      ['Configure Events on Selected (click, mouseover, release, drag&drop)…', () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        openEventsModal({ node: selOne, docType: d().type, docId: curDoc.id, onSave: patch => d().patchNode(selOne.id, patch) });
      }],
      ['Attach Small Element Floating Toolbar to Selected', async () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        const tbEl = state.library.elements.find(e => e.key === 'html-floating-toolbar');
        const evs = [...(selOne.events || []).filter(e => e.trigger !== 'mouseover'), { trigger: 'mouseover', type: 'toolbar', ...(tbEl ? { targetId: tbEl.id } : {}), position: 'top' }];
        await d().patchNode(selOne.id, { events: evs });
        toast('Attached mouse-over small element toolbar', 'ok');
      }],
      ['Quick Add Flip 3D Animation to Selected', async () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        await api.addAnimation(d().type, curDoc.id, selOne.id, { name: 'flip-3d', type: 'flip', durationMs: 650, trigger: 'click', params: { deg: 180 } });
        await d().reload();
        toast('Added 3D Flip animation', 'ok');
      }],
      ['Quick Add Pulse Animation to Selected', async () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        await api.addAnimation(d().type, curDoc.id, selOne.id, { name: 'pulse', type: 'pulse', durationMs: 1200, iterations: 'infinite', trigger: 'load', params: { scale: 1.08 } });
        await d().reload();
        toast('Added Pulse animation', 'ok');
      }],
      ['Quick Add Float Animation to Selected', async () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        await api.addAnimation(d().type, curDoc.id, selOne.id, { name: 'float', type: 'float', durationMs: 1800, iterations: 'infinite', trigger: 'load', params: { dy: -8 } });
        await d().reload();
        toast('Added Float animation', 'ok');
      }],
      ['Quick Add Glow Animation to Selected', async () => {
        if (!selOne) return toast('Select an element on the canvas first', 'error');
        await api.addAnimation(d().type, curDoc.id, selOne.id, { name: 'glow', type: 'glow', durationMs: 1500, iterations: 'infinite', trigger: 'load', params: { radius: 8 } });
        await d().reload();
        toast('Added Glow animation', 'ok');
      }],
      '-',
      [`${tick(state.mode === 'workflow' ? app.workflow?.testMode : d()?.actionsLive)}|▶ Test Actions Mode (Buttons, Elements, Screens, Workflows)`, () => {
        if (state.mode === 'workflow') app.workflow?.setTestMode(!app.workflow.testMode);
        else d()?.setTestActions(!d().actionsLive);
      }],
      [`${tick(state.playAnimations)}|Play Animations Live`, () => { state.playAnimations = !state.playAnimations; d().renderStage(); }]
    ]],
    ['Collaborate', [
      ['Collaborative Change List (Approve / Reject)…', () => openChangesModal()],
      ['Projects & Collaborator Invitations…', () => openProjectsModal()],
      ['Admin & User Management Panel (ACL)…', () => openAdminUsersModal()],
      ['Sign In / Register / Switch Account…', () => openAuthModal()],
      '-',
      ['Editable Button & Device Templates…', () => openTemplatesModal('buttons')],
      ['Offline-First & PostgreSQL Sync…', () => openSyncModal('sync')],
      ['Multi-Language Translations (i18n)…', () => openSyncModal('i18n')]
    ]],
    ['View', [
      ['Zoom in', () => d().zoomBy(1.25), '+'], ['Zoom out', () => d().zoomBy(1 / 1.25), '-'], ['Fit to window', () => d().fit(), '0'], ['Actual size', () => d().setZoom(1)], '-',
      [`${tick(s.showGrid)}|Show grid`, () => updateSettings({ showGrid: !s.showGrid }).then(() => d().renderOverlay())],
      [`${tick(s.snapToGrid)}|Snap to grid`, () => updateSettings({ snapToGrid: !s.snapToGrid })],
      [`${tick(s.snapToAnchors)}|Snap to the 9 reference points`, () => updateSettings({ snapToAnchors: !s.snapToAnchors }).then(() => d().renderOverlay())],
      [`${tick(state.playAnimations)}|Play animations`, () => { state.playAnimations = !state.playAnimations; d().renderStage(); }], '-',
      ['Grid size…', async () => { const v = Number(await promptBox('Grid size', { label: 'Grid size in px', value: String(s.grid), okLabel: 'Apply' })); if (v > 0) { await updateSettings({ grid: v }); d().renderOverlay(); } }],
      ['Toggle left panel', () => toggleLeft()],
      ['Toggle inspector', () => { const x = d(); x.inspectorOpen = !x.inspectorOpen; x.inspectorEl.classList.toggle('collapsed', !x.inspectorOpen); }]
    ]],
    ['Theme', [
      ...state.themes.map(t => [`${tick(t.key === state.themeKey)}|${t.name}`, () => setTheme(t.key)]), '-',
      ['Edit themes…', () => openThemeEditor()]
    ]],
    ['Export', [
      ['Export open design as SVG (with animation)', () => app.current ? downloadSvg(app.current.type, app.current.id) : toast('Open a design first', 'error')],
      ['Export usage guide (usage-and-guide.html)', () => downloadGuide()],
      ['Export selected screens…', () => openExportDialog({ screenIds: state.catalogSel.size ? [...state.catalogSel] : 'all' })],
      ['Export all screens…', () => openExportDialog({ screenIds: 'all' })]
    ]],
    ['Trash', [
      ['🗑 Trash Management (Restore / Purge)…', () => openTrashModal()],
      ['🗂 Open 90% Item Browser Modal (Copy / Move)…', () => openItemBrowserModal()],
      ['🗂 Center Canvas Full Item Browser', () => { state.mode = 'browser'; renderMode(); }],
      '-',
      ['🧹 Empty Active Project Private Library…', async () => {
        const pid = state.activeProjectId || 1;
        try {
          const res = await api.emptyProjectLibrary(pid, { itemType: 'all' });
          await refreshGlobalLibraryAndCounts();
          toast(`Emptied ${res.emptiedCount} private item(s) to Trash`, 'ok');
        } catch (err) {
          toast(err.message, 'error');
        }
      }]
    ]],
    ['Help', [['Usage and guide…', () => openGuide(guideTab()), 'F1'], ['Download usage-and-guide.html', () => downloadGuide()], '-', ['Keyboard shortcuts', () => showShortcuts()], ['About', () => modal({ title: 'About', content: h('div', {}, h('p', {}, 'Kyrpy UI/UX App Designer · Offline-First SQLite + PostgreSQL Collaborative Edition.'), h('p', { class: 'muted' }, 'Project-based designs (public & project visibility), User & ACL Management (default root owner @kyrpy), Root Lineage tracking, Collaborative Change Approval/Rejection, Multi-Events (click, mouseover, release, drag&drop), Small Element Toolbars, Editable Templates, and bi-directional PostgreSQL sync (kyrpy-uiux-designer-db).')) })]]]
  ];
}

function buildProjectsMultiDropdown() {
  const projects = state.projects?.length
    ? state.projects
    : [{ id: 1, name: 'Default Public Project', visibility: 'public' }];
  const activeProj = projects.find(p => Number(p.id) === Number(state.activeProjectId)) || projects[0];
  const selCount = state.selectedProjectIds?.size || 0;
  const labelText = selCount > 0
    ? `📁 ${activeProj.name} (${selCount} sel)`
    : `📁 ${activeProj.name}`;

  const panel = h('div', {
    class: 'menu-panel proj-multi-panel',
    role: 'menu',
    style: { minWidth: '280px', padding: '8px' },
    onclick: e => e.stopPropagation()
  });

  const ddWrap = h('div', { class: 'menu proj-multi-dd' });
  const triggerBtn = h('button', {
    class: 'btn sm proj-multi-trigger',
    title: 'Multi-select projects to filter libraries, switch active project, or create a new project',
    'aria-haspopup': 'true',
    onclick: e => {
      e.stopPropagation();
      const open = !ddWrap.classList.contains('open');
      closeMenus();
      if (open) {
        ddWrap.classList.add('open');
        rebuildDropdown();
      }
    }
  }, `${labelText} ▾`);

  const rebuildDropdown = () => {
    clear(panel);
    panel.append(
      h('div', { class: 'row spread', style: { padding: '2px 4px 6px', borderBottom: '1px solid var(--line)', marginBottom: '6px' } },
        h('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '700' } }, 'PROJECTS (Multi-Select & Active)'),
        h('div', { class: 'row', style: { gap: '4px' } },
          h('button', {
            class: 'btn small',
            onclick: () => {
              projects.forEach(p => state.selectedProjectIds.add(Number(p.id)));
              rebuildDropdown();
              emit('project:changed', state.activeProjectId);
            }
          }, 'All'),
          h('button', {
            class: 'btn small',
            onclick: () => {
              state.selectedProjectIds.clear();
              rebuildDropdown();
              emit('project:changed', state.activeProjectId);
            }
          }, 'Clear')
        )
      )
    );

    for (const p of projects) {
      const pid = Number(p.id);
      const isChecked = state.selectedProjectIds.has(pid);
      const isActive = pid === Number(state.activeProjectId);
      const chk = h('input', {
        type: 'checkbox',
        checked: isChecked,
        title: 'Include this project’s private items in multi-project filter',
        onchange: () => {
          if (chk.checked) state.selectedProjectIds.add(pid);
          else state.selectedProjectIds.delete(pid);
          emit('project:changed', state.activeProjectId);
        }
      });
      panel.append(
        h('div', {
          class: `row spread proj-dd-row${isActive ? ' active' : ''}`,
          style: {
            padding: '5px 6px',
            borderRadius: '6px',
            background: isActive ? 'rgba(46,155,255,0.14)' : 'transparent',
            gap: '6px'
          }
        },
        chk,
        h('button', {
          class: 'grow',
          style: {
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontWeight: isActive ? '700' : '500',
            fontSize: '12px'
          },
          title: 'Click to set as active project',
          onclick: async () => {
            await setActiveProject(pid);
            closeMenus();
          }
        }, `${p.visibility === 'private' || p.visibility === 'project' ? '📁' : '🌐'} ${p.name}`),
        isActive ? h('span', { class: 'badge', style: { fontSize: '9px' } }, 'ACTIVE') : null
        )
      );
    }

    panel.append(
      h('div', { class: 'menu-sep', style: { margin: '6px 0' } }),
      h('div', { class: 'row spread', style: { gap: '6px' } },
        h('button', {
          class: 'btn sm primary grow create-new-project-btn',
          onclick: async () => {
            closeMenus();
            const name = await promptBox('Create New Project', { value: 'New UI Project', label: 'Project Name', okLabel: 'Create Project' });
            if (!name?.trim()) return;
            try {
              const created = await api.createProject({ name: name.trim(), visibility: 'private' });
              state.projects = await api.projects();
              state.selectedProjectIds.add(created.id);
              await setActiveProject(created.id);
              buildTopbar();
              toast(`Project "${created.name}" created`, 'ok');
            } catch (err) {
              toast(err.message, 'error');
            }
          }
        }, '+ Create New Project'),
        h('button', {
          class: 'btn sm',
          onclick: () => { closeMenus(); openProjectsModal(); }
        }, '⚙ Manage')
      )
    );
  };

  ddWrap.append(triggerBtn, panel);
  return ddWrap;
}

function buildTopbar() {
  const bar = $('#topbar'); clear(bar);
  bar.append(h('div', { class: 'brand' }, h('span', { style: { color: '#2e9bff' } }, '◈'), 'UI/UX Designer'));
  for (const [title, items] of menuDef()) {
    const panel = h('div', { class: 'menu-panel', role: 'menu' });
    const m = h('div', { class: 'menu' }, h('button', { 'aria-haspopup': 'true', onclick: e => { e.stopPropagation(); const open = !m.classList.contains('open'); closeMenus(); if (open) { m.classList.add('open'); rebuildPanel(); } } }, title), panel);
    const rebuildPanel = () => {
      clear(panel);
      for (const it of menuDef().find(x => x[0] === title)[1]) {
        if (it === '-') { panel.append(h('div', { class: 'menu-sep' })); continue; }
        const [label, fn, kbd] = it; const [t, l] = label.includes('|') ? label.split('|') : ['', label];
        panel.append(h('button', { class: 'menu-item', role: 'menuitem', disabled: !fn, onclick: () => { closeMenus(); try { fn?.(); } catch (e) { toast(e.message, 'error'); } } }, h('span', { class: 'tick' }, t), l, kbd ? h('span', { class: 'kbd' }, kbd) : null));
      }
    };
    bar.append(m);
  }

  // Multi-selection Projects dropdown with "+ Create New Project" button
  const projDropdown = buildProjectsMultiDropdown();

  // Trash Management button
  const trashBtn = h('button', {
    class: 'btn sm topbar-trash-btn',
    title: 'Trash Management — Restore or permanently purge deleted items',
    onclick: () => openTrashModal()
  }, `🗑 Trash (${state.trashCount || 0})`);

  // Pending Collaborative Changes button
  const changesBtn = h('button', {
    class: `btn sm${state.pendingChangesCount > 0 ? ' primary' : ''}`,
    title: 'Collaborative Change List (Approve / Reject)',
    onclick: () => openChangesModal()
  }, `⇄ Changes (${state.pendingChangesCount || 0})`);

  // PostgreSQL Sync button
  const syncBtn = h('button', {
    class: 'btn sm',
    title: 'Offline-First Local SQLite + PostgreSQL Sync (kyrpy-uiux-designer-db)',
    onclick: () => openSyncModal('sync')
  }, '⇅ PG Sync');

  // User / Admin button
  const curUser = state.user || { username: 'kyrpy', role: 'admin' };
  const userBtn = h('button', {
    class: 'btn sm',
    title: `Signed in as @${curUser.username} (${curUser.role}) — Click to switch account or open Admin ACL panel`,
    onclick: () => openAuthModal()
  }, `👤 @${curUser.username} (${curUser.role})`);

  const themeSel = h('select', { title: 'Theme', 'aria-label': 'Theme' }, state.themes.map(t => h('option', { value: t.key, selected: t.key === state.themeKey }, t.name)));
  themeSel.addEventListener('change', () => setTheme(themeSel.value));
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { class: state.mode === 'screen' ? 'on' : '', onclick: () => { state.mode = 'screen'; renderMode(); buildTopbar(); } }, 'Screen designer'),
    h('button', { class: state.mode === 'workflow' ? 'on' : '', onclick: async () => { const id = state.workflowId || app.library.workflows[0]?.id; if (!id) { toast('Create a workflow in the Workflows tab first'); return; } await app.openWorkflow(id); buildTopbar(); } }, 'Workflow designer'),
    h('button', { class: state.mode === 'browser' ? 'on' : '', dataset: { modeTab: 'browser' }, title: 'Center Canvas Full Item Browser with checkboxes per item', onclick: () => { state.mode = 'browser'; renderMode(); buildTopbar(); } }, '🗂 Item Browser')
  );
  bar.append(h('div', { class: 'top-right' }, projDropdown, trashBtn, changesBtn, syncBtn, userBtn, tabs, themeSel));
}
const closeMenus = () => document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
document.addEventListener('click', closeMenus);
document.addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); openGuide(guideTab()); }
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); app.activeDoc()?.save(); }   // Alt+← is the browser's own Back, handled by the history
});
window.addEventListener('beforeunload', e => { if (app.designer?.dirty || app.workflow?.dirty || app.modals.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('popstate', async e => {
  if (nav.restoring) { nav.restoring = false; return; }
  const st = e.state;
  if (!st?.view) return;
  const delta = st.idx - nav.idx;
  const ok = await app.openView(st.view, { push: false });
  if (ok) { nav.idx = st.idx; nav.labels[st.idx] = st.label; updateBackButtons(); }
  else if (delta) { nav.restoring = true; history.go(-delta); }   // the user cancelled (unsaved changes) or it no longer exists: stay where we were
});

function showShortcuts() {
  const rows = [['V R C L T P', 'select / rectangle / circle / line / text / path-data tool'], ['B', 'pen tool: click = corner, click-drag = curve, click the first point = close, Enter / right-click = finish, Backspace = undo last point'], ['X', 'crop tool: drag a rectangle over the selected shapes'],
    ['Right-click on a path line · on a vertex', 'add a vertex · remove it (in vertex mode)'], ['S / K / C', 'selected vertex: smooth / corner / line⇄curve'], ['Ctrl+G · Ctrl+Shift+G', 'group · ungroup'], ['Wheel', 'zoom at the cursor (infinite)'], ['Space + drag · middle drag', 'pan'], ['Click · Shift+click', 'select · add to selection'],
    ['Alt+click', 'select the exact element inside a group'], ['Ctrl+drag', 'move/resize without snapping'], ['Arrows · Shift+arrows', 'nudge 1 px · nudge one grid step'], ['Del', 'delete selection'],
    ['Ctrl+D', 'duplicate'], ['Ctrl+S', 'save (the Save button blinks while there are unsaved changes)'], ['Alt+←', 'back to the previous page'], ['Ctrl+Z · Ctrl+Y', 'undo · redo'], ['Ctrl+A', 'select all'], ['+ − 0', 'zoom in · out · fit'], ['Double-click text', 'edit the text'], ['Drag from Icons/Items', 'add to the open screen/item (or double-click a cell)']];
  modal({ title: 'Keyboard shortcuts', content: h('table', { class: 'help-table' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))) });
}

/* ---------- layout ---------- */
function toggleLeft() { const l = $('#left'); l.classList.toggle('collapsed'); if (!l.classList.contains('collapsed')) l.style.width = `${state.settings.leftPanelWidth || 360}px`; }

function bindSplitter() {
  const sp = $('#split-left'), left = $('#left');
  sp.addEventListener('pointerdown', ev => {
    sp.setPointerCapture(ev.pointerId);
    const startX = ev.clientX, startW = left.getBoundingClientRect().width;
    const mv = e => { left.classList.remove('collapsed'); left.style.width = `${Math.min(720, Math.max(220, startW + e.clientX - startX))}px`; };
    const up = () => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); updateSettings({ leftPanelWidth: Math.round(left.getBoundingClientRect().width) }); app.designer?.fit(); };
    sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('dblclick', toggleLeft);
}

function renderMode() {
  const dz = $('#dz-root'), wf = $('#wf-root'), br = $('#browser-root');
  dz.style.display = state.mode === 'screen' ? 'flex' : 'none';
  wf.style.display = state.mode === 'workflow' ? 'flex' : 'none';
  if (br) {
    br.style.display = state.mode === 'browser' ? 'flex' : 'none';
    if (state.mode === 'browser') app.browser?.refresh();
  }
  if (state.mode === 'screen') requestAnimationFrame(() => app.designer?.fit?.());
  buildTopbar();
}

async function boot() {
  const b = await api.bootstrap();
  state.settings = b.settings; state.themes = b.themes; state.devices = b.devices; state.counts = b.counts; state.themeKey = b.settings.theme;
  state.trashCount = b.trashCount ?? b.counts?.trash ?? 0;
  if (!state.themes.find(t => t.key === state.themeKey)) state.themeKey = state.themes[0].key;
  applyThemeChrome();
  $('#left').style.width = `${state.settings.leftPanelWidth || 360}px`;
  const right = $('#right');
  right.append(
    h('div', { id: 'dz-root', class: 'dz', style: { display: 'flex' } }),
    h('div', { id: 'wf-root', class: 'wf', style: { display: 'none' } }),
    h('div', { id: 'browser-root', class: 'ib-root', style: { display: 'none', flex: '1', flexDirection: 'column', padding: '12px', overflow: 'hidden' } })
  );
  $('#statusbar').append(h('span', { id: 'status-msg' }, 'ready'), h('span', { id: 'statusbar-xy', class: 'dim' }), h('span', { class: 'grow' }), h('span', { id: 'status-counts', class: 'dim' }));
  await reloadLibrary({ silent: true });
  app.designer = new Designer($('#dz-root'), { openDesign: (t, i) => app.openDesign(t, i), onBack: () => app.back(), canBack: app.canBack, backTarget: app.backTarget });
  new Inspector(app.designer.inspectorEl, app.designer);
  app.workflow = new WorkflowDesigner($('#wf-root'), app);
  app.browser = new ItemBrowserView($('#browser-root'));
  app.library = new LibraryPanel($('#left'), app);
  buildTopbar(); bindSplitter();

  const refreshCounts = () => {
    const c = state.counts;
    const pName = (state.projects || []).find(p => Number(p.id) === Number(state.activeProjectId))?.name || 'Default';
    $('#status-counts').textContent = `project: ${pName} · user: @${state.user?.username || 'kyrpy'} (${state.user?.role || 'admin'}) · ${c.paths} paths · ${c.icons} icons · ${c.buttons} buttons · ${c.elements} elements · ${c.screens} screens · ${c.workflows} workflows · trash: ${state.trashCount || 0} · pending changes: ${state.pendingChangesCount || 0} · theme: ${state.themeKey}`;
  };
  on('library:changed', () => { refreshCounts(); buildTopbar(); });
  on('trash:changed', () => { refreshCounts(); buildTopbar(); });
  on('project:list-changed', () => { refreshCounts(); buildTopbar(); });
  on('mode:set', m => { state.mode = m; renderMode(); });
  on('designer:open', ({ type, id }) => app.openDesign(type, id));
  on('workflow:select', id => app.openWorkflow(id));
  on('auth:changed', () => { refreshCounts(); buildTopbar(); });
  on('project:changed', () => { refreshCounts(); buildTopbar(); app.library.renderBody(); });
  on('change:reviewed', async () => {
    refreshCounts();
    buildTopbar();
    if (app.current && app.designer?.doc) await app.designer.reload();
  });
  on('theme:changed', () => { refreshCounts(); buildTopbar(); app.designer.doc && app.designer.renderAll(); if (state.mode === 'workflow' && app.workflow.wf) app.workflow.refresh(); });
  on('workflows:changed', async () => { await app.library.loadWorkflows(); refreshCounts(); });
  on('settings:changed', () => app.designer.renderOverlay());
  on('design:deleted', ({ type, id }) => { if (app.current && app.current.type === type && app.current.id === id) { app.current = null; app.designer.doc = null; app.designer.baseline = null; app.designer.dirty = false; app.designer.updateDocBar(); clear(app.designer.stage); app.designer.renderOverlay(); toast('The open design was deleted'); } });
  refreshCounts();

  // thumbnails of the catalog follow edits of the open screen
  const bump = debounce(() => { app.library.invalidateScreens(); }, 1200);
  app.designer.on('changed', () => { bump(); if (app.designer.type !== 'screen') reloadLibrary({ silent: true }).then(() => app.designer.renderStage()); });
  app.designer.on('record', () => app.library.invalidateScreens());

  // after a page reload the browser still has our history entry: open that page again, else open a first screen so the canvas is not empty
  const hs = history.state;
  if (hs?.view) { nav.idx = hs.idx; nav.labels[hs.idx] = hs.label; if (!(await app.openView(hs.view, { push: false }))) history.replaceState(null, ''); }
  if (!app.current && state.mode !== 'workflow') {
    const screens = await api.list('screen');
    const first = screens.find(s => s.key === 'scan-list') || screens[0];
    if (first) await app.openDesign('screen', first.id, { push: 'replace' });
  }
  updateBackButtons();
  window.__app = app;   // handy in the console
}

boot().catch(e => { console.error(e); document.body.prepend(h('pre', { style: { color: '#f66', padding: '20px' } }, `Failed to start: ${e.message}`)); });
