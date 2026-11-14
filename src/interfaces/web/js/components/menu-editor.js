/**
 * Menu editing for buttons (popup / rotating menus):
 *  - MenuEditor: the live menu on the designer canvas, a mouse-over toolbar on the button and on every item
 *    (add sub item · edit · delete) and the same click behaviour as the exported page (via menu-runtime).
 *  - menuActions: add / edit / delete / move / settings, shared with the inspector.
 */
import { matchesSearch, searchTerms, itemSearchFields } from '/domain/search.js';
import { h, modal, toast, confirmBox, clear, promptBox } from '../dom.js';
import { api } from '../api.js';
import { state, findDesign, libOf, isPublicLibraryItem } from '../state.js';
import { reloadLibrary } from '../actions.js';
import { ensureIconSymbols } from '../icon-store.js';
import { iconEl, ibtn } from '../icons.js';

import { bindMenus } from '/domain/menu-runtime.js';
import { slugify } from '/domain/naming.js';
import { buildMenuTree, menuConfig, dropTarget } from '/domain/menu.js';
import { menuItemAction } from '/domain/entities.js';
import { isContainerNode } from '/domain/geometry.js';
import { isRepeaterNode } from '/domain/repeater.js';

/* ---------- dialogs ---------- */
/** Icon picker: a searchable grid of the icon library. Resolves with an icon id or null (cancel). */
/** Public items + the user's own (private and all of their projects): what a picker offers, regardless of the library filter. */
const scopeQuery = (extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== '' && v != null))).toString();

export function pickIcon(currentId = null) {
  return new Promise(resolve => {
    let done = false, m, seq = 0, timer = null;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const grid = h('div', { class: 'grid-icons', style: { maxHeight: '360px', overflow: 'auto' } });
    const q = h('input', { type: 'search', placeholder: 'Search public icons and icons of all my projects…' });
    const cell = (ic, own) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#i-${ic.key}`);
      for (const [k, v] of Object.entries({ fill: 'none', stroke: 'url(#lgS)', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) use.setAttribute(k, v);
      svg.appendChild(use);
      return h('div', { class: `cell${ic.id === currentId ? ' sel' : ''}${own ? ' vis-own' : ''}`, title: `${ic.label || ic.key}${own ? ' · my projects' : ' · public'}`, onclick: () => { fin(ic.id); m.close(); } }, svg, h('div', { class: 'lbl' }, ic.key));
    };
    const section = (title, rows, own, total) => {
      if (!rows.length) return [];
      return [h('div', { class: 'muted', style: { gridColumn: '1/-1', fontSize: '11px', fontWeight: 700 } }, `${title} · ${total > rows.length ? `${rows.length} of ${total}` : rows.length}${total > rows.length ? ' (type to narrow the search)' : ''}`), ...rows.map(ic => cell(ic, own))];
    };
    const fill = async () => {
      const my = ++seq, term = q.value.trim();
      try {
        // user's own items first (private + project-only of every project), then the public library; both searched on the server
        const [mine, pub] = await Promise.all([
          api.get(`/api/icons/search?${scopeQuery({ visibility: 'mine', includePublic: '0', q: term, limit: 300 })}`),
          api.get(`/api/icons/search?${scopeQuery({ visibility: 'public', q: term, limit: 300 })}`)
        ]);
        if (my !== seq) return;
        const ownIds = new Set(mine.items.map(i => i.id));
        const pubRows = pub.items.filter(i => !ownIds.has(i.id));
        ensureIconSymbols([...mine.items, ...pubRows].map(i => i.id));
        clear(grid);
        const parts = [...section('All my projects', mine.items, true, mine.total), ...section('Public', pubRows, false, pub.total)];
        grid.append(...(parts.length ? parts : [h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, 'No icons match.')]));
      } catch (e) { if (my === seq) { clear(grid); grid.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, `Could not load icons: ${e.message}`)); } }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(fill, 180); });
    m = modal({ title: 'Pick an icon', wide: true, onClose: () => fin(null), content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, q, grid),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(0); close(); } }, 'No icon'), h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
    fill();
    setTimeout(() => q.focus(), 30);
  });
}

/** Pick a library button for a menu item: public + all of my projects, with previews. Resolves to an id, 0 = no button, null = cancelled. */
export function pickButton(currentId = null, excludeId = null) {
  return new Promise(resolve => {
    let done = false, m, all = [];
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const q = h('input', { type: 'search', placeholder: 'Search public buttons and buttons of all my projects…' });
    const list = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: '8px', maxHeight: '380px', overflow: 'auto' } });
    const card = (b, own) => h('button', { class: `cell${b.id === currentId ? ' sel' : ''}${own ? ' vis-own' : ''}`, type: 'button', title: `${b.label || b.name} (${b.key}) · ${own ? 'my projects' : 'public'}`,
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px', cursor: 'pointer', textAlign: 'center' }, onclick: () => { fin(b.id); m.close(); } },
      h('img', { class: 'thumb small', loading: 'lazy', alt: b.label || b.name, style: { width: '72px', height: '72px', objectFit: 'contain' }, src: api.svgUrl('button', b.id, { theme: state.themeKey, animated: 0, size: 96, v: b.updatedAt }) }),
      h('div', { class: 'lbl', style: { fontSize: '11px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.label || b.name));
    const fill = () => {
      clear(list);
      const s = q.value.trim().toLowerCase();
      const rows = all.filter(r => r.b.id !== excludeId && matchesSearch(s, ...itemSearchFields(r.b)));
      const mine = rows.filter(r => r.own), pub = rows.filter(r => !r.own);
      const head = t => h('div', { class: 'muted', style: { gridColumn: '1/-1', fontSize: '11px', fontWeight: 700 } }, t);
      if (mine.length) list.append(head(`All my projects · ${mine.length}`), ...mine.slice(0, 150).map(r => card(r.b, true)));
      if (pub.length) list.append(head(`Public · ${pub.length}${pub.length > 150 ? ' (showing 150: type to narrow the search)' : ''}`), ...pub.slice(0, 150).map(r => card(r.b, false)));
      if (!rows.length) list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, 'No buttons match.'));
    };
    q.addEventListener('input', fill);
    m = modal({ title: 'Pick a button', wide: true, onClose: () => fin(null), content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, q, list),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(0); close(); } }, 'No button (plain circle)'), h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
    list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, 'Loading buttons…'));
    Promise.all([api.list('button', '', { visibility: 'mine', includePublic: false }), api.list('button', '', { visibility: 'public' })])
      .then(([mine, pub]) => { const ownIds = new Set(mine.map(b => b.id)); all = [...mine.map(b => ({ b, own: true })), ...pub.filter(b => !ownIds.has(b.id)).map(b => ({ b, own: false }))]; fill(); })
      .catch(e => { clear(list); list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, `Could not load buttons: ${e.message}`)); });
    setTimeout(() => q.focus(), 30);
  });
}

/**
 * Pick what a menu item does when it is clicked: route to a screen OR show an element as a popup / modal box (one or the other).
 * Two tabs (Screen · Element), each listing this project's items, my other projects' and the public ones, with previews.
 * Resolves to { screen } | { element } (records), { create: true } (new screen in a new tab), { none: true } or null (cancelled).
 */
