/**
 * Button menus (pure, isomorphic): nested menu items of a button, laid out as a fan (rotating menu) or a list.
 *
 * Behaviour (identical in the designer preview and in exported pages, see menu-runtime.js):
 *   - click the button            closed -> opens the root items
 *   - click the button again      (at the root) closes the menu
 *   - click an item with sub items  the centre shows that item's icon and ITS sub items are displayed (rotating kind)
 *   - click the centre again      goes one level back (the previous icon / items return)
 *   - click a leaf item           fires its action and closes the menu
 */
import { DEFAULT_MENU } from './entities.js';
import { esc, attrString } from './svg-util.js';
import { roleAttrs, resolveTokens } from './theme.js';

export function menuConfig(buttonMeta) { return { ...DEFAULT_MENU, ...(buttonMeta?.menu || {}) }; }

/** Flat rows (id, parentId, ord ...) -> nested tree with `path` (dashed names joined by "/"). */
export function buildMenuTree(rows, { includeHidden = false } = {}) {
  const filtered = includeHidden ? (rows || []) : (rows || []).filter(r => r.visible !== false);
  const by = new Map(filtered.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of [...by.values()].sort((a, b) => a.ord - b.ord || a.id - b.id)) {
    const parent = r.parentId != null ? by.get(r.parentId) : null;
    (parent ? parent.children : roots).push(r);
  }
  const assign = (list, prefix) => list.forEach(n => { n.path = prefix ? `${prefix}/${n.name || `item-${n.id}`}` : (n.name || `item-${n.id}`); assign(n.children, n.path); });
  assign(roots, '');
  return roots;
}

/** Item centres relative to the button centre (px), for n items. */
export function layoutItems(cfg, n, size) {
  const s = cfg.itemScale * size, gap = cfg.gap * size, out = [];
  for (let i = 0; i < n; i++) {
    if (cfg.layout === 'fan') {
      const a = (cfg.startAngle + (n > 1 ? cfg.sweep * i / (n - 1) : cfg.sweep / 2)) * Math.PI / 180, R = cfg.radius * size;
      out.push({ x: R * Math.cos(a), y: R * Math.sin(a), s });
    } else {
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[cfg.direction] || [0, -1];
      out.push({ x: dir[0] * d, y: dir[1] * d, s });
    }
  }
  return out;
}

const round = v => Math.round(v * 100) / 100;

/**
 * Markup of a button's menu, drawn in the button's own coordinate box (w x h) so it scales with the button.
 * Every level is pre-rendered (hidden); the runtime only toggles classes.
 * @param {object} p {button:{key,width,height}, cfg, tree, ctx, iconKey(id)->key|null}
 */
