/**
 * API key rules (pure). Keys let an AI coding agent act for one user through MCP.
 *
 * Kinds:
 *  - `project` key: bound to one project the user owns (default; least privilege for one repository).
 *  - `account` key (user-wide): not bound to a project. Each call names its project. It can read / clone
 *    every project the user can see, create new projects owned by the user (`create`), and propose or
 *    request only on projects the user owns. Meant for "clone a design → build an app → push it back as a
 *    new project" workflows. It never approves anything.
 *
 * Format: `kud_<env>_<32 base62 chars>` (≈190 bits), for example `kud_live_3fA9…`.
 *  - the `kud_` prefix makes leaked keys easy to find for secret scanners
 *  - `prefix` (first 13 chars, `kud_live_3fA9`) is stored in clear for display and lookup
 *  - the full key is stored only as HMAC-SHA256(pepper, key); the plaintext is shown once
 */
import { ValidationError } from '../../domain/errors.js';

export const KEY_ENVS = ['live', 'test'];
export const KEY_RE = /^kud_(live|test)_[0-9A-Za-z]{32}$/;
export const KEY_PREFIX_LENGTH = 13;

/** `read` is always granted; `request` creates item requests; `propose` stages changesets (never approves);
 *  `create` (account keys only) creates new projects owned by the key's user. */
export const SCOPES = ['read', 'request', 'propose', 'create'];
export const DEFAULT_SCOPES = ['read', 'request', 'propose'];
export const KEY_KINDS = ['project', 'account'];
export const SCOPES_BY_KIND = { project: ['read', 'request', 'propose'], account: ['read', 'request', 'propose', 'create'] };
export const DEFAULT_SCOPES_BY_KIND = { project: ['read', 'request', 'propose'], account: ['read', 'request', 'propose', 'create'] };

export function normalizeKind(kind) {
  const k = kind === undefined || kind === null || kind === '' ? 'project' : String(kind);
  if (!KEY_KINDS.includes(k)) throw new ValidationError(`key kind must be one of ${KEY_KINDS.join(', ')}`);
  return k;
}

export const EXPIRY_PRESETS_DAYS = [30, 90, 365];
export const DEFAULT_EXPIRY_DAYS = 90;
export const MAX_EXPIRY_DAYS = 3650;
export const ROTATION_GRACE_HOURS = 24;
export const MAX_ACTIVE_KEYS_PER_USER = 50;
export const NAME_MAX = 80;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Builds a new plaintext key. `randomBytes(n)` is injected (node:crypto in production). */
export function generateKey(randomBytes, env = 'live') {
  if (!KEY_ENVS.includes(env)) throw new ValidationError(`key env must be one of ${KEY_ENVS.join(', ')}`);
  let body = '';
  while (body.length < 32) {
    for (const b of randomBytes(48)) {
      if (b < 248) body += BASE62[b % 62];   // 248 = 4 × 62: rejection sampling keeps the distribution uniform
      if (body.length === 32) break;
    }
  }
  return `kud_${env}_${body}`;
}

export const isKeyFormat = v => typeof v === 'string' && KEY_RE.test(v);
export const keyPrefix = key => String(key).slice(0, KEY_PREFIX_LENGTH);

/** Normalizes requested scopes for a key kind: unknown → error, `read` always included, stable order. */
export function normalizeScopes(input, kind = 'project') {
  const allowed = SCOPES_BY_KIND[kind] || SCOPES_BY_KIND.project;
  const list = input === undefined || input === null ? (DEFAULT_SCOPES_BY_KIND[kind] || DEFAULT_SCOPES) : input;
  if (!Array.isArray(list)) throw new ValidationError('scopes must be an array');
  const bad = list.filter(s => !allowed.includes(s));
  if (bad.length) throw new ValidationError(`unknown scope(s) for a ${kind} key: ${bad.join(', ')}; allowed: ${allowed.join(', ')}`);
  const set = new Set(['read', ...list]);
  return allowed.filter(s => set.has(s));
}

/** `null` / 'never' → no expiry; a number of days → ISO time. */
export function expiryFrom(days, now = new Date()) {
  if (days === null || days === 'never') return null;
  const n = days === undefined ? DEFAULT_EXPIRY_DAYS : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXPIRY_DAYS) {
    throw new ValidationError(`expiresInDays must be an integer between 1 and ${MAX_EXPIRY_DAYS}, or null for no expiry`);
  }
  return new Date(now.getTime() + n * 86400_000).toISOString();
}

export function normalizeName(name) {
  const s = String(name ?? '').trim();
  if (!s) throw new ValidationError('key name is required (for example "Claude Code — laptop")');
  if (s.length > NAME_MAX) throw new ValidationError(`key name must be at most ${NAME_MAX} characters`);
  return s;
}

/** active | expired | revoked | rotating (replaced by a newer key, still valid during the grace period). */
export function keyStatus(k, now = new Date()) {
  if (k.revokedAt) return 'revoked';
  if (k.expiresAt && new Date(k.expiresAt) <= now) return 'expired';
  if (k.rotatedToId) return 'rotating';
  return 'active';
}

/** Project-level AI settings stored under `projects.settings.ai`. */
export const DEFAULT_AI_SETTINGS = { pushRequiresReview: true, mayCreatePublicItems: false };

export function normalizeAiSettings(input = {}, base = DEFAULT_AI_SETTINGS) {
  const out = { ...DEFAULT_AI_SETTINGS, ...base };
  for (const k of Object.keys(DEFAULT_AI_SETTINGS)) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== 'boolean') throw new ValidationError(`${k} must be true or false`);
    out[k] = input[k];
  }
  return out;
}
