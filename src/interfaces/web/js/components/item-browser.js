/**
 * Full Item Browser (Center Canvas View + 90%-Wide Modal Window),
 * Multi-Project Copy/Move Tool (with cascading sub-items),
 * Empty Project Private Library Tool (default libraries immutable),
 * and Trash Management Modal (Restore / Purge / Empty with Admin guard on public items).
 */
import { renderDocument, renderIconDocument } from '/domain/svg.js';
import { api } from '../api.js';
import { state, emit, on, renderContext, ALL_ITEM_TYPES } from '../state.js';
import { h, clear, modal, toast, confirmBox, promptBox } from '../dom.js';

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
  const [lib, projects, boot] = await Promise.all([
    api.library(),
    api.projects(),
    api.bootstrap()
  ]);
  state.library = lib;
  state.projects = projects;
  state.counts = boot.counts || state.counts;
  state.trashCount = boot.trashCount ?? boot.counts?.trash ?? 0;
  emit('library:changed');
  emit('trash:changed', state.trashCount);
}

/**
 * Focused modal to Copy or Move 1+ items into one or multiple target projects as private (`visibility: 'project'`) items.
 * Also provides a one-click button to switch to the 90%-wide Full Item Browser modal.
 */
export async function openCopyMoveToProjectsModal({ items = [], mode = 'copy', onDone = null } = {}) {
  if (!state.projects || !state.projects.length) {
    state.projects = await api.projects();
  }
  const selectedProjects = new Set(
    state.selectedProjectIds?.size
      ? [...state.selectedProjectIds]
      : [state.activeProjectId || 1]
  );
  let activeMode = mode === 'move' ? 'move' : 'copy';

  const projListWrap = h('div', { class: 'ib-proj-Checks', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '8px', marginTop: '8px' } });

  const renderProjectChecks = () => {
    clear(projListWrap);
    for (const p of state.projects) {
      const checked = selectedProjects.has(p.id);
      const chk = h('input', {
        type: 'checkbox',
        checked,
        onchange: () => {
          if (chk.checked) selectedProjects.add(p.id);
          else selectedProjects.delete(p.id);
        }
      });
      projListWrap.append(
        h('label', {
          class: `ib-proj-chip${checked ? ' on' : ''}`,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid var(--line)',
            background: checked ? 'rgba(46,155,255,0.12)' : 'var(--bg-2)',
            cursor: 'pointer'
          }
        },
        chk,
        h('span', { style: { fontWeight: '600', fontSize: '12px' } }, `📁 ${p.name}`),
        h('span', { class: 'muted', style: { fontSize: '11px', marginLeft: 'auto' } }, `#${p.id}`)
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

  const modeToggle = h('div', { class: 'seg', style: { width: '240px' } },
    h('button', {
      class: activeMode === 'copy' ? 'on' : '',
      onclick: e => {
        activeMode = 'copy';
        [...e.currentTarget.parentElement.children].forEach(b => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
      }
    }, '📥 Copy to Projects'),
    h('button', {
      class: activeMode === 'move' ? 'on' : '',
      onclick: e => {
        activeMode = 'move';
        [...e.currentTarget.parentElement.children].forEach(b => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
      }
    }, '📤 Move to Projects')
  );

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
    }, 'ℹ Items are copied/moved into each selected project as private (project-specific) items. When a screen, workflow, element, or button is copied/moved, all referenced sub-items (elements → buttons → icons → paths) are automatically copied to the target project’s private sub-item libraries.'),
    h('div', { class: 'row spread', style: { marginTop: '6px' } },
      h('span', { style: { fontWeight: '600', fontSize: '12px' } }, 'Select Target Project(s):'),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn sm', onclick: () => { state.projects.forEach(p => selectedProjects.add(p.id)); renderProjectChecks(); } }, 'Select All Projects'),
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
          if (!projectIds.length) {
            toast('Select at least one target project', 'err');
            return;
          }
          try {
            const payload = { items: items.map(x => ({ type: x.type, id: x.id })), projectIds };
            const res = activeMode === 'move'
              ? await api.moveToProjects(payload)
              : await api.copyToProjects(payload);
            await refreshGlobalLibraryAndCounts();
            toast(
              `${activeMode === 'move' ? 'Moved' : 'Copied'} ${res.copiedCount} item(s) (+${res.subItemsCount || 0} sub-items) into ${projectIds.length} project(s)`,
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
      gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
      gap: '10px',
      padding: '6px 2px',
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
    const out = [];
    for (const t of types) {
      for (const item of allRecords[t] || []) {
        const itemVis = item.visibility || 'public';
        if (visFilter === 'public' && itemVis !== 'public') continue;
        if (visFilter === 'project' && itemVis !== 'project') continue;
        if (sourceProjectFilter !== 'all') {
          const pid = Number(sourceProjectFilter);
          if ((item.projectId || 1) !== pid) continue;
        } else if (state.selectedProjectIds?.size > 0) {
          // If topbar multi-project filter is active, show public items + items in selected projects
          if (itemVis === 'project' && !state.selectedProjectIds.has(item.projectId || 1)) continue;
        }
        if (query) {
          const hay = `${item.name || ''} ${item.key || ''} ${item.label || ''} ${item.category || ''} ${t}`.toLowerCase();
          if (!hay.includes(query)) continue;
        }
        out.push({ type: t, item });
      }
    }
    return out;
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
    for (const [k, label] of [['all', 'All items'], ['public', '🌐 Public'], ['project', '📁 Project-only']]) {
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

  function renderProjectControls() {
    clear(sourceProjSelect);
    sourceProjSelect.append(h('option', { value: 'all', selected: sourceProjectFilter === 'all' }, 'Source: All Projects'));
    for (const p of state.projects || []) {
      sourceProjSelect.append(
        h('option', { value: String(p.id), selected: String(sourceProjectFilter) === String(p.id) }, `Source: 📁 ${p.name} (#${p.id})`)
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
        }, chk, `📁 ${p.name}`)
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

  function renderCardThumb(type, item) {
    if (type === 'workflow') {
      return h('div', {
        class: 'thumb wf-thumb',
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          height: '92px',
          background: 'rgba(15,23,42,0.55)',
          borderRadius: '6px',
          color: '#7dd3fc',
          fontSize: '12px'
        }
      },
      h('div', { style: { fontSize: '22px' } }, '⇄'),
      h('div', {}, `${item.screenCount ?? item.nodes?.length ?? 0} screens · ${item.linkCount ?? item.links?.length ?? 0} links`)
      );
    }
    const ctx = renderContext({ interactive: false });
    const libItem = state.library[type + 's']?.find(x => x.id === item.id) || item;
    if (libItem && Array.isArray(libItem.nodes)) {
      const svg = (type === 'path' || type === 'icon')
        ? renderIconDocument({ icon: libItem, nodes: libItem.nodes, ctx, size: 72, frame: false })
        : renderDocument({ owner: libItem, nodes: libItem.nodes, ctx, background: type === 'screen', standalone: true });
      return h('div', { class: 'thumb', style: { height: '92px' }, html: svg });
    }
    return h('div', { class: 'thumb', style: { height: '92px', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      h('img', { src: api.svgUrl(type, item.id, { theme: state.themeKey, size: 96 }), style: { maxHeight: '84px', maxWidth: '100%' } })
    );
  }

  function renderGrid() {
    syncSelectionToState();
    clear(gridEl);
    const list = visibleItems();
    if (!list.length) {
      gridEl.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No items match the current filter.'));
      return;
    }

    for (const { type, item } of list) {
      const k = `${type}:${item.id}`;
      const isChecked = selectedKeys.has(k);
      const visBadge = (item.visibility || 'public') === 'project'
        ? `📁 Proj #${item.projectId || 1}`
        : '🌐 Public';
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
            items: [{ type, id: item.id, name: item.name, key: item.key }],
            mode: 'copy',
            onDone: () => loadAllItems()
          })
        }, '📥'),
        h('button', {
          title: 'Move to projects…',
          onclick: () => openCopyMoveToProjectsModal({
            items: [{ type, id: item.id, name: item.name, key: item.key }],
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
        class: `lib-card ib-card${isChecked ? ' checked' : ''}`,
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
    state.projects = projects;
    allRecords = {
      path: state.library.paths || [],
      icon: state.library.icons || [],
      button: state.library.buttons || [],
      element: state.library.elements || [],
      screen: screens || [],
      workflow: workflows || []
    };
    renderTypeTabs();
    renderVisTabs();
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
