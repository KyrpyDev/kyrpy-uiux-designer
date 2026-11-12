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

/**
 * Grid cells for screens grouped by route depth (`level`). A level with many screens (a hub that leads to 15 screens)
 * is spread over several neighbouring columns instead of one very tall one, so the whole map stays readable.
 * @param {number[]} ids screens in placement order
 * @param {Map<number, number>} level route depth of each screen
 * @param {{ maxRows?: number, cellW?: number, cellH?: number, aspect?: number }} [o] maxRows wins; otherwise it is chosen so the
 *   map comes out about `aspect` (width / height) wide for cells of cellW × cellH
 * @returns {{ cells: Map<number, { col: number, row: number }>, cols: number, rows: number, maxRows: number }}
 *   `row` may be fractional: a column with fewer screens than the tallest one is centred on it
 */
export function distributeLevels(ids, level, { maxRows = 0, cellW = 560, cellH = 1024, aspect = 1.7 } = {}) {
  const byLevel = new Map();
  for (const id of ids) { const lv = level.get(id) ?? 0; if (!byLevel.has(lv)) byLevel.set(lv, []); byLevel.get(lv).push(id); }
  const cap = maxRows > 0 ? Math.floor(maxRows) : Math.min(6, Math.max(2, Math.ceil(Math.sqrt(ids.length * cellW / (cellH * aspect)))));
  const columns = [];
  for (const lv of [...byLevel.keys()].sort((a, b) => a - b)) {
    const list = byLevel.get(lv), n = Math.ceil(list.length / cap), per = Math.ceil(list.length / n);   // even columns: 7 → 4 + 3, not 6 + 1
    for (let i = 0; i < n; i++) columns.push(list.slice(i * per, (i + 1) * per));
  }
  const rows = Math.max(0, ...columns.map(c => c.length));
  const cells = new Map();
  columns.forEach((c, col) => c.forEach((id, i) => cells.set(id, { col, row: i + (rows - c.length) / 2 })));
  return { cells, cols: columns.length, rows, maxRows: cap };
}

/**
 * The start (master) screen of a workflow: where its test begins when no screen is selected.
 *  1. the stored start screen (the screen the workflow was generated from), while it is still part of the workflow
 *  2. else an entry screen: one no link points to (the left-most, then top-most of them)
 *  3. else (every screen is reachable from another, e.g. all link back to a home hub) the left-most, top-most screen:
 *     a generated workflow lays its start screen out there
 * @param {{ startScreenId?: number|null, nodes?: Array<{ screenId, x?, y? }>, links?: Array<{ fromScreenId, toScreenId }> }} wf
 * @returns {number|null}
 */
export function workflowStartScreen(wf) {
  const nodes = wf?.nodes || [];
  if (!nodes.length) return null;
  const stored = wf.startScreenId == null ? null : Number(wf.startScreenId);
  if (stored != null && nodes.some(n => Number(n.screenId) === stored)) return stored;
  const targets = new Set((wf.links || []).filter(l => l.fromScreenId !== l.toScreenId).map(l => Number(l.toScreenId)));
  const first = list => [...list].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0))[0];
  const entries = nodes.filter(n => !targets.has(Number(n.screenId)));
  return Number(first(entries.length ? entries : nodes).screenId);
}