export function pickTarget({ currentScreenId = null, currentElementId = null, currentAction = '', projectId = null, allowCreate = true } = {}) {
  return new Promise(resolve => {
    let done = false, m, tab = currentAction === 'scroll-repeater' ? 'repeater' : (currentElementId && !currentScreenId ? 'element' : 'screen');
    const all = { screen: null, element: null, repeater: null };
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const q = h('input', { type: 'search', 'data-f': 'pick-target-q' });
    const list = h('div', { 'data-f': 'pick-target-list', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: '10px', maxHeight: '440px', overflow: 'auto' } });
    // the project's prefix: its prefixed items come first (option on by default)
    const prefix = (state.projects || []).find(p => Number(p.id) === Number(projectId ?? state.activeProjectId))?.settings?.prefix || '';
    let prefixFirst = !!prefix;
    const pfxBox = prefix ? h('label', { class: 'row', style: { gap: '6px', alignItems: 'center', whiteSpace: 'nowrap' }, title: `Show the items named ${prefix}-… of this project at the top` },
      h('input', { type: 'checkbox', checked: true, 'data-f': 'pick-target-prefix-first', onchange: e => { prefixFirst = e.target.checked; fill(); } }),
      h('span', {}, `${prefix}- items first`)) : null;
    q.style.flex = '1';
    const group = s => (projectId != null && Number(s.projectId) === Number(projectId) && !isPublicLibraryItem(s) ? 'here' : isPublicLibraryItem(s) ? 'public' : 'other');
    const card = (type, s) => {
      const cur = type === 'screen' ? currentScreenId : currentElementId;
      const isSetTarget = cur != null && Number(s.id) === Number(cur);
      return h('button', { class: `cell${isSetTarget ? ' sel target-set' : ''}`, type: 'button', [`data-${type}-id`]: String(s.id), title: `${s.label || s.name} (${s.key})${isSetTarget ? ' — Currently set target' : ''}`,
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '6px', cursor: 'pointer' }, onclick: () => { fin({ [type]: s }); m.close(); } },
        h('img', { loading: 'lazy', alt: s.name, style: type === 'screen' ? { width: '96px', height: '160px', objectFit: 'contain' } : { width: '104px', height: '104px', objectFit: 'contain' }, src: api.svgUrl(type === 'repeater' ? 'element' : type, s.id, { theme: state.themeKey, animated: 0, v: s.updatedAt }) }),
        h('div', { style: { fontSize: '11px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name),
        group(s) !== 'here' ? h('span', { class: 'badge', title: `Selecting it copies the ${type} into this project (you name the copy)` }, '⧉ copied') : null);
    };
    const tabBtn = (t, txt) => h('button', { type: 'button', class: `btn small${tab === t ? ' primary' : ''}`, role: 'tab', 'aria-selected': String(tab === t), 'data-f': `pick-target-tab-${t}`, onclick: () => { tab = t; paint(); } }, txt);
    const tabs = h('div', { class: 'row', role: 'tablist' });
    const fill = () => {
      clear(list);
      if (tab === 'repeater') {
        const autoBtn = h('button', {
          class: 'btn primary',
          type: 'button',
          'data-f': 'pick-repeater-auto',
          style: { gridColumn: '1/-1', textAlign: 'center', padding: '10px', fontSize: '12px', fontWeight: 600 },
          onclick: () => { fin({ repeaterAuto: true }); m.close(); }
        }, '⟳ Auto-bind: Tie to Repeater Container on screen (Slide to scroll)');
        list.append(autoBtn);
      }
      const rows = all[tab];
      if (!rows) return list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, `Loading ${tab}s…`));
      const t = q.value.trim().toLowerCase();
      const terms = searchTerms(t), hit = rows.filter(s => matchesSearch(terms, ...itemSearchFields(s)));
      const head = txt => h('div', { class: 'muted', style: { gridColumn: '1/-1', fontSize: '11px', fontWeight: 700 } }, txt);
      const curTargetId = tab === 'screen' ? currentScreenId : currentElementId;
      // the target that is set now comes first of the whole list (green edge), whatever group it belongs to
      const curRow = curTargetId != null && tab !== 'repeater' ? hit.find(s => Number(s.id) === Number(curTargetId)) : null;
      if (curRow) list.append(head('Set now'), card(tab, curRow));
      // the project's prefixed items (prefix-[itemtype]-name) in their own section at the top
      const pre = prefixFirst ? hit.filter(s => s !== curRow && group(s) === 'here' && String(s.key || '').startsWith(`${prefix}-`)) : [];   // this project's own items only (another project's keys may start alike)
      const preSet = new Set(pre);
      if (pre.length) list.append(head(`${prefix}- · ${pre.length}`), ...pre.slice(0, 120).map(s => card(tab, s)));
      for (const [g, title] of [['here', 'This project'], ['other', 'My other projects (copied into this project)'], ['public', 'Public library (copied into this project)']]) {
        let part = hit.filter(s => group(s) === g && s !== curRow && !preSet.has(s));
        if (curTargetId != null) {
          part = [...part].sort((a, b) => {
            const aIsCur = Number(a.id) === Number(curTargetId);
            const bIsCur = Number(b.id) === Number(curTargetId);
            if (aIsCur && !bIsCur) return -1;
            if (!aIsCur && bIsCur) return 1;
            return 0;
          });
        }
        if (part.length) list.append(head(`${title} · ${part.length}`), ...part.slice(0, 120).map(s => card(tab, s)));
      }
      if (!hit.length && tab !== 'repeater') list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1' } }, rows.length ? `No ${tab}s match.` : `No ${tab}s yet.`));
    };
    const newBtn = allowCreate ? h('button', { class: 'btn primary', 'data-f': 'pick-screen-new', onclick: () => { fin({ create: true }); m.close(); } }, '＋ New screen (new tab)') : null;
    const paint = () => {
      clear(tabs); tabs.append(tabBtn('screen', '🖥 Go to screen'), tabBtn('element', '▣ Show element as popup'), tabBtn('repeater', '⟳ Scroll container'));
      q.placeholder = tab === 'screen' ? 'Search screens of this project, my projects and the public library…' : tab === 'repeater' ? 'Search repeaters and scrollable containers, or pick auto-bind…' : 'Search elements of this project, my projects and the public library…';
      if (newBtn) newBtn.hidden = tab !== 'screen';
      fill();
    };
    q.addEventListener('input', fill);
    m = modal({ title: 'When pressed and slid: go to a screen, show an element or scroll items', wide: true, onClose: () => fin(null),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        tabs, h('div', { class: 'muted', style: { fontSize: '11px' } }, 'An item can route to a screen, open an element as a popup, or scroll a repeater or any scrollable container when slid.'), h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }, q, pfxBox), list),
      actions: close => [newBtn,
        h('button', { class: 'btn', 'data-f': 'pick-target-none', onclick: () => { fin({ none: true }); close(); } }, 'Nothing (no screen, no popup)'),
        h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')].filter(Boolean) });
    paint();
    for (const type of ['screen', 'element']) api.list(type, '', { includePublic: true }).then(rows => {
      all[type] = rows;
      if (type === 'element') {
        // repeaters first, then every other scrollable container (container, carousel container, container category / meta)
        const isRpt = e => e.key === 'html-repeater' || e.meta?.containerType === 'repeater' || e.role === 'repeater-container' || (e.attrs && e.attrs['data-container'] === 'repeater');
        const isCont = e => isRpt(e) || /^html-(carousel-)?container$/.test(e.key || '') || e.category === 'containers' || !!e.meta?.isContainer || !!e.meta?.containerType || /container/i.test(e.key || '');
        all.repeater = [...rows.filter(isRpt), ...rows.filter(e => !isRpt(e) && isCont(e))];
        if (!all.repeater.length) all.repeater = rows;
      }
      if (tab === type || (tab === 'repeater' && type === 'element')) fill();
    }).catch(e => { all[type] = []; if (tab === type) { clear(list); list.append(h('div', { class: 'muted' }, `Could not load ${type}s: ${e.message}`)); } });
    setTimeout(() => q.focus(), 30);
  });
}

/**
 * Turns a pickTarget result into the menu item fields { targetScreenId, targetElementId, action } (exactly one set, or both null).
 * A screen / element of another project or of the public library is copied into `projectId` first (the user names the copy).
 * Returns null when cancelled; `create` results are handled by the caller.
 */
export async function targetPatch(r, projectId) {
  if (!r || r.create) return null;
  if (r.none) return { targetScreenId: null, targetElementId: null, action: '' };
  if (r.repeaterAuto) return { targetScreenId: null, targetElementId: null, action: 'scroll-repeater', type: 'repeater' };
  if (r.repeater) {
    let target = r.repeater;
    if (Number(target.projectId) !== Number(projectId) || isPublicLibraryItem(target)) {
      const name = await promptBox(`Copy “${target.name}” into this project`, { label: 'Name of the copy', value: `${target.name} copy`, okLabel: 'Copy and link' });
      if (!name?.trim()) return null;
      try { target = await api.cloneDesign('element', target.id, { name: name.trim(), projectId }); } catch (e) { toast(e.message, 'error'); return null; }
      toast(`Copied as “${target.name}”`, 'ok', 1800);
    }
    return { targetScreenId: null, targetElementId: target.id, action: 'scroll-repeater', target, type: 'element' };
  }
  const type = r.screen ? 'screen' : 'element';
  let target = r[type];
  if (Number(target.projectId) !== Number(projectId) || isPublicLibraryItem(target)) {
    const name = await promptBox(`Copy “${target.name}” into this project`, { label: 'Name of the copy', value: `${target.name} copy`, okLabel: 'Copy and link' });
    if (!name?.trim()) return null;
    try { target = await api.cloneDesign(type, target.id, { name: name.trim(), projectId }); } catch (e) { toast(e.message, 'error'); return null; }
    toast(`Copied as “${target.name}”`, 'ok', 1800);
  }
  return { targetScreenId: type === 'screen' ? target.id : null, targetElementId: type === 'element' ? target.id : null, target, type };
}

/** One-line summary of what a menu item does when clicked or slid. */
/**
 * The library browser as an icon button, the same popup everywhere a screen or element is chosen:
 * `onPick({ screenId, elementId })` gets exactly one of them (the other is null).
 */
export function libraryBrowseButton({ currentScreenId = null, currentElementId = null, currentAction = '', projectId = null, onPick, onAuto = null, dataF = null, title = 'Browse screens and elements' } = {}) {
  return h('button', {
    class: 'btn sm', type: 'button', title, 'aria-label': title, ...(dataF ? { 'data-f': dataF } : {}),
    onclick: async () => {
      const r = await pickTarget({ currentScreenId, currentElementId, currentAction, projectId, allowCreate: false });
      if (r?.repeaterAuto) onAuto?.();
      else if (r?.screen) onPick({ screenId: r.screen.id, elementId: null });
      else if (r?.element || r?.repeater) onPick({ screenId: null, elementId: (r.element || r.repeater).id });
    }
  }, '🗂');
}

