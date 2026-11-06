/**
 * Project scope: a project's design system is self-contained. Every item a project item uses that lives
 * in another library (public, another project, someone's private library) is cloned into the project
 * (visibility `project`, creator `kyrpy-agent-designer`) and the references are pointed at the clone.
 *
 * Clones are found again through `cloned_from_id`, so adopting is idempotent. Clone keys are
 * `<project-key>-<original-key>` (keys are still unique across the whole table).
 */
import { createHash } from 'node:crypto';
import { uniqueKey } from '../../domain/naming.js';
import { DESIGN_TABLES, TYPE_TO_TABLE } from '../domain/tables.js';
import { ITEM_TYPES } from '../domain/item-validation.js';

/** Deterministic uid of a project's clone (UUID v8 layout): equal in dry runs, on apply and on every instance. */
export function cloneUid(projectKey, srcUid) {
  const h = createHash('sha256').update(`kyrpy-uiux-clone:${projectKey}:${srcUid}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class ProjectLibraryService {
  /** @param {{db, reads, services, workflows, projects, agentUserId: () => number}} d */
  constructor(d) { Object.assign(this, d); }

  #projectKey(projectId) { return this.projects.get(Number(projectId))?.key || `p${projectId}`; }

  /** The project's clone of a foreign item (creating it, and adopting its own dependencies, when missing). */
  adopt(projectId, type, srcId, seen = new Set()) {
    const table = TYPE_TO_TABLE[type];
    const src = this.db.prepare(`SELECT id, uid, key, name, label, project_id FROM ${table} WHERE id = ?`).get(Number(srcId));
    if (!src) return null;
    if (src.project_id === Number(projectId)) return src.id;
    const existing = this.db.prepare(`SELECT id FROM ${table} WHERE project_id = ? AND cloned_from_id = ? ORDER BY id LIMIT 1`).get(Number(projectId), src.id);
    let cloneId = existing?.id;
    if (!cloneId) {
      const svc = type === 'workflow' ? this.workflows : this.services[type];
      cloneId = svc.clone(src.id, { name: src.name, projectId: Number(projectId), visibility: 'project', creatorId: this.agentUserId() }).id;
      const key = uniqueKey(`${this.#projectKey(projectId)}-${src.key}`, k => !!this.db.prepare(`SELECT 1 FROM ${table} WHERE key = ? AND id <> ?`).get(k, cloneId));
      const uid = cloneUid(this.#projectKey(projectId), src.uid);
      const taken = this.db.prepare(`SELECT 1 FROM ${table} WHERE uid = ?`).get(uid);
      this.db.prepare(`UPDATE ${table} SET key = ?, label = ?${taken ? '' : ', uid = ?'} WHERE id = ?`).run(...[key, src.label ?? src.name, ...(taken ? [] : [uid]), cloneId]);
      const ctx = this.db.prepare(`SELECT mcp_context FROM ${table} WHERE id = ?`).get(src.id)?.mcp_context;
      if (ctx) this.db.prepare(`UPDATE ${table} SET mcp_context = ? WHERE id = ?`).run(ctx, cloneId);
    }
    this.#repoint(projectId, type, src.id, cloneId);
    const k = `${type}:${cloneId}`;
    if (!seen.has(k)) { seen.add(k); this.#adoptDepsOf(projectId, type, cloneId, seen); }
    return cloneId;
  }

  #adoptDepsOf(projectId, type, id, seen) {
    for (const dep of this.reads.dependencies(type, id)) {
      const row = this.reads.find(dep.type, dep.id);
      if (row && row.project_id !== Number(projectId)) this.adopt(projectId, dep.type, dep.id, seen);
    }
  }

  /** Points every reference from the project's items at `fromId` to `toId`. */
  #repoint(projectId, type, fromId, toId) {
    const p = Number(projectId);
    for (const [ownerType, t] of Object.entries(DESIGN_TABLES)) {
      this.db.prepare(`UPDATE nodes SET ref_id = ? WHERE ref_type = ? AND ref_id = ? AND owner_type = ? AND owner_id IN (SELECT id FROM ${t} WHERE project_id = ?)`)
        .run(toId, type, fromId, ownerType, p);
    }
    const col = { icon: 'icon_id', screen: 'target_screen_id', element: 'target_element_id' }[type];
    if (col) this.db.prepare(`UPDATE menu_items SET ${col} = ? WHERE ${col} = ? AND button_id IN (SELECT id FROM buttons WHERE project_id = ?)`).run(toId, fromId, p);
    if (type === 'screen') {
      this.db.prepare('UPDATE OR IGNORE workflow_screens SET screen_id = ? WHERE screen_id = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)').run(toId, fromId, p);
      this.db.prepare('DELETE FROM workflow_screens WHERE screen_id = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)').run(fromId, p);
      for (const c of ['from_screen_id', 'to_screen_id']) {
        this.db.prepare(`UPDATE workflow_links SET ${c} = ? WHERE ${c} = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)`).run(toId, fromId, p);
      }
    }
  }

  /** Foreign items the project's items use (direct dependencies only). */
  foreignDependencies(projectId) {
    const p = Number(projectId), out = new Map();
    for (const type of ITEM_TYPES) {
      for (const r of this.db.prepare(`SELECT id FROM ${TYPE_TO_TABLE[type]} WHERE project_id = ?`).all(p)) {
        for (const dep of this.reads.dependencies(type, r.id)) {
          const row = this.reads.find(dep.type, dep.id);
          if (row && row.project_id !== p) out.set(`${dep.type}:${dep.id}`, { type: dep.type, id: dep.id, key: row.key, uid: row.uid });
        }
      }
    }
    return [...out.values()];
  }

  /** Clones every foreign dependency of the project into it. Returns what was adopted. */
  adoptAll(projectId) {
    const adopted = [];
    for (let round = 0; round < 8; round++) {
      const foreign = this.foreignDependencies(projectId);
      if (!foreign.length) break;
      // lower hierarchy levels first, so a cloned button already finds its cloned icons
      foreign.sort((a, b) => ITEM_TYPES.indexOf(a.type) - ITEM_TYPES.indexOf(b.type));
      for (const f of foreign) {
        const id = this.adopt(projectId, f.type, f.id);
        adopted.push({ type: f.type, from: f.key, fromUid: f.uid, key: this.reads.keyOf(f.type, id), uid: this.reads.uidOf(f.type, id) });
      }
    }
    return adopted;
  }
}
