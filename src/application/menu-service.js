import { NotFoundError, ValidationError } from '../domain/errors.js';
import { normalizeMenuItem, MENU_LAYOUTS, MENU_KINDS, MENU_FAN_CORNERS } from '../domain/entities.js';
import { uniqueKey, slugify } from '../domain/naming.js';
import { buildMenuTree, menuConfig } from '../domain/menu.js';

const MAX_DEPTH = 6;

/**
 * Nested menu items of a button (popup or rotating menu): add / edit / delete / move, and the menu settings.
 * Every item has a variable name (unique among its siblings), a label, an icon from the icon library and a description-dev.
 */
export class MenuService {
  constructor({ buttons, icons, screens, elements, menus }) { Object.assign(this, { buttons, icons, screens, elements, menus }); }

  #button(idOrKey) {
    const b = /^\d+$/.test(String(idOrKey)) ? this.buttons.get(Number(idOrKey)) : this.buttons.getByKey(String(idOrKey));
    if (!b) throw new NotFoundError('button', idOrKey);
    return b;
  }

  get(buttonIdOrKey) {
    const b = this.#button(buttonIdOrKey);
    const items = this.menus.list(b.id);
    return { buttonId: b.id, config: menuConfig(b.meta), items, tree: buildMenuTree(items) };
  }

  #depth(items, id) { let d = 0, cur = items.find(i => i.id === id); while (cur && cur.parentId != null) { d++; cur = items.find(i => i.id === cur.parentId); } return d; }

  #check(data) {
    if (data.iconId != null && !this.icons.get(data.iconId)) throw new ValidationError(`icon ${data.iconId} does not exist`);
    if (data.refButtonId != null && this.buttons && !this.buttons.get(data.refButtonId)) throw new ValidationError(`button ${data.refButtonId} does not exist`);
    if (data.targetScreenId != null && !this.screens.get(data.targetScreenId)) throw new ValidationError(`screen ${data.targetScreenId} does not exist`);
    if (data.targetElementId != null && this.elements && !this.elements.get(data.targetElementId)) throw new ValidationError(`element ${data.targetElementId} does not exist`);
  }

  addItem(buttonIdOrKey, input) {
    const b = this.#button(buttonIdOrKey);
    const all = this.menus.list(b.id);
    const data = normalizeMenuItem({ ...input, name: input.name || slugify(input.label || 'item') });
    this.#check(data);
    if (data.parentId != null) {
      const parent = all.find(i => i.id === data.parentId);
      if (!parent) throw new ValidationError('the parent menu item must belong to the same button');
      if (this.#depth(all, parent.id) + 1 >= MAX_DEPTH) throw new ValidationError(`menus can be nested ${MAX_DEPTH} levels deep`);
    }
    const siblings = new Set(all.filter(i => (i.parentId ?? null) === (data.parentId ?? null)).map(i => i.name));
    if (input.name && siblings.has(data.name)) throw new ValidationError(`a sibling already uses the name "${data.name}"`);
    data.name = uniqueKey(data.name, k => siblings.has(k));
    return this.menus.create(b.id, data);
  }

  updateItem(itemId, patch, { buttonId = null } = {}) {
    const it = this.menus.get(Number(itemId));
    if (!it || (buttonId != null && it.buttonId !== this.#button(buttonId).id)) throw new NotFoundError('menu item', itemId);
    const data = normalizeMenuItem({ ...patch }, { partial: true });
    this.#check(data);
    const all = this.menus.list(it.buttonId);
    if (data.parentId !== undefined && data.parentId !== it.parentId) {
      for (let p = data.parentId; p != null; p = all.find(i => i.id === p)?.parentId) if (p === it.id) throw new ValidationError('an item cannot be moved into its own sub items');
    }
    const parent = data.parentId !== undefined ? data.parentId : it.parentId;
    if (data.name !== undefined && all.some(i => i.id !== it.id && (i.parentId ?? null) === (parent ?? null) && i.name === data.name)) throw new ValidationError(`a sibling already uses the name "${data.name}"`);
    return this.menus.update(it.id, data);
  }

  /**
   * Moves an item under another parent (null = top level) at `index` among that parent's items, renumbering the order of both levels.
   * Rejects a move into its own sub items, a parent of another button, a name clash with the new siblings and nesting deeper than MAX_DEPTH.
   */
  moveItem(buttonIdOrKey, itemId, { parentId = null, index = null } = {}) {
    const b = this.#button(buttonIdOrKey);
    const it = this.menus.get(Number(itemId));
    if (!it || it.buttonId !== b.id) throw new NotFoundError('menu item', itemId);
    const all = this.menus.list(b.id);
    const pid = parentId == null || parentId === '' ? null : Number(parentId);
    if (pid != null) {
      if (!all.some(i => i.id === pid)) throw new ValidationError('the parent menu item must belong to the same button');
      for (let p = pid; p != null; p = all.find(i => i.id === p)?.parentId) if (p === it.id) throw new ValidationError('an item cannot be moved into its own sub items');
    }
    const height = id => 1 + Math.max(0, ...all.filter(i => i.parentId === id).map(i => height(i.id)));
    if (pid !== (it.parentId ?? null) && this.#depth(all, pid) + (pid == null ? 0 : 1) + height(it.id) > MAX_DEPTH) throw new ValidationError(`menus can be nested ${MAX_DEPTH} levels deep`);
    const order = (a, c) => a.ord - c.ord || a.id - c.id;
    const target = all.filter(i => (i.parentId ?? null) === pid && i.id !== it.id).sort(order);
    if (target.some(i => i.name === it.name)) throw new ValidationError(`a sibling already uses the name "${it.name}"`);
    const at = index == null ? target.length : Math.max(0, Math.min(target.length, Number(index) || 0));
    target.splice(at, 0, it);
    const oldParent = it.parentId ?? null;
    if (this.menus.update(it.id, { parentId: pid }) === undefined) throw new NotFoundError('menu item', itemId);
    target.forEach((i, n) => { if (i.id === it.id || i.ord !== n) this.menus.update(i.id, { ord: n }); });
    if (oldParent !== pid) all.filter(i => (i.parentId ?? null) === oldParent && i.id !== it.id).sort(order).forEach((i, n) => { if (i.ord !== n) this.menus.update(i.id, { ord: n }); });
    // a hub's default centre must stay a top-level item
    if (pid != null && Number(b.meta?.menu?.hubCenterItemId) === it.id) this.buttons.update(b.id, { meta: { ...b.meta, menu: { ...b.meta.menu, hubCenterItemId: null } } });
    return this.get(b.id);
  }

  removeItem(itemId, { buttonId = null } = {}) {
    const it = this.menus.get(Number(itemId));
    if (!it || (buttonId != null && it.buttonId !== this.#button(buttonId).id)) throw new NotFoundError('menu item', itemId);
    this.menus.delete(it.id);
    return { deleted: true, id: it.id };
  }

  /** Menu settings of a button: kind (popup | rotating), layout (fan | list), radius, angles, scales ... */
  setConfig(buttonIdOrKey, cfg) {
    const b = this.#button(buttonIdOrKey);
    if (cfg.kind !== undefined && !MENU_KINDS.includes(cfg.kind)) throw new ValidationError(`kind must be one of ${MENU_KINDS.join(', ')}`);
    if (cfg.layout !== undefined && !MENU_LAYOUTS.includes(cfg.layout)) throw new ValidationError(`layout must be one of ${MENU_LAYOUTS.join(', ')}`);
    if (cfg.fanCorner !== undefined && !MENU_FAN_CORNERS.includes(cfg.fanCorner || '')) throw new ValidationError(`fanCorner must be one of ${MENU_FAN_CORNERS.filter(Boolean).join(', ')} (or empty)`);
    for (const k of ['hubCenterSize', 'hubSideSize', 'hubEdgeSize']) {
      if (cfg[k] === undefined) continue;
      const v = Number(cfg[k]);
      if (!(v >= 0.1 && v <= 2)) throw new ValidationError(`${k} must be a number from 0.1 to 2 (a fraction of the centre item size)`);
      cfg = { ...cfg, [k]: v };
    }
    if (cfg.hubIconSize !== undefined) {
      const v = Number(cfg.hubIconSize) || 0;
      if (!(v >= 0 && v <= 1)) throw new ValidationError('hubIconSize must be a number from 0 (automatic) to 1 (the icon fills the button)');
      cfg = { ...cfg, hubIconSize: v };
    }
    if (cfg.hubCount !== undefined) {
      const v = Number(cfg.hubCount);
      if (!Number.isInteger(v) || v < 1 || v > 6) throw new ValidationError('hubCount must be a whole number from 1 to 6 (buttons the hub bar shows at once)');
      cfg = { ...cfg, hubCount: v };
    }
    if (cfg.hubSubInside !== undefined) cfg = { ...cfg, hubSubInside: cfg.hubSubInside !== false && cfg.hubSubInside !== 0 && cfg.hubSubInside !== '0' };
    if (cfg.hubCenterItemId != null) {
      const it = this.menus.list(b.id).find(m => m.id === Number(cfg.hubCenterItemId));
      if (!it || it.parentId != null) throw new ValidationError('hubCenterItemId must be a top-level item of this menu');
      cfg = { ...cfg, hubCenterItemId: it.id };
    }
    if (cfg.itemButtonId != null && !this.buttons.get(Number(cfg.itemButtonId))) throw new ValidationError(`button ${cfg.itemButtonId} does not exist`);
    const merged = { ...(b.meta.menu || {}), ...cfg };
    this.buttons.update(b.id, { meta: { ...b.meta, menu: merged } });
    return menuConfig({ menu: merged });
  }
}
