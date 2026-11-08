/** App shell: top menu bar, left panel (libraries/catalog), right panel (screen designer | workflow designer). */
import { h, clear, modal, toast, debounce, promptBox, confirmBox, contextMenu, $ } from './dom.js';
import { api, ApiError, setWriteGuard } from './api.js';
import { state, on, emit, projectLabel, PLURAL, findDesign, isPublicLibraryItem, isSuperadminUser } from './state.js';
import { reloadLibrary, applyThemeChrome, setTheme, updateSettings, newDesign, importSvgDialog, importFolderOrFontDialog, downloadSvg, downloadProjectHtml, openGuide, downloadGuide, setActiveProject, createEmptyItem, DEFAULT_PROJECT_ID, ownProjects, needsFirstProject, pickStartupProject } from './actions.js';
import { LibraryPanel } from './components/library-panel.js';
import { Designer } from './components/designer.js';
import { Inspector } from './components/inspector.js';
import { WorkflowDesigner } from './components/workflow-designer.js';
import { openExportDialog } from './components/export-dialog.js';
import { openThemeEditor } from './components/theme-editor.js';
import { pairThemeKey } from '/domain/theme.js';
import { iconEl, iconForLabel, ibtn } from './icons.js';
import { healthIndicators } from './health-status.js';

// icon for each top-level menu header (tooltip = the menu name)
const MENU_ICONS = { Project: 'file', Design: 'design', Edit: 'edit', Insert: 'insert', Tools: 'tools', Path: 'path', 'Events & Anim': 'events', Collaborate: 'collab', View: 'view', Theme: 'theme', Export: 'export', Trash: 'trash', Help: 'help' };
// icon-only topbar button with a hover tooltip and optional count badge
/** Profile → AI Access Keys (MCP layer module, loaded on demand from src/mcp/interfaces/web). */
/** Topbar profile icon → My Profile page (details, password, sessions, activity). */
const openProfile = (opts) => import('./components/profile-page.js').then(m => m.openProfilePage(opts)).catch(e => toast(`Profile: ${e.message}`, 'error'));
const openAiKeys = () => import('/mcp-web/ai-keys-modal.js').then(m => m.openAiKeysModal()).catch(e => toast(`AI Access Keys: ${e.message}`, 'error'));
/** Collaborate → Versions & AI Changesets (MCP layer module, M4). */
const downloadAppExport = () => import('/mcp-web/versions-modal.js').then(m => m.downloadProjectApp()).catch(e => toast(`App export: ${e.message}`, 'error'));
const openVersions = (opts) => import('/mcp-web/versions-modal.js').then(m => m.openVersionsModal(opts)).catch(e => toast(`Versions: ${e.message}`, 'error'));
const tbIcon = (cls, icon, tip, onclick, badge = 0, on = false) => h('button', {
  class: `btn sm tb-icon ${cls}${on ? ' primary' : ''}`.trim(),
  'aria-label': tip, 'data-tip': tip, onclick
}, iconEl(icon, { size: 17 }), badge ? h('span', { class: 'tb-badge' }, String(badge)) : null);
import {
  openAuthModal,
  ensureAuthGate,
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
  openLibraryExportImportModal,
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
  const activeD = app.modals.length ? app.modals[app.modals.length - 1] : app.designer;
  if (activeD?.doc && ['screen', 'element'].includes(activeD.type)) {
    if (!app.modals.length && state.mode !== 'screen') { state.mode = 'screen'; renderMode(); }
    await activeD.addInstance('element', el.id);
    toast(`Inserted "${el.name}" onto canvas`, 'ok');
  } else {
    await app.openDesign('element', el.id);
  }
}

/**
 * First-edit rule: a user with no project of their own is working in the shared Default Public Project. Before the
 * first create / edit / delete they have to name a project of their own; the open design is copied into it and
 * opened there, and the edit that triggered the prompt is not applied (the caller shows the message below).
 */
let firstProjectFlow = null;
/**
 * Public-library rule: only the superadmin edits public items in place. When anyone else drops / edits on one, the
 * edit is not applied; the Save as… button blinks and a popup asks where the copy goes (own projects + Global Private
 * Library). The copy is saved and opened, so the user can repeat the edit there.
 */