export function targetSummary(screenId, elementId, recs = {}, action = '') {
  if (action === 'scroll-repeater') {
    if (elementId) { const e = recs.element || findDesign('element', elementId); return `⟳ Press and slide scrolls the items of “${e?.name ?? `#${elementId}`}”`; }
    return '⟳ Press and slide scrolls the items of the repeater on the screen (auto)';
  }
  if (screenId) { const s = recs.screen || findDesign('screen', screenId); return `🖥 Goes to screen “${s?.name ?? `#${screenId}`}”`; }
  if (elementId) { const e = recs.element || findDesign('element', elementId); return `▣ Shows element “${e?.name ?? `#${elementId}`}” as popup`; }
  return 'Choose screen, popup element or repeater…';
}

export async function menuItemDialog({ buttonId, item = null, parentId: initialParentId = null, d = null }) {
  const menuNow = await api.menu(buttonId).catch(() => null);
  // the menu's button: from the library, else the open document, else fetched (a button of another project is not in the
  // loaded library, and its project decides the prefix of new variable names and where picked items are copied to)
  const host = findDesign('button', buttonId) || (Number(d?.doc?.id) === Number(buttonId) && d?.type === 'button' ? d.doc : null)
    || await api.getDesign('button', buttonId).catch(() => null);
  const projectId = host?.projectId ?? state.activeProjectId;
  return new Promise(resolve => {
    let done = false, iconId = item?.iconId ?? null, refButtonId = item?.refButtonId ?? null, nameTouched = !!item;
    // what the item does when clicked: a screen to route to OR an element shown as a popup (picked in one modal)
    let targetScreenId = item?.targetScreenId ?? null, targetElementId = targetScreenId ? null : item?.targetElementId ?? null, targetRecs = {};
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const label = h('input', { type: 'text', value: item?.label ?? '', placeholder: 'Shown to users' });
    const name = h('input', { type: 'text', value: item?.name ?? '', placeholder: 'variable-name (dashed words)', style: { fontFamily: 'Consolas, monospace' } });
    const action = h('input', { type: 'text', value: menuItemAction(item?.action ?? ''), placeholder: 'event name for leaf items, or scroll-repeater' });
    const actionPreset = h('select', { class: 'btn small', style: { minWidth: '120px' }, onchange: () => {
      if (actionPreset.value) action.value = actionPreset.value;
      // choosing Press and Scroll Items turns the slide option on by itself (the container stays on Auto)
      if (action.value.trim() === 'scroll-repeater' && slideCheck && !slideCheck.checked) { slideCheck.checked = true; slideCheck.dispatchEvent(new Event('change')); }
      paintTarget();
    } }, [
      ['', 'Action preset…'],
      ['scroll-repeater', '⟳ Press and Scroll Items']
    ].map(([v, l]) => h('option', { value: v, selected: (menuItemAction(item?.action ?? '') === v) }, l)));
    const targetBtn = h('button', { class: 'btn', type: 'button', 'data-f': 'mi-target', style: { width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
    const paintTarget = () => { targetBtn.textContent = targetSummary(targetScreenId, targetElementId, targetRecs, action.value.trim()); targetBtn.title = `${targetBtn.textContent}: click to choose a screen to go to, an element popup, or repeater container to scroll`; };
    targetBtn.addEventListener('click', async () => {
      const r = await pickTarget({ currentScreenId: targetScreenId, currentElementId: targetElementId, currentAction: action.value.trim(), projectId, allowCreate: false });
      const p = await targetPatch(r, projectId);
      if (!p) return;
      targetScreenId = p.targetScreenId; targetElementId = p.targetElementId;
      if (p.action !== undefined) {
        action.value = p.action;
        actionPreset.value = p.action === 'scroll-repeater' ? 'scroll-repeater' : '';
        // a repeater picked as the target turns the slide option on by itself too
        if (p.action === 'scroll-repeater' && slideCheck && !slideCheck.checked) { slideCheck.checked = true; slideCheck.dispatchEvent(new Event('change')); }
      }
      targetRecs = p.target ? { [p.type]: p.target } : {};
      paintTarget();
    });
    action.addEventListener('input', () => {
      actionPreset.value = action.value.trim() === 'scroll-repeater' ? 'scroll-repeater' : '';
      paintTarget();
    });
    paintTarget();
    const visCheck = h('input', { type: 'checkbox', checked: item?.visible !== false });
    const dev = h('textarea', { rows: 4, placeholder: 'description-dev: what the dev team must implement for this item' }); dev.value = item?.descriptionDev ?? '';
    const iconBtn = h('button', { class: 'btn', type: 'button' }), iconLabel = h('span', { class: 'muted' });
    // picked items can be outside the (filtered) library: remember the record the picker returned or fetch it
    const known = { icon: new Map(), button: new Map() };
    const lookup = async (type, id) => { if (id == null) return null; const hit = findDesign(type, id) || known[type].get(id); if (hit) return hit; try { const rec = await api.getDesign(type, id); known[type].set(id, rec); return rec; } catch { return null; } };
    const paintIcon = () => { const ic = findDesign('icon', iconId) || known.icon.get(iconId); iconBtn.textContent = ic ? `Icon: ${ic.label}` : 'Choose icon…'; iconLabel.textContent = ic ? ic.key : 'no icon'; };
    iconBtn.addEventListener('click', async () => { const r = await pickIcon(iconId); if (r !== null) { iconId = r || null; await lookup('icon', iconId); paintIcon(); } });
    // the variable name follows the label, with the project's prefix in front (not in the shared default project)
    const projPrefix = projectId != null && Number(projectId) !== 1 ? ((state.projects || []).find(p => Number(p.id) === Number(projectId))?.settings?.prefix || '') : '';
    const autoName = () => { const base = slugify(label.value || 'item', 'item'); return projPrefix && !base.startsWith(`${projPrefix}-`) ? `${projPrefix}-${base}` : base; };
    label.addEventListener('input', () => { if (!nameTouched) name.value = autoName(); });
    name.addEventListener('input', () => { nameTouched = true; });
    const btnBtn = h('button', { class: 'btn', type: 'button', 'data-f': 'mi-button' }), btnLabel = h('span', { class: 'muted' });
    const paintButton = () => { const b = findDesign('button', refButtonId) || known.button.get(refButtonId); btnBtn.textContent = b ? `Button: ${b.label || b.name}` : 'Choose button…'; btnLabel.textContent = b ? b.key : 'plain circle'; };
    btnBtn.addEventListener('click', async () => { const r = await pickButton(refButtonId, buttonId); if (r !== null) { refButtonId = r || null; await lookup('button', refButtonId); paintButton(); } });
    paintIcon(); paintButton();
    lookup('icon', iconId).then(paintIcon); lookup('button', refButtonId).then(paintButton);
    // parent picker (edit only): a tree of every menu item; the item itself and its sub items are not offered
    let parentId = item ? (item.parentId ?? null) : (initialParentId ?? null);   // a new item starts under the item it was added to (the + on an item adds a sub item)
    const treeBox = h('div', { class: 'el-list', 'data-f': 'mi-parent-tree', style: { maxHeight: '180px', overflow: 'auto', border: '1px solid var(--line, #8884)', borderRadius: '6px', padding: '4px' } });
    if (item && menuNow?.items) {
      const rowsAll = menuNow.items;
      const blocked = new Set([item.id]);
      for (let grew = true; grew;) { grew = false; for (const r of rowsAll) if (!blocked.has(r.id) && blocked.has(r.parentId)) { blocked.add(r.id); grew = true; } }
      const paintTree = () => {
        clear(treeBox);
        const row = (label, pid, depth) => h('div', { class: `el-row mi-parent${parentId === pid ? ' on' : ''}`, role: 'option', 'data-parent': pid == null ? '' : String(pid), style: { paddingLeft: `${7 + depth * 14}px`, cursor: 'pointer' },
          onclick: () => { parentId = pid; paintTree(); } }, h('span', { class: 'grow' }, `${pid == null ? '⌂ ' : ''}${label}`));
        const walk = (pid, depth) => rowsAll.filter(r => (r.parentId ?? null) === pid && !blocked.has(r.id)).sort((a, b) => a.ord - b.ord || a.id - b.id)
          .forEach(r => { treeBox.append(row(r.label || r.name, r.id, depth)); walk(r.id, depth + 1); });
        treeBox.append(row('Top level of the menu', null, 0));
        walk(null, 1);
      };
      paintTree();
    }
    // slide-to-scroll (per item): pressing this item when it is centred and sliding scrolls the chosen container of the screen
    const scrollCfg = (menuNow?.config?.itemScroll && item) ? menuNow.config.itemScroll[String(item.id)] : null;
    const slideCheck = h('input', { type: 'checkbox', 'data-f': 'mi-slide', checked: !!scrollCfg?.on });
    // only repeaters and scrollable containers can be the slide target (no other elements)
    const scrNodes = (d?.type === 'screen' ? (d.nodes || []) : []).filter(n => (n.kind !== 'instance' || n.refType !== 'button')
      && (isRepeaterNode(n, state.library?.elements) || isContainerNode(n, state.library?.elements)));
    const scrLabel = n => `${isContainerNode(n, state.library?.elements) ? '▣ ' : ''}${n.name || n.label || n.key || n.kind} · ${n.id}`;
    const scrollSel = h('select', { 'data-f': 'mi-scroll-target', style: { width: '100%' } },
      h('option', { value: '' }, '(Auto: the repeater container on the screen)'),
      ...[...scrNodes].sort((a, b) => Number(isContainerNode(b, state.library?.elements)) - Number(isContainerNode(a, state.library?.elements)))
        .map(n => h('option', { value: String(n.id), selected: scrollCfg?.targetId != null && String(scrollCfg.targetId) === String(n.id) }, scrLabel(n))),
      ...(scrollCfg?.targetId != null && !scrNodes.some(n => String(n.id) === String(scrollCfg.targetId)) ? [h('option', { value: String(scrollCfg.targetId), selected: true }, `element ${scrollCfg.targetId} (not on this screen)`)] : []));
    // slide mode: free scrolling, or stepping the focus through the list's items (the focused item is centred)
    const modeSel = h('select', { 'data-f': 'mi-scroll-mode', style: { width: '100%' } },
      h('option', { value: 'scroll', selected: scrollCfg?.mode === 'scroll' }, 'Scroll: the container scrolls freely while sliding'),
      h('option', { value: 'focus', selected: scrollCfg?.mode !== 'scroll' },'Focus: each slide step moves the focus to the next / previous item, kept in the centre'));
    const paintSlide = () => { scrollSel.disabled = !slideCheck.checked; modeSel.disabled = !slideCheck.checked; };
    slideCheck.addEventListener('change', paintSlide); paintSlide();
    const slideBox = h('div', { class: 'field', title: 'Only this item scrolls: press it while it is the centred hub button and slide up / down (or left / right).' },
      h('label', { class: 'row', style: { gap: '6px', alignItems: 'center', cursor: 'pointer' } }, slideCheck, h('span', {}, 'Slide this item (when centred) to scroll a container')),
      h('span', { class: 'muted' }, d?.type === 'screen' ? 'Scrollable container on this screen' : 'Scrollable container (open the item from a screen to list its elements)'),
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, scrollSel,
        libraryBrowseButton({
          currentAction: 'scroll-repeater', projectId: host?.projectId ?? state.activeProjectId, dataF: 'mi-scroll-browse',
          title: 'Library browser: repeaters and scrollable containers only',
          onAuto: () => { scrollSel.value = ''; },
          onPick: ({ elementId }) => {
            // the picked library container, as the instance of it on this screen
            const node = scrNodes.find(n => n.kind === 'instance' && n.refType === 'element' && Number(n.refId) === Number(elementId));
            if (!node) return toast('That container is not on this screen: place it here first', 'info');
            scrollSel.value = String(node.id);
          }
        })),
      modeSel);
    // gestures besides the click: long press and double click / tap
    const gestNow = (menuNow?.config?.itemGestures && item) ? menuNow.config.itemGestures[String(item.id)] || {} : {};
    // a gesture: Nothing, or open the focused item of the list — its own screen / popup, or one picked with the
    // browser button beside it (the same screen / popup window as the click action)
    const gestureRow = (key, title) => {
      const cur = gestNow[key] || { type: 'none', target: null };
      let type = cur.type === 'focused' ? 'focused' : 'none';
      let target = type === 'focused' && /^[se]-\d+$/.test(cur.target || '') ? cur.target : null;
      const typeSel = h('select', { 'data-f': `mi-gest-${key}`, class: 'grow' },
        h('option', { value: 'none', selected: type === 'none' }, 'Nothing'),
        h('option', { value: 'focused', selected: type === 'focused' }, 'Open the focused item of the list'));
      const what = h('span', { class: 'muted', style: { fontSize: '11px' } });
      const paint = () => {
        const on = typeSel.value === 'focused';
        pickBtn.disabled = !on; clearBtn.hidden = !on || !target;
        if (!on) { what.textContent = ''; return; }
        if (!target) { what.textContent = "Opens the focused item's own screen / popup"; return; }
        const id = Number(target.slice(2)), rec = target[0] === 's' ? findDesign('screen', id) : findDesign('element', id);
        what.textContent = target[0] === 's' ? `🖥 Goes to screen “${rec?.label || rec?.name || '#' + id}”` : `▣ Shows “${rec?.label || rec?.name || '#' + id}” as popup`;
      };
      const pickBtn = ibtn('monitor', 'Choose the screen or popup element to open (instead of the focused item\'s own)', async () => {
        const r = await pickTarget({ currentScreenId: target?.[0] === 's' ? Number(target.slice(2)) : null, currentElementId: target?.[0] === 'e' ? Number(target.slice(2)) : null, projectId, allowCreate: false });
        if (!r) return;
        const p = await targetPatch(r, projectId);
        if (!p) return;
        target = p.targetScreenId ? `s-${p.targetScreenId}` : p.targetElementId ? `e-${p.targetElementId}` : null;
        paint();
      }, { dataset: { f: `mi-gest-${key}-pick` } });
      const clearBtn = ibtn('close', 'Back to the focused item\'s own screen / popup', () => { target = null; paint(); });
      typeSel.addEventListener('change', paint); paint();
      return {
        el: h('div', { class: 'field grow' }, h('span', {}, title), h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, typeSel, pickBtn, clearBtn), what),
        value: () => typeSel.value === 'focused' ? { type: 'focused', target } : { type: 'none', target: null }
      };
    };
    const gLong = gestureRow('long', 'When long pressed'), gDbl = gestureRow('dbl', 'When double clicked / tapped');
    const gestBox = h('div', { class: 'field' },
      h('span', { class: 'muted' }, 'The click action is set above. "Open the focused item" uses the list this item slides (Slide option below): the item with the red edge.'),
      h('div', { class: 'row wrap', style: { gap: '10px' } }, gLong.el, gDbl.el));
    let m;
    const save = async () => {
      if (!label.value.trim() && !iconId && !refButtonId) return toast('Give the item a label, an icon or a button', 'error');
      const body = {
        label: label.value.trim(),
        name: name.value.trim() || autoName(),
        iconId,
        refButtonId,
        action: action.value.trim(),
        targetScreenId,
        targetElementId,
        visible: visCheck.checked,
        descriptionDev: dev.value
      };
      try {
        let saved = item ? await api.updateMenuItem(buttonId, item.id, body) : await api.addMenuItem(buttonId, { ...body, parentId });
        if (item && (parentId ?? null) !== (item.parentId ?? null)) { await api.moveMenuItem(buttonId, item.id, { parentId }); saved = { ...saved, parentId }; }
        const sid = saved?.id ?? item?.id;
        const prevMap = menuNow?.config?.itemScroll || {};
        const wantOn = slideCheck.checked, wantT = scrollSel.value || null, wantMode = modeSel.value;
        const had = prevMap[String(sid)];
        const patch = {};
        if (sid != null && (wantOn || had) && (!had || !!had.on !== wantOn || String(had.targetId ?? '') !== String(wantT ?? '') || (had.mode || 'focus') !== wantMode)) {
          // the first per item setting switches the menu from the old menu-wide rule to per item rules
          patch.itemScroll = { ...prevMap, [String(sid)]: { on: wantOn, targetId: wantT, mode: wantMode } };
        }
        const gPrev = menuNow?.config?.itemGestures || {}, gWant = { long: gLong.value(), dbl: gDbl.value() };
        if (sid != null && JSON.stringify(gPrev[String(sid)] || { long: { type: 'none', target: null }, dbl: { type: 'none', target: null } }) !== JSON.stringify(gWant)) {
          patch.itemGestures = { ...gPrev, [String(sid)]: gWant };
        }
        if (Object.keys(patch).length) await api.menuConfig(buttonId, patch);
        fin(saved); m.close();
      } catch (e) { toast(e.message, 'error'); }
    };
    m = modal({ title: item ? `Edit menu item “${item.label || item.name}”` : parentId ? 'New sub menu item' : 'New menu item', onClose: () => fin(null),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'row wrap' }, h('label', { class: 'field grow' }, h('span', {}, 'Label'), label), h('label', { class: 'field grow' }, h('span', {}, 'Variable name'), name)),
        h('div', { class: 'row wrap', style: { justifyContent: 'space-between' } },
          h('div', { class: 'row' }, iconBtn, iconLabel),
          h('label', { class: 'row', style: { cursor: 'pointer' } }, visCheck, h('span', {}, 'Visible in menu'))
        ),
        h('div', { class: 'row wrap', title: 'The item is drawn with this library button (its shape and style). The icon above replaces the button\'s own icon.' }, btnBtn, btnLabel),
        item ? h('div', { class: 'field' }, h('span', {}, 'Parent item (click one in the tree to move this item under it)'), treeBox) : null,
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } }, h('span', {}, 'Action (event name)'), actionPreset), action),
          h('div', { class: 'field grow', style: { minWidth: '0' } }, h('span', {}, 'When pressed and slid (screen, popup or repeater)'), targetBtn)
        ),
        gestBox,
        slideBox,
        h('label', { class: 'field' }, h('span', {}, 'description-dev'), dev)),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')] });
    setTimeout(() => label.focus(), 30);
  });
}

