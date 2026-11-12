/**
 * SVG renderer (pure, isomorphic: runs in node for export and in the browser for the designer canvas).
 * Turns nodes + a theme + animations into SVG markup. Instances of lower-level library designs
 * (path groups, icons, buttons, elements) are resolved through the render context.
 */
import { resolveTokens, roleAttrs, buildThemeDefs } from './theme.js';
import { animationsToCss, nodeClass } from './animation.js';
import { nodeBBox, isContainerNode, isCarouselContainerNode, getContainerConfig, containerInnerBox } from './geometry.js';
import { esc, attrString, SAFE_TAGS } from './svg-util.js';
import { renderMenu, buildMenuTree, menuConfig, MENU_CSS } from './menu.js';
import { isRepeaterNode, repeaterConfig, repeaterPlan, repeaterMarkup, repeaterTemplate, repeaterTemplates, assignRepeaterItems } from './repeater.js';

export const CAROUSEL_CSS = [
  '@keyframes ud-roll-2d-horizontal{0%,20%{transform:translateX(0)}33%,53%{transform:translateX(-18px)}66%,86%{transform:translateX(18px)}100%{transform:translateX(0)}}',
  '@keyframes ud-roll-2d-vertical{0%,20%{transform:translateY(0)}33%,53%{transform:translateY(-14px)}66%,86%{transform:translateY(14px)}100%{transform:translateY(0)}}',
  '@keyframes ud-roll-3d-horizontal{0%{transform:perspective(600px) rotateY(0deg) scale(1)}25%{transform:perspective(600px) rotateY(18deg) translateX(-10px) scale(0.95)}50%{transform:perspective(600px) rotateY(0deg) scale(1.02)}75%{transform:perspective(600px) rotateY(-18deg) translateX(10px) scale(0.95)}100%{transform:perspective(600px) rotateY(0deg) scale(1)}}',
  '@keyframes ud-roll-3d-vertical{0%{transform:perspective(600px) rotateX(0deg) scale(1)}25%{transform:perspective(600px) rotateX(18deg) translateY(-10px) scale(0.95)}50%{transform:perspective(600px) rotateX(0deg) scale(1.02)}75%{transform:perspective(600px) rotateX(-18deg) translateY(10px) scale(0.95)}100%{transform:perspective(600px) rotateX(0deg) scale(1)}}',
  '.ud-carousel-track{transform-box:fill-box;transform-origin:center center;will-change:transform}',
  '.ud-carousel-2d-horizontal{animation:ud-roll-2d-horizontal var(--roll-dur,2600ms) ease-in-out infinite}',
  '.ud-carousel-2d-vertical{animation:ud-roll-2d-vertical var(--roll-dur,2600ms) ease-in-out infinite}',
  '.ud-carousel-3d-horizontal{animation:ud-roll-3d-horizontal var(--roll-dur,2600ms) ease-in-out infinite}',
  '.ud-carousel-3d-vertical{animation:ud-roll-3d-vertical var(--roll-dur,2600ms) ease-in-out infinite}'
].join('');

