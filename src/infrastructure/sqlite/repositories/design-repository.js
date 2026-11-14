import { sqlSearch } from '../../../domain/search.js';
import { inTransaction } from '../database.js';
import { defaultOwnerId } from '../../../domain/system-users.js';
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
const OWNER_TABLES = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens' };

export class DesignRepository {
  constructor(db, ownerType, sync = null) {
    this.db = db; this.ownerType = ownerType; this.table = TYPES[ownerType]?.plural; this.sync = sync;
    if (!this.table) throw new Error('unknown owner type ' + ownerType);
  }

  /**
   * Rows matching the library filter, in display order. Besides the scope filters:
   * `terms` (every term must occur in key, name, label or tags), `pack` ('builtin' = icons without a pack, or a
   * pack name) and `limit` / `offset` run in SQL, so a page of a large library does not load the whole table.
   */
  list(filter = {}) {
    const { where, args } = this.#where(filter);
    let sql = `SELECT * FROM ${this.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY position, name`;
    if (filter.limit != null) { sql += ' LIMIT ? OFFSET ?'; args.push(Math.max(0, Number(filter.limit) || 0), Math.max(0, Number(filter.offset) || 0)); }
    return this.db.prepare(sql).all(...args).map(toDesign);
  }

  /** How many rows `list(filter)` returns without `limit` / `offset`. */
  countMatching(filter = {}) {
    const { where, args } = this.#where(filter);
    return this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args).n;
  }

  #where({ q = '', category = '', projectId = null, projectIds = null, visibility = '', creatorId = null, actorId = null, includePublic = true, includePrivate = true, terms = null, pack = '' } = {}) {
    const where = [], args = [];
    for (const t of Array.isArray(terms) ? terms : []) {
      const term = String(t || '').toLowerCase();
      if (!term) continue;
      const m = sqlSearch(term, ['key', 'name', 'label', 'tags', 'description_dev']);
      if (m.sql) { where.push(m.sql); args.push(...m.args); }
    }
    const p = String(pack || '').toLowerCase();
    if (p) {
      const expr = `LOWER(COALESCE(NULLIF(CASE WHEN json_valid(meta) THEN json_extract(meta, '$.pack') END, ''), CASE WHEN category LIKE 'pack-%' THEN substr(category, 6) ELSE '' END))`;
      if (p === 'builtin') where.push(`${expr} = ''`);
      else { where.push(`${expr} = ?`); args.push(p); }
    }
    const pIds = Array.isArray(projectIds) && projectIds.length
      ? projectIds.map(Number).filter(n => n > 0)
      : typeof projectIds === 'string' && projectIds.trim()
        ? projectIds.split(',').map(Number).filter(n => n > 0)
        : projectId != null && projectId !== ''
          ? [Number(projectId)]
          : [];
    // whose private items may be listed: always the actor's; `creatorId` only stands in when no actor is known (internal callers)
    const effUserId = actorId != null && actorId !== ''
      ? Number(actorId)
      : (creatorId != null && creatorId !== '' ? Number(creatorId) : null);
    // every word of the query in the label, name, variable name (dashed parts too), tags or description-dev
    if (q) { const m = sqlSearch(q, ['key', 'name', 'label', 'tags', 'description_dev', 'category']); if (m.sql) { where.push(m.sql); args.push(...m.args); } }
    if (category) { where.push('category = ?'); args.push(category); }
    const vis = visibility === 'all' ? '' : visibility;
    if (vis === 'mine' && effUserId) {
      // "All Projects": the user's own private items plus the project-only items of every project they own or belong to
      where.push(`((visibility = 'private' AND creator_id = ?) OR (visibility = 'project' AND project_id IN (
        SELECT id FROM projects WHERE owner_id = ? UNION SELECT project_id FROM project_members WHERE user_id = ? AND status = 'accepted')))`);
      args.push(effUserId, effUserId, effUserId);
    } else if (vis === 'mine') {
      where.push(`visibility IN ('private', 'project')`);
    } else if (vis) {
      where.push('visibility = ?'); args.push(vis);
      if (vis === 'project' && pIds.length) {
        where.push(`project_id IN (${pIds.map(() => '?').join(',')})`);
        args.push(...pIds);
      } else if (vis === 'private' && effUserId) {
        where.push('creator_id = ?');
        args.push(effUserId);
      }
    } else if (pIds.length) {
      const ph = pIds.map(() => '?').join(',');
      const clauses = [`(visibility = 'project' AND project_id IN (${ph}))`];
      args.push(...pIds);
      if (includePublic !== false) {
        clauses.push(`visibility = 'public'`);
      }
      if (includePrivate !== false) {
        if (effUserId) {
          clauses.push(`(visibility = 'private' AND creator_id = ?)`);
          args.push(effUserId);
        } else {
          clauses.push(`visibility = 'private'`);
        }
      }
      where.push(`(${clauses.join(' OR ')})`);
    } else if (actorId != null && actorId !== '' && (creatorId == null || creatorId === '')) {
      where.push(`(visibility != 'private' OR creator_id = ?)`);
      args.push(Number(actorId));
    }
    if (creatorId != null && creatorId !== '' && vis !== 'private' && vis !== 'mine') {
      where.push('creator_id = ?');
      args.push(Number(creatorId));
    }
    return { where, args };
  }

  /** Rows for the given ids (unknown ids are skipped), in id order. */
  getMany(ids) {
    const out = [];
    const list = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      out.push(...this.db.prepare(`SELECT * FROM ${this.table} WHERE id IN (${chunk.map(() => '?').join(',')}) ORDER BY id`).all(...chunk).map(toDesign));
    }
    return out;
  }

  /** Instance counts of every item of this type in one query: Map id -> count (items without instances are absent). */
  usageCounts() {
    const out = new Map();
    if (this.ownerType === 'screen') return out;
    for (const r of this.db.prepare('SELECT ref_id AS id, COUNT(*) AS n FROM nodes WHERE ref_type = ? GROUP BY ref_id').all(this.ownerType)) out.set(Number(r.id), Number(r.n));
    return out;
  }

  get(id) { return toDesign(this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id)); }
  /** Keys are unique per project: prefer the given project, then the public library, then the oldest row. */
  getByKey(key, projectId = null) { return toDesign(this.db.prepare(`SELECT * FROM ${this.table} WHERE key = ? ORDER BY (project_id = ?) DESC, (visibility = 'public') DESC, id LIMIT 1`).get(key, projectId == null ? -1 : Number(projectId))); }
  /** With projectId: is the key taken in that project? Without: anywhere. */
  keyExists(key, projectId = null) {
    return projectId == null ? !!this.db.prepare(`SELECT 1 FROM ${this.table} WHERE key = ?`).get(key)
      : !!this.db.prepare(`SELECT 1 FROM ${this.table} WHERE key = ? AND project_id = ?`).get(key, Number(projectId));
  }
  categories() { return this.db.prepare(`SELECT category, COUNT(*) AS n FROM ${this.table} GROUP BY category ORDER BY category`).all(); }
  count() { return this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table}`).get().n; }

  /** Stable uid (MCP identity) of a row, or null when the table has no such column. */
  uidOf(id) {
    try { return this.db.prepare(`SELECT uid FROM ${this.table} WHERE id = ?`).get(Number(id))?.uid ?? null; } catch { return null; }
  }
  /** Gives a restored row its former uid back, when it is still free. */
  restoreUid(id, uid) {
    if (!uid) return false;
    try { return this.db.prepare(`UPDATE ${this.table} SET uid = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ${this.table} WHERE uid = ?)`).run(uid, Number(id), uid).changes > 0; }
    catch { return false; }   // table without a uid column
  }
  /** Ids of a project's rows; `projectOnly` leaves out the ones published to everyone. */
  idsOfProject(projectId, { projectOnly = false } = {}) {
    return this.db.prepare(`SELECT id FROM ${this.table} WHERE project_id = ?${projectOnly ? " AND visibility = 'project'" : ''}`).all(Number(projectId)).map(r => r.id);
  }
  /** How many public rows of a project belong to `creatorId`. */
  countPublicOf(projectId, creatorId) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table} WHERE project_id = ? AND creator_id = ? AND visibility = 'public'`).get(Number(projectId), Number(creatorId)).n;
  }
  /** Sets the visibility of every row of a project. Returns the number of rows. */
  setProjectVisibility(projectId, visibility) {
    return Number(this.db.prepare(`UPDATE ${this.table} SET visibility = ?, updated_at = datetime('now') WHERE project_id = ?`).run(visibility, Number(projectId)).changes || 0);
  }

  create(d, { id: explicitId } = {}) {
    const pos = d.position ?? (this.db.prepare(`SELECT COALESCE(MAX(position),0)+1 AS p FROM ${this.table}`).get().p);
    const creatorId = d.creatorId ?? defaultOwnerId(this.db);
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

  /** Every row's id, position and project in display order (position, name); no joins, no parsing. */
  positions() {
    return this.db.prepare(`SELECT id, position, project_id AS projectId FROM ${this.table} ORDER BY position, name`).all();
  }

  /** Display order only: no updated_at bump (an order change is not a content edit); still synced. */
  setPosition(id, position) {
    this.db.prepare(`UPDATE ${this.table} SET position = ? WHERE id = ?`).run(Number(position), id);
    this.sync?.enqueue(this.table, id, 'upsert', this.get(id));
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

  /** Items cloned from `id`, directly or as their root item. */
  clonesOf(id) {
    return this.db.prepare(`SELECT * FROM ${this.table} WHERE id != ? AND (cloned_from_id = ? OR root_item_id = ?) ORDER BY id`).all(id, id, id).map(toDesign);
  }

  touch(id) {
    this.db.prepare(`UPDATE ${this.table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
    this.sync?.enqueue(this.table, id, 'touch', { id });
  }

  /** Deletes the record, its nodes (animations cascade) and instances pointing at it. */
  delete(id) {
    return inTransaction(this.db, () => {
      this.db.prepare('DELETE FROM nodes WHERE owner_type = ? AND owner_id = ?').run(this.ownerType, id);
      if (this.ownerType !== 'screen') {
        // designs that used this item lose the instance: mark them changed so clients and the sync see it
        const users = this.db.prepare('SELECT DISTINCT owner_type, owner_id FROM nodes WHERE ref_type = ? AND ref_id = ?').all(this.ownerType, id);
        this.db.prepare('DELETE FROM nodes WHERE ref_type = ? AND ref_id = ?').run(this.ownerType, id);
        for (const u of users) {
          const table = OWNER_TABLES[u.owner_type];
          if (!table) continue;
          this.db.prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(u.owner_id);
          this.sync?.enqueue(table, u.owner_id, 'touch', { id: u.owner_id });
        }
      }
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