function resolveButtonId(d, buttonId = null) {
  if (buttonId != null) return Number(buttonId);
  if (d.type === 'button' && d.doc?.id) return d.doc.id;
  const sel = d.selectedNodes?.() || [];
  if (sel.length === 1 && sel[0].kind === 'instance' && sel[0].refType === 'button' && sel[0].refId) return sel[0].refId;
  return d.doc?.id;
}

function getButtonRows(d, bid) {
  if (d.type === 'button' && d.doc?.id === bid) return d.doc.menuItems || [];
  const libBtn = findDesign('button', bid);
  return libBtn?.menuItems || [];
}

/* ---------- menu tools for the library cards' hover toolbar (no designer open) ---------- */
function pickMenuItem(rows) {
  return new Promise(resolve => {
    let done = false, m;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const label = r => { const parts = []; for (let cur = r; cur; cur = cur.parentId != null ? rows.find(x => x.id === cur.parentId) : null) parts.unshift(cur.label || cur.name); return parts.join(' › '); };
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '320px', overflow: 'auto' } },
      ...rows.map(r => h('button', { class: 'btn', style: { textAlign: 'left' }, onclick: () => { fin(r); m.close(); } }, label(r))));
    m = modal({ title: 'Add a sub menu item to…', onClose: () => fin(null), content: list, actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
  });
}

