/** Users, sign-in / registration, sessions and role checks (`AuthService`). */
import { randomBytes } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { USER_ROLES } from '../domain/entities.js';
import { passwordMatches, passwordMatchesAsync, hashPassword, hashUserPassword, hashUserPasswordAsync, hashablePassword, assertNewPassword } from './passwords.js';
import { isSystemUser, isSystemUsername, isReservedEmail, PUBLIC_USERNAME } from '../domain/system-users.js';
import { ForbiddenError, UnauthorizedError, TooManyAttemptsError } from './service-shared.js';

const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const AVATAR_COLORS = ['#2e9bff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444'];

export class AuthService {
  constructor({ users, transaction }) {
    Object.assign(this, { users, transaction });
    // `${identifier}|${ip}` -> { count, start }: in the database when the repository offers it (shared by all
    // processes, survives a restart), otherwise in memory
    let store = null;
    try { store = users.loginFailureStore?.() ?? null; store?.get('probe'); } catch { store = null; }
    this.loginFailures = store || new Map();
    this.loginSweepAt = 0;
  }

  /** Start-up writes, called by the composition root (never by the constructor): default accounts, hashed session tokens. */
  seed() {
    this.ensureDefaultAdmin();
    try { this.users.hashLegacySessions?.(); } catch { /* sessions table not there yet */ }
    return this;
  }

