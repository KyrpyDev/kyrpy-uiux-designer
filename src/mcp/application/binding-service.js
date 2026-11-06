/**
 * Code bindings (milestone M6): item ↔ file/symbol links in the app repository. "Code wins for bindings":
 * they are recorded directly, without review (they never change the design).
 */
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import { ITEM_TYPES } from '../domain/item-validation.js';

export const MAX_BINDINGS_PER_CALL = 200;
const toBinding = r => r && ({
  uid: r.uid, type: r.item_type, itemUid: r.item_uid, repo: r.repo_id, file: r.file_path, symbol: r.symbol, framework: r.framework,
  bindingHash: r.binding_hash, updatedAt: r.updated_at
});

/** Repository-relative, forward slashes, no "..", no absolute or drive paths, no control characters. */
export function cleanFilePath(p) {
  const s = String(p ?? '').replace(/\\/g, '/').trim();
  if (!s || s.length > 300) throw new ValidationError('file must be a repository-relative path of 1–300 characters');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(s) || s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some(seg => seg === '..')) {
    throw new ValidationError(`file "${s.slice(0, 80)}" must be relative to the repository root and must not contain ".."`);
  }
  return s.replace(/^\.\//, '');
}

export class BindingService {
  /** @param {{db, reads, hashes, versions, newUid, now?}} d */
  constructor(d) { Object.assign(this, { now: () => new Date(), ...d }); }

  #item(principal, type, ref) {
    if (!ITEM_TYPES.includes(type)) throw new ValidationError(`type must be one of ${ITEM_TYPES.join(', ')}`);
    const row = this.reads.find(type, ref, principal.project.id);
    if (!row || row.project_id !== principal.project.id) throw new NotFoundError(`project ${type}`, ref);
    return row;
  }

  /** Upserts (or with remove:true deletes) bindings. */
  bind(principal, { bindings = [], remove = false } = {}) {
    if (!Array.isArray(bindings) || !bindings.length) throw new ValidationError('bindings must be a non-empty array');
    if (bindings.length > MAX_BINDINGS_PER_CALL) throw new ValidationError(`at most ${MAX_BINDINGS_PER_CALL} bindings per call`);
    const head = this.versions.ensureHead(principal.project.id);
    const out = [];
    for (const b of bindings) {
      const row = this.#item(principal, b.type, b.ref);
      const file = cleanFilePath(b.file);
      const symbol = String(b.symbol || '').slice(0, 200), repo = String(b.repo || '').slice(0, 200), framework = String(b.framework || '').slice(0, 40);
      if (remove) {
        this.db.prepare('DELETE FROM code_bindings WHERE project_id = ? AND item_uid = ? AND repo_id = ? AND file_path = ? AND symbol = ?').run(principal.project.id, row.uid, repo, file, symbol);
        out.push({ type: row.type, key: row.key, file, symbol, removed: true });
        continue;
      }
      this.upsert(principal.project.id, { type: row.type, itemUid: row.uid, repo, file, symbol, framework, hash: this.hashes.get(row.type, row.id), versionId: head.id, apiKeyId: principal.apiKeyId });
      out.push({ type: row.type, key: row.key, uid: row.uid, file, symbol });
    }
    return { count: out.length, bindings: out };
  }

  upsert(projectId, { type, itemUid, repo = '', file, symbol = '', framework = '', hash = null, versionId = null, apiKeyId = null }) {
    this.db.prepare(`INSERT INTO code_bindings (uid, project_id, item_type, item_uid, repo_id, file_path, symbol, framework, binding_hash, last_seen_version_id, created_by_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, item_uid, repo_id, file_path, symbol) DO UPDATE SET framework = excluded.framework, binding_hash = excluded.binding_hash,
        last_seen_version_id = excluded.last_seen_version_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .run(this.newUid(), projectId, type, itemUid, repo, cleanFilePath(file), symbol, framework, hash, versionId, apiKeyId);
  }

  /** Bindings with a `stale` flag (the item changed since the code was last synced with it). */
  list(principal, { type, ref, file, limit = 500 } = {}) {
    const where = ['b.project_id = ?'], args = [principal.project.id];
    if (type && ref) { where.push('b.item_uid = ?'); args.push(this.#item(principal, type, ref).uid); }
    if (file) { where.push('b.file_path = ?'); args.push(cleanFilePath(file)); }
    const rows = this.db.prepare(`SELECT b.* FROM code_bindings b WHERE ${where.join(' AND ')} ORDER BY b.file_path, b.symbol LIMIT ?`).all(...args, Math.min(Number(limit) || 500, 2000));
    return {
      bindings: rows.map(r => {
        const row = this.reads.find(r.item_type, r.item_uid);
        const current = row ? this.hashes.get(r.item_type, row.id) : null;
        return { ...toBinding(r), key: row?.key ?? null, exists: !!row, currentHash: current, stale: !!row && !!r.binding_hash && current !== r.binding_hash };
      })
    };
  }

  forItem(projectId, uid) {
    return this.db.prepare('SELECT * FROM code_bindings WHERE project_id = ? AND item_uid = ? ORDER BY file_path').all(projectId, uid).map(toBinding);
  }
}
