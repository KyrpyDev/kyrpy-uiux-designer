/**
 * Full Item Browser (Center Canvas View + 90%-Wide Modal Window),
 * Multi-Project Copy/Move Tool (with cascading sub-items),
 * Empty Project Private Library Tool (default libraries immutable),
 * and Trash Management Modal (Restore / Purge / Empty with Admin guard on public items).
 */
import { renderDocument, renderIconDocument } from '/domain/svg.js';
import { visClass, scopeTier } from '/domain/entities.js';
import { editedIndex } from '../edited.js';
import { api } from '../api.js';
import { state, emit, on, renderContext, ALL_ITEM_TYPES, projectLabel, uniqueById } from '../state.js';
import { h, clear, modal, toast, confirmBox, promptBox } from '../dom.js';
import { reloadLibrary } from '../actions.js';
import { ensureIconSymbols } from '../icon-store.js';

const TYPE_LABELS = {
  all: 'All Types',
  path: 'Paths',
  icon: 'Icons',
  button: 'Buttons',
  element: 'Elements',
  screen: 'Screens',
  workflow: 'Workflows'
};

/** Refreshes global library, projects, and bootstrap counts after bulk operations. */
export async function refreshGlobalLibraryAndCounts() {
  // the shared reloadLibrary keeps the active project / visibility filter and the icon-list cache key in step
  // (a separate unfiltered fetch here used to leave an iconsVersion the next reload would trust)
  const [projects] = await Promise.all([api.projects(), reloadLibrary({ silent: true })]);
  state.projects = projects;
  emit('library:changed');
}

/**
 * Focused modal to Copy or Move 1+ items into one or multiple target projects as private (`visibility: 'project'`) items.
 * Also provides a one-click button to switch to the 90%-wide Full Item Browser modal.
 */
export async function openCopyMoveToProjectsModal({ items = [], mode = 'copy', onDone = null } = {}) {
  if (!state.projects || !state.projects.length) {
    state.projects = await api.projects();
  }
  const curUserId = Number(state.user?.id || 1);
  const anyCannotMove = items.some(it => Boolean(it.builtin) || (it.creatorId != null && Number(it.creatorId) !== curUserId));
  let activeMode = mode === 'move' && !anyCannotMove ? 'move' : 'copy';
  let includeUserPrivate = false;

  const selectedProjects = new Set(
    state.selectedProjectIds?.size
      ? [...state.selectedProjectIds]
      : [state.activeProjectId || 1]
  );

  const projListWrap = h('div', { class: 'ib-proj-Checks', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '8px', marginTop: '8px' } });

  const renderProjectChecks = () => {
    clear(projListWrap);
    for (const p of state.projects) {
      const ownedProj = Number(p.ownerId || 1) === curUserId;
      const disabledInMove = activeMode === 'move' && !ownedProj;
      if (disabledInMove) selectedProjects.delete(p.id);
      const checked = selectedProjects.has(p.id);
      const chk = h('input', {
        type: 'checkbox',
        checked,
        disabled: disabledInMove,
        onchange: () => {
          if (chk.checked) selectedProjects.add(p.id);
          else selectedProjects.delete(p.id);
        }
      });
      projListWrap.append(
        h('label', {
          class: `ib-proj-chip${checked ? ' on' : ''}`,
          title: disabledInMove ? 'Move only works with your own projects' : `Target project: ${projectLabel(p)}`,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid var(--line)',
            background: checked ? 'rgba(46,155,255,0.12)' : 'var(--bg-2)',
            opacity: disabledInMove ? 0.45 : 1,
            cursor: disabledInMove ? 'not-allowed' : 'pointer'
          }
        },
        chk,
        h('span', { style: { fontWeight: '600', fontSize: '12px' } }, `📁 ${projectLabel(p)}`),
        h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: 'auto' } }, `#${p.id}${ownedProj ? '' : ' (other owner)'}`)
        )
      );
    }
  };
  renderProjectChecks();

  const createNewProjBtn = h('button', {
    class: 'btn sm',
    onclick: async () => {
      const name = await promptBox('Create New Project', { value: 'New UI Project', label: 'Project Name', okLabel: 'Create Project' });
      if (!name) return;
      try {
        const created = await api.createProject({ name, visibility: 'private' });
        state.projects = await api.projects();
        selectedProjects.add(created.id);
        renderProjectChecks();
        emit('project:list-changed');
        toast(`Created project "${created.name}"`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  }, '+ Create New Project');

  const modeToggle = h('div', { class: 'seg', style: { width: '250px' } },
    h('button', {
      class: activeMode === 'copy' ? 'on' : '',
      onclick: e => {
        activeMode = 'copy';
        [...e.currentTarget.parentElement.children].forEach(b => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
        renderProjectChecks();
      }
    }, '📥 Copy to Projects'),
    h('button', {
      class: activeMode === 'move' ? 'on' : '',
      disabled: anyCannotMove,
      title: anyCannotMove
        ? 'Default basic items or items owned by other users cannot be moved (only copied)'
        : 'Move items to your owned projects',
      onclick: e => {
        if (anyCannotMove) return;
        activeMode = 'move';
        [...e.currentTarget.parentElement.children].forEach(b => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
        renderProjectChecks();
      }
    }, '📤 Move to Projects')
  );

  const privGlobalChk = h('input', {
    type: 'checkbox',
    checked: includeUserPrivate,
    onchange: () => { includeUserPrivate = privGlobalChk.checked; }
  });

  const content = h('div', { class: 'stack' },
    h('div', { class: 'row spread' },
      h('div', {},
        h('strong', {}, `${items.length} item(s) selected`),
        h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } },
          items.map(it => `${it.type}:${it.name || it.key || '#' + it.id}`).slice(0, 8).join(', ') + (items.length > 8 ? '…' : '')
        )
      ),
      modeToggle
    ),
    h('div', {
      style: {
        padding: '8px 12px',
        borderRadius: '8px',
        background: 'rgba(46,155,255,0.08)',
        border: '1px solid rgba(46,155,255,0.25)',
        fontSize: '12px'
      }
    }, 'ℹ When an item is copied or moved, all referenced sub-items (workflows → screens → elements → buttons → icons → paths) are automatically copied to the target project(s). Default basic items and items owned by other users can only be copied; move only works with your own projects.'),
    h('label', {
      class: 'row',
      style: {
        padding: '8px 10px',
        borderRadius: '8px',
        background: 'rgba(16,185,129,0.1)',
        border: '1px solid rgba(16,185,129,0.28)',
        cursor: 'pointer',
        gap: '8px',
        fontSize: '12px',
        fontWeight: '600'
      }
    }, privGlobalChk, h('span', {}, '🗂 Also save to All Projects (my global library, available in all my projects)')),
    h('div', { class: 'row spread', style: { marginTop: '6px' } },
      h('span', { style: { fontWeight: '600', fontSize: '12px' } }, 'Select Target Project(s):'),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn sm', onclick: () => { state.projects.forEach(p => { if (activeMode !== 'move' || Number(p.ownerId || 1) === curUserId) selectedProjects.add(p.id); }); renderProjectChecks(); } }, 'Select All Projects'),
        h('button', { class: 'btn sm', onclick: () => { selectedProjects.clear(); renderProjectChecks(); } }, 'Clear'),
        createNewProjBtn
      )
    ),
    projListWrap
  );

  modal({
    title: `${activeMode === 'move' ? 'Move' : 'Copy'} Items to Project(s)`,
    wide: true,
    content,
    actions: close => [
      h('button', {
        class: 'btn',
        onclick: () => {
          close();
          openItemBrowserModal({
            initialType: items[0]?.type || 'all',
            preselectedItems: items,
            initialMode: activeMode,
            onDone
          });
        }
      }, '🔍 Open 90% Item Browser…'),
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const projectIds = [...selectedProjects];
          if (!projectIds.length && !(activeMode === 'copy' && includeUserPrivate)) {
            toast('Select at least one target project (or your All Projects library)', 'err');
            return;
          }
          try {
            const payload = { items: items.map(x => ({ type: x.type, id: x.id })), projectIds, includeUserPrivate };
            const res = activeMode === 'move'
              ? await api.moveToProjects(payload)
              : await api.copyToProjects(payload);
            await refreshGlobalLibraryAndCounts();
            toast(
              `${activeMode === 'move' ? 'Moved' : 'Copied'} ${res.copiedCount} item(s) (+${res.subItemsCount || 0} sub-items) into ${projectIds.length || 1} target(s)`,
              'ok'
            );
            close();
            onDone?.(res);
          } catch (err) {
            toast(err.message, 'err');
          }
        }
      }, 'Apply to Selected Projects')
    ]
  });
}