export function renderMenu({ button, cfg, tree, ctx, iconKey }) {
  const w = button.width, h = button.height, cx = w / 2, cy = h / 2, size = Math.min(w, h);
  const surface = roleAttrs(ctx.theme, 'button');
  const itemAttrs = a => attrString({ ...surface, ...a });
  const iconSize = size * cfg.itemScale * 0.62;
  const iconUse = (id, x, y, sz) => {
    const key = id != null ? iconKey(id) : null;
    if (!key) return '';
    ctx.usedIcons.add(id);
    const stroke = resolveTokens('{{sw}}', ctx.theme.tokens);
    return `<use href="#i-${esc(key)}" x="${round(x - sz / 2)}" y="${round(y - sz / 2)}" width="${round(sz)}" height="${round(sz)}" fill="none" stroke="url(#lgS)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>`;
  };
  const levels = [], centers = [];
  const walk = (items, parentPath, parentNode) => {
    const pos = layoutItems(cfg, items.length, size);
    const els = items.map((it, i) => {
      const p = pos[i], r = p.s / 2;
      const popupAttr = (it.targetElementKey || it.targetElementId)
        ? ` data-popup-element="${esc(it.targetElementKey || it.targetElementId)}" data-popup-element-id="${esc(it.targetElementId || '')}"`
        : '';
      return `<g class="rm-item" data-item="${esc(it.path)}" data-children="${it.children.length ? 1 : 0}" data-action="${esc(it.action || '')}" data-target="${esc(it.targetKey || '')}"${popupAttr}${ctx.editor ? ` data-menu-id="${it.id}"` : ''} style="--x:${round(cx + p.x)}px;--y:${round(cy + p.y)}px;--i:${i}">`
        + `<title>${esc(it.label || it.name)}</title><circle r="${round(r)}"${itemAttrs({})}/>`
        + `<circle r="${round(r)}" fill="transparent"/>${iconUse(it.iconId, 0, 0, iconSize)}</g>`;
    });
    levels.push(`<g class="rm-level" data-level="${esc(parentPath)}">${els.join('')}</g>`);
    for (const it of items) {
      if (cfg.kind === 'rotating' && it.children.length || cfg.kind === 'rotating' && ctx.editor) {
        centers.push(`<g class="rm-center" data-for="${esc(it.path)}"><circle cx="${round(cx)}" cy="${round(cy)}" r="${round(size / 2)}"${itemAttrs({})}/>${iconUse(it.iconId, cx, cy, size * 0.625)}</g>`);
      }
      if (it.children.length) walk(it.children, it.path, it);
    }
  };
  walk(tree, '', null);
  const hub = `<circle class="rm-hit" data-rm="center" cx="${round(cx)}" cy="${round(cy)}" r="${round(size / 2)}" fill="transparent"/>`;
  return `<g class="ud-menu" data-kind="${esc(cfg.kind)}" data-rotate="${Number(cfg.rotateOnOpen) || 0}" style="--cx:${round(cx)}px;--cy:${round(cy)}px">${centers.join('')}${levels.join('')}${hub}</g>`;
}

/** Stylesheet shared by the designer canvas and exported pages (transitions of the menu). */
export const MENU_CSS = `
.ud-btn .rm-level{visibility:hidden;pointer-events:none}
.ud-btn .rm-item{transform-box:view-box;transform-origin:0 0;transform:translate(var(--cx,0px),var(--cy,0px)) scale(.2);opacity:0;cursor:pointer;transition:transform .32s cubic-bezier(.2,.9,.3,1.2),opacity .2s ease;transition-delay:0ms}
.ud-btn .rm-level.is-active{visibility:visible;pointer-events:auto}
.ud-btn .rm-level.is-active .rm-item{transform:translate(var(--x),var(--y)) scale(1);opacity:1;transition-delay:calc(var(--i)*35ms)}
.ud-btn .rm-item:hover circle:first-of-type{stroke-opacity:1}
.ud-btn .rm-center{visibility:hidden;pointer-events:none;opacity:0;transition:opacity .2s}
.ud-btn .rm-center.is-active{visibility:visible;opacity:1}
.ud-btn .rm-hit{cursor:pointer}
.ud-btn .rm-hub-icon{transform-box:fill-box;transform-origin:center;transition:transform .3s ease}
.ud-btn[data-open="1"] .rm-hub-icon{transform:rotate(var(--rot,0deg))}
.ud-btn[data-center="1"] .rm-hub-icon{opacity:0}
.ud-btn .rm-hub-icon{transition:transform .3s ease,opacity .2s ease}
`;

/** Bounding box (in the button's own coordinates) of the button plus every level of its menu, for padded exports. */
export function menuExtent(button, cfg, tree) {
  const size = Math.min(button.width, button.height), cx = button.width / 2, cy = button.height / 2;
  let x0 = 0, y0 = 0, x1 = button.width, y1 = button.height;
  const walk = items => {
    layoutItems(cfg, items.length, size).forEach(p => { const r = p.s / 2; x0 = Math.min(x0, cx + p.x - r); x1 = Math.max(x1, cx + p.x + r); y0 = Math.min(y0, cy + p.y - r); y1 = Math.max(y1, cy + p.y + r); });
    items.forEach(i => i.children.length && walk(i.children));
  };
  if (tree.length) walk(tree);
  const pad = 4;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
