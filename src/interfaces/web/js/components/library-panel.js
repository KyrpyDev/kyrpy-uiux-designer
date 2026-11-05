/**
 * Left panel: the libraries along the hierarchy  Paths → Icons → Buttons → Elements,  the Screens catalog and the Workflows.
 * Items are dragged onto the open designer (the hierarchy rules decide where they may go).
 */
import { h, clear, debounce, promptBox, confirmBox, toast } from '../dom.js';
import { api } from '../api.js';
import { state, on, emit, libOf, PLURAL } from '../state.js';
import { newDesign, cloneDesign, deleteDesign, downloadSvg, importSvgDialog, importFolderOrFontDialog } from '../actions.js';
import { openExportDialog } from './export-dialog.js';
import { openLineageModal } from './collab-modals.js';
import { openCopyMoveToProjectsModal, openItemBrowserModal, openLibraryExportImportModal, refreshGlobalLibraryAndCounts } from './item-browser.js';
import { TYPES, canContain } from '/domain/entities.js';

const TABS = [['path', 'Paths'], ['icon', 'Icons'], ['button', 'Buttons'], ['element', 'Elements'], ['screen', 'Screens'], ['workflow', 'Workflows']];
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
    on('library:changed', () => { this.screensList = null; this.loadWorkflows(); this.renderBody(); });
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
        class: state.tab === k ? 'on' : '',
        role: 'tab',
        'aria-selected': state.tab === k,
        title: label,
        onclick: () => { state.tab = k; this.renderTabs(); this.renderBody(); }
      }, label, h('span', { class: 'dim', style: { display: 'block', fontSize: '10px' } }, String(count))));
    }
  }

  async loadWorkflows() {
    try { this.workflows = await api.workflows({ includePublic: true }); } catch { this.workflows = []; }
    this.renderTabs();
    if (state.tab === 'workflow') this.renderBody();
  }

  renderBody() {
    this.renderTabs();
    clear(this.bodyEl);
    if (state.tab === 'screen') return this.screensTab();
    if (state.tab === 'workflow') return this.workflowsTab();
    if (state.tab === 'icon') return this.iconsTab();
    return this.thumbTab(state.tab);
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
    return (list || []).filter(d => {
      const vis = d.visibility || 'public';
      if (vf === 'public' && vis !== 'public') return false;
      if (vf === 'project' && vis !== 'project') return false;
      if (vis === 'project' && d.projectId) {
        if (selProjects && selProjects.size > 0) {
          if (!selProjects.has(Number(d.projectId))) return false;
        } else if (activePid && Number(d.projectId) !== activePid) {
          return false;
        }
      }
      return (!c || d.category === c) && (!q || `${d.key || ''} ${d.name || ''} ${d.label || ''} ${(d.tags || []).join(' ')} ${d.descriptionDev || ''} ${d.description || ''}`.toLowerCase().includes(q));
    });
  }

  visBar(onChange) {
    const cur = state.visibilityFilter || 'all';
    const set = v => { state.visibilityFilter = v; onChange(); };
    return h('div', { class: 'cats lib-vis-filter', title: 'Filter by public or project-specific visibility' },
      [['all', 'All items'], ['public', '🌐 Public'], ['project', '📁 Project-only']].map(([k, lbl]) =>
        h('button', { class: `cat${cur === k ? ' on' : ''}`, dataset: { visFilter: k }, onclick: () => set(k) }, lbl)
      )
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
      h('button', {
        class: 'btn small lib-sel-all-btn',
        title: 'Select all visible items',
        onclick: () => { getVisible().forEach(r => selSet.add(r.id)); updateInfo(); }
      }, 'Select all'),
      h('button', {
        class: 'btn small lib-sel-none-btn',
        title: 'Deselect all items (Non select)',
        onclick: () => { selSet.clear(); updateInfo(); }
      }, 'Non select'),
      h('button', {
        class: 'btn small lib-sel-invert-btn',
        title: 'Reverse selection of visible items',
        onclick: () => {
          getVisible().forEach(r => (selSet.has(r.id) ? selSet.delete(r.id) : selSet.add(r.id)));
          updateInfo();
        }
      }, 'Reverse'),
      h('button', {
        class: 'btn small lib-copy-to-btn',
        title: 'Open 90% wide Item Browser to Copy selected items to project(s)',
        onclick: () => openBrowserWithSelection('copy')
      }, '📥 Copy to…'),
      h('button', {
        class: 'btn small lib-move-to-btn',
        title: 'Open 90% wide Item Browser to Move selected items to project(s)',
        onclick: () => openBrowserWithSelection('move')
      }, '📤 Move to…'),
      h('button', {
        class: 'btn small lib-export-import-btn',
        title: 'Export or Import paths, icons, buttons, elements, screens, and workflows as HTML, SVG, or JSON',
        onclick: () => {
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
        }
      }, '⇅ HTML·SVG·JSON'),
      h('button', {
        class: 'btn small lib-empty-private-btn',
        title: 'Empty active project’s private library (default libraries are immutable)',
        onclick: async () => {
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
        }
      }, '🧹 Empty'),
      info
    );
    bar._updateInfo = updateInfo;
    return bar;
  }

  toolbar(type, rec) {
    return h('div', { class: 'tb' },
      h('button', { title: 'Open in its designer', onclick: e => { e.stopPropagation(); this.app.openDesign(type, rec.id); } }, '✎'),
      h('button', {
        title: 'Copy to projects… (as private item, cascades sub-items)',
        onclick: e => {
          e.stopPropagation();
          openCopyMoveToProjectsModal({
            items: [{ type, id: rec.id, name: rec.name, key: rec.key }],
            mode: 'copy',
            onDone: () => { if (type === 'screen') this.screensList = null; this.renderBody(); }
          });
        }
      }, '📥'),
      h('button', {
        title: 'Move to projects… (as private item, cascades sub-items)',
        onclick: e => {
          e.stopPropagation();
          openCopyMoveToProjectsModal({
            items: [{ type, id: rec.id, name: rec.name, key: rec.key }],
            mode: 'move',
            onDone: () => { if (type === 'screen') this.screensList = null; this.renderBody(); }
          });
        }
      }, '📤'),
      h('button', { title: 'Clone (tracks Root Owner lineage)', onclick: async e => { e.stopPropagation(); await cloneDesign(type, rec); } }, '⧉'),
      h('button', { title: 'Root Owner & Clone Lineage', onclick: e => { e.stopPropagation(); openLineageModal(type, rec.id); } }, '🌳'),
      h('button', { title: 'Export SVG (with animation)', onclick: e => { e.stopPropagation(); downloadSvg(type, rec.id, type === 'icon' || type === 'path' ? { frame: 0 } : {}); } }, '⤓'),
      h('button', { title: 'Move to Trash', onclick: async e => { e.stopPropagation(); await deleteDesign(type, rec); } }, '🗑')
    );
  }

  dragData(type, rec) {
    return e => { e.dataTransfer.setData('application/x-ud', JSON.stringify({ type, id: rec.id })); e.dataTransfer.effectAllowed = 'copy'; };
  }

  head(type, list, fill, extra = [], selBar = null) {
    return h('div', { class: 'lib-tools' },
      this.searchBox(type, fill),
      this.visBar(() => this.renderBody()),
      this.chips(type, list, () => this.renderBody()),
      selBar,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: async () => { const r = await newDesign(type); if (r) this.app.openDesign(type, r.id); } }, `+ New ${TYPES[type].label.toLowerCase()}`),
        ...extra,
        h('span', { class: 'grow' }),
        h('span', { class: 'dim' }, `${list.length}`)
      ),
      h('div', { class: 'dim', style: { fontSize: '11px' } }, HINT[type])
    );
  }

  /* ---------- icons (drawn from the shared sprite) ---------- */
  iconsTab() {
    const list = state.library.icons;
    const grid = h('div', { class: 'grid-icons' });
    const selSet = state.libSel.icon;
    const cells = new Map();
    const sw = String(state.themes.find(t => t.key === state.themeKey)?.tokens.sw ?? 1.4);
    const getVisible = () => this.filtered('icon', list);
    const syncCells = () => {
      cells.forEach((c, id) => {
        const onChk = selSet.has(id);
        c.classList.toggle('sel', onChk);
        const inp = c.querySelector('input.chk');
        if (inp) inp.checked = onChk;
      });
    };
    const selBar = this.selectionBar('icon', getVisible, syncCells);
    const fill = () => {
      clear(grid);
      cells.clear();
      const rows = getVisible();
      if (!rows.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'No icons match.'));
      for (const ic of rows) {
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
        const cell = h('div', {
          class: `cell${this.accepts('icon') ? '' : ' dim-cell'}${selSet.has(ic.id) ? ' sel' : ''}`,
          draggable: 'true',
          title: `${ic.label} · ${ic.key}\n(drag onto the canvas, double-click to add, click to edit)`,
          ondragstart: this.dragData('icon', ic),
          ondblclick: () => this.app.addInstance('icon', ic.id),
          onclick: () => this.app.openDesign('icon', ic.id)
        }, chk, this.toolbar('icon', ic), svg, h('div', { class: 'lbl' }, ic.key));
        cells.set(ic.id, cell);
        grid.append(cell);
      }
      selBar._updateInfo?.();
    };
    this.bodyEl.append(
      this.head('icon', list, fill, [
        h('button', { class: 'btn small', title: 'Import single SVG file or markup', onclick: async () => { const r = await importSvgDialog('icon'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, 'Import SVG'),
        h('button', { class: 'btn small', title: 'Batch import from an SVG folder into Icons library', onclick: async () => { const r = await importFolderOrFontDialog('icon', 'folder'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, '📁 Folder'),
        h('button', { class: 'btn small', title: 'Import glyphs from Fonts (.svg / .ttf / .woff / symbols) into Icons library', onclick: async () => { const r = await importFolderOrFontDialog('icon', 'font'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, '🔤 Fonts')
      ], selBar),
      h('div', { class: 'lib-scroll' }, grid)
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
          class: `cell${this.accepts(type) ? '' : ' dim-cell'}${selSet.has(it.id) ? ' sel' : ''}`,
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
          h('button', { class: 'btn small', title: `Import SVG into ${PLURAL[type]}`, onclick: async () => { const r = await importSvgDialog(type); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, 'Import SVG'),
          h('button', { class: 'btn small', title: `Batch import from an SVG folder into ${PLURAL[type]}`, onclick: async () => { const r = await importFolderOrFontDialog(type, 'folder'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, '📁 Folder'),
          h('button', { class: 'btn small', title: `Import glyphs from Fonts into ${PLURAL[type]}`, onclick: async () => { const r = await importFolderOrFontDialog(type, 'font'); if (r?.rec) this.app.openDesign(r.type, r.rec.id); } }, '🔤 Fonts')
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
    const exportBtn = h('button', { class: 'btn primary small', disabled: !state.catalogSel.size, onclick: () => openExportDialog({ screenIds: [...state.catalogSel] }) }, 'Export selected…');
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
        const cell = h('div', { class: 'cell screen-cell', title: `${s.label}\n${s.key} · ${s.width}×${s.height}`, onclick: () => this.app.openDesign('screen', s.id) },
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
        this.chips('screen', list, () => this.renderBody()),
        selBar,
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: async () => { const r = await newDesign('screen'); if (r) { this.screensList = null; this.app.openDesign('screen', r.id); } } }, '+ New screen'),
          exportBtn,
          h('button', { class: 'btn small', title: 'Export every screen', onclick: () => openExportDialog({ screenIds: 'all' }) }, 'Export all…')
        )
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
          class: `list-row${state.workflowId === w.id ? ' on' : ''}${selSet.has(w.id) ? ' sel' : ''}`,
          onclick: () => this.app.openWorkflow(w.id)
        },
        chk,
        h('div', { class: 'grow' },
          h('div', { class: 'row' },
            h('b', {}, w.name),
            h('span', { class: 'badge' }, w.visibility === 'project' ? '📁 Project' : '🌐 Public')
          ),
          h('div', { class: 'dim' }, `${w.screenCount} screens · ${w.linkCount} links · ${w.key}`)
        ),
        h('button', {
          class: 'icon-btn',
          title: 'Copy workflow (and its screens + sub-items) to projects…',
          onclick: e => {
            e.stopPropagation();
            openCopyMoveToProjectsModal({
              items: [{ type: 'workflow', id: w.id, name: w.name, key: w.key }],
              mode: 'copy',
              onDone: () => this.loadWorkflows()
            });
          }
        }, '📥'),
        h('button', {
          class: 'icon-btn',
          title: 'Move workflow (and its screens + sub-items) to projects…',
          onclick: e => {
            e.stopPropagation();
            openCopyMoveToProjectsModal({
              items: [{ type: 'workflow', id: w.id, name: w.name, key: w.key }],
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
        selBar,
        h('div', { class: 'row' },
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const n = await promptBox('New workflow', { okLabel: 'Create' });
              if (n?.trim()) {
                const w = await api.createWorkflow({ name: n.trim(), projectId: state.activeProjectId || state.currentProjectId || 1, visibility: 'public' });
                await this.loadWorkflows();
                this.app.openWorkflow(w.id);
              }
            }
          }, '+ New workflow')
        )
      ),
      box
    );
    fill();
  }

  /** Called by the app when a screen record changed (rename, thumbnails). */
  invalidateScreens() { this.screensList = null; if (state.tab === 'screen') this.renderBody(); }
}
