import { createHash } from 'node:crypto';
/**
 * SQLite repositories for Users, Sessions, Projects, Project Members, Collaborative Change Requests,
 * Editable Template Devices & Button Types, and Multi-language Translations.
 */
import { publicUserId as publicUserIdOf, defaultOwnerId as defaultOwnerIdOf } from '../../../domain/system-users.js';
import { sessionKey } from '../session-token.js';

const toUser = r => r && ({
  id: r.id,
  username: r.username,
  email: r.email,
  displayName: r.display_name || r.username,
  role: r.role,
  status: r.status,
  permissions: JSON.parse(r.permissions || '[]'),
  avatarColor: r.avatar_color || '#2e9bff',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastLoginAt: r.last_login_at
});

const toUserWithAuth = r => r && ({
  ...toUser(r),
  passwordHash: r.password_hash,
  salt: r.salt
});

export class UserRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  list() { return this.db.prepare('SELECT * FROM users ORDER BY id').all().map(toUser); }
  get(id) { return toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id))); }
  getWithAuth(id) { return toUserWithAuth(this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id))); }
  getByUsernameOrEmail(identifier) {
    const v = String(identifier || '').trim().toLowerCase();
    return toUserWithAuth(this.db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?').get(v, v));
  }
  findByUsernameOrEmail(identifier) {
    return this.getByUsernameOrEmail(identifier);
  }
  /** Users holding a role (one query; the caller filters system accounts). */
  listByRole(role) { return this.db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id').all(String(role)).map(toUser); }
  /** Id of the immutable `public` system user (owner of the public library), or null. */
  publicUserId() { return publicUserIdOf(this.db); }
  /**
   * Failed sign-ins, kept in the database so every process that serves it (and a restarted one) counts together.
   * The key is a hash: what was typed as a name is never stored. Map-like: get / set / delete / sweep.
   */
  loginFailureStore() {
    const db = this.db;
    const key = b => createHash('sha256').update(String(b)).digest('hex');
    return {
      get(b) { const r = db.prepare('SELECT count, started_at FROM login_failures WHERE bucket = ?').get(key(b)); return r ? { count: Number(r.count), start: Number(r.started_at) } : undefined; },
      set(b, v) { db.prepare('INSERT INTO login_failures (bucket, count, started_at) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, started_at = excluded.started_at').run(key(b), v.count, v.start); },
      delete(b) { db.prepare('DELETE FROM login_failures WHERE bucket = ?').run(key(b)); },
      sweep(before) { return Number(db.prepare('DELETE FROM login_failures WHERE started_at <= ?').run(before).changes || 0); }
    };
  }
  /** Owner of records written without an actor: the superadmin by role, id 1 as a last resort. */
  defaultOwnerId() { return defaultOwnerIdOf(this.db); }

  create(u) {
    const r = this.db.prepare(`INSERT INTO users (username,email,password_hash,salt,display_name,role,status,permissions,avatar_color)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      u.username, u.email, u.passwordHash ?? '', u.salt ?? '', u.displayName || u.username,
      u.role || 'designer', u.status || 'active', JSON.stringify(u.permissions || []), u.avatarColor || '#2e9bff');
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('users', saved.id, 'upsert', saved);
    return saved;
  }

  update(id, patch) {
    const map = { username: 'username', email: 'email', passwordHash: 'password_hash', salt: 'salt',
      displayName: 'display_name', role: 'role', status: 'status', avatarColor: 'avatar_color', lastLoginAt: 'last_login_at' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.permissions !== undefined) { sets.push('permissions = ?'); args.push(JSON.stringify(patch.permissions)); }
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`);
      this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    }
    const saved = this.get(id);
    this.sync?.enqueue('users', id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM users WHERE id = ?').run(Number(id)).changes > 0;
    if (ok) this.sync?.enqueue('users', id, 'delete', { id });
    return ok;
  }

  /** Stores the session under the hash of its token (session-token.js); the clear token is only returned. */
  /** What a user still owns: projects (as owner) and library items / workflows (as creator). */
  ownedCounts(userId) {
    const id = Number(userId);
    const n = sql => { try { return Number(this.db.prepare(sql).get(id)?.n || 0); } catch { return 0; } };
    const projects = n('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?');
    let items = 0;
    for (const t of ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows']) items += n(`SELECT COUNT(*) AS n FROM ${t} WHERE creator_id = ?`);
    return { projects, items, total: projects + items };
  }

  createSession(token, userId, expiresAt) {
    this.db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(sessionKey(token), Number(userId), expiresAt);
    return { token, userId: Number(userId), expiresAt };
  }

  getSession(token) {
    if (!token) return null;
    const key = sessionKey(token);
    const s = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(key);
    if (!s) return null;
    if (s.expires_at && new Date(s.expires_at) < new Date()) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(key);
      return null;
    }
    const user = this.get(s.user_id);
    return user ? { token: String(token), userId: s.user_id, expiresAt: s.expires_at, user } : null;
  }

  /** Rows written before tokens were hashed hold the clear token: replace each with its hash. Returns how many. */
  hashLegacySessions() {
    const rows = this.db.prepare("SELECT token FROM sessions WHERE token NOT LIKE 'h1:%'").all();
    const upd = this.db.prepare('UPDATE OR REPLACE sessions SET token = ? WHERE token = ?');
    for (const r of rows) upd.run(sessionKey(r.token), r.token);
    return rows.length;
  }

  /** Signs a user out everywhere, except the session of `keepToken` (clear token) when given. Returns how many. */
  deleteSessionsOfUser(userId, keepToken = null) {
    return keepToken
      ? this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(Number(userId), sessionKey(keepToken)).changes
      : this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId)).changes;
  }

  /** Removes every expired session; returns how many. */
  purgeExpiredSessions(now = new Date().toISOString()) {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').run(now).changes;
  }

  deleteSession(token) {
    return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionKey(token)).changes > 0;
  }
}