/**
 * Builds the interactive Full Item Browser DOM node (used both inside the 90%-wide modal and in the Center Canvas browser mode).
 */
export function buildItemBrowserElement({
  isModal = false,
  initialType = 'all',
  preselectedItems = [],
  initialMode = 'copy',
  onCloseModal = null,
  onDone = null
} = {}) {
  let typeFilter = initialType || 'all';
  let visFilter = 'all'; // 'all' | 'public' | 'project'
  let sourceProjectFilter = 'all'; // 'all' | number
  let viewSize = 'large'; // 'standard' | 'large' | 'xl'
  let query = '';
  const selectedKeys = new Set(preselectedItems.map(it => `${it.type}:${Number(it.id)}`));
  // Also pre-populate from state.libSel if no explicit preselectedItems were passed
  if (!preselectedItems.length) {
    for (const t of ALL_ITEM_TYPES) {
      for (const id of state.libSel?.[t] || []) {
        selectedKeys.add(`${t}:${Number(id)}`);
      }
    }
  }
  const targetProjectIds = new Set(
    state.selectedProjectIds?.size
      ? [...state.selectedProjectIds]
      : [state.activeProjectId || 1]
  );

  let allRecords = {
    path: [],
    icon: [],
    button: [],
    element: [],
    screen: [],
    workflow: []
  };

  const root = h('div', {
    class: `ib-container${isModal ? ' ib-modal-mode' : ' ib-canvas-mode'}`,
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: isModal ? '72vh' : '100%', gap: '10px' }
  });

  const typeTabsBar = h('div', { class: 'seg ib-type-tabs', style: { flexWrap: 'wrap' } });
  const visBar = h('div', { class: 'seg ib-vis-tabs' });
  const viewSizeBar = h('div', { class: 'seg ib-size-tabs', title: 'Card & thumbnail preview size' });
  const sourceProjSelect = h('select', {
    class: 'ib-src-proj-select',
    title: 'Filter by source project',
    onchange: e => {
      sourceProjectFilter = e.target.value;
      renderGrid();
    }
  });
  const searchInput = h('input', {
    type: 'search',
    class: 'ib-search-input',
    placeholder: 'Search paths, icons, buttons, elements, screens, workflows…',
    style: { minWidth: '220px', flex: '1' },
    oninput: e => {
      query = e.target.value.trim().toLowerCase();
      renderGrid();
    }
  });

  const selCountBadge = h('span', { class: 'badge ib-sel-count', style: { fontWeight: '700' } }, '0 selected');
  const targetProjStrip = h('div', { class: 'row ib-target-projects', style: { gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
  const gridEl = h('div', {
    class: 'ib-grid',
    style: {
      flex: '1',
      overflowY: 'auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
      gap: '14px',
      padding: '8px 4px',
      alignContent: 'start'
    }
  });

  function syncSelectionToState() {
    for (const t of ALL_ITEM_TYPES) {
      state.libSel[t]?.clear();
    }
    for (const k of selectedKeys) {
      const [t, idStr] = k.split(':');
      if (state.libSel[t]) state.libSel[t].add(Number(idStr));
    }
    selCountBadge.textContent = `${selectedKeys.size} selected`;
  }

  function visibleItems() {
    const types = typeFilter === 'all' ? ALL_ITEM_TYPES : [typeFilter];
    const curUserId = Number(state.user?.id || 1);
    const out = [];
    for (const t of types) {
      for (const item of allRecords[t] || []) {
        const itemVis = item.visibility || 'public';
        if (visFilter === 'public' && itemVis !== 'public') continue;
        if (visFilter === 'mine' && !(itemVis === 'project' || (itemVis === 'private' && Number(item.creatorId || 1) === curUserId))) continue;
        if (visFilter === 'project' && itemVis !== 'project') continue;
        if (itemVis === 'private' && Number(item.creatorId || 1) !== curUserId) continue;
        if (sourceProjectFilter !== 'all') {
          const pid = Number(sourceProjectFilter);
          if ((item.projectId || 1) !== pid) continue;
        } else if (state.selectedProjectIds?.size > 0) {
          // If topbar multi-project filter is active, show public items + private user items + items in selected projects
          if (itemVis === 'project' && !state.selectedProjectIds.has(item.projectId || 1)) continue;
        }
        if (query) {
          const hay = `${item.name || ''} ${item.key || ''} ${item.label || ''} ${item.category || ''} ${t}`.toLowerCase();
          if (!hay.includes(query)) continue;
        }
        out.push({ type: t, item });
      }
    }
    // red (being edited) > purple (other edited, most recent first) > orange (active project) > green (rest of my scope) > public
    const edited = editedIndex(), scope = { projectId: state.activeProjectId ?? null, publicUserId: state.publicUserId ?? null };
    const rank = ({ type, item }) => scopeTier(item, null, type, edited, scope);
    const hot = ({ type, item }) => edited.get(`${type}:${item.id}`) ?? 0;
    return out.map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || hot(a[0]) - hot(b[0]) || a[1] - b[1]).map(x => x[0]);
  }

  function renderTypeTabs() {
    clear(typeTabsBar);
    for (const [k, label] of Object.entries(TYPE_LABELS)) {
      const count = k === 'all'
        ? ALL_ITEM_TYPES.reduce((acc, t) => acc + (allRecords[t]?.length || 0), 0)
        : (allRecords[k]?.length || 0);
      typeTabsBar.append(
        h('button', {
          class: typeFilter === k ? 'on' : '',
          dataset: { ibType: k },
          onclick: () => {
            typeFilter = k;
            renderTypeTabs();
            renderGrid();
          }
        }, `${label} (${count})`)
      );
    }
  }

  function renderVisTabs() {
    clear(visBar);
    for (const [k, label] of [['all', 'All items'], ['public', '🌐 Public'], ['mine', '🗂 All Projects'], ['project', '📁 Project-only']]) {
      visBar.append(
        h('button', {
          class: visFilter === k ? 'on' : '',
          dataset: { ibVis: k },
          onclick: () => {
            visFilter = k;
            renderVisTabs();
            renderGrid();
          }
        }, label)
      );
    }
  }

  function renderViewSizeTabs() {
    clear(viewSizeBar);
    for (const [k, label] of [['standard', '⊞ Standard'], ['large', '▣ Large View'], ['xl', '⛶ XL View']]) {
      viewSizeBar.append(
        h('button', {
          class: viewSize === k ? 'on' : '',
          dataset: { ibSize: k },
          onclick: () => {
            viewSize = k;
            renderViewSizeTabs();
            renderGrid();
          }
        }, label)
      );
    }
  }

  function renderProjectControls() {
    clear(sourceProjSelect);
    sourceProjSelect.append(h('option', { value: 'all', selected: sourceProjectFilter === 'all' }, 'Source: All Projects'));
    for (const p of state.projects || []) {
      sourceProjSelect.append(
        h('option', { value: String(p.id), selected: String(sourceProjectFilter) === String(p.id) }, `Source: 📁 ${projectLabel(p)} (#${p.id})`)
      );
    }

    clear(targetProjStrip);
    targetProjStrip.append(h('span', { class: 'muted', style: { fontSize: '11px', fontWeight: '600' } }, 'Target Project(s):'));
    for (const p of state.projects || []) {
      const onChk = targetProjectIds.has(p.id);
      const chk = h('input', {
        type: 'checkbox',
        checked: onChk,
        onchange: () => {
          if (chk.checked) targetProjectIds.add(p.id);
          else targetProjectIds.delete(p.id);
          renderProjectControls();
        }
      });
      targetProjStrip.append(
        h('label', {
          class: `chip ib-target-proj-chip${onChk ? ' on' : ''}`,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid var(--line)',
            background: onChk ? 'rgba(46,155,255,0.16)' : 'var(--bg-2)',
            fontSize: '11px',
            cursor: 'pointer'
          }
        }, chk, `📁 ${projectLabel(p)}`)
      );
    }
    targetProjStrip.append(
      h('button', {
        class: 'btn sm',
        title: 'Create a new project and select it as target',
        onclick: async () => {
          const name = await promptBox('Create New Project', { value: 'New UI Project', label: 'Project Name', okLabel: 'Create' });
          if (!name) return;
          try {
            const created = await api.createProject({ name, visibility: 'private' });
            state.projects = await api.projects();
            targetProjectIds.add(created.id);
            renderProjectControls();
            emit('project:list-changed');
            toast(`Project "${created.name}" created`, 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        }
      }, '+ New Project')
    );
  }

  function getThumbHeight(type) {
    if (viewSize === 'xl') {
      return type === 'screen' ? '390px' : (type === 'element' || type === 'workflow') ? '270px' : '200px';
    }
    if (viewSize === 'standard') {
      return type === 'screen' ? '185px' : '140px';
    }
    // default 'large'
    return type === 'screen' ? '280px' : (type === 'element' || type === 'workflow') ? '200px' : '155px';
  }

  function openQuickPreviewModal(type, item) {
    const thumbEl = renderCardThumb(type, item, '70vh');
    modal({
      title: `🔍 Preview ${type.toUpperCase()} — ${item.name || item.key} (${item.key})`,
      wide: true,
      content: h('div', { class: 'stack', style: { gap: '10px' } },
        thumbEl,
        h('div', { class: 'row spread muted', style: { fontSize: '12px' } },
          h('span', {}, `Key: ${item.key} · Category: ${item.category || 'general'}`),
          h('span', {}, (item.visibility || 'public') === 'project' ? `📁 Project #${item.projectId || 1}` : '🌐 Public')
        )
      )
    });
  }

  function renderCardThumb(type, item, overrideHeight = null) {
    const thumbH = overrideHeight || getThumbHeight(type);
    if (type === 'workflow') {
      return h('div', {
        class: 'thumb wf-thumb',
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          height: thumbH,
          background: 'rgba(15,23,42,0.75)',
          borderRadius: '9px',
          color: '#7dd3fc',
          fontSize: '13px'
        }
      },
      h('div', { style: { fontSize: '34px' } }, '⇄'),
      h('div', { style: { fontWeight: '600' } }, `${item.screenCount ?? item.nodes?.length ?? 0} screens · ${item.linkCount ?? item.links?.length ?? 0} links`)
      );
    }
    const ctx = renderContext({ interactive: false });
    const libItem = state.library[type + 's']?.find(x => x.id === item.id) || item;
    if (libItem && Array.isArray(libItem.nodes)) {
      const svg = (type === 'path' || type === 'icon')
        ? renderIconDocument({ icon: libItem, nodes: libItem.nodes, ctx, size: 128, frame: false })
        : renderDocument({ owner: libItem, nodes: libItem.nodes, ctx, background: type === 'screen', standalone: true });
      return h('div', { class: 'thumb', style: { height: thumbH }, html: svg });
    }
    if (type === 'icon' && libItem?.key) {
      // large libraries ship icon summaries (no nodes): draw from the shared sprite and fetch just this symbol
      ensureIconSymbols([libItem.id]);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'ico');
      svg.style.cssText = 'width:100%;height:100%;max-width:128px;max-height:100%';
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#i-${libItem.key}`);
      const sw = String(state.themes?.find(t => t.key === state.themeKey)?.tokens?.sw ?? 1.4);
      for (const [k, v] of Object.entries({ fill: 'none', stroke: 'url(#lgS)', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) use.setAttribute(k, v);
      svg.appendChild(use);
      return h('div', { class: 'thumb', dataset: { ibIconId: String(libItem.id) }, style: { height: thumbH, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, svg);
    }
    return h('div', { class: 'thumb', style: { height: thumbH, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      h('img', {
        src: api.svgUrl(type, item.id, { theme: state.themeKey, size: 420 }),
        loading: 'lazy',
        alt: item.name || item.key,
        style: { height: '100%', width: '100%', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }
      })
    );
  }

  const GRID_PAGE = 120;
  let gridLimit = GRID_PAGE, gridSig = '';
  // the shared sprite was rebuilt (theme / icon changes): fetch the symbols of the icon cards on screen again
  const offSpriteReset = on('sprite:reset', () => {
    if (!gridEl.isConnected) { offSpriteReset(); return; }
    ensureIconSymbols([...gridEl.querySelectorAll('[data-ib-icon-id]')].map(el => Number(el.dataset.ibIconId)));
  });

  function renderGrid() {
    syncSelectionToState();
    clear(gridEl);
    const minColW = viewSize === 'xl'
      ? (typeFilter === 'screen' ? 350 : 320)
      : viewSize === 'standard'
        ? 205
        : (typeFilter === 'screen' ? 285 : 255);
    gridEl.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minColW}px, 1fr))`;
    const list = visibleItems();
    if (!list.length) {
      gridEl.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No items match the current filter.'));
      return;
    }

    // thousands of cards (icon packs) are rendered a page at a time: a sentinel loads the next page when it scrolls into view
    const sig = JSON.stringify([typeFilter, visFilter, sourceProjectFilter, query, viewSize]);
    if (sig !== gridSig) { gridSig = sig; gridLimit = GRID_PAGE; }
    const appendCards = (from, to) => {
    for (const { type, item } of list.slice(from, to)) {
      const k = `${type}:${item.id}`;
      const isChecked = selectedKeys.has(k);
      const canMoveItem = !item.builtin && Number(item.creatorId || 1) === Number(state.user?.id || 1);
      const visBadge = (item.visibility || 'public') === 'project'
        ? `📁 Proj #${item.projectId || 1}`
        : (item.visibility === 'private' ? '🗂 All Projects' : '🌐 Public');
      const chk = h('input', {
        type: 'checkbox',
        class: 'chk ib-item-chk',
        checked: isChecked,
        title: `Select ${type} "${item.name || item.key}"`,
        onclick: e => e.stopPropagation(),
        onchange: e => {
          if (e.target.checked) selectedKeys.add(k);
          else selectedKeys.delete(k);
          card.classList.toggle('checked', e.target.checked);
          syncSelectionToState();
        }
      });

      const tb = h('div', { class: 'tb', onclick: e => e.stopPropagation() },
        h('button', {
          title: 'Large Zoom Preview',
          onclick: () => openQuickPreviewModal(type, item)
        }, '🔍'),
        h('button', {
          title: 'Edit in designer',
          onclick: () => {
            if (onCloseModal) onCloseModal();
            if (type === 'workflow') {
              state.workflowId = item.id;
              emit('mode:set', 'workflow');
              emit('workflow:select', item.id);
            } else {
              emit('mode:set', 'screen');
              emit('designer:open', { type, id: item.id });
            }
          }
        }, '✎'),
        h('button', {
          title: 'Copy to projects…',
          onclick: () => openCopyMoveToProjectsModal({
            items: [{ type, id: item.id, name: item.name, key: item.key, builtin: item.builtin, creatorId: item.creatorId }],
            mode: 'copy',
            onDone: () => loadAllItems()
          })
        }, '📥'),
        h('button', {
          disabled: !canMoveItem,
          title: canMoveItem
            ? 'Move to your projects…'
            : 'Default basic items and items owned by other users cannot be moved (only copied)',
          onclick: () => canMoveItem && openCopyMoveToProjectsModal({
            items: [{ type, id: item.id, name: item.name, key: item.key, builtin: item.builtin, creatorId: item.creatorId }],
            mode: 'move',
            onDone: () => loadAllItems()
          })
        }, '📤'),
        h('button', {
          title: 'Move to Trash',
          onclick: async () => {
            try {
              if (type === 'workflow') await api.deleteWorkflow(item.id);
              else await api.deleteDesign(type, item.id);
              selectedKeys.delete(k);
              emit('design:deleted', { type, id: item.id });
              await refreshGlobalLibraryAndCounts();
              await loadAllItems();
              toast(`Moved ${type} "${item.name || item.key}" to Trash`, 'ok');
            } catch (err) {
              toast(err.message, 'err');
            }
          }
        }, '🗑')
      );

      const card = h('div', {
        class: `lib-card ib-card${isChecked ? ' checked' : ''}${visClass(item, new Set(state.library?.usedKeys || []), type, editedIndex(), { projectId: state.activeProjectId ?? null, publicUserId: state.publicUserId ?? null })}`,
        dataset: { ibCardType: type, ibCardId: String(item.id) },
        onclick: () => {
          const next = !selectedKeys.has(k);
          if (next) selectedKeys.add(k);
          else selectedKeys.delete(k);
          chk.checked = next;
          card.classList.toggle('checked', next);
          syncSelectionToState();
        }
      },
      chk,
      tb,
      renderCardThumb(type, item),
      h('div', { class: 'cap', title: `${item.name || item.key} (${item.key})` }, item.name || item.key),
      h('div', { class: 'sub', style: { display: 'flex', justifyContent: 'space-between', gap: '4px' } },
        h('span', { class: 'badge', style: { fontSize: '10px' } }, type.toUpperCase()),
        h('span', { style: { fontSize: '10px' } }, `${visBadge}${item.builtin ? ' · 🔒Default' : ''}`)
      )
      );
      gridEl.append(card);
    }
    };
    appendCards(0, gridLimit);
    if (list.length > gridLimit) {
      const more = h('button', { class: 'btn sm ib-show-more', style: { gridColumn: '1 / -1', justifySelf: 'center' } });
      const label = () => { more.textContent = `Show more (${list.length - gridLimit} remaining)`; };
      const io = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) showMore(); }, { root: gridEl, rootMargin: '400px' })
        : null;
      const showMore = () => {
        const from = gridLimit;
        gridLimit = Math.min(list.length, gridLimit + GRID_PAGE);
        more.remove();
        appendCards(from, gridLimit);
        if (gridLimit < list.length) { label(); gridEl.append(more); } else io?.disconnect();
      };
      more.onclick = e => { e.stopPropagation(); showMore(); };
      label();
      gridEl.append(more);
      io?.observe(more);
    }
  }

  async function executeBulkTransfer(mode) {
    const items = [...selectedKeys].map(k => {
      const [type, idStr] = k.split(':');
      return { type, id: Number(idStr) };
    });
    if (!items.length) {
      toast('Select at least one item first', 'err');
      return;
    }
    const projectIds = [...targetProjectIds];
    if (!projectIds.length) {
      toast('Select at least one target project', 'err');
      return;
    }
    try {
      const res = mode === 'move'
        ? await api.moveToProjects({ items, projectIds })
        : await api.copyToProjects({ items, projectIds });
      await refreshGlobalLibraryAndCounts();
      await loadAllItems();
      toast(
        `${mode === 'move' ? 'Moved' : 'Copied'} ${res.copiedCount} item(s) (+${res.subItemsCount || 0} cascading sub-items) to ${projectIds.length} project(s)`,
        'ok'
      );
      onDone?.(res);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function executeBulkTrash() {
    const items = [...selectedKeys].map(k => {
      const [type, idStr] = k.split(':');
      return { type, id: Number(idStr) };
    });
    if (!items.length) {
      toast('Select at least one item to move to Trash', 'err');
      return;
    }
    if (!(await confirmBox(`Move ${items.length} selected item(s) to Trash?`, { okLabel: 'Move to Trash' }))) return;
    let count = 0;
    for (const it of items) {
      try {
        if (it.type === 'workflow') await api.deleteWorkflow(it.id);
        else await api.deleteDesign(it.type, it.id);
        selectedKeys.delete(`${it.type}:${it.id}`);
        emit('design:deleted', { type: it.type, id: it.id });
        count++;
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    await refreshGlobalLibraryAndCounts();
    await loadAllItems();
    if (count) toast(`Moved ${count} item(s) to Trash`, 'ok');
  }

  async function executeEmptyPrivateLibrary() {
    const targetPid = sourceProjectFilter !== 'all'
      ? Number(sourceProjectFilter)
      : (state.activeProjectId || 1);
    const proj = (state.projects || []).find(p => p.id === targetPid);
    const ok = await confirmBox(
      `Empty private library of project "${proj?.name || '#' + targetPid}"? (Default/public items are immutable and will not be touched.)`,
      { okLabel: 'Empty Private Library' }
    );
    if (!ok) return;
    try {
      const res = await api.emptyProjectLibrary(targetPid, { itemType: typeFilter });
      await refreshGlobalLibraryAndCounts();
      await loadAllItems();
      toast(`Emptied ${res.emptiedCount} private item(s) from "${proj?.name || '#' + targetPid}" into Trash`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  const selectionToolbar = h('div', {
    class: 'row spread ib-selection-bar',
    style: {
      padding: '8px 10px',
      background: 'var(--bg-2)',
      border: '1px solid var(--line)',
      borderRadius: '8px',
      flexWrap: 'wrap',
      gap: '8px'
    }
  },
  h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    h('button', {
      class: 'btn sm ib-btn-select-all',
      onclick: () => {
        for (const { type, item } of visibleItems()) selectedKeys.add(`${type}:${item.id}`);
        renderGrid();
      }
    }, '☑ Select all'),
    h('button', {
      class: 'btn sm ib-btn-select-none',
      onclick: () => {
        for (const { type, item } of visibleItems()) selectedKeys.delete(`${type}:${item.id}`);
        renderGrid();
      }
    }, '☐ Non select'),
    h('button', {
      class: 'btn sm ib-btn-select-invert',
      onclick: () => {
        for (const { type, item } of visibleItems()) {
          const k = `${type}:${item.id}`;
          if (selectedKeys.has(k)) selectedKeys.delete(k);
          else selectedKeys.add(k);
        }
        renderGrid();
      }
    }, '⇄ Reverse selection'),
    selCountBadge
  ),
  targetProjStrip,
  h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    h('button', {
      class: `btn sm ${initialMode === 'copy' ? 'primary' : ''} ib-btn-copy-projects`,
      onclick: () => executeBulkTransfer('copy')
    }, '📥 Copy to Projects'),
    h('button', {
      class: `btn sm ${initialMode === 'move' ? 'primary' : ''} ib-btn-move-projects`,
      onclick: () => executeBulkTransfer('move')
    }, '📤 Move to Projects'),
    h('button', {
      class: 'btn sm ib-btn-export-import',
      title: 'Export or Import paths, icons, buttons, elements, screens, and workflows as HTML, SVG, or JSON',
      onclick: () => {
        const items = [...selectedKeys].map(k => {
          const [type, idStr] = k.split(':');
          return { type, id: Number(idStr) };
        });
        openLibraryExportImportModal({
          initialTab: 'export',
          preselectedItems: items,
          defaultType: typeFilter,
          onDone: () => loadAllItems()
        });
      }
    }, '⇅ Export / Import (HTML·SVG·JSON)'),
    h('button', {
      class: 'btn sm ib-btn-empty-private',
      title: 'Empty selected project’s private library (default libraries are immutable)',
      onclick: executeEmptyPrivateLibrary
    }, '🧹 Empty Private Library'),
    h('button', {
      class: 'btn sm danger ib-btn-trash-selected',
      onclick: executeBulkTrash
    }, '🗑 Trash Selected')
  )
  );

  root.append(
    h('div', { class: 'row spread', style: { gap: '8px', flexWrap: 'wrap' } },
      typeTabsBar,
      visBar,
      viewSizeBar,
      sourceProjSelect,
      searchInput
    ),
    selectionToolbar,
    gridEl
  );

  async function loadAllItems() {
    const [screens, workflows, projects] = await Promise.all([
      api.list('screen', '', { includePublic: true }),
      api.workflows({ includePublic: true }),
      api.projects()
    ]);
    state.projects = uniqueById(projects);
    allRecords = {
      path: state.library.paths || [],
      icon: state.library.icons || [],
      button: state.library.buttons || [],
      element: state.library.elements || [],
      screen: uniqueById(screens),
      workflow: uniqueById(workflows)
    };
    renderTypeTabs();
    renderVisTabs();
    renderViewSizeTabs();
    renderProjectControls();
    renderGrid();
  }

  loadAllItems();
  return { el: root, reload: loadAllItems };
}

/**
 * Opens the 90%-wide modal window (`width: 90vw; max-width: 90vw`) containing the Item Browser only.
 */
export function openItemBrowserModal({
  initialType = 'all',
  preselectedItems = [],
  initialMode = 'copy',
  onDone = null
} = {}) {
  let closeRef = null;
  const browser = buildItemBrowserElement({
    isModal: true,
    initialType,
    preselectedItems,
    initialMode,
    onCloseModal: () => closeRef?.(),
    onDone
  });
  const m = modal({
    title: '🗂 Full Item Browser — Select Items to Copy / Move Across Projects',
    w90: true,
    content: browser.el
  });
  closeRef = m.close;
  return m;
}

/**
 * Center Canvas Full Item Browser mounted in `#browser-root` when `state.mode === 'browser'`.
 */
export class ItemBrowserView {
  constructor(root) {
    this.root = root;
    this.browser = null;
    on('library:changed', () => { if (state.mode === 'browser') this.refresh(); });
    on('project:changed', () => { if (state.mode === 'browser') this.refresh(); });
    on('project:list-changed', () => { if (state.mode === 'browser') this.refresh(); });
    on('theme:changed', () => { if (state.mode === 'browser') this.refresh(); });
  }

  mount() {
    clear(this.root);
    this.browser = buildItemBrowserElement({ isModal: false, initialType: 'all' });
    this.root.append(this.browser.el);
  }

  refresh() {
    if (!this.browser) this.mount();
    else this.browser.reload();
  }
}

/**
 * Trash Management Modal (`🗑 Trash` in topbar menu):
 *  - Lists trashed items across `path`, `icon`, `button`, `element`, `screen`, `workflow`.
 *  - Restore items (preserving original IDs and links when available).
 *  - Permanently purge individual items or Empty Trash (only admin/superadmin can purge public items).
 */
export async function openTrashModal() {
  let filterType = '';
  let searchQ = '';
  const listWrap = h('div', { class: 'stack', style: { maxHeight: '62vh', overflowY: 'auto', marginTop: '8px' } });
  const countLabel = h('span', { class: 'badge' }, '0 items in Trash');

  const typeSelect = h('select', {
    onchange: e => {
      filterType = e.target.value;
      loadTrash();
    }
  },
  h('option', { value: '' }, 'All Item Types'),
  ...ALL_ITEM_TYPES.map(t => h('option', { value: t }, TYPE_LABELS[t] || t))
  );

  const searchBox = h('input', {
    type: 'search',
    placeholder: 'Search trashed items by name or key…',
    style: { flex: '1' },
    oninput: e => {
      searchQ = e.target.value.trim();
      loadTrash();
    }
  });

  async function loadTrash() {
    clear(listWrap);
    try {
      const items = await api.trashList({ itemType: filterType, q: searchQ });
      state.trashCount = items.length;
      emit('trash:changed', state.trashCount);
      countLabel.textContent = `${items.length} item(s) in Trash`;
      if (!items.length) {
        listWrap.append(h('div', { class: 'empty' }, 'Trash is empty. All deleted items appear here first before permanent purge.'));
        return;
      }
      for (const it of items) {
        const isPublic = it.visibility === 'public' || it.builtin;
        listWrap.append(
          h('div', {
            class: 'row spread trash-row',
            dataset: { trashId: String(it.id), trashType: it.itemType, trashKey: it.itemKey },
            style: {
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: 'var(--bg-2)'
            }
          },
          h('div', {},
            h('div', { class: 'row', style: { gap: '8px' } },
              h('span', { class: 'badge' }, it.itemType.toUpperCase()),
              h('strong', {}, it.itemName || it.itemKey),
              h('span', { class: 'muted', style: { fontSize: '11px' } }, `(${it.itemKey} · #${it.originalId})`),
              h('span', { class: 'badge', style: { fontSize: '10px' } }, isPublic ? '🌐 Public' : `📁 Project #${it.projectId}`)
            ),
            h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } },
              `Deleted at ${it.deletedAt || 'now'} · Category: ${it.category || 'general'}`
            )
          ),
          h('div', { class: 'row', style: { gap: '6px' } },
            h('button', {
              class: 'btn sm primary trash-restore-btn',
              onclick: async () => {
                try {
                  const res = await api.trashRestore(it.id);
                  await refreshGlobalLibraryAndCounts();
                  await loadTrash();
                  toast(`Restored ${res.itemType} "${res.item?.name || it.itemKey}"`, 'ok');
                } catch (err) {
                  toast(err.message, 'err');
                }
              }
            }, '♻ Restore'),
            h('button', {
              class: 'btn sm danger trash-purge-btn',
              title: isPublic ? 'Permanently purge (Admin / Superadmin only for public items)' : 'Permanently purge from Trash',
              onclick: async () => {
                try {
                  await api.trashPurge(it.id);
                  await refreshGlobalLibraryAndCounts();
                  await loadTrash();
                  toast(`Permanently purged "${it.itemName || it.itemKey}"`, 'ok');
                } catch (err) {
                  toast(err.message, 'err');
                }
              }
            }, '🔥 Purge')
          )
          )
        );
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  const content = h('div', { class: 'stack' },
    h('div', {
      style: {
        padding: '8px 12px',
        borderRadius: '8px',
        background: 'rgba(245,158,11,0.1)',
        border: '1px solid rgba(245,158,11,0.3)',
        fontSize: '12px'
      }
    }, '🗑 All deleted items are moved to Trash first and can be restored with their full node tree, animations, and links. Only admin or superadmin users can trash or permanently purge public items.'),
    h('div', { class: 'row spread', style: { gap: '8px' } },
      typeSelect,
      searchBox,
      countLabel,
      h('button', {
        class: 'btn sm danger trash-empty-btn',
        onclick: async () => {
          if (!(await confirmBox('Permanently purge all items currently listed in Trash?', { okLabel: 'Empty Trash Permanently' }))) return;
          try {
            const res = await api.trashEmpty({ itemType: filterType });
            await refreshGlobalLibraryAndCounts();
            await loadTrash();
            toast(`Purged ${res.purgedCount} item(s) from Trash`, 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        }
      }, '🧹 Empty Trash')
    ),
    listWrap
  );

  await loadTrash();
  return modal({
    title: '🗑 Trash Management — Restore or Purge Deleted Items',
    wide: true,
    content
  });
}

/**
 * Unified Export & Import Modal for paths, icons, buttons, elements, screens, and workflows
 * into Project (`visibility: 'project'`) or Public (`visibility: 'public'`) libraries
 * in HTML, SVG, and JSON formats.
 */
export function openLibraryExportImportModal({
  initialTab = 'export',
  preselectedItems = [],
  defaultType = 'all',
  onDone = null
} = {}) {
  let activeTab = initialTab === 'import' ? 'import' : 'export';
  const selectedTypes = new Set(
    defaultType && defaultType !== 'all' ? [defaultType] : ['path', 'icon', 'button', 'element', 'screen', 'workflow']
  );
  let exportFormat = 'json';
  let exportScope = 'all';
  let exportProjectId = state.activeProjectId || 1;
  let includeSubItems = true;
  let usePreselected = Array.isArray(preselectedItems) && preselectedItems.length > 0;
  let exportResultText = '';
  let exportFilename = 'kyrpy-library-export.json';
  let exportContentType = 'application/json';

  let importFormat = 'auto';
  let importTargetType = defaultType && defaultType !== 'all' ? defaultType : 'auto';
  let importVisibility = 'project';
  let importProjectId = state.activeProjectId || 1;
  let importCategory = 'imported';
  let importName = '';
  let importContentText = '';

  const tabBar = h('div', { class: 'seg', style: { marginBottom: '12px' } });
  const bodyHost = h('div', { class: 'stack', style: { gap: '12px' } });

  function triggerDownload(filename, contentType, text) {
    const blob = new Blob([text], { type: contentType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'kyrpy-library-export.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderTabs() {
    clear(tabBar);
    for (const [k, label] of [
      ['export', '⬇ Export Library (HTML · SVG · JSON)'],
      ['import', '⬆ Import to Project / Public Library (HTML · SVG · JSON)']
    ]) {
      tabBar.append(
        h('button', {
          class: activeTab === k ? 'on' : '',
          dataset: { libExImTab: k },
          onclick: () => {
            activeTab = k;
            renderTabs();
            renderBody();
          }
        }, label)
      );
    }
  }

  function renderBody() {
    clear(bodyHost);
    if (activeTab === 'export') {
      const formatBar = h('div', { class: 'seg' },
        ...[['json', '{ } JSON (.json)'], ['svg', '◈ SVG (.svg)'], ['html', '🌐 HTML (.html)']].map(([fmt, label]) =>
          h('button', {
            class: exportFormat === fmt ? 'on' : '',
            dataset: { exportFormat: fmt },
            onclick: () => {
              exportFormat = fmt;
              renderBody();
            }
          }, label)
        )
      );

      const typeChecks = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        ...ALL_ITEM_TYPES.map(t => {
          const chk = h('input', {
            type: 'checkbox',
            checked: selectedTypes.has(t),
            disabled: usePreselected,
            onchange: e => {
              if (e.target.checked) selectedTypes.add(t);
              else selectedTypes.delete(t);
            }
          });
          return h('label', { class: 'chip', style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, chk, TYPE_LABELS[t]);
        })
      );

      const scopeSelect = h('select', {
        disabled: usePreselected,
        onchange: e => { exportScope = e.target.value; }
      },
        h('option', { value: 'all', selected: exportScope === 'all' }, 'All (Public + Project)'),
        h('option', { value: 'public', selected: exportScope === 'public' }, '🌐 Public Library Only'),
        h('option', { value: 'project', selected: exportScope === 'project' }, '📁 Project Library Only')
      );

      const projSelect = h('select', {
        disabled: usePreselected,
        onchange: e => { exportProjectId = Number(e.target.value); }
      },
        ...(state.projects || []).map(p =>
          h('option', { value: String(p.id), selected: Number(exportProjectId) === Number(p.id) }, `📁 ${projectLabel(p)} (#${p.id})`)
        )
      );

      const previewArea = h('textarea', {
        rows: 10,
        readonly: true,
        placeholder: 'Click "Generate Export" or "Download File" to export paths, icons, buttons, elements, screens, and workflows as HTML, SVG, or JSON…',
        style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '11px' },
        value: exportResultText
      });

      const runExport = async (downloadImmediately = false) => {
        try {
          const payload = usePreselected
            ? { items: preselectedItems, format: exportFormat, includeSubItems }
            : {
                types: [...selectedTypes],
                format: exportFormat,
                visibility: exportScope,
                projectId: exportProjectId,
                includeSubItems
              };
          const res = await api.exportLibraryItems(payload);
          exportResultText = res.content || '';
          exportFilename = res.filename || `kyrpy-library-export.${exportFormat}`;
          exportContentType = res.contentType || 'text/plain';
          previewArea.value = exportResultText;
          toast(`Exported ${res.totalCount} item(s) as ${exportFormat.toUpperCase()}`, 'ok');
          if (downloadImmediately && exportResultText) {
            triggerDownload(exportFilename, exportContentType, exportResultText);
          }
        } catch (err) {
          toast(err.message, 'err');
        }
      };

      bodyHost.append(
        preselectedItems.length > 0
          ? h('label', { class: 'row', style: { gap: '8px', fontSize: '12px' } },
              h('input', {
                type: 'checkbox',
                checked: usePreselected,
                onchange: e => { usePreselected = e.target.checked; renderBody(); }
              }),
              `Export only the ${preselectedItems.length} currently selected item(s)`
            )
          : null,
        h('div', { class: 'row spread', style: { gap: '10px', flexWrap: 'wrap' } },
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Export Format (HTML / SVG / JSON)'),
            formatBar
          ),
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Library Scope'),
            scopeSelect
          ),
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Project Filter'),
            projSelect
          ),
          h('label', { class: 'row', style: { gap: '6px', marginTop: '16px', fontSize: '12px' } },
            h('input', {
              type: 'checkbox',
              checked: includeSubItems,
              onchange: e => { includeSubItems = e.target.checked; }
            }),
            'Include cascading sub-items (paths, icons, buttons, elements, screens)'
          )
        ),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Item Types to Include'),
          typeChecks
        ),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', {
            class: 'btn primary lib-run-export-btn',
            onclick: () => runExport(false)
          }, `⚡ Generate ${exportFormat.toUpperCase()} Export`),
          h('button', {
            class: 'btn lib-download-export-btn',
            onclick: () => runExport(true)
          }, `⤓ Download .${exportFormat} File`),
          h('button', {
            class: 'btn',
            onclick: async () => {
              if (!previewArea.value) await runExport(false);
              if (previewArea.value && navigator.clipboard) {
                await navigator.clipboard.writeText(previewArea.value);
                toast('Copied export output to clipboard', 'ok');
              }
            }
          }, '📋 Copy Output')
        ),
        previewArea
      );
      return;
    }

    // activeTab === 'import'
    const visToggle = h('div', { class: 'seg' },
      ...[['project', '📁 Project Library'], ['public', '🌐 Public Library']].map(([v, label]) =>
        h('button', {
          class: importVisibility === v ? 'on' : '',
          dataset: { importVis: v },
          onclick: () => { importVisibility = v; renderBody(); }
        }, label)
      )
    );

    const targetProjSelect = h('select', {
      onchange: e => { importProjectId = Number(e.target.value); }
    },
      ...(state.projects || []).map(p =>
        h('option', { value: String(p.id), selected: Number(importProjectId) === Number(p.id) }, `📁 ${projectLabel(p)} (#${p.id})`)
      )
    );

    const fmtSelect = h('select', {
      onchange: e => { importFormat = e.target.value; }
    },
      h('option', { value: 'auto', selected: importFormat === 'auto' }, 'Auto-detect (HTML / SVG / JSON)'),
      h('option', { value: 'json', selected: importFormat === 'json' }, 'JSON (.json)'),
      h('option', { value: 'svg', selected: importFormat === 'svg' }, 'SVG (.svg)'),
      h('option', { value: 'html', selected: importFormat === 'html' }, 'HTML (.html)')
    );

    const targetTypeSelect = h('select', {
      onchange: e => { importTargetType = e.target.value; }
    },
      h('option', { value: 'auto', selected: importTargetType === 'auto' }, 'Auto / Bundle Item Types'),
      h('option', { value: 'path', selected: importTargetType === 'path' }, 'Path'),
      h('option', { value: 'icon', selected: importTargetType === 'icon' }, 'Icon'),
      h('option', { value: 'button', selected: importTargetType === 'button' }, 'Button'),
      h('option', { value: 'element', selected: importTargetType === 'element' }, 'Element'),
      h('option', { value: 'screen', selected: importTargetType === 'screen' }, 'Screen'),
      h('option', { value: 'workflow', selected: importTargetType === 'workflow' }, 'Workflow')
    );

    const nameInput = h('input', {
      type: 'text',
      placeholder: 'Optional name override for single imported item…',
      value: importName,
      oninput: e => { importName = e.target.value; }
    });

    const catInput = h('input', {
      type: 'text',
      placeholder: 'Category (e.g. imported)',
      value: importCategory,
      oninput: e => { importCategory = e.target.value; }
    });

    const contentArea = h('textarea', {
      rows: 10,
      placeholder: 'Paste .json, .svg (<svg>...</svg>), or .html content here, or choose file(s) above…',
      style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '11px' },
      value: importContentText,
      oninput: e => { importContentText = e.target.value; }
    });

    const fileInput = h('input', {
      type: 'file',
      accept: '.json,.svg,.html,.htm',
      multiple: true,
      onchange: async e => {
        const files = [...(e.target.files || [])];
        if (!files.length) return;
        const texts = await Promise.all(files.map(f => f.text()));
        importContentText = texts.join('\n\n');
        contentArea.value = importContentText;
        const ext = files[0].name.split('.').pop()?.toLowerCase();
        if (['json', 'svg', 'html'].includes(ext)) {
          importFormat = ext;
          fmtSelect.value = ext;
        }
        toast(`Loaded ${files.length} file(s) ready to import`, 'ok');
      }
    });

    const executeImport = async () => {
      if (!importContentText.trim()) {
        toast('Choose a .html, .svg, or .json file or paste content first', 'err');
        return;
      }
      try {
        const res = await api.importLibraryItems({
          format: importFormat,
          content: importContentText,
          targetType: importTargetType,
          projectId: importProjectId,
          visibility: importVisibility,
          category: importCategory || 'imported',
          name: importName.trim()
        });
        await refreshGlobalLibraryAndCounts();
        onDone?.(res);
        toast(
          `Imported ${res.importedCount} item(s) into ${res.visibility === 'public' ? 'Public Library' : `Project #${res.projectId} Library`}`,
          'ok'
        );
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    bodyHost.append(
      h('div', { class: 'row spread', style: { gap: '10px', flexWrap: 'wrap' } },
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Target Library Visibility'),
          visToggle
        ),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Target Project'),
          targetProjSelect
        ),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Input Format'),
          fmtSelect
        ),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Target Item Type'),
          targetTypeSelect
        )
      ),
      h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
        h('div', { class: 'stack', style: { gap: '4px', flex: '1' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Choose File (.html, .svg, .json)'),
          fileInput
        ),
        h('div', { class: 'stack', style: { gap: '4px', flex: '1' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Category'),
          catInput
        ),
        h('div', { class: 'stack', style: { gap: '4px', flex: '1' } },
          h('label', { class: 'muted', style: { fontSize: '11px' } }, 'Optional Name Override'),
          nameInput
        )
      ),
      contentArea,
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', {
          class: 'btn primary lib-run-import-btn',
          onclick: executeImport
        }, '⬆ Import into Library')
      )
    );
  }

  renderTabs();
  renderBody();

  return modal({
    title: '⇅ Export & Import Library Items (HTML · SVG · JSON)',
    wide: true,
    content: h('div', { class: 'stack', style: { gap: '10px' } }, tabBar, bodyHost)
  });
}
