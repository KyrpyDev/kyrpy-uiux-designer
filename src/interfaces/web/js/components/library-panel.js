/**
 * Left panel: the libraries along the hierarchy  Paths → Icons → Buttons → Elements,  the Screens catalog and the Workflows.
 * Items are dragged onto the open designer (the hierarchy rules decide where they may go).
 */
import { h, clear, debounce, promptBox, confirmBox, toast } from '../dom.js';
import { ibtn, iconEl } from '../icons.js';
import { api } from '../api.js';
import { state, on, emit, libOf, PLURAL, canEditOwned } from '../state.js';
import { newDesign, cloneDesign, deleteDesign, downloadSvg, importSvgDialog, importFolderOrFontDialog, reloadLibrary } from '../actions.js';
import { openExportDialog } from './export-dialog.js';
import { openLineageModal } from './collab-modals.js';
import { buildOnlinePanel } from './online-icons-panel.js';

const ONLINE_KEY = 'ud_online_icons';
const onlineShown = () => { try { return localStorage.getItem(ONLINE_KEY) === '1'; } catch { return false; } };
/** The online source is probed once per page load; when its API fails the Online switch is removed and the panel stays hidden. */
let onlineOk = null, onlineProbe = null;
const probeOnline = () => onlineProbe || (onlineProbe = api.get('/api/online/sources').then(() => api.get('/api/online/search?prefix=tabler&start=0&limit=1')).then(() => { onlineOk = true; }, () => { onlineOk = false; }));
const setOnlineShown = v => { try { localStorage.setItem(ONLINE_KEY, v ? '1' : '0'); } catch { /* storage blocked: toggle lasts for this view only */ } };
import { openCopyMoveToProjectsModal, openItemBrowserModal, openLibraryExportImportModal, refreshGlobalLibraryAndCounts } from './item-browser.js';
import { TYPES, canContain, BUTTON_STYLES, DEFAULT_PROJECT_BUTTON_SETTINGS, scopeFirst, visClass } from '/domain/entities.js';

let usedCache = { arr: null, set: null };
/** Set of "type:id" keys the active project uses (from /api/library usedKeys), cached per response. */
/** Active project + public user id: the library tiers (orange = this project, none = public). */
const libScope = () => ({ projectId: state.activeProjectId ?? null, publicUserId: state.publicUserId ?? null });
const usedSet = () => { const a = state.library?.usedKeys; if (a !== usedCache.arr) usedCache = { arr: a, set: new Set(a || []) }; return usedCache.set; };
import { iconPack, expandIconSummary } from '/domain/icon-summary.js';
import { ensureIconSymbols, loadIcons } from '../icon-store.js';
import { editedIndex, clearEdited, editedKeys } from '../edited.js';
import { libraryMenuTools } from './menu-editor.js';

/** Above this many icons the icons tab searches on the server (the grid itself is always virtualized). */
const LARGE_ICON_LIBRARY = 1500;
/** Known icon packs (scripts/import-icon-packs.js) in chip order; any other pack gets a chip after them. */
const ICON_PACKS = [['lucide', 'Lucide'], ['tabler', 'Tabler'], ['heroicons', 'Heroicons'], ['phosphor', 'Phosphor'], ['bootstrap', 'Bootstrap']];
const TABS = [['path', 'Paths'], ['icon', 'Icons'], ['button', 'Buttons'], ['element', 'Elements'], ['screen', 'Screens'], ['workflow', 'Workflows']];
const TAB_ICONS = { path: 'bezier', icon: 'star', button: 'circle', element: 'rect', screen: 'monitor', workflow: 'workflow' };
const TOOLS_COLLAPSED_KEY = 'ud_lib_tools_collapsed';
const HINT = {
  path: 'Reusable vector path groups. Drag into an icon.',
  icon: 'Icons are built from path groups. Drag into a button or element.',
  button: 'Buttons hold an icon and can open popup / rotating menus. Drag into an element or screen.',
  element: 'HTML elements, forms, cards… built from icons and buttons. Drag into a screen.'
};

