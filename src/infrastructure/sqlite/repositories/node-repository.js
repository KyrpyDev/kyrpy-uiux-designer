import { inTransaction } from '../database.js';

export const toElement = r => r && ({
  id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, parentId: r.parent_id, ord: r.ord, kind: r.kind, tag: r.tag,
  name: r.name, role: r.role, refType: r.ref_type, refId: r.ref_id, rotation: r.rotation, visible: !!r.visible,
  locked: !!r.locked, text: r.text, attrs: JSON.parse(r.attrs), descriptionDev: r.description_dev,
  onClick: r.on_click ? JSON.parse(r.on_click) : null,
  events: r.events ? JSON.parse(r.events) : []
});

export const toAnimation = r => r && ({
  id: r.id, nodeId: r.node_id, name: r.name, type: r.type, params: JSON.parse(r.params), durationMs: r.duration_ms,
  delayMs: r.delay_ms, easing: r.easing, iterations: r.iterations === 'infinite' ? 'infinite' : Number(r.iterations),
  direction: r.direction, fillMode: r.fill_mode, trigger: r.trigger, enabled: !!r.enabled
});

const COLS = { parentId: 'parent_id', ord: 'ord', kind: 'kind', tag: 'tag', name: 'name', role: 'role', refType: 'ref_type',
  refId: 'ref_id', rotation: 'rotation', text: 'text', descriptionDev: 'description_dev' };

