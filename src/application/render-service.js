import { NotFoundError } from '../domain/errors.js';
import { createContext, renderDocument, renderIconDocument, renderSprite } from '../domain/svg.js';
import { buildMenuTree, menuConfig, menuExtent } from '../domain/menu.js';

/**
 * Renders stored designs to SVG for a theme. Loads only what a design references
 * (element → button → icon → path, recursively, plus menu icons) so a render never reads the whole library.
 */
export class RenderService {
  /** @param {{designs:{path,icon,button,element,screen}, nodes, animations, themes, menus}} deps repositories */
  constructor({ designs, nodes, animations, themes, menus }) { Object.assign(this, { designs, nodes, animations, themes, menus }); }

  theme(key) {
    const t = (key && this.themes.getByKey(key)) || this.themes.list()[0];
    if (!t) throw new NotFoundError('theme', key);
    return t;
  }

  #full(type, id) {
    const d = typeof id === 'object' ? id : this.designs[type].get(id);
    if (!d) throw new NotFoundError(type, id);
    return { ...d, nodes: this.nodes.listByOwner(type, d.id) };
  }

  /** Builds a render context holding every design referenced (transitively) by `nodes`. */
  context(theme, nodes, { editor = false, emitIds = false } = {}) {
    const lib = { path: new Map(), icon: new Map(), button: new Map(), element: new Map() };
    const queue = [...nodes];
    const need = (type, id) => {
      if (lib[type].has(id)) return;
      const d = this.designs[type].get(id);
      if (!d) return;
      const ns = this.nodes.listByOwner(type, id);
      const entry = { key: d.key, width: d.width, height: d.height, nodes: ns };
      if (type === 'button') {
        const items = this.menus.list(id).map(m => ({
          ...m,
          targetKey: m.targetScreenId != null ? this.designs.screen.get(m.targetScreenId)?.key ?? '' : '',
          targetElementKey: m.targetElementId != null ? this.designs.element.get(m.targetElementId)?.key ?? '' : ''
        }));
        if (items.length) { entry.menu = { cfg: menuConfig(d.meta), items }; for (const m of items) if (m.iconId != null) need('icon', m.iconId); }
      }
      lib[type].set(id, entry);
      queue.push(...ns);
    };
    for (let guard = 0; queue.length && guard < 20000; guard++) {
      const n = queue.pop();
      if (n.kind === 'instance' && n.refType) need(n.refType, n.refId);
    }
    return createContext({ theme, lib, animations: this.animations.listAll(), editor, emitIds });
  }

  screenSvg(id, themeKey, { editor = false, emitIds = false, standalone = true, background = true } = {}) {
    const screen = this.#full('screen', id);
    const ctx = this.context(this.theme(themeKey), screen.nodes, { editor, emitIds });
    return renderDocument({ owner: screen, nodes: screen.nodes, ctx, background, standalone });
  }

  /** Element or button as a standalone svg (a button includes its menu, with the viewBox padded to hold it). */
  boxSvg(type, id, themeKey, { editor = false, emitIds = false, background = false, standalone = true } = {}) {
    const d = this.#full(type, id);
    const theme = this.theme(themeKey);
    if (type === 'button') {
      const items = this.menus.list(d.id);
      const nodes = [{ id: -1, kind: 'instance', tag: 'use', refType: 'button', refId: d.id, parentId: null, ord: 0, visible: true, attrs: { x: 0, y: 0, width: d.width, height: d.height } }];
      const ctx = this.context(theme, nodes, { editor, emitIds });
      const viewBox = items.length ? menuExtent(d, menuConfig(d.meta), buildMenuTree(items)) : null;
      return renderDocument({ owner: d, nodes, ctx, background, viewBox, standalone });
    }
    const ctx = this.context(theme, d.nodes, { editor, emitIds });
    return renderDocument({ owner: d, nodes: d.nodes, ctx, background, standalone });
  }

  /** Icon or path group as a standalone 24-grid svg. */
  glyphSvg(type, id, themeKey, { size = 192, frame = false } = {}) {
    const d = this.#full(type, id);
    const ctx = this.context(this.theme(themeKey), d.nodes);
    return renderIconDocument({ icon: d, nodes: d.nodes, ctx, size, frame });
  }

  svg(type, id, themeKey, opts = {}) {
    if (type === 'screen') return this.screenSvg(id, themeKey, opts);
    if (type === 'icon' || type === 'path') return this.glyphSvg(type, id, themeKey, opts);
    return this.boxSvg(type, id, themeKey, opts);
  }

  /** Symbols for the given icon ids (all icons when omitted). */
  sprite(themeKey, iconIds) {
    const ids = iconIds || this.designs.icon.list().map(i => i.id);
    const theme = this.theme(themeKey);
    const nodes = ids.map((id, i) => ({ id: -(i + 1), kind: 'instance', tag: 'use', refType: 'icon', refId: id, parentId: null, ord: i, visible: true, attrs: {} }));
    const ctx = this.context(theme, nodes);
    return renderSprite({ iconIds: ids, ctx });
  }
}
