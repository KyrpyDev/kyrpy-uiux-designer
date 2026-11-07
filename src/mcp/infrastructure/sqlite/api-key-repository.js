/** SQLite access for `api_keys` and `mcp_audit_log`. No business rules here. */

const toKey = r => r && ({
  id: r.id,
  uid: r.uid,
  userId: r.user_id,
  projectId: r.project_id,
  kind: r.kind || 'project',
  name: r.name,
  prefix: r.prefix,
  keyHash: r.key_hash,
  scopes: JSON.parse(r.scopes || '["read"]'),
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  lastUsedIp: r.last_used_ip,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
  rotatedFromId: r.rotated_from_id,
  rotatedToId: r.rotated_to_id,
  createdAt: r.created_at,
  projectKey: r.project_key,
  projectName: r.project_name,
  username: r.username
});

const SELECT = `SELECT k.*, p.key AS project_key, p.name AS project_name, u.username
  FROM api_keys k LEFT JOIN projects p ON p.id = k.project_id LEFT JOIN users u ON u.id = k.user_id`;

export class ApiKeyRepository {
  constructor(db) { this.db = db; }

  get(id) { return toKey(this.db.prepare(`${SELECT} WHERE k.id = ?`).get(Number(id))); }
  findByPrefix(prefix) { return this.db.prepare(`${SELECT} WHERE k.prefix = ?`).all(prefix).map(toKey); }
  listByUser(userId) { return this.db.prepare(`${SELECT} WHERE k.user_id = ? ORDER BY k.id DESC`).all(Number(userId)).map(toKey); }
  listByProject(projectId) { return this.db.prepare(`${SELECT} WHERE k.project_id = ? ORDER BY k.id DESC`).all(Number(projectId)).map(toKey); }
  listAll() { return this.db.prepare(`${SELECT} ORDER BY k.id DESC`).all().map(toKey); }

  countActiveByUser(userId, nowIso) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)`).get(Number(userId), nowIso).n;
  }

  insert({ uid, userId, projectId = null, kind = 'project', name, prefix, keyHash, scopes, expiresAt, rotatedFromId = null, createdAt = null }) {
    // created_at from the service clock when given (so expiry durations are measured on one clock)
    const r = this.db.prepare(`INSERT INTO api_keys (uid, user_id, project_id, kind, name, prefix, key_hash, scopes, expires_at, rotated_from_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run(uid, userId, projectId, kind, name, prefix, keyHash, JSON.stringify(scopes), expiresAt, rotatedFromId, createdAt);
    return this.get(Number(r.lastInsertRowid));
  }

  markRotated(id, { rotatedToId, expiresAt }) {
    this.db.prepare('UPDATE api_keys SET rotated_to_id = ?, expires_at = ? WHERE id = ?').run(rotatedToId, expiresAt, Number(id));
  }

  revoke(id, { revokedBy, at }) {
    return this.db.prepare('UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL')
      .run(at, revokedBy ?? null, Number(id)).changes > 0;
  }

  revokeAllForProject(projectId, { revokedBy, at }) {
    return Number(this.db.prepare('UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE project_id = ? AND revoked_at IS NULL')
      .run(at, revokedBy ?? null, Number(projectId)).changes);
  }

  touch(id, { at, ip }) {
    this.db.prepare('UPDATE api_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?').run(at, ip ?? null, Number(id));
  }
}

export class AuditLogRepository {
  constructor(db) { this.db = db; }

  record({ apiKeyId = null, userId = null, projectId = null, event, tool = '', argsDigest = '', result = 'ok', errorCode = '', durationMs = 0, ip = '' }) {
    this.db.prepare(`INSERT INTO mcp_audit_log (api_key_id, user_id, project_id, event, tool, args_digest, result, error_code, duration_ms, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(apiKeyId, userId, projectId, event, tool, argsDigest, result, errorCode, Math.round(durationMs), ip || '');
  }

  list({ apiKeyId, projectId, limit = 100 } = {}) {
    const where = [], args = [];
    if (apiKeyId) { where.push('api_key_id = ?'); args.push(Number(apiKeyId)); }
    if (projectId) { where.push('project_id = ?'); args.push(Number(projectId)); }
    return this.db.prepare(`SELECT * FROM mcp_audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ?`).all(...args, Math.min(Math.max(1, Number(limit) || 100), 1000)).map(r => ({
      id: r.id, apiKeyId: r.api_key_id, userId: r.user_id, projectId: r.project_id, event: r.event, tool: r.tool,
      result: r.result, errorCode: r.error_code, durationMs: r.duration_ms, ip: r.ip, createdAt: r.created_at
    }));
  }

  purgeOlderThan(isoTime) {
    return Number(this.db.prepare('DELETE FROM mcp_audit_log WHERE created_at < ?').run(isoTime).changes);
  }
}
