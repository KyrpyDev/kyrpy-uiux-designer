import { inTransaction } from '../database.js';
import { TYPES } from '../../../domain/entities.js';

const toDesign = r => r && ({
  id: r.id, key: r.key, name: r.name, label: r.label, descriptionDev: r.description_dev, category: r.category,
  tags: JSON.parse(r.tags), width: r.width, height: r.height, meta: JSON.parse(r.meta), builtin: !!r.builtin,
  position: r.position,
  projectId: r.project_id ?? 1,
  visibility: r.visibility || 'public',
  creatorId: r.creator_id ?? 1,
  clonedFromId: r.cloned_from_id ?? null,
  rootItemId: r.root_item_id ?? r.id,
  rootOwnerId: r.root_owner_id ?? r.creator_id ?? 1,
  locked: !!r.locked,
  createdAt: r.created_at, updatedAt: r.updated_at
});

/** Persistence of paths, icons, buttons, elements or screens (one table each, same shape). */
export class DesignRepository {
  constructor(db, ownerType, sync = null) {
    this.db = db; this.ownerType = ownerType; this.table = TYPES[ownerType]?.plural; this.sync = sync;
    if (!this.table) throw new Error('unknown owner type ' + ownerType);
  }

  list({ q = '', category = '', projectId = null, projectIds = null, visibility = '', creatorId = null, includePublic = true } = {}) {
    const where = [], args = [];
    const pIds = Array.isArray(projectIds) && projectIds.length
      ? projectIds.map(Number).filter(n => n > 0)
      : typeof projectIds === 'string' && projectIds.trim()
        ? projectIds.split(',').map(Number).filter(n => n > 0)
        : projectId != null && projectId !== ''
          ? [Number(projectId)]
          : [];
    if (q) { where.push('(key LIKE ? OR name LIKE ? OR label LIKE ? OR tags LIKE ? OR description_dev LIKE ?)'); const l = `%${q}%`; args.push(l, l, l, l, l); }
    if (category) { where.push('category = ?'); args.push(category); }
    if (visibility) {
      where.push('visibility = ?'); args.push(visibility);
      if (visibility === 'project' && pIds.length) {
        where.push(`project_id IN (${pIds.map(() => '?').join(',')})`);
        args.push(...pIds);
      }
    } else if (pIds.length) {
      const ph = pIds.map(() => '?').join(',');
      if (includePublic !== false) { where.push(`(visibility = 'public' OR project_id IN (${ph}))`); args.push(...pIds); }
      else { where.push(`project_id IN (${ph})`); args.push(...pIds); }
    }
    if (creatorId != null && creatorId !== '') { where.push('creator_id = ?'); args.push(Number(creatorId)); }
    const sql = `SELECT * FROM ${this.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY position, name`;
    return this.db.prepare(sql).all(...args).map(toDesign);
  }

  get(id) { return toDesign(this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id)); }
  getByKey(key) { return toDesign(this.db.prepare(`SELECT * FROM ${this.table} WHERE key = ?`).get(key)); }
  keyExists(key) { return !!this.db.prepare(`SELECT 1 FROM ${this.table} WHERE key = ?`).get(key); }
  categories() { return this.db.prepare(`SELECT category, COUNT(*) AS n FROM ${this.table} GROUP BY category ORDER BY category`).all(); }
  count() { return this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table}`).get().n; }

  create(d, { id: explicitId } = {}) {
    const pos = d.position ?? (this.db.prepare(`SELECT COALESCE(MAX(position),0)+1 AS p FROM ${this.table}`).get().p);
    const creatorId = d.creatorId ?? 1;
    const rootOwnerId = d.rootOwnerId ?? creatorId;
    const useId = explicitId && !this.get(explicitId) ? Number(explicitId) : null;
    const cols = ['key','name','label','description_dev','category','tags','width','height','meta','builtin','position','project_id','visibility','creator_id','cloned_from_id','root_item_id','root_owner_id','locked'];
    const vals = [
      d.key, d.name, d.label ?? '', d.descriptionDev ?? '', d.category ?? 'general', JSON.stringify(d.tags ?? []),
      d.width, d.height, JSON.stringify(d.meta ?? {}), d.builtin ? 1 : 0, pos,
      d.projectId ?? 1, d.visibility ?? 'public', creatorId, d.clonedFromId ?? null, d.rootItemId ?? null, rootOwnerId, d.locked ? 1 : 0
    ];
    if (useId) { cols.unshift('id'); vals.unshift(useId); }
    const r = this.db.prepare(`INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const id = useId || Number(r.lastInsertRowid);
    if (d.rootItemId == null) {
      this.db.prepare(`UPDATE ${this.table} SET root_item_id = ? WHERE id = ?`).run(id, id);
    }
    const rec = this.get(id);
    this.sync?.enqueue(this.table, id, 'upsert', rec);
    return rec;
  }

  update(id, patch) {
    const map = { key: 'key', name: 'name', label: 'label', descriptionDev: 'description_dev', category: 'category',
      width: 'width', height: 'height', position: 'position', projectId: 'project_id', visibility: 'visibility',
      creatorId: 'creator_id', clonedFromId: 'cloned_from_id', rootItemId: 'root_item_id', rootOwnerId: 'root_owner_id' };
    const sets = [], args = [];
    for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${col} = ?`); args.push(patch[k]); }
    if (patch.locked !== undefined) { sets.push('locked = ?'); args.push(patch.locked ? 1 : 0); }
    if (patch.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(patch.tags)); }
    if (patch.meta !== undefined) { sets.push('meta = ?'); args.push(JSON.stringify(patch.meta)); }
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`);
      this.db.prepare(`UPDATE ${this.table} SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    }
    const rec = this.get(id);
    this.sync?.enqueue(this.table, id, 'upsert', rec);
    return rec;
  }

  touch(id) {
    this.db.prepare(`UPDATE ${this.table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
    this.sync?.enqueue(this.table, id, 'touch', { id });
  }

  /** Deletes the record, its nodes (animations cascade) and instances pointing at it. */
  delete(id) {
    return inTransaction(this.db, () => {
      this.db.prepare('DELETE FROM nodes WHERE owner_type = ? AND owner_id = ?').run(this.ownerType, id);
      if (this.ownerType !== 'screen') this.db.prepare('DELETE FROM nodes WHERE ref_type = ? AND ref_id = ?').run(this.ownerType, id);
      const ok = this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id).changes > 0;
      if (ok) this.sync?.enqueue(this.table, id, 'delete', { id });
      return ok;
    });
  }

  /** How many nodes instantiate this icon/item. */
  usageCount(id) {
    if (this.ownerType === 'screen') return 0;
    return this.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE ref_type = ? AND ref_id = ?').get(this.ownerType, id).n;
  }
}
