/**
 * Portable click / event actions (pure). The core stores node actions with instance-local numeric ids
 * (`targetId` → a screen or element row, `targetNodeId` → a node of the same item). Outside the instance
 * (MCP JSON, content hash, cloning, sync) they are written as:
 *   target:          { type, uid, key }   instead of targetId
 *   targetNodeIndex: <index in nodes[]>   instead of targetNodeId        (content hash: the node's tree path)
 */
import { CLICK_TARGET_TYPE } from '../../domain/entities.js';

const MENU_ACTIONS = ['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu'];

/** Library type the action's targetId points at (null when the action has no row target). */
export function actionTargetType(action) {
  if (!action || typeof action !== 'object') return null;
  return CLICK_TARGET_TYPE[action.type] || (MENU_ACTIONS.includes(action.type) ? 'element' : null);
}

const list = a => (a == null ? null : a);

/**
 * @param {object|null} action  stored action (onClick or one event binding)
 * @param {(type: string, id: number) => ({uid, key}|null)} refOf
 * @param {(nodeId: number) => (number|string|null)} nodeRefOf  index (JSON) or tree path (hash)
 * @param {{nodeField?: string}} opts
 */
export function toPortableAction(action, refOf, nodeRefOf, { nodeField = 'targetNodeIndex' } = {}) {
  if (!action || typeof action !== 'object') return list(action);
  const { targetId, targetNodeId, ...rest } = action;
  const out = { ...rest };
  const t = actionTargetType(action);
  if (targetId != null) {
    const ref = t ? refOf(t, Number(targetId)) : null;
    out.target = ref ? { type: t, uid: ref.uid ?? null, key: ref.key ?? null } : { type: t, missing: true };
  }
  if (targetNodeId != null) out[nodeField] = nodeRefOf(Number(targetNodeId));
  return out;
}

/**
 * Inverse of toPortableAction for staging. Legacy numeric targetId / targetNodeId pass through unchanged.
 * @param {(target: {type, uid?, key?}, path: string) => number} idOf   resolves (and may adopt) the target row
 * @param {(index: number) => number} nodeIdOf  temporary id of node `index` in the staged list
 */
export function fromPortableAction(action, idOf, nodeIdOf, path = 'action') {
  if (!action || typeof action !== 'object') return list(action);
  const { target, targetNodeIndex, ...rest } = action;
  const out = { ...rest };
  if (target && typeof target === 'object' && (target.uid || target.key)) {
    out.targetId = idOf({ type: target.type || actionTargetType(action), uid: target.uid, key: target.key }, `${path}.target`);
  }
  if (Number.isInteger(targetNodeIndex)) out.targetNodeId = nodeIdOf(targetNodeIndex);
  return out;
}

/** Every row target of an item's node actions as [{type, uid?, key?, path}] (for dependency ordering). */
export function actionRefs(nodes = []) {
  const out = [];
  nodes.forEach((n, i) => {
    const acts = [['onClick', n?.onClick], ...(Array.isArray(n?.events) ? n.events.map((e, j) => [`events[${j}]`, e]) : [])];
    for (const [k, a] of acts) {
      if (a?.target && (a.target.uid || a.target.key)) out.push({ type: a.target.type || actionTargetType(a), uid: a.target.uid || null, key: a.target.key || null, path: `nodes[${i}].${k}.target` });
    }
  });
  return out;
}

/** Row targets of stored (numeric) actions: [{type, id}]. */
export function storedActionTargets(onClick, events) {
  const out = [];
  for (const a of [onClick, ...(Array.isArray(events) ? events : [])]) {
    const t = actionTargetType(a);
    if (t && a.targetId != null) out.push({ type: t, id: Number(a.targetId) });
  }
  return out;
}
