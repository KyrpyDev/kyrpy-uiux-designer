/**
 * Read-only queries over the design tables for MCP: scope-filtered listing, search candidates,
 * uid/key resolution and dependency edges. No business rules beyond the SQL scope filter.
 */
import { DESIGN_TABLES, TYPE_TO_TABLE } from '../../domain/tables.js';

export const ITEM_TYPES = [...Object.keys(DESIGN_TABLES), 'workflow'];

const COLS = {
  design: 'id, uid, key, name, label, category, tags, description_dev, mcp_context, visibility, project_id, creator_id, builtin, content_hash, updated_at, width, height',
  workflow: "id, uid, key, name, label, 'workflow' AS category, '[]' AS tags, description_dev, mcp_context, visibility, project_id, creator_id, 0 AS builtin, content_hash, updated_at, 0 AS width, 0 AS height"
};

/**
 * SQL condition for the rows a principal may read:
 *   project → rows of the key's project (any visibility)
 *   private → the key owner's private global library
 *   public  → public rows of any project
 */
function scopeSql(scopes) {
  const parts = [];
  if (scopes.includes('project')) parts.push('project_id = :projectId');
  if (scopes.includes('private')) parts.push("(visibility = 'private' AND creator_id = :userId)");
  if (scopes.includes('public')) parts.push("visibility = 'public'");
  return parts.length ? `(${parts.join(' OR ')})` : '0';
}

/** node:sqlite rejects named parameters the statement does not use, so pass only the ones in the SQL. */
const usedParams = (sql, params) => Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes(`:${k}`)));

export class DesignReadRepository {
  constructor(db) { this.db = db; }

  #cols(type) { return type === 'workflow' ? COLS.workflow : COLS.design; }

  /** Rows of one type within the given scopes. */
  list(type, { projectId, userId, scopes = ['project', 'private', 'public'] }) {
    const t = TYPE_TO_TABLE[type];
    const sql = `SELECT ${this.#cols(type)} FROM ${t} WHERE ${scopeSql(scopes)} ORDER BY id`;
    return this.db.prepare(sql).all(usedParams(sql, { projectId, userId })).map(r => ({ ...r, type }));
  }

  /** Candidate rows whose text fields contain every term (case-insensitive). Ranking happens in the service. */
  search(type, terms, { projectId, userId, scopes, category, limit = 500 }) {
    const t = TYPE_TO_TABLE[type];
    const hay = "lower(key || ' ' || name || ' ' || label || ' ' || category || ' ' || tags || ' ' || description_dev || ' ' || mcp_context)";
    const hayWf = "lower(key || ' ' || name || ' ' || label || ' ' || description_dev || ' ' || mcp_context)";
    const params = { projectId, userId };
    const where = [scopeSql(scopes)];
    terms.forEach((term, i) => { params[`t${i}`] = `%${term.toLowerCase().replace(/[\\%_]/g, c => `\\${c}`)}%`; where.push(`${type === 'workflow' ? hayWf : hay} LIKE :t${i} ESCAPE '\\'`); });
    if (category && type !== 'workflow') { params.category = category; where.push('category = :category'); }
    const sql = `SELECT ${this.#cols(type)} FROM ${t} WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${Number(limit)}`;
    return this.db.prepare(sql).all(usedParams(sql, params)).map(r => ({ ...r, type }));
  }

  /** One row by uid, key or numeric id (no scope filter; the caller decides access). */
  find(type, ref) {
    const t = TYPE_TO_TABLE[type];
    if (!t) return null;
    const s = String(ref);
    const col = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s) ? 'uid' : /^\d+$/.test(s) ? 'id' : 'key';
    const r = this.db.prepare(`SELECT ${this.#cols(type)} FROM ${t} WHERE ${col} = ?`).get(col === 'id' ? Number(s) : s);
    return r ? { ...r, type } : null;
  }

  /** Finds a row by uid in any item table. */
  findByUid(uid) {
    for (const type of ITEM_TYPES) {
      const r = this.db.prepare(`SELECT ${this.#cols(type)} FROM ${TYPE_TO_TABLE[type]} WHERE uid = ?`).get(uid);
      if (r) return { ...r, type };
    }
    return null;
  }

  uidOf(type, id) {
    const t = TYPE_TO_TABLE[type];
    return t && id != null ? this.db.prepare(`SELECT uid FROM ${t} WHERE id = ?`).get(Number(id))?.uid ?? null : null;
  }

  keyOf(type, id) {
    const t = TYPE_TO_TABLE[type];
    return t && id != null ? this.db.prepare(`SELECT key FROM ${t} WHERE id = ?`).get(Number(id))?.key ?? null : null;
  }

  /** Direct dependencies of an item as [{type, id}] (node instances, menu targets, workflow screens). */
  dependencies(type, id) {
    const out = [];
    if (DESIGN_TABLES[type]) {
      for (const r of this.db.prepare('SELECT DISTINCT ref_type, ref_id FROM nodes WHERE owner_type = ? AND owner_id = ? AND ref_type IS NOT NULL AND ref_id IS NOT NULL').all(type, id)) {
        out.push({ type: r.ref_type, id: r.ref_id });
      }
      if (type === 'button') {
        for (const m of this.db.prepare('SELECT icon_id, target_screen_id, target_element_id FROM menu_items WHERE button_id = ?').all(id)) {
          if (m.icon_id) out.push({ type: 'icon', id: m.icon_id });
          if (m.target_screen_id) out.push({ type: 'screen', id: m.target_screen_id });
          if (m.target_element_id) out.push({ type: 'element', id: m.target_element_id });
        }
      }
    } else if (type === 'workflow') {
      for (const r of this.db.prepare('SELECT screen_id FROM workflow_screens WHERE workflow_id = ?').all(id)) out.push({ type: 'screen', id: r.screen_id });
      for (const r of this.db.prepare('SELECT from_screen_id, to_screen_id FROM workflow_links WHERE workflow_id = ?').all(id)) {
        out.push({ type: 'screen', id: r.from_screen_id }, { type: 'screen', id: r.to_screen_id });
      }
    }
    return out;
  }

  nodeName(id) { return this.db.prepare('SELECT name FROM nodes WHERE id = ?').get(Number(id))?.name ?? null; }

  themes() {
    return this.db.prepare('SELECT id, uid, key, name, kind, tokens, surfaces, builtin, content_hash FROM themes ORDER BY position, id').all();
  }

  devices() {
    return this.db.prepare('SELECT key, name, category, width, height, corner_radius, grid FROM template_devices ORDER BY id').all();
  }
}
