/**
 * Password hashing, verification and policy (scrypt, per-user random salt).
 *
 * Salt marker: passwords set by a person (profile page, admin reset, registration) get a salt that starts
 * with `USER_SALT_PREFIX`. The legacy default-admin fallback passwords (`kyrpy` / `kyrpy123` / `admin` …)
 * are accepted ONLY while an account still has a salt without that marker, i.e. its password was never
 * changed. After the first real password change the fallback stops working for that account.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../domain/errors.js';

export const USER_SALT_PREFIX = 'u1:';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

/** Published default accounts: superadmin/superadmin, admin/admin, user/user (+ the pre-rename `kyrpy` passwords). Change them after the first start. */
export const DEFAULT_ACCOUNTS = [
  { username: 'superadmin', password: 'superadmin', email: 'superadmin@local.dev', displayName: 'Superadmin', role: 'superadmin', avatarColor: '#2e9bff' },
  { username: 'admin', password: 'admin', email: 'admin@local.dev', displayName: 'Administrator', role: 'admin', avatarColor: '#10b981' },
  { username: 'user', password: 'user', email: 'user@local.dev', displayName: 'User', role: 'designer', avatarColor: '#f59e0b' }
];
const LEGACY_DEFAULTS = {
  superadmin: ['superadmin', 'kyrpy', 'kyrpy123'],
  admin: ['admin', 'admin123'],
  user: ['user']
};

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

/** Hash for a password chosen by a person: marks the salt so legacy fallbacks no longer apply. */
export function hashUserPassword(password) {
  return hashPassword(password, `${USER_SALT_PREFIX}${randomBytes(16).toString('hex')}`);
}

export function verifyPassword(password, storedHash, salt) {
  if (!password) return false;
  if (storedHash === 'default_kyrpy_admin') return LEGACY_DEFAULTS.superadmin.includes(String(password));
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

/** True when the account's password was set by a person (profile, admin reset, registration). */
export const hasUserPassword = user => String(user?.salt || '').startsWith(USER_SALT_PREFIX);

/** Checks a password against a user row that includes `passwordHash` + `salt` (see UserRepository.getWithAuth). */
export function passwordMatches(user, password) {
  if (!user || !password) return false;
  if (verifyPassword(password, user.passwordHash, user.salt)) return true;
  if (hasUserPassword(user)) return false;
  return (LEGACY_DEFAULTS[user.username] || []).includes(String(password));
}

/** Rules for a new password. Returns the cleaned value or throws ValidationError. */
export function assertNewPassword(password, { username = '', email = '' } = {}) {
  const p = String(password ?? '');
  if (p.length < PASSWORD_MIN) throw new ValidationError(`Password must be at least ${PASSWORD_MIN} characters`);
  if (p.length > PASSWORD_MAX) throw new ValidationError(`Password must be at most ${PASSWORD_MAX} characters`);
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw new ValidationError('Password must contain at least one letter and one digit');
  const low = p.toLowerCase();
  if ((username && low === String(username).toLowerCase()) || (email && low === String(email).toLowerCase())) {
    throw new ValidationError('Password must not be your username or email');
  }
  return p;
}
