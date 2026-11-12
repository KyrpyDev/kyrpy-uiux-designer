/**
 * Pure helpers of the live test's quick edit box (interfaces/web/js/components/live-quick-edit.js):
 * reading and replacing the click target of a placed item, and telling what changed between two drafts.
 */

const ELEMENT_TYPES = new Set(['popup', 'element', 'drawer', 'show-element']);

/** The click binding of a node: its `click` event, else the legacy `onClick`. */
export function clickBinding(node) {
  const ev = (Array.isArray(node?.events) ? node.events : []).find(e => e?.trigger === 'click');
  return ev || (node?.onClick ? { trigger: 'click', ...node.onClick } : null);
}

/**
 * What a click on the node opens: { screenId, elementId, other }.
 * `other` names a click action that is neither a route nor a popup (animate, toggle, back, a menu …).
 */
export function clickTargetOf(node) {
  const c = clickBinding(node);
  if (!c) return { screenId: null, elementId: null, other: '' };
  if (c.type === 'screen') return { screenId: c.targetId == null ? null : Number(c.targetId), elementId: null, other: '' };
  if (ELEMENT_TYPES.has(c.type)) return { screenId: null, elementId: c.targetId == null ? null : Number(c.targetId), other: '' };
  return { screenId: null, elementId: null, other: String(c.type || '') };
}

/**
 * The events of a node with its click action replaced: a screen to go to, an element shown as a popup, or nothing.
 * Every other trigger (mouseover, dblclick …) is kept. An existing popup-like click (drawer, show-element) keeps its
 * kind and options when only the element changes.
 */
export function withClickTarget(events, { screenId = null, elementId = null } = {}) {
  const list = Array.isArray(events) ? events : [];
  const old = list.find(e => e?.trigger === 'click');
  const rest = list.filter(e => e?.trigger !== 'click');
  if (screenId != null) return [...rest, { trigger: 'click', type: 'screen', targetId: Number(screenId) }];
  if (elementId != null) {
    const keep = old && ELEMENT_TYPES.has(old.type) ? old : { trigger: 'click', type: 'popup' };
    return [...rest, { ...keep, trigger: 'click', targetId: Number(elementId) }];
  }
  return rest;
}

/** Keys whose value differs between two flat drafts (objects are compared by JSON). */
export function changedKeys(before, after) {
  const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(k => !same(before?.[k], after?.[k]));
}

/** Screen-space place of the box: beside the anchor, kept inside the window. */
export function placeBox(anchor, size, win, gap = 10) {
  const w = size.w, hgt = size.h;
  let left = anchor.right + gap;
  if (left + w > win.w - 8) left = anchor.left - gap - w;          // no room on the right: go left of the item
  left = Math.max(8, Math.min(left, win.w - w - 8));
  const top = Math.max(8, Math.min(anchor.top - 12, win.h - hgt - 8));
  return { left: Math.round(left), top: Math.round(top) };
}
