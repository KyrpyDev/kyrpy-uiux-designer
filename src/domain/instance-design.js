/**
 * A library button / element placed on a screen can have its own design: the user opens the placed copy in the designer
 * (✎ on the placed item) and every change there is kept on the screen's node, in this attribute, as JSON
 * { nodes, width, height, meta }. The library item is never changed and no new library item is made; its own designer
 * (opened from the library, or "Edit the library item") is the only place that changes it for every use.
 * Never written into markup.
 */
export const OWN_DESIGN_ATTR = 'data-own-design';

/** Types a placed copy can be designed on its own (icons and paths are swapped, not designed per screen). */
export const OWN_DESIGN_TYPES = new Set(['button', 'element']);

/** The placed copy's own design ({ nodes, width, height, meta }), or null when it uses the library item. */
export function ownDesignOf(node) {
  let raw = node?.attrs?.[OWN_DESIGN_ATTR];
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return null;
  const w = Number(raw.width), h = Number(raw.height);
  return { nodes: raw.nodes, width: w > 0 ? w : null, height: h > 0 ? h : null, meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {} };
}

/** The attribute value for an own design. */
export function ownDesignAttr({ nodes = [], width = null, height = null, meta = {} } = {}) {
  return JSON.stringify({ nodes, width, height, meta });
}

/** The nodes of every own design under `nodes` (for dependency walks: icons and buttons the own design places). */
export function ownDesignNodes(nodes) {
  const out = [];
  for (const n of nodes || []) if (n?.kind === 'instance') { const o = ownDesignOf(n); if (o) out.push(...o.nodes); }
  return out;
}