export const libraryMenuTools = {
  /** ＋ on a button card: a new top-level menu item. */
  async addItem(button) {
    const saved = await menuItemDialog({ buttonId: button.id, parentId: null });
    if (saved) await reloadLibrary({ silent: true });
    return saved;
  },
  /** Sub menu item tool: choose the parent item, then fill in the new sub item. */
  async addSubItem(button) {
    const m = await api.menu(button.id);
    const rows = m.items || [];
    if (!rows.length) { toast('This button has no menu items yet: use ＋ first.', 'error'); return null; }
    const parent = rows.length === 1 ? rows[0] : await pickMenuItem(rows);
    if (!parent) return null;
    const saved = await menuItemDialog({ buttonId: button.id, parentId: parent.id });
    if (saved) await reloadLibrary({ silent: true });
    return saved;
  }
};

/* ---------- actions shared by the hover toolbar and the inspector ---------- */
export const menuActions = {
  async refresh(d, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const m = await api.menu(bid);
    if (d.type === 'button' && d.doc?.id === bid) {
      d.doc.menuItems = m.items;
      d.doc.meta = { ...d.doc.meta, menu: m.config };
    }
    const libBtn = findDesign('button', bid);
    if (libBtn) {
      libBtn.menuItems = m.items;
      libBtn.meta = { ...libBtn.meta, menu: m.config };
    }
    await reloadLibrary({ silent: true });
    d.menu?.afterChange();
    d.renderAll(); d.changed();
  },
  async add(d, parentId = null, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return null;
    const saved = await menuItemDialog({ buttonId: bid, parentId, d });
    if (saved) {
      await this.refresh(d, bid);
      const rows = getButtonRows(d, bid);
      d.menu?.enter(saved.parentId == null ? [] : this.pathOf(rows, saved.parentId));
    }
    return saved;
  },
  async edit(d, itemId, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const rows = getButtonRows(d, bid);
    const item = rows.find(i => i.id === itemId);
    if (item && await menuItemDialog({ buttonId: bid, item, d })) await this.refresh(d, bid);
  },
  async remove(d, itemId, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const rows = getButtonRows(d, bid);
    const item = rows.find(i => i.id === itemId);
    if (!item || !await confirmBox(`Delete “${item.label || item.name}” and all its sub items?`)) return;
    await api.deleteMenuItem(bid, itemId);
    await this.refresh(d, bid);
  },
  async move(d, itemId, dir, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const rows = getButtonRows(d, bid), it = rows.find(i => i.id === itemId);
    if (!it) return;
    const sibs = rows.filter(r => (r.parentId ?? null) === (it.parentId ?? null)).sort((a, b) => a.ord - b.ord || a.id - b.id);
    const i = sibs.indexOf(it), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const other = sibs[j];
    await api.updateMenuItem(bid, it.id, { ord: other.ord === it.ord ? other.ord + dir : other.ord });
    await api.updateMenuItem(bid, other.id, { ord: it.ord === other.ord ? it.ord - dir : it.ord });
    await this.refresh(d, bid);
  },
  /** Drag and drop in the inspector tree: put an item before / after / inside another one (or at the end of the top level when `targetId` is null). */
  async moveTo(d, itemId, targetId, where, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid || itemId === targetId) return false;
    const rows = getButtonRows(d, bid), it = rows.find(r => r.id === itemId), tg = rows.find(r => r.id === targetId);
    if (!it || (targetId != null && !tg)) return false;
    const to = dropTarget(rows, it, tg, where);
    if (!to) return false;
    try { await api.moveMenuItem(bid, itemId, to); } catch (e) { toast(e.message, 'error'); return false; }
    await this.refresh(d, bid);
    return true;
  },
  /**
   * What a menu item does when clicked, from the screen / element picker (toolbar 🖥 and the edit dialog use the same modal):
   * route to a screen OR show an element as a popup. A screen / element of another project or of the public library is copied
   * into this button's project first (the user names the copy); "new screen" opens a new tab that creates one and links it back.
   */
  async linkTarget(d, itemId, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const host = d.doc?.id === bid ? d.doc : findDesign('button', bid);
    const projectId = host?.projectId ?? state.activeProjectId;
    const it = getButtonRows(d, bid).find(r => r.id === itemId);
    if (!it) return;
    const r = await pickTarget({ currentScreenId: it.targetScreenId ?? null, currentElementId: it.targetElementId ?? null, projectId });
    if (!r) return;
    if (r.create) {
      const w = window.open(`${location.origin}${location.pathname}?${new URLSearchParams({ new: 'screen', link: `${bid}:${itemId}`, projectId: String(projectId ?? '') })}`, '_blank');
      return w ? toast('Create the screen in the new tab: it is linked to this item when it is created', 'info', 3000) : toast('The browser blocked the new tab: allow pop-ups for this site', 'error');
    }
    const p = await targetPatch(r, projectId);
    if (!p) return;
    try { await api.updateMenuItem(bid, itemId, { targetScreenId: p.targetScreenId, targetElementId: p.targetElementId }); } catch (e) { return toast(e.message, 'error'); }
    await this.refresh(d, bid);
    const who = it.label || it.name;
    toast(p.type === 'screen' ? `“${who}” → ${p.target.name}` : p.type === 'element' ? `“${who}” shows ${p.target.name} as a popup` : `“${who}” goes nowhere`, 'ok', 1800);
  },
  async toggleVisible(d, itemId, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    const rows = getButtonRows(d, bid), it = rows.find(i => i.id === itemId);
    if (!it) return;
    await api.updateMenuItem(bid, it.id, { visible: it.visible === false });
    await this.refresh(d, bid);
  },
  async config(d, patch, buttonId = null) {
    const bid = resolveButtonId(d, buttonId);
    if (!bid) return;
    await api.menuConfig(bid, patch);
    await this.refresh(d, bid);
    if (patch && (patch.hubCount !== undefined || patch.kind !== undefined || patch.hubFixedPositions !== undefined)) {
      d.fit?.();
    }
  },
  pathOf(rows, id) {
    const parts = [];
    for (let cur = rows.find(r => r.id === id); cur; cur = cur.parentId != null ? rows.find(r => r.id === cur.parentId) : null) parts.unshift(cur.name);
    return parts;
  }
};

/**
 * Dedicated interactive modal for editing menu items:
 * - Shows all items on the menu with icon, label and action/target summary
 * - Right-side toolbar for each item: Target (🖥), Visibility (👁/—), Move Up (↑), Move Down (↓), Default Centre (◎ for hub), Edit (✎), Delete (🗑)
 * - Drag-and-drop to reorder items inside the modal (with live indicator and moveTo)
 * - "＋ Add new menu item" at the bottom
 */
