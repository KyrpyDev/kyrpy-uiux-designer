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

export function effectiveMenuLayout(cfg = {}) {
  return cfg.layout || (
    cfg.kind === 'radial' || cfg.kind === 'rotating' || cfg.kind === 'hub' ? 'fan'
      : cfg.kind === 'drawer' ? 'drawer'
      : cfg.kind === 'slider-vertical' ? 'slider-vertical'
      : cfg.kind === 'slider-horizontal' ? 'slider-horizontal'
      : cfg.kind === 'carousel' ? 'carousel'
      : 'list'
  );
}

/** Effective menu orientation ('horizontal' | 'vertical') across all menu mechanisms. */
export function menuOrientation(cfg = {}, { ignoreOrientation = false } = {}) {
  if (!ignoreOrientation && (cfg?.orientation === 'horizontal' || cfg?.orientation === 'vertical')) return cfg.orientation;
  const eff = effectiveMenuLayout(cfg);
  if (cfg?.kind === 'hub') {
    return (cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down') ? 'vertical' : 'horizontal';
  }
  if (eff === 'slider-vertical' || cfg?.kind === 'slider-vertical') return 'vertical';
  if (eff === 'slider-horizontal' || cfg?.kind === 'slider-horizontal') return 'horizontal';
  if (eff === 'carousel' || cfg?.kind === 'carousel') {
    return (cfg?.direction === 'vertical' || cfg?.direction === 'up' || cfg?.direction === 'down') ? 'vertical' : 'horizontal';
  }
  if (eff === 'drawer' || cfg?.kind === 'drawer') {
    const side = cfg?.side || cfg?.direction || 'right';
    return (side === 'top' || side === 'bottom' || side === 'up' || side === 'down') ? 'vertical' : 'horizontal';
  }
  if (eff === 'fan' || eff === 'radial') {
    const mid = ((Number(cfg?.startAngle ?? DEFAULT_MENU.startAngle) || 0) + (Number(cfg?.sweep ?? DEFAULT_MENU.sweep) || 0) / 2) * Math.PI / 180;
    return Math.abs(Math.cos(mid)) > Math.abs(Math.sin(mid)) * 1.05 ? 'vertical' : 'horizontal';
  }
  return (cfg?.direction === 'left' || cfg?.direction === 'right') ? 'horizontal' : 'vertical';
}

/** Settings patch for switching any menu mechanism between 'horizontal' and 'vertical' orientation. */
export function menuOrientationPatch(cfg = {}, orientation) {
  const to = orientation === 'vertical' ? 'vertical' : 'horizontal';
  if (cfg.kind === 'hub') return { orientation: to, ...hubDirectionPatch(cfg, to) };
  const eff = effectiveMenuLayout(cfg);
  if (eff === 'slider-vertical' || eff === 'slider-horizontal' || cfg.kind === 'slider-vertical' || cfg.kind === 'slider-horizontal') {
    const nextLayout = to === 'vertical' ? 'slider-vertical' : 'slider-horizontal';
    const patch = {
      orientation: to,
      layout: nextLayout,
      direction: to === 'vertical'
        ? (cfg.direction === 'up' ? 'up' : 'down')
        : (cfg.direction === 'left' ? 'left' : 'right')
    };
    if (cfg.kind === 'slider-vertical' || cfg.kind === 'slider-horizontal') patch.kind = nextLayout;
    return patch;
  }
  if (eff === 'carousel' || cfg.kind === 'carousel') {
    return { orientation: to, direction: to };
  }
  if (eff === 'drawer' || cfg.kind === 'drawer') {
    const side = to === 'vertical'
      ? ((cfg.side === 'top' || cfg.side === 'up') ? 'top' : 'bottom')
      : (cfg.side === 'left' ? 'left' : 'right');
    return { orientation: to, side, direction: side };
  }
  if (eff === 'fan' || eff === 'radial') {
    const sw = Number(cfg.sweep ?? DEFAULT_MENU.sweep) || 140;
    const cur = menuOrientation(cfg, { ignoreOrientation: true });
    if (cur === to) return { orientation: to };
    const fromFan = HUB_FAN[to === 'vertical' ? 'horizontal' : 'vertical'];
    if (Number(cfg.startAngle ?? DEFAULT_MENU.startAngle) === fromFan.startAngle && sw === fromFan.sweep) {
      return { orientation: to, ...HUB_FAN[to] };
    }
    return { orientation: to, startAngle: Math.round((to === 'vertical' ? 0 : -90) - sw / 2), sweep: sw };
  }
  return {
    orientation: to,
    direction: to === 'vertical'
      ? ((cfg.direction === 'up' || cfg.direction === 'down') ? cfg.direction : 'up')
      : ((cfg.direction === 'left' || cfg.direction === 'right') ? cfg.direction : 'right')
  };
}

/** True when the menu uses per item slide-to-scroll settings (cfg.itemScroll) instead of the old menu-wide switch. */
export function hasItemScroll(cfg = {}) {
  return !!(cfg.itemScroll && typeof cfg.itemScroll === 'object' && Object.keys(cfg.itemScroll).length);
}

/** Normalises cfg.itemScroll: { [menuItemId]: { on: boolean, targetId: element id | null } }. */
export function normalizeItemScroll(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, s] of Object.entries(v)) {
    if (!/^\d+$/.test(k) || !s || typeof s !== 'object') continue;
    const on = s.on === true || s.on === 1 || s.on === '1' || s.on === 'true';
    const t = s.targetId == null ? '' : String(s.targetId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    out[k] = { on, targetId: t || null, mode: s.mode === 'scroll' ? 'scroll' : 'focus' };   // default slide mode: focus
  }
  return out;
}

