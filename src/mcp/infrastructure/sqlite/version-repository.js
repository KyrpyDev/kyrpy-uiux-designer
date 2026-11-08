/**
 * SQLite access for project_versions, changesets and changeset_ops (milestone M4). No business rules.
 */
import { UID_SQL_EXPR } from '../../domain/uid.js';

const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const iso = () => new Date().toISOString();

const toVersion = r => r && ({
  id: r.id, uid: r.uid, projectId: r.project_id, number: r.number, label: r.label, parentId: r.parent_id,
  source: r.source, status: r.status, manifest: json(r.manifest, []), manifestHash: r.manifest_hash, message: r.message,
  changesetId: r.changeset_id, createdByUser: r.created_by_user, createdByKey: r.created_by_key, createdAt: r.created_at,
  approvedBy: r.approved_by, approvedAt: r.approved_at
});

const toChangeset = r => r && ({
  id: r.id, uid: r.uid, projectId: r.project_id, baseVersionId: r.base_version_id, resultVersionId: r.result_version_id,
  apiKeyId: r.api_key_id, userId: r.user_id, status: r.status, summary: r.summary, message: r.message,
  clientInfo: json(r.client_info, {}), createdAt: r.created_at, updatedAt: r.updated_at, submittedAt: r.submitted_at,
  expiresAt: r.expires_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewComment: r.review_comment
});

const toOp = r => r && ({
  id: r.id, uid: r.uid, changesetId: r.changeset_id, seq: r.seq, op: r.op, type: r.item_type, itemUid: r.item_uid,
  key: r.item_key, baseHash: r.base_hash, proposedHash: r.proposed_hash, payload: json(r.payload, {}),
  validation: json(r.validation, {}), status: r.status, error: r.error, changeRequestId: r.change_request_id
});

export class VersionRepository {
  constructor(db) { this.db = db; }

  /* ---------- versions ---------- */