let publicEditFlow = null;
const SINGULAR = Object.fromEntries(Object.entries(PLURAL).map(([k, v]) => [v, k]));
function targetedPublicItem(url) {
  const m = /^\/api\/(paths|icons|buttons|elements|screens|workflows)\/(\d+)/.exec(String(url));
  if (!m) return null;
  const type = SINGULAR[m[1]];
  const doc = app.designer?.doc;
  const rec = !type ? null : (doc && app.designer.type === type && Number(doc.id) === Number(m[2]) ? doc : findDesign(type, Number(m[2])));
  return rec && isPublicLibraryItem(rec) && !isSuperadminUser() ? { type, rec } : null;
}
function chooseSaveTargets(rec) {
  return new Promise(resolve => {
    const own = ownProjects();
    const active = Number(state.activeProjectId || DEFAULT_PROJECT_ID);
    const picked = new Set(own.filter(p => Number(p.id) === active).map(p => Number(p.id)));
    let priv = picked.size === 0;   // no active project of the user's: default to the private library
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const box = (label, checked, on) => h('label', { class: 'target-row', style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' } },
      h('input', { type: 'checkbox', checked, onchange: e => on(e.target.checked) }), label);
    const m = modal({
      title: 'Save as… — choose where to save',
      onClose: () => finish(null),
      content: h('div', {},
        h('p', {}, `"${rec.name}" belongs to the public library, which only the superadmin can change. Save your own copy (with all sub-items) to:`),
        box('🗂 All Projects (my global library)', priv, v => { priv = v; }),
        ...(own.length ? [h('b', {}, 'My projects')] : [h('p', { class: 'muted' }, 'You have no projects yet: the copy goes to your private library.')]),
        ...own.map(p => box(p.name, picked.has(Number(p.id)), v => { v ? picked.add(Number(p.id)) : picked.delete(Number(p.id)); }))),
      actions: close => [
        h('button', { class: 'btn', onclick: () => { finish(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => {
          if (!priv && !picked.size) { toast('Pick at least one target', 'warn'); return; }
          finish({ projectIds: [...picked], includeUserPrivate: priv }); close();
        } }, 'Save as')]
    });
    return m;
  });
}
async function publicEditGuard(url) {
  const hit = targetedPublicItem(url);
  if (!hit) return;
  const btn = app.designer?.saveAsBtn;
  btn?.classList.add('attn');
  publicEditFlow ||= (async () => {
    const pick = await chooseSaveTargets(hit.rec);
    if (!pick) return { cancelled: true };
    const res = await api.saveToTargets({ type: hit.type, id: hit.rec.id, name: hit.rec.name, projectIds: pick.projectIds,
      visibility: pick.projectIds.length ? 'project' : 'private', includeUserPrivate: pick.includeUserPrivate, restoreBaseline: null });
    const copy = res.primaryCopy || res.copied?.[0]?.item;
    await reloadLibrary({ silent: true });
    if (copy?.id) await app.openDesign(hit.type, copy.id);
    return { copy, count: res.savedCount };
  })().finally(() => { btn?.classList.remove('attn'); setTimeout(() => { publicEditFlow = null; }, 0); });
  const r = await publicEditFlow;
  throw new ApiError(r.cancelled
    ? 'This item belongs to the public library: use Save as… to edit your own copy.'
    : `Saved your own copy (${r.count} target(s)); you are now editing it. Your last change was not applied: do it again here.`);
}

async function firstProjectGuard({ url } = {}) {
  if (!needsFirstProject()) return publicEditGuard(url);
  firstProjectFlow ||= (async () => {
    const name = await promptBox('Create your first project', {
      value: 'My first project', okLabel: 'Create project',
      label: 'You are in the shared Default Public Project. Name a project of your own: your changes are saved there, so the shared library stays untouched.'
    });
    if (!name?.trim()) return { cancelled: true };
    const created = await api.createProject({ name: name.trim(), visibility: 'private' });
    state.projects = await api.projects();
    state.selectedProjectIds.add(created.id);
    let copy = null;
    const cur = app.current;
    if (cur?.type && cur.id) {
      try { copy = await api.cloneDesign(cur.type, cur.id, { name: app.designer?.doc?.name, projectId: created.id }); } catch { /* the project exists; the user can clone the item by hand */ }
    }
    await setActiveProject(created.id);
    buildTopbar();
    if (copy) await app.openDesign(cur.type, copy.id);
    return { created, copied: !!copy };
  })().finally(() => { setTimeout(() => { firstProjectFlow = null; }, 0); });
  const r = await firstProjectFlow;
  throw new ApiError(r.cancelled
    ? 'Create your own project first: edits are not allowed in the shared Default Public Project.'
    : `Project "${r.created.name}" created. Your last change was not applied${r.copied ? ': you are now editing your own copy of this item in it' : ''}: do it again there.`);
}
setWriteGuard(firstProjectGuard);

async function newProjectAction() {
  const name = await promptBox('New Project', { value: 'New UI Project', label: 'Project Name', okLabel: 'Create Project' });
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

async function saveProjectAction() {
  const pid = Number(state.activeProjectId || 1);
  try {
    if (app.activeDoc()?.dirty) {
      await app.activeDoc().save();
    }
    const res = await api.saveProject(pid, {});
    state.projects = await api.projects();
    buildTopbar();
    toast(`Saved project "${res.project?.name || '#' + pid}"`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cloneProjectAction() {
  const pid = Number(state.activeProjectId || 1);
  const curProj = (state.projects || []).find(p => Number(p.id) === pid) || { id: pid, name: 'Project' };
  const name = await promptBox('Clone Project', { value: `${curProj.name} (Clone)`, label: 'Cloned Project Name', okLabel: 'Clone Project' });
  if (!name?.trim()) return;
  try {
    const res = await api.cloneProject(pid, { name: name.trim() });
    state.projects = await api.projects();
    state.selectedProjectIds.add(res.project.id);
    await setActiveProject(res.project.id);
    buildTopbar();
    toast(`Cloned project "${res.project.name}" (${res.copiedCount || 0} item(s))`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteProjectAction() {
  const pid = Number(state.activeProjectId || 1);
  const curProj = (state.projects || []).find(p => Number(p.id) === pid);
  if (pid === 1) {
    toast('The Default Public Project (#1) cannot be deleted. Switch to a custom project first.', 'error');
    return;
  }
  if (!await confirmBox(`Delete project "${curProj?.name || '#' + pid}"?`, { okLabel: 'Delete Project' })) return;
  try {
    await api.deleteProject(pid);
    state.selectedProjectIds.delete(pid);
    state.projects = await api.projects();
    await setActiveProject(1);
    buildTopbar();
    toast(`Deleted project "${curProj?.name || '#' + pid}"`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function menuDef() {
  const s = state.settings, d = () => app.designer;
  const tick = v => (v ? '✓' : '');
  const curDoc = d()?.doc;
  const selOne = d()?.selectedNodes?.()[0] || null;
  return [
    ['Project', [
      ['New Project…', () => newProjectAction()],
      ['Save Project', () => saveProjectAction()],
      ['Clone Project…', () => cloneProjectAction()],
      ['Browse Projects…', () => openProjectsModal()],
      ['Delete Project…', () => deleteProjectAction()],
      '-',
      ['Projects & Collaborators…', () => openProjectsModal()],
      ['Collaborative Change List (Approve / Reject)…', () => openChangesModal()],
      ['Versions & AI Changesets (Review)…', () => openVersions()],
      ['AI Item Requests (Inbox)…', () => openVersions({ tab: 'requests' })],
      ['Download Project as HTML App (for AI agents)…', () => downloadAppExport()],
      '-',
      ...(state.projects || []).map(p => [`${tick(p.id === state.activeProjectId)}|Project: ${projectLabel(p)} (${p.visibility})`, () => setActiveProject(p.id)]),
      '-',
      ['Set Open Design to Public (All Users)', async () => {
        if (!curDoc) return toast('Open a design first', 'error');
        await d().patchRecord({ visibility: 'public' });
        toast(`"${curDoc.name}" is now PUBLIC`, 'ok');
      }],
      ['Set Open Design to All Projects (my global library — user\'s all projects)', async () => {
        if (!curDoc) return toast('Open a design first', 'error');
        await d().patchRecord({ visibility: 'private' });
        toast(`"${curDoc.name}" is now PRIVATE (Global Library)`, 'ok');
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
      ['Export Library Items (HTML / SVG / JSON)…', () => openLibraryExportImportModal({ initialTab: 'export', defaultType: state.tab })],
      ['Import Library Items to Project / Public (HTML / SVG / JSON)…', () => openLibraryExportImportModal({ initialTab: 'import', defaultType: state.tab })],
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
      ['Container (Shell Box — Inner/Outer Margins, Clamps Children)', () => insertPresetElement('html-container')],
      ['Carousel Container (2D/3D Horizontal & Vertical Roll)', () => insertPresetElement('html-carousel-container')],
      ['Repeater (Repeating Item List · Vertical/Horizontal/Carousel/Roll/Slide/Scroll · 2D/3D)', () => insertPresetElement('html-repeater')],
      '-',
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
      ['Container Tool (Shell Box)', () => d().setTool('container'), 'K'],
      ['Carousel Container Tool (2D/3D Roll)', () => d().setTool('carousel'), 'U'],
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
      ['Versions & AI Changesets (Review)…', () => openVersions()],
      ['AI Item Requests (Inbox)…', () => openVersions({ tab: 'requests' })],
      ['Download Project as HTML App (for AI agents)…', () => downloadAppExport()],
      ['Projects & Collaborator Invitations…', () => openProjectsModal()],
      ['Admin & User Management Panel (ACL)…', () => openAdminUsersModal()],
      ['My Profile (Details, Password, Sessions)…', () => openProfile()],
      ['Sign In / Register / Switch Account…', () => openAuthModal()],
      ['AI Access Keys (MCP)…', () => openAiKeys()],
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
      ['🌙 / ☀️ Toggle Dark & Light Mode of Active Design Style', () => {
        const pairKey = pairThemeKey(state.themeKey, state.themes);
        if (pairKey && pairKey !== state.themeKey) setTheme(pairKey);
      }],
      '-',
      ...state.themes.map(t => [`${tick(t.key === state.themeKey)}|${t.name}`, () => setTheme(t.key)]), '-',
      ['Edit themes…', () => openThemeEditor()]
    ]],
    ['Export', [
      ['Export open design as SVG (with animation)', () => app.current ? downloadSvg(app.current.type, app.current.id) : toast('Open a design first', 'error')],
      ['Export usage guide (usage-and-guide.html)', () => downloadGuide()],
      ['Export selected screens…', () => openExportDialog({ screenIds: state.catalogSel.size ? [...state.catalogSel] : 'all' })],
      ['Export all screens…', () => openExportDialog({ screenIds: 'all' })],
      '-',
      ['Export all project (one browsable html)', () => downloadProjectHtml()]
    ]],
    ['Trash', [
      ['🗑 Trash Management (Restore / Purge)…', () => openTrashModal()],
      ['🗂 Open 90% Item Browser Modal (Copy / Move)…', () => openItemBrowserModal()],
      ['🗂 Center Canvas Full Item Browser', () => { if (state.mode !== 'browser') state.prevMode = state.mode; state.mode = 'browser'; renderMode(); }],
      '-',
      ['🧹 Empty Active Project Library…', async () => {
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
    ['Help', [['Usage and guide…', () => openGuide(guideTab()), 'F1'], ['Download usage-and-guide.html', () => downloadGuide()], '-', ['Keyboard shortcuts', () => showShortcuts()], ['About', () => modal({ title: 'About', content: h('div', {}, h('p', {}, 'Kyrpy UI/UX App Designer · Offline-First SQLite + PostgreSQL Collaborative Edition.'), h('p', { class: 'muted' }, 'Project-based designs (public & project visibility), User & ACL Management (default root owner @superadmin), Root Lineage tracking, Collaborative Change Approval/Rejection, Multi-Events (click, mouseover, release, drag&drop), Small Element Toolbars, Editable Templates, and bi-directional PostgreSQL sync (kyrpy-uiux-designer-db).')) })]]]
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
    class: 'btn sm tb-icon proj-multi-trigger',
    'aria-label': `Projects — ${labelText}`,
    'data-tip': `Projects — active: ${activeProj.name}${selCount ? ` · ${selCount} selected` : ''}\nMulti-select to filter libraries, switch the active project, or create one`,
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
  }, iconEl('folder', { size: 17 }), selCount ? h('span', { class: 'tb-badge' }, String(selCount)) : null);
  // Active project name shown as a label aligned beside the icon button
  const projLabel = h('span', { class: 'proj-active-label', title: activeProj.name }, activeProj.name);
  const inDefault = Number(activeProj.id) === DEFAULT_PROJECT_ID;
  const noOwn = !ownProjects().length;
  const triggerWrap = h('div', {
    class: `proj-trigger-wrap${inDefault ? ' proj-default' : ''}${inDefault && noOwn ? ' proj-none' : ''}`,
    'data-tip': inDefault
      ? (noOwn ? 'You are in the shared Default Public Project and have no project of your own yet.\nYour first edit asks you to create one.' : 'You are in the shared Default Public Project.\nSwitch to one of your own projects to work on your designs.')
      : null
  }, triggerBtn, projLabel);

  const rebuildDropdown = () => {
    clear(panel);
    for (const p of projects) {
      const pid = Number(p.id);
      const isChecked = state.selectedProjectIds.has(pid);
      const isActive = pid === Number(state.activeProjectId);
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
        }, `${p.visibility === 'private' || p.visibility === 'project' ? '📁' : '🌐'} ${projectLabel(p)}`),
        isActive ? h('span', { class: 'badge', style: { fontSize: '9px' } }, 'ACTIVE') : null
        )
      );
    }

    panel.append(
      h('div', { class: 'menu-sep', style: { margin: '6px 0' } }),
      h('div', { class: 'row wrap', style: { gap: '4px' } },
        h('button', {
          class: 'btn sm primary grow create-new-project-btn',
          onclick: () => { closeMenus(); newProjectAction(); }
        }, '+ New Project'),
        h('button', {
          class: 'btn sm save-project-btn',
          title: 'Save active project & open design',
          onclick: () => { closeMenus(); saveProjectAction(); }
        }, '💾 Save Project'),
        h('button', {
          class: 'btn sm clone-project-btn',
          title: 'Clone active project with its settings and designs',
          onclick: () => { closeMenus(); cloneProjectAction(); }
        }, '⧉ Clone Project'),
        h('button', {
          class: 'btn sm browse-projects-btn',
          title: 'Browse and manage all projects',
          onclick: () => { closeMenus(); openProjectsModal(); }
        }, '📂 Browse Projects'),
        h('button', {
          class: 'btn sm danger delete-project-btn',
          title: 'Delete active project',
          onclick: () => { closeMenus(); deleteProjectAction(); }
        }, '🗑 Delete Project')
      )
    );
  };

  ddWrap.append(triggerWrap, panel);
  return ddWrap;
}

/* Topbar rebuilds are deferred while the pointer is pressed on the top rows or a topbar menu is open.
   Sync events (any write on the server → SSE → library:changed) used to replace every button between
   mousedown and mouseup, so the browser never fired the click (Trash / Changes / Profile "did nothing")
   and open menus vanished mid-use. The pending rebuild runs right after the click has been delivered. */
let topbarPress = false, topbarPending = false, topbarRetry = null;
document.addEventListener('pointerdown', e => { if (e.target?.closest?.('#topbar, #typebar')) topbarPress = true; }, true);
const releaseTopbarPress = () => {
  if (!topbarPress) return;
  topbarPress = false;
  if (topbarPending) setTimeout(() => buildTopbar(), 0);   // after the click event of this press
};
document.addEventListener('pointerup', releaseTopbarPress, true);
document.addEventListener('pointercancel', releaseTopbarPress, true);
window.addEventListener('blur', releaseTopbarPress);

function buildTopbar() {
  const busy = topbarPress || document.querySelector('#topbar .open, #typebar .open');
  if (busy) {
    topbarPending = true;
    if (!topbarPress && !topbarRetry) topbarRetry = setTimeout(() => { topbarRetry = null; if (topbarPending) buildTopbar(); }, 400);
    return;
  }
  topbarPending = false;
  renderTopbar();
}

function renderTopbar() {
  const bar = $('#topbar'); clear(bar);
  bar.append(h('div', { class: 'brand' }, h('span', { style: { color: '#2e9bff' } }, '◈'), 'UI/UX Designer'));
  for (const [title, items] of menuDef()) {
    const panel = h('div', { class: 'menu-panel', role: 'menu' });
    const m = h('div', { class: 'menu' }, h('button', { class: 'menu-head', 'aria-haspopup': 'true', 'aria-label': title, 'data-tip': title, onclick: e => { e.stopPropagation(); const open = !m.classList.contains('open'); closeMenus(); if (open) { m.classList.add('open'); rebuildPanel(); } } }, iconEl(MENU_ICONS[title] || 'dot', { size: 18 })), panel);
    const rebuildPanel = () => {
      clear(panel);
      for (const it of menuDef().find(x => x[0] === title)[1]) {
        if (it === '-') { panel.append(h('div', { class: 'menu-sep' })); continue; }
        const [label, fn, kbd] = it; const [t, l] = label.includes('|') ? label.split('|') : ['', label];
        panel.append(h('button', { class: 'menu-item', role: 'menuitem', disabled: !fn, 'data-tip': `${l}${kbd ? `  ·  ${kbd}` : ''}`, onclick: () => { closeMenus(); try { fn?.(); } catch (e) { toast(e.message, 'error'); } } }, h('span', { class: 'tick' }, t), iconEl(iconForLabel(l)), h('span', { class: 'mi-label' }, l), kbd ? h('span', { class: 'kbd' }, kbd) : null));
      }
    };
    bar.append(m);
  }

  // Multi-selection Projects dropdown with "+ Create New Project" button
  const projDropdown = buildProjectsMultiDropdown();

  // Trash Management button
  const trashBtn = tbIcon('topbar-trash-btn', 'trash',
    `Trash — restore or permanently purge deleted items (${state.trashCount || 0})`,
    () => openTrashModal(), state.trashCount || 0);

  // Pending Collaborative Changes button
  const changesBtn = tbIcon('', 'changes',
    `Collaborative changes — approve or reject edits (${state.pendingChangesCount || 0} pending)`,
    () => openChangesModal(), state.pendingChangesCount || 0, state.pendingChangesCount > 0);

  // PostgreSQL Sync button
  const syncBtn = tbIcon('', 'sync',
    'PG Sync — offline-first local SQLite ↔ PostgreSQL (kyrpy-uiux-designer-db)',
    () => openSyncModal('sync'));

  // User / Admin button
  const curUser = state.user || { username: 'superadmin', role: 'admin' };
  const userBtn = tbIcon('', 'user',
    `My profile — @${curUser.username} (${curUser.role}): details, password, sessions, AI access keys`,
    () => openProfile());

  const curThemeObj = state.themes.find(t => t.key === state.themeKey) || state.themes[0];
  const isLightMode = curThemeObj?.tokens?.mode === 'light' || String(state.themeKey).endsWith('-light');
  const modeToggleBtn = tbIcon('theme-mode-toggle-btn', isLightMode ? 'sun' : 'moon',
    isLightMode ? 'Light mode — click to switch this design style to Dark mode' : 'Dark mode — click to switch this design style to Light mode',
    () => { const targetKey = pairThemeKey(state.themeKey, state.themes); if (targetKey) setTheme(targetKey); });
  // Theme style button sits in the top-left slot, right after the menu heads
  // API / MCP health dots (links to /docs/api and /docs/mcp in a new tab; polling lives in health-status.js)
  const healthGroup = h('div', { class: 'tb-health-group', role: 'group', 'aria-label': 'Service health' }, healthIndicators());
  bar.append(h('div', { class: 'top-center' }, projDropdown));
  bar.append(h('div', { class: 'top-right' }, healthGroup, trashBtn, changesBtn, syncBtn, userBtn, modeToggleBtn));
  buildTypeBar();
}
/* Designer-page section: switch between path / icon / button / element / screen / workflow / item browser,
   plus a "New empty" button for the page that is open. */
const TYPE_NAV = [
  ['path', 'Path designer', 'bezier', 'paths'],
  ['icon', 'Icon designer', 'star', 'icons'],
  ['button', 'Button designer', 'circle', 'buttons'],
  ['element', 'Element designer', 'rect', 'elements'],
  ['screen', 'Screen designer — device screens', 'monitor', 'screens']
];
function currentPageType() { return state.mode === 'workflow' ? 'workflow' : state.mode === 'screen' ? (app.current?.type || state.tab) : null; }
async function openPageType(type) {
  if (type === 'workflow') {
    const id = state.workflowId || app.library.workflows[0]?.id;
    if (!id) { toast('Create a workflow first (+ New in this page)'); return; }
    await app.openWorkflow(id);
  } else {
    state.mode = 'screen'; state.tab = type;
    const list = type === 'screen' ? await api.list('screen') : (state.library[TYPE_NAV.find(t => t[0] === type)[3]] || []);
    const first = list[0];
    if (first) await app.openDesign(type, first.id);
    else { renderMode(); app.library.renderTabs(); app.library.renderBody(); }
  }
  buildTopbar();
}
function buildTypeBar() {
  const nav = $('#typebar'); if (!nav) return;
  clear(nav);
  const page = currentPageType();
  // "+" opens a pop-up menu: New Path / Icon / Button / Element / Screen / Workflow (each creates an empty item and opens it)
  const NEW_ITEMS = [['path', 'New Path', 'bezier'], ['icon', 'New Icon', 'star'], ['button', 'New Button', 'circle'], ['element', 'New Element', 'rect'], ['screen', 'New Screen', 'monitor'], ['workflow', 'New Workflow', 'workflow']];
  const createNew = async type => {
    closeMenus();
    const r = await createEmptyItem(type);
    if (!r) return;
    if (type === 'workflow') await app.openWorkflow(r.id); else await app.openDesign(type, r.id);
    buildTopbar();
  };
  const newPanel = h('div', { class: 'menu-panel new-menu', role: 'menu' },
    NEW_ITEMS.map(([type, label, icon]) => h('button', { class: 'menu-item', role: 'menuitem', 'data-new-type': type, onclick: e => { e.stopPropagation(); createNew(type).catch(err => toast(err.message, 'error')); } },
      h('span', { class: 'ico' }, iconEl(icon, { size: 16 })), h('span', { class: 'mi-label' }, label))));
  const newBtn = h('div', { class: 'menu new-menu-wrap' },
    ibtn('plus', 'New — path, icon, button, element, screen or workflow', e => { e.stopPropagation(); const open = !newBtn.classList.contains('open'); closeMenus(); if (open) newBtn.classList.add('open'); },
      { desc: 'Open the New menu: path, icon, button, element, screen, workflow', cls: 'new-empty' }),
    newPanel);
  // the designer's doc bar (back, save, targets, visibility, status, new) and canvas toggles live in this row
  const designer = app.designer;
  const inDesigner = state.mode === 'screen' && designer?.doc;
  // the ownership / save status sits in the top centre, next to the project button
  const tc = $('#topbar .top-center');
  if (tc) { tc.querySelector(':scope > .doc-state')?.remove(); if (inDesigner && designer.docState) tc.append(designer.docState); }
  nav.append(...[
    // the per-type page buttons live in the library panel's icon tabs (double-click opens that designer)
    h('div', { class: 'tabs type-tabs', role: 'tablist' },
      h('button', { class: `tab-ico${state.mode === 'browser' ? ' on' : ''}`, 'aria-label': 'Item Browser — full-canvas item list with checkboxes (click again to go back)', 'data-tip': 'Item Browser — full-canvas item list with checkboxes. Click again to return to where you were.', dataset: { modeTab: 'browser' }, onclick: () => { if (state.mode === 'browser') { state.mode = state.prevMode && state.prevMode !== 'browser' ? state.prevMode : 'screen'; } else { state.prevMode = state.mode; state.mode = 'browser'; } renderMode(); buildTopbar(); } }, iconEl('grid', { size: 18 }))
    ),
    h('span', { class: 'sep-v' }),
    ...(inDesigner ? [...(designer.barHead || []), h('span', { class: 'sep-v' })] : []),
    newBtn,
    inDesigner ? h('span', { class: 'sep-v' }) : null,
    inDesigner ? designer.docbar : null,
    ...(inDesigner ? (designer.pathGroups || []) : []),
    inDesigner && designer.barTools?.length ? h('span', { class: 'sep-v' }) : null,
    ...(inDesigner ? (designer.barTools || []) : []),
    ...(inDesigner ? (designer.toolToggles || []) : []),
    h('span', { class: 'grow' }),
    h('span', { class: 'muted typebar-hint' }, page ? `Editing: ${page === 'workflow' ? 'workflow' : page}` : 'Item Browser'),
    ...(inDesigner ? (designer.viewControls || []) : [])
  ].filter(Boolean));
}
window.addEventListener('ud:open-page', e => { const t = e.detail; if (t) openPageType(t).catch(err => toast(err.message, 'error')); });
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
function toggleLeft() {
  const l = $('#left'); l.classList.toggle('collapsed');
  if (!l.classList.contains('collapsed')) l.style.width = `${state.settings.leftPanelWidth || 360}px`;
  requestAnimationFrame(() => app.designer?.fit?.());
}
// the library panel's own drawer button (inside #left) asks for the toggle through this event
window.addEventListener('ud:toggle-left', toggleLeft);

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
  // slim rail shown only while the panel is collapsed (CSS), so the panel can always be reopened
  if (!$('#left-reopen')) sp.after(h('button', { id: 'left-reopen', type: 'button', class: 'left-reopen', title: 'Show the library panel', 'aria-label': 'Show the library panel', onclick: toggleLeft }, iconEl('panel-left', { size: 16 })));
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
  if (!b.authenticated && api.getSession()?.token) {
    api.setSession({ token: null, userId: b.user?.id || 1 });
  }
  if (b.user) state.user = b.user;
  state.publicUserId = b.publicUserId ?? null;
  state.settings = b.settings; state.themes = b.themes; state.devices = b.devices; state.counts = b.counts; state.themeKey = b.settings.theme;
  state.authConfig = b.authConfig || { appMode: 'dev', bypassLogin: true, requireAuth: false };
  state.trashCount = b.trashCount ?? b.counts?.trash ?? 0;
  // reopen the project that was active before the refresh (the session header already carries it; the topbar and the
  // library filter must agree with it) instead of always falling back to the Default Public Project
  state.projects = b.projects || [];
  state.activeProjectId = pickStartupProject(api.getSession()?.projectId);
  state.saveTargetProjectIds = new Set([state.activeProjectId]);   // default save target = the active project
  api.setSession({ projectId: state.activeProjectId });
  if (!state.themes.find(t => t.key === state.themeKey)) state.themeKey = state.themes[0].key;
  applyThemeChrome();
  await ensureAuthGate({ authConfig: state.authConfig, authenticated: Boolean(b.authenticated) });
  // published default accounts (superadmin/superadmin, admin/admin, user/user): demand a new password right after the first start
  api.profile().then(p => { if (p && p.passwordSetByUser === false && !p.user?.system) { toast('This account still uses the published default password. Choose your own now.', 'error', 6000); openProfile({ tab: 'password' }); } }).catch(() => { /* no profile for system / signed-out sessions */ });
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
    $('#status-counts').textContent = `project: ${pName} · user: @${state.user?.username || 'superadmin'} (${state.user?.role || 'admin'}) · ${c.paths} paths · ${c.icons} icons · ${c.buttons} buttons · ${c.elements} elements · ${c.screens} screens · ${c.workflows} workflows · trash: ${state.trashCount || 0} · pending changes: ${state.pendingChangesCount || 0} · theme: ${state.themeKey}`;
  };
  on('library:changed', () => { refreshCounts(); buildTopbar(); });
  on('topbar:refresh', () => buildTopbar());
  on('trash:changed', () => { refreshCounts(); buildTopbar(); });
  on('project:list-changed', () => { refreshCounts(); buildTopbar(); });
  on('mode:set', m => { state.mode = m; renderMode(); });
  on('designer:open', ({ type, id }) => app.openDesign(type, id));
  on('workflow:select', id => app.openWorkflow(id));
  on('auth:changed', () => { refreshCounts(); buildTopbar(); });
  on('project:changed', () => { refreshCounts(); buildTopbar(); app.library.renderBody(); });
  // the change list reviews in place: only the pending badge (topbar + status bar) follows each review
  on('changes:count', () => { refreshCounts(); buildTopbar(); });
  on('change:reviewed', async () => {
    refreshCounts();
    buildTopbar();
    if (app.current && app.designer?.doc) await app.designer.reload();
  });
  on('theme:changed', () => { refreshCounts(); buildTopbar(); app.designer.doc && app.designer.renderAll(); if (state.mode === 'workflow' && app.workflow.wf) app.workflow.refresh(); });
  on('workflows:changed', async () => { await app.library.loadWorkflows(); refreshCounts(); });
  on('settings:changed', () => app.designer.renderOverlay());
  // icon geometry fetched lazily (large libraries): redraw open canvases that drew those icons as placeholders
  on('icons:loaded', debounce(() => { for (const d of [app.designer, ...app.modals]) if (d?.doc && d.renderStage) d.renderStage(); }, 60));
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
    const first = screens.find(s => s.key === 'item-list') || screens[0];
    if (first) await app.openDesign('screen', first.id, { push: 'replace' });
  }
  updateBackButtons();
  connectSync();
  window.__app = app;   // handy in the console
}

/* Sync signal from the server: when any client writes, every open client re-reads the library so cached
   lists (and any duplicate rows they were showing) are replaced with the server's current copy. */
function connectSync() {
  if (typeof EventSource === 'undefined') return;
  const resync = debounce(async () => {
    try {
      await reloadLibrary({ silent: true });
      app.library?.renderBody?.();
      await app.browser?.reload?.();
      emit('library:changed');
    } catch (e) { console.warn('resync failed', e); }
  }, 300);
  const es = new EventSource('/api/events');
  let seen = null;
  es.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'library-changed') return;
    if (seen !== null && msg.version === seen) return;
    seen = msg.version;
    resync();
  };
}

boot().catch(e => { console.error(e); document.body.prepend(h('pre', { style: { color: '#f66', padding: '20px' } }, `Failed to start: ${e.message}`)); });
