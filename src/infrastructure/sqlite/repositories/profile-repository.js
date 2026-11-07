/**
 * SQLite reads/writes behind the user profile page: the signed-in user's sessions and activity counts.
 * Session tokens never leave this layer in clear: callers get `sid` = first 16 hex chars of sha256(token).
 */
import { createHash } from 'node:crypto';

export const sessionId = token => createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

const DESIGN_TABLES = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens', workflow: 'workflows' };

export class ProfileRepository {
  constructor(db) { this.db = db; }

  #has(table) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  }

  #count(sql, ...args) {
    try { return Number(this.db.prepare(sql).get(...args)?.n || 0); } catch { return 0; }
  }

  /** Live (not expired) sessions of a user, newest first. Expired rows are removed on the way. */
  sessions(userId) {
    const nowIso = new Date().toISOString();
    const rows = this.db.prepare('SELECT token, expires_at, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(Number(userId));
    const live = [];
    for (const r of rows) {
      if (r.expires_at && r.expires_at < nowIso) { this.db.prepare('DELETE FROM sessions WHERE token = ?').run(r.token); continue; }
      live.push({ sid: sessionId(r.token), token: r.token, createdAt: r.created_at, expiresAt: r.expires_at });
    }
    return live;
  }

  deleteSession(token) { return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token)).changes; }

  /** Deletes every session of the user except `keepToken` (null = all). Returns the number removed. */
  deleteSessionsExcept(userId, keepToken = null) {
    return keepToken
      ? this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(Number(userId), String(keepToken)).changes
      : this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId)).changes;
  }

  emailTaken(email, exceptUserId) {
    return !!this.db.prepare('SELECT 1 FROM users WHERE LOWER(email) = ? AND id <> ?').get(String(email).toLowerCase(), Number(exceptUserId));
  }

  /** Activity counts shown on the profile page. Missing optional tables (MCP layer) count as 0. */
  stats(userId) {
    const id = Number(userId);
    const items = {};
    for (const [type, table] of Object.entries(DESIGN_TABLES)) {
      items[type] = this.#count(`SELECT COUNT(*) AS n FROM ${table} WHERE creator_id = ?`, id);
    }
    return {
      projectsOwned: this.#count('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?', id),
      projectsMember: this.#count("SELECT COUNT(*) AS n FROM project_members WHERE user_id = ? AND status = 'accepted' AND role <> 'owner'", id),
      invitationsPending: this.#count("SELECT COUNT(*) AS n FROM project_members WHERE user_id = ? AND status = 'pending'", id),
      itemsCreated: items,
      itemsTotal: Object.values(items).reduce((a, b) => a + b, 0),
      changesToReview: this.#count("SELECT COUNT(*) AS n FROM change_requests WHERE owner_id = ? AND author_id <> ? AND status = 'pending'", id, id),
      changesAuthoredPending: this.#count("SELECT COUNT(*) AS n FROM change_requests WHERE author_id = ? AND owner_id <> ? AND status = 'pending'", id, id),
      apiKeysActive: this.#has('api_keys')
        ? this.#count("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", id, new Date().toISOString())
        : 0
    };
  }
}