const toProject = r => r && ({
  id: r.id,
  key: r.key,
  name: r.name,
  label: r.label || r.name,
  description: r.description || '',
  ownerId: r.owner_id,
  visibility: r.visibility || 'public',
  requireApproval: !!r.require_approval,
  settings: JSON.parse(r.settings || '{}'),
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

const toMember = r => r && ({
  id: r.id,
  projectId: r.project_id,
  userId: r.user_id,
  invitedBy: r.invited_by,
  role: r.role,
  status: r.status,
  username: r.username,
  email: r.email,
  displayName: r.display_name || r.username,
  avatarColor: r.avatar_color,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export class ProjectRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  list() { return this.db.prepare('SELECT * FROM projects ORDER BY id').all().map(toProject); }
  get(id) { return toProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id))); }
  getByKey(key) { return toProject(this.db.prepare('SELECT * FROM projects WHERE key = ?').get(String(key))); }
  keyExists(key) { return !!this.db.prepare('SELECT 1 FROM projects WHERE key = ?').get(String(key)); }

  create(p) {
    const r = this.db.prepare(`INSERT INTO projects (key,name,label,description,owner_id,visibility,require_approval,settings)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      p.key, p.name, p.label || p.name, p.description || '', p.ownerId ?? 1,
      p.visibility || 'public', p.requireApproval === false ? 0 : 1, JSON.stringify(p.settings || {}));
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('projects', saved.id, 'upsert', saved);
    return saved;
  }

  update(id, patch) {
    const map = { key: 'key', name: 'name', label: 'label', description: 'description', ownerId: 'owner_id', visibility: 'visibility' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.requireApproval !== undefined) { sets.push('require_approval = ?'); args.push(patch.requireApproval ? 1 : 0); }
    if (patch.settings !== undefined) { sets.push('settings = ?'); args.push(JSON.stringify(patch.settings)); }
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`);
      this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    }
    const saved = this.get(id);
    this.sync?.enqueue('projects', id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM projects WHERE id = ?').run(Number(id)).changes > 0;
    if (ok) this.sync?.enqueue('projects', id, 'delete', { id });
    return ok;
  }

  members(projectId) {
    return this.db.prepare(`SELECT pm.*, u.username, u.email, u.display_name, u.avatar_color
      FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? ORDER BY pm.id`).all(Number(projectId)).map(toMember);
  }

  getMember(projectId, userId) {
    return toMember(this.db.prepare(`SELECT pm.*, u.username, u.email, u.display_name, u.avatar_color
      FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.user_id = ?`).get(Number(projectId), Number(userId)));
  }

  upsertMember({ projectId, userId, invitedBy = 1, role = 'editor', status = 'accepted' }) {
    this.db.prepare(`INSERT INTO project_members (project_id, user_id, invited_by, role, status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status, updated_at = datetime('now')`)
      .run(Number(projectId), Number(userId), invitedBy ? Number(invitedBy) : null, role, status);
    const saved = this.getMember(projectId, userId);
    this.sync?.enqueue('project_members', saved.id, 'upsert', saved);
    return saved;
  }

  removeMember(projectId, userId) {
    return this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(Number(projectId), Number(userId)).changes > 0;
  }
}