  /** Guarantees default admin users `kyrpy` (id = 1) and `admin` (default startup credential `admin`/`admin`) exist. */
  ensureDefaultAdmin() {
    // the superadmin is found by role, then by name; id 1 is only a last resort (ids can change after a PostgreSQL pull)
    const byRole = this.users.list().find(u => u.role === 'superadmin' && !isSystemUser(u));
    const byName = this.users.getByUsernameOrEmail('superadmin') || this.users.getByUsernameOrEmail('kyrpy');
    const first = this.users.getWithAuth(1);
    const found = byRole || byName || (first && !isSystemUser(first) && ['superadmin', 'admin'].includes(first.role) ? first : null);
    const existing = found ? this.users.getWithAuth(found.id) : null;
    if (!existing) {
      const { salt, passwordHash } = hashPassword('superadmin', 'superadmin_salt_v1');
      this.users.create({
        username: 'superadmin',
        email: 'superadmin@local.dev',
        passwordHash,
        salt,
        displayName: 'Superadmin',
        role: 'superadmin',
        status: 'active',
        permissions: ['*'],
        avatarColor: '#2e9bff'
      });
    } else {
      const patch = {};
      if (existing.username === 'kyrpy') {   // the account is now called `superadmin` (the role name); a password the person set stays
        Object.assign(patch, { username: 'superadmin', displayName: 'Superadmin' });
        if (String(existing.email) === 'kyrpy@kyrpy.com') patch.email = 'superadmin@local.dev';
      }
      if (existing.passwordHash === 'default_kyrpy_admin' || ['kyrpy_salt_v1', 'superadmin_salt_v1'].includes(existing.salt)) {
        Object.assign(patch, hashPassword('superadmin', 'superadmin_salt_v1'));   // never changed: default superadmin/superadmin
      }
      if (Object.keys(patch).length) this.users.update(existing.id, patch);
    }

    // no account keeps the hash marker of migration 1 (it is not a hash and matches no password)
    for (const u of this.users.list()) {
      const row = this.users.getWithAuth(u.id);
      if (row?.passwordHash === 'default_kyrpy_admin' && !isSystemUser(row)) this.users.update(u.id, hashPassword(randomBytes(18).toString('base64url')));
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
        role: 'admin',
        status: 'active',
        permissions: ['*'],
        avatarColor: '#10b981'
      });
    }
    if (!this.users.getByUsernameOrEmail('user')) {
      const { salt, passwordHash } = hashPassword('user', 'user_salt_v1');
      this.users.create({ username: 'user', email: 'user@local.dev', passwordHash, salt, displayName: 'User', role: 'designer', status: 'active', permissions: [], avatarColor: '#f59e0b' });
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
    const adminUser = this.superadminUser() || this.defaultAdmin() || this.users.getByUsernameOrEmail('admin');
    const session = this.#issueSession(adminUser.id);
    return { user: this.users.get(adminUser.id), token: session.token, expiresAt: session.expiresAt, bypassed: true };
  }

  /** The one and only superadmin (the sole curator of the public library), or null. */
  superadminUser() { return (this.users.listByRole ? this.users.listByRole('superadmin') : this.users.list().filter(u => u.role === 'superadmin')).find(u => !isSystemUser(u)) || null; }

  defaultAdmin() {
    return this.users.get(1) || this.users.getByUsernameOrEmail('superadmin');
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
    return !!user && (user.role === 'admin' || user.role === 'superadmin' || (user.permissions || []).includes('*'));
  }

  /** True only for the single `superadmin`: the one user who edits / imports / updates / deletes the public library directly. */
  isSuperadmin(user) {
    return !!user && user.role === 'superadmin' && !isSystemUser(user);
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

  /** Creates an account and signs it in. Self-registration passes `designer` / `viewer`; other roles come from createUserByAdmin. */
  register({ username, email, password, displayName = '', role = 'designer' }, { hashed = null } = {}) {
    const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const mail = String(email || '').trim().toLowerCase();
    if (!uname || uname.length < 2) throw new ValidationError('Username must be at least 2 characters (a-z, 0-9, _, ., -)');
    if (!mail || !mail.includes('@')) throw new ValidationError('A valid email address is required');
    assertNewPassword(password, { username: uname, email: mail });   // one policy: register, admin create / reset, profile page
    if (isSystemUsername(uname)) throw new ConflictError(`Username "${uname}" is reserved for a system account`);
    if (isReservedEmail(mail)) throw new ConflictError(`Email "${mail}" is reserved for a system account`);
    if (this.users.getByUsernameOrEmail(uname)) throw new ConflictError(`Username "${uname}" is already registered`);
    if (this.users.getByUsernameOrEmail(mail)) throw new ConflictError(`Email "${mail}" is already registered`);
    const cleanRole = USER_ROLES.includes(role) && role !== 'superadmin' ? role : 'designer';
    const { salt, passwordHash } = hashed || hashUserPassword(password);   // `hashed`: computed by registerAsync
    const color = AVATAR_COLORS[this.users.list().length % AVATAR_COLORS.length];
    const user = this.users.create({
      username: uname,
      email: mail,
      passwordHash,
      salt,
      displayName: String(displayName || '').trim() || uname,
      role: cleanRole,
      status: 'active',
      permissions: cleanRole === 'admin' ? ['*'] : ['design:read', 'design:write', 'project:collaborate'],
      avatarColor: color
    });
    const session = this.#issueSession(user.id);
    return { user, token: session.token, expiresAt: session.expiresAt };
  }

  /** `register` for the server: the password hash is computed off the event loop. */
  async registerAsync(input = {}) {
    return this.register(input, { hashed: hashablePassword(input.password) ? await hashUserPasswordAsync(input.password) : null });
  }

  /** `createUserByAdmin` for the server (hash off the event loop). */
  async createUserByAdminAsync(actor, input = {}) {
    this.assertAdmin(actor);
    return this.createUserByAdmin(actor, input, { hashed: hashablePassword(input.password) ? await hashUserPasswordAsync(input.password) : null });
  }

  /** `updateUser` for the server: the current-password check and the new hash run off the event loop. */
  async updateUserAsync(id, patch = {}, actor = null, opts = {}) {
    const isSelf = !!actor && Number(actor.id) === Number(id);
    // no hash for a request that will be refused anyway
    if (!actor || !hashablePassword(patch?.password) || !(isSelf || this.isAdmin(actor))) return this.updateUser(id, patch, actor, { ...opts, pre: null });
    const currentOk = isSelf ? await passwordMatchesAsync(this.users.getWithAuth(Number(id)), patch.currentPassword) : true;
    const hashed = await hashUserPasswordAsync(patch.password);
    return this.updateUser(id, patch, actor, { ...opts, pre: { currentOk, hashed } });   // `pre` never comes from the request
  }

  /** `transferSuperadmin` for the server (password check off the event loop). */
  async transferSuperadminAsync(actor, targetId, input = {}) {
    const passwordOk = actor && input?.password ? await passwordMatchesAsync(this.users.getWithAuth(actor.id), input.password) : false;
    return this.transferSuperadmin(actor, targetId, input, { passwordOk });
  }

  /**
   * Signs in. A wrong name and a wrong password give the same answer; the account state (suspended, system) is
   * only reported to someone who knows the password. After LOGIN_MAX_FAILURES failures in LOGIN_WINDOW_MS for the
   * same account from the same address, further attempts are refused until the window ends.
   */
  login(input = {}) {
    const pre = this.#loginStart(input);
    return this.#loginFinish(pre, !!pre.user && passwordMatches(pre.user, pre.password));
  }

  /** `login` for the server: the password hash is computed off the event loop. */
  async loginAsync(input = {}) {
    const pre = this.#loginStart(input);
    return this.#loginFinish(pre, !!pre.user && await passwordMatchesAsync(pre.user, pre.password));
  }

  #loginStart({ usernameOrEmail, identifier, username, email, password, ip = '' } = {}) {
    const idStr = String(usernameOrEmail || identifier || username || email || '').trim();
    if (!idStr || !password) throw new ValidationError('Username/email and password are required');
    const bucket = `${idStr.toLowerCase()}|${ip || ''}`;
    const now = Date.now();
    const seen = this.loginFailures.get(bucket);
    if (seen && now - seen.start >= LOGIN_WINDOW_MS) this.loginFailures.delete(bucket);
    else if (seen && seen.count >= LOGIN_MAX_FAILURES) throw new TooManyAttemptsError(Math.ceil((seen.start + LOGIN_WINDOW_MS - now) / 1000));
    return { bucket, now, password, user: this.users.getByUsernameOrEmail(idStr) };
  }

  #loginFinish({ bucket, now, user: u }, matches) {
    // legacy default-admin passwords only work until the account's password is changed (see passwords.js)
    if (!matches) {
      const f = this.loginFailures.get(bucket) || { count: 0, start: now };
      f.count += 1;
      this.loginFailures.set(bucket, f);
      if (this.loginFailures.sweep) {
        if (now - this.loginSweepAt > LOGIN_WINDOW_MS) { this.loginSweepAt = now; this.loginFailures.sweep(now - LOGIN_WINDOW_MS); }
      } else if (this.loginFailures.size > 5000) for (const [k, v] of this.loginFailures) if (now - v.start >= LOGIN_WINDOW_MS) this.loginFailures.delete(k);
      throw new UnauthorizedError('Invalid username/email or password');
    }
    this.loginFailures.delete(bucket);
    this.#assertNotSystem(u, 'signed in to');
    if (u.status !== 'active') throw new ForbiddenError(`Account "${u.username}" is ${u.status}`);
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

  /**
   * An admin creates an account. `email` and `password` are required (no default address, no default password);
   * the password follows the same policy as everywhere else.
   */
  createUserByAdmin(actor, input = {}, { hashed = null } = {}) {
    this.assertAdmin(actor);
    if (input.role === 'superadmin') throw new ConflictError('There can be only one superadmin');
    const { user } = this.register({
      username: input.username,
      email: input.email,
      password: input.password,
      displayName: input.displayName || input.username,
      role: input.role || 'designer'
    }, { hashed });
    this.users.deleteSessionsOfUser?.(user.id);   // register signs the new account in; nobody holds that token
    if (input.status && ['active', 'suspended', 'pending'].includes(input.status)) {
      return this.users.update(user.id, { status: input.status });
    }
    return user;
  }

  /**
   * Updates a user: `updateUser(id, patch, actor, { token })`. The actor is required. A password change signs the
   * user out everywhere (an admin reset: every session; your own change: every session but `token`).
   */
  updateUser(id, patch = {}, actor = null, { token = null, pre = null } = {}) {
    if (!actor || !actor.id) throw new ForbiddenError('Sign in to update a user');
    const target = this.getUser(id);
    this.#assertNotSystem(target, 'updated');
    const isSelf = Number(actor.id) === Number(target.id);
    if (!this.isAdmin(actor) && !isSelf) throw new ForbiddenError('Only admins or the account owner can update this user');
    if (target.role === 'superadmin' && !isSelf) throw new ForbiddenError('Only the superadmin can update the superadmin account');
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
    const newPassword = patch.password !== undefined && patch.password !== null && patch.password !== '';
    if (newPassword) {
      // own password: prove the current one (the profile page does the same); admins resetting others don't
      if (isSelf && !(pre ? pre.currentOk : passwordMatches(this.users.getWithAuth(target.id), patch.currentPassword))) {
        throw new ValidationError('Current password is incorrect (change your own password on the profile page)');
      }
      assertNewPassword(patch.password, { username: target.username, email: clean.email || target.email });
      const { salt, passwordHash } = pre?.hashed || hashUserPassword(patch.password);
      clean.salt = salt;
      clean.passwordHash = passwordHash;
    }
    if (this.isAdmin(actor)) {
      if (patch.role !== undefined) {
        if (!USER_ROLES.includes(patch.role)) throw new ValidationError(`Role must be one of ${USER_ROLES.join(', ')}`);
        if (patch.role !== target.role) {
          if (target.role === 'superadmin') throw new ValidationError('The superadmin role cannot be changed; use "Transfer superadmin" to hand it over');
          if (patch.role === 'superadmin') throw new ConflictError('There can be only one superadmin');
        }
        clean.role = patch.role;
      }
      if (patch.status !== undefined) {
        if (!['active', 'suspended', 'pending'].includes(patch.status)) throw new ValidationError('Invalid user status');
        if (target.role === 'superadmin' && patch.status !== 'active') throw new ValidationError('The superadmin cannot be suspended');
        clean.status = patch.status;
      }
      if (patch.permissions !== undefined && Array.isArray(patch.permissions)) clean.permissions = patch.permissions;
    }
    const apply = () => {
      const saved = this.users.update(target.id, clean);
      if (newPassword) this.users.deleteSessionsOfUser?.(target.id, isSelf ? token : null);
      return saved;
    };
    const updated = this.transaction ? this.transaction(apply) : apply();
    if (patch.acl && typeof patch.acl === 'object') {
      return { ...updated, acl: patch.acl };
    }
    return updated;
  }

  /**
   * Deletes an account. Refused (409) while the user still owns projects or items: transfer or delete those
   * first, so nothing is left without an owner.
   */
  deleteUser(actor, id) {
    this.assertAdmin(actor);
    const target = this.getUser(id);
    this.#assertNotSystem(target, 'deleted');
    if (target.role === 'superadmin') throw new ValidationError('The superadmin cannot be deleted; transfer the superadmin role first');
    const owned = this.users.ownedCounts?.(target.id);
    if (owned && owned.total > 0) {
      throw new ConflictError(`@${target.username} still owns ${owned.projects} project(s) and ${owned.items} item(s); transfer or delete them first`);
    }
    this.users.delete(target.id);
    return { deleted: true, id: target.id };
  }

  /**
   * Hands the single `superadmin` role to another active user; the previous superadmin becomes `admin`.
   * Needs the current superadmin and their password. Atomic: demote first so the partial unique index
   * (users.role = 'superadmin') never sees two.
   */
  transferSuperadmin(actor, targetId, { password = null } = {}, { passwordOk = null } = {}) {
    if (!this.isSuperadmin(actor)) throw new ForbiddenError('Only the superadmin can transfer the superadmin role');
    const target = this.getUser(targetId);
    this.#assertNotSystem(target, 'made superadmin');
    if (Number(target.id) === Number(actor.id)) throw new ValidationError('You are already the superadmin');
    if (target.status !== 'active') throw new ValidationError('The new superadmin must be an active user');
    if (!password) throw new ValidationError('Re-enter your password to transfer the superadmin role');
    if (!(passwordOk ?? passwordMatches(this.users.getWithAuth(actor.id), password))) throw new ValidationError('Password is incorrect');
    const run = () => {
      this.users.update(actor.id, { role: 'admin' });
      return this.users.update(target.id, { role: 'superadmin' });
    };
    const user = this.transaction ? this.transaction(run) : run();
    return { transferred: true, superadmin: user, previous: this.users.get(actor.id) };
  }
}
