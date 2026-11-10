/**
 * Routes of a screen: every way its design leads to another screen.
 *
 * A route comes from
 *   - a node whose click action / event binding is { type: 'screen', targetId }
 *   - a menu item (popup / rotating / hub menu of a button) with a targetScreenId
 * found on the screen itself or, transitively, inside what the screen shows: the buttons and elements placed on it,
 * the elements its actions and menu items open (popup, drawer, toolbar, show-element) and the buttons menu items show.
 *
 * Pure: the caller supplies `nodesOf(type, id)` (nodes of a design) and `menuOf(buttonId)` (menu items of a button).
 */
const ELEMENT_ACTIONS = new Set(['popup', 'drawer', 'element', 'show-element', 'toolbar']);
const MENU_ACTIONS = new Set(['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu']);
const NESTED = new Set(['button', 'element']);

/**
 * @returns {Array<{ toScreenId: number, fromNodeId: number|null, name: string, trigger: string }>} de-duplicated, in
 *   design order. `fromNodeId` is the node of the screen itself the route starts from (the placed button / element).
 */
export function collectScreenRoutes(screenId, { nodesOf, menuOf }) {
  const sid = Number(screenId), out = [], seen = new Set();
  const add = (toScreenId, fromNodeId, name, trigger) => {
    const to = Number(toScreenId);
    if (!Number.isInteger(to) || to <= 0 || to === sid) return;
    const k = `${to}|${fromNodeId ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ toScreenId: to, fromNodeId: fromNodeId ?? null, name: String(name || '').trim(), trigger: trigger === 'click' || !trigger ? 'tap' : String(trigger) });
  };
  // `origin` = the screen's own node a nested design hangs under; `path` guards against designs that contain each other
  const walk = (type, id, origin, path) => {
    const key = `${type}:${id}`;
    if (path.has(key) || path.size > 24) return;
    const inner = new Set(path).add(key);
    for (const n of nodesOf(type, id) || []) {
      const from = origin ?? (type === 'screen' ? n.id : null);
      const label = n.text || n.name || '';
      for (const a of [n.onClick ? { trigger: 'click', ...n.onClick } : null, ...(n.events || [])]) {
        if (!a) continue;
        if (a.type === 'screen') add(a.targetId, from, label, a.trigger);
        else if (ELEMENT_ACTIONS.has(a.type) && a.targetId) walk('element', Number(a.targetId), from, inner);
        else if (MENU_ACTIONS.has(a.type) && a.targetId) walk('button', Number(a.targetId), from, inner);
      }
      if (n.kind === 'instance' && NESTED.has(n.refType) && n.refId != null) walk(n.refType, Number(n.refId), from, inner);
    }
    if (type === 'button') {
      for (const m of menuOf(id) || []) {
        if (m.targetScreenId != null) add(m.targetScreenId, origin, m.label || m.name, 'tap');
        if (m.targetElementId != null) walk('element', Number(m.targetElementId), origin, inner);
        if (m.refButtonId != null) walk('button', Number(m.refButtonId), origin, inner);
      }
    }
  };
  walk('screen', sid, null, new Set());
  return out;
}

/**
 * Follows the routes screen after screen (breadth first) from `startId`.
 * @returns {{ order: number[], level: Map<number, number>, routes: Array<{ fromScreenId, toScreenId, fromNodeId, name, trigger }> }}
 *   `order` = the screens reached (start first), `level` = how many routes away from the start each one is.
 */
export function crawlScreenRoutes(startId, routesOf, { exists = () => true, max = 500 } = {}) {
  const start = Number(startId), order = [start], level = new Map([[start, 0]]), routes = [];
  for (let i = 0; i < order.length; i++) {
    const from = order[i];
    for (const r of routesOf(from) || []) {
      if (!level.has(r.toScreenId)) {
        if (!exists(r.toScreenId) || order.length >= max) continue;
        level.set(r.toScreenId, level.get(from) + 1);
        order.push(r.toScreenId);
      }
      routes.push({ fromScreenId: from, ...r });
    }
  }
  return { order, level, routes };
}
