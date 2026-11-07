/**
 * User profile (self service): view own account + activity, edit display name / email / avatar color,
 * change password (current password required; signs out every other session), list and revoke sessions.
 *
 * Release mode: every method needs a real session (`token`). Dev mode (login bypass on) without a token
 * acts as the default admin, like every other dev-mode request; the page then says so (`devFallback`).
 */
import { ForbiddenError, UnauthorizedError } from './user-project-collab-service.js';
import { ValidationError, ConflictError, NotFoundError } from '../domain/errors.js';
import { passwordMatches, hashUserPassword, assertNewPassword, hasUserPassword, PASSWORD_MIN } from './passwords.js';
import { sessionId } from '../infrastructure/sqlite/repositories/profile-repository.js';
import { isSystemUser, isReservedEmail } from '../domain/system-users.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export class ProfileService {
  /** @param {{users, profiles: import('../infrastructure/sqlite/repositories/profile-repository.js').ProfileRepository, auth, transaction}} d */
  constructor({ users, profiles, auth, transaction }) {
    Object.assign(this, { users, profiles, auth, transaction });
  }

  /** The signed-in user behind `token`. */
  #self(token) {
    let actor = token ? this.auth.resolveActor({ token, allowDefault: false }) : null;
    if (!actor && !token && this.auth.getAuthConfig?.().bypassLogin) actor = this.auth.resolveActor({ allowDefault: true });
    if (!actor) throw new UnauthorizedError('Sign in to manage your profile');
    if (isSystemUser(actor)) throw new ForbiddenError(`System account "${actor.username}" has no profile`);
    return actor;
  }

  get(token) {
    const me = this.#self(token);
    const withAuth = this.users.getWithAuth(me.id);
    return {
      user: this.users.get(me.id),
      devFallback: !token,
      isAdmin: this.auth.isAdmin(me),
      canWrite: this.auth.canWrite(me),
      passwordSetByUser: hasUserPassword(withAuth),
      passwordPolicy: { minLength: PASSWORD_MIN, needs: ['letter', 'digit'] },
      stats: this.profiles.stats(me.id),
      sessions: this.sessions(token)
    };
  }

  update(token, patch = {}) {
    const me = this.#self(token);
    const clean = {};
    if (patch.displayName !== undefined) {
      const v = String(patch.displayName).trim();
      if (!v || v.length > 80) throw new ValidationError('Display name must be 1–80 characters');
      clean.displayName = v;
    }
    if (patch.email !== undefined) {
      const v = String(patch.email).trim().toLowerCase();
      if (!EMAIL.test(v)) throw new ValidationError('A valid email address is required');
      if (isReservedEmail(v)) throw new ConflictError(`Email "${v}" is reserved for a system account`);
      if (this.profiles.emailTaken(v, me.id)) throw new ConflictError(`Email "${v}" is already used by another account`);
      if (v !== me.email) {
        // changing the sign-in email is sensitive: confirm with the password
        if (!passwordMatches(this.users.getWithAuth(me.id), patch.currentPassword)) throw new ValidationError('Enter your current password to change the email');
      }
      clean.email = v;
    }
    if (patch.avatarColor !== undefined) {
      const v = String(patch.avatarColor).trim();
      if (!HEX_COLOR.test(v)) throw new ValidationError('Avatar color must be a hex color like #2e9bff');
      clean.avatarColor = v;
    }
    for (const k of ['username', 'role', 'status', 'permissions', 'password']) {
      if (patch[k] !== undefined) throw new ValidationError(`"${k}" cannot be changed on the profile page`);
    }
    if (!Object.keys(clean).length) return this.get(token);
    this.users.update(me.id, clean);
    return this.get(token);
  }

  /** Changes the password. Other sessions are signed out; the current one stays. */
  changePassword(token, { currentPassword, newPassword, signOutOthers = true } = {}) {
    const me = this.#self(token);
    const row = this.users.getWithAuth(me.id);
    if (!passwordMatches(row, currentPassword)) throw new ValidationError('Current password is incorrect');
    const next = assertNewPassword(newPassword, { username: me.username, email: me.email });
    if (passwordMatches(row, next)) throw new ValidationError('The new password must differ from the current one');
    return this.transaction(() => {
      const { salt, passwordHash } = hashUserPassword(next);
      this.users.update(me.id, { salt, passwordHash });
      const signedOut = signOutOthers === false ? 0 : this.profiles.deleteSessionsExcept(me.id, token);
      return { changed: true, signedOutSessions: signedOut };
    });
  }

  sessions(token) {
    const me = this.#self(token);
    const cur = token ? sessionId(token) : null;
    return this.profiles.sessions(me.id).map(({ token: _t, ...s }) => ({ ...s, current: s.sid === cur }));
  }

  /** Revokes one of the user's sessions by its `sid` (revoking the current one signs this browser out). */
  revokeSession(token, sid) {
    const me = this.#self(token);
    const hit = this.profiles.sessions(me.id).find(s => s.sid === String(sid));
    if (!hit) throw new NotFoundError('session', sid);
    this.profiles.deleteSession(hit.token);
    return { revoked: 1, current: !!token && hit.sid === sessionId(token) };
  }

  revokeOtherSessions(token) {
    const me = this.#self(token);
    return { revoked: this.profiles.deleteSessionsExcept(me.id, token) };
  }
}