const toChange = r => r && ({
  id: r.id,
  projectId: r.project_id,
  targetType: r.target_type,
  targetId: r.target_id,
  targetKey: r.target_key,
  targetName: r.target_name,
  authorId: r.author_id,
  authorUsername: r.author_username || null,
  ownerId: r.owner_id,
  action: r.action,
  summary: r.summary,
  beforeSnapshot: JSON.parse(r.before_snapshot || '{}'),
  afterSnapshot: JSON.parse(r.after_snapshot || '{}'),
  diffSummary: JSON.parse(r.diff_summary || '{}'),
  status: r.status,
  reviewerId: r.reviewer_id,
  reviewerUsername: r.reviewer_username || null,
  reviewComment: r.review_comment || '',
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at
});

export class ChangeRequestRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  /** WHERE clause shared by list / matchingIds / countByStatus; `q` is a case-insensitive text search. */
  #where({ projectId = null, status = '', targetType = '', targetId = null, ownerId = null, authorId = null, q = '' } = {}, { skipStatus = false } = {}) {
    const where = [], args = [];
    if (projectId != null && projectId !== '') { where.push('c.project_id = ?'); args.push(Number(projectId)); }
    if (status && !skipStatus) { where.push('c.status = ?'); args.push(status); }
    if (targetType) { where.push('c.target_type = ?'); args.push(targetType); }
    if (targetId != null && targetId !== '') { where.push('c.target_id = ?'); args.push(Number(targetId)); }
    if (ownerId != null && ownerId !== '') { where.push('c.owner_id = ?'); args.push(Number(ownerId)); }
    if (authorId != null && authorId !== '') { where.push('c.author_id = ?'); args.push(Number(authorId)); }
    const text = String(q || '').trim().toLowerCase();
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      where.push(`(lower(c.target_name) LIKE ? ESCAPE '\\' OR lower(c.target_key) LIKE ? ESCAPE '\\'
        OR lower(c.summary) LIKE ? ESCAPE '\\' OR lower(COALESCE(ua.username, '')) LIKE ? ESCAPE '\\')`);
      args.push(like, like, like, like);
    }
    return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
  }

  /** The list view: every column except the two snapshots (~100 KB each), which are neither read nor parsed. */
  listLite(filter = {}) {
    const { w, args } = this.#where(filter);
    return this.db.prepare(`SELECT c.id, c.project_id, c.target_type, c.target_id, c.target_key, c.target_name, c.author_id, c.owner_id,
        c.action, c.summary, c.diff_summary, c.status, c.reviewer_id, c.review_comment, c.created_at, c.reviewed_at,
        ua.username AS author_username, ur.username AS reviewer_username
      FROM change_requests c
      LEFT JOIN users ua ON ua.id = c.author_id
      LEFT JOIN users ur ON ur.id = c.reviewer_id
      ${w} ORDER BY c.id DESC`).all(...args).map(r => { const { beforeSnapshot, afterSnapshot, ...lite } = toChange(r); return lite; });
  }

  list(filter = {}) {
    const { w, args } = this.#where(filter);
    return this.db.prepare(`SELECT c.*, ua.username AS author_username, ur.username AS reviewer_username
      FROM change_requests c
      LEFT JOIN users ua ON ua.id = c.author_id
      LEFT JOIN users ur ON ur.id = c.reviewer_id
      ${w} ORDER BY c.id DESC`).all(...args).map(toChange);
  }

  /** Ids of the matching change requests (newest first), without parsing their snapshots. */
  matchingIds(filter = {}) {
    const { w, args } = this.#where(filter);
    return this.db.prepare(`SELECT c.id FROM change_requests c
      LEFT JOIN users ua ON ua.id = c.author_id
      ${w} ORDER BY c.id DESC`).all(...args).map(r => Number(r.id));
  }

  /** { pending, approved, rejected, all } for the filter, ignoring its `status`. */
  countByStatus(filter = {}) {
    const { w, args } = this.#where(filter, { skipStatus: true });
    const out = { pending: 0, approved: 0, rejected: 0, all: 0 };
    for (const r of this.db.prepare(`SELECT c.status AS status, COUNT(*) AS n FROM change_requests c
      LEFT JOIN users ua ON ua.id = c.author_id
      ${w} GROUP BY c.status`).all(...args)) {
      out[r.status] = Number(r.n);
      out.all += Number(r.n);
    }
    return out;
  }

  get(id) {
    return toChange(this.db.prepare(`SELECT c.*, ua.username AS author_username, ur.username AS reviewer_username
      FROM change_requests c
      LEFT JOIN users ua ON ua.id = c.author_id
      LEFT JOIN users ur ON ur.id = c.reviewer_id
      WHERE c.id = ?`).get(Number(id)));
  }

  create(c) {
    const r = this.db.prepare(`INSERT INTO change_requests
      (project_id,target_type,target_id,target_key,target_name,author_id,owner_id,action,summary,before_snapshot,after_snapshot,diff_summary,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      c.projectId ?? 1, c.targetType, Number(c.targetId), c.targetKey || '', c.targetName || '',
      c.authorId ?? 1, c.ownerId ?? 1, c.action || 'update', c.summary || '',
      JSON.stringify(c.beforeSnapshot || {}), JSON.stringify(c.afterSnapshot || {}),
      JSON.stringify(c.diffSummary || {}), c.status || 'pending');
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('change_requests', saved.id, 'upsert', saved);
    return saved;
  }

  /** The pending edit request `authorId` already has for this item (publish requests excluded), or null. */
  openEdit({ authorId, targetType, targetId }) {
    const r = this.db.prepare(`SELECT id FROM change_requests WHERE author_id = ? AND target_type = ? AND target_id = ?
      AND status = 'pending' AND action != 'publish' ORDER BY id DESC LIMIT 1`).get(Number(authorId), targetType, Number(targetId));
    return r ? this.get(r.id) : null;
  }

  /** Replaces the "after" side of a pending request (the "before" side stays: it is what a reject restores). */
  updateAfter(id, { afterSnapshot, diffSummary, summary, action, targetKey, targetName }) {
    this.db.prepare(`UPDATE change_requests SET after_snapshot = ?, diff_summary = ?, summary = ?, action = ?, target_key = ?, target_name = ? WHERE id = ?`)
      .run(JSON.stringify(afterSnapshot || {}), JSON.stringify(diffSummary || {}), summary || '', action || 'update', targetKey || '', targetName || '', Number(id));
    const saved = this.get(id);
    this.sync?.enqueue('change_requests', id, 'upsert', saved);
    return saved;
  }

  updateStatus(id, { status, reviewerId = 1, reviewComment = '' }) {
    this.db.prepare(`UPDATE change_requests
      SET status = ?, reviewer_id = ?, review_comment = ?, reviewed_at = datetime('now')
      WHERE id = ?`).run(status, reviewerId ? Number(reviewerId) : null, reviewComment || '', Number(id));
    const saved = this.get(id);
    this.sync?.enqueue('change_requests', id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    return this.db.prepare('DELETE FROM change_requests WHERE id = ?').run(Number(id)).changes > 0;
  }
}

const toDeviceTpl = r => r && ({
  id: r.id, key: r.key, name: r.name, category: r.category, width: r.width, height: r.height,
  cornerRadius: r.corner_radius, grid: r.grid, locked: !!r.locked, meta: JSON.parse(r.meta || '{}'),
  builtin: !!r.builtin, createdBy: r.created_by, createdAt: r.created_at
});

const toButtonTpl = r => r && ({
  id: r.id, key: r.key, name: r.name, category: r.category, shape: r.shape, width: r.width, height: r.height,
  rxRatio: r.rx_ratio, marginRatio: r.margin_ratio, strokeRatio: r.stroke_ratio, role: r.role,
  hoverEffect: r.hover_effect, indicatorEffect: r.indicator_effect,
  nodesTemplate: JSON.parse(r.nodes_template || '[]'), meta: JSON.parse(r.meta || '{}'),
  builtin: !!r.builtin, createdBy: r.created_by, createdAt: r.created_at
});

export class TemplateRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  listDevices() { return this.db.prepare('SELECT * FROM template_devices ORDER BY builtin DESC, id').all().map(toDeviceTpl); }
  getDevice(id) { return toDeviceTpl(this.db.prepare('SELECT * FROM template_devices WHERE id = ?').get(Number(id))); }
  getDeviceByKey(key) { return toDeviceTpl(this.db.prepare('SELECT * FROM template_devices WHERE key = ?').get(String(key))); }

  createDevice(d) {
    const r = this.db.prepare(`INSERT INTO template_devices (key,name,category,width,height,corner_radius,grid,locked,meta,builtin,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      d.key, d.name, d.category || 'mobile', Number(d.width) || 390, Number(d.height) || 844,
      Number(d.cornerRadius ?? 44), Number(d.grid ?? 24), d.locked ? 1 : 0,
      JSON.stringify(d.meta || {}), d.builtin ? 1 : 0, d.createdBy ?? 1);
    const saved = this.getDevice(Number(r.lastInsertRowid));
    this.sync?.enqueue('template_devices', saved.id, 'upsert', saved);
    return saved;
  }

  updateDevice(id, patch) {
    const map = { key: 'key', name: 'name', category: 'category', width: 'width', height: 'height', cornerRadius: 'corner_radius', grid: 'grid' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.locked !== undefined) { sets.push('locked = ?'); args.push(patch.locked ? 1 : 0); }
    if (patch.meta !== undefined) { sets.push('meta = ?'); args.push(JSON.stringify(patch.meta)); }
    if (sets.length) this.db.prepare(`UPDATE template_devices SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    const saved = this.getDevice(id);
    this.sync?.enqueue('template_devices', id, 'upsert', saved);
    return saved;
  }

  deleteDevice(id) { return this.db.prepare('DELETE FROM template_devices WHERE id = ?').run(Number(id)).changes > 0; }

  listButtons() { return this.db.prepare('SELECT * FROM template_buttons ORDER BY builtin DESC, id').all().map(toButtonTpl); }
  getButton(id) { return toButtonTpl(this.db.prepare('SELECT * FROM template_buttons WHERE id = ?').get(Number(id))); }
  getButtonByKey(key) { return toButtonTpl(this.db.prepare('SELECT * FROM template_buttons WHERE key = ?').get(String(key))); }

  createButton(b) {
    const r = this.db.prepare(`INSERT INTO template_buttons
      (key,name,category,shape,width,height,rx_ratio,margin_ratio,stroke_ratio,role,hover_effect,indicator_effect,nodes_template,meta,builtin,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.key, b.name, b.category || 'standard', b.shape || 'pill', Number(b.width) || 160, Number(b.height) || 48,
      Number(b.rxRatio ?? 0.3), Number(b.marginRatio ?? 0.15), Number(b.strokeRatio ?? 1.0), b.role || 'button',
      b.hoverEffect || 'glow', b.indicatorEffect || 'none', JSON.stringify(b.nodesTemplate || []),
      JSON.stringify(b.meta || {}), b.builtin ? 1 : 0, b.createdBy ?? 1);
    const saved = this.getButton(Number(r.lastInsertRowid));
    this.sync?.enqueue('template_buttons', saved.id, 'upsert', saved);
    return saved;
  }

  updateButton(id, patch) {
    const map = { key: 'key', name: 'name', category: 'category', shape: 'shape', width: 'width', height: 'height',
      rxRatio: 'rx_ratio', marginRatio: 'margin_ratio', strokeRatio: 'stroke_ratio', role: 'role',
      hoverEffect: 'hover_effect', indicatorEffect: 'indicator_effect' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(map)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.nodesTemplate !== undefined) { sets.push('nodes_template = ?'); args.push(JSON.stringify(patch.nodesTemplate)); }
    if (patch.meta !== undefined) { sets.push('meta = ?'); args.push(JSON.stringify(patch.meta)); }
    if (sets.length) this.db.prepare(`UPDATE template_buttons SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    const saved = this.getButton(id);
    this.sync?.enqueue('template_buttons', id, 'upsert', saved);
    return saved;
  }

  deleteButton(id) { return this.db.prepare('DELETE FROM template_buttons WHERE id = ?').run(Number(id)).changes > 0; }
}

const toTranslation = r => r && ({
  id: r.id,
  tableName: r.table_name,
  itemType: r.table_name,
  recordId: r.record_id,
  itemId: r.record_id,
  fieldName: r.field_name,
  field: r.field_name,
  langCode: r.lang_code,
  lang: r.lang_code,
  translatedText: r.translated_text,
  value: r.translated_text,
  updatedAt: r.updated_at
});

export class TranslationRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  list({ tableName = '', itemType = '', recordId = null, itemId = null, langCode = '', lang = '' } = {}) {
    const where = [], args = [];
    const tbl = tableName || itemType;
    const rid = recordId ?? itemId;
    const lc = langCode || lang;
    if (tbl) { where.push('table_name = ?'); args.push(tbl); }
    if (rid != null && rid !== '') { where.push('record_id = ?'); args.push(Number(rid)); }
    if (lc) { where.push('lang_code = ?'); args.push(lc); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM translations ${w} ORDER BY table_name, record_id, lang_code`).all(...args).map(toTranslation);
  }

  upsert({ tableName, recordId, fieldName, langCode, translatedText }) {
    this.db.prepare(`INSERT INTO translations (table_name, record_id, field_name, lang_code, translated_text, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(table_name, record_id, field_name, lang_code) DO UPDATE SET translated_text = excluded.translated_text, updated_at = datetime('now')`)
      .run(tableName, Number(recordId), fieldName, langCode, String(translatedText ?? ''));
    const saved = toTranslation(this.db.prepare('SELECT * FROM translations WHERE table_name = ? AND record_id = ? AND field_name = ? AND lang_code = ?')
      .get(tableName, Number(recordId), fieldName, langCode));
    this.sync?.enqueue('translations', saved.id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    return this.db.prepare('DELETE FROM translations WHERE id = ?').run(Number(id)).changes > 0;
  }

  languages() {
    return this.db.prepare('SELECT DISTINCT lang_code AS code, COUNT(*) AS count FROM translations GROUP BY lang_code ORDER BY lang_code').all();
  }
}

const toTrash = r => r && ({
  id: r.id,
  itemType: r.item_type,
  originalId: r.original_id,
  key: r.item_key,
  name: r.item_name,
  label: r.label || '',
  category: r.category || 'general',
  projectId: r.project_id ?? 1,
  visibility: r.visibility || 'public',
  builtin: !!r.builtin,
  creatorId: r.creator_id ?? 1,
  rootOwnerId: r.root_owner_id ?? 1,
  deletedBy: r.deleted_by ?? 1,
  deletedByUsername: r.deleted_by_username || 'superadmin',
  creatorUsername: r.creator_username || 'superadmin',
  deletedAt: r.deleted_at,
  snapshot: JSON.parse(r.snapshot || '{}')
});

export class TrashRepository {
  constructor(db, sync = null) { this.db = db; this.sync = sync; }

  list({ itemType = '', projectId = null, visibility = '', q = '', deletedBy = null } = {}) {
    const where = [], args = [];
    if (deletedBy != null && deletedBy !== '') { where.push('t.deleted_by = ?'); args.push(Number(deletedBy)); }   // a trash is per user
    if (itemType) { where.push('t.item_type = ?'); args.push(itemType); }
    if (projectId != null && projectId !== '') { where.push('t.project_id = ?'); args.push(Number(projectId)); }
    if (visibility) { where.push('t.visibility = ?'); args.push(visibility); }
    if (q) {
      where.push(`(t.item_key LIKE ? ESCAPE '\\' OR t.item_name LIKE ? ESCAPE '\\' OR t.label LIKE ? ESCAPE '\\')`);
      const l = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
      args.push(l, l, l);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.prepare(`SELECT t.*, ud.username AS deleted_by_username, uc.username AS creator_username
      FROM trash_items t
      LEFT JOIN users ud ON ud.id = t.deleted_by
      LEFT JOIN users uc ON uc.id = t.creator_id
      ${w} ORDER BY t.id DESC`).all(...args).map(toTrash);
  }

  get(id) {
    return toTrash(this.db.prepare(`SELECT t.*, ud.username AS deleted_by_username, uc.username AS creator_username
      FROM trash_items t
      LEFT JOIN users ud ON ud.id = t.deleted_by
      LEFT JOIN users uc ON uc.id = t.creator_id
      WHERE t.id = ?`).get(Number(id)));
  }

  count({ deletedBy = null } = {}) {
    if (deletedBy != null && deletedBy !== '') return this.db.prepare('SELECT COUNT(*) AS n FROM trash_items WHERE deleted_by = ?').get(Number(deletedBy)).n;
    return this.db.prepare('SELECT COUNT(*) AS n FROM trash_items').get().n;
  }

  put(t) {
    const r = this.db.prepare(`INSERT INTO trash_items
      (item_type,original_id,item_key,item_name,label,category,project_id,visibility,builtin,creator_id,root_owner_id,deleted_by,snapshot)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      t.itemType, Number(t.originalId), t.itemKey || '', t.itemName || '', t.label || '',
      t.category || 'general', t.projectId ?? 1, t.visibility || 'public', t.builtin ? 1 : 0,
      t.creatorId ?? 1, t.rootOwnerId ?? 1, t.deletedBy ?? 1, JSON.stringify(t.snapshot || {}));
    const saved = this.get(Number(r.lastInsertRowid));
    this.sync?.enqueue('trash_items', saved.id, 'upsert', saved);
    return saved;
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM trash_items WHERE id = ?').run(Number(id)).changes > 0;
    if (ok) this.sync?.enqueue('trash_items', Number(id), 'delete', { id: Number(id) });
    return ok;
  }
}