export class LibraryPanel {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.q = {}; this.cat = {};
    this.workflows = [];
    // sync events arrive on every write (also our own edits): re-render only when what this tab shows really changed
    on('library:changed', () => { this.loadWorkflows(); this.softRefresh(); });
    on('project:changed', () => { this.screensList = null; this.loadWorkflows(); this.renderBody(); });
    on('theme:changed', () => this.renderBody());
    on('screen:saved', () => this.renderBody());
    on('workflows:changed', () => this.loadWorkflows());
    this.render();
    this.loadWorkflows();
  }

  render() {
    clear(this.root);
    this.tabsEl = h('div', { class: 'lib-tabs', role: 'tablist' });
    this.bodyEl = h('div', { class: 'lib-body' });
    this.root.append(this.tabsEl, this.bodyEl);
    this.renderTabs();
    this.renderBody();
  }

  renderTabs() {
    clear(this.tabsEl);
    for (const [k, label] of TABS) {
      const count = k === 'workflow'
        ? this.workflows.length
        : k === 'screen'
          ? (this.screensList?.length ?? state.counts?.screens ?? '')
          : (libOf(k)?.length ?? '');
      this.tabsEl.append(h('button', {
        class: `lib-tab-ico${state.tab === k ? ' on' : ''}`,
        role: 'tab',
        'aria-selected': state.tab === k,
        'aria-label': `${label} (${count})`,
        'data-tip': `${label} (${count})\nClick: show the library · Double-click: open its designer`,
        onclick: () => { state.tab = k; this.renderTabs(); this.renderBody(); },
        ondblclick: () => window.dispatchEvent(new CustomEvent('ud:open-page', { detail: k }))
      }, iconEl(TAB_ICONS[k], { size: 18 }), h('span', { class: 'lib-tab-count' }, String(count))));
    }
  }

  async loadWorkflows() {
    try { this.workflows = await api.workflows({ includePublic: true }); } catch { this.workflows = []; }
    this.renderTabs();
    if (state.tab === 'workflow') this.renderBody();
  }

  /** What the open tab shows (rows + edit marks + filters): equal signatures mean the list on screen is still right. */
  bodySig() {
    const tab = state.tab;
    const rows = tab === 'screen' ? this.screensList : tab === 'workflow' ? this.workflows : state.library?.[PLURAL[tab]];
    if (!rows) return null;
    const rowSig = tab === 'icon' ? `${rows.length}:${state.library?.iconsVersion || ''}` : rows.map(r => `${r.id}:${r.updatedAt || ''}:${r.name}:${r.visibility || ''}`).join('|');
    return `${tab}#${state.themeKey}#${state.visibilityFilter}#${state.activeProjectId}#${editedKeys().join(',')}#${rowSig}`;
  }

  /** Background refresh: fetches the screen list again and re-renders only when the signature moved (scroll and cells stay put otherwise). */
  async softRefresh() {
    if (state.tab === 'screen') {
      try { this.screensList = await api.list('screen', '', { includePublic: true }); } catch { /* keep the old list */ }
    }
    const sig = this.bodySig();
    if (sig != null && sig === this.renderedSig) return;
    this.renderBody();
  }

  renderBody() {
    this.renderTabs();
    const keepScroll = this.bodyEl.querySelector('.lib-scroll')?.scrollTop || 0;
    clear(this.bodyEl);
    if (state.tab === 'screen') this.screensTab();
    else if (state.tab === 'workflow') this.workflowsTab();
    else if (state.tab === 'icon') this.iconsTab();
    else this.thumbTab(state.tab);
    this.decorateTools();
    this.renderedSig = this.bodySig();
    const sc = this.bodyEl.querySelector('.lib-scroll');
    if (sc && keepScroll) sc.scrollTop = keepScroll;
  }

  /**
   * Every tab's `.lib-tools` header: keeps the search box on top with two buttons beside it (collapse /
   * expand the filters and tools below it, and hide the whole left panel). The rest of the header, plus
   * the icon pack row, moves into `.lib-tools-more`, which the collapse button hides. The collapsed
   * state is one per-viewer setting shared by all tabs.
   */
  decorateTools() {
    const tools = this.bodyEl.querySelector(':scope > .lib-tools');
    if (!tools || tools.querySelector(':scope > .lib-search-row')) return;
    const search = tools.querySelector(':scope > input[type="search"]');
    const more = h('div', { class: 'lib-tools-more', id: `lib-tools-more-${state.tab}` });
    for (const el of [...tools.children]) if (el !== search) more.append(el);
    const packRow = this.bodyEl.querySelector(':scope > .lib-pack-row');
    if (packRow) more.append(packRow);
    // categories, icon packs and the hint form one section that its own tool (next to the pop-up tools) collapses / expands
    const sect = h('div', { class: 'lib-chips-section' });
    const part = [...more.children].filter(el => (el.classList.contains('cats') && !el.classList.contains('lib-vis-filter')) || el.classList.contains('lib-pack-row') || (el.classList.contains('dim') && el.tagName === 'DIV'));
    if (part.length) { part[0].before(sect); part.forEach(el => sect.append(el)); }
    let sectHidden = false;
    try { sectHidden = localStorage.getItem('ud_lib_chips_hidden') === '1'; } catch { /* storage unavailable */ }
    const sectBtn = ibtn('layers', 'Collapse / expand categories and packs', () => { sectHidden = !sectHidden; paintSect(); try { localStorage.setItem('ud_lib_chips_hidden', sectHidden ? '1' : '0'); } catch { /* storage unavailable */ } }, { cls: 'lib-chips-toggle', size: 15 });
    const paintSect = () => { sect.hidden = sectHidden; sectBtn.classList.toggle('active', !sectHidden); sectBtn.dataset.tip = `${sectHidden ? 'Show' : 'Hide'} the category chips, icon packs and hint`; };
    paintSect();
    let collapsed = false;
    try { collapsed = localStorage.getItem(TOOLS_COLLAPSED_KEY) === '1'; } catch { /* storage unavailable */ }
    const toggle = ibtn('chevron-up', 'Collapse filters and tools', () => apply(!collapsed, true), { cls: 'lib-tools-toggle', size: 15 });
    toggle.setAttribute('aria-controls', more.id);
    const apply = (v, save) => {
      collapsed = v;
      tools.classList.toggle('tools-collapsed', v);
      toggle.setAttribute('aria-expanded', String(!v));
      const label = v ? 'Expand filters and tools' : 'Collapse filters and tools';
      toggle.setAttribute('aria-label', label); toggle.dataset.tip = label;
      toggle.replaceChildren(iconEl(v ? 'chevron-down' : 'chevron-up', { size: 15 }));
      if (save) try { localStorage.setItem(TOOLS_COLLAPSED_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
    };
    const drawer = ibtn('panel-left', 'Hide the library panel', () => window.dispatchEvent(new CustomEvent('ud:toggle-left')), { desc: 'Reopen it from the rail on the left edge', cls: 'lib-drawer-toggle', size: 15 });
    const popBtns = this._toolBtns || []; this._toolBtns = null;
    tools.prepend(h('div', { class: 'lib-search-row' }, search, toggle, ...popBtns, ...(part.length ? [sectBtn] : []), drawer));
    tools.append(more);
    apply(collapsed, false);
  }

  /** Does the open designer accept this kind of design? (used to dim cells that cannot be dropped) */
  accepts(type) { const d = this.app.designer; return !d?.doc || canContain(d.type, type); }

  /* ---------- shared pieces ---------- */
  searchBox(kind, onChange) {
    return h('input', {
      type: 'search',
      placeholder: `Search ${PLURAL[kind] || kind} (name, key, tag, description)…`,
      value: this.q[kind] || '',
      'aria-label': `Search ${kind}`,
      oninput: debounce(e => { this.q[kind] = e.target.value; onChange(); }, 120)
    });
  }

  chips(kind, list, onChange) {
    const cats = [...new Set(list.map(d => d.category).filter(Boolean))].sort();
    return h('div', { class: 'cats' },
      h('button', { class: `cat${!this.cat[kind] ? ' on' : ''}`, onclick: () => { this.cat[kind] = ''; onChange(); } }, 'all'),
      cats.map(c => h('button', { class: `cat${this.cat[kind] === c ? ' on' : ''}`, onclick: () => { this.cat[kind] = c; onChange(); } }, c))
    );
  }

  filtered(kind, list) {
    const q = (this.q[kind] || '').toLowerCase();
    const c = this.cat[kind];
    const vf = state.visibilityFilter || 'all';
    const selProjects = state.selectedProjectIds;
    const activePid = Number(state.activeProjectId || state.currentProjectId || 1);
    const curUserId = Number(state.user?.id || 1);
    // project-scope items first, then the user's own private items, then public ones (each group keeps its order)
    return scopeFirst((list || []).filter(d => {
      const vis = d.visibility || 'public';
      if (vf === 'public' && vis !== 'public') return false;
      if (vf === 'mine' && !(vis === 'project' || (vis === 'private' && Number(d.creatorId || 1) === curUserId))) return false;
      if (vf === 'project' && vis !== 'project') return false;
      if (vis === 'private' && Number(d.creatorId || 1) !== curUserId) return false;
      if (vis === 'project' && d.projectId && vf !== 'mine') {
        if (selProjects && selProjects.size > 0) {
          if (!selProjects.has(Number(d.projectId))) return false;
        } else if (activePid && Number(d.projectId) !== activePid) {
          return false;
        }
      }
      return (!c || d.category === c) && (!q || `${d.key || ''} ${d.name || ''} ${d.label || ''} ${(d.tags || []).join(' ')} ${d.descriptionDev || ''} ${d.description || ''}`.toLowerCase().includes(q));
    }), curUserId, usedSet(), kind, editedIndex(), libScope());
  }

  visBar(onChange) {
    const cur = state.visibilityFilter || 'all';
    const set = v => { state.visibilityFilter = v; onChange(); };
    return h('div', { class: 'cats lib-vis-filter', title: 'Public library · All Projects (your items across all your projects) · Project-only (the active project)' },
      [['all', 'All items'], ['public', '🌐 Public'], ['mine', '🗂 All Projects'], ['project', '📁 Project-only']].map(([k, lbl]) =>
        h('button', { class: `cat${cur === k ? ' on' : ''}`, dataset: { visFilter: k }, onclick: () => set(k) }, lbl)
      ),
      editedKeys().length ? h('button', { class: 'cat', dataset: { clearEdited: '1' }, title: 'The item you are editing is listed first (red edge), the other edited items next (purple), then this project (orange), the rest of your items (green) and the public library (no edge). Click to clear the edit marks.', onclick: () => { clearEdited(); onChange(); } }, `🔴 Clear (${editedKeys().length})`) : null
    );
  }

  /**
   * Universal selection & bulk-transfer bar for every library tab (`path`, `icon`, `button`, `element`, `screen`, `workflow`):
   *  - Select all / Non select / Reverse selection
   *  - Copy / Move selected items (opens the 90%-wide Item Browser modal window)
   *  - Empty Project Private Library (default public libraries are immutable)
   */
  selectionBar(type, getVisible, onSync) {
    const selSet = state.libSel[type] || (state.libSel[type] = new Set());
    const info = h('span', { class: 'muted', style: { fontSize: '10px' } }, `${selSet.size} sel`);
    const updateInfo = () => {
      info.textContent = `${selSet.size} sel`;
      onSync?.();
    };
    const openBrowserWithSelection = mode => {
      const visible = getVisible();
      const byId = new Map(visible.map(x => [x.id, x]));
      const preselected = [...selSet].map(id => {
        const rec = byId.get(id);
        return { type, id, name: rec?.name, key: rec?.key };
      });
      openItemBrowserModal({
        initialType: type,
        preselectedItems: preselected,
        initialMode: mode,
        onDone: () => {
          if (type === 'screen') this.screensList = null;
          if (type === 'workflow') this.loadWorkflows();
          this.renderBody();
        }
      });
    };
    const bar = h('div', { class: 'sel-bar', style: { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
      ibtn('pointer', 'Select all', () => { getVisible().forEach(r => selSet.add(r.id)); updateInfo(); }, { desc: 'Select all visible items', cls: 'lib-sel-all-btn', size: 16 }),
      ibtn('close', 'Deselect all', () => { selSet.clear(); updateInfo(); }, { desc: 'Clear the selection', cls: 'lib-sel-none-btn', size: 16 }),
      ibtn('rotate', 'Reverse selection', () => {
        getVisible().forEach(r => (selSet.has(r.id) ? selSet.delete(r.id) : selSet.add(r.id)));
        updateInfo();
      }, { desc: 'Invert the selection of visible items', cls: 'lib-sel-invert-btn', size: 16 }),
      ibtn('copy', 'Copy to…', () => openBrowserWithSelection('copy'), { desc: 'Open the wide Item Browser to copy selected items to project(s)', cls: 'lib-copy-to-btn', size: 16 }),
      ibtn('import', 'Move to…', () => openBrowserWithSelection('move'), { desc: 'Open the wide Item Browser to move selected items to project(s)', cls: 'lib-move-to-btn', size: 16 }),
      ibtn('export', 'Export / import', () => {
          const preselected = [...selSet].map(id => ({ type, id }));
          openLibraryExportImportModal({
            initialTab: 'export',
            preselectedItems: preselected,
            defaultType: type,
            onDone: async () => {
              if (type === 'screen') this.screensList = null;
              if (type === 'workflow') await this.loadWorkflows();
              this.renderBody();
            }
          });
        }, { desc: 'Export or import paths, icons, buttons, elements, screens and workflows as HTML, SVG or JSON', cls: 'lib-export-import-btn', size: 16 }),
      ibtn('trash', 'Empty private library', async () => {
          const pid = Number(state.activeProjectId || state.currentProjectId || 1);
          const proj = (state.projects || []).find(p => p.id === pid);
          if (!(await confirmBox(`Empty private ${PLURAL[type] || type} library of project "${proj?.name || '#' + pid}"? Default/public items cannot be emptied.`, { okLabel: 'Empty Private Library' }))) return;
          try {
            const res = await api.emptyProjectLibrary(pid, { itemType: type });
            selSet.clear();
            await refreshGlobalLibraryAndCounts();
            if (type === 'screen') this.screensList = null;
            if (type === 'workflow') await this.loadWorkflows();
            this.renderBody();
            toast(`Emptied ${res.emptiedCount} private ${type}(s) to Trash`, 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        }, { desc: 'Empty the active project’s private library (default libraries are immutable)', cls: 'lib-empty-private-btn', size: 16 }),
      info
    );
    bar._updateInfo = updateInfo;
    return bar;
  }

  toolbar(type, rec) {
    const canMove = !rec.builtin && canEditOwned(rec);   // owner, or the superadmin curating a public-library item
    return h('div', { class: 'tb' },
      ibtn('pencil', 'Open in designer', e => { e.stopPropagation(); this.app.openDesign(type, rec.id); }),
      ...['path', 'icon', 'button', 'element', 'screen'].includes(type) ? [
        h('button', { class: 'tb-order-front', disabled: !canMove, title: canMove ? 'Move forward in the display order (Shift: to the very front)' : 'Only your own items can be reordered', onclick: e => { e.stopPropagation(); this.reorder(type, rec, e.shiftKey ? 'front' : 'forward'); } }, '◀'),
        h('button', { class: 'tb-order-back', disabled: !canMove, title: canMove ? 'Move back in the display order (Shift: to the very back)' : 'Only your own items can be reordered', onclick: e => { e.stopPropagation(); this.reorder(type, rec, e.shiftKey ? 'back' : 'backward'); } }, '▶')
      ] : [],
      h('button', {
        title: 'Copy to projects… (cascades sub-items)',
        onclick: e => {
          e.stopPropagation();
          openCopyMoveToProjectsModal({
            items: [{ type, id: rec.id, name: rec.name, key: rec.key, builtin: rec.builtin, creatorId: rec.creatorId }],
            mode: 'copy',
            onDone: () => { if (type === 'screen') this.screensList = null; this.renderBody(); }
          });
        }
      }, '📥'),
      h('button', {
        disabled: !canMove,
        title: canMove
          ? 'Move to your projects… (cascades sub-items)'
          : 'Default basic items and items owned by other users cannot be moved (only copied)',
        onclick: e => {
          e.stopPropagation();
          if (!canMove) return;
          openCopyMoveToProjectsModal({
            items: [{ type, id: rec.id, name: rec.name, key: rec.key, builtin: rec.builtin, creatorId: rec.creatorId }],
            mode: 'move',
            onDone: () => { if (type === 'screen') this.screensList = null; this.renderBody(); }
          });
        }
      }, '📤'),
      ibtn('copy', 'Clone', async e => { e.stopPropagation(); await cloneDesign(type, rec); }, { desc: 'Clone (tracks root owner lineage)' }),
      ibtn('collab', 'Lineage', e => { e.stopPropagation(); openLineageModal(type, rec.id); }, { desc: 'Root owner & clone lineage' }),
      ibtn('export', 'Export SVG', e => { e.stopPropagation(); downloadSvg(type, rec.id, type === 'icon' || type === 'path' ? { frame: 0 } : {}); }, { desc: 'Export SVG (with animation)' }),
      ...(type === 'button' ? [
        h('button', { class: 'tb-menu-add', disabled: !canMove, title: canMove ? 'Add a menu item to this button' : 'Only your own buttons can get menu items (clone it first)', onclick: e => { e.stopPropagation(); if (canMove) libraryMenuTools.addItem(rec).then(() => this.renderBody()); } }, '＋'),
        h('button', { class: 'tb-submenu-add', disabled: !canMove, title: canMove ? 'Add a sub menu item (choose the parent item)' : 'Only your own buttons can get menu items (clone it first)', onclick: e => { e.stopPropagation(); if (canMove) libraryMenuTools.addSubItem(rec).then(() => this.renderBody()); } }, '↳')
      ] : []),
      ibtn('trash', 'Move to trash', async e => { e.stopPropagation(); await deleteDesign(type, rec); })
    );
  }

  /** Moves an item in the display order (position); the grouping (edited / own / used / public) is kept by the panel. */
  async reorder(type, rec, mode) {
    try {
      const r = await api.reorderDesign(type, rec.id, mode);
      if (!r.moved) { toast(mode === 'front' || mode === 'forward' ? 'Already at the front' : 'Already at the back', 'info', 1400); return; }
      await reloadLibrary({ silent: true });
      if (type === 'screen') this.screensList = null;
      this.renderBody();
    } catch (e) { toast(e.message, 'error'); }
  }

  dragData(type, rec) {
    return e => { e.dataTransfer.setData('application/x-ud', JSON.stringify({ type, id: rec.id })); e.dataTransfer.effectAllowed = 'copy'; };
  }

  /**
   * Per-project Button Style (default `'circle'`) & Icon Size Slider (`50–100%`)
   * that applies to all buttons under the Buttons library.
   */
  projectButtonSettingsBar() {
    const pid = Number(state.activeProjectId || state.currentProjectId || 1);
    const proj = (state.projects || []).find(p => Number(p.id) === pid) || state.projects?.[0];
    const curStyle = proj?.settings?.buttonStyle || proj?.buttonStyle || DEFAULT_PROJECT_BUTTON_SETTINGS.buttonStyle || 'circle';
    const curPct = Math.max(50, Math.min(100, Number(proj?.settings?.buttonIconSizePct ?? proj?.buttonIconSizePct ?? DEFAULT_PROJECT_BUTTON_SETTINGS.buttonIconSizePct ?? 95)));

    const styleSel = h('select', {
      class: 'project-button-style-select',
      name: 'project-button-style',
      'aria-label': 'Button style for all buttons',
      title: 'Button style applied to all buttons in this project (default: Circle)',
      style: { flex: '1', minWidth: '110px' }
    }, BUTTON_STYLES.map(s => h('option', { value: s.key, selected: s.key === curStyle }, s.label)));

    const pctBadge = h('span', { class: 'badge project-button-icon-pct', style: { minWidth: '38px', textAlign: 'center' } }, `${curPct}%`);
    const iconSlider = h('input', {
      type: 'range',
      class: 'project-button-icon-slider',
      name: 'project-button-icon-size',
      'aria-label': 'Button icon size percentage (50% to 100%)',
      min: '50',
      max: '100',
      step: '1',
      value: String(curPct),
      title: 'Icon size slider for buttons (50%–100%), stored per project',
      style: { flex: '1', minWidth: '80px', cursor: 'pointer' },
      oninput: e => {
        pctBadge.textContent = `${e.target.value}%`;
      }
    });

    const applySettings = async () => {
      const nextStyle = styleSel.value;
      const nextPct = Math.max(50, Math.min(100, Number(iconSlider.value) || 70));
      try {
        const res = await api.applyProjectButtonSettings(pid, {
          buttonStyle: nextStyle,
          buttonIconSizePct: nextPct,
          scope: 'all'
        });
        if (proj) {
          proj.settings = { ...(proj.settings || {}), buttonStyle: res.buttonStyle, buttonIconSizePct: res.buttonIconSizePct };
          proj.buttonStyle = res.buttonStyle;
          proj.buttonIconSizePct = res.buttonIconSizePct;
        }
        await reloadLibrary();
        if (this.app?.designer?.doc) await this.app.designer.reload();
        toast(`Applied "${res.buttonStyle}" button style & ${res.buttonIconSizePct}% icon size to ${res.updatedCount} buttons`, 'ok', 2000);
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    styleSel.addEventListener('change', applySettings);
    iconSlider.addEventListener('change', applySettings);

    return h('div', {
      class: 'proj-btn-settings-bar',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '7px 8px',
        border: '1px solid rgba(46,155,255,0.3)',
        borderRadius: '8px',
        background: 'rgba(46,155,255,0.07)'
      }
    },
    h('div', { class: 'row spread', style: { gap: '6px' } },
      h('span', { style: { fontSize: '11px', fontWeight: '700', color: '#cfe6ff' } }, '⚙ Button Style (All Buttons)'),
      styleSel,
      h('button', {
        class: 'btn small primary apply-project-btn-settings',
        title: 'Apply selected button style and icon size (50–100%) to all buttons in the library',
        onclick: applySettings
      }, 'Apply All')
    ),
    h('div', { class: 'row spread', style: { gap: '6px' } },
      h('span', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap' } }, 'Icon Size (50–100%):'),
      iconSlider,
      pctBadge
    ));
  }

  /**
   * Boxed pop-up tool: an icon button that opens a floating panel (fixed under the button; closes on Escape or a click
   * elsewhere). `build()` returns the panel content. Used for the selection / file tools and the button style settings.
   */
  popTool(icon, label, build, { cls = '' } = {}) {
    let panel = null;
    const close = () => { panel?.remove(); panel = null; document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); btn.classList.remove('active'); };
    const away = e => { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const btn = ibtn(icon, label, () => {
      if (panel) return close();
      panel = h('div', { class: 'lib-pop', role: 'dialog', 'aria-label': label }, build());
      document.body.append(panel);
      const r = btn.getBoundingClientRect();
      panel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - panel.offsetWidth - 4))}px`;
      panel.style.top = `${r.bottom + 4}px`;
      btn.classList.add('active');
      document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true);
    }, { cls: `lib-pop-btn ${cls}`.trim(), size: 17 });
    btn.append(iconEl('chevDown', { size: 11 }));
    return btn;
  }

  /**
   * The one grouped tool row of every library tab, right under the visibility filter: a drop-down with the selection tools
   * (all / none / invert / copy / move / export / empty) and the new / import tools, a button style tool (buttons tab only)
   * and the item count. Replaces the two loose icon rows.
   */
  libTools(type, selBar, items, count) {
    const sel = state.libSel[type] || (state.libSel[type] = new Set());
    const badge = h('span', { class: 'lib-sel-badge' }, '');
    const refresh = () => { badge.textContent = sel.size ? String(sel.size) : ''; badge.hidden = !sel.size; };
    const inner = selBar._updateInfo; selBar._updateInfo = () => { inner?.(); refresh(); };
    refresh();
    const tools = this.popTool('tools', 'Selection, new and import tools', () => h('div', { class: 'lib-pop-col' }, selBar, h('div', { class: 'row' }, ...items.filter(Boolean))), { cls: 'lib-tools-pop' });
    tools.append(badge);
    // the tool buttons sit in the search row, between its collapse and drawer buttons (decorateTools places them)
    this._toolBtns = [tools, type === 'button' ? this.popTool('sliders', 'Button style settings', () => this.projectButtonSettingsBar(), { cls: 'lib-style-pop' }) : null].filter(Boolean);
    return null;
  }

  head(type, list, fill, extra = [], selBar = null) {
    return h('div', { class: 'lib-tools' },
      this.searchBox(type, fill),
      this.visBar(() => this.renderBody()),
      this.libTools(type, selBar, [
        ibtn('plus', `New ${TYPES[type].label.toLowerCase()}`, async () => { const r = await newDesign(type); if (r) this.app.openDesign(type, r.id); }, { desc: `Create an empty ${TYPES[type].label.toLowerCase()} and open it` }),
        ...extra
      ], list.length),
      this.chips(type, list, () => this.renderBody()),
      h('div', { class: 'dim', style: { fontSize: '11px' } }, HINT[type])
    );
  }

  /* ---------- icons (drawn from the shared sprite; virtualized for libraries with thousands of pack icons) ---------- */
  /** Show / hide switch of the online icon sources (free Iconify API sets); remembered in the browser. */
  onlineToggle() {
    if (onlineOk === null) { probeOnline().then(() => { this.renderBody(); }); return null; }
    if (onlineOk === false) return null;       // API failing: the online source is removed from the library
    const on = onlineShown();
    return h('button', { class: `btn small${on ? ' active' : ''}`, 'aria-pressed': on, title: on ? 'Hide online icon sources' : 'Show online icon sources: search and import SVG icons from free APIs (Tabler, Lucide, Line MD, Spinners, Meteocons, Devicon, brands…)', onclick: () => { setOnlineShown(!on); this.renderBody(); } }, on ? '🌐 Online: shown' : '🌐 Online');
  }

  iconsTab() {
    if (onlineShown() && onlineOk !== false) {
      this.bodyEl.append(h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, this.onlineToggle(), h('span', { class: 'dim', style: { fontSize: '11px' } }, 'Imported icons land in your active project (SVG only).')), buildOnlinePanel({ onUnavailable: () => { onlineOk = false; setOnlineShown(false); this.renderBody(); } }));
      return;
    }
    const list = state.library.icons;
    const large = list.length > LARGE_ICON_LIBRARY;
    const selSet = state.libSel.icon;
    const cells = new Map();          // id -> cell of the rows currently on screen
    const sw = String(state.themes.find(t => t.key === state.themeKey)?.tokens.sw ?? 1.4);
    const scroller = h('div', { class: 'lib-scroll icon-virt-scroll' });
    const spacer = h('div', { class: 'icon-virt-spacer' });
    const grid = h('div', { class: 'grid-icons icon-virt-window' });
    scroller.append(spacer, grid);
    const count = h('span', { class: 'dim', style: { fontSize: '11px' } });
    // rows: local filter over the summaries, or (large library + search text) pages of the server search
    let rows = [], total = 0, remote = null, searchSeq = 0;
    const packOk = d => !this.iconPack || (this.iconPack === 'builtin' ? !iconPack(d) : iconPack(d) === this.iconPack);
    const getVisible = () => rows;
    const syncCells = () => {
      cells.forEach((c, id) => {
        const onChk = selSet.has(id);
        c.classList.toggle('sel', onChk);
        const inp = c.querySelector('input.chk');
        if (inp) inp.checked = onChk;
      });
    };
    const selBar = this.selectionBar('icon', getVisible, syncCells);
    const cellFor = ic => {
      const chk = h('input', {
        type: 'checkbox',
        class: 'chk',
        checked: selSet.has(ic.id),
        onclick: e => {
          e.stopPropagation();
          if (e.target.checked) selSet.add(ic.id);
          else selSet.delete(ic.id);
          selBar._updateInfo?.();
        }
      });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#i-${ic.key}`);
      for (const [k, v] of Object.entries({ fill: 'none', stroke: 'url(#lgS)', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) use.setAttribute(k, v);
      svg.appendChild(use);
      const drag = this.dragData('icon', ic);
      return h('div', {
        class: `cell${this.accepts('icon') ? '' : ' dim-cell'}${selSet.has(ic.id) ? ' sel' : ''}${visClass(ic, usedSet(), 'icon', editedIndex(), libScope())}`,
        draggable: 'true',
        title: `${ic.label} · ${ic.key}${ic.meta?.pack ? ` · ${ic.meta.pack}` : ''}\n(drag onto the canvas, double-click to add, click to edit)`,
        // the drop renders the icon: start loading its geometry while it is dragged
        ondragstart: e => { drag(e); loadIcons([ic.id]).catch(() => {}); },
        ondblclick: () => this.app.addInstance('icon', ic.id),
        onclick: () => this.app.openDesign('icon', ic.id)
      }, chk, this.toolbar('icon', ic), svg, h('div', { class: 'lbl' }, ic.key));
    };
    // geometry of the virtual grid: fixed cell height, column count from the scroller width
    const CELL_W = 72, CELL_H = 70, GAP = 6, PAD = 8, BUFFER_ROWS = 4;
    let cols = 1, lastKey = '';
    const layout = () => {
      const w = Math.max(0, scroller.clientWidth - PAD * 2);
      cols = Math.max(1, Math.floor((w + GAP) / (CELL_W + GAP)));
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      const nRows = Math.ceil(rows.length / cols);
      spacer.style.height = `${Math.max(0, nRows * (CELL_H + GAP) - GAP)}px`;
    };
    const paint = (force = false) => {
      const rowH = CELL_H + GAP;
      const first = Math.max(0, Math.floor((scroller.scrollTop - PAD) / rowH) - BUFFER_ROWS);
      const visRows = Math.ceil((scroller.clientHeight || 600) / rowH) + BUFFER_ROWS * 2;
      const start = first * cols, end = Math.min(rows.length, (first + visRows) * cols);
      const key = `${start}:${end}:${cols}:${rows.length}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      clear(grid);
      cells.clear();
      grid.style.transform = `translateY(${first * rowH}px)`;
      if (!rows.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, remote && remote.loading ? 'Searching…' : 'No icons match.'));
      const frag = document.createDocumentFragment();
      const ids = [];
      for (let i = start; i < end; i++) {
        const ic = rows[i];
        const cell = cellFor(ic);
        cells.set(ic.id, cell);
        frag.append(cell);
        ids.push(ic.id);
      }
      grid.append(frag);
      ensureIconSymbols(ids);
      // server search: fetch the next page when the window reaches the end of what is loaded
      // (paged by the server's own offset: client-side filtering drops rows, so rows.length is not a server offset)
      if (remote && !remote.loading && !remote.done && end >= rows.length - cols * BUFFER_ROWS) loadPage(remote.offset);
    };
    const updateCount = () => { count.textContent = remote ? `${rows.length < total ? `${rows.length} of ` : ''}${total} found` : `${rows.length} of ${list.length}`; };
    const loadPage = async offset => {
      const seq = searchSeq;
      remote.loading = true;
      try {
        const r = await api.iconSearch({ ...remote.params, offset, limit: 500 });
        if (seq !== searchSeq) return;
        // the server applied text, pack, category and the library filter; keep the panel's own visibility rules
        const raw = (r.items || []).map(expandIconSummary);
        const keepQ = this.q.icon; this.q.icon = '';
        let items;
        try { items = this.filtered('icon', raw); } finally { this.q.icon = keepQ; }
        const seen = new Set(offset ? rows.map(x => x.id) : []);
        const fresh = items.filter(x => !seen.has(x.id) && seen.add(x.id));
        rows = offset ? rows.concat(fresh) : fresh;
        remote.offset = offset + raw.length;
        remote.dropped = (offset ? remote.dropped : 0) + (raw.length - fresh.length);
        remote.done = !raw.length || remote.offset >= Number(r.total);
        total = remote.done ? rows.length : Math.max(rows.length, Number(r.total) - remote.dropped);
      } catch (e) {
        if (seq === searchSeq) toast(`Icon search failed: ${e.message}`, 'error');
      } finally {
        if (seq === searchSeq) { remote.loading = false; updateCount(); layout(); paint(true); selBar._updateInfo?.(); }
      }
    };
    const fill = () => {
      searchSeq++;
      const q = (this.q.icon || '').trim();
      if (large && q) {
        // large library: the search runs on the server (key, name, label, tags; pack and category filters)
        const params = { q, category: this.cat.icon || '', pack: this.iconPack || '' };
        if (state.activeProjectId) params.projectId = state.activeProjectId;
        if (state.visibilityFilter && state.visibilityFilter !== 'all') params.visibility = state.visibilityFilter;
        if (state.visibilityFilter === 'mine' || state.visibilityFilter === 'project') params.includePublic = '0';
        remote = { params, loading: false, offset: 0, dropped: 0, done: false };
        rows = []; total = 0;
        scroller.scrollTop = 0;
        loadPage(0);
      } else {
        remote = null;
        rows = this.filtered('icon', list).filter(packOk);
        total = rows.length;
      }
      updateCount();
      layout();
      paint(true);
      selBar._updateInfo?.();
    };
    // pack filter chips: All / Built-in / one per imported pack
    const packCounts = new Map();
    for (const d of list) { const p = iconPack(d) || 'builtin'; packCounts.set(p, (packCounts.get(p) || 0) + 1); }
    const packs = [['', 'All', list.length], ['builtin', 'Built-in', packCounts.get('builtin') || 0],
      ...ICON_PACKS.map(([k, label]) => [k, label, packCounts.get(k) || 0]).filter(([, , n]) => n),
      ...[...packCounts.keys()].filter(k => k !== 'builtin' && !ICON_PACKS.some(([p]) => p === k)).sort().map(k => [k, k, packCounts.get(k)])];
    const packBar = h('div', { class: 'cats', role: 'group', 'aria-label': 'Icon pack' });
    const paintPacks = () => {
      clear(packBar);
      for (const [k, label, n] of packs) {
        packBar.append(h('button', { class: `cat${(this.iconPack || '') === k ? ' on' : ''}`, 'aria-pressed': (this.iconPack || '') === k, title: `${n} icons`, onclick: () => { this.iconPack = k; paintPacks(); scroller.scrollTop = 0; fill(); } }, `${label} ${n}`));
      }
    };
    paintPacks();
    if (this.iconPack && !packs.some(([k]) => k === this.iconPack)) this.iconPack = '';
    let raf = 0;
    scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { passive: true });
    this._iconResize?.disconnect();
    this._iconResize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { const c = cols; layout(); if (c !== cols || !grid.childElementCount) paint(true); else paint(); }) : null;
    this._iconResize?.observe(scroller);
    // the sprite was rebuilt (theme / icon changes): fetch the symbols of the cells on screen again
    this._offSpriteReset?.();
    this._offSpriteReset = on('sprite:reset', () => { if (scroller.isConnected) ensureIconSymbols([...cells.keys()]); });
    this.bodyEl.append(
      this.head('icon', list, fill, [
        this.onlineToggle(),
        ibtn('import', 'Import single SVG file or markup', async () => { const r = await importSvgDialog('icon'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); }),
        ibtn('folder', 'Batch import from an SVG folder into Icons library', async () => { const r = await importFolderOrFontDialog('icon', 'folder'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); }),
        ibtn('text', 'Import glyphs from Fonts (.svg / .ttf / .woff / symbols) into Icons library', async () => { const r = await importFolderOrFontDialog('icon', 'font'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); })
      ], selBar),
      h('div', { class: 'row lib-pack-row', style: { alignItems: 'center', gap: '6px' } }, packBar, h('span', { class: 'grow' }), count),
      scroller
    );
    fill();
  }

  /* ---------- paths, buttons, elements (thumbnails) ---------- */
  thumbTab(type) {
    const list = libOf(type);
    const grid = h('div', { class: type === 'element' ? 'grid-items' : 'grid-icons', style: type === 'button' ? { gridTemplateColumns: 'repeat(auto-fill,minmax(84px,1fr))' } : null });
    const selSet = state.libSel[type];
    const cells = new Map();
    const getVisible = () => this.filtered(type, list);
    const syncCells = () => {
      cells.forEach((c, id) => {
        const onChk = selSet.has(id);
        c.classList.toggle('sel', onChk);
        const inp = c.querySelector('input.chk');
        if (inp) inp.checked = onChk;
      });
    };
    const selBar = this.selectionBar(type, getVisible, syncCells);
    const fill = () => {
      clear(grid);
      cells.clear();
      const rows = getVisible();
      if (!rows.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, `No ${PLURAL[type]} match.`));
      for (const it of rows) {
        const chk = h('input', {
          type: 'checkbox',
          class: 'chk',
          checked: selSet.has(it.id),
          onclick: e => {
            e.stopPropagation();
            if (e.target.checked) selSet.add(it.id);
            else selSet.delete(it.id);
            selBar._updateInfo?.();
          }
        });
        const tag = it.meta?.htmlTag;
        const menu = type === 'button' && it.menuItems?.length ? h('span', { class: 'badge', style: { position: 'absolute', top: '4px', right: '4px' }, title: `${it.meta?.menu?.kind || 'popup'} menu · ${it.menuItems.length} items` }, '☰') : null;
        const cell = h('div', {
          class: `cell${this.accepts(type) ? '' : ' dim-cell'}${selSet.has(it.id) ? ' sel' : ''}${visClass(it, usedSet(), type, editedIndex(), libScope())}`,
          draggable: 'true',
          title: `${it.label} · ${it.key} · ${it.width}×${it.height}\n(drag onto the canvas, double-click to add, click to edit)`,
          ondragstart: this.dragData(type, it),
          ondblclick: () => this.app.addInstance(type, it.id),
          onclick: () => this.app.openDesign(type, it.id)
        },
        chk, this.toolbar(type, it), menu,
        h('img', { class: type === 'element' ? 'thumb' : 'thumb small', loading: 'lazy', alt: it.label, src: api.svgUrl(type, it.id, { theme: state.themeKey, animated: 1, size: 96, v: it.updatedAt }) }),
        h('div', { class: 'lbl' }, tag && type === 'element' ? `<${tag}> ` : '', it.name));
        cells.set(it.id, cell);
        grid.append(cell);
      }
      selBar._updateInfo?.();
    };
    const extra = ['path', 'button', 'element'].includes(type)
      ? [
          ibtn('import', `Import SVG into ${PLURAL[type]}`, async () => { const r = await importSvgDialog(type); if (r?.rec) this.app.openDesign(r.type, r.rec.id); }),
          ibtn('folder', `Batch import from an SVG folder into ${PLURAL[type]}`, async () => { const r = await importFolderOrFontDialog(type, 'folder'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); }),
          ibtn('text', `Import glyphs from Fonts into ${PLURAL[type]}`, async () => { const r = await importFolderOrFontDialog(type, 'font'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); })
        ]
      : [];
    this.bodyEl.append(this.head(type, list, fill, extra, selBar), h('div', { class: 'lib-scroll' }, grid));
    fill();
  }

  /* ---------- screen catalog ---------- */
  screensTab() {
    const list = this.screensList || [];
    if (!this.screensList) { api.list('screen', '', { includePublic: true }).then(l => { this.screensList = l; this.renderBody(); }); }
    const grid = h('div', { class: 'screen-grid' });
    const cells = new Map();
    const visible = () => this.filtered('screen', list);
    const exportBtn = ibtn('export', 'Export selected screens…', () => openExportDialog({ screenIds: [...state.catalogSel] }), { desc: 'Export the checked screens as an html/css/ts bundle', cls: 'primary', disabled: !state.catalogSel.size });
    const syncInfo = () => {
      cells.forEach((c, id) => {
        c.classList.toggle('sel', state.catalogSel.has(id));
        const inp = c.querySelector('input.chk');
        if (inp) inp.checked = state.catalogSel.has(id);
      });
      exportBtn.disabled = !state.catalogSel.size;
    };
    const selBar = this.selectionBar('screen', visible, syncInfo);
    const fill = () => {
      clear(grid); cells.clear();
      const rows = visible();
      if (!rows.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, list.length ? 'No screens match.' : 'No screens yet. Create one with “+ New screen”.'));
      for (const s of rows) {
        const chk = h('input', {
          type: 'checkbox',
          class: 'chk',
          'aria-label': `Select ${s.name}`,
          checked: state.catalogSel.has(s.id),
          onclick: e => {
            e.stopPropagation();
            if (e.target.checked) state.catalogSel.add(s.id);
            else state.catalogSel.delete(s.id);
            selBar._updateInfo?.();
          }
        });
        const cell = h('div', { class: `cell screen-cell${visClass(s, usedSet(), 'screen', editedIndex(), libScope())}`, title: `${s.label}\n${s.key} · ${s.width}×${s.height}`, onclick: () => this.app.openDesign('screen', s.id) },
          chk, this.toolbar('screen', s),
          h('img', { class: 'thumb', loading: 'lazy', alt: s.label, src: api.svgUrl('screen', s.id, { theme: state.themeKey, animated: 0, v: s.updatedAt }) }),
          h('div', { class: 'lbl' }, s.name));
        cells.set(s.id, cell); grid.append(cell);
      }
      selBar._updateInfo?.();
    };
    this.bodyEl.append(
      h('div', { class: 'lib-tools' },
        this.searchBox('screen', fill),
        this.visBar(() => this.renderBody()),
        this.libTools('screen', selBar, [
          ibtn('plus', 'New screen', async () => { const r = await newDesign('screen'); if (r) { this.screensList = null; this.app.openDesign('screen', r.id); } }, { desc: 'Create a screen from a device template and open it' }),
          exportBtn,
          ibtn('layers', 'Export all screens…', () => openExportDialog({ screenIds: 'all' }), { desc: 'Export every screen as an html/css/ts bundle' })
        ], list.length),
        this.chips('screen', list, () => this.renderBody())
      ),
      h('div', { class: 'lib-scroll' }, grid)
    );
    fill();
  }

  /* ---------- workflows ---------- */
  workflowsTab() {
    const box = h('div', { class: 'lib-scroll' });
    const selSet = state.libSel.workflow;
    const rowsMap = new Map();
    const visible = () => this.filtered('workflow', this.workflows);
    const syncRows = () => {
      rowsMap.forEach((rowEl, id) => {
        const onChk = selSet.has(id);
        rowEl.classList.toggle('sel', onChk);
        const inp = rowEl.querySelector('input.wf-chk');
        if (inp) inp.checked = onChk;
      });
    };
    const selBar = this.selectionBar('workflow', visible, syncRows);

    const fill = () => {
      clear(box);
      rowsMap.clear();
      const rows = visible();
      if (!rows.length) {
        box.append(h('div', { class: 'empty' }, this.workflows.length ? 'No workflows match filter.' : 'No workflows yet.'));
      }
      for (const w of rows) {
        const chk = h('input', {
          type: 'checkbox',
          class: 'wf-chk',
          checked: selSet.has(w.id),
          onclick: e => {
            e.stopPropagation();
            if (e.target.checked) selSet.add(w.id);
            else selSet.delete(w.id);
            selBar._updateInfo?.();
          }
        });
        const rowEl = h('div', {
          class: `list-row${state.workflowId === w.id ? ' on' : ''}${selSet.has(w.id) ? ' sel' : ''}${visClass(w, usedSet(), 'workflow', editedIndex(), libScope())}`,
          onclick: () => this.app.openWorkflow(w.id)
        },
        chk,
        h('div', { class: 'grow' },
          h('div', { class: 'row' },
            h('b', {}, w.name),
            h('span', { class: 'badge' }, w.visibility === 'project' ? '📁 Project' : w.visibility === 'private' ? '🗂 All Projects' : '🌐 Public')
          ),
          h('div', { class: 'dim' }, `${w.screenCount} screens · ${w.linkCount} links · ${w.key}`)
        ),
        h('button', {
          class: 'icon-btn',
          title: 'Copy workflow (and its screens + sub-items) to projects…',
          onclick: e => {
            e.stopPropagation();
            openCopyMoveToProjectsModal({
              items: [{ type: 'workflow', id: w.id, name: w.name, key: w.key, creatorId: w.creatorId }],
              mode: 'copy',
              onDone: () => this.loadWorkflows()
            });
          }
        }, '📥'),
        h('button', {
          class: 'icon-btn',
          disabled: !canEditOwned(w),
          title: canEditOwned(w)
            ? 'Move workflow (and its screens + sub-items) to your projects…'
            : 'Workflows owned by other users cannot be moved (only copied)',
          onclick: e => {
            e.stopPropagation();
            if (!canEditOwned(w)) return;
            openCopyMoveToProjectsModal({
              items: [{ type: 'workflow', id: w.id, name: w.name, key: w.key, creatorId: w.creatorId }],
              mode: 'move',
              onDone: () => this.loadWorkflows()
            });
          }
        }, '📤'),
        h('button', { class: 'icon-btn', title: 'Lineage & Root Owner', onclick: e => { e.stopPropagation(); openLineageModal('workflow', w.id); } }, '🌳'),
        h('button', {
          class: 'icon-btn',
          title: 'Rename',
          onclick: async e => {
            e.stopPropagation();
            const n = await promptBox('Rename workflow', { value: w.name, okLabel: 'Rename' });
            if (n?.trim()) { await api.updateWorkflow(w.id, { name: n.trim(), label: n.trim() }); emit('workflows:changed'); }
          }
        }, '✎'),
        h('button', {
          class: 'icon-btn',
          title: 'Clone',
          onclick: async e => { e.stopPropagation(); await api.cloneWorkflow(w.id); emit('workflows:changed'); toast('workflow cloned', 'ok'); }
        }, '⧉'),
        h('button', {
          class: 'icon-btn',
          title: 'Move to Trash',
          onclick: async e => {
            e.stopPropagation();
            if (await confirmBox(`Move workflow "${w.name}" to Trash? Screens are kept.`, { okLabel: 'Move to Trash' })) {
              try {
                await api.deleteWorkflow(w.id);
                if (state.workflowId === w.id) { state.workflowId = null; emit('workflow:closed'); }
                await refreshGlobalLibraryAndCounts();
                emit('workflows:changed');
                toast(`Moved workflow "${w.name}" to Trash`, 'ok');
              } catch (err) {
                toast(err.message, 'err');
              }
            }
          }
        }, '🗑')
        );
        rowsMap.set(w.id, rowEl);
        box.append(rowEl);
      }
      selBar._updateInfo?.();
    };

    this.bodyEl.append(
      h('div', { class: 'lib-tools' },
        this.searchBox('workflow', fill),
        this.visBar(() => this.renderBody()),
        this.libTools('workflow', selBar, [
          ibtn('plus', 'New workflow', async () => {
              const n = await promptBox('New workflow', { okLabel: 'Create' });
              if (n?.trim()) {
                const w = await api.createWorkflow({ name: n.trim(), projectId: state.activeProjectId || state.currentProjectId || 1, visibility: 'public' });
                await this.loadWorkflows();
                this.app.openWorkflow(w.id);
              }
          }, { desc: 'Create a workflow and open it' })
        ], this.workflows.length)
      ),
      box
    );
    fill();
  }

  /** Called by the app when a screen record changed (rename, thumbnails). */
  invalidateScreens() { if (state.tab === 'screen') this.softRefresh(); else this.screensList = null; }
}

/* A cell's hover toolbar can be wider than the cell: nudge it back inside the library panel instead of leaving the screen. */
if (typeof document !== 'undefined' && !window.__udCellTbFit) {
  window.__udCellTbFit = true;
  document.addEventListener('mouseover', e => {
    const cell = e.target?.closest?.('.cell, .lib-card');
    const tb = cell?.querySelector(':scope > .tb');
    if (!tb) return;
    tb.style.transform = '';
    const box = (cell.closest('.lib-scroll, .lib-body, .panel') || document.documentElement).getBoundingClientRect();
    const r = tb.getBoundingClientRect(), pad = 4;
    const left = Math.max(box.left, 0) + pad, right = Math.min(box.right, window.innerWidth) - pad;
    const dx = r.left < left ? left - r.left : (r.right > right ? right - r.right : 0);
    if (dx) tb.style.transform = `translateX(${Math.round(dx)}px)`;
  }, { passive: true });
}
