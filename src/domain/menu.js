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
  const s = (cfg.itemScale || 0.75) * size, gap = (cfg.gap ?? 0.2) * size, out = [];
  const effLayout = cfg.layout || (
    cfg.kind === 'radial' ? 'fan'
      : cfg.kind === 'drawer' ? 'drawer'
      : cfg.kind === 'slider-vertical' ? 'slider-vertical'
      : cfg.kind === 'slider-horizontal' ? 'slider-horizontal'
      : cfg.kind === 'carousel' ? 'carousel'
      : 'list'
  );
  for (let i = 0; i < n; i++) {
    if (effLayout === 'fan' || effLayout === 'radial') {
      const a = (cfg.startAngle + (n > 1 ? cfg.sweep * i / (n - 1) : cfg.sweep / 2)) * Math.PI / 180, R = cfg.radius * size;
      out.push({ x: R * Math.cos(a), y: R * Math.sin(a), s });
    } else if (effLayout === 'slider-horizontal') {
      const dirSign = cfg.direction === 'left' ? -1 : 1;
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      out.push({ x: dirSign * d, y: 0, s });
    } else if (effLayout === 'slider-vertical') {
      const dirSign = cfg.direction === 'up' ? -1 : 1;
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      out.push({ x: 0, y: dirSign * d, s });
    } else if (effLayout === 'carousel') {
      const isVert = cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down';
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      out.push({ x: isVert ? 0 : d, y: isVert ? d : 0, s });
    } else if (effLayout === 'drawer') {
      const side = cfg.side || cfg.direction || 'right';
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      const dir = { up: [0, -1], top: [0, -1], down: [0, 1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side] || [1, 0];
      out.push({ x: dir[0] * d, y: dir[1] * d, s });
    } else {
      const d = size / 2 + gap + s / 2 + i * (s + gap);
      const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[cfg.direction] || [0, -1];
      out.push({ x: dir[0] * d, y: dir[1] * d, s });
    }
  }
  return out;
}

const round = v => Math.round(v * 100) / 100;