export { esc, attrString };
export const DEFAULT_FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const ICON_DEFAULTS = { fill: 'none', stroke: 'url(#lgS)', 'stroke-width': '{{sw}}', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#glow)' };
const resolvedIconDefaults = ctx => Object.fromEntries(Object.entries(ICON_DEFAULTS).map(([k, v]) => [k, resolveTokens(v, ctx.theme.tokens)]));
const round = v => Math.round(v * 100) / 100;

/**
 * Fresh render context.
 * @param lib  { path, icon, button, element }: Maps id -> { key, width, height, nodes, menu? } (menu: {cfg, items})
 */
export function createContext({ theme, lib = {}, animations = [], editor = false, emitIds = false, repeaterMode = 'animate' } = {}) {
  const anims = new Map();
  for (const a of animations) {
    if (a.nodeId == null) continue;
    if (!anims.has(a.nodeId)) anims.set(a.nodeId, []);
    anims.get(a.nodeId).push(a);
  }
  const L = { path: new Map(), icon: new Map(), button: new Map(), element: new Map(), ...lib };
  return { theme, lib: L, anims, editor, emitIds, depth: 0, activeInstances: new Set(), usedIcons: new Set(), usedAnimNodes: new Set(), seenIds: new Set(), hasMenu: false, hasCarousel: false, inHub: false,
    // repeaters: 'animate' (canvas preview), 'static' (first frame, svg export) or 'runtime' (template once + data for the html runtime)
    repeaterMode: ['animate', 'static', 'runtime'].includes(repeaterMode) ? repeaterMode : 'animate', repeaterCss: new Set(), hasRepeaterRuntime: false };
}

function childrenIndex(nodes) {
  const m = new Map();
  for (const e of nodes) { const k = e.parentId ?? null; if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  for (const list of m.values()) list.sort((a, b) => a.ord - b.ord || a.id - b.id);
  return m;
}

function resolvedAttrs(el, ctx) {
  const tokens = ctx.theme.tokens;
  const merged = { ...roleAttrs(ctx.theme, el.role) };
  for (const [k, v] of Object.entries(el.attrs || {})) merged[k] = typeof v === 'string' ? resolveTokens(v, tokens) : v;
  return merged;
}

function commonAttrs(el, a, ctx, all) {
  const cls = [a.class, ctx.anims.has(el.id) ? nodeClass(el.id) : ''].filter(Boolean).join(' ');
  if (ctx.anims.has(el.id)) ctx.usedAnimNodes.add(el.id);
  a.class = cls || null;
  if (ctx.editor) { a['data-el'] = el.id; if (el.name) a['data-name'] = el.name; }
  if (ctx.emitIds && el.name && !ctx.seenIds.has(el.name)) { a.id = el.name; ctx.seenIds.add(el.name); }
  if (el.rotation) {
    const b = nodeBBox(el, all);
    const rot = `rotate(${el.rotation} ${round(b.x + b.w / 2)} ${round(b.y + b.h / 2)})`;
    a.transform = a.transform ? `${rot} ${a.transform}` : rot;
  }
  return a;
}

/** Repeater container: its template children drawn itemCount times (copies exist only in the markup, never as nodes). */
function renderRepeater(el, ctx, idx, all) {
  const allTpls = repeaterTemplates(idx.get(el.id) || [], el.id);
  const cfg = repeaterConfig(el);
  const isMulti = cfg.multi === true || (allTpls.length > 1 && cfg.multi !== false && (el.attrs?.['data-repeater-multi'] === '1' || el.attrs?.['data-repeater-multi'] === 'true' || el.attrs?.['data-repeater-items'] || allTpls.some(t => t.role === 'repeater-template')));
  const tplNodes = isMulti ? allTpls : (allTpls.length ? [allTpls[0]] : []);
  const tplNode = tplNodes[0] || null;
  if (!tplNode && (!ctx.editor || ctx.depth > 0)) return '';   // empty slots are an editing aid of the open design only
  const inner = containerInnerBox(el, all, ctx.lib.element);
  let maxW = 0, maxH = 0;
  for (const tn of tplNodes) {
    const b = nodeBBox(tn, all);
    if (b.w > maxW) maxW = b.w;
    if (b.h > maxH) maxH = b.h;
  }
  let tb = tplNode ? nodeBBox(tplNode, all) : null;
  if (tb && (!(tb.w > 0) || !(tb.h > 0))) tb = { x: tb.x, y: tb.y, w: tb.w > 0 ? tb.w : 24, h: tb.h > 0 ? tb.h : 24 };
  const item = { w: cfg.itemWidth || maxW || tb?.w || 64, h: cfg.itemHeight || maxH || tb?.h || 64 };

  const renderSingleTpl = tn => {
    const b = nodeBBox(tn, all);
    const bw = b.w > 0 ? b.w : 24, bh = b.h > 0 ? b.h : 24;
    const s = cfg.itemWidth || cfg.itemHeight ? Math.min(item.w / bw, item.h / bh) : 1;
    return `<g transform="translate(${round((item.w - bw * s) / 2)} ${round((item.h - bh * s) / 2)}) scale(${round(s * 1000) / 1000}) translate(${round(-b.x)} ${round(-b.y)})">${renderNode(tn, ctx, idx, all)}</g>`;
  };

  let tpl;
  if (tplNodes.length > 1) {
    tpl = tplNodes.map(renderSingleTpl);
  } else if (tplNode) {
    tpl = renderSingleTpl(tplNode);
  } else {
    tpl = `<rect width="${round(item.w)}" height="${round(item.h)}" rx="10" fill="none" stroke="#10B981" stroke-dasharray="5 4" opacity="0.7"/>`;
  }
  const clipId = `ud-clip-rpt-${el.id}`;
  const clip = `<clipPath id="${clipId}"><rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="8"/></clipPath>`;
  const key = String(el.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const box = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
  const assignments = tplNodes.length > 1 ? assignRepeaterItems(tplNodes.length, cfg.itemCount, key) : null;

  if (ctx.repeaterMode === 'runtime' && tplNode) {
    ctx.hasRepeaterRuntime = true;
    const first = repeaterPlan(cfg, box, item).copies[0];
    const data = JSON.stringify({ id: key, cfg, inner: box, item, assignments });
    const tplMarkup = Array.isArray(tpl)
      ? tpl.map(t => `<g class="ud-rpt-tpl">${t}</g>`).join('')
      : `<g class="ud-rpt-tpl">${tpl}</g>`;
    return clip + `<g${attrString({ class: 'ud-container-children ud-repeater', 'data-container-for': el.id, 'clip-path': `url(#${clipId})`, 'data-rpt': data })}>` +
      `<g transform="translate(${first.x} ${first.y})">${tplMarkup}</g></g>`;
  }
  const out = repeaterMarkup(key, cfg, box, item, tpl, ctx.repeaterMode === 'static' ? 'static' : 'animate', assignments);
  if (out.css) ctx.repeaterCss.add(out.css);
  return clip + `<g class="ud-container-children ud-repeater" data-container-for="${el.id}" data-repeater-for="${el.id}" clip-path="url(#${clipId})">${out.markup}</g>`;
}

function renderContainerChildren(el, ctx, idx, all) {
  if (isRepeaterNode(el, ctx.lib.element)) return renderRepeater(el, ctx, idx, all);
  const childList = idx.get(el.id) || [];
  const isCar = isCarouselContainerNode(el, ctx.lib.element);
  if (!childList.length && !isCar) return '';
  const cfg = getContainerConfig(el, ctx.lib.element);
  const renderedKids = childList.map(k => renderNode(k, ctx, idx, all)).join('');
  if (isCar) {
    ctx.hasCarousel = true;
    const rollCls = cfg.carouselAutoRoll
      ? `ud-carousel-track ud-carousel-${cfg.carouselDim}-${cfg.carouselDir}`
      : 'ud-carousel-track';
    const inner = containerInnerBox(el, all, ctx.lib.element);
    const clipId = `ud-clip-car-${el.id}`;
    return `<clipPath id="${clipId}"><rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="10"/></clipPath>` +
      `<g class="ud-container-children" data-container-for="${el.id}" clip-path="url(#${clipId})" data-carousel-container="${el.id}" data-carousel-dim="${cfg.carouselDim}" data-carousel-dir="${cfg.carouselDir}">` +
      `<g class="${rollCls}" style="--roll-dur:${cfg.carouselSpeed}ms">${renderedKids}</g></g>`;
  }
  if (isContainerNode(el, ctx.lib.element) && renderedKids) {
    const inner = containerInnerBox(el, all, ctx.lib.element);
    const clipId = `ud-clip-cont-${el.id}`;
    return `<clipPath id="${clipId}"><rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" rx="8"/></clipPath>` +
      `<g class="ud-container-children" data-container-for="${el.id}" clip-path="url(#${clipId})" data-container-children="${el.id}">${renderedKids}</g>`;
  }
  return renderedKids;
}

function renderNode(el, ctx, idx, all) {
  if (el.visible === false || el.visible === 0) return '';
  if (!SAFE_TAGS.has(el.tag)) return '';
  let a = resolvedAttrs(el, ctx);
  if (a.display === 'none' && !ctx.editor) return '';
  if (el.kind === 'instance' || (el.tag === 'use' && el.refType)) {
    const instMarkup = renderInstance(el, a, ctx, all);
    const subMarkup = renderContainerChildren(el, ctx, idx, all);
    return instMarkup + subMarkup;
  }
  if (el.tag === 'use') return '';   // a bare <use> is only valid as a library instance
  a = commonAttrs(el, a, ctx, all);
  if (el.tag === 'text') return `<text${attrString(a)}>${esc(el.text)}</text>`;
  if (el.tag === 'g') {
    const kids = renderContainerChildren(el, ctx, idx, all);
    return `<g${attrString(a)}>${kids}</g>`;
  }
  const selfMarkup = `<${el.tag}${attrString(a)}/>`;
  const subMarkup = renderContainerChildren(el, ctx, idx, all);
  return selfMarkup + subMarkup;
}

function renderInstance(el, a, ctx, all) {
  const target = ctx.lib[el.refType]?.get(el.refId);
  const w = parseFloat(a.width), h = parseFloat(a.height), x = parseFloat(a.x) || 0, y = parseFloat(a.y) || 0;
  if (!target) return placeholder(el, a, ctx, all);

  if (el.refType === 'icon') {
    ctx.usedIcons.add(el.refId);
    const attrs = commonAttrs(el, { ...resolvedIconDefaults(ctx), ...a, href: `#i-${target.key}`, x, y, width: w || 24, height: h || 24 }, ctx, all);
    if (ctx.inHub) {
      attrs.class = [attrs.class, 'rm-hub-icon'].filter(Boolean).join(' ');
      // turns about its own centre (transform-box: view-box + an explicit origin; fill-box is unreliable on <use>)
      attrs.style = [attrs.style, `transform-origin:${round(x + (w || 24) / 2)}px ${round(y + (h || 24) / 2)}px`].filter(Boolean).join(';');
    }
    return `<use${attrString(attrs)}/>`;
  }

  // path groups, buttons and elements: their nodes are drawn in their own box, scaled into the instance box
  const instKey = `${el.refType}:${el.refId}`;
  if (ctx.depth > 5 || ctx.activeInstances?.has(instKey)) return placeholder(el, a, ctx, all);
  const tw = w || target.width, th = h || target.height;
  const { x: _x, y: _y, width: _w, height: _h, ...rest } = a;
  const menu = el.refType === 'button' && target.menu?.items?.length ? target.menu : null;
  const attrs = commonAttrs(el, { ...rest, transform: `translate(${x} ${y}) scale(${round(tw / target.width)} ${round(th / target.height)})` }, ctx, all);
  if (menu) { attrs.class = [attrs.class, 'ud-btn'].filter(Boolean).join(' '); attrs['data-menu'] = target.key; attrs['data-btn-id'] = el.refId; attrs.style = `--rot:${Number(menu.cfg.rotateOnOpen) || 0}deg`; }
  ctx.depth++;
  ctx.activeInstances?.add(instKey);
  const wasHub = ctx.inHub; ctx.inHub = !!menu;   // the button's own icons turn while open and are hidden while a sub level shows its icon
  const inner = renderTree(target.nodes, ctx);
  ctx.inHub = wasHub;
  let menuMarkup = '';
  if (menu) {
    ctx.hasMenu = true;
    const iconKey = id => ctx.lib.icon.get(id)?.key ?? null;
    // a menu item can draw a library button: scaled into the item box, without its own icon when the item has an icon
    const renderButton = (id, size, withoutIcon) => {
      const b = ctx.lib.button.get(id);
      if (!b || !b.nodes || ctx.depth > 5) return '';
      const nodes = b.nodes.filter(n => {
        if (withoutIcon && n.kind === 'instance' && n.refType === 'icon') return false;
        if (n.kind === 'instance' && n.refType === 'button' && Number(n.refId) === Number(id)) return false;
        return true;
      });
      // a button with no visible body left (only icons / empty groups) draws nothing, so the caller falls back to the plain circle
      if (!nodes.some(n => (n.kind === 'instance' ? n.refType !== 'icon' : n.tag !== 'g'))) return '';
      ctx.depth++;
      try {
        return `<g transform="translate(${round(-size / 2)} ${round(-size / 2)}) scale(${round(size / b.width)} ${round(size / b.height)})">${renderTree(nodes, ctx)}</g>`;
      } finally {
        ctx.depth--;
      }
    };
    // the button's own icon sets how big the hub glyphs are drawn (resize the icon on the canvas to scale them up to the centre circle)
    const ownIcon = (target.nodes || []).find(n => n.kind === 'instance' && n.refType === 'icon' && n.parentId == null);
    const iw = Number(ownIcon?.attrs?.width), ih = Number(ownIcon?.attrs?.height);
    const iconFrac = iw > 0 && ih > 0 ? Math.min(iw, ih) / Math.min(target.width, target.height) : null;
    menuMarkup = renderMenu({ button: target, cfg: menu.cfg, tree: buildMenuTree(menu.items), ctx, iconKey, renderButton, hostButtonId: el.refId, iconFrac });
  }
  ctx.activeInstances?.delete(instKey);
  ctx.depth--;
  return `<g${attrString(attrs)}>${inner}${menuMarkup}</g>`;
}

function placeholder(el, a, ctx, all) {
  const attrs = commonAttrs(el, { x: a.x || 0, y: a.y || 0, width: a.width || 24, height: a.height || 24, fill: 'none', stroke: '#EF4444', 'stroke-dasharray': '3 2' }, ctx, all);
  return `<rect${attrString(attrs)}/>`;
}

/** Renders a flat node list (roots + nested groups) to markup. */
export function renderTree(nodes, ctx) {
  const idx = childrenIndex(nodes);
  return (idx.get(null) || []).map(e => renderNode(e, ctx, idx, nodes)).join('');
}

function symbolFor(id, ctx) {
  const ic = ctx.lib.icon.get(id);
  return `<symbol id="i-${ic.key}" viewBox="0 0 24 24" overflow="visible">${renderTree(ic.nodes, ctx)}</symbol>`;
}

function collectDefs(ctx) {
  let symbols = '';
  const done = new Set();
  for (let guard = 0; guard < 4; guard++) {   // menu items may pull in more icons
    // icons whose geometry is not loaded yet (client-side lazy library) resolve through the shared page sprite
    const todo = [...ctx.usedIcons].filter(i => !done.has(i) && ctx.lib.icon.get(i)?.nodes);
    if (!todo.length) break;
    for (const id of todo) { done.add(id); symbols += symbolFor(id, ctx); }
  }
  return symbols;
}

function usedAnimationCss(ctx) {
  const list = [];
  for (const id of ctx.usedAnimNodes) list.push(...ctx.anims.get(id));
  return animationsToCss(list);
}

/** Wraps rendered content into a complete <svg>. */
function assemble(ctx, { width, height, viewBox, body, standalone = true, fontFamily, label, background }) {
  const symbols = collectDefs(ctx);
  const css = usedAnimationCss(ctx) + (ctx.hasMenu ? MENU_CSS : '') + (ctx.hasCarousel ? CAROUSEL_CSS : '') + [...(ctx.repeaterCss || [])].join('');
  const reduced = css ? '@media (prefers-reduced-motion:reduce){[class*="ud-e"]{animation:none!important}}' : '';
  const attrs = {
    xmlns: standalone ? 'http://www.w3.org/2000/svg' : null,
    viewBox: viewBox || `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label || null,
    'font-family': fontFamily === null ? null : (fontFamily || DEFAULT_FONT), class: 'ud-doc'
  };
  return `<svg${attrString(attrs)}><defs>${buildThemeDefs(ctx.theme)}${symbols}</defs>${css || reduced ? `<style>${css}${reduced}</style>` : ''}${background || ''}${body}</svg>`;
}

/** Full svg for a button, element or screen. */
export function renderDocument({ owner, nodes, ctx, background = false, standalone = true, viewBox = null }) {
  const bg = background ? `<rect width="${owner.width}" height="${owner.height}" fill="${resolveTokens('{{bg}}', ctx.theme.tokens)}"/>` : '';
  const body = renderTree(nodes, ctx);
  const vbw = viewBox ? round(viewBox.w) : owner.width, vbh = viewBox ? round(viewBox.h) : owner.height;
  return assemble(ctx, { width: vbw, height: vbh, viewBox: viewBox ? `${round(viewBox.x)} ${round(viewBox.y)} ${round(viewBox.w)} ${round(viewBox.h)}` : null, body, standalone, label: owner.label || owner.name, background: bg });
}

/** Full svg for a 24-grid glyph: an icon or a path group. Optional round button frame behind it. */
export function renderIconDocument({ icon, nodes, ctx, size = 192, frame = false, standalone = true }) {
  const body = renderTree(nodes, ctx);
  const inner = `<g${attrString(resolvedIconDefaults(ctx))}>${body}</g>`;
  let svgBody, vb;
  if (frame) {
    const btn = roleAttrs(ctx.theme, 'button');
    svgBody = `<rect${attrString({ x: 2, y: 2, width: 92, height: 92, rx: 46, ...btn })}/><g transform="translate(24 24) scale(2)">${inner}</g>`;
    vb = '-10 -10 116 116';
  } else { svgBody = inner; vb = '0 0 24 24'; }
  return assemble(ctx, { width: size, height: size, viewBox: vb, body: svgBody, standalone, label: icon.label || icon.name, fontFamily: null });
}

/** Standalone SVG helper for any item type (path, icon, button, element, screen). */
export function renderStandaloneSvg(type, item, opts = {}) {
  const nodes = item?.nodes || [];
  const ctx = opts.theme ? opts : opts.ctx;
  if (type === 'path' || type === 'icon') {
    return renderIconDocument({ icon: item, nodes, ctx, size: opts.size || 72, frame: Boolean(opts.frame), standalone: true });
  }
  return renderDocument({ owner: item, nodes, ctx, background: type === 'screen', standalone: true });
}

/** An <svg> sprite (symbols only) for the given icon ids. */
export function renderSprite({ iconIds, ctx }) {
  for (const id of iconIds) if (ctx.lib.icon.has(id)) ctx.usedIcons.add(id);
  const symbols = collectDefs(ctx);
  const css = usedAnimationCss(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${buildThemeDefs(ctx.theme)}${symbols}</defs>${css ? `<style>${css}</style>` : ''}</svg>`;
}

/** Makes ids unique per theme when several themed copies of a design live in one HTML page. */
export function suffixIds(svg, suffix) {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  if (!ids.size) return svg;
  const alt = [...ids].map(i => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return svg
    .replace(new RegExp(`(\\sid=")(${alt})(")`, 'g'), `$1$2-${suffix}$3`)
    .replace(new RegExp(`url\\(#(${alt})\\)`, 'g'), `url(#$1-${suffix})`)
    .replace(new RegExp(`(href="#)(${alt})(")`, 'g'), `$1$2-${suffix}$3`);
}

/**
 * Builds the library Maps the renderer needs from full design records ({id,key,width,height,nodes}).
 * `menus` maps button id -> menu item rows; button meta supplies the menu settings.
 */
export function indexLibrary({ paths = [], icons = [], buttons = [], elements = [] }, menus = new Map()) {
  const one = (d, extra) => [d.id, { key: d.key, width: d.width, height: d.height, nodes: d.nodes, ...extra }];
  return {
    path: new Map(paths.map(d => one(d))),
    icon: new Map(icons.map(d => one(d))),
    button: new Map(buttons.map(d => one(d, { menu: menus.get(d.id)?.length ? { cfg: menuConfig(d.meta), items: menus.get(d.id) } : null }))),
    element: new Map(elements.map(d => one(d)))
  };
}