export async function openMenuItemsModal(d, buttonId) {
  const bid = resolveButtonId(d, buttonId);
  if (!bid) return;

  return new Promise(resolve => {
    let m = null, dragId = null, screens = null;
    // names of the target screens (the library lists hold no screens)
    api.list('screen', '', { includePublic: true }).then(r => { screens = new Map(r.map(s => [Number(s.id), s])); if (m && dragId == null) paint(); }).catch(() => {});

    const paint = () => {
      const rows = getButtonRows(d, bid);
      const host = d.type === 'button' && d.doc?.id === bid ? d.doc : findDesign('button', bid);
      const cfg = menuConfig(host?.meta);
      const isHub = cfg.kind === 'hub';

      const itemsList = h('div', {
        class: 'choice-list mi-modal-list',
        ondragover: e => {
          if (dragId != null) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        },
        ondrop: async e => {
          e.preventDefault();
          const id = dragId;
          dragId = null;
          document.querySelectorAll('.mi-drop-before, .mi-drop-after').forEach(el => el.classList.remove('mi-drop-before', 'mi-drop-after'));
          if (id != null) {
            await menuActions.moveTo(d, id, null, 'after', bid);
            paint();
          }
        }
      });

      const rootRows = rows.filter(r => r.parentId == null);
      const displayRows = rootRows.length ? rootRows : rows;
      // every item of the menu, sub items under their parent (indented), each level in its own order
      const ordered = [], listed = new Set();
      const walk = (pid, depth) => {
        for (const r of rows.filter(x => (x.parentId ?? null) === pid).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id)) {
          if (listed.has(r.id)) continue;
          listed.add(r.id); ordered.push([r, depth]); walk(r.id, depth + 1);
        }
      };
      walk(null, 0);
      for (const r of rows) if (!listed.has(r.id)) ordered.push([r, 0]);   // a row whose parent is gone still shows

      ordered.forEach(([it, depth]) => {
        const isDefault = isHub && depth === 0 && (Number(cfg.hubCenterItemId) === Number(it.id) || (cfg.hubCenterItemId == null && displayRows.findIndex(r => r.visible !== false) === displayRows.indexOf(it)));
        const isHidden = it.visible === false;

        const row = h('div', {
          class: `choice-item mi-row${isHidden ? ' mi-hidden' : ''}`,
          draggable: 'true',
          'data-menu-id': String(it.id),
          ondragstart: e => {
            e.stopPropagation();
            dragId = it.id;
            e.dataTransfer.setData('text/plain', String(it.id));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('mi-dragging');
          },
          ondragend: () => {
            dragId = null;
            document.querySelectorAll('.mi-drop-before, .mi-drop-after, .mi-dragging').forEach(el => el.classList.remove('mi-drop-before', 'mi-drop-after', 'mi-dragging'));
          },
          ondragover: e => {
            if (dragId == null || dragId === it.id) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const y = (e.clientY - rect.top) / (rect.height || 1);
            row.classList.remove('mi-drop-before', 'mi-drop-after');
            row.classList.add(y < 0.5 ? 'mi-drop-before' : 'mi-drop-after');
          },
          ondragleave: () => {
            row.classList.remove('mi-drop-before', 'mi-drop-after');
          },
          ondrop: async e => {
            e.preventDefault();
            e.stopPropagation();
            const id = dragId;
            const where = row.classList.contains('mi-drop-before') ? 'before' : 'after';
            row.classList.remove('mi-drop-before', 'mi-drop-after');
            dragId = null;
            if (id != null && id !== it.id) {
              await menuActions.moveTo(d, id, it.id, where, bid);
              paint();
            }
          },
          onclick: async e => {
            if (e.target.closest('button, input, select, a, .mi-toolbar')) return;
            await menuActions.edit(d, it.id, bid);
            paint();
          }
        });

        // Grip handle
        const grip = h('span', { class: 'el-grip mi-drag-handle', title: 'Drag and drop to reorder' }, iconEl('grip', { size: 16 }));

        // Lead icon: pencil
        const leadIcon = h('span', { class: 'ico', title: 'Edit menu item' }, iconEl('pencil', { size: 16 }));

        // Label and target/action summary
        const labelText = `${it.label || it.name || `Item #${it.id}`}${isHidden ? '  · hidden' : ''}`;
        const descText = targetSummary(it.targetScreenId, it.targetElementId, { screen: screens?.get(Number(it.targetScreenId)) }, it.action);
        const textBlock = h('span', { class: 'choice-text grow', style: { minWidth: 0, overflow: 'hidden' } },
          h('b', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, labelText),
          h('small', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, descText)
        );

        // Right-aligned toolbar
        const toolbar = h('div', { class: 'mi-toolbar', onclick: e => e.stopPropagation() });

        // 1. Target picker button 🖥
        toolbar.append(h('button', {
          class: 'btn small ib',
          type: 'button',
          title: 'Choose target screen, popup element or repeater scroll',
          'aria-label': 'Target picker',
          onclick: async () => {
            await menuActions.linkTarget(d, it.id, bid);
            paint();
          }
        }, iconEl('monitor', { size: 14 })));

        // 2. Visibility toggle button 👁 / —
        toolbar.append(h('button', {
          class: `btn small ib${isHidden ? ' dim' : ''}`,
          type: 'button',
          title: isHidden ? 'Show menu item' : 'Hide menu item',
          'aria-label': 'Toggle visibility',
          onclick: async () => {
            await menuActions.toggleVisible(d, it.id, bid);
            paint();
          }
        }, iconEl(isHidden ? 'close' : 'view', { size: 14 })));

        // 3. Move up button ↑
        toolbar.append(h('button', {
          class: 'btn small ib',
          type: 'button',
          title: 'Move up (earlier)',
          'aria-label': 'Move up',
          onclick: async () => {
            await menuActions.move(d, it.id, -1, bid);
            paint();
          }
        }, iconEl('arrowUp', { size: 14 })));

        // 4. Move down button ↓
        toolbar.append(h('button', {
          class: 'btn small ib',
          type: 'button',
          title: 'Move down (later)',
          'aria-label': 'Move down',
          onclick: async () => {
            await menuActions.move(d, it.id, 1, bid);
            paint();
          }
        }, iconEl('arrowDown', { size: 14 })));

        // 4b. Add a sub item under this item
        toolbar.append(h('button', {
          class: 'btn small ib',
          type: 'button',
          title: `Add a sub item under “${it.label || it.name}”`,
          'aria-label': 'Add sub item',
          onclick: async () => {
            await menuActions.add(d, it.id, bid);
            paint();
          }
        }, iconEl('plus', { size: 14 })));

        // 5. Default centre button ◎ (for hub menus: a top-level item)
        if (isHub && depth === 0) {
          toolbar.append(h('button', {
            class: `btn small ib${isDefault ? ' active' : ''}`,
            type: 'button',
            title: isDefault ? 'Default centre button' : `Set "${it.label || it.name}" as default centre`,
            'aria-label': 'Default centre',
            onclick: async () => {
              await menuActions.config(d, { hubCenterItemId: it.id }, bid);
              toast('Default centre button set', 'ok', 1400);
              paint();
            }
          }, iconEl('target', { size: 14 })));
        }

        // 6. Edit item button ✎
        toolbar.append(h('button', {
          class: 'btn small ib',
          type: 'button',
          title: 'Edit menu item',
          'aria-label': 'Edit item',
          onclick: async () => {
            await menuActions.edit(d, it.id, bid);
            paint();
          }
        }, iconEl('pencil', { size: 14 })));

        // 7. Delete item button 🗑
        toolbar.append(h('button', {
          class: 'btn small ib danger',
          type: 'button',
          title: 'Delete this item',
          'aria-label': 'Delete item',
          onclick: async () => {
            await menuActions.remove(d, it.id, bid);
            paint();
          }
        }, iconEl('trash', { size: 14 })));

        row.append(grip, leadIcon, textBlock, toolbar);
        if (depth) { const ml = Math.min(depth, 4) * 22; row.style.marginLeft = `${ml}px`; row.style.width = `calc(100% - ${ml}px)`; row.classList.add('mi-sub'); }
        itemsList.append(row);
      });

      // Bottom card: Add new menu item
      const addRow = h('button', {
        class: 'choice-item primary mi-add-row',
        type: 'button',
        onclick: async () => {
          await menuActions.add(d, null, bid);
          paint();
        }
      },
        iconEl('plus', { size: 16 }),
        h('span', { class: 'choice-text' },
          h('b', {}, 'Add new menu item'),
          h('small', {}, 'Create another entry in this menu')
        )
      );
      itemsList.append(addRow);

      const count = rows.length;
      const subtitle = `${count} item(s) on this menu, sub items under their parent. Drag a row by ⠿ to change the order; the tools on the right set the target, hide, move, add a sub item, edit or delete.`;

      const content = h('div', { class: 'choice-list' },
        h('p', { class: 'muted' }, subtitle),
        itemsList
      );

      if (!m) {
        m = modal({
          title: 'Edit menu items',
          wide: true,
          content,
          onClose: () => resolve(),
          actions: close => [
            h('button', { class: 'btn', onclick: () => { close(); resolve(); } }, 'Cancel')
          ]
        });
      } else {
        const body = m.el.querySelector('.modal-body');
        if (body) {
          clear(body);
          body.append(content);
        }
      }
    };

    paint();
  });
}

