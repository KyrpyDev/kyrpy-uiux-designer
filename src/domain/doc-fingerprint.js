/**
 * Saved-state tracking (pure, isomorphic). A designer remembers the last saved version of its design (the "baseline");
 * a design is "edited" when its fingerprint differs from the baseline's. `restoreBody` turns a baseline into the payload
 * of the restore endpoint (Reset, and Save as which puts the original back).
 */
const byId = (a, b) => a.id - b.id;
const ordered = nodes => [...nodes].sort((a, b) => a.ord - b.ord || a.id - b.id);

/** Stable text that changes when anything the user can edit in a design changes (ids and raw z-order numbers excluded). */
export function designFingerprint(d) {
  if (!d) return '';
  const anims = (d.animations || []).map(a => JSON.stringify([a.nodeId, a.name, a.type, a.params, a.durationMs, a.delayMs, a.easing, a.iterations, a.direction, a.fillMode, a.trigger, a.enabled])).sort();
  return JSON.stringify({
    r: [d.name, d.key, d.label, d.descriptionDev, d.category, d.width, d.height, d.meta, d.tags || [], d.visibility || 'public', !!d.locked],
    n: ordered(d.nodes || []).map(n => [n.id, n.parentId ?? null, n.tag, n.kind, n.name, n.role, n.refType, n.refId, n.rotation, !!n.visible, !!n.locked, n.text, n.attrs, n.descriptionDev, n.onClick ?? null, n.events || []]),
    a: anims,
    m: [...(d.menuItems || [])].sort(byId).map(m => [m.id, m.parentId ?? null, m.ord, m.name, m.label, m.iconId, m.action, m.targetScreenId, m.descriptionDev])
  });
}

export function workflowFingerprint(w) {
  if (!w) return '';
  return JSON.stringify({
    r: [w.name, w.key, w.label, w.descriptionDev, w.visibility || 'public', !!w.locked],
    n: [...(w.nodes || [])].sort((a, b) => a.screenId - b.screenId).map(n => [n.screenId, n.x, n.y, !!n.collapsed, !!n.locked]),
    l: [...(w.links || [])].sort(byId).map(l => [l.fromScreenId, l.fromNodeId ?? null, l.toScreenId, l.name, l.descriptionDev, l.style, l.trigger])
  });
}

const clone = o => JSON.parse(JSON.stringify(o));

/** Payload for POST /api/<type>/:id/restore built from a saved version of a design. */
export function restoreBody(base) {
  const anim = id => (base.animations || []).filter(a => a.nodeId === id).map(({ id: _i, nodeId, ...a }) => a);
  return clone({
    record: {
      name: base.name, key: base.key, label: base.label, descriptionDev: base.descriptionDev,
      category: base.category, tags: base.tags, width: base.width, height: base.height, meta: base.meta,
      visibility: base.visibility || 'public', locked: !!base.locked, projectId: base.projectId ?? 1
    },
    nodes: (base.nodes || []).map(n => ({ ...n, animations: anim(n.id) })),
    menuItems: base.menuItems || []
  });
}

/** Payload for POST /api/workflows/:id/restore. */
export function workflowRestoreBody(base) {
  return clone({
    record: { name: base.name, key: base.key, label: base.label, descriptionDev: base.descriptionDev, visibility: base.visibility || 'public', locked: !!base.locked, projectId: base.projectId ?? 1 },
    nodes: base.nodes || [],
    links: base.links || []
  });
}
