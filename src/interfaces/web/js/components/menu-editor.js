/**
 * Menu editing for buttons (popup / rotating menus):
 *  - MenuEditor: the live menu on the designer canvas, a mouse-over toolbar on the button and on every item
 *    (add sub item · edit · delete) and the same click behaviour as the exported page (via menu-runtime).
 *  - menuActions: add / edit / delete / move / settings, shared with the inspector.
 */
import { h, modal, toast, confirmBox, clear } from '../dom.js';
import { api } from '../api.js';
import { state, findDesign } from '../state.js';
import { reloadLibrary } from '../actions.js';
import { ensureIconSymbols } from '../icon-store.js';

import { bindMenus } from '/domain/menu-runtime.js';
import { slugify } from '/domain/naming.js';
import { buildMenuTree, menuConfig, dropTarget } from '/domain/menu.js';

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
      const rows = all.filter(r => r.b.id !== excludeId && (!s || `${r.b.key} ${r.b.label} ${r.b.name} ${r.b.category}`.toLowerCase().includes(s)));
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

export async function menuItemDialog({ buttonId, item = null, parentId = null }) {
  const [screens, elements, menuNow] = await Promise.all([
    api.list('screen'),
    state.library.elements?.length ? Promise.resolve(state.library.elements) : api.list('element'),
    item ? api.menu(buttonId).catch(() => null) : null
  ]);
  return new Promise(resolve => {
    let done = false, iconId = item?.iconId ?? null, refButtonId = item?.refButtonId ?? null, nameTouched = !!item;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const label = h('input', { type: 'text', value: item?.label ?? '', placeholder: 'Shown to users' });
    const name = h('input', { type: 'text', value: item?.name ?? '', placeholder: 'variable-name (dashed words)', style: { fontFamily: 'Consolas, monospace' } });
    const action = h('input', { type: 'text', value: item?.action ?? '', placeholder: 'event name for leaf items, e.g. delete-folder' });
    const target = h('select', { 'data-f': 'mi-target-screen' }, h('option', { value: '' }, '(none)'), screens.map(s => h('option', { value: s.id, selected: s.id === item?.targetScreenId }, s.name)));
    const targetElement = h('select', { 'data-f': 'mi-target-element' }, h('option', { value: '' }, '(none)'), [...elements].sort((a, b) => a.name.localeCompare(b.name)).map(el => h('option', { value: el.id, selected: el.id === item?.targetElementId }, `${el.name} (${el.key})`)));
    const visCheck = h('input', { type: 'checkbox', checked: item?.visible !== false });
    const dev = h('textarea', { rows: 4, placeholder: 'description-dev: what the dev team must implement for this item' }); dev.value = item?.descriptionDev ?? '';
    const iconBtn = h('button', { class: 'btn', type: 'button' }), iconLabel = h('span', { class: 'muted' });
    // picked items can be outside the (filtered) library: remember the record the picker returned or fetch it
    const known = { icon: new Map(), button: new Map() };
    const lookup = async (type, id) => { if (id == null) return null; const hit = findDesign(type, id) || known[type].get(id); if (hit) return hit; try { const rec = await api.getDesign(type, id); known[type].set(id, rec); return rec; } catch { return null; } };
    const paintIcon = () => { const ic = findDesign('icon', iconId) || known.icon.get(iconId); iconBtn.textContent = ic ? `Icon: ${ic.label}` : 'Choose icon…'; iconLabel.textContent = ic ? ic.key : 'no icon'; };
    iconBtn.addEventListener('click', async () => { const r = await pickIcon(iconId); if (r !== null) { iconId = r || null; await lookup('icon', iconId); paintIcon(); } });
    label.addEventListener('input', () => { if (!nameTouched) name.value = slugify(label.value, 'item'); });
    name.addEventListener('input', () => { nameTouched = true; });
    const btnBtn = h('button', { class: 'btn', type: 'button', 'data-f': 'mi-button' }), btnLabel = h('span', { class: 'muted' });
    const paintButton = () => { const b = findDesign('button', refButtonId) || known.button.get(refButtonId); btnBtn.textContent = b ? `Button: ${b.label || b.name}` : 'Choose button…'; btnLabel.textContent = b ? b.key : 'plain circle'; };
    btnBtn.addEventListener('click', async () => { const r = await pickButton(refButtonId, buttonId); if (r !== null) { refButtonId = r || null; await lookup('button', refButtonId); paintButton(); } });
    paintIcon(); paintButton();
    lookup('icon', iconId).then(paintIcon); lookup('button', refButtonId).then(paintButton);
    // parent picker (edit only): a tree of every menu item; the item itself and its sub items are not offered
    let parentId = item?.parentId ?? null;
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
    let m;
    const save = async () => {
      if (!label.value.trim() && !iconId && !refButtonId) return toast('Give the item a label, an icon or a button', 'error');
      const body = {
        label: label.value.trim(),
        name: name.value.trim() || slugify(label.value || 'item', 'item'),
        iconId,
        refButtonId,
        action: action.value.trim(),
        targetScreenId: target.value ? Number(target.value) : null,
        targetElementId: targetElement.value ? Number(targetElement.value) : null,
        visible: visCheck.checked,
        descriptionDev: dev.value
      };
      try {
        let saved = item ? await api.updateMenuItem(buttonId, item.id, body) : await api.addMenuItem(buttonId, { ...body, parentId });
        if (item && (parentId ?? null) !== (item.parentId ?? null)) { await api.moveMenuItem(buttonId, item.id, { parentId }); saved = { ...saved, parentId }; }
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
          h('label', { class: 'field grow' }, h('span', {}, 'Action (event name)'), action),
          h('label', { class: 'field grow' }, h('span', {}, 'Goes to screen'), target)
        ),
        h('label', { class: 'field' }, h('span', {}, 'Show element as popup/modal box'), targetElement),
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
    const saved = await menuItemDialog({ buttonId: bid, parentId });
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
    if (item && await menuItemDialog({ buttonId: bid, item })) await this.refresh(d, bid);
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
  },
  pathOf(rows, id) {
    const parts = [];
    for (let cur = rows.find(r => r.id === id); cur; cur = cur.parentId != null ? rows.find(r => r.id === cur.parentId) : null) parts.unshift(cur.name);
    return parts;
  }
};

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
    designer.stage.addEventListener('click', ev => {
      if (!this.active || ev.target.closest?.('.rm-item, [data-rm="center"], .rm-toolbar')) return;
      this.pinned = null; this.hideToolbar();
    });
    this.ctl = bindMenus(designer.stage, {
      keepOpen: true,
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
          if (targetScreen) {
            toast(`Menu "${a.item}" → ${targetScreen.name}`, 'ok', 1800);
            return this.d.opts.openDesign?.('screen', targetScreen.id);
          }
        }
        toast(`⚡ Menu Action: "${a.action || a.item}" (${a.menu || 'button'})`, 'ok', 1800);
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
    if (!this.active) return;
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
  hideToolbar() { this.toolbar.hidden = true; this.hover = null; }

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
    if (hit.hub) {
      this.toolbar.append(
        h('span', { class: 'muted', style: { padding: '0 6px', fontSize: '11px' } }, levelItem ? levelItem.label || levelItem.name : 'menu'),
        btn('＋', levelItem ? `Add a sub item to “${levelItem.label || levelItem.name}”` : 'Add a menu item', () => menuActions.add(this.d, levelItem?.id ?? null, hit.buttonId))
      );
      if (rows.length) {
        this.toolbar.append(
          btn('✎ Edit menu item', 'Edit menu item', () => menuActions.edit(this.d, (levelItem || rows[0]).id, hit.buttonId), 'btn small')
        );
        if (levelItem) this.toolbar.append(...this.focusButtons(rows, levelItem, btn));
      }
    } else if (hit.item) {
      const it = hit.item;
      this.toolbar.append(
        btn('✎ Edit menu item', `Edit menu item “${it.label || it.name}” (double-click the item to open its button)`, () => menuActions.edit(this.d, it.id, hit.buttonId), 'btn small primary'),
        btn('＋', `Add a sub item to “${it.label || it.name}”`, () => menuActions.add(this.d, it.id, hit.buttonId)),
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
      // the top-level ancestor sits in the centre; its sub level is the one shown
      const top = rows.find(r => r.name === path[0] && r.parentId == null);
      const el = top && host.querySelector(`.rm-hub-item[data-menu-id="${top.id}"]`);
      const c = el ? +el.getAttribute('data-hub-index') : (this.menuState.c || 0);
      st = { open: true, path: parentPath, c, prev: this.menuState.c ?? c };
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