/* ---------- the live menu on the canvas ---------- */
export class MenuEditor {
  constructor(designer) {
    this.d = designer;
    this.menuState = { open: true, path: [] };     // the editor shows the menu open so items can be edited
    this.ctl = null; this.hover = null; this.hideTimer = null;
    this.toolbar = h('div', { class: 'rm-toolbar', hidden: true, role: 'toolbar', 'aria-label': 'Menu item tools' });
    this.toolbar.addEventListener('pointerenter', () => clearTimeout(this.hideTimer));
    this.toolbar.addEventListener('pointerleave', () => this.scheduleHide());
    this.toolbar.addEventListener('click', e => e.stopPropagation());   // a click on the toolbar must not close the open hub level (outside-click rule)
    designer.viewport.appendChild(this.toolbar);
    // same behaviour as the exported page; leaf clicks keep the menu open while editing, or trigger actions/routes in Test mode
    designer.stage.addEventListener('dblclick', ev => this.onDblClick(ev), true);
    // a clicked item keeps its action toolbar until the next click elsewhere on the canvas
    // (on screens too: the toolbar of a placed menu button used to stay behind as a ghost because only button docs hid it)
    designer.stage.addEventListener('click', ev => {
      if (ev.target.closest?.('.rm-item, [data-rm="center"], .rm-toolbar')) return;
      this.pinned = null; this.hideToolbar();
    });
    // leaving the canvas, Escape, a pan / zoom or another document also take it away
    designer.viewport.addEventListener('pointerleave', ev => { if (!ev.relatedTarget?.closest?.('.rm-toolbar')) { this.pinned = null; this.scheduleHide(); } });
    designer.viewport.addEventListener('wheel', () => { this.pinned = null; this.hideToolbar(); }, { passive: true });
    designer.viewport.addEventListener('keydown', ev => { if (ev.key === 'Escape') { this.pinned = null; this.hideToolbar(); } });
    // the toolbar never outlives its context: a press anywhere outside the menu items (side panels, tabs, other screens),
    // Escape from any focus, or the viewport leaving the page removes it (no ghost toolbar left on the screen)
    const dismissOutside = ev => {
      if (this.toolbar.hidden) return;
      if (!designer.viewport.isConnected) { this.toolbar.remove(); document.removeEventListener('pointerdown', dismissOutside, true); document.removeEventListener('keydown', dismissEsc, true); return; }
      if (ev.target?.closest?.('.rm-toolbar, .rm-item, [data-rm="center"]')) return;
      this.pinned = null; this.hideToolbar();
    };
    const dismissEsc = ev => { if (ev.key === 'Escape' && !this.toolbar.hidden) { this.pinned = null; this.hideToolbar(); } };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissEsc, true);
    this.ctl = bindMenus(designer.stage, {
      keepOpen: true,
      focusRings: () => !!(this.d.actionsLive || this.d.menuLive),   // the red frame is a runtime aid: shown in the test view, not while editing
      onState: (_, st) => { this.menuState = st; },
      onItem: (_, el) => {
        if (!this.active || this.d.actionsLive || this.d.menuLive) return;
        this.pinned = el.getAttribute('data-menu-id');
        this.hover = null;
        this.showPinned(0);
        this.showPinned(400);   // again once the item has moved into place (hub swap / fan transition)
      },
      onAction: async a => {
        if (!this.d.actionsLive && !this.d.menuLive) return;
        // Press and Scroll Items: the runtime already stepped the list; the menu stays open for more taps / slides
        if (a.action === 'scroll-repeater') return;
        const btnEl = designer.stage.querySelector(`.ud-btn[data-menu="${a.menu}"]`) || designer.stage.querySelector('.ud-btn');
        if (btnEl) this.ctl.set(btnEl, { open: false, path: [] });
        if (a.targetElementId || a.targetElement) {
          const el = state.library.elements.find(e => String(e.id) === String(a.targetElementId) || e.key === a.targetElement || String(e.id) === String(a.targetElement));
          if (el) {
            toast(`Menu "${a.item}" → Popup: ${el.name}`, 'ok', 1800);
            return this.d.showPreview('popup', null, el);
          }
        }
        if (a.target) {
          const screens = await api.list('screen');
          const targetScreen = screens.find(s => s.key === a.target || String(s.id) === String(a.target));
          if (targetScreen) return this.d.navigateLiveToScreen(targetScreen.id, `Menu “${a.item}”`);   // stays in the live test
        }
        toast(`⚡ Menu item “${a.item}”${a.action ? ` fires “${a.action}”` : ''} · no target screen`, 'ok', 2200);
      }
    });
  }

  get active() { return this.d.type === 'button'; }

  /** The button an item is drawn with: its own pick, else the menu's button style (null = the open button's own body). */
  itemButtonId(item, buttonId) {
    const host = this.d.doc?.id === buttonId ? this.d.doc : state.library.buttons.find(b => b.id === buttonId);
    return item?.refButtonId ?? menuConfig(host?.meta).itemButtonId ?? null;
  }

  /** Double-click a menu item placeholder in the editor: it acts as a button and opens the edit page of the button inside it. */
  onDblClick(ev) {
    if (!this.active || this.d.actionsLive || this.d.menuLive) return;
    const hit = this.itemAtEvent(ev);
    if (!hit) return;
    ev.stopPropagation(); ev.preventDefault();
    const it = hit.item || (hit.menuItems || [])[0];
    const bid = it ? this.itemButtonId(it, hit.buttonId) : null;
    if (bid && bid !== this.d.doc?.id && this.d.opts.openDesign) return this.d.opts.openDesign('button', bid);
    if (it) return menuActions.edit(this.d, it.id, hit.buttonId);
  }

  /** Called after every stage render: the DOM was replaced, restore the open/level state. */
  afterRender() {
    // menus placed on a screen / element: lay out every hub bar again (the stage markup was replaced)
    if (!this.active) {
      for (const b of this.d.stage.querySelectorAll('.ud-btn')) if (b.querySelector('.ud-menu[data-kind="hub"]')) this.ctl.apply(b, this.ctl.get(b));
      return;
    }
    const btn = this.d.stage.querySelector('.ud-btn');
    if (btn) this.ctl.set(btn, this.menuState);
    this.hideToolbar();
    if (this.pinned) this.showPinned(400);
  }

  /** Shows the action toolbar of the clicked (pinned) menu item, when that item is still on screen. */
  showPinned(delay) {
    clearTimeout(this.pinTimer);
    this.pinTimer = setTimeout(() => {
      if (!this.pinned || !this.active) return;
      const el = [...this.d.stage.querySelectorAll('.rm-level.is-active .rm-item')].find(e => e.getAttribute('data-menu-id') === this.pinned && e.getAttribute('data-hub-pos') !== 'hidden');
      const hit = el ? this.itemAtEvent({ target: el }) : null;
      if (!hit) { this.pinned = null; return this.hideToolbar(); }
      clearTimeout(this.hideTimer);
      this.hover = null;
      this.show(hit);
    }, delay);
  }
  afterChange() {
    if (!this.active) return;
    // a level may have disappeared (deleted item): fall back to the closest existing one
    const rows = this.d.doc.menuItems || [], paths = new Set(buildFlatPaths(rows));
    while (this.menuState.path.length && !paths.has(this.menuState.path.join('/'))) this.menuState.path.pop();
  }
  enter(path) { this.menuState = { open: true, path }; this.d.renderStage(); }

  itemAtEvent(ev) {
    const t = ev.target;
    const btnEl = t.closest?.('.ud-btn');
    const btnKey = btnEl?.getAttribute?.('data-menu');
    const libBtn = btnKey ? state.library.buttons.find(b => b.key === btnKey) : null;
    const buttonId = this.active ? this.d.doc?.id : libBtn?.id;
    const menuItems = this.active ? (this.d.doc?.menuItems || []) : (libBtn?.menuItems || []);
    if (!buttonId) return null;
    const it = t.closest?.('.rm-item');
    if (it) {
      const found = menuItems.find(m => String(m.id) === it.dataset.menuId || menuActions.pathOf(menuItems, m.id).join('/') === it.dataset.item);
      if (found) return { el: it, item: found, buttonId, menuItems };
    }
    const hub = t.closest?.('[data-rm="center"]');
    if (hub) return { el: hub, item: null, hub: true, buttonId, menuItems };
    return null;
  }

  onMove(ev) {
    if (!this.d.doc) return;
    if (ev.target.closest?.('.rm-toolbar')) return;
    const hit = this.itemAtEvent(ev);
    if (!hit) return this.scheduleHide();
    clearTimeout(this.hideTimer);
    this.show(hit);
  }

  // leaving a hovered item returns to the pinned (clicked) item's toolbar, if any
  scheduleHide() { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => (this.pinned ? this.showPinned(0) : this.hideToolbar()), 350); }
  hideToolbar() { clearTimeout(this.hideTimer); this.toolbar.hidden = true; this.hover = null; }

  show(hit) {
    const key = hit.hub ? `hub-${hit.buttonId}` : `${hit.buttonId}-${hit.item?.id}`;
    const vr = this.d.viewport.getBoundingClientRect(), r = hit.el.getBoundingClientRect();
    this.toolbar.style.top = `${Math.max(46, r.top - vr.top - 40)}px`;
    this.toolbar.hidden = false;
    // centred over the item, kept inside the canvas (the toolbar is centred on its left position)
    const half = (this.toolbar.offsetWidth || 240) / 2 + 6;
    this.toolbar.style.left = `${Math.min(Math.max(r.left - vr.left + r.width / 2, half), Math.max(half, vr.width - half))}px`;
    if (this.hover === key) return;
    this.hover = key;
    clear(this.toolbar);
    const rows = hit.menuItems || [];
    const levelItem = this.menuState.path.length ? rows.find(m => menuActions.pathOf(rows, m.id).join('/') === this.menuState.path.join('/')) : null;
    const btn = (glyph, title, fn, cls = 'icon-btn small') => h('button', { class: cls, title, onclick: e => { e.stopPropagation(); this.hideToolbar(); fn(); } }, glyph);
    const closeX = () => h('button', { class: 'icon-btn small', title: 'Close this toolbar (Esc)', 'data-act': 'rm-toolbar-close', onclick: e => { e.stopPropagation(); this.pinned = null; this.hideToolbar(); } }, '✕');
    if (hit.hub) {
      this.toolbar.append(
        h('span', { class: 'muted', style: { padding: '0 6px', fontSize: '11px' } }, levelItem ? levelItem.label || levelItem.name : 'menu'),
        btn('＋', levelItem ? `Add a sub item to “${levelItem.label || levelItem.name}”` : 'Add a menu item', () => menuActions.add(this.d, levelItem?.id ?? null, hit.buttonId))
      );
      if (rows.length) {
        this.toolbar.append(
          btn('✎ Edit menu item', 'Edit menu item', () => menuActions.edit(this.d, (levelItem || rows[0]).id, hit.buttonId), 'btn small')
        );
        if (levelItem) this.toolbar.append(btn('🖥', `${targetSummary(levelItem.targetScreenId, levelItem.targetElementId)}: choose a screen or a popup element`, () => menuActions.linkTarget(this.d, levelItem.id, hit.buttonId)), ...this.focusButtons(rows, levelItem, btn));
      }
    } else if (hit.item) {
      const it = hit.item;
      this.toolbar.append(
        btn('✎ Edit menu item', `Edit menu item “${it.label || it.name}” (double-click the item to open its button)`, () => menuActions.edit(this.d, it.id, hit.buttonId), 'btn small primary'),
        btn('＋', `Add a sub item to “${it.label || it.name}”`, () => menuActions.add(this.d, it.id, hit.buttonId)),
        btn('🖥', `${targetSummary(it.targetScreenId, it.targetElementId)}: choose a screen to go to or an element to show as a popup (copy one into this project or create a new screen)`, () => menuActions.linkTarget(this.d, it.id, hit.buttonId)),
        btn(it.visible === false ? '—' : '👁', it.visible === false ? 'Show menu item' : 'Hide menu item', () => menuActions.toggleVisible(this.d, it.id, hit.buttonId)),
        btn('←', 'Move earlier', () => menuActions.move(this.d, it.id, -1, hit.buttonId)),
        btn('→', 'Move later', () => menuActions.move(this.d, it.id, 1, hit.buttonId)),
        btn('🗑', 'Delete this item', () => menuActions.remove(this.d, it.id, hit.buttonId))
      );
      if (this.d.stage.querySelector('.ud-menu[data-kind="hub"]')) this.toolbar.append(...this.focusButtons(rows, it, btn));
      // hub ring item: make it the centre button the menu starts on (between its neighbours of the same level)
      if (hit.el.hasAttribute('data-hub-index')) {
        const host = this.d.doc?.id === hit.buttonId ? this.d.doc : state.library.buttons.find(b => b.id === hit.buttonId);
        const isDefault = Number(menuConfig(host?.meta).hubCenterItemId) === Number(it.id) || (menuConfig(host?.meta).hubCenterItemId == null && hit.el.getAttribute('data-hub-index') === '0');
        this.toolbar.append(isDefault
          ? h('span', { class: 'badge accent', title: 'The hub menu starts with this item in the centre' }, '◎ Default centre')
          : btn('◎', `Set “${it.label || it.name}” as the default centre button`, () => this.setDefaultCentre(it.id, hit.buttonId, +hit.el.getAttribute('data-hub-index'))));
      }
    }
    this.toolbar.append(closeX());
  }

  /** Toolbar buttons that focus the previous / next item on the same level (hub: the sub menu centres on its main item, so its neighbours are one step away). */
  focusButtons(rows, it, btn) {
    const sibs = rows.filter(r => (r.parentId ?? null) === (it.parentId ?? null) && r.visible !== false).sort((a, b) => a.ord - b.ord || a.id - b.id);
    const i = sibs.findIndex(r => r.id === it.id);
    if (i < 0 || sibs.length < 2) return [];
    const go = (j, glyph, title) => {
      const t = sibs[(j + sibs.length) % sibs.length];
      return btn(glyph, `${title}: “${t.label || t.name}” (same level, wraps around)`, () => this.focusItem(t.id));
    };
    return [go(i - 1, '⏴', 'Focus previous item'), go(i + 1, '⏵', 'Focus next item')];
  }

  /**
   * Brings a menu item into view on the canvas (row click in the inspector's item list): opens the level that holds it
   * (hub: its top-level ancestor swaps into the centre and that fan opens), pins its toolbar and pans to it when off screen.
   */
  focusItem(itemId) {
    if (!this.active || !this.d.doc) return;
    const rows = this.d.doc.menuItems || [];
    const it = rows.find(r => r.id === itemId);
    if (!it) return;
    const path = menuActions.pathOf(rows, it.id);
    const host = this.d.stage.querySelector('.ud-btn');
    const isHub = !!host?.querySelector('.ud-menu[data-kind="hub"]');
    const parentPath = path.slice(0, -1);
    let st = { open: true, path: parentPath };
    if (isHub) {
      const fixed = host?.querySelector('.ud-menu[data-hub-fixed="1"]');
      if (fixed) {
        st = { open: true, path: parentPath, c: this.menuState.c || 0, prev: this.menuState.prev || 0 };
      } else {
        // the top-level ancestor sits in the centre; its sub level is the one shown
        const top = rows.find(r => r.name === path[0] && r.parentId == null);
        const el = top && host.querySelector(`.rm-hub-item[data-menu-id="${top.id}"]`);
        const c = el ? +el.getAttribute('data-hub-index') : (this.menuState.c || 0);
        st = { open: true, path: parentPath, c, prev: this.menuState.c ?? c };
      }
    }
    this.menuState = st;
    if (host) this.ctl.set(host, st);
    this.focusedId = it.id;
    this.pinned = String(it.id);
    this.hover = null;
    this.showPinned(0);
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {                 // once the item has moved into place
      const el = [...this.d.stage.querySelectorAll('.rm-level.is-active .rm-item')].find(e => e.getAttribute('data-menu-id') === String(it.id) && e.getAttribute('data-hub-pos') !== 'hidden');
      if (!el || this.focusedId !== it.id) return;
      this.pinned = String(it.id);                      // a re-render in between may have dropped the pin
      el.classList.add('rm-focus');
      setTimeout(() => el.classList.remove('rm-focus'), 1200);
      const vr = this.d.viewport.getBoundingClientRect(), r = el.getBoundingClientRect(), m = 24;
      const out = r.left < vr.left + m || r.right > vr.right - m || r.top < vr.top + 46 || r.bottom > vr.bottom - m;
      if (out) {
        this.d.view.tx += (vr.left + vr.width / 2) - (r.left + r.width / 2);
        this.d.view.ty += (vr.top + vr.height / 2) - (r.top + r.height / 2);
        this.d.applyView(); this.d.renderOverlay?.();
      }
      this.showPinned(0);
    }, 420);
  }

  async setDefaultCentre(itemId, buttonId, index) {
    if (this.active && this.d.doc?.id === buttonId && index >= 0) this.menuState = { open: true, path: [], c: index, prev: index };
    await menuActions.config(this.d, { hubCenterItemId: itemId }, buttonId);
    toast('Default centre button set', 'ok', 1400);
  }
}

function buildFlatPaths(rows) {
  const out = [''];
  const walk = list => list.forEach(n => { out.push(n.path); walk(n.children); });
  walk(buildMenuTree(rows));
  return out;
}
