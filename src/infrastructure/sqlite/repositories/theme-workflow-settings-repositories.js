import { inTransaction } from '../database.js';

const toTheme = r => r && ({ id: r.id, key: r.key, name: r.name, kind: r.kind, tokens: JSON.parse(r.tokens), surfaces: JSON.parse(r.surfaces), builtin: !!r.builtin, position: r.position });

export class ThemeRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }
  list() { return this.db.prepare('SELECT * FROM themes ORDER BY position, id').all().map(toTheme); }
  get(id) { return toTheme(this.db.prepare('SELECT * FROM themes WHERE id = ?').get(id)); }
  getByKey(key) { return toTheme(this.db.prepare('SELECT * FROM themes WHERE key = ?').get(key)); }
  create(t) {
    const pos = this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM themes').get().p;
    const r = this.db.prepare('INSERT INTO themes (key,name,kind,tokens,surfaces,builtin,position) VALUES (?,?,?,?,?,?,?)')
      .run(t.key, t.name, t.kind, JSON.stringify(t.tokens), JSON.stringify(t.surfaces ?? {}), t.builtin ? 1 : 0, pos);
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('themes', saved.id, 'upsert', saved);
    return saved;
  }
  update(id, patch) {
    const sets = [], args = [];
    for (const k of ['key', 'name', 'kind']) if (patch[k] !== undefined) { sets.push(`${k} = ?`); args.push(patch[k]); }
    if (patch.tokens !== undefined) { sets.push('tokens = ?'); args.push(JSON.stringify(patch.tokens)); }
    if (patch.surfaces !== undefined) { sets.push('surfaces = ?'); args.push(JSON.stringify(patch.surfaces)); }
    if (sets.length) this.db.prepare(`UPDATE themes SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const saved = this.get(id);
    this.sync?.enqueue('themes', id, 'upsert', saved);
    return saved;
  }
  delete(id) {
    const ok = this.db.prepare('DELETE FROM themes WHERE id = ?').run(id).changes > 0;
    if (ok) this.sync?.enqueue('themes', id, 'delete', { id });
    return ok;
  }
}

const toWorkflow = r => r && ({
  id: r.id, key: r.key, name: r.name, label: r.label, descriptionDev: r.description_dev,
  projectId: r.project_id ?? 1, visibility: r.visibility || 'public', creatorId: r.creator_id ?? 1,
  clonedFromId: r.cloned_from_id ?? null, rootItemId: r.root_item_id ?? r.id, rootOwnerId: r.root_owner_id ?? r.creator_id ?? 1,
  locked: !!r.locked, createdAt: r.created_at, updatedAt: r.updated_at
});
const toNode = r => ({ workflowId: r.workflow_id, screenId: r.screen_id, x: r.x, y: r.y, collapsed: !!r.collapsed, locked: !!r.locked });
const toLink = r => r && ({ id: r.id, workflowId: r.workflow_id, fromScreenId: r.from_screen_id, fromNodeId: r.from_node_id, toScreenId: r.to_screen_id,
  name: r.name, descriptionDev: r.description_dev, style: r.style, trigger: r.trigger });

export class WorkflowRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }
  list({ q = '', projectId = null, projectIds = null, visibility = '', creatorId = null, actorId = null, includePublic = true, includePrivate = true } = {}) {
    const where = [], args = [];
    const pIds = Array.isArray(projectIds) && projectIds.length
      ? projectIds.map(Number).filter(n => n > 0)
      : typeof projectIds === 'string' && projectIds.trim()
        ? projectIds.split(',').map(Number).filter(n => n > 0)
        : projectId != null && projectId !== ''
          ? [Number(projectId)]
          : [];
    const effUserId = creatorId != null && creatorId !== ''
      ? Number(creatorId)
      : (actorId != null && actorId !== '' ? Number(actorId) : null);
    if (q) { where.push('(w.key LIKE ? OR w.name LIKE ? OR w.label LIKE ? OR w.description_dev LIKE ?)'); const l = `%${q}%`; args.push(l, l, l, l); }
    const vis = visibility === 'all' ? '' : visibility;
    if (vis) {
      where.push('w.visibility = ?'); args.push(vis);
      if (vis === 'project' && pIds.length) {
        where.push(`w.project_id IN (${pIds.map(() => '?').join(',')})`);
        args.push(...pIds);
      } else if (vis === 'private' && effUserId) {
        where.push('w.creator_id = ?');
        args.push(effUserId);
      }
    } else if (pIds.length) {
      const ph = pIds.map(() => '?').join(',');
      const clauses = [`(w.visibility = 'project' AND w.project_id IN (${ph}))`];
      args.push(...pIds);
      if (includePublic !== false) {
        clauses.push(`w.visibility = 'public'`);
      }
      if (includePrivate !== false) {
        if (effUserId) {
          clauses.push(`(w.visibility = 'private' AND w.creator_id = ?)`);
          args.push(effUserId);
        } else {
          clauses.push(`w.visibility = 'private'`);
        }
      }
      where.push(`(${clauses.join(' OR ')})`);
    } else if (actorId != null && actorId !== '' && (creatorId == null || creatorId === '')) {
      where.push(`(w.visibility != 'private' OR w.creator_id = ?)`);
      args.push(Number(actorId));
    }
    if (creatorId != null && creatorId !== '' && vis !== 'private') {
      where.push('w.creator_id = ?');
      args.push(Number(creatorId));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.prepare(`SELECT w.*, (SELECT COUNT(*) FROM workflow_screens s WHERE s.workflow_id = w.id) AS screen_count,
      (SELECT COUNT(*) FROM workflow_links l WHERE l.workflow_id = w.id) AS link_count FROM workflows w ${whereSql} ORDER BY w.name`).all(...args)
      .map(r => ({ ...toWorkflow(r), screenCount: r.screen_count, linkCount: r.link_count }));
  }
  get(id) { return toWorkflow(this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id)); }
  getByKey(key) { return toWorkflow(this.db.prepare('SELECT * FROM workflows WHERE key = ?').get(key)); }
  keyExists(key) { return !!this.db.prepare('SELECT 1 FROM workflows WHERE key = ?').get(key); }
  create(w, { id: explicitId } = {}) {
    const creatorId = w.creatorId ?? 1;
    const rootOwnerId = w.rootOwnerId ?? creatorId;
    const useId = explicitId && !this.get(explicitId) ? Number(explicitId) : null;
    const cols = ['key','name','label','description_dev','project_id','visibility','creator_id','cloned_from_id','root_item_id','root_owner_id','locked'];
    const vals = [
      w.key, w.name, w.label ?? '', w.descriptionDev ?? '', w.projectId ?? 1, w.visibility ?? 'public',
      creatorId, w.clonedFromId ?? null, w.rootItemId ?? null, rootOwnerId, w.locked ? 1 : 0
    ];
    if (useId) { cols.unshift('id'); vals.unshift(useId); }
    const r = this.db.prepare(`INSERT INTO workflows (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const id = useId || Number(r.lastInsertRowid);
    if (w.rootItemId == null) {
      this.db.prepare('UPDATE workflows SET root_item_id = ? WHERE id = ?').run(id, id);
    }
    const saved = this.get(id);
    this.sync?.enqueue('workflows', id, 'upsert', saved);
    return saved;
  }
  update(id, patch) {
    const map = { key: 'key', name: 'name', label: 'label', descriptionDev: 'description_dev',
      projectId: 'project_id', visibility: 'visibility', creatorId: 'creator_id', clonedFromId: 'cloned_from_id',
      rootItemId: 'root_item_id', rootOwnerId: 'root_owner_id' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.locked !== undefined) { sets.push('locked = ?'); args.push(patch.locked ? 1 : 0); }
    if (sets.length) { sets.push(`updated_at = datetime('now')`); this.db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...args, id); }
    const saved = this.get(id);
    this.sync?.enqueue('workflows', id, 'upsert', saved);
    return saved;
  }
  delete(id) {
    const ok = this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes > 0;
    if (ok) this.sync?.enqueue('workflows', id, 'delete', { id });
    return ok;
  }

  /** Removes the screens and links of a workflow (the workflow record stays). */
  clearContent(workflowId) {
    this.db.prepare('DELETE FROM workflow_links WHERE workflow_id = ?').run(workflowId);
    this.db.prepare('DELETE FROM workflow_screens WHERE workflow_id = ?').run(workflowId);
  }

  nodes(workflowId) { return this.db.prepare('SELECT * FROM workflow_screens WHERE workflow_id = ?').all(workflowId).map(toNode); }
  nodesForScreen(screenId) { return this.db.prepare('SELECT * FROM workflow_screens WHERE screen_id = ?').all(Number(screenId)).map(toNode); }
  linksInvolvingScreen(screenId) { return this.db.prepare('SELECT * FROM workflow_links WHERE from_screen_id = ? OR to_screen_id = ? ORDER BY id').all(Number(screenId), Number(screenId)).map(toLink); }
  upsertNode(n) {
    this.db.prepare(`INSERT INTO workflow_screens (workflow_id,screen_id,x,y,collapsed,locked) VALUES (?,?,?,?,?,?)
      ON CONFLICT(workflow_id,screen_id) DO UPDATE SET x=excluded.x, y=excluded.y, collapsed=excluded.collapsed, locked=excluded.locked`)
      .run(n.workflowId, n.screenId, n.x ?? 0, n.y ?? 0, n.collapsed ? 1 : 0, n.locked ? 1 : 0);
    return toNode(this.db.prepare('SELECT * FROM workflow_screens WHERE workflow_id=? AND screen_id=?').get(n.workflowId, n.screenId));
  }
  removeNode(workflowId, screenId) {
    return inTransaction(this.db, () => {
      this.db.prepare('DELETE FROM workflow_links WHERE workflow_id=? AND (from_screen_id=? OR to_screen_id=?)').run(workflowId, screenId, screenId);
      return this.db.prepare('DELETE FROM workflow_screens WHERE workflow_id=? AND screen_id=?').run(workflowId, screenId).changes > 0;
    });
  }
  links(workflowId) { return this.db.prepare('SELECT * FROM workflow_links WHERE workflow_id = ? ORDER BY id').all(workflowId).map(toLink); }
  link(id) { return toLink(this.db.prepare('SELECT * FROM workflow_links WHERE id = ?').get(id)); }
  linksForScreens(screenIds) {
    if (!screenIds.length) return [];
    const q = screenIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM workflow_links WHERE from_screen_id IN (${q}) ORDER BY id`).all(...screenIds).map(toLink);
  }
  createLink(workflowId, l) {
    const r = this.db.prepare(`INSERT INTO workflow_links (workflow_id,from_screen_id,from_node_id,to_screen_id,name,description_dev,style,trigger)
      VALUES (?,?,?,?,?,?,?,?)`).run(workflowId, l.fromScreenId, l.fromNodeId ?? null, l.toScreenId, l.name ?? '', l.descriptionDev ?? '', l.style ?? 'curved', l.trigger ?? 'tap');
    return this.link(Number(r.lastInsertRowid));
  }
  updateLink(id, patch) {
    const map = { fromScreenId: 'from_screen_id', fromNodeId: 'from_node_id', toScreenId: 'to_screen_id', name: 'name', descriptionDev: 'description_dev', style: 'style', trigger: 'trigger' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (sets.length) this.db.prepare(`UPDATE workflow_links SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.link(id);
  }
  deleteLink(id) { return this.db.prepare('DELETE FROM workflow_links WHERE id = ?').run(id).changes > 0; }
}

export class SettingsRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }
  all() { return Object.fromEntries(this.db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, JSON.parse(r.value)])); }
  set(key, value) {
    this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
    this.sync?.enqueue('settings', key, 'upsert', { key, value });
  }
}
