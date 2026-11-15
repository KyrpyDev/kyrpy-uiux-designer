/**
 * A library button / element placed on a screen can show its own icon and label: the screen's node keeps them in
 * these attributes and the renderer swaps them into the library item's nodes for that placed copy only.
 * The library item is never changed. Never written into markup.
 */
import { BUTTON_STYLES, applyButtonStyleAndIconSizeToNodes, normalizeButtonIconSizePct } from './entities.js';

export const INSTANCE_ICON_ATTR = 'data-inst-icon';    // icon id drawn instead of the library item's first icon
export const INSTANCE_LABEL_ATTR = 'data-inst-label';  // text drawn instead of the library item's first text
export const INSTANCE_STYLE_ATTR = 'data-inst-style';  // button style key (BUTTON_STYLES) of a placed button

/** Types whose placed copies can take their own icon / label. */
export const INSTANCE_CONTENT_TYPES = new Set(['button', 'element']);

const byOrd = (a, b) => (a.ord ?? 0) - (b.ord ?? 0) || (a.id ?? 0) - (b.id ?? 0);
const firstOf = (nodes, test) => {
  const list = (nodes || []).filter(test).sort(byOrd);
  return list.find(n => n.parentId == null) || list[0] || null;
};

/** The library item's icon node (its first placed icon, top level first), or null. */
export const iconNodeOf = nodes => firstOf(nodes, n => n.kind === 'instance' && n.refType === 'icon');
/** The library item's label node (its first text, top level first), or null. */
export const labelNodeOf = nodes => firstOf(nodes, n => n.tag === 'text');

/** The placed node's own icon id / label text (null when it follows the library item). */
export function instanceIconId(node) {
  const v = Number(node?.attrs?.[INSTANCE_ICON_ATTR]);
  return Number.isInteger(v) && v > 0 ? v : null;
}
export function instanceLabel(node) {
  const v = node?.attrs?.[INSTANCE_LABEL_ATTR];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

export function instanceStyle(node) {
  const v = node?.attrs?.[INSTANCE_STYLE_ATTR];
  return BUTTON_STYLES.some(b => b.key === v) ? v : null;
}

/** The button style of a library button: its saved meta.buttonStyle, else the style closest to its surface shape. */
export function buttonStyleOf(item) {
  if (item?.meta?.buttonStyle) return item.meta.buttonStyle;
  const nodes = item?.nodes || [], minDim = Math.min(item?.width, item?.height) || 64;
  const surface = nodes.find(n => n.role === 'button' || n.name === 'surface');
  const rx = Number(surface?.attrs?.rx) || (surface?.tag === 'circle' ? minDim / 2 : 0);
  if (surface?.attrs?.fill === 'none') return 'outline';
  return [...BUTTON_STYLES].sort((a, b) => Math.abs(a.rxRatio * minDim - rx) - Math.abs(b.rxRatio * minDim - rx))[0]?.key || 'circle';
}

/**
 * The library item's nodes with the placed node's own button style, icon and label applied
 * (the same array when it has none). `item` is the library item (its size drives the button style).
 */
export function applyInstanceContent(nodes, node, item = null) {
  const style = node?.refType !== 'icon' && item ? instanceStyle(node) : null;
  const icon = instanceIconId(node), label = instanceLabel(node);
  if (style == null && icon == null && label == null) return nodes;
  let out = nodes;
  if (style != null) {
    const w = Number(item.width) || 64, h = Number(item.height) || 64, ic = iconNodeOf(nodes);
    const pct = ic ? normalizeButtonIconSizePct(100 * (Number(ic.attrs?.width) || Math.min(w, h)) / Math.min(w, h)) : undefined;
    out = applyButtonStyleAndIconSizeToNodes(nodes, { width: w, height: h, buttonStyle: style, buttonIconSizePct: pct });
  }
  const iconNode = icon != null ? iconNodeOf(out) : null, labelNode = label != null ? labelNodeOf(out) : null;
  if (!iconNode && !labelNode) return out;
  return out.map(n => (n === iconNode ? { ...n, refId: icon } : n === labelNode ? { ...n, text: label } : n));
}