  head(projectId) {
    return toVersion(this.db.prepare("SELECT * FROM project_versions WHERE project_id = ? AND status = 'approved'").get(Number(projectId)));
  }
  version(id) { return toVersion(this.db.prepare('SELECT * FROM project_versions WHERE id = ?').get(Number(id))); }
  byNumber(projectId, number) {
    return toVersion(this.db.prepare('SELECT * FROM project_versions WHERE project_id = ? AND number = ?').get(Number(projectId), Number(number)));
  }
  listVersions(projectId, { limit = 100 } = {}) {
    return this.db.prepare(`SELECT * FROM project_versions WHERE project_id = ?
      ORDER BY (number IS NULL) DESC, number DESC, id DESC LIMIT ?`).all(Number(projectId), Number(limit)).map(toVersion);
  }
  nextNumber(projectId) {
    return (this.db.prepare('SELECT MAX(number) AS n FROM project_versions WHERE project_id = ?').get(Number(projectId)).n || 0) + 1;
  }
  insertVersion(v) {
    const r = this.db.prepare(`INSERT INTO project_versions
      (uid, project_id, number, label, parent_id, source, status, manifest, manifest_hash, message, changeset_id, created_by_user, created_by_key, approved_by, approved_at)
      VALUES (${UID_SQL_EXPR}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      v.projectId, v.number ?? null, v.label || '', v.parentId ?? null, v.source, v.status,
      JSON.stringify(v.manifest || []), v.manifestHash || '', v.message || '', v.changesetId ?? null,
      v.createdByUser ?? null, v.createdByKey ?? null, v.approvedBy ?? null, v.approvedAt ?? null);
    return this.version(Number(r.lastInsertRowid));
  }
  /** Deletes the whole version history of a project (versions, changesets, their ops, stored item JSON). */
  purgeHistory(projectId) {
    const p = Number(projectId);
    this.db.prepare('DELETE FROM changeset_ops WHERE changeset_id IN (SELECT id FROM changesets WHERE project_id = ?)').run(p);
    this.db.prepare('DELETE FROM changesets WHERE project_id = ?').run(p);
    this.db.prepare('DELETE FROM project_versions WHERE project_id = ?').run(p);
    this.db.prepare('DELETE FROM version_items WHERE project_id = ?').run(p);
  }
  supersedeHead(projectId) {
    this.db.prepare("UPDATE project_versions SET status = 'superseded' WHERE project_id = ? AND status = 'approved'").run(Number(projectId));
  }
  updateVersion(id, patch) {
    const cols = { number: 'number', status: 'status', manifest: 'manifest', manifestHash: 'manifest_hash', parentId: 'parent_id', approvedBy: 'approved_by', approvedAt: 'approved_at', label: 'label', message: 'message' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(cols)) {
      if (patch[k] === undefined) continue;
      sets.push(`${c} = ?`);
      args.push(k === 'manifest' ? JSON.stringify(patch[k]) : patch[k]);
    }
    if (sets.length) this.db.prepare(`UPDATE project_versions SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    return this.version(id);
  }

  /* ---------- changesets ---------- */

  changeset(uidOrId) {
    const col = typeof uidOrId === 'number' ? 'id' : 'uid';
    return toChangeset(this.db.prepare(`SELECT * FROM changesets WHERE ${col} = ?`).get(uidOrId));
  }
  listChangesets(projectId, { status = '', limit = 100 } = {}) {
    const where = ['project_id = ?'], args = [Number(projectId)];
    if (status) { where.push('status = ?'); args.push(status); }
    return this.db.prepare(`SELECT * FROM changesets WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, Number(limit)).map(toChangeset);
  }
  insertChangeset(c) {
    this.db.prepare(`INSERT INTO changesets (uid, project_id, base_version_id, api_key_id, user_id, status, summary, client_info, expires_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(c.uid, c.projectId, c.baseVersionId ?? null, c.apiKeyId ?? null, c.userId ?? null,
      c.summary || '', JSON.stringify(c.clientInfo || {}), c.expiresAt);
    return this.changeset(c.uid);
  }
  updateChangeset(id, patch) {
    const cols = { status: 'status', message: 'message', resultVersionId: 'result_version_id', submittedAt: 'submitted_at', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', reviewComment: 'review_comment', baseVersionId: 'base_version_id' };
    const sets = ['updated_at = ?'], args = [iso()];
    for (const [k, c] of Object.entries(cols)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    this.db.prepare(`UPDATE changesets SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    return this.changeset(Number(id));
  }
  /** Marks open/conflicted changesets past expires_at as expired; returns how many. */
  expireStale(nowIso) {
    return Number(this.db.prepare("UPDATE changesets SET status = 'expired', updated_at = ? WHERE status IN ('open','conflicted') AND expires_at IS NOT NULL AND expires_at < ?").run(nowIso, nowIso).changes);
  }

  /* ---------- ops ---------- */

  ops(changesetId) { return this.db.prepare('SELECT * FROM changeset_ops WHERE changeset_id = ? ORDER BY seq, id').all(Number(changesetId)).map(toOp); }
  op(uid) { return toOp(this.db.prepare('SELECT * FROM changeset_ops WHERE uid = ?').get(String(uid))); }
  opByChangeRequest(changeRequestId) { return toOp(this.db.prepare('SELECT * FROM changeset_ops WHERE change_request_id = ?').get(Number(changeRequestId))); }
  findOp(changesetId, type, key) {
    return toOp(this.db.prepare('SELECT * FROM changeset_ops WHERE changeset_id = ? AND item_type = ? AND item_key = ?').get(Number(changesetId), type, key));
  }
  countOps(changesetId) { return this.db.prepare('SELECT COUNT(*) AS n FROM changeset_ops WHERE changeset_id = ?').get(Number(changesetId)).n; }
  upsertOp(o) {
    const seq = (this.db.prepare('SELECT MAX(seq) AS s FROM changeset_ops WHERE changeset_id = ?').get(o.changesetId).s || 0) + 1;
    this.db.prepare(`INSERT INTO changeset_ops (uid, changeset_id, seq, op, item_type, item_uid, item_key, base_hash, proposed_hash, payload, validation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged')
      ON CONFLICT (changeset_id, item_type, item_key) DO UPDATE SET op = excluded.op, item_uid = excluded.item_uid, base_hash = excluded.base_hash,
        proposed_hash = excluded.proposed_hash, payload = excluded.payload, validation = excluded.validation, status = 'staged', error = '', seq = excluded.seq`)
      .run(o.uid, o.changesetId, seq, o.op, o.type, o.itemUid, o.key, o.baseHash ?? null, o.proposedHash ?? null,
        JSON.stringify(o.payload || {}), JSON.stringify(o.validation || {}));
    return this.findOp(o.changesetId, o.type, o.key);
  }
  deleteOp(id) { this.db.prepare('DELETE FROM changeset_ops WHERE id = ?').run(Number(id)); }
  updateOp(id, patch) {
    const cols = { status: 'status', error: 'error', changeRequestId: 'change_request_id', baseHash: 'base_hash' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(cols)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (sets.length) this.db.prepare(`UPDATE changeset_ops SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
  }
}