/** Gesture actions a menu item can have besides its click: long press and double click / tap. */
export const ITEM_GESTURE_TYPES = ['none', 'click', 'screen', 'popup', 'focused'];
/**
 * Normalises cfg.itemGestures: { [menuItemId]: { long: { type, target }, dbl: { type, target } } }.
 * type: none · click (same as a click) · screen (go to screen `target`) · popup (show element `target`) ·
 * focused (open the focused item of the list the item slides: its own screen / popup, as if it was clicked)
 */
export function normalizeItemGestures(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  const one = g => {
    const type = g && ITEM_GESTURE_TYPES.includes(g.type) ? g.type : 'none';
    const t = g?.target == null ? '' : String(g.target).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    // focused: no target = the focused item's own screen / popup; "s-<id>" a screen or "e-<id>" a popup chosen for it
    if (type === 'focused') return { type, target: /^[se]-\d+$/.test(t) ? t : null };
    return { type, target: (type === 'screen' || type === 'popup') && t ? t : null };
  };
  for (const [k, g] of Object.entries(v)) {
    if (!/^\d+$/.test(k) || !g || typeof g !== 'object') continue;
    const r = { long: one(g.long), dbl: one(g.dbl) };
    if (r.long.type !== 'none' || r.dbl.type !== 'none') out[k] = r;
  }
  return out;
}

export function menuConfig(buttonMeta) {
  const raw = buttonMeta?.menu || {};
  const merged = { ...DEFAULT_MENU, ...raw };
  if (raw.orientation === 'horizontal' || raw.orientation === 'vertical') {
    const patch = menuOrientationPatch(merged, raw.orientation);
    for (const [k, v] of Object.entries(patch)) {
      if (raw[k] === undefined) merged[k] = v;
    }
    merged.orientation = raw.orientation;
  } else {
    merged.orientation = menuOrientation(merged);
  }
  return merged;
}

/** True when a menu item is shown: its own switch is on and no item above it is hidden (a hidden item disables its sub tree). */
export function isMenuItemShown(rows, item) {
  const by = new Map((rows || []).map(r => [r.id, r]));
  for (let r = item, guard = 0; r && guard < 64; r = by.get(r.parentId), guard++) if (r.visible === false) return false;
  return true;
}

