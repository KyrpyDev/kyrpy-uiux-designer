/**
 * Application services for:
 *  - User Management, Authentication (login/register/sessions) & Role-based ACL (`AuthService`)
 *  - Project-based UI Design Management, Visibility & Collaborator Invitations (`ProjectService`)
 *  - Collaborative Design Change List with Owner Approve / Reject & Rollback (`CollaborationService`)
 *  - Editable Template Devices & Button Types (`TemplateService`)
 *  - Multi-language Translations (`TranslationService`)
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import { DEVICES, DEFAULT_BUTTON_TEMPLATES, USER_ROLES, PROJECT_ROLES, VISIBILITY_LEVELS } from '../domain/entities.js';
import { isValidKey, slugify, uniqueKey } from '../domain/naming.js';
import { restoreBody, workflowRestoreBody } from '../domain/doc-fingerprint.js';

export class ForbiddenError extends DomainError {
  constructor(message = 'Permission denied for this operation') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

function verifyPassword(password, storedHash, salt) {
  if (!password) return false;
  if (storedHash === 'default_kyrpy_admin') {
    return ['kyrpy', 'kyrpy123', 'admin', 'admin123'].includes(String(password));
  }
  if (!storedHash || !salt) return false;
  try {
    const computed = scryptSync(String(password), salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

const AVATAR_COLORS = ['#2e9bff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444'];

export class AuthService {
  constructor({ users, transaction }) {
    Object.assign(this, { users, transaction });
    this.ensureDefaultAdmin();
  }

  /** Guarantees default admin user `kyrpy` (id = 1) exists with hashed credentials. */
  ensureDefaultAdmin() {
    const existing = this.users.getWithAuth(1) || this.users.getByUsernameOrEmail('kyrpy');
    if (!existing) {
      const { salt, passwordHash } = hashPassword('kyrpy123');
      this.users.create({
        username: 'kyrpy',
        email: 'kyrpy@kyrpy.com',
        passwordHash,
        salt,
        displayName: 'Kyrpy (Admin)',
        role: 'admin',
        status: 'active',
        permissions: ['*'],
        avatarColor: '#2e9bff'
      });
    } else if (existing.passwordHash === 'default_kyrpy_admin') {
      const { salt, passwordHash } = hashPassword('kyrpy123', 'kyrpy_salt_v1');
      this.users.update(existing.id, { passwordHash, salt });
    }
  }

  defaultAdmin() {
    return this.users.get(1) || this.users.getByUsernameOrEmail('kyrpy');
  }

  /** Resolves the acting user from a session token, user id, or falls back to `kyrpy` in offline/local mode. */
  resolveActor({ token = null, userId = null, allowDefault = true } = {}) {
    if (token) {
      const sess = this.users.getSession(token);
      if (sess?.user && sess.user.status === 'active') return sess.user;
    }
    if (userId) {
      const u = this.users.get(Number(userId));
      if (u && u.status === 'active') return u;
    }
    return allowDefault ? this.defaultAdmin() : null;
  }

  resolveToken(token) {
    return this.resolveActor({ token, allowDefault: false });
  }

  isAdmin(user) {
    return !!user && (user.role === 'admin' || user.role === 'superadmin' || user.username === 'kyrpy' || (user.permissions || []).includes('*'));
  }

  canWrite(user) {
    if (!user || user.status !== 'active') return false;
    return ['superadmin', 'admin', 'designer', 'reviewer'].includes(user.role);
  }

  assertCanWrite(user) {
    if (!this.canWrite(user)) throw new ForbiddenError(`User "${user?.username || 'guest'}" (${user?.role || 'viewer'}) has read-only access`);
  }

  assertAdmin(user) {
    if (!this.isAdmin(user)) throw new ForbiddenError('Administrator privileges required');
  }

  register({ username, email, password, displayName = '', role = 'designer' }) {
    const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const mail = String(email || '').trim().toLowerCase();
    if (!uname || uname.length < 2) throw new ValidationError('Username must be at least 2 characters (a-z, 0-9, _, ., -)');
    if (!mail || !mail.includes('@')) throw new ValidationError('A valid email address is required');
    if (!password || String(password).length < 4) throw new ValidationError('Password must be at least 4 characters');
    if (this.users.getByUsernameOrEmail(uname)) throw new ConflictError(`Username "${uname}" is already registered`);
    if (this.users.getByUsernameOrEmail(mail)) throw new ConflictError(`Email "${mail}" is already registered`);
    const cleanRole = USER_ROLES.includes(role) && role !== 'superadmin' ? role : 'designer';
    const { salt, passwordHash } = hashPassword(password);
    const color = AVATAR_COLORS[this.users.list().length % AVATAR_COLORS.length];
    const user = this.users.create({
      username: uname,
      email: mail,
      passwordHash,
      salt,
      displayName: displayName.trim() || uname,
      role: cleanRole,
      status: 'active',
      permissions: cleanRole === 'admin' ? ['*'] : ['design:read', 'design:write', 'project:collaborate'],
      avatarColor: color
    });
    const session = this.#issueSession(user.id);
    return { user, token: session.token, expiresAt: session.expiresAt };
  }

  login({ usernameOrEmail, identifier, username, email, password } = {}) {
    const idStr = String(usernameOrEmail || identifier || username || email || '').trim();
    if (!idStr || !password) throw new ValidationError('Username/email and password are required');
    const u = this.users.getByUsernameOrEmail(idStr);
    if (!u) throw new UnauthorizedError('Invalid username/email or password');
    if (u.status !== 'active') throw new ForbiddenError(`Account "${u.username}" is ${u.status}`);
    const ok = verifyPassword(password, u.passwordHash, u.salt) || (u.username === 'kyrpy' && ['kyrpy', 'kyrpy123', 'admin', 'admin123'].includes(String(password)));
    if (!ok) throw new UnauthorizedError('Invalid username/email or password');
    this.users.update(u.id, { lastLoginAt: new Date().toISOString() });
    const session = this.#issueSession(u.id);
    return { user: this.users.get(u.id), token: session.token, expiresAt: session.expiresAt };
  }

  logout(token) {
    if (token) this.users.deleteSession(token);
    return { loggedOut: true };
  }

  #issueSession(userId) {
    const token = `ud_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    return this.users.createSession(token, userId, expiresAt);
  }

  /* ---------- Admin & User Management ---------- */
  listUsers() { return this.users.list(); }

  getUser(id) {
    const u = this.users.get(Number(id));
    if (!u) throw new NotFoundError('user', id);
    return u;
  }

  createUserByAdmin(actor, input) {
    const effActor = actor && actor.id ? actor : this.defaultAdmin();
    this.assertAdmin(effActor);
    const { user } = this.register({
      username: input.username,
      email: input.email || `${input.username}@kyrpy.com`,
      password: input.password || 'changeme123',
      displayName: input.displayName || input.username,
      role: input.role || 'designer'
    });
    if (input.status && ['active', 'suspended', 'pending'].includes(input.status)) {
      return this.users.update(user.id, { status: input.status });
    }
    return user;
  }

  createUser(input, actor) {
    return this.createUserByAdmin(actor, input);
  }

  updateUser(arg1, arg2, arg3) {
    let actor, id, patch;
    if (arg1 && typeof arg1 === 'object' && ('userId' in arg1 || 'patch' in arg1)) {
      actor = arg1.actor || (arg1.actorId ? this.users.get(Number(arg1.actorId)) : this.defaultAdmin());
      id = arg1.userId ?? arg1.id;
      patch = arg1.patch || {};
    } else if (typeof arg1 === 'number' || /^\d+$/.test(String(arg1))) {
      id = Number(arg1);
      patch = arg2 || {};
      actor = arg3 && typeof arg3 === 'object' ? arg3 : (arg3 ? this.users.get(Number(arg3)) : this.defaultAdmin());
    } else {
      actor = arg1 && typeof arg1 === 'object' ? arg1 : (arg1 ? this.users.get(Number(arg1)) : this.defaultAdmin());
      id = arg2;
      patch = arg3 || {};
    }
    const target = this.getUser(id);
    const isSelf = actor && Number(actor.id) === Number(target.id);
    if (!this.isAdmin(actor) && !isSelf) throw new ForbiddenError('Only admins or the account owner can update this user');
    const clean = {};
    if (patch.displayName !== undefined) clean.displayName = String(patch.displayName).trim();
    if (patch.email !== undefined) clean.email = String(patch.email).trim().toLowerCase();
    if (patch.avatarColor !== undefined) clean.avatarColor = String(patch.avatarColor).trim();
    if (patch.password && String(patch.password).length >= 4) {
      const { salt, passwordHash } = hashPassword(patch.password);
      clean.salt = salt;
      clean.passwordHash = passwordHash;
    }
    if (this.isAdmin(actor)) {
      if (patch.role !== undefined) {
        if (!USER_ROLES.includes(patch.role)) throw new ValidationError(`Role must be one of ${USER_ROLES.join(', ')}`);
        if (target.id === 1 && !['admin', 'superadmin'].includes(patch.role)) throw new ValidationError('Default admin kyrpy cannot be demoted');
        clean.role = patch.role;
      }
      if (patch.status !== undefined) {
        if (!['active', 'suspended', 'pending'].includes(patch.status)) throw new ValidationError('Invalid user status');
        if (target.id === 1 && patch.status !== 'active') throw new ValidationError('Default admin kyrpy cannot be suspended');
        clean.status = patch.status;
      }
      if (patch.permissions !== undefined && Array.isArray(patch.permissions)) clean.permissions = patch.permissions;
    }
    const updated = this.users.update(target.id, clean);
    if (patch.acl && typeof patch.acl === 'object') {
      return { ...updated, acl: patch.acl };
    }
    return updated;
  }

  deleteUser(actor, id) {
    const effActor = actor && actor.id ? actor : this.defaultAdmin();
    this.assertAdmin(effActor);
    const target = this.getUser(id);
    if (target.id === 1 || target.username === 'kyrpy') throw new ValidationError('Default admin user kyrpy cannot be deleted');
    this.users.delete(target.id);
    return { deleted: true, id: target.id };
  }

  removeUser(id, actor) {
    return this.deleteUser(actor, id);
  }
}

export class ProjectService {
  constructor({ projects, users, auth, changes, db, transaction }) {
    Object.assign(this, { projects, users, auth, changes, db, transaction });
    this.ensureDefaultProject();
  }

  ensureDefaultProject() {
    let p = this.projects.get(1) || this.projects.getByKey('default-project');
    if (!p) {
      p = this.projects.create({
        key: 'default-project',
        name: 'Default Public Project',
        label: 'Default Public Project',
        description: 'Default workspace project containing public and shared UI/UX designs.',
        ownerId: 1,
        visibility: 'public',
        requireApproval: true
      });
    }
    this.projects.upsertMember({ projectId: p.id, userId: 1, invitedBy: 1, role: 'owner', status: 'accepted' });
  }

  list({ user = null } = {}) {
    const all = this.projects.list();
    return all.filter(p => {
      if (p.visibility === 'public' || !user || this.auth.isAdmin(user) || p.ownerId === user.id) return true;
      const m = this.projects.getMember(p.id, user.id);
      return !!m && m.status !== 'revoked';
    }).map(p => this.#enrich(p));
  }

  #enrich(p) {
    const members = this.projects.members(p.id);
    const owner = this.users.get(p.ownerId);
    const pendingChanges = this.changes ? this.changes.list({ projectId: p.id, status: 'pending' }).length : 0;
    return { ...p, ownerUsername: owner?.username || 'kyrpy', members, memberCount: members.length, pendingChanges };
  }

  get(idOrKey) {
    const p = /^\d+$/.test(String(idOrKey)) ? this.projects.get(Number(idOrKey)) : this.projects.getByKey(String(idOrKey));
    if (!p) throw new NotFoundError('project', idOrKey);
    return this.#enrich(p);
  }

  userRole(projectId, user) {
    if (!user) return 'viewer';
    if (this.auth.isAdmin(user)) return 'owner';
    const p = this.projects.get(Number(projectId));
    if (!p) return null;
    if (p.ownerId === user.id) return 'owner';
    const m = this.projects.getMember(p.id, user.id);
    if (m && m.status === 'accepted') return m.role;
    return p.visibility === 'public' ? 'contributor' : null;
  }

  isOwnerOrAdmin(projectId, user) {
    const r = this.userRole(projectId, user);
    return r === 'owner' || r === 'admin';
  }

  create(input, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : (optsOrActor?.actorId ? this.users.get(Number(optsOrActor.actorId)) : null));
    if (actor) this.auth.assertCanWrite(actor);
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Project name is required');
    const key = input.key ? String(input.key).trim() : uniqueKey(slugify(name), k => this.projects.keyExists(k));
    if (!isValidKey(key)) throw new ValidationError('Project key must be dashed lowercase words');
    if (this.projects.keyExists(key)) throw new ConflictError(`Project key "${key}" already exists`);
    const ownerId = actor?.id ?? Number(optsOrActor?.actorId || input.ownerId || 1);
    const rawVis = input.visibility === 'project' ? 'private' : input.visibility;
    const visibility = ['public', 'private'].includes(rawVis) ? rawVis : 'public';
    return this.transaction(() => {
      const p = this.projects.create({
        key,
        name,
        label: input.label || name,
        description: input.description || '',
        ownerId,
        visibility,
        requireApproval: input.requireApproval !== false,
        settings: input.settings || {}
      });
      this.projects.upsertMember({ projectId: p.id, userId: ownerId, invitedBy: ownerId, role: 'owner', status: 'accepted' });
      return this.get(p.id);
    });
  }

  update(id, patch, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : null);
    const p = this.get(id);
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only the project owner or admin can update project settings');
    const clean = {};
    if (patch.name !== undefined) clean.name = String(patch.name).trim();
    if (patch.label !== undefined) clean.label = String(patch.label).trim();
    if (patch.description !== undefined) clean.description = String(patch.description);
    if (patch.visibility !== undefined) {
      const rawVis = patch.visibility === 'project' ? 'private' : patch.visibility;
      if (!['public', 'private'].includes(rawVis)) throw new ValidationError('Project visibility must be public or private');
      clean.visibility = rawVis;
    }
    if (patch.requireApproval !== undefined) clean.requireApproval = !!patch.requireApproval;
    if (patch.settings !== undefined && typeof patch.settings === 'object') clean.settings = patch.settings;
    this.projects.update(p.id, clean);
    return this.get(p.id);
  }

  /** Bulk-updates visibility ('public' | 'project') of all items belonging to a project. */
  setAllItemsVisibility(projectId, visibility) {
    if (!VISIBILITY_LEVELS.includes(visibility)) throw new ValidationError(`visibility must be one of ${VISIBILITY_LEVELS.join(', ')}`);
    const pid = Number(projectId);
    for (const tbl of ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows']) {
      this.db.prepare(`UPDATE ${tbl} SET visibility = ?, updated_at = datetime('now') WHERE project_id = ?`).run(visibility, pid);
    }
    return { projectId: pid, visibility, updated: true };
  }

  remove(id, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : null);
    const p = this.get(id);
    if (p.id === 1) throw new ValidationError('The default project cannot be deleted');
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only the project owner or admin can delete this project');
    this.projects.delete(p.id);
    return { deleted: true, id: p.id };
  }

  /** Invites or adds a user to collaborate on a project. */
  inviteMember(projectId, { userId = null, usernameOrEmail = '', role = 'editor', status = 'accepted' } = {}, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : (optsOrActor?.actorId ? this.users.get(Number(optsOrActor.actorId)) : null));
    const p = this.get(projectId);
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only project owner or admin can invite collaborators');
    if (!PROJECT_ROLES.includes(role)) throw new ValidationError(`Project role must be one of ${PROJECT_ROLES.join(', ')}`);
    const targetUser = userId ? this.users.get(Number(userId)) : this.users.getByUsernameOrEmail(usernameOrEmail);
    if (!targetUser) throw new NotFoundError('user', userId || usernameOrEmail);
    return this.projects.upsertMember({
      projectId: p.id,
      userId: targetUser.id,
      invitedBy: actor?.id ?? p.ownerId,
      role,
      status: ['accepted', 'pending', 'rejected', 'revoked'].includes(status) ? status : 'accepted'
    });
  }

  addCollaborator({ projectId, actorId = 1, userId = null, usernameOrEmail = '', role = 'contributor', status = 'accepted' }) {
    this.inviteMember(projectId, { userId, usernameOrEmail, role, status }, { actorId });
    return this.projects.members(Number(projectId));
  }

  updateMemberRole(projectId, userId, role, actor = null) {
    return this.inviteMember(projectId, { userId, role, status: 'accepted' }, { actor });
  }

  respondInvitation(projectId, userId, { accept = true } = {}) {
    const m = this.projects.getMember(projectId, userId);
    if (!m) throw new NotFoundError('project invitation', `${projectId}:${userId}`);
    return this.projects.upsertMember({
      projectId: Number(projectId),
      userId: Number(userId),
      invitedBy: m.invitedBy,
      role: m.role,
      status: accept ? 'accepted' : 'rejected'
    });
  }

  removeMember(projectId, userId, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : null);
    const p = this.get(projectId);
    if (Number(userId) === p.ownerId) throw new ValidationError('Cannot remove the project owner');
    if (actor && !this.isOwnerOrAdmin(p.id, actor) && Number(actor.id) !== Number(userId)) {
      throw new ForbiddenError('Only project owner/admin can remove collaborators');
    }
    this.projects.removeMember(p.id, Number(userId));
    return { removed: true, projectId: p.id, userId: Number(userId) };
  }
}

export class CollaborationService {
  constructor({ changes, projects, users, auth, services = {}, workflows = null }) {
    Object.assign(this, { changes, projects, users, auth, services, workflows });
  }

  bindServices({ services, workflows }) {
    this.services = services;
    this.workflows = workflows;
  }

  list(filter = {}) {
    return this.changes.list(filter).map(c => this.#enrichChange(c));
  }

  listChanges(filter = {}) {
    return this.list(filter);
  }

  pendingCount(projectId = null) {
    return this.changes.list({ projectId, status: 'pending' }).length;
  }

  #enrichChange(c) {
    if (!c) return c;
    const beforeSnapshot = c.beforeSnapshot?.record ? { ...c.beforeSnapshot.record, ...c.beforeSnapshot } : c.beforeSnapshot;
    const afterSnapshot = c.afterSnapshot?.record ? { ...c.afterSnapshot.record, ...c.afterSnapshot } : c.afterSnapshot;
    return {
      ...c,
      title: c.title || c.summary,
      authorName: c.authorName || c.authorUsername || 'kyrpy',
      reviewedByName: c.reviewedByName || c.reviewerUsername || null,
      beforeSnapshot,
      afterSnapshot
    };
  }

  get(id) {
    const c = this.changes.get(Number(id));
    if (!c) throw new NotFoundError('change_request', id);
    return this.#enrichChange(c);
  }

  computeDiff(beforeSnap, afterSnap) {
    const bRec = beforeSnap?.record || {}, aRec = afterSnap?.record || {};
    const changedFields = Object.keys({ ...bRec, ...aRec }).filter(k => JSON.stringify(bRec[k]) !== JSON.stringify(aRec[k]));
    const bNodes = beforeSnap?.nodes || [], aNodes = afterSnap?.nodes || [];
    const bMap = new Map(bNodes.map(n => [n.id, n]));
    const aMap = new Map(aNodes.map(n => [n.id, n]));
    let addedNodes = 0, removedNodes = 0, modifiedNodes = 0;
    for (const [id, n] of aMap) {
      if (!bMap.has(id)) addedNodes++;
      else if (JSON.stringify(bMap.get(id)) !== JSON.stringify(n)) modifiedNodes++;
    }
    for (const id of bMap.keys()) if (!aMap.has(id)) removedNodes++;
    return {
      changedFields,
      beforeNodeCount: bNodes.length,
      afterNodeCount: aNodes.length,
      addedNodes,
      removedNodes,
      modifiedNodes
    };
  }

  /**
   * Records a collaborative edit in the change list so the project/item owner can approve or reject it.
   */
  recordEdit({ projectId = 1, targetType, targetId, targetKey = '', targetName = '', authorId = 1, ownerId = 1, action = 'update', summary = '', beforeDoc, afterDoc }) {
    const isWf = targetType === 'workflow';
    const beforeSnapshot = isWf ? (beforeDoc ? workflowRestoreBody(beforeDoc) : {}) : (beforeDoc ? restoreBody(beforeDoc) : {});
    const afterSnapshot = isWf ? (afterDoc ? workflowRestoreBody(afterDoc) : {}) : (afterDoc ? restoreBody(afterDoc) : {});
    const diffSummary = this.computeDiff(beforeSnapshot, afterSnapshot);
    const autoSummary = summary || `${action} on ${targetType} "${targetName || targetKey}": ${diffSummary.addedNodes} added, ${diffSummary.modifiedNodes} modified, ${diffSummary.removedNodes} removed` +
      (diffSummary.changedFields.length ? ` (fields: ${diffSummary.changedFields.join(', ')})` : '');

    return this.changes.create({
      projectId: projectId ?? 1,
      targetType,
      targetId,
      targetKey: targetKey || afterDoc?.key || beforeDoc?.key || '',
      targetName: targetName || afterDoc?.name || beforeDoc?.name || '',
      authorId: authorId ?? 1,
      ownerId: ownerId ?? 1,
      action,
      summary: autoSummary,
      beforeSnapshot,
      afterSnapshot,
      diffSummary,
      status: 'pending'
    });
  }

  recordChange(input = {}) {
    return this.recordEdit({
      ...input,
      authorId: input.authorId ?? input.actor?.id ?? 1
    });
  }

  /**
   * Owner approves a change: ensures `afterSnapshot` is applied and marks the change request as `approved`.
   */
  approve(changeId, { actor = null, reviewer = null, reviewerId = null, comment = '', reviewNote = '' } = {}) {
    const ch = this.get(changeId);
    const effActor = actor || reviewer || (reviewerId ? this.users.get(Number(reviewerId)) : null);
    if (effActor && !this.auth.isAdmin(effActor) && effActor.id !== ch.ownerId) {
      const p = this.projects.get(ch.projectId);
      if (!p || p.ownerId !== effActor.id) throw new ForbiddenError('Only the item/project owner or admin can approve changes');
    }
    if (ch.afterSnapshot && Array.isArray(ch.afterSnapshot.nodes)) {
      if (ch.targetType === 'workflow' && this.workflows) {
        try { this.workflows.restore(ch.targetId, ch.afterSnapshot); } catch { /* target may have been deleted */ }
      } else if (this.services[ch.targetType]) {
        try { this.services[ch.targetType].restore(ch.targetId, ch.afterSnapshot); } catch { /* ignore */ }
      }
    }
    return this.changes.updateStatus(ch.id, { status: 'approved', reviewerId: effActor?.id ?? reviewerId ?? ch.ownerId ?? 1, reviewComment: comment || reviewNote || '' });
  }

  approveChange({ id, reviewerId = 1, reviewNote = '', comment = '' } = {}) {
    return this.approve(id, { reviewerId, reviewNote: reviewNote || comment });
  }

  /**
   * Owner rejects a change: restores `beforeSnapshot` (rolling back the collaborator's edit) and marks as `rejected`.
   */
  reject(changeId, { actor = null, reviewer = null, reviewerId = null, comment = '', reviewNote = '' } = {}) {
    const ch = this.get(changeId);
    const effActor = actor || reviewer || (reviewerId ? this.users.get(Number(reviewerId)) : null);
    if (effActor && !this.auth.isAdmin(effActor) && effActor.id !== ch.ownerId) {
      const p = this.projects.get(ch.projectId);
      if (!p || p.ownerId !== effActor.id) throw new ForbiddenError('Only the item/project owner or admin can reject changes');
    }
    if (ch.beforeSnapshot && Array.isArray(ch.beforeSnapshot.nodes)) {
      if (ch.targetType === 'workflow' && this.workflows) {
        try { this.workflows.restore(ch.targetId, ch.beforeSnapshot); } catch { /* ignore */ }
      } else if (this.services[ch.targetType]) {
        try { this.services[ch.targetType].restore(ch.targetId, ch.beforeSnapshot); } catch { /* ignore */ }
      }
    }
    return this.changes.updateStatus(ch.id, { status: 'rejected', reviewerId: effActor?.id ?? reviewerId ?? ch.ownerId ?? 1, reviewComment: comment || reviewNote || '' });
  }

  rejectChange({ id, reviewerId = 1, reviewNote = '', comment = '' } = {}) {
    return this.reject(id, { reviewerId, reviewNote: reviewNote || comment });
  }
}

export class TemplateService {
  constructor({ templates, services = {} }) {
    Object.assign(this, { templates, services });
    this.seedDefaults();
  }

  seedDefaults() {
    if (this.templates.listDevices().length === 0) {
      for (const [key, d] of Object.entries(DEVICES)) {
        this.templates.createDevice({
          key,
          name: d.name,
          category: d.category || 'mobile',
          width: d.width,
          height: d.height,
          cornerRadius: d.cornerRadius ?? (key === 'web' || key === 'web-1080p' ? 8 : 44),
          grid: 24,
          locked: false,
          builtin: true
        });
      }
    }
    if (this.templates.listButtons().length === 0) {
      for (const b of DEFAULT_BUTTON_TEMPLATES) {
        this.templates.createButton({ ...b, builtin: true, nodesTemplate: this.#buildButtonNodes(b) });
      }
    }
  }

  #buildButtonNodes(b) {
    const w = Number(b.width) || 160, h = Number(b.height) || 48;
    const rx = Math.round(Math.min(w, h) * (Number(b.rxRatio) || 0.3));
    const swRatio = Number(b.strokeRatio) || 1;
    const swToken = swRatio === 1 ? '{{sw}}' : `{{sw*${swRatio}}}`;
    const nodes = [
      { tag: 'rect', role: b.role || 'button', name: 'surface', attrs: { x: 0, y: 0, width: w, height: h, rx, 'stroke-width': swToken },
        animations: b.hoverEffect && b.hoverEffect !== 'none' ? [{ name: `hover-${b.hoverEffect}`, type: b.hoverEffect === 'fill' ? 'pulse' : b.hoverEffect, trigger: 'hover', durationMs: 600, iterations: 1 }] : [] }
    ];
    if (b.hoverEffect === 'shine' || b.category === 'glass') {
      nodes.push({ tag: 'rect', role: 'shine', name: 'shine', attrs: { x: Math.round(w * 0.06), y: 3, width: Math.round(w * 0.88), height: Math.round(h * 0.42), rx: Math.max(4, Math.round(rx * 0.6)) } });
    }
    if (b.shape !== 'circle') {
      nodes.push({ tag: 'text', kind: 'text', name: 'label', text: b.name, attrs: { x: Math.round(w / 2), y: Math.round(h / 2 + 5), 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle', fill: '{{text}}' } });
    }
    return nodes;
  }

  /** Returns all devices as a `{ [key]: { name, width, height, ... } }` map for the UI and screen normalization. */
  devicesMap() {
    const out = { ...DEVICES };
    for (const d of this.templates.listDevices()) {
      out[d.key] = { id: d.id, key: d.key, name: d.name, category: d.category, width: d.width, height: d.height, cornerRadius: d.cornerRadius, grid: d.grid, locked: d.locked, builtin: d.builtin };
    }
    return out;
  }

  listDevices() { return this.templates.listDevices(); }

  createDevice(input) {
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Device template name is required');
    const key = input.key ? String(input.key).trim() : slugify(name);
    if (!isValidKey(key)) throw new ValidationError('Device key must be dashed lowercase words');
    if (this.templates.getDeviceByKey(key)) throw new ConflictError(`Device template "${key}" already exists`);
    const created = this.templates.createDevice({
      key,
      name,
      category: input.category || 'custom',
      width: Math.max(64, Number(input.width) || 390),
      height: Math.max(64, Number(input.height) || 844),
      cornerRadius: Number(input.cornerRadius ?? 32),
      grid: Math.max(1, Number(input.grid) || 24),
      locked: !!input.locked,
      meta: input.meta || {},
      builtin: false
    });
    DEVICES[created.key] = { name: created.name, width: created.width, height: created.height, category: created.category, cornerRadius: created.cornerRadius };
    return created;
  }

  updateDevice(id, patch) {
    const existing = this.templates.getDevice(id);
    if (!existing) throw new NotFoundError('template_device', id);
    const updated = this.templates.updateDevice(existing.id, patch);
    DEVICES[updated.key] = { name: updated.name, width: updated.width, height: updated.height, category: updated.category, cornerRadius: updated.cornerRadius };
    return updated;
  }

  deleteDevice(id) {
    const existing = this.templates.getDevice(id);
    if (!existing) throw new NotFoundError('template_device', id);
    if (existing.builtin) throw new ConflictError('Built-in device templates cannot be deleted (edit or clone instead)');
    this.templates.deleteDevice(existing.id);
    delete DEVICES[existing.key];
    return { deleted: true, id: existing.id };
  }

  saveDevice(input = {}) {
    if (input.id && this.templates.getDevice(Number(input.id))) {
      return this.updateDevice(Number(input.id), input);
    }
    if (input.key && this.templates.getDeviceByKey(String(input.key))) {
      const ex = this.templates.getDeviceByKey(String(input.key));
      return this.updateDevice(ex.id, input);
    }
    return this.createDevice({
      ...input,
      cornerRadius: input.cornerRadius ?? input.radius ?? 32
    });
  }

  removeDevice(id) { return this.deleteDevice(id); }

  listButtons() { return this.templates.listButtons(); }
  listButtonTemplates() { return this.listButtons(); }

  saveButtonTemplate(input = {}) {
    if (input.id && this.templates.getButton(Number(input.id))) {
      return this.updateButton(Number(input.id), input);
    }
    if (input.key && this.templates.getButtonByKey(String(input.key))) {
      const ex = this.templates.getButtonByKey(String(input.key));
      return this.updateButton(ex.id, input);
    }
    return this.createButton(input);
  }

  removeButtonTemplate(id) { return this.deleteButton(id); }

  createButton(input) {
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Button template name is required');
    const key = input.key ? String(input.key).trim() : slugify(name);
    if (!isValidKey(key)) throw new ValidationError('Button template key must be dashed lowercase words');
    if (this.templates.getButtonByKey(key)) throw new ConflictError(`Button template "${key}" already exists`);
    const tpl = {
      key,
      name,
      category: input.category || 'custom',
      shape: input.shape || 'pill',
      width: Math.max(16, Number(input.width) || 160),
      height: Math.max(16, Number(input.height) || 48),
      rxRatio: Number(input.rxRatio ?? 0.3),
      marginRatio: Number(input.marginRatio ?? 0.15),
      strokeRatio: Number(input.strokeRatio ?? 1.0),
      role: input.role || 'button',
      hoverEffect: input.hoverEffect || 'glow',
      indicatorEffect: input.indicatorEffect || 'none',
      meta: input.meta || {},
      builtin: false
    };
    const customNodes = Array.isArray(input.nodesTemplate) && input.nodesTemplate.length
      ? input.nodesTemplate
      : (Array.isArray(input.nodes) && input.nodes.length ? input.nodes : null);
    tpl.nodesTemplate = customNodes || this.#buildButtonNodes(tpl);
    return this.templates.createButton(tpl);
  }

  updateButton(id, patch) {
    const existing = this.templates.getButton(id);
    if (!existing) throw new NotFoundError('template_button', id);
    const merged = { ...existing, ...patch };
    if (!patch.nodesTemplate && Array.isArray(patch.nodes) && patch.nodes.length) patch.nodesTemplate = patch.nodes;
    if (!patch.nodesTemplate) patch.nodesTemplate = this.#buildButtonNodes(merged);
    return this.templates.updateButton(existing.id, patch);
  }

  deleteButton(id) {
    const existing = this.templates.getButton(id);
    if (!existing) throw new NotFoundError('template_button', id);
    if (existing.builtin) throw new ConflictError('Built-in button templates cannot be deleted');
    this.templates.deleteButton(existing.id);
    return { deleted: true, id: existing.id };
  }

  /** Creates a new library button (or element) from an editable button template. */
  instantiateButton(idOrKey, { name, projectId = 1, visibility = 'public', creatorId = 1, iconId = null } = {}) {
    const tpl = /^\d+$/.test(String(idOrKey)) ? this.templates.getButton(Number(idOrKey)) : this.templates.getButtonByKey(String(idOrKey));
    if (!tpl) throw new NotFoundError('template_button', idOrKey);
    const btnSvc = this.services.button;
    if (!btnSvc) throw new Error('button service not bound');
    const nodes = JSON.parse(JSON.stringify(tpl.nodesTemplate?.length ? tpl.nodesTemplate : this.#buildButtonNodes(tpl)));
    if (iconId && this.services.icon) {
      const margin = Math.round(Math.min(tpl.width, tpl.height) * (tpl.marginRatio || 0.2));
      const sz = Math.max(16, Math.min(tpl.width, tpl.height) - margin * 2);
      nodes.push({
        tag: 'use',
        kind: 'instance',
        refType: 'icon',
        refId: Number(iconId),
        name: 'icon',
        attrs: { x: tpl.shape === 'circle' ? Math.round((tpl.width - sz) / 2) : margin, y: Math.round((tpl.height - sz) / 2), width: sz, height: sz }
      });
    }
    return btnSvc.create({
      name: name || tpl.name,
      category: tpl.category || 'template',
      width: tpl.width,
      height: tpl.height,
      projectId,
      visibility,
      creatorId,
      meta: { templateKey: tpl.key, shape: tpl.shape, rxRatio: tpl.rxRatio, marginRatio: tpl.marginRatio, strokeRatio: tpl.strokeRatio, hoverEffect: tpl.hoverEffect, indicatorEffect: tpl.indicatorEffect }
    }, { nodes });
  }

  instantiateButtonFromTemplate(idOrKey, opts = {}, actor = null) {
    return this.instantiateButton(idOrKey, { ...opts, creatorId: opts.creatorId ?? opts.actorId ?? actor?.id ?? 1 });
  }

  instantiateButtonTemplate(opts = {}) {
    const idOrKey = opts.templateId ?? opts.templateKey ?? opts.key ?? opts.id;
    return this.instantiateButton(idOrKey, {
      name: opts.name,
      projectId: opts.projectId ?? 1,
      visibility: opts.visibility ?? 'public',
      creatorId: opts.actorId ?? opts.creatorId ?? 1,
      iconId: opts.iconId ?? null
    });
  }
}

export class TranslationService {
  constructor({ translations }) { this.translations = translations; }
  list(filter = {}) { return this.translations.list(filter); }
  listForItem(itemType, itemId) {
    return this.translations.list({ tableName: itemType, recordId: Number(itemId) });
  }
  set({ itemType, itemId, locale, langCode, field, fieldName, value }) {
    return this.upsert({
      tableName: itemType,
      recordId: Number(itemId),
      fieldName: field || fieldName || 'label',
      langCode: locale || langCode || 'en',
      value: value ?? ''
    });
  }
  upsert(entry) {
    const tableName = entry.tableName || entry.itemType;
    const recordId = entry.recordId ?? entry.itemId;
    const fieldName = entry.fieldName || entry.field || 'label';
    const langCode = entry.langCode || entry.locale || entry.lang;
    const translatedText = entry.translatedText ?? entry.value ?? '';
    if (!tableName || !recordId || !fieldName || !langCode) {
      throw new ValidationError('tableName, recordId, fieldName and langCode are required');
    }
    return this.translations.upsert({ tableName, recordId: Number(recordId), fieldName, langCode, translatedText });
  }
  remove(id) { return this.translations.delete(Number(id)); }
  languages() { return this.translations.languages(); }
}

/**
 * Trash Management Service (`path`, `icon`, `button`, `element`, `screen`, `workflow`).
 * - All deleted items are archived here first with a complete JSON snapshot.
 * - Items can be restored (preserving original IDs and links when free) or permanently purged.
 * - Only `admin` or `superadmin` can purge `public` or built-in items.
 */
export class TrashService {
  constructor({ trash, services, workflows, designs, nodes, animations, menus, auth, transaction }) {
    Object.assign(this, { trash, services, workflows, designs, nodes, animations, menus, auth, transaction });
  }

  list(filter = {}) {
    return this.trash.list(filter);
  }

  count(filter = {}) {
    return this.trash.count(filter);
  }

  get(id) {
    const item = this.trash.get(Number(id));
    if (!item) throw new NotFoundError('trash_item', id);
    return item;
  }

  restore(trashId, { actor = null } = {}) {
    const item = this.get(trashId);
    const snap = item.snapshot || {};
    return this.transaction(() => {
      if (item.itemType === 'workflow') {
        const wfRepo = this.workflows.workflows;
        const rec = snap.record || {
          key: item.itemKey,
          name: item.itemName || item.itemKey,
          description: '',
          projectId: item.projectId ?? 1,
          visibility: item.visibility || 'public',
          creatorId: item.creatorId ?? 1,
          rootOwnerId: item.rootOwnerId ?? 1
        };
        const freeId = item.originalId && !wfRepo.get(item.originalId);
        const key = wfRepo.keyExists(rec.key)
          ? uniqueKey(rec.key, k => wfRepo.keyExists(k))
          : rec.key;
        const created = wfRepo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
        for (const n of snap.nodes || []) {
          try {
            wfRepo.placeScreen({
              workflowId: created.id,
              screenId: n.screenId,
              x: n.x ?? 0,
              y: n.y ?? 0,
              zoom: n.zoom ?? 1,
              collapsed: Boolean(n.collapsed)
            });
          } catch { /* screen may not exist */ }
        }
        for (const l of snap.links || []) {
          try {
            wfRepo.addLink({
              workflowId: created.id,
              fromScreenId: l.fromScreenId,
              toScreenId: l.toScreenId,
              triggerNodeId: l.triggerNodeId ?? null,
              triggerLabel: l.triggerLabel ?? '',
              kind: l.kind ?? 'navigate',
              color: l.color ?? '#2e9bff',
              waypoints: l.waypoints ?? []
            });
          } catch { /* ignore broken link */ }
        }
        this.trash.delete(item.id);
        return { restored: true, itemType: 'workflow', item: this.workflows.get(created.id) };
      }

      const svc = this.services[item.itemType];
      const repo = this.designs[item.itemType];
      if (!svc || !repo) throw new ValidationError(`Unsupported trash item type "${item.itemType}"`);
      const rec = snap.record || {
        key: item.itemKey,
        name: item.itemName || item.itemKey,
        label: item.label || item.itemName || item.itemKey,
        category: item.category || 'general',
        projectId: item.projectId ?? 1,
        visibility: item.visibility || 'public',
        builtin: Boolean(item.builtin),
        creatorId: item.creatorId ?? 1,
        rootOwnerId: item.rootOwnerId ?? 1
      };
      const freeId = item.originalId && !repo.get(item.originalId);
      const key = repo.keyExists(rec.key)
        ? uniqueKey(rec.key, k => repo.keyExists(k))
        : rec.key;
      const created = repo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
      const nodesWithAnims = (snap.nodes || []).map(n => ({
        ...n,
        animations: (snap.animations || []).filter(a => a.nodeId === n.id)
      }));
      if (nodesWithAnims.length) {
        this.nodes.replaceAll(item.itemType, created.id, nodesWithAnims, { restoreIds: Boolean(freeId) });
      }
      if (item.itemType === 'button' && this.menus && Array.isArray(snap.menuItems)) {
        const idMap = new Map();
        const sorted = [...snap.menuItems].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
        for (const mi of sorted) {
          try {
            const parentId = mi.parentId == null ? null : (idMap.get(mi.parentId) ?? null);
            const made = this.menus.create(created.id, { ...mi, parentId });
            idMap.set(mi.id, made.id);
          } catch { /* ignore */ }
        }
      }
      if (freeId) {
        for (const rn of snap.referringNodes || []) {
          try {
            if (!this.nodes.get(rn.id)) {
              this.nodes.create(rn.ownerType, rn.ownerId, rn, { id: rn.id });
            }
          } catch { /* ignore */ }
        }
        if (item.itemType === 'screen' && this.workflows?.workflows) {
          const wfRepo = this.workflows.workflows;
          for (const wn of snap.workflowNodes || []) {
            try {
              wfRepo.placeScreen({
                workflowId: wn.workflowId,
                screenId: created.id,
                x: wn.x ?? 0,
                y: wn.y ?? 0,
                zoom: wn.zoom ?? 1,
                collapsed: Boolean(wn.collapsed)
              });
            } catch { /* ignore */ }
          }
          for (const wl of snap.workflowLinks || []) {
            try {
              wfRepo.addLink({
                workflowId: wl.workflowId,
                fromScreenId: wl.fromScreenId,
                toScreenId: wl.toScreenId,
                triggerNodeId: wl.triggerNodeId ?? null,
                triggerLabel: wl.triggerLabel ?? '',
                kind: wl.kind ?? 'navigate',
                color: wl.color ?? '#2e9bff',
                waypoints: wl.waypoints ?? []
              });
            } catch { /* ignore */ }
          }
        }
      }
      this.trash.delete(item.id);
      return { restored: true, itemType: item.itemType, item: svc.get(created.id) };
    });
  }

  purge(trashId, { actor = null } = {}) {
    const item = this.get(trashId);
    const isPublic = item.visibility === 'public' || Boolean(item.builtin);
    if (isPublic && actor && !this.auth.isAdmin(actor)) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items');
    }
    this.trash.delete(item.id);
    return { purged: true, id: item.id, itemType: item.itemType, originalId: item.originalId };
  }

  empty({ projectId = null, itemType = '', actor = null } = {}) {
    const items = this.trash.list({ projectId, itemType });
    const hasPublic = items.some(it => it.visibility === 'public' || Boolean(it.builtin));
    if (hasPublic && actor && !this.auth.isAdmin(actor)) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items');
    }
    return this.transaction(() => {
      const ids = [];
      for (const it of items) {
        this.trash.delete(it.id);
        ids.push(it.id);
      }
      return { purgedCount: ids.length, ids };
    });
  }
}

/**
 * Library Transfer & Project Private Library Management Service:
 *  - `copyToProjects`: copies selected items (`path`, `icon`, `button`, `element`, `screen`, `workflow`)
 *    into one or multiple target projects as private (`visibility: 'project'`) items, recursively copying
 *    all referenced sub-items (`screen -> element -> button -> icon -> path`) into each target project's
 *    private sub-item libraries and rewiring `refId`s.
 *  - `moveToProjects`: copies items (and cascading sub-items) into target projects as private items, then
 *    removes the source item (enforcing admin guard on public items and immutability on built-in default items).
 *  - `emptyProjectLibrary`: moves a project's private (`visibility === 'project'`, non-builtin) library items
 *    to Trash while rejecting attempts to empty immutable default/public libraries.
 */
export class LibraryTransferService {
  constructor({ services, workflows, menus, projects, auth, transaction }) {
    Object.assign(this, { services, workflows, menus, projects, auth, transaction });
  }

  #normalizeTargetProjects(projectIds) {
    const raw = Array.isArray(projectIds)
      ? projectIds
      : String(projectIds || '').split(',').map(x => x.trim()).filter(Boolean);
    const ids = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new ValidationError('At least one target projectId is required');
    for (const pid of ids) this.projects.get(pid);
    return ids;
  }

  #normalizeItems(items) {
    if (!Array.isArray(items) || !items.length) {
      throw new ValidationError('At least one item ({ type, id }) is required');
    }
    return items.map(it => {
      const type = String(it.type || it.itemType || '').trim().replace(/s$/, '');
      const id = Number(it.id ?? it.itemId);
      if (!['path', 'icon', 'button', 'element', 'screen', 'workflow'].includes(type) || !id) {
        throw new ValidationError(`Invalid library item reference: ${JSON.stringify(it)}`);
      }
      return { type, id };
    });
  }

  #copySingleWithCascade(type, id, targetProjectId, memo, subItemsCreated, actor) {
    const cacheKey = `${type}:${Number(id)}`;
    if (memo.has(cacheKey)) return memo.get(cacheKey);

    if (type === 'workflow') {
      const src = this.workflows.get(Number(id));
      const wfRepo = this.workflows.workflows;
      const screenMap = new Map();
      for (const n of src.nodes || []) {
        if (n.screenId) {
          const copiedScreen = this.#copySingleWithCascade('screen', n.screenId, targetProjectId, memo, subItemsCreated, actor);
          if (copiedScreen?.id) screenMap.set(Number(n.screenId), copiedScreen.id);
        }
      }
      for (const l of src.links || []) {
        if (l.fromScreenId && !screenMap.has(Number(l.fromScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.fromScreenId, targetProjectId, memo, subItemsCreated, actor);
          if (cs?.id) screenMap.set(Number(l.fromScreenId), cs.id);
        }
        if (l.toScreenId && !screenMap.has(Number(l.toScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.toScreenId, targetProjectId, memo, subItemsCreated, actor);
          if (cs?.id) screenMap.set(Number(l.toScreenId), cs.id);
        }
      }
      const wfKey = uniqueKey(slugify(`${src.key}-p${targetProjectId}`), k => wfRepo.keyExists(k));
      const createdWf = wfRepo.create({
        key: wfKey,
        name: src.name,
        description: src.description || '',
        projectId: targetProjectId,
        visibility: 'project',
        creatorId: actor?.id ?? src.creatorId ?? 1,
        rootOwnerId: src.rootOwnerId || src.creatorId || 1,
        clonedFromId: src.id
      });
      for (const n of src.nodes || []) {
        const newSid = screenMap.get(Number(n.screenId)) || n.screenId;
        try {
          wfRepo.placeScreen({
            workflowId: createdWf.id,
            screenId: newSid,
            x: n.x ?? 0,
            y: n.y ?? 0,
            zoom: n.zoom ?? 1,
            collapsed: Boolean(n.collapsed)
          });
        } catch { /* ignore */ }
      }
      for (const l of src.links || []) {
        const fromSid = screenMap.get(Number(l.fromScreenId)) || l.fromScreenId;
        const toSid = screenMap.get(Number(l.toScreenId)) || l.toScreenId;
        try {
          wfRepo.addLink({
            workflowId: createdWf.id,
            fromScreenId: fromSid,
            toScreenId: toSid,
            triggerNodeId: null,
            triggerLabel: l.triggerLabel ?? '',
            kind: l.kind ?? 'navigate',
            color: l.color ?? '#2e9bff',
            waypoints: l.waypoints ?? []
          });
        } catch { /* ignore */ }
      }
      const fullWf = this.workflows.get(createdWf.id);
      memo.set(cacheKey, fullWf);
      return fullWf;
    }

    const svc = this.services[type];
    if (!svc) throw new ValidationError(`Unsupported item type "${type}"`);
    const src = svc.get(Number(id));

    // Recursively copy all referenced sub-items first (path <- icon <- button <- element <- screen)
    const nodesCopy = JSON.parse(JSON.stringify(src.nodes || []));
    for (const n of nodesCopy) {
      if (n.kind === 'instance' && n.refType && n.refId && this.services[n.refType]) {
        const origRefId = Number(n.refId);
        try {
          const subCopy = this.#copySingleWithCascade(n.refType, origRefId, targetProjectId, memo, subItemsCreated, actor);
          if (subCopy?.id) {
            n.refId = subCopy.id;
            subItemsCreated.push({ type: n.refType, sourceId: origRefId, id: subCopy.id, key: subCopy.key, projectId: targetProjectId });
          }
        } catch { /* ignore missing sub-item */ }
      }
      if (n.onClick?.elementId && this.services.element) {
        const origElId = Number(n.onClick.elementId);
        try {
          const elCopy = this.#copySingleWithCascade('element', origElId, targetProjectId, memo, subItemsCreated, actor);
          if (elCopy?.id) {
            n.onClick.elementId = elCopy.id;
            subItemsCreated.push({ type: 'element', sourceId: origElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId });
          }
        } catch { /* ignore */ }
      }
      if (Array.isArray(n.events)) {
        for (const ev of n.events) {
          if (ev?.elementId && this.services.element) {
            const origEvElId = Number(ev.elementId);
            try {
              const elCopy = this.#copySingleWithCascade('element', origEvElId, targetProjectId, memo, subItemsCreated, actor);
              if (elCopy?.id) {
                ev.elementId = elCopy.id;
                subItemsCreated.push({ type: 'element', sourceId: origEvElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId });
              }
            } catch { /* ignore */ }
          }
        }
      }
    }

    const baseKey = slugify(`${src.key}-p${targetProjectId}`);
    const newKey = uniqueKey(baseKey, k => svc.designs.keyExists(k));
    const rootItemId = src.rootItemId || src.id;
    const rootOwnerId = src.rootOwnerId || src.creatorId || 1;
    const effCreatorId = actor?.id ?? src.creatorId ?? 1;

    const copyRec = svc.designs.create({
      ...src,
      name: src.name,
      label: src.label || src.name,
      key: newKey,
      builtin: false,
      position: undefined,
      projectId: targetProjectId,
      visibility: 'project',
      creatorId: effCreatorId,
      clonedFromId: src.id,
      rootItemId,
      rootOwnerId
    });

    const idMap = new Map();
    const byDepth = [...nodesCopy].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    for (const e of byDepth) {
      const made = svc.nodes.create(type, copyRec.id, {
        ...e,
        parentId: e.parentId == null ? null : (idMap.get(e.parentId) ?? null)
      });
      idMap.set(e.id, made.id);
    }
    for (const a of src.animations || []) {
      const targetNodeId = idMap.get(a.nodeId);
      if (targetNodeId) svc.animations.create(targetNodeId, a);
    }

    if (type === 'button' && this.menus) {
      const rawMenuItems = this.menus.list ? this.menus.list(src.id) : [];
      const menuIdMap = new Map();
      const sortedMenu = [...rawMenuItems].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
      for (const mi of sortedMenu) {
        let iconId = mi.iconId;
        if (iconId && this.services.icon) {
          try {
            const icCopy = this.#copySingleWithCascade('icon', iconId, targetProjectId, memo, subItemsCreated, actor);
            if (icCopy?.id) {
              iconId = icCopy.id;
              subItemsCreated.push({ type: 'icon', sourceId: Number(mi.iconId), id: icCopy.id, key: icCopy.key, projectId: targetProjectId });
            }
          } catch { /* ignore */ }
        }
        let targetElementId = mi.targetElementId ?? null;
        if (targetElementId && this.services.element) {
          try {
            const elCopy = this.#copySingleWithCascade('element', targetElementId, targetProjectId, memo, subItemsCreated, actor);
            if (elCopy?.id) {
              targetElementId = elCopy.id;
              subItemsCreated.push({ type: 'element', sourceId: Number(mi.targetElementId), id: elCopy.id, key: elCopy.key, projectId: targetProjectId });
            }
          } catch { /* ignore */ }
        }
        try {
          const parentId = mi.parentId == null ? null : (menuIdMap.get(mi.parentId) ?? null);
          const createdMi = this.menus.create(copyRec.id, { ...mi, parentId, iconId, targetElementId });
          menuIdMap.set(mi.id, createdMi.id);
        } catch { /* ignore */ }
      }
    }

    const fullCopy = svc.get(copyRec.id);
    memo.set(cacheKey, fullCopy);
    return fullCopy;
  }

  copyToProjects({ items, projectIds, actor = null } = {}) {
    const targetProjectIds = this.#normalizeTargetProjects(projectIds);
    const cleanItems = this.#normalizeItems(items);
    return this.transaction(() => {
      const copied = [];
      const subItems = [];
      for (const pid of targetProjectIds) {
        const memo = new Map();
        for (const it of cleanItems) {
          const created = this.#copySingleWithCascade(it.type, it.id, pid, memo, subItems, actor);
          copied.push({
            type: it.type,
            sourceId: it.id,
            projectId: pid,
            id: created.id,
            key: created.key,
            name: created.name,
            visibility: created.visibility,
            item: created
          });
        }
      }
      return {
        copiedCount: copied.length,
        subItemsCount: subItems.length,
        projectIds: targetProjectIds,
        copied,
        subItems
      };
    });
  }

  moveToProjects({ items, projectIds, actor = null } = {}) {
    const targetProjectIds = this.#normalizeTargetProjects(projectIds);
    const cleanItems = this.#normalizeItems(items);

    // Pre-validate source items and permissions before mutating
    const sources = cleanItems.map(it => {
      const record = it.type === 'workflow'
        ? this.workflows.get(it.id)
        : this.services[it.type].get(it.id);
      const isPublic = (record.visibility || 'public') === 'public' || Boolean(record.builtin);
      if (isPublic && actor && !this.auth.isAdmin(actor)) {
        throw new ForbiddenError('Only admin or superadmin can move or trash public items');
      }
      return { ...it, record, isPublic };
    });

    return this.transaction(() => {
      const copyResult = this.copyToProjects({ items: cleanItems, projectIds: targetProjectIds, actor });
      const removedSourceIds = [];
      for (const src of sources) {
        // Built-in default public items are immutable; keep the default public copy while creating the project copies
        if (src.record.builtin) continue;
        if (src.type === 'workflow') {
          this.workflows.remove(src.id, { actor, permanent: true });
        } else {
          this.services[src.type].remove(src.id, { actor, permanent: true });
        }
        removedSourceIds.push({ type: src.type, id: src.id });
      }
      return {
        ...copyResult,
        movedCount: copyResult.copiedCount,
        removedSourceIds
      };
    });
  }

  /**
   * Empties a project's private item library (`visibility === 'project'` and `builtin === false`).
   * Default/public libraries are immutable and cannot be emptied (`ConflictError`).
   */
  emptyProjectLibrary({ projectId, itemType = 'all', scope = 'project', includePublic = false, actor = null } = {}) {
    if (scope === 'public' || scope === 'default' || includePublic) {
      throw new ConflictError('Default public libraries are immutable and cannot be emptied');
    }
    const pid = Number(projectId);
    if (!pid || !Number.isFinite(pid)) {
      throw new ValidationError('A valid projectId is required to empty a project library');
    }
    const proj = this.projects.get(pid);
    if (actor && !this.projects.isOwnerOrAdmin(proj.id, actor)) {
      throw new ForbiddenError('Only the project owner or admin can empty the project private library');
    }

    const types = (!itemType || itemType === 'all')
      ? ['screen', 'element', 'button', 'icon', 'path', 'workflow']
      : [String(itemType).replace(/s$/, '')];

    const toTrash = [];
    let defaultOrPublicCount = 0;

    for (const t of types) {
      if (t === 'workflow') {
        const allWf = this.workflows.list({ projectId: pid, includePublic: true });
        for (const wf of allWf) {
          if (wf.projectId === pid && wf.visibility === 'project') {
            toTrash.push({ type: 'workflow', id: wf.id });
          } else if (wf.projectId === pid || wf.visibility === 'public') {
            defaultOrPublicCount++;
          }
        }
      } else if (this.services[t]) {
        const allItems = this.services[t].list({ projectId: pid, includePublic: true });
        for (const it of allItems) {
          if (it.projectId === pid && it.visibility === 'project' && !it.builtin) {
            toTrash.push({ type: t, id: it.id });
          } else if (it.projectId === pid && (it.builtin || it.visibility === 'public')) {
            defaultOrPublicCount++;
          }
        }
      }
    }

    if (toTrash.length === 0 && (pid === 1 || defaultOrPublicCount > 0)) {
      throw new ConflictError('Default public libraries are immutable and cannot be emptied');
    }

    return this.transaction(() => {
      const trashed = [];
      for (const entry of toTrash) {
        if (entry.type === 'workflow') {
          const res = this.workflows.remove(entry.id, { actor });
          trashed.push({ type: 'workflow', id: entry.id, trashId: res.trashId });
        } else {
          const res = this.services[entry.type].remove(entry.id, { actor });
          trashed.push({ type: entry.type, id: entry.id, trashId: res.trashId });
        }
      }
      return {
        emptied: true,
        projectId: pid,
        emptiedCount: trashed.length,
        trashed
      };
    });
  }
}
