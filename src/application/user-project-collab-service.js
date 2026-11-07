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
import {
  DEVICES,
  DEFAULT_BUTTON_TEMPLATES,
  USER_ROLES,
  PROJECT_ROLES,
  VISIBILITY_LEVELS,
  BUTTON_STYLES,
  DEFAULT_PROJECT_BUTTON_SETTINGS,
  normalizeButtonIconSizePct,
  normalizeButtonStyleKey,
  applyButtonStyleAndIconSizeToNodes
} from '../domain/entities.js';
import { isValidKey, slugify, uniqueKey } from '../domain/naming.js';
import { restoreBody, workflowRestoreBody } from '../domain/doc-fingerprint.js';
import { passwordMatches, hashUserPassword, assertNewPassword } from './passwords.js';
import { isSystemUser, isSystemUsername, isReservedEmail, PUBLIC_USERNAME, DESIGN_TABLES } from '../domain/system-users.js';

/** Gives a restored row back its stable uid (MCP identity), when the snapshot has one and it is still free. */
function restoreUid(db, table, id, uid) {
  if (!uid || !db) return;
  try { db.prepare(`UPDATE ${table} SET uid = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ${table} WHERE uid = ?)`).run(uid, id, uid); } catch { /* table without uid column */ }
}

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

  /** Guarantees default admin users `kyrpy` (id = 1) and `admin` (default startup credential `admin`/`admin`) exist. */
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

    const defaultInstallerAdmin = this.users.getByUsernameOrEmail('admin');
    if (!defaultInstallerAdmin) {
      const defaultPass = process.env.DEFAULT_ADMIN_PASS || 'admin';
      const { salt, passwordHash } = hashPassword(defaultPass, 'admin_salt_v1');
      this.users.create({
        username: 'admin',
        email: 'admin@local.dev',
        passwordHash,
        salt,
        displayName: 'Administrator',
        role: 'superadmin',
        status: 'active',
        permissions: ['*'],
        avatarColor: '#10b981'
      });
    }
  }

  /**
   * Returns current authentication & environment mode configuration:
   * - `dev` mode (`APP_MODE=dev` or `BYPASS_AUTH=true`): bypasses the login/register gate for instant local development.
   * - `release` mode (`APP_MODE=release` or `NODE_ENV=production` or `BYPASS_AUTH=false`): protects the studio page with Login / Register.
   */
  getAuthConfig() {
    const rawMode = String(process.env.APP_MODE || process.env.AUTH_MODE || process.env.NODE_ENV || 'dev').trim().toLowerCase();
    const rawBypass = String(process.env.BYPASS_AUTH ?? '').trim().toLowerCase();
    const isRelease = rawBypass === 'false' || rawBypass === '0' || (rawBypass === '' && ['release', 'production', 'prod'].includes(rawMode));
    return {
      appMode: isRelease ? 'release' : 'dev',
      bypassLogin: !isRelease,
      requireAuth: isRelease,
      defaultUsername: 'admin'
    };
  }

  devBypassLogin() {
    const cfg = this.getAuthConfig();
    if (!cfg.bypassLogin) {
      throw new ForbiddenError('Login bypass is disabled in release mode. Please sign in with your credentials.');
    }
    const adminUser = this.users.getByUsernameOrEmail('admin') || this.defaultAdmin();
    const session = this.#issueSession(adminUser.id);
    return { user: this.users.get(adminUser.id), token: session.token, expiresAt: session.expiresAt, bypassed: true };
  }

  defaultAdmin() {
    return this.users.get(1) || this.users.getByUsernameOrEmail('kyrpy');
  }

  /** Resolves the acting user from a session token, user id, or falls back to `kyrpy` in offline/local mode. */
  resolveActor({ token = null, userId = null, allowDefault = true } = {}) {
    if (token) {
      const sess = this.users.getSession(token);
      if (sess?.user && sess.user.status === 'active' && !isSystemUser(sess.user)) return sess.user;
    }
    if (userId) {
      const u = this.users.get(Number(userId));
      if (u && u.status === 'active' && !isSystemUser(u)) return u;   // system accounts are never impersonated (x-user-id)
    }
    return allowDefault ? this.defaultAdmin() : null;
  }

  resolveToken(token) {
    return this.resolveActor({ token, allowDefault: false });
  }

  /** True for the immutable non-human accounts (`public`, `kyrpy-agent-designer`). */
  isSystemUser(user) { return isSystemUser(user); }

  /** Id of the `public` system user (owner of the public library), or null. */
  publicUserId() { return this.users.publicUserId ? this.users.publicUserId() : (this.users.getByUsernameOrEmail(PUBLIC_USERNAME)?.id ?? null); }

  #assertNotSystem(user, what = 'modified') {
    if (isSystemUser(user)) throw new ForbiddenError(`System account "${user.username}" is immutable and cannot be ${what}`);
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
    if (isSystemUsername(uname)) throw new ConflictError(`Username "${uname}" is reserved for a system account`);
    if (isReservedEmail(mail)) throw new ConflictError(`Email "${mail}" is reserved for a system account`);
    if (this.users.getByUsernameOrEmail(uname)) throw new ConflictError(`Username "${uname}" is already registered`);
    if (this.users.getByUsernameOrEmail(mail)) throw new ConflictError(`Email "${mail}" is already registered`);
    const cleanRole = USER_ROLES.includes(role) && role !== 'superadmin' ? role : 'designer';
    const { salt, passwordHash } = hashUserPassword(password);
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
    this.#assertNotSystem(u, 'signed in to');
    if (u.status !== 'active') throw new ForbiddenError(`Account "${u.username}" is ${u.status}`);
    // legacy default-admin passwords only work until the account's password is changed (see passwords.js)
    const ok = passwordMatches(u, password);
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
    this.#assertNotSystem(this.users.get(Number(userId)), 'given a session');   // last line of defence
    const token = `ud_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    return this.users.createSession(token, userId, expiresAt);
  }

  /* ---------- Admin & User Management ---------- */
  /** Every user; system accounts are flagged `{ system: true, readOnly: true }` so UIs can hide or lock them. */
  listUsers({ includeSystem = true } = {}) {
    return this.users.list()
      .filter(u => includeSystem || !isSystemUser(u))
      .map(u => (isSystemUser(u) ? { ...u, system: true, readOnly: true } : u));
  }

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
    this.#assertNotSystem(target, 'updated');
    const isSelf = actor && Number(actor.id) === Number(target.id);
    if (!this.isAdmin(actor) && !isSelf) throw new ForbiddenError('Only admins or the account owner can update this user');
    const clean = {};
    if (patch.displayName !== undefined) clean.displayName = String(patch.displayName).trim();
    if (patch.email !== undefined) {
      // same rules as register / ProfileService: a real address, never a system account's, never another user's
      const mail = String(patch.email).trim().toLowerCase();
      if (!mail || !mail.includes('@')) throw new ValidationError('A valid email address is required');
      if (isReservedEmail(mail)) throw new ConflictError(`Email "${mail}" is reserved for a system account`);
      const holder = this.users.getByUsernameOrEmail(mail);
      if (holder && Number(holder.id) !== Number(target.id)) throw new ConflictError(`Email "${mail}" is already registered`);
      clean.email = mail;
    }
    if (patch.avatarColor !== undefined) clean.avatarColor = String(patch.avatarColor).trim();
    if (patch.password && String(patch.password).length >= 4) {
      // own password: prove the current one (the profile page does the same); admins resetting others don't
      if (isSelf && !passwordMatches(this.users.getWithAuth(target.id), patch.currentPassword)) {
        throw new ValidationError('Current password is incorrect (change your own password on the profile page)');
      }
      if (isSelf) assertNewPassword(patch.password, { username: target.username, email: target.email });
      const { salt, passwordHash } = hashUserPassword(patch.password);
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
    this.#assertNotSystem(target, 'deleted');
    this.users.delete(target.id);
    return { deleted: true, id: target.id };
  }

  removeUser(id, actor) {
    return this.deleteUser(actor, id);
  }
}

export class ProjectService {
  constructor({ projects, users, auth, changes, db, designs, nodes, workflows, services = null, libraryTransfer = null, transaction }) {
    Object.assign(this, { projects, users, auth, changes, db, designs, nodes, workflows, services, libraryTransfer, transaction });
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
        requireApproval: true,
        settings: { ...DEFAULT_PROJECT_BUTTON_SETTINGS }
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
    const rawSettings = (p.settings && typeof p.settings === 'object') ? p.settings : {};
    const settings = {
      ...DEFAULT_PROJECT_BUTTON_SETTINGS,
      ...rawSettings,
      buttonStyle: normalizeButtonStyleKey(rawSettings.buttonStyle, DEFAULT_PROJECT_BUTTON_SETTINGS.buttonStyle),
      buttonIconSizePct: normalizeButtonIconSizePct(rawSettings.buttonIconSizePct, DEFAULT_PROJECT_BUTTON_SETTINGS.buttonIconSizePct)
    };
    return {
      ...p,
      settings,
      buttonStyle: settings.buttonStyle,
      buttonIconSizePct: settings.buttonIconSizePct,
      ownerUsername: owner?.username || 'kyrpy',
      members,
      memberCount: members.length,
      pendingChanges
    };
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
    if (isSystemUser(this.users.get(ownerId))) throw new ValidationError('A system account cannot own a project');
    const rawVis = input.visibility === 'project' ? 'private' : input.visibility;
    const visibility = ['public', 'private'].includes(rawVis) ? rawVis : 'public';
    return this.transaction(() => {
      const mergedSettings = {
        ...DEFAULT_PROJECT_BUTTON_SETTINGS,
        ...(input.settings && typeof input.settings === 'object' ? input.settings : {}),
        ...(input.buttonStyle !== undefined ? { buttonStyle: normalizeButtonStyleKey(input.buttonStyle) } : {}),
        ...(input.buttonIconSizePct !== undefined ? { buttonIconSizePct: normalizeButtonIconSizePct(input.buttonIconSizePct) } : {})
      };
      const p = this.projects.create({
        key,
        name,
        label: input.label || name,
        description: input.description || '',
        ownerId,
        visibility,
        requireApproval: input.requireApproval !== false,
        settings: mergedSettings
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
    if (patch.settings !== undefined || patch.buttonStyle !== undefined || patch.buttonIconSizePct !== undefined) {
      const nextSettings = {
        ...(p.settings || {}),
        ...(patch.settings && typeof patch.settings === 'object' ? patch.settings : {})
      };
      if (patch.buttonStyle !== undefined) nextSettings.buttonStyle = normalizeButtonStyleKey(patch.buttonStyle, nextSettings.buttonStyle);
      if (patch.buttonIconSizePct !== undefined) nextSettings.buttonIconSizePct = normalizeButtonIconSizePct(patch.buttonIconSizePct, nextSettings.buttonIconSizePct);
      clean.settings = nextSettings;
    }
    this.projects.update(p.id, clean);
    return this.get(p.id);
  }

  /**
   * Saves project metadata & per-project settings (`Save Project` menu action).
   */
  saveProject(id, patch = {}, optsOrActor = {}) {
    const p = this.update(id, {
      ...patch,
      settings: {
        ...(this.get(id).settings || {}),
        ...(patch.settings && typeof patch.settings === 'object' ? patch.settings : {}),
        lastSavedAt: new Date().toISOString()
      }
    }, optsOrActor);
    if (patch.applyToButtons || patch.applyButtonSettings) {
      return this.applyButtonSettings(p.id, {
        buttonStyle: p.settings.buttonStyle,
        buttonIconSizePct: p.settings.buttonIconSizePct,
        scope: patch.scope || 'all'
      }, optsOrActor);
    }
    return { ...p, saved: true, project: p };
  }

  /**
   * Stores `buttonStyle` (default `'circle'`) and `buttonIconSizePct` (`50–90%`) per project
   * and applies them to all buttons in the Buttons library.
   */
  applyButtonSettings(projectId, { buttonStyle, buttonIconSizePct, scope = 'all' } = {}, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : null);
    const p = this.get(projectId || 1);
    if (actor && !this.isOwnerOrAdmin(p.id, actor) && p.id !== 1) {
      throw new ForbiddenError('Only the project owner or admin can update project button settings');
    }
    const styleKey = normalizeButtonStyleKey(buttonStyle ?? p.settings?.buttonStyle, 'circle');
    const pct = normalizeButtonIconSizePct(buttonIconSizePct ?? p.settings?.buttonIconSizePct, 70);
    const nextSettings = {
      ...(p.settings || {}),
      buttonStyle: styleKey,
      buttonIconSizePct: pct
    };

    return this.transaction(() => {
      this.projects.update(p.id, { settings: nextSettings });
      let updatedCount = 0;
      const btnRepo = this.designs?.button || this.services?.button?.designs;
      const nodeRepo = this.nodes || this.services?.button?.nodes;
      if (btnRepo && nodeRepo) {
        const allButtons = btnRepo.list({ projectId: p.id, includePublic: scope !== 'project', includePrivate: true, actorId: actor?.id ?? 1 });
        for (const b of allButtons) {
          if (scope === 'project' && Number(b.projectId) !== Number(p.id)) continue;
          const curNodes = nodeRepo.listByOwner('button', b.id);
          const nextNodes = applyButtonStyleAndIconSizeToNodes(curNodes, {
            width: b.width,
            height: b.height,
            buttonStyle: styleKey,
            buttonIconSizePct: pct
          });
          nodeRepo.replaceAll('button', b.id, nextNodes);
          btnRepo.update(b.id, {
            meta: {
              ...(b.meta || {}),
              shape: styleKey,
              buttonStyle: styleKey,
              buttonIconSizePct: pct
            }
          });
          updatedCount++;
        }
      }
      const updatedProject = this.get(p.id);
      return {
        ...updatedProject,
        saved: true,
        projectId: p.id,
        buttonStyle: styleKey,
        buttonIconSizePct: pct,
        updatedCount,
        styles: BUTTON_STYLES,
        project: updatedProject
      };
    });
  }

  /**
   * Clones a project (`Clone Project` menu action), copying its per-project settings (`buttonStyle`, `buttonIconSizePct`)
   * and all project-scoped designs (`paths`, `icons`, `buttons`, `elements`, `screens`, `workflows`) into the new project.
   */
  clone(id, input = {}, optsOrActor = {}) {
    const actor = optsOrActor && 'actor' in optsOrActor ? optsOrActor.actor : (optsOrActor && optsOrActor.id ? optsOrActor : null);
    const src = this.get(id);
    const cloneName = String(input.name || `${src.name} (Clone)`).trim();
    const created = this.create({
      name: cloneName,
      key: input.key,
      label: input.label || cloneName,
      description: input.description !== undefined ? input.description : src.description,
      visibility: input.visibility || src.visibility || 'private',
      requireApproval: src.requireApproval,
      settings: { ...(src.settings || {}) }
    }, actor || { actorId: src.ownerId });

    let copiedCount = 0;
    if (this.libraryTransfer) {
      const itemsToCopy = [];
      for (const [t, tbl] of [['path', 'paths'], ['icon', 'icons'], ['button', 'buttons'], ['element', 'elements'], ['screen', 'screens'], ['workflow', 'workflows']]) {
        const rows = this.db.prepare(
          src.id === 1
            ? `SELECT id FROM ${tbl} WHERE project_id = ? AND visibility = 'project'`
            : `SELECT id FROM ${tbl} WHERE project_id = ?`
        ).all(src.id);
        for (const r of rows) itemsToCopy.push({ type: t, id: r.id });
      }
      if (itemsToCopy.length > 0) {
        const res = this.libraryTransfer.copyToProjects({
          items: itemsToCopy,
          projectIds: [created.id],
          visibility: 'project',
          actor: actor || { id: created.ownerId, role: 'admin' }
        });
        copiedCount = res.copiedCount || 0;
      }
    }
    const clonedProject = this.get(created.id);
    return {
      ...clonedProject,
      cloned: true,
      sourceProjectId: src.id,
      copiedCount,
      copiedItemsCount: copiedCount,
      project: clonedProject
    };
  }

  /** Bulk-updates visibility ('public' | 'project') of all items belonging to a project. */
  setAllItemsVisibility(projectId, visibility) {
    if (!VISIBILITY_LEVELS.includes(visibility)) throw new ValidationError(`visibility must be one of ${VISIBILITY_LEVELS.join(', ')}`);
    const pid = Number(projectId);
    const pub = this.auth?.publicUserId?.() ?? null;
    if (visibility !== 'public' && pub != null) {
      const locked = DESIGN_TABLES.reduce((n, tbl) => n + this.db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE project_id = ? AND creator_id = ? AND visibility = 'public'`).get(pid, pub).n, 0);
      if (locked) throw new ValidationError(`${locked} item(s) of this project belong to the immutable public library and must stay public; clone them instead`);
    }
    for (const tbl of DESIGN_TABLES) {
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
    if (isSystemUser(targetUser)) throw new ValidationError(`System account "${targetUser.username}" cannot be invited to a project`);
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
  constructor({ changes, projects, users, auth, services = {}, workflows = null, transaction = null }) {
    Object.assign(this, { changes, projects, users, auth, services, workflows, transaction });
  }

  /**
   * Decides whether an edit of `doc` by `actorId` files a change request, and who reviews it.
   * Returns null when no request is needed: the owner edits their own item, or an admin curates an item of the
   * immutable `public` library user. Collaborator edits of public-library items are reviewed by the owner of the
   * default project (a real person), never by the `public` user, which cannot act.
   */
  changeReviewer(doc, actorId, { force = false } = {}) {
    if (!doc) return null;
    const ownerId = Number(doc.creatorId || doc.rootOwnerId || 1);
    const pub = this.auth?.publicUserId?.() ?? null;
    if (pub != null && ownerId === Number(pub)) {
      const actor = actorId != null ? this.users?.get(Number(actorId)) : null;
      if (!force && actor && this.auth?.isAdmin(actor)) return null;
      if (!force && actorId == null) return null;
      let reviewer = 1;
      try { reviewer = Number(this.projects?.get(1)?.ownerId || 1); } catch { /* no default project */ }
      return { ownerId: reviewer };
    }
    const isCollaborator = actorId != null && Number(actorId) !== ownerId;
    return force || isCollaborator ? { ownerId } : null;
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
    // AI changeset ops (src/mcp) are applied by their own review flow, not by snapshot restore
    if (this.externalReviewer?.handles(ch)) return this.externalReviewer.review(ch, 'approve', { actor: effActor, comment: comment || reviewNote || '' });
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
    if (this.externalReviewer?.handles(ch)) return this.externalReviewer.review(ch, 'reject', { actor: effActor, comment: comment || reviewNote || '' });
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

  /** Change counts per status ({ pending, approved, rejected, all }) for the list filters, ignoring `status`. */
  counts(filter = {}) {
    if (typeof this.changes.countByStatus === 'function') return this.changes.countByStatus(filter);
    const out = { pending: 0, approved: 0, rejected: 0, all: 0 };
    for (const c of this.changes.list({ ...filter, status: '' })) { out[c.status] = (out[c.status] || 0) + 1; out.all++; }
    return out;
  }

  /**
   * Approves or rejects many change requests at once (the change list's "Approve selected" / "Approve all").
   * `ids` names them, or `filter` ({ projectId, targetType, authorId, q }) selects every *pending* match.
   * The batch runs in one transaction and each review in its own savepoint, so one refusal (permission, missing
   * target) neither rolls back nor stops the others. Non-pending changes are skipped. Same permission rules as
   * approve() / reject().
   */
  bulkReview(ids, action, { actor = null, comment = '', filter = null } = {}) {
    if (action !== 'approve' && action !== 'reject') throw new ValidationError("Bulk review action must be 'approve' or 'reject'");
    let list = Array.isArray(ids) ? ids : [];
    if (filter && typeof filter === 'object') {
      const f = { ...filter, status: 'pending' };
      list = typeof this.changes.matchingIds === 'function' ? this.changes.matchingIds(f) : this.changes.list(f).map(c => c.id);
    }
    list = [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!list.length && !filter) throw new ValidationError('No change ids given');
    const tx = this.transaction || (fn => fn());
    const one = typeof this.transaction === 'function' ? fn => this.transaction(fn) : fn => fn();
    const out = { action, results: [], approved: 0, rejected: 0, skipped: 0, failed: 0 };
    tx(() => {
      for (const id of list) {
        const ch = this.changes.get(id);
        if (!ch) { out.failed++; out.results.push({ id, ok: false, status: null, error: 'Change not found' }); continue; }
        if (ch.status !== 'pending') { out.skipped++; out.results.push({ id, ok: false, skipped: true, status: ch.status, error: `Already ${ch.status}` }); continue; }
        try {
          const saved = one(() => action === 'approve' ? this.approve(id, { actor, comment }) : this.reject(id, { actor, comment }));
          const status = saved?.status || (action === 'approve' ? 'approved' : 'rejected');
          if (status === 'approved') out.approved++;
          else if (status === 'rejected') out.rejected++;
          out.results.push({ id, ok: true, status });
        } catch (e) {
          out.failed++;
          out.results.push({ id, ok: false, status: 'pending', error: e?.message || String(e) });
        }
      }
    });
    out.counts = this.counts(filter ? { projectId: filter.projectId ?? null } : {});
    return out;
  }
}

export class TemplateService {
  constructor({ templates, services = {} }) {
    Object.assign(this, { templates, services });
    this.seedDefaults();
  }

  seedDefaults() {
    for (const [key, d] of Object.entries(DEVICES)) {
      const ex = this.templates.getDeviceByKey(key);
      const payload = {
        key,
        name: d.name,
        category: d.category || 'mobile',
        width: d.width,
        height: d.height,
        cornerRadius: d.cornerRadius ?? (key === 'web' || key === 'web-1080p' ? 8 : 44),
        grid: 24,
        locked: false,
        meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'liquid', lightTheme: 'liquid-light', ...(d.meta || {}) },
        builtin: true
      };
      if (!ex) {
        this.templates.createDevice(payload);
      } else if (ex.builtin) {
        this.templates.updateDevice(ex.id, payload);
      }
    }
    for (const b of DEFAULT_BUTTON_TEMPLATES) {
      const ex = this.templates.getButtonByKey(b.key);
      const nodesTemplate = this.#buildButtonNodes(b);
      if (!ex) {
        this.templates.createButton({ ...b, meta: b.meta || { mode: 'dark' }, builtin: true, nodesTemplate });
      } else if (ex.builtin) {
        this.templates.updateButton(ex.id, { ...b, meta: b.meta || ex.meta || { mode: 'dark' }, nodesTemplate });
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
      meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'liquid', lightTheme: 'liquid-light', ...(input.meta || {}) },
      builtin: false
    });
    DEVICES[created.key] = { name: created.name, width: created.width, height: created.height, category: created.category, cornerRadius: created.cornerRadius, meta: created.meta };
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
        const key = wfRepo.keyExists(rec.key, rec.projectId)
          ? uniqueKey(rec.key, k => wfRepo.keyExists(k, rec.projectId))
          : rec.key;
        const created = wfRepo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
        restoreUid(wfRepo.db, 'workflows', created.id, snap.uid);
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
      const key = repo.keyExists(rec.key, rec.projectId)
        ? uniqueKey(rec.key, k => repo.keyExists(k, rec.projectId))
        : rec.key;
      const created = repo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
      restoreUid(repo.db, repo.table, created.id, snap.uid);
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
  constructor({ services, workflows, menus, projects, auth, transaction, render = null, parseSvg = null }) {
    Object.assign(this, { services, workflows, menus, projects, auth, transaction, render, parseSvg });
  }

  #normalizeTargetProjects(projectIds, { allowEmpty = false } = {}) {
    const raw = Array.isArray(projectIds)
      ? projectIds
      : String(projectIds || '').split(',').map(x => x.trim()).filter(Boolean);
    const ids = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))];
    if (!ids.length && !allowEmpty) throw new ValidationError('At least one target projectId is required');
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

  #copySingleWithCascade(type, id, targetProjectId, memo, subItemsCreated, actor, { visibility = 'project', overrideName = null } = {}) {
    const effVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';
    const cacheKey = `${type}:${Number(id)}:${effVis}:${overrideName || ''}`;
    if (memo.has(cacheKey)) return memo.get(cacheKey);

    if (type === 'workflow') {
      const src = this.workflows.get(Number(id));
      const wfRepo = this.workflows.workflows;
      const screenMap = new Map();
      for (const n of src.nodes || []) {
        if (n.screenId) {
          const copiedScreen = this.#copySingleWithCascade('screen', n.screenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (copiedScreen?.id) {
            screenMap.set(Number(n.screenId), copiedScreen.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(n.screenId), id: copiedScreen.id, key: copiedScreen.key, projectId: targetProjectId, visibility: effVis });
          }
        }
      }
      for (const l of src.links || []) {
        if (l.fromScreenId && !screenMap.has(Number(l.fromScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.fromScreenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (cs?.id) {
            screenMap.set(Number(l.fromScreenId), cs.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(l.fromScreenId), id: cs.id, key: cs.key, projectId: targetProjectId, visibility: effVis });
          }
        }
        if (l.toScreenId && !screenMap.has(Number(l.toScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.toScreenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (cs?.id) {
            screenMap.set(Number(l.toScreenId), cs.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(l.toScreenId), id: cs.id, key: cs.key, projectId: targetProjectId, visibility: effVis });
          }
        }
      }
      const wfName = overrideName || src.name;
      const wfKey = uniqueKey(slugify(overrideName || src.key), k => wfRepo.keyExists(k, targetProjectId));   // keys are per project
      const createdWf = wfRepo.create({
        key: wfKey,
        name: wfName,
        label: wfName,
        description: src.description || '',
        projectId: targetProjectId,
        visibility: effVis,
        creatorId: actor?.id ?? src.creatorId ?? 1,
        rootOwnerId: src.rootOwnerId || src.creatorId || 1,
        clonedFromId: src.id
      });
      for (const n of src.nodes || []) {
        const newSid = screenMap.get(Number(n.screenId)) || n.screenId;
        try {
          wfRepo.upsertNode({
            workflowId: createdWf.id,
            screenId: newSid,
            x: n.x ?? 0,
            y: n.y ?? 0,
            collapsed: Boolean(n.collapsed),
            locked: Boolean(n.locked)
          });
        } catch { /* ignore */ }
      }
      for (const l of src.links || []) {
        const fromSid = screenMap.get(Number(l.fromScreenId)) || l.fromScreenId;
        const toSid = screenMap.get(Number(l.toScreenId)) || l.toScreenId;
        try {
          wfRepo.createLink(createdWf.id, {
            fromScreenId: fromSid,
            toScreenId: toSid,
            fromNodeId: null,
            name: l.name ?? l.triggerLabel ?? '',
            descriptionDev: l.descriptionDev ?? '',
            style: l.style ?? 'curved',
            trigger: l.trigger ?? 'tap'
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
          const subCopy = this.#copySingleWithCascade(n.refType, origRefId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (subCopy?.id) {
            n.refId = subCopy.id;
            subItemsCreated.push({ type: n.refType, sourceId: origRefId, id: subCopy.id, key: subCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch { /* ignore missing sub-item */ }
      }
      if (n.onClick?.elementId && this.services.element) {
        const origElId = Number(n.onClick.elementId);
        try {
          const elCopy = this.#copySingleWithCascade('element', origElId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (elCopy?.id) {
            n.onClick.elementId = elCopy.id;
            subItemsCreated.push({ type: 'element', sourceId: origElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch { /* ignore */ }
      }
      if (n.onClick?.targetId && ['element', 'popup', 'drawer', 'toolbar'].includes(n.onClick.type) && this.services.element) {
        const origTargetId = Number(n.onClick.targetId);
        try {
          const elCopy = this.#copySingleWithCascade('element', origTargetId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (elCopy?.id) {
            n.onClick.targetId = elCopy.id;
            subItemsCreated.push({ type: 'element', sourceId: origTargetId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch { /* ignore */ }
      }
      if (Array.isArray(n.events)) {
        for (const ev of n.events) {
          if (ev?.elementId && this.services.element) {
            const origEvElId = Number(ev.elementId);
            try {
              const elCopy = this.#copySingleWithCascade('element', origEvElId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
              if (elCopy?.id) {
                ev.elementId = elCopy.id;
                subItemsCreated.push({ type: 'element', sourceId: origEvElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
              }
            } catch { /* ignore */ }
          }
          if (ev?.targetId && ['element', 'popup', 'drawer', 'toolbar'].includes(ev.type) && this.services.element) {
            const origEvTargetId = Number(ev.targetId);
            try {
              const elCopy = this.#copySingleWithCascade('element', origEvTargetId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
              if (elCopy?.id) {
                ev.targetId = elCopy.id;
                subItemsCreated.push({ type: 'element', sourceId: origEvTargetId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
              }
            } catch { /* ignore */ }
          }
        }
      }
    }

    const finalName = overrideName || src.name;
    const baseKey = slugify(overrideName || src.key);   // keys are per project: a copy keeps its key
    const newKey = uniqueKey(baseKey, k => svc.designs.keyExists(k, targetProjectId));
    const rootItemId = src.rootItemId || src.id;
    const rootOwnerId = src.rootOwnerId || src.creatorId || 1;
    const effCreatorId = actor?.id ?? src.creatorId ?? 1;

    const copyRec = svc.designs.create({
      ...src,
      name: finalName,
      label: overrideName || src.label || src.name,
      key: newKey,
      builtin: false,
      position: undefined,
      projectId: targetProjectId,
      visibility: effVis,
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
            const icCopy = this.#copySingleWithCascade('icon', iconId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
            if (icCopy?.id) {
              iconId = icCopy.id;
              subItemsCreated.push({ type: 'icon', sourceId: Number(mi.iconId), id: icCopy.id, key: icCopy.key, projectId: targetProjectId, visibility: effVis });
            }
          } catch { /* ignore */ }
        }
        let targetElementId = mi.targetElementId ?? null;
        if (targetElementId && this.services.element) {
          try {
            const elCopy = this.#copySingleWithCascade('element', targetElementId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
            if (elCopy?.id) {
              targetElementId = elCopy.id;
              subItemsCreated.push({ type: 'element', sourceId: Number(mi.targetElementId), id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
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

  copyToProjects({ items, projectIds = [], visibility = 'project', includeUserPrivate = false, overrideName = null, actor = null } = {}) {
    const targetProjectIds = this.#normalizeTargetProjects(projectIds, { allowEmpty: Boolean(includeUserPrivate || visibility === 'private') });
    const cleanItems = this.#normalizeItems(items);
    const effVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';
    return this.transaction(() => {
      const copied = [];
      const subItems = [];
      for (const pid of targetProjectIds) {
        const memo = new Map();
        for (const it of cleanItems) {
          const created = this.#copySingleWithCascade(it.type, it.id, pid, memo, subItems, actor, {
            visibility: effVis,
            overrideName
          });
          copied.push({
            type: it.type,
            sourceId: it.id,
            projectId: pid,
            id: created.id,
            key: created.key,
            name: created.name,
            visibility: created.visibility,
            creatorId: created.creatorId,
            item: created
          });
        }
      }
      if (includeUserPrivate || (!targetProjectIds.length && effVis === 'private')) {
        const privPid = targetProjectIds[0] || 1;
        const memo = new Map();
        for (const it of cleanItems) {
          const created = this.#copySingleWithCascade(it.type, it.id, privPid, memo, subItems, actor, {
            visibility: 'private',
            overrideName
          });
          copied.push({
            type: it.type,
            sourceId: it.id,
            projectId: privPid,
            id: created.id,
            key: created.key,
            name: created.name,
            visibility: 'private',
            creatorId: created.creatorId,
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

  /**
   * Saves / clones an item (and all its cascading sub-items) into multiple target projects and/or the user's
   * global private item library (`visibility = 'private'`), optionally restoring the source item's baseline.
   */
  saveAsToTargets({
    type,
    id,
    name = '',
    projectIds = [],
    visibility = 'project',
    includeUserPrivate = false,
    restoreBaseline = null,
    actor = null
  } = {}) {
    const cleanType = String(type || '').trim().replace(/s$/, '');
    const cleanId = Number(id);
    if (!['path', 'icon', 'button', 'element', 'screen', 'workflow'].includes(cleanType) || !cleanId) {
      throw new ValidationError('Valid item type and id are required for saveAsToTargets');
    }
    return this.transaction(() => {
      const res = this.copyToProjects({
        items: [{ type: cleanType, id: cleanId }],
        projectIds,
        visibility,
        includeUserPrivate,
        overrideName: name ? String(name).trim() : null,
        actor
      });
      if (restoreBaseline && typeof restoreBaseline === 'object') {
        if (cleanType === 'workflow') {
          this.workflows.restore(cleanId, restoreBaseline);
        } else if (this.services[cleanType]) {
          this.services[cleanType].restore(cleanId, restoreBaseline);
        }
      }
      return {
        ...res,
        savedCount: res.copiedCount,
        primaryCopy: res.copied[0]?.item || null
      };
    });
  }

  moveToProjects({ items, projectIds, actor = null, actorId = null } = {}) {
    const effActorId = Number(actorId ?? actor?.id ?? 1);
    const targetProjectIds = this.#normalizeTargetProjects(projectIds);
    const cleanItems = this.#normalizeItems(items);

    // Move items ONLY works with the acting user's owned projects
    for (const pid of targetProjectIds) {
      const proj = this.projects.get(pid);
      if (Number(proj.ownerId || 1) !== effActorId) {
        throw new ForbiddenError(`Move items only works with your own projects (project "${proj.name}" is owned by another user)`);
      }
    }

    // Pre-validate source items: default basic items (`builtin`) or items owned by other users cannot be moved (only copied)
    const sources = cleanItems.map(it => {
      const record = it.type === 'workflow'
        ? this.workflows.get(it.id)
        : this.services[it.type].get(it.id);
      if (record.builtin) {
        throw new ForbiddenError(`Default basic item "${record.name || record.key}" cannot be moved; it can only be copied`);
      }
      const ownerId = Number(record.creatorId || record.rootOwnerId || 1);
      const publicCurator = ownerId === Number(this.auth?.publicUserId?.()) && this.auth?.isAdmin(actor || this.projects?.users?.get(effActorId));
      if (ownerId !== effActorId && !publicCurator) {
        throw new ForbiddenError(`Item "${record.name || record.key}" is owned by another user and cannot be moved; it can only be copied`);
      }
      return { ...it, record };
    });

    return this.transaction(() => {
      const copyResult = this.copyToProjects({ items: cleanItems, projectIds: targetProjectIds, actor: actor || { id: effActorId } });
      const removedSourceIds = [];
      for (const src of sources) {
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
        moved: copyResult.copied,
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

  /**
   * Export paths, icons, buttons, elements, screens, and workflows in JSON, SVG, or HTML format.
   * Supports exporting either an explicit list of `items: [{ type, id }]` or all items matching
   * `types` / `projectId` / `visibility`, optionally cascading referenced sub-items (`includeSubItems`).
   */
  exportLibraryItems({
    items = [],
    types = [],
    format = 'json',
    projectId = null,
    visibility = 'all',
    includeSubItems = true
  } = {}) {
    const fmt = String(format || 'json').trim().toLowerCase();
    if (!['json', 'svg', 'html'].includes(fmt)) {
      throw new ValidationError(`Unsupported export format '${format}'. Expected json, svg, or html.`);
    }

    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const collected = {
      path: new Map(),
      icon: new Map(),
      button: new Map(),
      element: new Map(),
      screen: new Map(),
      workflow: new Map()
    };

    const collectEntity = (type, id) => {
      const normType = String(type || '').trim().replace(/s$/, '');
      const numId = Number(id);
      if (!ALL_TYPES.includes(normType) || !numId) return;
      if (collected[normType].has(numId)) return;

      if (normType === 'workflow') {
        try {
          const wf = this.workflows.get(numId);
          collected.workflow.set(numId, wf);
          if (includeSubItems && Array.isArray(wf.nodes)) {
            for (const wn of wf.nodes) {
              if (wn.screenId) collectEntity('screen', Number(wn.screenId));
            }
          }
        } catch { /* ignore missing */ }
        return;
      }

      const svc = this.services[normType];
      if (!svc) return;
      try {
        const entity = svc.get(numId);
        let menuItems = [];
        if (this.menus && (normType === 'element' || normType === 'screen')) {
          try {
            menuItems = this.menus.list({ ownerType: normType, ownerId: numId });
          } catch { /* ignore */ }
        }
        collected[normType].set(numId, { ...entity, menuItems });
        if (includeSubItems) {
          for (const node of (entity.nodes || [])) {
            if (node.kind === 'instance' && node.refType && node.refId) {
              collectEntity(node.refType, Number(node.refId));
            }
          }
          for (const mi of menuItems) {
            if (mi.popupElementId) collectEntity('element', Number(mi.popupElementId));
          }
        }
      } catch { /* ignore missing */ }
    };

    if (Array.isArray(items) && items.length > 0) {
      for (const ref of this.#normalizeItems(items)) {
        collectEntity(ref.type, ref.id);
      }
    } else {
      const requestedTypes = (Array.isArray(types) && types.length > 0)
        ? types.map(t => String(t).trim().replace(/s$/, '')).filter(t => ALL_TYPES.includes(t))
        : ALL_TYPES;
      const pid = projectId ? Number(projectId) : null;
      const visFilter = String(visibility || 'all').toLowerCase();

      for (const t of requestedTypes) {
        const list = t === 'workflow'
          ? this.workflows.list({ projectId: pid, includePublic: true })
          : this.services[t].list({ projectId: pid, includePublic: true });
        for (const row of list) {
          if (visFilter === 'public' && row.visibility !== 'public') continue;
          if (visFilter === 'private' && row.visibility !== 'private') continue;
          if (visFilter === 'project' && row.visibility !== 'project') continue;
          if (pid && visFilter === 'project' && Number(row.projectId) !== pid) continue;
          collectEntity(t, row.id);
        }
      }
    }

    const payload = {
      schema: 'kyrpy-uiux-library-v2',
      exportedAt: new Date().toISOString(),
      format: fmt,
      counts: {},
      items: {}
    };
    let totalCount = 0;
    for (const t of ALL_TYPES) {
      const arr = [...collected[t].values()];
      payload.items[t] = arr;
      payload.counts[t] = arr.length;
      totalCount += arr.length;
    }

    const jsonString = JSON.stringify(payload, null, 2);
    const b64Payload = Buffer.from(jsonString, 'utf8').toString('base64');

    if (fmt === 'json') {
      return {
        format: 'json',
        filename: 'kyrpy-library-export.json',
        contentType: 'application/json',
        totalCount,
        counts: payload.counts,
        content: jsonString
      };
    }

    const renderItemSvg = (type, item) => {
      if (type === 'workflow') {
        const nodes = item.nodes || [];
        const edges = item.edges || [];
        const w = 720;
        const h = Math.max(260, nodes.length * 70 + 80);
        const nodeMap = new Map(nodes.map((n, i) => [n.id, { ...n, x: Number(n.x ?? (80 + (i % 3) * 210)), y: Number(n.y ?? (60 + Math.floor(i / 3) * 100)) }]));
        const edgeLines = edges.map(e => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) return '';
          return `<line x1="${from.x + 70}" y1="${from.y + 28}" x2="${to.x + 70}" y2="${to.y + 28}" stroke="#6C5CE7" stroke-width="2" />`;
        }).join('\n  ');
        const nodeBoxes = [...nodeMap.values()].map(n => {
          const safeTitle = String(n.title || n.id || 'Screen').replace(/[<>&"]/g, '');
          return `<g transform="translate(${n.x},${n.y})"><rect width="140" height="56" rx="12" fill="#171B26" stroke="#00D2D3" stroke-width="2"/><text x="70" y="32" text-anchor="middle" fill="#F1F5F9" font-family="Inter, sans-serif" font-size="12" font-weight="600">${safeTitle}</text></g>`;
        }).join('\n  ');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-item-type="workflow" data-item-id="${item.id}" data-item-name="${String(item.name || '').replace(/"/g, '&quot;')}">\n  <rect width="${w}" height="${h}" rx="16" fill="#0F1117"/>\n  ${edgeLines}\n  ${nodeBoxes}\n</svg>`;
      }
      if (this.render) {
        try {
          return this.render.renderEntity(type, item.id).svg;
        } catch { /* fallback */ }
      }
      const vb = item.viewBox || '0 0 24 24';
      const w = item.width || 64;
      const h = item.height || 64;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" data-item-type="${type}" data-item-id="${item.id}"></svg>`;
    };

    if (fmt === 'svg') {
      const renderedBlocks = [];
      let yCursor = 20;
      let maxW = 640;
      for (const t of ALL_TYPES) {
        for (const item of payload.items[t]) {
          const rawSvg = renderItemSvg(t, item);
          const w = Number(item.width) || (t === 'workflow' ? 720 : t === 'screen' ? 390 : 96);
          const h = Number(item.height) || (t === 'workflow' ? 280 : t === 'screen' ? 844 : 96);
          maxW = Math.max(maxW, w + 40);
          const inner = rawSvg.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
          const vb = item.viewBox || `0 0 ${w} ${h}`;
          const safeName = String(item.name || `${t}-${item.id}`).replace(/[<>&"]/g, '');
          renderedBlocks.push(
            `  <g id="item-${t}-${item.id}" data-item-type="${t}" data-item-id="${item.id}" data-item-name="${safeName}" transform="translate(20, ${yCursor})">\n` +
            `    <svg viewBox="${vb}" width="${w}" height="${h}">\n${inner}\n    </svg>\n` +
            `  </g>`
          );
          yCursor += h + 32;
        }
      }

      if (totalCount === 1) {
        for (const t of ALL_TYPES) {
          if (payload.items[t].length === 1) {
            const singleSvg = renderItemSvg(t, payload.items[t][0]);
            const annotated = `<!-- KYRPY_UIUX_LIBRARY_PAYLOAD:${b64Payload} -->\n${singleSvg}`;
            return {
              format: 'svg',
              filename: `${payload.items[t][0].slug || `${t}-${payload.items[t][0].id}`}.svg`,
              contentType: 'image/svg+xml',
              totalCount,
              counts: payload.counts,
              content: annotated
            };
          }
        }
      }

      const sheetH = Math.max(120, yCursor);
      const svgContent =
        `<!-- KYRPY_UIUX_LIBRARY_PAYLOAD:${b64Payload} -->\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${sheetH}" width="${maxW}" height="${sheetH}">\n` +
        `${renderedBlocks.join('\n')}\n` +
        `</svg>`;

      return {
        format: 'svg',
        filename: 'kyrpy-library-export.svg',
        contentType: 'image/svg+xml',
        totalCount,
        counts: payload.counts,
        content: svgContent
      };
    }

    // fmt === 'html'
    const cardsHtml = [];
    for (const t of ALL_TYPES) {
      for (const item of payload.items[t]) {
        const svgMarkup = renderItemSvg(t, item);
        const safeName = String(item.name || `${t}-${item.id}`).replace(/[<>&"]/g, '');
        const safeCat = String(item.category || 'general').replace(/[<>&"]/g, '');
        const safeVis = String(item.visibility || 'public').replace(/[<>&"]/g, '');
        cardsHtml.push(
          `    <article class="ud-lib-card" data-item-type="${t}" data-item-id="${item.id}" data-item-name="${safeName}" data-item-visibility="${safeVis}">\n` +
          `      <header class="ud-lib-card-head">\n` +
          `        <span class="ud-badge ud-badge-${t}">${t.toUpperCase()}</span>\n` +
          `        <strong>${safeName}</strong>\n` +
          `        <small>${safeCat} · ${safeVis}</small>\n` +
          `      </header>\n` +
          `      <div class="ud-lib-preview">${svgMarkup}</div>\n` +
          `    </article>`
        );
      }
    }

    const htmlContent = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8"/>',
      '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
      '  <title>Kyrpy UI/UX Designer — Library Export</title>',
      '  <style>',
      '    body { margin: 0; padding: 24px; background: #0B0D14; color: #F1F5F9; font-family: Inter, system-ui, sans-serif; }',
      '    h1 { font-size: 20px; margin: 0 0 16px; }',
      '    .ud-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }',
      '    .ud-lib-card { background: #141824; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }',
      '    .ud-lib-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }',
      '    .ud-lib-card-head small { color: #94A3B8; margin-left: auto; }',
      '    .ud-badge { padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; background: rgba(108,92,231,0.22); color: #A29BFE; }',
      '    .ud-lib-preview { display: flex; align-items: center; justify-content: center; min-height: 110px; background: rgba(0,0,0,0.28); border-radius: 8px; padding: 12px; overflow: auto; }',
      '    .ud-lib-preview svg { max-width: 100%; max-height: 300px; height: auto; }',
      '  </style>',
      '</head>',
      '<body>',
      `  <h1>Kyrpy UI/UX Library Export (${totalCount} items)</h1>`,
      '  <section class="ud-lib-grid">',
      cardsHtml.join('\n'),
      '  </section>',
      `  <script type="application/json" id="ud-library-payload">${jsonString}</script>`,
      '</body>',
      '</html>'
    ].join('\n');

    return {
      format: 'html',
      filename: 'kyrpy-library-export.html',
      contentType: 'text/html',
      totalCount,
      counts: payload.counts,
      content: htmlContent
    };
  }

  /**
   * Import paths, icons, buttons, elements, screens, and workflows from HTML, SVG, or JSON content
   * into either a Project library (`visibility: 'project'`) or the Public library (`visibility: 'public'`).
   */
  importLibraryItems({
    format = 'auto',
    content = '',
    targetType = 'auto',
    projectId = 1,
    visibility = 'project',
    category = 'imported',
    name = '',
    actor = null
  } = {}) {
    const rawText = typeof content === 'string' ? content.trim() : JSON.stringify(content || {});
    if (!rawText) {
      throw new ValidationError('Import content is required (HTML, SVG, or JSON)');
    }

    const pid = Number(projectId) || 1;
    this.projects.get(pid);
    const targetVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';

    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const normTargetType = String(targetType || 'auto').trim().toLowerCase().replace(/s$/, '');

    // 1. Detect embedded or direct JSON library bundle (`kyrpy-uiux-library-v2` or single/array JSON)
    let parsedBundle = null;
    const svgPayloadMatch = rawText.match(/<!--\s*KYRPY_UIUX_LIBRARY_PAYLOAD:([A-Za-z0-9+/=]+)\s*-->/);
    const htmlPayloadMatch = rawText.match(/<script[^>]*id=["']ud-library-payload["'][^>]*>([\s\S]*?)<\/script>/i);

    if (svgPayloadMatch) {
      try {
        parsedBundle = JSON.parse(Buffer.from(svgPayloadMatch[1], 'base64').toString('utf8'));
      } catch { /* fallback to raw SVG */ }
    } else if (htmlPayloadMatch) {
      try {
        parsedBundle = JSON.parse(htmlPayloadMatch[1].trim());
      } catch { /* fallback to raw HTML */ }
    } else if (format === 'json' || rawText.startsWith('{') || rawText.startsWith('[')) {
      try {
        parsedBundle = JSON.parse(rawText);
      } catch (err) {
        if (format === 'json') throw new ValidationError(`Invalid JSON payload: ${err.message}`);
      }
    }

    if (parsedBundle) {
      return this.#importStructuredBundle(parsedBundle, {
        projectId: pid,
        visibility: targetVis,
        targetType: normTargetType,
        category,
        name,
        actor
      });
    }

    // 2. Raw SVG or HTML without embedded JSON payload
    const isHtml = format === 'html' || /<!doctype\s+html|<html[\s>]|<article[\s>]|<div[\s>]/i.test(rawText);
    const effectiveType = ALL_TYPES.includes(normTargetType) ? normTargetType : 'icon';

    return this.transaction(() => {
      const created = [];
      const svgMatches = [...rawText.matchAll(/<svg[\s\S]*?<\/svg>/gi)].map(m => m[0]);

      if (svgMatches.length > 0) {
        svgMatches.forEach((svgBlock, idx) => {
          const itemName = name
            ? (svgMatches.length > 1 ? `${name} ${idx + 1}` : name)
            : (svgBlock.match(/data-item-name=["']([^"']+)["']/i)?.[1] || `Imported ${effectiveType} ${idx + 1}`);
          const itemTypeAttr = svgBlock.match(/data-item-type=["']([^"']+)["']/i)?.[1]?.toLowerCase()?.replace(/s$/, '');
          const chosenType = (normTargetType === 'auto' && ALL_TYPES.includes(itemTypeAttr))
            ? itemTypeAttr
            : effectiveType;
          const record = this.#createEntityFromSvg(chosenType, svgBlock, {
            name: itemName,
            category,
            projectId: pid,
            visibility: targetVis,
            actor
          });
          created.push({ type: chosenType, id: record.id, name: record.name, visibility: targetVis, projectId: pid });
        });
      } else if (isHtml) {
        const chosenType = ALL_TYPES.includes(normTargetType) ? normTargetType : 'element';
        const itemName = name || `Imported HTML ${chosenType}`;
        const record = this.#createEntityFromHtml(chosenType, rawText, {
          name: itemName,
          category,
          projectId: pid,
          visibility: targetVis,
          actor
        });
        created.push({ type: chosenType, id: record.id, name: record.name, visibility: targetVis, projectId: pid });
      } else {
        throw new ValidationError('Could not recognize valid JSON, SVG (<svg>...</svg>), or HTML content to import');
      }

      return {
        importedCount: created.length,
        projectId: pid,
        visibility: targetVis,
        created
      };
    });
  }

  #importStructuredBundle(bundle, { projectId, visibility, targetType, category, name, actor }) {
    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const buckets = { path: [], icon: [], button: [], element: [], screen: [], workflow: [] };

    if (bundle && typeof bundle === 'object' && bundle.items && typeof bundle.items === 'object') {
      for (const t of ALL_TYPES) {
        if (Array.isArray(bundle.items[t])) buckets[t].push(...bundle.items[t]);
        else if (Array.isArray(bundle.items[`${t}s`])) buckets[t].push(...bundle.items[`${t}s`]);
      }
    } else if (Array.isArray(bundle)) {
      for (const entry of bundle) {
        const t = String(entry.type || entry.itemType || (ALL_TYPES.includes(targetType) ? targetType : 'icon')).replace(/s$/, '');
        if (ALL_TYPES.includes(t)) buckets[t].push(entry);
      }
    } else if (bundle && typeof bundle === 'object') {
      let matched = false;
      for (const t of ALL_TYPES) {
        if (Array.isArray(bundle[t])) { buckets[t].push(...bundle[t]); matched = true; }
        else if (Array.isArray(bundle[`${t}s`])) { buckets[t].push(...bundle[`${t}s`]); matched = true; }
      }
      if (!matched) {
        const t = String(bundle.type || bundle.itemType || (ALL_TYPES.includes(targetType) ? targetType : 'icon')).replace(/s$/, '');
        if (ALL_TYPES.includes(t)) buckets[t].push(bundle);
      }
    }

    return this.transaction(() => {
      const idMap = new Map(); // `${type}:${oldId}` -> newEntity
      const created = [];
      const slugSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      for (const t of ['path', 'icon', 'button', 'element', 'screen']) {
        for (let i = 0; i < buckets[t].length; i++) {
          const src = buckets[t][i];
          const oldId = Number(src.id);
          const itemName = (name && buckets[t].length === 1 && targetType === t) ? name : (src.name || `Imported ${t}`);
          const baseSlug = String(src.slug || itemName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || t;
          const remappedNodes = (src.nodes || []).map(n => {
            const copy = structuredClone(n);
            if (copy.kind === 'instance' && copy.refType && copy.refId) {
              const rType = String(copy.refType).replace(/s$/, '');
              const mapped = idMap.get(`${rType}:${Number(copy.refId)}`);
              if (mapped) copy.refId = mapped.id;
            }
            return copy;
          });

          const saved = this.services[t].create({
            name: itemName,
            slug: `${baseSlug}-${slugSuffix}-${i}`,
            category: src.category || category || 'imported',
            width: src.width || (t === 'screen' ? 390 : t === 'element' ? 320 : t === 'button' ? 140 : 24),
            height: src.height || (t === 'screen' ? 844 : t === 'element' ? 180 : t === 'button' ? 44 : 24),
            viewBox: src.viewBox || `0 0 ${src.width || 24} ${src.height || 24}`,
            nodes: remappedNodes,
            events: structuredClone(src.events || []),
            animations: structuredClone(src.animations || []),
            meta: structuredClone(src.meta || {}),
            projectId,
            visibility,
            createdBy: actor?.id ?? null
          });

          if (oldId) idMap.set(`${t}:${oldId}`, saved);

          if (this.menus && Array.isArray(src.menuItems) && src.menuItems.length > 0) {
            for (const mi of src.menuItems) {
              const mappedPopup = mi.popupElementId ? idMap.get(`element:${Number(mi.popupElementId)}`) : null;
              const mappedScreen = mi.targetScreenId ? idMap.get(`screen:${Number(mi.targetScreenId)}`) : null;
              this.menus.create({
                projectId,
                ownerType: t,
                ownerId: saved.id,
                nodeId: mi.nodeId || '',
                label: mi.label || 'Menu Item',
                iconId: mi.iconId ?? null,
                targetScreenId: mappedScreen ? mappedScreen.id : (mi.targetScreenId ?? null),
                targetAction: mi.targetAction || 'navigate',
                popupElementId: mappedPopup ? mappedPopup.id : (mi.popupElementId ?? null),
                visible: mi.visible !== undefined ? Boolean(mi.visible) : true,
                sortOrder: mi.sortOrder ?? 0,
                meta: structuredClone(mi.meta || {})
              });
            }
          }

          created.push({ type: t, id: saved.id, name: saved.name, visibility, projectId });
        }
      }

      for (let i = 0; i < buckets.workflow.length; i++) {
        const wf = buckets.workflow[i];
        const wfName = (name && buckets.workflow.length === 1 && targetType === 'workflow') ? name : (wf.name || 'Imported Workflow');
        const baseSlug = String(wf.slug || wfName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
        const remappedNodes = (wf.nodes || []).map(wn => {
          const copy = structuredClone(wn);
          if (copy.screenId) {
            const mappedScreen = idMap.get(`screen:${Number(copy.screenId)}`);
            if (mappedScreen) copy.screenId = mappedScreen.id;
          }
          return copy;
        });

        const savedWf = this.workflows.create({
          name: wfName,
          slug: `${baseSlug}-${slugSuffix}-${i}`,
          description: wf.description || '',
          projectId,
          visibility,
          nodes: remappedNodes,
          edges: structuredClone(wf.edges || []),
          meta: structuredClone(wf.meta || {}),
          createdBy: actor?.id ?? null
        });
        created.push({ type: 'workflow', id: savedWf.id, name: savedWf.name, visibility, projectId });
      }

      return {
        importedCount: created.length,
        projectId,
        visibility,
        created
      };
    });
  }

  #createEntityFromSvg(type, svgText, { name, category, projectId, visibility, actor }) {
    const parsed = this.parseSvg
      ? this.parseSvg(svgText)
      : { viewBox: '0 0 24 24', width: 24, height: 24, nodes: [] };
    const slug = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    if (type === 'workflow') {
      return this.workflows.create({
        name,
        slug,
        description: 'Imported from SVG',
        projectId,
        visibility,
        nodes: [{ id: 'wn-1', title: name, x: 80, y: 80 }],
        edges: [],
        meta: { importedFrom: 'svg' },
        createdBy: actor?.id ?? null
      });
    }

    const defaultW = type === 'screen' ? 390 : type === 'element' ? 320 : type === 'button' ? 140 : (parsed.width || 24);
    const defaultH = type === 'screen' ? 844 : type === 'element' ? 180 : type === 'button' ? 44 : (parsed.height || 24);
    return this.services[type].create({
      name,
      slug,
      category: category || 'imported',
      width: defaultW,
      height: defaultH,
      viewBox: parsed.viewBox || `0 0 ${defaultW} ${defaultH}`,
      nodes: parsed.nodes?.length ? parsed.nodes : [{ id: 'shape-1', kind: 'rect', x: 0, y: 0, width: defaultW, height: defaultH, rx: 8, fill: '#6C5CE7' }],
      events: [],
      animations: [],
      meta: { importedFrom: 'svg' },
      projectId,
      visibility,
      createdBy: actor?.id ?? null
    });
  }

  #createEntityFromHtml(type, htmlText, { name, category, projectId, visibility, actor }) {
    const slug = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const plainTitle = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      || htmlText.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
      || name;

    if (type === 'workflow') {
      return this.workflows.create({
        name: plainTitle || name,
        slug,
        description: 'Imported from HTML',
        projectId,
        visibility,
        nodes: [{ id: 'wn-1', title: plainTitle || name, x: 80, y: 80 }],
        edges: [],
        meta: { importedFrom: 'html' },
        createdBy: actor?.id ?? null
      });
    }

    const w = type === 'screen' ? 390 : type === 'element' ? 320 : type === 'button' ? 140 : 24;
    const h = type === 'screen' ? 844 : type === 'element' ? 180 : type === 'button' ? 44 : 24;
    return this.services[type].create({
      name: plainTitle || name,
      slug,
      category: category || 'imported',
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      nodes: [
        { id: 'bg-rect', kind: 'rect', x: 0, y: 0, width: w, height: h, rx: 10, fill: '#171B26', stroke: '#6C5CE7', strokeWidth: 1.5 },
        { id: 'label-txt', kind: 'text', x: Math.round(w / 2), y: Math.round(h / 2), text: plainTitle || name, fill: '#F1F5F9', fontSize: 13, textAnchor: 'middle' }
      ],
      events: [],
      animations: [],
      meta: { importedFrom: 'html', rawHtmlSnippet: htmlText.slice(0, 4000) },
      projectId,
      visibility,
      createdBy: actor?.id ?? null
    });
  }
}
