/**
 * Workflow designer: screens on an infinite canvas (move, collapse, expand, edit in a modal) and named links
 * between them (curved or cornered; cornered lines hop over each other with a small "U" at intersections).
 */
import { h, clear, toast, confirmBox, promptBox, choiceBox, modal } from '../dom.js';
import { ibtn, iconEl } from '../icons.js';
import { rememberName } from '../edited.js';
import { workflowFingerprint, workflowRestoreBody } from '/domain/doc-fingerprint.js';
import { api } from '../api.js';
import { state, emit, projectLabel, canEditOwned, ownerLabel } from '../state.js';
import { nodeBBox } from '/domain/geometry.js';
import { openExportDialog } from './export-dialog.js';
import { openGuide } from '../actions.js';
import { openTestRunner } from './test-runner.js';
import { openLineageModal } from './collab-modals.js';
import { openCopyMoveToProjectsModal } from './item-browser.js';

const HEAD = 44, NS = 'http://www.w3.org/2000/svg', HOP = 9;
const TRIGGERS = ['tap', 'long-press', 'swipe', 'timeout', 'back', 'menu-item'];

export class WorkflowDesigner {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.wf = null; this.screens = new Map(); this.full = new Map();
    this.view = { tx: 40, ty: 40, z: 0.35 };
    this.sel = null;                    // {kind:'node'|'link', id}
    this.linkTool = false; this.linkStyle = 'curved';
    this.testMode = false; this.activeTestScreenId = null; this.testHistory = [];
    this.undoStack = []; this.redoStack = [];
    this.nodeEls = new Map();
    this.baseline = null; this.baselineFp = ''; this.dirty = false;   // last saved version of the open workflow
  }

  snapshot() {
    return this.wf ? workflowRestoreBody(JSON.parse(JSON.stringify(this.wf))) : null;
  }

  pushUndo(snap = this.snapshot()) {
    if (!snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo() {
    const snap = this.undoStack.pop();
    if (!snap || !this.wf) return toast('nothing to undo');
    this.redoStack.push(this.snapshot());
    await api.restoreWorkflow(this.wf.id, snap);
    this.sel = null;
    await this.refresh();
  }

  async redo() {
    const snap = this.redoStack.pop();
    if (!snap || !this.wf) return toast('nothing to redo');
    this.undoStack.push(this.snapshot());
    await api.restoreWorkflow(this.wf.id, snap);
    this.sel = null;
    await this.refresh();
  }

  async deleteSelected() {
    if (!this.wf || !this.sel) return toast('Select a workflow link or screen node to delete');
    if (this.sel.kind === 'link') {
      this.pushUndo();
      await this.deleteLink(this.sel.id);
      return;
    }
    if (this.sel.kind === 'node') {
      const s = this.screens.get(this.sel.id);
      if (await confirmBox(`Remove "${s?.name || '#' + this.sel.id}" and its links from this workflow?`, { okLabel: 'Remove' })) {
        this.pushUndo();
        await api.removeWfScreen(this.wf.id, this.sel.id);
        this.sel = null;
        await this.refresh();
      }
    }
  }

  /* ---------- save / save as / reset (same model as the designers: edits are stored at once, "saved" is a bookmark on top) ---------- */
  markBaseline() { this.baseline = JSON.parse(JSON.stringify(this.wf)); this.baselineFp = workflowFingerprint(this.wf); this.dirty = false; this.updateDocBar(); }
  computeDirty() { this.dirty = !!this.wf && !!this.baseline && workflowFingerprint(this.wf) !== this.baselineFp; }
  checkDirty() { const before = this.dirty; this.computeDirty(); if (before !== this.dirty) this.updateDocBar(); }

  /** The owner, or an admin curating a public-library workflow (owned by the `public` system user). */
  isOwnedByCurrentUser(rec = this.wf) {
    return canEditOwned(rec);
  }

  buildSaveTargetsDropdown() {
    const projects = state.projects?.length
      ? state.projects
      : [{ id: 1, name: 'Default Public Project', ownerId: 1, visibility: 'public' }];
    const selSet = state.saveTargetProjectIds || (state.saveTargetProjectIds = new Set());
    const count = selSet.size + (state.saveToUserPrivateLibrary ? 1 : 0);

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
      'data-tip': 'Save targets — also save this workflow (and all sub-items) into multiple projects and/or your All Projects library',
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

  buildDocBar() {
    const app = this.app;
    const ownedByMe = this.isOwnedByCurrentUser(this.wf);
    this.backBtn = ibtn('back', 'Back', () => app.back(), { desc: 'Return to the previous page', kbd: 'Alt+←', dataset: { act: 'back' } });
    this.saveBtn = ibtn('save', 'Save', () => this.save(), { kbd: 'Ctrl+S', disabled: !ownedByMe, cls: 'save' });
    this.saveAsBtn = ibtn('copy', 'Save as…', () => this.saveAs(), { desc: 'Save a copy under a new name (into your All Projects library and any selected Multi-Targets)' });
    this.saveTargetsDropdown = this.buildSaveTargetsDropdown();
    this.resetBtn = ibtn('undo', 'Reset', () => this.reset(), { desc: 'Throw away every change since the last save' });
    const wfItem = () => [{ type: 'workflow', id: this.wf.id, name: this.wf.name, key: this.wf.key, creatorId: this.wf.creatorId }];
    const copyToBtn = ibtn('copy', 'Copy to…', () => this.wf && openCopyMoveToProjectsModal({ items: wfItem(), mode: 'copy' }),
      { desc: 'Copy this workflow (and its screens + sub-items) to project(s)' });
    const moveToBtn = ibtn('import', 'Move to…', () => this.wf && ownedByMe && openCopyMoveToProjectsModal({ items: wfItem(), mode: 'move' }), {
      disabled: !ownedByMe,
      desc: ownedByMe ? 'Move this workflow (and its screens + sub-items) to your project(s)' : 'Workflows owned by other users cannot be moved (only copied)'
    });
    // no status text: the Save button blinks while there are unsaved changes and its tooltip carries the state
    this.docbar = h('div', { class: 'dz-docbar', role: 'toolbar', 'aria-label': 'Document' },
      this.backBtn, h('span', { class: 'sep-v' }),
      this.saveBtn, this.saveAsBtn, this.saveTargetsDropdown, this.resetBtn,
      h('span', { class: 'sep-v' }),
      copyToBtn, moveToBtn
    );
    this.updateDocBar();
    return this.docbar;
  }

  updateDocBar() {
    if (!this.saveBtn) return;
    const ownedByMe = this.isOwnedByCurrentUser(this.wf);
    this.saveBtn.disabled = !ownedByMe;
    this.saveBtn.classList.toggle('dirty', this.dirty && ownedByMe);
    this.resetBtn.disabled = !this.dirty;
    const status = !ownedByMe
      ? `🔒 Owned by ${ownerLabel(this.wf?.creatorUsername, this.wf?.creatorId)}: use Save as… to save a copy`
      : this.dirty ? '● Unsaved changes: press Save' : '✓ All changes saved';
    this.saveBtn.dataset.tip = `Save\n${status}\nShortcut: Ctrl+S`;
    this.saveBtn.setAttribute('aria-label', `Save (${status.replace(/^\S+\s/, '')})`);
    this.refreshBack();
  }

  refreshBack() {
    if (!this.backBtn) return;
    const target = this.app.backTarget?.();
    this.backBtn.disabled = !this.app.canBack?.();
    this.backBtn.title = target ? `Back to ${target} (Alt+←)` : 'Back to the previous page (Alt+←)';
  }

  async settle() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && [this.root, this.docbar, this.toolbar].some(r => r?.contains(a))) a.blur();   // the bars live in the page row (#typebar)
    await new Promise(r => setTimeout(r, 80));
  }

  async save() {
    if (!this.wf) return false;
    if (!this.isOwnedByCurrentUser(this.wf)) {
      toast('This workflow is owned by another user — Save is disabled. Please use "Save as…".', 'error');
      return false;
    }
    await this.settle();
    try {
      await this.refresh();
      const had = this.dirty;
      this.markBaseline();
      // Save copies into the checked projects only; the locked private-library target applies to Save as…
      // (otherwise every Save would add another private copy)
      const targetPids = [...(state.saveTargetProjectIds || [])].filter(pid => Number(pid) !== Number(this.wf.projectId));
      const includePriv = false;
      if (targetPids.length > 0 || includePriv) {
        const multiRes = await api.saveToTargets({
          type: 'workflow',
          id: this.wf.id,
          name: this.wf.name,
          projectIds: targetPids,
          visibility: 'project',
          includeUserPrivate: includePriv
        });
        toast(`Saved "${this.wf.name}" + ${multiRes.savedCount} target copy(s) (+${multiRes.subItemsCount || 0} sub-items)`, 'ok', 2800);
      } else {
        toast(had ? `Saved "${this.wf.name}"` : `"${this.wf.name}" has no unsaved changes`, had ? 'ok' : 'info', 2200);
      }
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  async reset({ confirm = true } = {}) {
    if (!this.wf || !this.baseline) return false;
    if (!this.dirty) { toast('Nothing to reset: no changes since the last save'); return false; }
    if (confirm && !(await confirmBox(`Throw away every change to the workflow "${this.wf.name}" since the last save?`, { okLabel: 'Reset' }))) return false;
    await this.settle();
    try {
      await api.restoreWorkflow(this.wf.id, workflowRestoreBody(this.baseline));
      this.sel = null;
      await this.refresh();
      toast('Back to the last saved version', 'ok', 2200);
      return true;
    } catch (e) { toast(e.message, 'error'); await this.refresh(); return false; }
  }

  /** The copy gets the current state (unsaved edits included); the original goes back to its last saved version. */
  async saveAs() {
    if (!this.wf) return false;
    const name = await promptBox('Save as', { value: `${this.wf.name} copy`, label: 'Name of the new workflow', okLabel: 'Save as' });
    if (!name?.trim()) return false;
    await this.settle();
    try {
      const targetPids = [...(state.saveTargetProjectIds || [])];
      const includePriv = Boolean(state.saveToUserPrivateLibrary);
      const reverted = this.dirty;
      let copy;
      if (targetPids.length > 0 || includePriv) {
        const res = await api.saveToTargets({
          type: 'workflow',
          id: this.wf.id,
          name: name.trim(),
          projectIds: targetPids,
          visibility: targetPids.length ? 'project' : 'private',
          includeUserPrivate: includePriv,
          restoreBaseline: reverted ? workflowRestoreBody(this.baseline) : null
        });
        copy = res.primaryCopy || res.copied?.[0]?.item;
        toast(`Saved "${name.trim()}" to ${res.savedCount} target(s) (+${res.subItemsCount || 0} sub-items)`, 'ok', 4200);
      } else {
        copy = await api.cloneWorkflow(this.wf.id, {
          name: name.trim(),
          projectId: state.activeProjectId || this.wf.projectId || 1
        });
        if (reverted) await api.restoreWorkflow(this.wf.id, workflowRestoreBody(this.baseline));
        toast(`Saved as "${copy.name}"${reverted ? `; "${this.wf.name}" is back to its last saved version` : ''}`, 'ok', 4200);
      }
      this.sel = null;
      await this.refresh();
      if (copy?.id) await this.app.openWorkflow(copy.id);
      return copy;
    } catch (e) { toast(e.message, 'error'); await this.refresh(); return false; }
  }

  /** Called before another workflow replaces this one. Resolves true when it is fine to go on. */
  async confirmLeave() {
    if (!this.wf || !this.dirty) return true;
    const c = await choiceBox('Unsaved changes', `The workflow "${this.wf.name}" has changes that were not saved. Save them, or go back to the last saved version?`,
      [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard changes', value: 'discard', kind: 'danger' }, { label: 'Save', value: 'save', kind: 'primary' }]);
    if (c === 'save') return this.save();
    if (c === 'discard') return this.reset({ confirm: false });
    return false;
  }

  async load(id) {
    const [wf, screens] = await Promise.all([api.workflow(id), api.list('screen')]);
    this.wf = wf; this.screens = new Map(screens.map(s => [s.id, s]));
    rememberName('workflow', wf.id, wf.name);
    this.sel = null; this.baseline = null;
    this.markBaseline();
    await this.loadFulls();
    this.render();
    requestAnimationFrame(() => this.fit());
  }

  async loadFulls() {
    const ids = new Set(this.wf.links.map(l => l.fromScreenId));
    await Promise.all([...ids].filter(i => !this.full.has(i)).map(async i => { try { this.full.set(i, await api.getDesign('screen', i)); } catch { /* screen removed */ } }));
  }

  async refresh() { const keep = this.view; this.wf = await api.workflow(this.wf.id); this.computeDirty(); this.screens = new Map((await api.list('screen')).map(s => [s.id, s])); this.full.clear(); await this.loadFulls(); this.render(); this.view = keep; this.applyView(); emit('workflows:changed'); }

  /** Renames the open workflow (header title or inspector field). Resolves true when the name changed. */
  async rename(raw, { syncInspector = true } = {}) {
    const name = String(raw ?? '').trim();
    if (!this.wf || !name || name === this.wf.name) return false;
    try {
      await api.updateWorkflow(this.wf.id, { name });
      this.wf.name = name;
      this.checkDirty();
      this.updateDocBar?.();
      if (syncInspector) this.renderInspector();                    // keep the inspector's Name field in sync
      emit('workflows:changed');
      toast(`Renamed to "${name}"`, 'ok', 1800);
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  /** Modal to search the existing screens (with previews) and add one to this workflow. */
  openScreenPicker() {
    if (!this.wf) return;
    const wf = this.wf;
    const inWf = new Set(wf.nodes.map(n => n.screenId));
    const all = [...this.screens.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const search = h('input', { type: 'search', class: 'scr-pick-search', placeholder: 'Search screens (name, key, label, tag)…', 'aria-label': 'Search screens' });
    const grid = h('div', { class: 'scr-pick-grid', role: 'listbox', 'aria-label': 'Screens' });
    const count = h('span', { class: 'muted' });
    let dlg = null;
    const add = async s => {
      dlg?.close();
      try {
        this.pushUndo();
        const c = this.centerWorld();
        await this.importScreen(s, { x: Math.round(c.x - (s.width || 390) / 2), y: Math.round(c.y - 300) }, { undo: false });
      } catch (e) { toast(e.message, 'error'); }
    };
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const hits = all.filter(s => !q || [s.name, s.key, s.label, ...(s.tags || [])].some(v => String(v ?? '').toLowerCase().includes(q)));
      clear(grid);
      for (const s of hits) {
        const used = inWf.has(s.id);
        grid.append(h('button', {
          class: `scr-pick-card${used ? ' used' : ''}`, role: 'option', disabled: used,
          title: used ? `"${s.name}" is already in this workflow` : `Add "${s.name}" to this workflow`,
          onclick: () => add(s)
        },
          h('div', { class: 'scr-pick-thumb' }, h('img', { loading: 'lazy', alt: '', draggable: 'false', src: api.svgUrl('screen', s.id, { theme: state.themeKey, v: s.updatedAt }) })),
          h('b', {}, s.name),
          h('span', { class: 'muted' }, used ? 'already in this workflow' : (s.key || ''))));
      }
      if (!hits.length) grid.append(h('p', { class: 'muted' }, all.length ? 'No screen matches the search.' : 'There are no screens yet: create one in the Screen designer.'));
      count.textContent = `${hits.filter(s => !inWf.has(s.id)).length} available · ${hits.length} shown`;
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('.scr-pick-card:not([disabled])')?.click(); }
    });
    draw();
    dlg = modal({ title: 'Add a screen to this workflow', wide: true, content: h('div', { class: 'scr-pick' }, h('div', { class: 'row spread' }, search, count), grid) });
    requestAnimationFrame(() => search.focus());
  }

  /**
   * Adds a screen at { x, y } together with every screen its routes reach (menu items and click actions that go to
   * another screen, recursively), all linked. A screen that is already here only gets its missing routes.
   */
  async importScreen(s, at, { undo = true } = {}) {
    if (!this.wf || !s) return;
    if (undo) this.pushUndo();
    const r = await api.importScreenRoutes(this.wf.id, { screenId: s.id, x: at.x, y: at.y });
    await this.refresh();
    const { screens = 0, links = 0 } = r.imported || {};
    if (screens > 1) this.fit();
    toast(screens || links ? `"${s.name}": added ${screens} screen(s) and ${links} route(s)` : `"${s.name}" and its routes are already in this workflow`, screens || links ? 'ok' : 'info', 2600);
  }

  /* ---------- layout of the chrome ---------- */
  render() {
    clear(this.root); this.root.classList.add('wf');
    const wf = this.wf;
    const addSel = ibtn('monitor', 'Add screen…', () => this.openScreenPicker(), { desc: 'Search the existing screens (with previews) and add one to this workflow', dataset: { act: 'add-screen' } });
    this.zoomLabel = h('span', { class: 'muted', style: { minWidth: '46px', textAlign: 'center' } }, '');
    const styleSel = h('select', { title: 'Style of new links' }, h('option', { value: 'curved' }, 'curved links'), h('option', { value: 'cornered' }, 'cornered links'));
    styleSel.value = this.linkStyle; styleSel.addEventListener('change', () => { this.linkStyle = styleSel.value; });
    this.linkBtn = h('button', { class: `btn small${this.linkTool ? ' active' : ''}`, title: 'Draw links: drag from a button on one screen to another screen', onclick: () => { this.linkTool = !this.linkTool; this.linkBtn.classList.toggle('active', this.linkTool); this.viewport.style.cursor = this.linkTool ? 'crosshair' : 'default'; } }, '🔗 Link tool');
    this.testBtn = h('button', {
      class: `btn small${this.testMode ? ' active' : ''}`,
      dataset: { act: 'test-actions' },
      title: 'Run this workflow as a browsable app in a test window: every route, menu item and popup works; Back walks back. Edit items in a new tab while it runs.',
      onclick: () => openTestRunner(this.app, { type: 'workflow', id: this.wf.id })
    }, '▶ Test workflow');
    const nameIn = h('input', {
      class: 'wf-title-input', value: wf.name, spellcheck: 'false',
      'aria-label': 'Workflow name', title: 'Workflow name: click to rename, Enter to save, Esc to cancel'
    });
    const fitName = () => { nameIn.style.width = `${Math.min(Math.max(nameIn.value.length, 6), 40) + 2}ch`; };
    fitName();
    this.titleInput = nameIn;
    nameIn.addEventListener('input', fitName);
    nameIn.addEventListener('focus', () => nameIn.select());
    nameIn.addEventListener('keydown', e => {
      e.stopPropagation();                                            // keep Del/Ctrl+Z etc. for the text, not the canvas
      if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); nameIn.value = this.wf.name; fitName(); nameIn.blur(); }
    });
    nameIn.addEventListener('blur', async () => {
      if (!(await this.rename(nameIn.value))) nameIn.value = this.wf.name;
      fitName();
    });
    const bar = h('div', { class: 'dz-bar wf-bar', role: 'toolbar', 'aria-label': 'Workflow tools' },
      h('span', { class: 'wf-title' }, h('b', {}, 'Workflow:'), nameIn),
      h('span', { class: 'sep-v' }),
      ibtn('undo', 'Undo', () => this.undo(), { kbd: 'Ctrl+Z' }),
      ibtn('redo', 'Redo', () => this.redo(), { kbd: 'Ctrl+Y' }),
      ibtn('trash', 'Delete', () => this.deleteSelected(), { desc: 'Delete the selected link or screen node', kbd: 'Del' }),
      h('span', { class: 'sep-v' }),
      addSel,
      h('span', { class: 'sep-v' }), this.linkBtn, styleSel,
      ibtn('grid', 'Auto layout', () => this.autoLayout(), { desc: 'Arrange screens left → right following the links' }),
      this.testBtn,
      h('span', { class: 'sep-v' }),
      ibtn('zoomOut', 'Zoom out', () => this.zoomBy(1 / 1.25)), this.zoomLabel, ibtn('zoomIn', 'Zoom in', () => this.zoomBy(1.25)),
      ibtn('fit', 'Fit to window', () => this.fit()), h('span', { class: 'grow' }),
      ibtn('arrowUp', 'Collapse all', () => this.collapseAll(true), { desc: 'Collapse every screen' }), ibtn('arrowDown', 'Expand all', () => this.collapseAll(false), { desc: 'Expand every screen' }),
      ibtn('book', 'Guide', () => openGuide('workflow'), { desc: 'How to use the workflow designer', kbd: 'F1' }),
      ibtn('export', 'Export workflow screens', () => openExportDialog({ screenIds: wf.nodes.map(n => n.screenId) }), { cls: 'primary', desc: 'Export the screens used in this workflow' }));
    this.world = h('div', { class: 'wf-world' });
    this.linkSvg = document.createElementNS(NS, 'svg'); this.linkSvg.setAttribute('class', 'wf-svg');
    this.linkSvg.innerHTML = '<defs><marker id="wf-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L12 6L0 12z" fill="#6aa7ff"/></marker><marker id="wf-arrow-sel" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L12 6L0 12z" fill="#ffd54a"/></marker></defs>';
    this.testHud = h('div', { class: 'dz-live-hud wf-test-hud', hidden: !this.testMode });
    this.viewport = h('div', { class: 'wf-viewport', tabindex: '0', 'aria-label': 'Workflow canvas' }, this.world);
    this.inspector = h('aside', { class: 'dz-inspector' });
    // like the screen designer, the doc bar and the tools live in the page row (#typebar, see buildTypeBar in main.js);
    // a rebuild swaps the new bars in at once, so the row never shows stale or missing tools while the topbar rebuild waits
    const oldDoc = this.docbar, oldBar = this.toolbar;
    const docbar = this.buildDocBar();
    this.toolbar = bar;
    const inRow = el => el?.isConnected && el.closest('#typebar');
    if (inRow(oldDoc)) oldDoc.replaceWith(docbar);
    if (inRow(oldBar)) oldBar.replaceWith(bar);
    if (!docbar.isConnected) this.root.append(docbar);
    if (!bar.isConnected) this.root.append(bar);
    this.root.append(this.testHud, h('div', { class: 'dz-body' }, this.viewport, this.inspector));
    this.buildNodes();
    this.world.append(this.linkSvg);
    this.drawLinks(); this.applyView(); this.renderInspector(); this.renderTestHud(); this.bind();
    emit('topbar:refresh');
  }

  buildNodes() {
    this.nodeEls.clear();
    for (const n of this.wf.nodes) {
      const s = this.screens.get(n.screenId);
      if (!s) continue;
      const isActiveRoute = this.testMode && this.activeTestScreenId === s.id;
      const el = h('div', { class: `wf-node${n.collapsed ? ' collapsed' : ''}${n.locked ? ' locked' : ''}${isActiveRoute ? ' active-route' : ''}`, style: { left: `${n.x}px`, top: `${n.y}px`, width: `${s.width}px` }, dataset: { screen: s.id } },
        h('header', { dataset: { drag: s.id } },
          h('b', { title: s.key }, s.name),
          h('button', { title: 'Test the workflow from this screen (routes are followed)', onclick: e => { e.stopPropagation(); openTestRunner(this.app, { type: 'workflow', id: this.wf.id, startScreenId: s.id }); } }, '▶'),
          h('button', { title: n.locked ? 'Unlock position' : 'Lock position', onclick: async e => { e.stopPropagation(); n.locked = !n.locked; await api.placeScreen(this.wf.id, { screenId: n.screenId, x: n.x, y: n.y, collapsed: n.collapsed, locked: n.locked }); await this.refresh(); } }, n.locked ? '🔒' : '🔓'),
          h('button', { title: n.collapsed ? 'Expand' : 'Collapse', onclick: e => { e.stopPropagation(); this.toggleCollapse(n); } }, n.collapsed ? '▸' : '▾'),
          h('button', { title: 'Edit this screen (opens the screen designer)', onclick: e => { e.stopPropagation(); this.app.openScreenModal(s.id, () => this.refresh()); } }, '✎'),
          h('button', { title: 'Remove from this workflow', onclick: async e => { e.stopPropagation(); if (await confirmBox(`Remove "${s.name}" and its links from this workflow?`, { okLabel: 'Remove' })) { await api.removeWfScreen(this.wf.id, s.id); await this.refresh(); } } }, '✕')),
        h('img', { class: 'shot', alt: s.label, draggable: 'false', src: api.svgUrl('screen', s.id, { theme: state.themeKey, animated: this.testMode ? 1 : 0, v: s.updatedAt }) }));
      this.nodeEls.set(s.id, el);
      this.world.append(el);
    }
  }

  setTestMode(v) {
    this.testMode = Boolean(v);
    this.testBtn?.classList.toggle('active', this.testMode);
    this.root.classList.toggle('actions-live', this.testMode);
    if (this.testMode) {
      this.linkTool = false;
      this.linkBtn?.classList.remove('active');
      const incoming = new Set((this.wf?.links || []).map(l => l.toScreenId));
      const startNode = (this.sel?.kind === 'node' && this.sel.id)
        || this.wf?.nodes?.find(n => !incoming.has(n.screenId))?.screenId
        || this.wf?.nodes?.[0]?.screenId
        || null;
      this.testHistory = [];
      this.setActiveTestScreen(startNode, false);
      toast('Test actions ON — click any route pill, link arrow, or screen element to test workflow routing', 'ok', 2800);
    } else {
      this.activeTestScreenId = null;
      this.testHistory = [];
      this.nodeEls.forEach(el => el.classList.remove('active-route'));
      this.renderTestHud();
    }
  }

  setActiveTestScreen(screenId, pushHistory = true) {
    if (!screenId) return;
    if (pushHistory && this.activeTestScreenId && this.activeTestScreenId !== screenId) {
      this.testHistory.push(this.activeTestScreenId);
    }
    this.activeTestScreenId = Number(screenId);
    this.nodeEls.forEach((el, id) => el.classList.toggle('active-route', id === this.activeTestScreenId));
    this.select({ kind: 'node', id: this.activeTestScreenId });
    this.renderTestHud();
  }

  stepBackTest() {
    if (!this.testHistory.length) return;
    const prev = this.testHistory.pop();
    this.setActiveTestScreen(prev, false);
  }

  renderTestHud() {
    if (!this.testHud) return;
    clear(this.testHud);
    if (!this.testMode || !this.wf) {
      this.testHud.hidden = true;
      return;
    }
    this.testHud.hidden = false;
    const curScreen = this.screens.get(this.activeTestScreenId);
    const outgoing = (this.wf.links || []).filter(l => l.fromScreenId === this.activeTestScreenId);
    this.testHud.append(
      h('span', { class: 'dz-live-badge' }, `🟢 WORKFLOW TEST · ${curScreen ? curScreen.name : 'Select screen'}`),
      this.testHistory.length > 0 ? h('button', {
        class: 'btn small',
        onclick: e => { e.stopPropagation(); this.stepBackTest(); }
      }, '← Back') : null,
      curScreen ? h('button', {
        class: 'btn small primary',
        title: 'Open this screen in interactive Test Actions mode (test buttons, animations, edit forms, and routing)',
        onclick: e => { e.stopPropagation(); this.app.openScreenModal(curScreen.id, () => this.refresh(), { testActions: true }); }
      }, `📱 Test "${curScreen.name}" Screen Interactive`) : null,
      ...outgoing.map(l => {
        const dest = this.screens.get(l.toScreenId);
        return h('button', {
          class: 'btn small dz-route-pill',
          title: `Trigger "${l.name || 'route'}" (${l.trigger || 'tap'}) → ${dest?.name || `#${l.toScreenId}`}`,
          onclick: e => {
            e.stopPropagation();
            toast(`Route: ${l.name || 'Link'} → ${dest?.name || `#${l.toScreenId}`}`, 'ok', 1800);
            this.setActiveTestScreen(l.toScreenId, true);
          }
        }, `🔗 ${l.name || 'Route'} → ${dest?.name || `#${l.toScreenId}`} →`);
      }),
      h('button', {
        class: 'btn small danger',
        onclick: e => { e.stopPropagation(); this.setTestMode(false); }
      }, '✕ Exit Test')
    );
  }

  /* ---------- geometry ---------- */
  nodeRect(screenId) {
    const n = this.wf.nodes.find(x => x.screenId === screenId), s = this.screens.get(screenId);
    if (!n || !s) return null;
    return { x: n.x, y: n.y, w: s.width, h: n.collapsed ? HEAD : HEAD + s.height, node: n, screen: s };
  }

  linkEnds(l) {
    const a = this.nodeRect(l.fromScreenId), b = this.nodeRect(l.toScreenId);
    if (!a || !b) return null;
    let p0, dir0;
    const el = l.fromNodeId && !a.node.collapsed ? this.full.get(l.fromScreenId)?.nodes.find(e => e.id === l.fromNodeId) : null;
    const right = b.x + b.w / 2 >= a.x + a.w / 2;
    if (el) { const bb = nodeBBox(el, this.full.get(l.fromScreenId).nodes); p0 = { x: a.x + bb.x + bb.w / 2, y: a.y + HEAD + bb.y + bb.h / 2, dot: true }; dir0 = right ? 1 : -1; }
    else { p0 = { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 }; dir0 = right ? 1 : -1; }
    const toLeft = b.x >= a.x + a.w - 1 || (b.x + b.w / 2 >= a.x + a.w / 2 && b.x > a.x);
    const p1 = { x: toLeft ? b.x : b.x + b.w, y: b.node.collapsed ? b.y + HEAD / 2 : b.y + b.h / 2 };
    return { p0, p1, dir0, toLeft };
  }

  /** Path for a link; `vSegs` holds vertical segments of earlier cornered links (for hops). */
  pathFor(l, vSegs) {
    const e = this.linkEnds(l);
    if (!e) return null;
    const { p0, p1 } = e;
    if (l.style === 'cornered') {
      const sx = p1.x >= p0.x ? 1 : -1;
      const midX = (p0.x + p1.x) / 2 + (p0.dot ? sx * 60 : 0);
      const pts = [[p0.x, p0.y], [midX, p0.y], [midX, p1.y], [p1.x, p1.y]];
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
        if (ya === yb && xa !== xb) {                      // horizontal: hop over earlier vertical segments
          const dir = xb > xa ? 1 : -1;
          const hits = vSegs.filter(v => v.x > Math.min(xa, xb) + HOP && v.x < Math.max(xa, xb) - HOP && ya > v.y0 && ya < v.y1).sort((m, n) => dir * (m.x - n.x));
          for (const v of hits) d += ` L ${v.x - dir * HOP} ${ya} A ${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${v.x + dir * HOP} ${ya}`;
        }
        d += ` L ${xb} ${yb}`;
      }
      vSegs.push({ x: midX, y0: Math.min(p0.y, p1.y), y1: Math.max(p0.y, p1.y) });
      return { d, label: { x: midX, y: (p0.y + p1.y) / 2 }, p0 };
    }
    const sx = p1.x >= p0.x ? 1 : -1, c = Math.max(80, Math.abs(p1.x - p0.x) / 2);
    const c1 = { x: p0.x + sx * c, y: p0.y }, c2 = { x: p1.x - (e.toLeft ? 1 : -1) * c, y: p1.y };
    const d = `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p1.x} ${p1.y}`;
    const t = 0.5, mx = (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * c1.x + 3 * (1 - t) * t * t * c2.x + t ** 3 * p1.x;
    const my = (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * c1.y + 3 * (1 - t) * t * t * c2.y + t ** 3 * p1.y;
    return { d, label: { x: mx, y: my }, p0 };
  }

  drawLinks() {
    [...this.linkSvg.querySelectorAll('.lk')].forEach(n => n.remove());
    const vSegs = [];
    let minX = 0, minY = 0, maxX = 4000, maxY = 4000;
    for (const n of this.wf.nodes) { const r = this.nodeRect(n.screenId); if (r) { maxX = Math.max(maxX, r.x + r.w + 400); maxY = Math.max(maxY, r.y + r.h + 400); minX = Math.min(minX, r.x - 400); minY = Math.min(minY, r.y - 400); } }
    this.linkSvg.setAttribute('width', maxX - minX); this.linkSvg.setAttribute('height', maxY - minY);
    this.linkSvg.style.left = `${minX}px`; this.linkSvg.style.top = `${minY}px`;
    this.linkSvg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'lk'); this.linkSvg.appendChild(g);
    for (const l of this.wf.links) {
      const p = this.pathFor(l, vSegs);
      if (!p) continue;
      const sel = this.sel?.kind === 'link' && this.sel.id === l.id;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', p.d); path.setAttribute('class', `link${sel ? ' sel' : ''}`); path.setAttribute('marker-end', `url(#wf-arrow${sel ? '-sel' : ''})`);
      path.dataset.link = l.id; path.setAttribute('tabindex', '0'); path.setAttribute('aria-label', `link ${l.name}`);
      const tip = document.createElementNS(NS, 'title'); tip.textContent = `${l.name || '(unnamed)'}${l.descriptionDev ? `\n${l.descriptionDev}` : ''}`; path.appendChild(tip);
      g.appendChild(path);
      if (p.p0.dot) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', p.p0.x); c.setAttribute('cy', p.p0.y); c.setAttribute('r', 7); c.setAttribute('fill', sel ? '#ffd54a' : '#6aa7ff'); g.appendChild(c); }
      if (l.name) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', p.label.x); t.setAttribute('y', p.label.y - 8); t.setAttribute('text-anchor', 'middle'); t.textContent = l.name; g.appendChild(t); }
    }
    if (this.tempLine) { const t = document.createElementNS(NS, 'line'); for (const [k, v] of Object.entries({ x1: this.tempLine.x0, y1: this.tempLine.y0, x2: this.tempLine.x1, y2: this.tempLine.y1, stroke: '#ffd54a', 'stroke-width': 4, 'stroke-dasharray': '10 6' })) t.setAttribute(k, v); t.setAttribute('class', 'lk'); this.linkSvg.appendChild(t); }
  }

  /* ---------- view ---------- */
  centerWorld() { const r = this.viewport.getBoundingClientRect(); return { x: (r.width / 2 - this.view.tx) / this.view.z, y: (r.height / 2 - this.view.ty) / this.view.z }; }
  worldPoint(ev) { const r = this.viewport.getBoundingClientRect(); return { x: (ev.clientX - r.left - this.view.tx) / this.view.z, y: (ev.clientY - r.top - this.view.ty) / this.view.z }; }
  applyView() { this.world.style.transform = `translate(${this.view.tx}px, ${this.view.ty}px) scale(${this.view.z})`; if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.view.z * 100)}%`; }
  zoomBy(f, cx, cy) {
    const r = this.viewport.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2;
    const z = Math.min(2, Math.max(0.03, this.view.z * f)), k = z / this.view.z;
    this.view = { z, tx: cx - (cx - this.view.tx) * k, ty: cy - (cy - this.view.ty) * k }; this.applyView();
  }
  fit() {
    const rects = this.wf.nodes.map(n => this.nodeRect(n.screenId)).filter(Boolean);
    const r = this.viewport.getBoundingClientRect();
    if (!rects.length || !r.width) { this.view = { tx: 40, ty: 40, z: 0.35 }; return this.applyView(); }
    const x0 = Math.min(...rects.map(q => q.x)), y0 = Math.min(...rects.map(q => q.y)), x1 = Math.max(...rects.map(q => q.x + q.w)), y1 = Math.max(...rects.map(q => q.y + q.h));
    const z = Math.min(1, (r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0));
    this.view = { z, tx: (r.width - (x1 - x0) * z) / 2 - x0 * z, ty: (r.height - (y1 - y0) * z) / 2 - y0 * z }; this.applyView();
  }

  /* ---------- interaction ---------- */
  bind() {
    const vp = this.viewport;
    vp.addEventListener('wheel', ev => { ev.preventDefault(); const r = vp.getBoundingClientRect(); this.zoomBy(Math.exp(-ev.deltaY * 0.0016), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    vp.addEventListener('keydown', ev => {
      if (ev.code === 'Space') { this.space = true; ev.preventDefault(); }
      const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && k === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
      if (ctrl && k === 'y') { ev.preventDefault(); this.redo(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.deleteSelected(); }
    });
    vp.addEventListener('keyup', ev => { if (ev.code === 'Space') this.space = false; });
    vp.addEventListener('dblclick', ev => { const l = ev.target.closest?.('path.link'); if (l) this.editLink(Number(l.dataset.link)); });
    // a screen dragged from the library: placed where it is dropped, with the screens its routes lead to
    vp.addEventListener('dragover', ev => { if (this.wf && ev.dataTransfer?.types?.includes('application/x-ud')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    vp.addEventListener('drop', async ev => {
      let d = null;
      try { d = JSON.parse(ev.dataTransfer.getData('application/x-ud') || 'null'); } catch { /* not ours */ }
      if (!this.wf || !d) return;
      ev.preventDefault();
      if (d.type !== 'screen') return toast('Only screens can be dropped into a workflow', 'info', 2200);
      const p = this.worldPoint(ev);
      try {
        const s = this.screens.get(Number(d.id)) || await api.getDesign('screen', Number(d.id));
        await this.importScreen(s, { x: Math.round(p.x - (s.width || 390) / 2), y: Math.round(p.y - HEAD / 2) });
      } catch (e) { toast(e.message, 'error'); }
    });
    vp.addEventListener('pointerdown', ev => this.down(ev));
    vp.addEventListener('pointermove', ev => this.move(ev));
    vp.addEventListener('pointerup', ev => this.up(ev));
  }

  nodeAt(ev) { return ev.target.closest?.('.wf-node') || null; }

  down(ev) {
    if (ev.target.closest?.('.wf-test-hud')) return;
    vpFocus(this.viewport);
    if (ev.button === 1 || (ev.button === 0 && this.space)) { this.op = { kind: 'pan', x: ev.clientX, y: ev.clientY, tx: this.view.tx, ty: this.view.ty }; capture(this.viewport, ev); ev.preventDefault(); return; }
    if (ev.button !== 0) return;
    const linkEl = ev.target.closest?.('path.link');
    if (linkEl) {
      const linkId = Number(linkEl.dataset.link);
      this.select({ kind: 'link', id: linkId });
      if (this.testMode) {
        const l = this.wf.links.find(x => x.id === linkId);
        if (l) {
          const dest = this.screens.get(l.toScreenId);
          toast(`Route: ${l.name || 'Link'} → ${dest?.name || `#${l.toScreenId}`}`, 'ok', 1800);
          this.setActiveTestScreen(l.toScreenId, true);
        }
      }
      return;
    }
    const node = this.nodeAt(ev);
    if (node) {
      const sid = Number(node.dataset.screen), p = this.worldPoint(ev), r = this.nodeRect(sid);
      this.select({ kind: 'node', id: sid });
      if (this.testMode && !ev.target.closest('header')) {
        const local = { x: p.x - r.x, y: p.y - r.y - HEAD };
        const hitId = this.hitNodeAt(sid, local);
        const matchLink = (this.wf.links || []).find(l => l.fromScreenId === sid && (l.fromNodeId === hitId || l.fromNodeId == null));
        if (matchLink) {
          const dest = this.screens.get(matchLink.toScreenId);
          toast(`Route: ${matchLink.name || 'Link'} → ${dest?.name || `#${matchLink.toScreenId}`}`, 'ok', 1800);
          this.setActiveTestScreen(matchLink.toScreenId, true);
        } else {
          this.setActiveTestScreen(sid, true);
        }
        return;
      }
      if (this.linkTool && !ev.target.closest('header')) {
        const local = { x: p.x - r.x, y: p.y - r.y - HEAD };
        this.op = { kind: 'link', from: sid, fromNodeId: this.hitNodeAt(sid, local), x0: p.x, y0: p.y };
      } else if (ev.target.closest('header') && !ev.target.closest('button')) {
        if (this.testMode) { this.setActiveTestScreen(sid, true); return; }
        if (r?.node?.locked) { toast('Screen position is locked (click 🔒 to unlock)', 'info', 1800); return; }
        this.op = { kind: 'drag', sid, start: p, ox: r.x, oy: r.y, moved: false, snap: this.snapshot() };
      } else return;
      capture(this.viewport, ev);
      return;
    }
    this.select(null);
    this.op = { kind: 'pan', x: ev.clientX, y: ev.clientY, tx: this.view.tx, ty: this.view.ty };
    capture(this.viewport, ev);
  }

  /** Smallest element under a point of a screen (text, instance or button-like shape): the trigger of a new link. */
  hitNodeAt(screenId, pt) {
    const full = this.full.get(screenId);
    if (!full) return null;
    let best = null, area = Infinity;
    for (const e of full.nodes) {
      if (e.parentId != null || e.role === 'bg' || e.role === 'bg-glow' || e.role === 'shine' || !e.visible) continue;
      if (!(e.tag === 'text' || e.kind === 'instance' || e.role === 'button' || e.role === 'card' || e.role === 'field' || e.tag === 'rect')) continue;
      const b = nodeBBox(e, full.nodes);
      if (pt.x >= b.x - 4 && pt.x <= b.x + b.w + 4 && pt.y >= b.y - 4 && pt.y <= b.y + b.h + 4 && b.w * b.h < area && b.w * b.h < full.width * full.height * 0.6) { best = e; area = b.w * b.h; }
    }
    return best?.id ?? null;
  }

  move(ev) {
    const op = this.op;
    if (!op) return;
    if (op.kind === 'pan') { this.view.tx = op.tx + ev.clientX - op.x; this.view.ty = op.ty + ev.clientY - op.y; this.applyView(); return; }
    const p = this.worldPoint(ev);
    if (op.kind === 'drag') {
      const n = this.wf.nodes.find(x => x.screenId === op.sid);
      n.x = Math.round(op.ox + p.x - op.start.x); n.y = Math.round(op.oy + p.y - op.start.y); op.moved = true;
      const el = this.nodeEls.get(op.sid); el.style.left = `${n.x}px`; el.style.top = `${n.y}px`;
      this.drawLinks();
    } else if (op.kind === 'link') {
      this.tempLine = { x0: op.x0, y0: op.y0, x1: p.x, y1: p.y }; this.drawLinks();
      const over = this.nodeAt(ev);
      this.nodeEls.forEach(e => e.classList.toggle('link-src', e === over && Number(e.dataset.screen) !== op.from));
    }
  }

  async up(ev) {
    const op = this.op; this.op = null;
    if (!op) return;
    if (op.kind === 'drag' && op.moved) {
      if (op.snap) this.pushUndo(op.snap);
      const n = this.wf.nodes.find(x => x.screenId === op.sid);
      await api.placeScreen(this.wf.id, { screenId: n.screenId, x: n.x, y: n.y, collapsed: n.collapsed });
      this.checkDirty();
    } else if (op.kind === 'link') {
      this.tempLine = null; this.nodeEls.forEach(e => e.classList.remove('link-src'));
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.wf-node');
      const to = target ? Number(target.dataset.screen) : null;
      if (to && to !== op.from) {
        const info = await this.linkDialog({ from: op.from, to, style: this.linkStyle });
        if (!info) { this.drawLinks(); return; }                    // cancelled: nothing is created
        try {
          this.pushUndo();
          const link = await api.addLink(this.wf.id, { fromScreenId: op.from, toScreenId: to, fromNodeId: op.fromNodeId, ...info });
          await this.refresh(); this.select({ kind: 'link', id: link.id }); toast('link created', 'ok', 1800);
        } catch (e) { toast(e.message, 'error'); this.drawLinks(); }
      } else this.drawLinks();
    }
  }

  /**
   * The form for a link: what it is called and, for the dev team, what happens on this transition (description-dev).
   * New link: { from, to }. Existing link: { link } (also lets you change the screen it goes to). Resolves to the fields, or null when cancelled.
   */
  linkDialog({ link = null, from = link?.fromScreenId, to = link?.toScreenId, style = link?.style || this.linkStyle } = {}) {
    const name = (id) => this.screens.get(id)?.name || '?';
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const inName = h('input', { type: 'text', placeholder: 'e.g. Open question' }); inName.value = link ? link.name : `Open ${name(to)}`;
      const inDev = h('textarea', { rows: 6, placeholder: 'What happens on this transition? Conditions, data passed along, animation, error cases…' }); inDev.value = link?.descriptionDev || '';
      const trg = h('select', {}, TRIGGERS.map(t => h('option', { value: t }, t))); trg.value = link?.trigger || 'tap';
      const sty = h('select', {}, h('option', { value: 'curved' }, 'curved'), h('option', { value: 'cornered' }, 'cornered')); sty.value = style;
      const dest = link ? h('select', {}, this.wf.nodes.map(n => h('option', { value: n.screenId }, name(n.screenId)))) : null;
      if (dest) dest.value = link.toScreenId;
      const fld = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
      const ok = () => {
        if (!inName.value.trim()) { toast('Give the link a name', 'error'); inName.focus(); return; }
        const out = { name: inName.value.trim(), descriptionDev: inDev.value, trigger: trg.value, style: sty.value };
        if (dest && Number(dest.value) !== link.toScreenId) out.toScreenId = Number(dest.value);
        finish(out); m.close();
      };
      const m = modal({ title: link ? `Link: ${name(from)} → ${name(to)}` : `New link: ${name(from)} → ${name(to)}`, wide: true,
        content: h('div', { class: 'stack' }, fld('Name', inName), fld('description-dev (for the dev team)', inDev), dest ? fld('Goes to', dest) : null, h('div', { class: 'grid2' }, fld('Gesture', trg), fld('Line style', sty))),
        onClose: () => finish(null),
        actions: close => [h('button', { class: 'btn', onclick: () => { finish(null); close(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: ok }, link ? 'Apply' : 'Create link')] });
      inName.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      setTimeout(() => { inName.focus(); inName.select(); }, 30);
    });
  }

  async editLink(id) {
    const link = this.wf.links.find(l => l.id === id);
    if (!link) return;
    const info = await this.linkDialog({ link });
    if (!info) return;
    try { await api.updateLink(this.wf.id, id, info); await this.refresh(); this.select({ kind: 'link', id }); } catch (e) { toast(e.message, 'error'); }
  }

  select(sel) { this.sel = sel; this.nodeEls.forEach((e, id) => e.classList.toggle('sel', sel?.kind === 'node' && sel.id === id)); this.drawLinks(); this.renderInspector(); }

  async toggleCollapse(n) { n.collapsed = !n.collapsed; await api.placeScreen(this.wf.id, { screenId: n.screenId, x: n.x, y: n.y, collapsed: n.collapsed }); await this.refresh(); }
  async collapseAll(v) { await Promise.all(this.wf.nodes.map(n => api.placeScreen(this.wf.id, { screenId: n.screenId, x: n.x, y: n.y, collapsed: v }))); await this.refresh(); this.fit(); }
  async addAll() {
    const have = new Set(this.wf.nodes.map(n => n.screenId)); let i = this.wf.nodes.length;
    for (const s of this.screens.values()) if (!have.has(s.id)) { await api.placeScreen(this.wf.id, { screenId: s.id, x: (i % 5) * 560, y: Math.floor(i / 5) * 980 }); i++; }
    await this.refresh(); this.fit();
  }

  async autoLayout() {
    const nodes = this.wf.nodes.map(n => n.screenId), level = new Map();
    const incoming = new Set(this.wf.links.map(l => l.toScreenId));
    const queue = nodes.filter(id => !incoming.has(id)); if (!queue.length && nodes.length) queue.push(nodes[0]);
    queue.forEach(id => level.set(id, 0));
    for (let i = 0; i < queue.length; i++) for (const l of this.wf.links.filter(x => x.fromScreenId === queue[i])) if (!level.has(l.toScreenId)) { level.set(l.toScreenId, level.get(queue[i]) + 1); queue.push(l.toScreenId); }
    let extra = Math.max(0, ...level.values()) + 1;
    for (const id of nodes) if (!level.has(id)) level.set(id, extra);
    const rows = new Map();
    await Promise.all(nodes.map(id => { const lv = level.get(id), row = rows.get(lv) || 0; rows.set(lv, row + 1); const s = this.screens.get(id); return api.placeScreen(this.wf.id, { screenId: id, x: lv * (s.width + 170), y: row * (s.height + HEAD + 90) }); }));
    await this.refresh(); this.fit();
  }

  async deleteLink(id) { await api.deleteLink(this.wf.id, id); this.sel = null; await this.refresh(); }

  /* ---------- inspector ---------- */
  renderInspector() {
    const root = this.inspector; clear(root);
    const wf = this.wf, sec = (title, ...k) => h('div', { class: 'insp-sec' }, h('h4', {}, title), ...k);
    const fld = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const txt = (v, commit, ph = '') => { const i = h('input', { type: 'text', placeholder: ph }); i.value = v ?? ''; i.addEventListener('change', () => commit(i.value)); return i; };
    const area = (v, commit, rows = 5) => { const t = h('textarea', { rows }); t.value = v ?? ''; t.addEventListener('change', () => commit(t.value)); return t; };

    const link = this.sel?.kind === 'link' ? wf.links.find(l => l.id === this.sel.id) : null;
    if (link) {
      const src = this.full.get(link.fromScreenId);
      const opts = [h('option', { value: '' }, '(whole screen)'), ...(src?.nodes || []).filter(e => e.parentId == null && (e.tag === 'text' || e.kind === 'instance' || e.role === 'button')).map(e => h('option', { value: e.id, selected: e.id === link.fromNodeId }, e.tag === 'text' ? `text "${e.text.slice(0, 28)}"` : e.name || `${e.refType || e.tag} #${e.id}`))];
      const elSel = h('select', {}, opts); elSel.value = link.fromNodeId ?? '';
      elSel.addEventListener('change', async () => { await api.updateLink(wf.id, link.id, { fromNodeId: elSel.value ? Number(elSel.value) : null }); await this.refresh(); this.select(this.sel); });
      const toSel = h('select', {}, wf.nodes.map(n => h('option', { value: n.screenId, selected: n.screenId === link.toScreenId }, this.screens.get(n.screenId)?.name)));
      toSel.value = link.toScreenId; toSel.addEventListener('change', async () => {
        await api.updateLink(wf.id, link.id, { toScreenId: Number(toSel.value) }); await this.refresh(); this.select(this.sel);
        toast(`The link now goes to ${this.screens.get(Number(toSel.value))?.name}: describe the transition`, 'info', 2400);
        await this.editLink(link.id);                                  // same form as a double-click: write the description while changing the screen
      });
      const upd = async p => { await api.updateLink(wf.id, link.id, p); Object.assign(link, p); this.drawLinks(); this.checkDirty(); emit('workflows:changed'); };
      const styleSel = h('select', {}, h('option', { value: 'curved' }, 'curved'), h('option', { value: 'cornered' }, 'cornered')); styleSel.value = link.style; styleSel.addEventListener('change', () => upd({ style: styleSel.value }));
      const trg = h('select', {}, TRIGGERS.map(t => h('option', { value: t }, t))); trg.value = link.trigger; trg.addEventListener('change', () => upd({ trigger: trg.value }));
      root.append(sec(`Link · ${this.screens.get(link.fromScreenId)?.name} → ${this.screens.get(link.toScreenId)?.name}`,
        fld('Name', txt(link.name, v => upd({ name: v }), 'e.g. Open question')), fld('description-dev', area(link.descriptionDev, v => upd({ descriptionDev: v }))),
        fld('Triggered by (element on the source screen)', elSel), fld('Goes to', toSel), h('div', { class: 'grid2' }, fld('Line style', styleSel), fld('Gesture', trg)),
        h('button', { class: 'btn danger small', onclick: () => this.deleteLink(link.id) }, 'Delete link')));
    }
    const visSel = h('select', {}, h('option', { value: 'public' }, '🌐 Public (all projects)'), h('option', { value: 'project' }, '📁 Project-only'));
    visSel.value = wf.visibility || 'public';
    visSel.addEventListener('change', async () => { await api.updateWorkflow(wf.id, { visibility: visSel.value, projectId: state.currentProjectId || wf.projectId || 1 }); wf.visibility = visSel.value; this.checkDirty(); emit('workflows:changed'); });
    root.append(sec(`Workflow · ${wf.key}`,
      fld('Name', txt(wf.name, async v => { if (await this.rename(v, { syncInspector: false }) && this.titleInput) { this.titleInput.value = this.wf.name; this.titleInput.dispatchEvent(new Event('input')); } })),
      fld('Label', txt(wf.label, async v => { await api.updateWorkflow(wf.id, { label: v }); wf.label = v; this.checkDirty(); })),
      fld('Visibility', visSel),
      h('div', { class: 'row wrap' },
        h('span', { class: 'badge' }, `Owner ${ownerLabel(wf.rootOwnerUsername || wf.creatorUsername, wf.rootOwnerId || wf.creatorId || 1)}`),
        h('button', { class: 'btn small', onclick: () => openLineageModal('workflow', wf.id) }, '🌳 Lineage & Root Owner')
      ),
      fld('description-dev (for the dev team)', area(wf.descriptionDev, async v => { await api.updateWorkflow(wf.id, { descriptionDev: v }); wf.descriptionDev = v; this.checkDirty(); }, 8))));
    root.append(sec(`Links (${wf.links.length})`, h('div', { class: 'el-list', style: { maxHeight: '260px' } },
      wf.links.map(l => h('div', { class: `el-row${link?.id === l.id ? ' on' : ''}`, onclick: () => this.select({ kind: 'link', id: l.id }) },
        h('span', { class: 'grow' }, `${l.name || '(unnamed)'}`), h('span', { class: 'dim' }, `${this.screens.get(l.fromScreenId)?.key} → ${this.screens.get(l.toScreenId)?.key}`))))),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Tip: switch on “Link tool”, then drag from a button on one screen to another screen.'));
  }
}

function vpFocus(el) { el.focus({ preventScroll: true }); }

/** Pointer capture keeps drags alive outside the canvas; it throws for synthetic events, which is harmless. */
function capture(el, ev) { try { el.setPointerCapture(ev.pointerId); } catch { /* no active pointer */ } }