/** Flat rows (id, parentId, ord ...) -> nested tree with `path` (dashed names joined by "/"). */
export function buildMenuTree(rows, { includeHidden = false } = {}) {
  // an item hidden (disabled) hides its whole sub tree: its sub items are never promoted to the level above.
  // `hiddenByParent` marks items that are only hidden through an ancestor (their own switch is kept for when it is shown again)
  const all = new Map((rows || []).map(r => [r.id, r]));
  const hiddenAbove = r => { for (let p = all.get(r.parentId), guard = 0; p && guard < 64; p = all.get(p.parentId), guard++) if (p.visible === false) return true; return false; };
  const filtered = includeHidden ? (rows || []) : (rows || []).filter(r => r.visible !== false && !hiddenAbove(r));
  const by = new Map(filtered.map(r => [r.id, { ...r, children: [], ...(includeHidden && hiddenAbove(r) ? { hiddenByParent: true } : {}) }]));
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
  const dist = (cfg.distance ?? cfg.gap ?? 0.2) * size;      // distance of the first item from its parent (the button)
  const effLayout = effectiveMenuLayout(cfg);
  for (let i = 0; i < n; i++) {
    if (effLayout === 'fan' || effLayout === 'radial') {
      const a = (cfg.startAngle + (n > 1 ? cfg.sweep * i / (n - 1) : cfg.sweep / 2)) * Math.PI / 180, R = cfg.radius * size;
      out.push({ x: R * Math.cos(a), y: R * Math.sin(a), s });
    } else if (effLayout === 'slider-horizontal') {
      const dirSign = cfg.direction === 'left' ? -1 : 1;
      const d = size / 2 + dist + s / 2 + i * (s + gap);
      out.push({ x: dirSign * d, y: 0, s });
    } else if (effLayout === 'slider-vertical') {
      const dirSign = cfg.direction === 'up' ? -1 : 1;
      const d = size / 2 + dist + s / 2 + i * (s + gap);
      out.push({ x: 0, y: dirSign * d, s });
    } else if (effLayout === 'carousel') {
      const isVert = cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down' || (cfg.direction !== 'horizontal' && cfg.orientation === 'vertical');
      const d = size / 2 + dist + s / 2 + i * (s + gap);
      out.push({ x: isVert ? 0 : d, y: isVert ? d : 0, s });
    } else if (effLayout === 'drawer') {
      const side = cfg.side || cfg.direction || (cfg.orientation === 'vertical' ? 'bottom' : 'right');
      const d = size / 2 + dist + s / 2 + i * (s + gap);
      const dir = { up: [0, -1], top: [0, -1], down: [0, 1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side] || [1, 0];
      out.push({ x: dir[0] * d, y: dir[1] * d, s });
    } else {
      const d = size / 2 + dist + s / 2 + i * (s + gap);
      const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[cfg.direction] || (cfg.orientation === 'horizontal' ? [1, 0] : [0, -1]);
      out.push({ x: dir[0] * d, y: dir[1] * d, s });
    }
  }
  return out;
}

const round = v => Math.round(v * 100) / 100;

/** Hub menu geometry (px): small = side button diameter, big = centre button (centerScale, 0 = twice small), gap between buttons, vertical flag. */
export function hubGeometry(cfg, size) {
  const small = size * (Number(cfg.hubScale) > 0 ? Number(cfg.hubScale) : 0.4);
  const big = Number(cfg.centerScale) > 0 ? size * Number(cfg.centerScale) : small * 2;
  const vertical = cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down'
    || (!cfg.direction && cfg.orientation === 'vertical');
  return { small, big, k: small / big, gap: (cfg.gap ?? 0.2) * size, vertical };
}

/** Buttons a hub bar shows at once: 1-6 (default 3). */
export function hubCount(cfg) {
  const v = Math.round(Number(cfg?.hubCount));
  return v >= 1 && v <= 6 ? v : 3;
}

/** Distance from the centre (px) along the bar reached by the outermost button on the hub bar. */
export function hubBarReach(cfg, hubG, itemCount = null) {
  const v = hubCount(cfg);
  const n = itemCount != null && itemCount > 0 ? Math.min(itemCount, v) : v;
  const odd = n % 2 === 1;
  const fr = [cfg?.hubCenterSize ?? 1, cfg?.hubSideSize ?? 0.6, cfg?.hubEdgeSize ?? 0.4].map(Number);
  const frac = dist => dist <= 0 ? (fr[0] || 1) : dist === 1 ? (fr[1] || 0.6) : (fr[2] || 0.4);
  const sizeOf = d => hubG.big * frac(odd ? Math.abs(d) : (d <= 0 ? -d : d - 1));
  let reach = 0;
  if (odd) {
    let edge = sizeOf(0) / 2;
    for (let j = 1; j <= (n - 1) / 2; j++) {
      const s = sizeOf(j);
      edge += hubG.gap + s;
    }
    reach = edge;
  } else {
    const lo = -(n / 2 - 1), hi = n / 2;
    let total = 0;
    for (let d = lo; d <= hi; d++) total += sizeOf(d) + (d > lo ? hubG.gap : 0);
    reach = total / 2;
  }
  return reach;
}

/** Hub icon size as a fraction of the button it sits in: 0 = automatic, else 0.1-1 (1 = the button's full extent). */
export function hubIconSize(cfg) {
  const v = Number(cfg?.hubIconSize);
  return v > 0 ? Math.max(0.1, Math.min(1, v)) : 0;
}

/** Hub "back" button: lower right, out past the centre button and below the right side button (vertical bar: mirrored, below the centre). */
export function hubBackSpot(hub, cx, cy) {
  const r = hub.big * 0.13, along = hub.big / 2 + hub.gap + hub.small / 2 + hub.big * 0.6, across = hub.big * 0.4;
  return { bx: cx + (hub.vertical ? across : along), by: cy + (hub.vertical ? along : across), r };
}

/** Default fan of each hub bar direction: above the bar (horizontal) or to its right (vertical), clear of the side buttons. */
export const HUB_FAN = { horizontal: { startAngle: -160, sweep: 140 }, vertical: { startAngle: -70, sweep: 140 } };

/** Settings patch for switching a hub bar's direction: the fan follows when it still sits at the other direction's default. */
export function hubDirectionPatch(cfg, direction) {
  const to = direction === 'vertical' ? 'vertical' : 'horizontal', from = HUB_FAN[to === 'vertical' ? 'horizontal' : 'vertical'];
  const patch = { direction: to };
  if (Number(cfg?.startAngle) === from.startAngle && Number(cfg?.sweep ?? from.sweep) === from.sweep) Object.assign(patch, HUB_FAN[to]);
  return patch;
}

export function showLabelsEnabled(cfg = {}) {
  const v = cfg?.showLabels;
  return Boolean(v && v !== '0' && v !== 'false' && v !== 'off' && v !== 'none');
}

/**
 * Mechanism-aware label placement for a menu item:
 *  - Vertical mechanisms (vertical list, slider-vertical, top/bottom drawer, vertical carousel, vertical hub bar,
 *    or left/right arc of a fan/radial menu) -> 'beside' (left or right of the item so stacked buttons never collide).
 *  - Horizontal mechanisms (horizontal list, slider-horizontal, left/right drawer, horizontal carousel, horizontal hub bar,
 *    or top/bottom arc of a fan/radial menu) -> 'over' (above or below the item so side-by-side buttons never collide).
 * Explicit `cfg.labelPosition` ('beside' | 'over') overrides 'auto'.
 */
export function resolveMenuLabelPlacement(cfg = {}, { isHubRoot = false, dx = 0, dy = 0 } = {}) {
  const eff = effectiveMenuLayout(cfg);
  let autoPos;
  if (isHubRoot) {
    autoPos = hubGeometry(cfg, 64).vertical ? 'beside' : 'over';
  } else if (eff === 'fan' || eff === 'radial') {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      autoPos = menuOrientation(cfg) === 'vertical' ? 'beside' : 'over';
    } else {
      autoPos = Math.abs(dx) > Math.abs(dy) * 1.05 ? 'beside' : 'over';
    }
  } else {
    autoPos = menuOrientation(cfg) === 'vertical' ? 'beside' : 'over';
  }
  const mode = typeof cfg?.showLabels === 'string' && (cfg.showLabels === 'beside' || cfg.showLabels === 'over')
    ? cfg.showLabels
    : cfg?.labelPosition;
  const pos = mode === 'beside' || mode === 'over' ? mode : autoPos;
  let side;
  if (pos === 'beside') {
    side = !isHubRoot && (eff === 'fan' || eff === 'radial') && dx < -0.5 ? 'left' : 'right';
  } else {
    side = (!isHubRoot && (eff === 'fan' || eff === 'radial') && dy > 2) || (!isHubRoot && cfg?.fanCorner?.startsWith('top'))
      ? 'bottom'
      : 'top';
  }
  return { pos, side };
}

