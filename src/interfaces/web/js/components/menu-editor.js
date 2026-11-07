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

const PICK_LIMIT = 300;
import { bindMenus } from '/domain/menu-runtime.js';
import { slugify } from '/domain/naming.js';
import { buildMenuTree } from '/domain/menu.js';

/* ---------- dialogs ---------- */
/** Icon picker: a searchable grid of the icon library. Resolves with an icon id or null (cancel). */
export function pickIcon(currentId = null) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const grid = h('div', { class: 'grid-icons', style: { maxHeight: '360px', overflow: 'auto' } });
    const q = h('input', { type: 'search', placeholder: 'Search icons…' });
    let m;
    const fill = () => {
      clear(grid);
      const s = q.value.toLowerCase();
      // thousands of pack icons: draw the first PICK_LIMIT matches and fetch just their sprite symbols
      const all = state.library.icons.filter(i => !s || `${i.key} ${i.label} ${i.category} ${(i.tags || []).join(' ')}`.toLowerCase().includes(s));
      const shown = all.slice(0, PICK_LIMIT);
      ensureIconSymbols(shown.map(i => i.id));
      if (all.length > shown.length) grid.append(h('div', { class: 'muted', style: { gridColumn: '1/-1', fontSize: '11px' } }, `Showing ${shown.length} of ${all.length} icons; type to narrow the search.`));
      for (const ic of shown) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#i-${ic.key}`);
        for (const [k, v] of Object.entries({ fill: 'none', stroke: 'url(#lgS)', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) use.setAttribute(k, v);
        svg.appendChild(use);
        grid.append(h('div', { class: `cell${ic.id === currentId ? ' sel' : ''}`, title: ic.label, onclick: () => { fin(ic.id); m.close(); } }, svg, h('div', { class: 'lbl' }, ic.key)));
      }
    };
    q.addEventListener('input', fill);
    m = modal({ title: 'Pick an icon', wide: true, onClose: () => fin(null), content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, q, grid),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(0); close(); } }, 'No icon'), h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
    fill();
    setTimeout(() => q.focus(), 30);
  });
}

/** Add / edit dialog of one menu item. Resolves with the saved item or null. */
/** Pick a library button for a menu item (search, thumbnails by name). Resolves to an id, 0 = no button, null = cancelled. */
export function pickButton(currentId = null, excludeId = null) {
  return new Promise(resolve => {
    let done = false, m;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const q = h('input', { type: 'search', placeholder: 'Search buttons…' });
    const list = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: '6px', maxHeight: '360px', overflow: 'auto' } });
    const fill = () => {
      clear(list);
      const s = q.value.toLowerCase();
      const all = (state.library.buttons || []).filter(b => b.id !== excludeId && (!s || `${b.key} ${b.label} ${b.name} ${b.category}`.toLowerCase().includes(s)));
      for (const b of all.slice(0, 120)) list.append(h('button', { class: `btn${b.id === currentId ? ' primary' : ''}`, type: 'button', title: b.key, style: { textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, onclick: () => { fin(b.id); m.close(); } }, b.label || b.name));
      if (all.length > 120) list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1', fontSize: '11px' } }, `Showing 120 of ${all.length}: type to narrow the search.`));
    };
    q.addEventListener('input', fill);
    m = modal({ title: 'Pick a button', wide: true, onClose: () => fin(null), content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, q, list),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(0); close(); } }, 'No button (plain circle)'), h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
    fill();
    setTimeout(() => q.focus(), 30);
  });
}

export async function menuItemDialog({ buttonId, item = null, parentId = null }) {
  const [screens, elements] = await Promise.all([
    api.list('screen'),
    state.library.elements?.length ? Promise.resolve(state.library.elements) : api.list('element')
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
    const paintIcon = () => { const ic = findDesign('icon', iconId); iconBtn.textContent = ic ? `Icon: ${ic.label}` : 'Choose icon…'; iconLabel.textContent = ic ? ic.key : 'no icon'; };
    iconBtn.addEventListener('click', async () => { const r = await pickIcon(iconId); if (r !== null) { iconId = r || null; paintIcon(); } });
    label.addEventListener('input', () => { if (!nameTouched) name.value = slugify(label.value, 'item'); });
    name.addEventListener('input', () => { nameTouched = true; });
    const btnBtn = h('button', { class: 'btn', type: 'button', 'data-f': 'mi-button' }), btnLabel = h('span', { class: 'muted' });
    const paintButton = () => { const b = findDesign('button', refButtonId); btnBtn.textContent = b ? `Button: ${b.label || b.name}` : 'Choose button…'; btnLabel.textContent = b ? b.key : 'plain circle'; };
    btnBtn.addEventListener('click', async () => { const r = await pickButton(refButtonId, buttonId); if (r !== null) { refButtonId = r || null; paintButton(); } });
    paintIcon(); paintButton();
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
        const saved = item ? await api.updateMenuItem(buttonId, item.id, body) : await api.addMenuItem(buttonId, { ...body, parentId });
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
    designer.viewport.appendChild(this.toolbar);
    // same behaviour as the exported page; leaf clicks keep the menu open while editing, or trigger actions/routes in Test mode
    this.ctl = bindMenus(designer.stage, {
      keepOpen: true,
      onState: (_, st) => { this.menuState = st; },
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

  /** Called after every stage render: the DOM was replaced, restore the open/level state. */
  afterRender() {
    if (!this.active) return;
    const btn = this.d.stage.querySelector('.ud-btn');
    if (btn) this.ctl.set(btn, this.menuState);
    this.hideToolbar();
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

  scheduleHide() { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => this.hideToolbar(), 350); }
  hideToolbar() { this.toolbar.hidden = true; this.hover = null; }

  show(hit) {
    const key = hit.hub ? `hub-${hit.buttonId}` : `${hit.buttonId}-${hit.item?.id}`;
    const vr = this.d.viewport.getBoundingClientRect(), r = hit.el.getBoundingClientRect();
    this.toolbar.style.left = `${r.left - vr.left + r.width / 2}px`;
    this.toolbar.style.top = `${Math.max(46, r.top - vr.top - 40)}px`;
    this.toolbar.hidden = false;
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
      }
    } else if (hit.item) {
      const it = hit.item;
      this.toolbar.append(
        btn('✎ Edit menu item', `Edit menu item “${it.label || it.name}”`, () => menuActions.edit(this.d, it.id, hit.buttonId), 'btn small primary'),
        btn('＋', `Add a sub item to “${it.label || it.name}”`, () => menuActions.add(this.d, it.id, hit.buttonId)),
        btn(it.visible === false ? '—' : '👁', it.visible === false ? 'Show menu item' : 'Hide menu item', () => menuActions.toggleVisible(this.d, it.id, hit.buttonId)),
        btn('←', 'Move earlier', () => menuActions.move(this.d, it.id, -1, hit.buttonId)),
        btn('→', 'Move later', () => menuActions.move(this.d, it.id, 1, hit.buttonId)),
        btn('🗑', 'Delete this item', () => menuActions.remove(this.d, it.id, hit.buttonId))
      );
    }
  }
}

function buildFlatPaths(rows) {
  const out = [''];
  const walk = list => list.forEach(n => { out.push(n.path); walk(n.children); });
  walk(buildMenuTree(rows));
  return out;
}