export class NodeRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  listByOwner(ownerType, ownerId) {
    return this.db.prepare('SELECT * FROM nodes WHERE owner_type = ? AND owner_id = ? ORDER BY ord, id').all(ownerType, ownerId).map(toElement);
  }
  listAllByType(ownerType) { return this.db.prepare('SELECT * FROM nodes WHERE owner_type = ? ORDER BY owner_id, ord, id').all(ownerType).map(toElement); }
  listByRef(refType, refId) { return this.db.prepare('SELECT * FROM nodes WHERE ref_type = ? AND ref_id = ? ORDER BY id').all(refType, Number(refId)).map(toElement); }
  /**
   * Every item the project's own designs use, directly or through other items (screen → element → button → icon → path):
   * `type:id` keys. The project's own items are the seeds; items other scopes own are what the library marks as "in use".
   */
  usedByProject(projectId) {
    const pid = Number(projectId);
    if (!pid) return [];
    return this.db.prepare(`WITH RECURSIVE used(t, i) AS (
        SELECT 'screen', id FROM screens WHERE project_id = ?1 UNION SELECT 'element', id FROM elements WHERE project_id = ?1
        UNION SELECT 'button', id FROM buttons WHERE project_id = ?1 UNION SELECT 'icon', id FROM icons WHERE project_id = ?1
        UNION SELECT 'path', id FROM paths WHERE project_id = ?1
        UNION SELECT n.ref_type, n.ref_id FROM nodes n JOIN used u ON n.owner_type = u.t AND n.owner_id = u.i
          WHERE n.ref_type IS NOT NULL AND n.ref_id IS NOT NULL)
      SELECT t, i FROM used`).all(pid).map(r => `${r.t}:${r.i}`);
  }
  get(id) { return toElement(this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)); }

  create(ownerType, ownerId, e, { id } = {}) {
    const ord = e.ord ?? this.db.prepare('SELECT COALESCE(MAX(ord),0)+1 AS o FROM nodes WHERE owner_type=? AND owner_id=? AND parent_id IS ?').get(ownerType, ownerId, e.parentId ?? null).o;
    const cols = ['owner_type', 'owner_id', 'parent_id', 'ord', 'kind', 'tag', 'name', 'role', 'ref_type', 'ref_id', 'rotation', 'visible', 'locked', 'text', 'attrs', 'description_dev', 'on_click', 'events'];
    const vals = [ownerType, ownerId, e.parentId ?? null, ord, e.kind ?? 'shape', e.tag, e.name ?? '', e.role ?? null, e.refType ?? null, e.refId ?? null,
      e.rotation ?? 0, e.visible === false ? 0 : 1, e.locked ? 1 : 0, e.text ?? '', JSON.stringify(e.attrs ?? {}), e.descriptionDev ?? '',
      e.onClick ? JSON.stringify(e.onClick) : '', JSON.stringify(Array.isArray(e.events) ? e.events : [])];
    if (id) { cols.unshift('id'); vals.unshift(id); }
    const r = this.db.prepare(`INSERT INTO nodes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('nodes', saved.id, 'upsert', saved);
    return saved;
  }

  update(id, patch) {
    const sets = [], args = [];
    for (const [k, col] of Object.entries(COLS)) if (patch[k] !== undefined) { sets.push(`${col} = ?`); args.push(patch[k]); }
    if (patch.visible !== undefined) { sets.push('visible = ?'); args.push(patch.visible ? 1 : 0); }
    if (patch.locked !== undefined) { sets.push('locked = ?'); args.push(patch.locked ? 1 : 0); }
    if (patch.attrs !== undefined) { sets.push('attrs = ?'); args.push(JSON.stringify(patch.attrs)); }
    if (patch.onClick !== undefined) { sets.push('on_click = ?'); args.push(patch.onClick ? JSON.stringify(patch.onClick) : ''); }
    if (patch.events !== undefined) { sets.push('events = ?'); args.push(JSON.stringify(Array.isArray(patch.events) ? patch.events : [])); }
    if (sets.length) this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const saved = this.get(id);
    this.sync?.enqueue('nodes', id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id).changes > 0;
    if (ok) this.sync?.enqueue('nodes', id, 'delete', { id });
    return ok;
  }

  /**
   * Makes the stored nodes of an owner equal to `list` (order = list order).
   * Entries with an existing id are updated, others inserted (explicit ids are kept so undo restores them),
   * stored nodes missing from the list are deleted. `animations` on an entry, when present, replace its animations.
   */
  replaceAll(ownerType, ownerId, list, { restoreIds = false } = {}) {
    return inTransaction(this.db, () => {
      const existing = new Set(this.listByOwner(ownerType, ownerId).map(e => e.id));
      const keep = new Set(list.filter(e => e.id && existing.has(e.id)).map(e => e.id));
      const idMap = new Map();
      // parents first so child inserts can resolve parent ids
      const byId = new Map(list.filter(e => e.id).map(e => [e.id, e]));
      const depth = e => { let d = 0, p = e; while (p && p.parentId != null && d < 20) { p = byId.get(p.parentId); d++; } return d; };
      const ordered = [...list].sort((a, b) => depth(a) - depth(b));
      for (const e of ordered) {
        const parentId = e.parentId == null ? null : (idMap.get(e.parentId) ?? e.parentId);
        const idx = list.indexOf(e);
        const data = { ...e, parentId, ord: idx };
        let saved;
        if (e.id && existing.has(e.id)) { saved = this.update(e.id, data); }
        else {
          const free = restoreIds && e.id > 0 && !this.get(e.id);
          saved = this.create(ownerType, ownerId, data, { id: free ? e.id : undefined });
        }
        idMap.set(e.id ?? saved.id, saved.id);
        if (Array.isArray(e.animations)) this.#replaceAnimations(saved.id, e.animations);
      }
      // removed nodes go last: kept children were already re-parented, so deleting e.g. a dissolved group cannot cascade onto them
      for (const id of existing) if (!keep.has(id)) this.delete(id);
      return this.listByOwner(ownerType, ownerId);
    });
  }

  #replaceAnimations(nodeId, anims) {
    this.db.prepare('DELETE FROM animations WHERE node_id = ?').run(nodeId);
    const repo = new AnimationRepository(this.db, this.sync);
    for (const a of anims) repo.create(nodeId, a);
  }
}

export class AnimationRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  listByOwner(ownerType, ownerId) {
    return this.db.prepare(`SELECT a.* FROM animations a JOIN nodes e ON e.id = a.node_id
      WHERE e.owner_type = ? AND e.owner_id = ? ORDER BY a.id`).all(ownerType, ownerId).map(toAnimation);
  }
  listAll() { return this.db.prepare('SELECT * FROM animations ORDER BY id').all().map(toAnimation); }
  listByNode(nodeId) { return this.db.prepare('SELECT * FROM animations WHERE node_id = ? ORDER BY id').all(nodeId).map(toAnimation); }
  get(id) { return toAnimation(this.db.prepare('SELECT * FROM animations WHERE id = ?').get(id)); }

  create(nodeId, a) {
    const r = this.db.prepare(`INSERT INTO animations (node_id,name,type,params,duration_ms,delay_ms,easing,iterations,direction,fill_mode,trigger,enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(nodeId, a.name ?? a.type, a.type, JSON.stringify(a.params ?? {}), a.durationMs ?? 1000,
      a.delayMs ?? 0, a.easing ?? 'ease-in-out', String(a.iterations ?? 'infinite'), a.direction ?? 'alternate', a.fillMode ?? 'both',
      a.trigger ?? 'load', a.enabled === false ? 0 : 1);
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('animations', saved.id, 'upsert', saved);
    return saved;
  }

  update(id, patch) {
    const map = { name: 'name', type: 'type', durationMs: 'duration_ms', delayMs: 'delay_ms', easing: 'easing', direction: 'direction', fillMode: 'fill_mode', trigger: 'trigger' };
    const sets = [], args = [];
    for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${col} = ?`); args.push(patch[k]); }
    if (patch.params !== undefined) { sets.push('params = ?'); args.push(JSON.stringify(patch.params)); }
    if (patch.iterations !== undefined) { sets.push('iterations = ?'); args.push(String(patch.iterations)); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
    if (sets.length) this.db.prepare(`UPDATE animations SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const saved = this.get(id);
    this.sync?.enqueue('animations', id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM animations WHERE id = ?').run(id).changes > 0;
    if (ok) this.sync?.enqueue('animations', id, 'delete', { id });
    return ok;
  }
}