/** Pill geometry (relative to item centre 0,0) for a menu item label. */
export function menuLabelMetrics(text, r, { isHubRoot = false, pos = 'over', side = 'top' } = {}) {
  const txt = String(text ?? '').trim();
  if (!txt) return null;
  const fs = isHubRoot
    ? Math.max(9, Math.min(14, round(r * 0.28)))
    : Math.max(9, Math.min(13, round(r * 0.48)));
  const textW = Math.max(fs * 1.6, round(txt.length * fs * 0.58));
  const pillW = round(textW + fs * 1.1);
  const pillH = round(fs * 1.5);
  const gapPx = Math.max(4, round(r * 0.16));
  const lx = pos === 'beside' ? (side === 'left' ? -round(r + gapPx + pillW / 2) : round(r + gapPx + pillW / 2)) : 0;
  const ly = pos === 'over' ? (side === 'bottom' ? round(r + gapPx + pillH / 2) : -round(r + gapPx + pillH / 2)) : 0;
  return {
    txt, fs, pillW, pillH, pillRx: round(pillH / 2), gapPx, lx, ly,
    x0: round(lx - pillW / 2), y0: round(ly - pillH / 2),
    x1: round(lx + pillW / 2), y1: round(ly + pillH / 2)
  };
}

/**
 * Markup of a button's menu, drawn in the button's own coordinate box (w x h) so it scales with the button.
 * Every level is pre-rendered (hidden); the runtime only toggles classes.
 * @param {object} p {button:{key,width,height}, cfg, tree, ctx, iconKey(id)->key|null}
 */
