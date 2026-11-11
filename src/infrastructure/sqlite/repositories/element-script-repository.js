/**
 * SQLite repository for `element_scripts` (1:1 sandboxed custom JS + verified public JS dependencies per element).
 */
import { randomBytes } from 'node:crypto';
import { uuidv7 } from '../../../mcp/domain/uid.js';

const parseJson = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return fallback; }
};

export function mapElementScriptRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    uid: row.uid,
    elementId: Number(row.element_id),
    enabled: Boolean(row.enabled),
    runtime: row.runtime || 'esm',
    entryExport: row.entry_export || 'mount',
    moduleCode: row.module_code || '',
    imports: parseJson(row.imports_json, []),
    capabilities: parseJson(row.capabilities_json, {}),
    propsSchema: parseJson(row.props_schema_json, {}),
    emits: parseJson(row.emits_json, []),
    codeHash: row.code_hash || '',
    sriVerified: Boolean(row.sri_verified),
    reviewStatus: row.review_status || 'verified',
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ElementScriptRepository {
  constructor(db) {
    this.db = db;
  }

  getByElementId(elementId) {
    const row = this.db.prepare('SELECT * FROM element_scripts WHERE element_id = ?').get(Number(elementId));
    return mapElementScriptRow(row);
  }

  listByElementIds(elementIds = []) {
    const ids = [...new Set((elementIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.prepare(`SELECT * FROM element_scripts WHERE element_id IN (${placeholders})`).all(...ids);
    const out = new Map();
    for (const r of rows) out.set(Number(r.element_id), mapElementScriptRow(r));
    return out;
  }

  upsert(elementId, spec, { actorId = null } = {}) {
    const eid = Number(elementId);
    const existing = this.db.prepare('SELECT id, uid, created_by FROM element_scripts WHERE element_id = ?').get(eid);
    const now = new Date().toISOString();
    const importsJson = JSON.stringify(spec.imports || []);
    const capsJson = JSON.stringify(spec.capabilities || {});
    const propsJson = JSON.stringify(spec.propsSchema || {});
    const emitsJson = JSON.stringify(spec.emits || []);
    const enabled = spec.enabled ? 1 : 0;
    const sriVerified = spec.sriVerified ? 1 : 0;

    if (existing) {
      this.db.prepare(`
        UPDATE element_scripts
        SET enabled = ?, runtime = ?, entry_export = ?, module_code = ?, imports_json = ?,
            capabilities_json = ?, props_schema_json = ?, emits_json = ?, code_hash = ?,
            sri_verified = ?, review_status = ?, updated_by = ?, updated_at = ?
        WHERE element_id = ?
      `).run(
        enabled,
        spec.runtime || 'esm',
        spec.entryExport || 'mount',
        spec.moduleCode || '',
        importsJson,
        capsJson,
        propsJson,
        emitsJson,
        spec.codeHash || '',
        sriVerified,
        spec.reviewStatus || 'verified',
        actorId ?? existing.updated_by ?? existing.created_by ?? null,
        now,
        eid
      );
    } else {
      const uid = uuidv7(randomBytes);
      this.db.prepare(`
        INSERT INTO element_scripts (
          uid, element_id, enabled, runtime, entry_export, module_code, imports_json,
          capabilities_json, props_schema_json, emits_json, code_hash, sri_verified,
          review_status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uid,
        eid,
        enabled,
        spec.runtime || 'esm',
        spec.entryExport || 'mount',
        spec.moduleCode || '',
        importsJson,
        capsJson,
        propsJson,
        emitsJson,
        spec.codeHash || '',
        sriVerified,
        spec.reviewStatus || 'verified',
        actorId ?? null,
        actorId ?? null,
        now,
        now
      );
    }
    return this.getByElementId(eid);
  }

  removeByElementId(elementId) {
    const info = this.db.prepare('DELETE FROM element_scripts WHERE element_id = ?').run(Number(elementId));
    return Number(info.changes) > 0;
  }

  copy(fromElementId, toElementId, { actorId = null } = {}) {
    const src = this.getByElementId(fromElementId);
    if (!src) return null;
    return this.upsert(toElementId, src, { actorId: actorId ?? src.createdBy });
  }
}