/** Hub menu geometry (px): small = side button diameter, big = centre button (twice as big), gap between buttons, vertical flag. */
export function hubGeometry(cfg, size) {
  const small = size * (Number(cfg.hubScale) > 0 ? Number(cfg.hubScale) : 0.8);
  return { small, big: small * 2, gap: (cfg.gap ?? 0.2) * size, vertical: cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down' };
}

/**
 * Markup of a button's menu, drawn in the button's own coordinate box (w x h) so it scales with the button.
 * Every level is pre-rendered (hidden); the runtime only toggles classes.
 * @param {object} p {button:{key,width,height}, cfg, tree, ctx, iconKey(id)->key|null}
 */
export function renderMenu({ button, cfg, tree, ctx, iconKey, renderButton = null }) {
  const w = button.width, h = button.height, cx = w / 2, cy = h / 2, size = Math.min(w, h);
  const surface = roleAttrs(ctx.theme, 'button');
  const itemAttrs = a => attrString({ ...surface, ...a });
  const isHub = cfg.kind === 'hub';
  const hub = hubGeometry(cfg, size);
  const lsize = isHub ? hub.big : size;                    // fan sizes are relative to the centre button in a hub
  const iconSize = lsize * cfg.itemScale * 0.62;
  const isCarousel = cfg.layout === 'carousel' || cfg.kind === 'carousel';
  if (isCarousel) ctx.hasCarousel = true;
  const carDim = cfg.dimension === '2d' ? '2d' : '3d';
  const carDir = (cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down') ? 'vertical' : 'horizontal';
  const iconUse = (id, x, y, sz) => {
    const key = id != null ? iconKey(id) : null;
    if (!key) return '';
    ctx.usedIcons.add(id);
    const stroke = resolveTokens('{{sw}}', ctx.theme.tokens);
    return `<use href="#i-${esc(key)}" x="${round(x - sz / 2)}" y="${round(y - sz / 2)}" width="${round(sz)}" height="${round(sz)}" fill="none" stroke="url(#lgS)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>`;
  };
  // body of one item, drawn around its own centre (0,0): a referenced library button (its own icon unless the item has one), else circle + icon
  const itemBody = (it, r, iconSz) => {
    const btn = it.refButtonId && renderButton ? renderButton(it.refButtonId, r * 2, Boolean(it.iconId)) : '';
    if (btn) return `${btn}<circle r="${round(r)}" fill="transparent"/>${iconUse(it.iconId, 0, 0, iconSz)}`;
    return `<circle r="${round(r)}"${itemAttrs({})}/><circle r="${round(r)}" fill="transparent"/>${iconUse(it.iconId, 0, 0, iconSz)}`;
  };
  const levels = [], centers = [];
  const walk = (items, parentPath, parentNode) => {
    const pos = layoutItems(cfg, items.length, lsize);
    const isHubRoot = isHub && parentPath === '';
    const els = items.map((it, i) => {
      if (isHubRoot) {
        // one pre-rendered button per ring item; the runtime places it (left / centre / right / hidden) with --x --y --k --o
        const r = hub.big / 2;
        return `<g class="rm-item rm-hub-item" data-item="${esc(it.path)}" data-hub-index="${i}" data-children="${it.children.length ? 1 : 0}" data-action="${esc(it.action || '')}" data-target="${esc(it.targetKey || '')}"${ctx.editor ? ` data-menu-id="${it.id}"` : ''} style="--x:${round(cx)}px;--y:${round(cy)}px;--k:0;--o:0">`
          + `<title>${esc(it.label || it.name)}</title>${itemBody(it, r, hub.big * 0.62)}</g>`;
      }
      const p = pos[i], r = p.s / 2;
      const popupAttr = (it.targetElementKey || it.targetElementId)
        ? ` data-popup-element="${esc(it.targetElementKey || it.targetElementId)}" data-popup-element-id="${esc(it.targetElementId || '')}"`
        : '';
      return `<g class="rm-item" data-item="${esc(it.path)}" data-children="${it.children.length ? 1 : 0}" data-action="${esc(it.action || '')}" data-target="${esc(it.targetKey || '')}"${popupAttr}${ctx.editor ? ` data-menu-id="${it.id}"` : ''} style="--x:${round(cx + p.x)}px;--y:${round(cy + p.y)}px;--i:${i}">`
        + `<title>${esc(it.label || it.name)}</title>${itemBody(it, r, iconSize)}</g>`;
    });
    const innerItems = isCarousel
      ? `<g class="ud-carousel-track ud-carousel-${carDim}-${carDir}" style="--roll-dur:2400ms">${els.join('')}</g>`
      : els.join('');
    levels.push(`<g class="rm-level" data-level="${esc(parentPath)}" data-layout="${esc(isHubRoot ? 'hub' : (cfg.layout || 'list'))}">${innerItems}</g>`);
    for (const it of items) {
      const rot = cfg.kind === 'rotating' || cfg.kind === 'radial';
      if (rot && it.children.length || rot && ctx.editor || (isHub && parentNode && it.children.length)) {
        centers.push(`<g class="rm-center" data-for="${esc(it.path)}"><circle cx="${round(cx)}" cy="${round(cy)}" r="${round(lsize / 2)}"${itemAttrs({})}/>${iconUse(it.iconId, cx, cy, lsize * 0.625)}</g>`);
      }
      if (it.children.length) walk(it.children, it.path, it);
    }
  };
  walk(tree, '', null);
  const showElAttr = cfg.targetElementId ? ` data-show-element-id="${esc(cfg.targetElementId)}"` : '';
  const hit = `<circle class="rm-hit" data-rm="center" cx="${round(cx)}" cy="${round(cy)}" r="${round(lsize / 2)}" fill="transparent"${showElAttr}/>`;
  const hubAttrs = isHub ? ` data-cx="${round(cx)}" data-cy="${round(cy)}" data-hub-small="${round(hub.small)}" data-hub-gap="${round(hub.gap)}" data-hub-vertical="${hub.vertical ? 1 : 0}"` : '';
  return `<g class="ud-menu" data-kind="${esc(cfg.kind)}" data-layout="${esc(cfg.layout || 'list')}" data-rotate="${Number(cfg.rotateOnOpen) || 0}"${hubAttrs}${showElAttr} style="--cx:${round(cx)}px;--cy:${round(cy)}px">${centers.join('')}${levels.join('')}${hit}</g>`;
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
.ud-btn .rm-item.rm-hub-item{transition:transform .35s cubic-bezier(.3,.8,.3,1),opacity .25s ease}
.ud-btn .rm-level.is-active .rm-item.rm-hub-item{transform:translate(var(--x),var(--y)) scale(var(--k,1));opacity:var(--o,1);transition-delay:0ms}
.ud-btn .rm-hub-item[data-hub-pos="hidden"]{pointer-events:none}
.ud-btn .rm-hub-icon{transform-box:fill-box;transform-origin:center;transition:transform .3s ease}
.ud-btn[data-open="1"] .rm-hub-icon{transform:rotate(var(--rot,0deg))}
.ud-btn[data-center="1"] .rm-hub-icon{opacity:0}
.ud-btn .rm-hub-icon{transition:transform .3s ease,opacity .2s ease}
`;

/** Bounding box (in the button's own coordinates) of the button plus every level of its menu, for padded exports. */
export function menuExtent(button, cfg, tree) {
  const size = Math.min(button.width, button.height), cx = button.width / 2, cy = button.height / 2;
  let x0 = 0, y0 = 0, x1 = button.width, y1 = button.height;
  const hubG = cfg.kind === 'hub' ? hubGeometry(cfg, size) : null;
  const lsize = hubG ? hubG.big : size;
  if (hubG) {
    const along = hubG.big / 2 + hubG.gap + hubG.small, across = hubG.big / 2;
    const hx = hubG.vertical ? across : along, hy = hubG.vertical ? along : across;
    x0 = Math.min(x0, cx - hx); x1 = Math.max(x1, cx + hx); y0 = Math.min(y0, cy - hy); y1 = Math.max(y1, cy + hy);
  }
  const walk = (items, root = true) => {
    if (hubG && root) { items.forEach(i => i.children.length && walk(i.children, false)); return; }
    layoutItems(cfg, items.length, lsize).forEach(p => { const r = p.s / 2; x0 = Math.min(x0, cx + p.x - r); x1 = Math.max(x1, cx + p.x + r); y0 = Math.min(y0, cy + p.y - r); y1 = Math.max(y1, cy + p.y + r); });
    items.forEach(i => i.children.length && walk(i.children, false));
  };
  if (tree.length) walk(tree);
  const pad = 4;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