export function renderMenu({ button, cfg, tree, ctx, iconKey, renderButton = null, hostButtonId = null, iconFrac = null }) {
  const w = button.width, h = button.height, cx = w / 2, cy = h / 2, size = Math.min(w, h);
  const surface = roleAttrs(ctx.theme, 'button');
  const itemAttrs = a => attrString({ ...surface, ...a });
  const isHub = cfg.kind === 'hub';
  const hub = hubGeometry(cfg, size);
  const lsize = isHub ? hub.big : size;                    // fan sizes are relative to the centre button in a hub
  // hub: an explicit icon size (fraction of each button, up to the whole button) replaces the automatic 62 % glyph
  const hubFrac = isHub ? hubIconSize(cfg) : 0;
  const iconSize = lsize * cfg.itemScale * (hubFrac || 0.62);
  // hub glyphs follow the button's own icon: an icon as big as the button draws the usual 62% glyph, a bigger icon scales it
  // up until it fills the centre circle (its container), a smaller one scales it down
  const hubIcon = hubFrac ? hub.big * hubFrac : Math.min(hub.big, hub.big * 0.62 * (Number(iconFrac) > 0 ? Number(iconFrac) : 1));
  // slide-to-scroll is a per item setting (cfg.itemScroll[itemId] = { on, targetId }): only the items switched on scroll,
  // each one the container chosen for it (none chosen = the repeater on the screen). Menus saved before keep the old rule.
  const perItemScroll = hasItemScroll(cfg);
  // long press / double click actions: data-gest-long / data-gest-dbl = "type" or "type:target"
  const gestureAttr = it => {
    const g = cfg.itemGestures && cfg.itemGestures[String(it.id)];
    if (!g) return '';
    const v = x => x && x.type && x.type !== 'none' ? esc(x.target ? `${x.type}:${x.target}` : x.type) : '';
    const l = v(g.long), d = v(g.dbl);
    return (l ? ` data-gest-long="${l}"` : '') + (d ? ` data-gest-dbl="${d}"` : '');
  };
  const scrollAttr = it => {
    if (perItemScroll) {
      const s = cfg.itemScroll[String(it.id)];
      if (!s || !s.on) return ' data-item-scroll="0"' + gestureAttr(it);
      return ` data-item-scroll="1"${s.mode === 'focus' ? ' data-item-scroll-mode="focus"' : ''}${s.targetId != null && s.targetId !== '' ? ` data-target-repeater="${esc(s.targetId)}"` : ''}` + gestureAttr(it);
    }
    return ((it.action === 'scroll-repeater' || it.targetElementKey || it.targetElementId)
      ? ` data-target-repeater="${esc(it.targetElementKey || it.targetElementId || '')}"` : '') + gestureAttr(it);
  };
  const isCarousel = cfg.layout === 'carousel' || cfg.kind === 'carousel';
  if (isCarousel) ctx.hasCarousel = true;
  const carDim = cfg.dimension === '2d' ? '2d' : '3d';
  const carDir = (cfg.direction === 'vertical' || cfg.direction === 'up' || cfg.direction === 'down' || (cfg.direction !== 'horizontal' && cfg.orientation === 'vertical')) ? 'vertical' : 'horizontal';
  const labelsOn = showLabelsEnabled(cfg);
  const textFill = labelsOn ? resolveTokens('{{text}}', ctx.theme.tokens) : '';
  const pillFill = labelsOn ? resolveTokens('{{surface}}', ctx.theme.tokens) : '';
  const pillStroke = labelsOn ? resolveTokens('{{line}}', ctx.theme.tokens) : '';
  const renderLabel = (it, r, opts) => {
    if (!labelsOn) return { attr: '', svg: '' };
    const pl = resolveMenuLabelPlacement(cfg, opts);
    const lm = menuLabelMetrics(it.label || it.name, r, { isHubRoot: opts.isHubRoot, pos: pl.pos, side: pl.side });
    if (!lm) return { attr: '', svg: '' };
    const attr = ` data-lbox="${lm.x0},${lm.y0},${lm.x1},${lm.y1}"`;
    const svg = `<g class="rm-label" data-label-pos="${pl.pos}" data-label-side="${pl.side}" data-lw="${lm.pillW}" data-lh="${lm.pillH}" data-lgap="${lm.gapPx}" transform="translate(${lm.lx} ${lm.ly})">`
      + `<rect x="${round(-lm.pillW / 2)}" y="${round(-lm.pillH / 2)}" width="${lm.pillW}" height="${lm.pillH}" rx="${lm.pillRx}" fill="${esc(pillFill)}" fill-opacity="0.92" stroke="${esc(pillStroke)}" stroke-width="1"/>`
      + `<text x="0" y="${round(lm.fs * 0.35)}" text-anchor="middle" font-size="${lm.fs}" font-weight="600" fill="${esc(textFill)}">${esc(lm.txt)}</text></g>`;
    return { attr, svg };
  };
  const iconUse = (id, x, y, sz) => {
    const key = id != null ? iconKey(id) : null;
    if (!key) return '';
    ctx.usedIcons.add(id);
    const stroke = resolveTokens('{{sw}}', ctx.theme.tokens);
    return `<use href="#i-${esc(key)}" x="${round(x - sz / 2)}" y="${round(y - sz / 2)}" width="${round(sz)}" height="${round(sz)}" fill="none" stroke="url(#lgS)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" class="rm-icon" style="transform-origin:${round(x)}px ${round(y)}px"/>`;
  };
  // body of one item, drawn around its own centre (0,0): a referenced library button (its own icon unless the item has one), else circle + icon
  const itemBody = (it, r, iconSz) => {
    // the slot shows the item's own library button; without one it shows this menu button's own body (never a bare placeholder shell)
    const slotButton = it.refButtonId ?? cfg.itemButtonId ?? hostButtonId;
    const btn = slotButton != null && renderButton ? renderButton(slotButton, r * 2, Boolean(it.iconId) || slotButton === hostButtonId) : '';
    if (btn) return `${btn}<circle r="${round(r)}" fill="transparent"/>${iconUse(it.iconId, 0, 0, iconSz)}`;
    return `<circle r="${round(r)}"${itemAttrs({})}/><circle r="${round(r)}" fill="transparent"/>${iconUse(it.iconId, 0, 0, iconSz)}`;
  };
  // static picture (previews, thumbnails, exports without the runtime): the default centre item sits on the button, the others are hidden;
  // the runtime's CSS transform / opacity override these presentation attributes as soon as it runs
  const hubStartIdx = Math.max(0, tree.findIndex(it => it.id != null && Number(it.id) === Number(cfg.hubCenterItemId)));
  const hubStaticAttrs = i => i === hubStartIdx ? `transform="translate(${round(cx)} ${round(cy)})"` : `transform="translate(${round(cx)} ${round(cy)}) scale(0)" opacity="0"`;
  const levels = [], centers = [];
  const walk = (items, parentPath, parentNode) => {
    const pos = layoutItems(cfg, items.length, lsize);
    const isHubRoot = isHub && parentPath === '';
    const els = items.map((it, i) => {
      if (isHubRoot) {
        // one pre-rendered button per ring item; the runtime places it (left / centre / right / hidden) with --x --y --k --o
        const r = hub.big / 2;
        const lbl = renderLabel(it, r, { isHubRoot: true, dx: 0, dy: 0 });
        const popupAttr = (it.targetElementKey || it.targetElementId)
          ? ` data-popup-element="${esc(it.targetElementKey || it.targetElementId)}" data-popup-element-id="${esc(it.targetElementId || '')}"`
          : '';
        const rptAttr = scrollAttr(it);
        return `<g class="rm-item rm-hub-item" data-item="${esc(it.path)}" data-hub-index="${i}" data-r="${round(r)}" data-children="${it.children.length ? 1 : 0}" data-action="${esc(it.action || '')}" data-target="${esc(it.targetKey || (it.targetScreenId != null ? String(it.targetScreenId) : ''))}"${popupAttr}${rptAttr}${lbl.attr}${ctx.editor ? ` data-menu-id="${it.id}"` : ''} style="--x:${round(cx)}px;--y:${round(cy)}px;--k:0;--o:0" ${hubStaticAttrs(i)}>`
          + `<title>${esc(it.label || it.name)}</title>${ctx.editor ? `<g class="rm-item-body">${itemBody(it, r, hubIcon)}</g>` : itemBody(it, r, hubIcon)}${lbl.svg}</g>`;
      }
      const p = pos[i], r = p.s / 2;
      const lbl = renderLabel(it, r, { isHubRoot: false, dx: p.x, dy: p.y });
      const popupAttr = (it.targetElementKey || it.targetElementId)
        ? ` data-popup-element="${esc(it.targetElementKey || it.targetElementId)}" data-popup-element-id="${esc(it.targetElementId || '')}"`
        : '';
      const rptAttr = scrollAttr(it);
      return `<g class="rm-item" data-item="${esc(it.path)}" data-r="${round(r)}" data-children="${it.children.length ? 1 : 0}" data-action="${esc(it.action || '')}" data-target="${esc(it.targetKey || (it.targetScreenId != null ? String(it.targetScreenId) : ''))}"${popupAttr}${rptAttr}${lbl.attr}${ctx.editor ? ` data-menu-id="${it.id}"` : ''} style="--x:${round(cx + p.x)}px;--y:${round(cy + p.y)}px;--i:${i}">`
        + `<title>${esc(it.label || it.name)}</title>${itemBody(it, r, iconSize)}${lbl.svg}</g>`;
    });
    const innerItems = isCarousel
      ? `<g class="ud-carousel-track ud-carousel-${carDim}-${carDir}" style="--roll-dur:2400ms">${els.join('')}</g>`
      : els.join('');
    // corner fan: the runtime places this level's items on a quarter circle at a corner of the screen (it knows the screen bounds)
    const corner = !isHubRoot && !isCarousel && cfg.fanCorner ? ` data-corner="${esc(cfg.fanCorner)}" data-corner-r="${round((cfg.radius || 1.15) * lsize)}"` : '';
    // fan levels: their arc, so the runtime can show a window of 8 / 9 items (ends 30 % smaller) when a level has more
    const isFan = !isHubRoot && !isCarousel && !corner && ((cfg.layout || (cfg.kind === 'radial' ? 'fan' : '')) === 'fan' || cfg.layout === 'radial');
    const fanAttrs = isFan ? ` data-fan-start="${Number(cfg.startAngle) || 0}" data-fan-sweep="${Number(cfg.sweep) || 0}" data-fan-r="${round((cfg.radius || 1.15) * lsize)}"` : '';
    levels.push(`<g class="rm-level" data-level="${esc(parentPath)}" data-layout="${esc(isHubRoot ? 'hub' : (cfg.layout || 'list'))}"${corner}${fanAttrs}>${innerItems}</g>`);
    for (const it of items) {
      const rot = cfg.kind === 'rotating' || cfg.kind === 'radial';
      if (rot && it.children.length || rot && ctx.editor || (isHub && parentNode && it.children.length)) {
        centers.push(`<g class="rm-center" data-for="${esc(it.path)}">${isHub
          // a hub hides the host body below the first level, so the centred item brings its own body (library button / host body / plain circle)
          ? `<g transform="translate(${round(cx)} ${round(cy)})">${itemBody(it, hub.big / 2, hubIcon)}</g>`
          : `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(lsize / 2)}"${itemAttrs({})}/>${iconUse(it.iconId, cx, cy, lsize * 0.625)}`}</g>`);
      }
      if (it.children.length) walk(it.children, it.path, it);
    }
  };
  walk(tree, '', null);
  const showElAttr = (cfg.targetElementId ? ` data-show-element-id="${esc(cfg.targetElementId)}"` : '')
    + (!cfg.targetElementId && cfg.targetScreenId ? ` data-show-screen-id="${esc(cfg.targetScreenId)}"` : '');
  const hubScrollOn = perItemScroll || cfg.hubCenterScrollRepeater === false ? '0' : '1';
  const hubScrollTarget = !perItemScroll && cfg.hubRepeaterTargetId ? ` data-target-repeater="${esc(cfg.hubRepeaterTargetId)}"` : '';
  const hit = `<circle class="rm-hit" data-rm="center" data-hub-center-scroll="${hubScrollOn}"${hubScrollTarget} cx="${round(cx)}" cy="${round(cy)}" r="${round(lsize / 2)}" fill="transparent"${showElAttr}/>`;
  // hub menus: a small "up one level" button at the lower right of the centre, shown only inside sub items (the runtime sets data-hubdepth)
  let back = '';
  if (isHub) {
    const { bx, by, r } = hubBackSpot(hub, cx, cy);
    back = `<g class="rm-back" data-rm="center" data-back="1" visibility="hidden"><title>Back to the menu level above</title><circle cx="${round(bx)}" cy="${round(by)}" r="${round(r)}"${itemAttrs({})}/>`
      + `<path d="M${round(bx + r * 0.42)} ${round(by)}H${round(bx - r * 0.42)}M${round(bx - r * 0.05)} ${round(by - r * 0.4)}L${round(bx - r * 0.42)} ${round(by)}L${round(bx - r * 0.05)} ${round(by + r * 0.4)}" fill="none" stroke="url(#lgS)" stroke-width="${round(Math.max(1, r * 0.14))}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  const hubFixed = cfg.hubFixedPositions ? 1 : 0;
  const hubAttrs = isHub ? ` data-cx="${round(cx)}" data-cy="${round(cy)}" data-hub-small="${round(hub.small)}" data-hub-big="${round(hub.big)}" data-hub-k="${round(hub.k)}" data-hub-gap="${round(hub.gap)}" data-hub-vertical="${hub.vertical ? 1 : 0}" data-hub-start="${Math.max(0, tree.findIndex(it => it.id != null && Number(it.id) === Number(cfg.hubCenterItemId)))}" data-hub-sizes="${[cfg.hubCenterSize ?? 1, cfg.hubSideSize ?? 0.6, cfg.hubEdgeSize ?? 0.4].map(Number).join(',')}" data-hub-count="${hubCount(cfg)}" data-sub-inside="${cfg.hubSubInside === false ? 0 : 1}" data-hub-fixed="${hubFixed}" data-hub-center-scroll="${hubScrollOn}"${hubScrollTarget ? ` data-hub-repeater-target="${esc(cfg.hubRepeaterTargetId)}"` : ''}` : '';
  const labelAttrs = labelsOn ? ` data-show-labels="1" data-label-pos="${esc(cfg.labelPosition || 'auto')}"` : '';
  return `<g class="ud-menu" data-kind="${esc(cfg.kind)}" data-layout="${esc(cfg.layout || 'list')}" data-orientation="${esc(menuOrientation(cfg))}" data-rotate="${Number(cfg.rotateOnOpen) || 0}" data-hub-spin="${Number(cfg.hubSpin) || 0}" data-hub-fit="${cfg.hubFit ? 1 : 0}" data-keep="${cfg.keepInside === false ? 0 : 1}"${labelAttrs}${hubAttrs}${showElAttr} style="--cx:${round(cx)}px;--cy:${round(cy)}px">${centers.join('')}${levels.join('')}${hit}${back}</g>`;
}

/** Stylesheet shared by the designer canvas and exported pages (transitions of the menu). */
export const MENU_CSS = `
.ud-btn .rm-level{visibility:hidden;pointer-events:none}
.ud-btn .rm-item{transform-box:view-box;transform-origin:0 0;transform:translate(var(--cx,0px),var(--cy,0px)) scale(.2);opacity:0;cursor:pointer;transition:transform .32s cubic-bezier(.2,.9,.3,1.2),opacity .2s ease;transition-delay:0ms}
.ud-btn .rm-level.is-active{visibility:visible;pointer-events:auto}
.ud-btn .rm-level.is-active .rm-item{transform:translate(calc(var(--x) + var(--sx,0px)),calc(var(--y) + var(--sy,0px))) scale(calc(var(--fit,1) * var(--end,1)));opacity:1;transition-delay:calc(var(--i)*35ms)}
.ud-btn .rm-item:hover circle:first-of-type{stroke-opacity:1}
.ud-btn .rm-label{pointer-events:none;user-select:none}
.ud-btn .rm-center{visibility:hidden;pointer-events:none;opacity:0;transition:opacity .2s}
.ud-btn .rm-center.is-active{visibility:visible;opacity:1}
.ud-btn .rm-hit{cursor:pointer}
.ud-btn .rm-back{visibility:hidden;pointer-events:none;opacity:0;transition:opacity .2s;cursor:pointer}
.ud-btn[data-hubdepth]:not([data-hubdepth="0"]) .rm-back{visibility:visible;pointer-events:auto;opacity:1}
.ud-btn[data-hubdepth="1"] .rm-center{opacity:0}
.ud-btn[data-hubdepth] > :not(.ud-menu){opacity:0}
.dz-stage:not(.menu-live) .ud-btn:not([data-hub])[data-hubdepth="0"] > :not(.ud-menu),.dz-stage:not(.menu-live) .ud-btn:not([data-hub])[data-hubdepth="1"] > :not(.ud-menu){opacity:1}
.ud-btn .rm-item.rm-hub-item{transition:transform .35s cubic-bezier(.3,.8,.3,1),opacity .25s ease}
.ud-btn .rm-level.is-active .rm-item.rm-hub-item{transform:translate(calc(var(--x) + var(--sx,0px)),calc(var(--y) + var(--sy,0px))) scale(var(--k,1));opacity:var(--o,1);transition-delay:0ms}
.ud-btn .rm-hub-item[data-hub-pos="hidden"]{pointer-events:none}
.ud-btn[data-hub-even="1"] .rm-hit{pointer-events:none}
.ud-btn .rm-level.is-active .rm-item[data-fan-hidden="1"]{opacity:0;pointer-events:none}
.ud-btn .rm-hub-icon{transform-box:view-box;transition:transform .3s ease}
.ud-btn .rm-hub-icon{transform:rotate(var(--spin,0deg))}
.ud-btn .rm-item .rm-icon{transform-box:view-box;transform:rotate(var(--spin,0deg));transition:transform .5s cubic-bezier(.3,.8,.3,1)}
.menu-live .ud-btn .rm-back{display:none}
.ud-btn[data-open="1"] .rm-hub-icon{transform:rotate(calc(var(--rot,0deg) + var(--spin,0deg)))}
.ud-btn[data-center="1"] .rm-hub-icon{opacity:0}
.ud-btn .rm-hub-icon{transition:transform .3s ease,opacity .2s ease}
`;

/** Bounding box (in the button's own coordinates) of the button plus every level of its menu, for padded exports. */
export function menuExtent(button, cfg, tree) {
  const size = Math.min(button.width, button.height), cx = button.width / 2, cy = button.height / 2;
  let x0 = 0, y0 = 0, x1 = button.width, y1 = button.height;
  const hubG = cfg.kind === 'hub' ? hubGeometry(cfg, size) : null;
  const lsize = hubG ? hubG.big : size;
  const labelsOn = showLabelsEnabled(cfg);
  if (hubG) {
    const reach = hubBarReach(cfg, hubG, tree?.length);
    const along = Math.max(hubG.big / 2 + hubG.gap + hubG.small, reach);
    const across = Math.max(hubG.big / 2, ((Number(cfg.hubCenterSize) || 1) * hubG.big) / 2);
    const hx = hubG.vertical ? across : along, hy = hubG.vertical ? along : across;
    x0 = Math.min(x0, cx - hx); x1 = Math.max(x1, cx + hx); y0 = Math.min(y0, cy - hy); y1 = Math.max(y1, cy + hy);
    // the "back" button at the lower right (same placement as renderMenu)
    const { bx, by, r } = hubBackSpot(hubG, cx, cy);
    x1 = Math.max(x1, bx + r); y1 = Math.max(y1, by + r);
    x0 = Math.min(x0, bx - r); y0 = Math.min(y0, by - r);
    if (labelsOn && tree.length) {
      const pl = resolveMenuLabelPlacement(cfg, { isHubRoot: true, dx: 0, dy: 0 });
      for (const it of tree) {
        const lm = menuLabelMetrics(it.label || it.name, hubG.big / 2, { isHubRoot: true, pos: pl.pos, side: pl.side });
        if (!lm) continue;
        x0 = Math.min(x0, cx - (hubG.vertical ? 0 : along - hubG.small / 2) + lm.x0);
        x1 = Math.max(x1, cx + (hubG.vertical ? 0 : along - hubG.small / 2) + lm.x1);
        y0 = Math.min(y0, cy - (hubG.vertical ? along - hubG.small / 2 : 0) + lm.y0);
        y1 = Math.max(y1, cy + (hubG.vertical ? along - hubG.small / 2 : 0) + lm.y1);
      }
    }
  }
  const walk = (items, root = true) => {
    if (hubG && root) { items.forEach(i => i.children.length && walk(i.children, false)); return; }
    layoutItems(cfg, items.length, lsize).forEach((p, idx) => {
      const r = p.s / 2;
      x0 = Math.min(x0, cx + p.x - r); x1 = Math.max(x1, cx + p.x + r);
      y0 = Math.min(y0, cy + p.y - r); y1 = Math.max(y1, cy + p.y + r);
      if (labelsOn) {
        const pl = resolveMenuLabelPlacement(cfg, { isHubRoot: false, dx: p.x, dy: p.y });
        const lm = menuLabelMetrics(items[idx]?.label || items[idx]?.name, r, { isHubRoot: false, pos: pl.pos, side: pl.side });
        if (lm) {
          x0 = Math.min(x0, cx + p.x + lm.x0); x1 = Math.max(x1, cx + p.x + lm.x1);
          y0 = Math.min(y0, cy + p.y + lm.y0); y1 = Math.max(y1, cy + p.y + lm.y1);
        }
      }
    });
    items.forEach(i => i.children.length && walk(i.children, false));
  };
  if (tree.length) walk(tree);
  const pad = 4;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** Where a dropped item lands: {parentId, index} for "before" / "after" / "inside" a target row (null target = end of the top level); null when nothing would change. */
export function dropTarget(rows, it, tg, where) {
  const order = (a, b) => a.ord - b.ord || a.id - b.id;
  let parentId, index;
  if (!tg) { parentId = null; index = null; }
  else if (where === 'inside') { parentId = tg.id; index = null; }
  else {
    parentId = tg.parentId ?? null;
    const sibs = rows.filter(r => (r.parentId ?? null) === parentId && r.id !== it.id).sort(order);
    index = sibs.findIndex(r => r.id === tg.id) + (where === 'after' ? 1 : 0);
  }
  const sibsNow = rows.filter(r => (r.parentId ?? null) === parentId).sort(order);
  if ((it.parentId ?? null) === parentId && (index == null ? sibsNow[sibsNow.length - 1]?.id === it.id : sibsNow.findIndex(r => r.id === it.id) === index)) return null;
  return { parentId, index };
}
