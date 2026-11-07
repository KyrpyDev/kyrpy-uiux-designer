/**
 * API key use cases: create / list / rotate / revoke keys for owned projects, authenticate a presented key,
 * and the project-level AI settings (`projects.settings.ai`).
 *
 * Rules (docs/project-definition/project-definition-mcp.md §5, §8, §15):
 *  - only the project owner creates keys for a project; admins may list and revoke any key
 *  - a project key is bound to one user × one project; it stops working when the user no longer owns the project
 *  - an account key is bound to one user only; access is checked per call (AccountService)
 *  - no caching: a revoked key fails on the very next call
 *  - every lifecycle event and authentication is written to `mcp_audit_log`
 */
import { DomainError, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../../domain/errors.js';
import { isSystemUser } from '../../domain/system-users.js';
import {
  generateKey, isKeyFormat, keyPrefix, normalizeScopes, normalizeKind, expiryFrom, normalizeName, keyStatus,
  ROTATION_GRACE_HOURS, MAX_ACTIVE_KEYS_PER_USER, MAX_EXPIRY_DAYS, normalizeAiSettings, DEFAULT_AI_SETTINGS
} from '../domain/api-key.js';

const AUDIT_RETENTION_DAYS = 90;
const unauthorized = (msg = 'invalid, expired or revoked API key') => new DomainError(msg, 'UNAUTHORIZED', 401);

export class ApiKeyService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/sqlite/api-key-repository.js').ApiKeyRepository} deps.keys
   * @param {import('../infrastructure/sqlite/api-key-repository.js').AuditLogRepository} deps.audit
   * @param {{get(id): any, update(id, patch): any}} deps.projects core ProjectRepository
   * @param {{get(id): any}} deps.users core UserRepository
   * @param {{isAdmin(u): boolean, canWrite(u): boolean}} deps.auth core AuthService
   * @param {(plaintext: string) => string} deps.hashKey HMAC-SHA256(pepper, key) → hex
   * @param {(a: string, b: string) => boolean} deps.safeEqual constant-time string compare
   * @param {(n: number) => Uint8Array} deps.randomBytes
   * @param {() => string} deps.newUid
   * @param {(fn: Function) => any} deps.transaction
   * @param {() => Date} [deps.now]
   * @param {'live'|'test'} [deps.keyEnv]
   */
  constructor(deps) {
    Object.assign(this, { now: () => new Date(), keyEnv: 'live' }, deps);
    try { this.audit.purgeOlderThan(new Date(this.now().getTime() - AUDIT_RETENTION_DAYS * 86400_000).toISOString()); } catch { /* table may be new */ }
  }

  /* ---------- helpers ---------- */

  #project(projectId) {
    const p = this.projects.get(Number(projectId));
    if (!p) throw new NotFoundError('project', projectId);
    return p;
  }

  #assertActor(actor) {
    if (!actor?.id) throw new DomainError('sign in to manage API keys', 'UNAUTHORIZED', 401);
    if (isSystemUser(actor) || isSystemUser(this.users?.get?.(Number(actor.id)))) throw new ForbiddenError(`system account "${actor.username || actor.id}" cannot own or manage API keys`);
  }

  #isOwner(project, actor) { return Number(project.ownerId) === Number(actor?.id); }

  #assertOwnerOrAdmin(project, actor) {
    this.#assertActor(actor);
    if (!this.#isOwner(project, actor) && !this.auth.isAdmin(actor)) {
      throw new ForbiddenError('only the project owner or an administrator can do this');
    }
  }

  #key(id) {
    const k = this.keys.get(id);
    if (!k) throw new NotFoundError('api key', id);
    return k;
  }

  #assertCanManageKey(key, actor) {
    this.#assertActor(actor);
    if (Number(key.userId) === Number(actor.id) || this.auth.isAdmin(actor)) return;
    const p = this.projects.get(key.projectId);
    if (p && this.#isOwner(p, actor)) return;
    throw new ForbiddenError('you can only manage your own keys or keys of projects you own');
  }

  /** Public view of a key: never includes the hash. */
  view(k) {
    return {
      id: k.id, uid: k.uid, kind: k.kind || 'project', name: k.name, prefix: k.prefix, scopes: k.scopes,
      projectId: k.projectId, projectKey: k.projectKey, projectName: k.projectName,
      userId: k.userId, username: k.username,
      createdAt: k.createdAt, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt, lastUsedIp: k.lastUsedIp,
      revokedAt: k.revokedAt, rotatedFromId: k.rotatedFromId, rotatedToId: k.rotatedToId,
      status: keyStatus(k, this.now())
    };
  }

  #issue({ userId, projectId = null, kind = 'project', name, scopes, expiresAt, rotatedFromId = null }) {
    const plaintext = generateKey(this.randomBytes, this.keyEnv);
    const row = this.keys.insert({
      uid: this.newUid(), userId, projectId: kind === 'account' ? null : projectId, kind, name, prefix: keyPrefix(plaintext),
      keyHash: this.hashKey(plaintext), scopes, expiresAt, rotatedFromId, createdAt: this.now().toISOString()
    });
    return { plaintext, row };
  }

  /* ---------- key management ---------- */

  listMine(actor) {
    this.#assertActor(actor);
    return this.keys.listByUser(actor.id).map(k => this.view(k));
  }

  listForProject(projectId, actor) {
    this.#assertOwnerOrAdmin(this.#project(projectId), actor);
    return this.keys.listByProject(projectId).map(k => this.view(k));
  }

  listAll(actor) {
    this.#assertActor(actor);
    if (!this.auth.isAdmin(actor)) throw new ForbiddenError('Administrator privileges required');
    return this.keys.listAll().map(k => this.view(k));
  }

  /** Creates a key. Returns `{ key, apiKey }`; `key` is the plaintext and is never retrievable again. */
  create(input = {}, actor, { ip = '' } = {}) {
    this.#assertActor(actor);
    if (!this.auth.canWrite(actor)) throw new ForbiddenError('read-only accounts cannot create API keys');
    const kind = normalizeKind(input.kind);
    let project = null;
    if (kind === 'project') {
      if (input.projectId === undefined || input.projectId === null || input.projectId === '') throw new ValidationError('projectId is required');
      project = this.#project(input.projectId);
      if (!this.#isOwner(project, actor)) throw new ForbiddenError('API keys can only be created for projects you own');
    } else if (input.projectId !== undefined && input.projectId !== null && input.projectId !== '') {
      throw new ValidationError('an account key is not bound to a project; leave projectId empty');
    }
    const name = normalizeName(input.name);
    const scopes = normalizeScopes(input.scopes, kind);
    const expiresAt = expiryFrom(input.expiresInDays, this.now());
    return this.transaction(() => {
      if (this.keys.countActiveByUser(actor.id, this.now().toISOString()) >= MAX_ACTIVE_KEYS_PER_USER) {
        throw new ConflictError(`you already have ${MAX_ACTIVE_KEYS_PER_USER} active keys; revoke unused ones first`);
      }
      const { plaintext, row } = this.#issue({ userId: actor.id, projectId: project?.id ?? null, kind, name, scopes, expiresAt });
      this.audit.record({ apiKeyId: row.id, userId: actor.id, projectId: project?.id ?? null, event: kind === 'account' ? 'key.create_account' : 'key.create', ip });
      return { key: plaintext, apiKey: this.view(row) };
    });
  }

  /**
   * Replaces a key with a new one (same project, name and scopes). The old key keeps working for
   * ROTATION_GRACE_HOURS so running agents can be updated, then expires.
   */
  rotate(id, actor, { ip = '', expiresInDays } = {}) {
    const old = this.#key(id);
    this.#assertCanManageKey(old, actor);
    const status = keyStatus(old, this.now());
    if (status !== 'active') throw new ConflictError(`only active keys can be rotated (this key is ${status})`);
    if ((old.kind || 'project') === 'project') {
      const project = this.#project(old.projectId);
      if (Number(project.ownerId) !== Number(old.userId)) throw new ConflictError('the key owner no longer owns this project; create a new key instead');
    }

    let days = expiresInDays;
    if (days === undefined) {
      days = old.expiresAt
        ? Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.round((new Date(old.expiresAt) - new Date(old.createdAt)) / 86400_000)))
        : null;
    }
    const expiresAt = expiryFrom(days, this.now());
    const graceEnd = new Date(this.now().getTime() + ROTATION_GRACE_HOURS * 3600_000);
    const oldEnd = old.expiresAt && new Date(old.expiresAt) < graceEnd ? old.expiresAt : graceEnd.toISOString();

    return this.transaction(() => {
      const { plaintext, row } = this.#issue({
        userId: old.userId, projectId: old.projectId, kind: old.kind || 'project', name: old.name, scopes: old.scopes, expiresAt, rotatedFromId: old.id
      });
      this.keys.markRotated(old.id, { rotatedToId: row.id, expiresAt: oldEnd });
      this.audit.record({ apiKeyId: old.id, userId: actor.id, projectId: old.projectId, event: 'key.rotate', ip });
      return { key: plaintext, apiKey: this.view(row), previous: this.view(this.keys.get(old.id)) };
    });
  }

  revoke(id, actor, { ip = '' } = {}) {
    const k = this.#key(id);
    this.#assertCanManageKey(k, actor);
    const changed = this.keys.revoke(k.id, { revokedBy: actor.id, at: this.now().toISOString() });
    if (changed) this.audit.record({ apiKeyId: k.id, userId: actor.id, projectId: k.projectId, event: 'key.revoke', ip });
    return this.view(this.keys.get(k.id));
  }

  revokeAllForProject(projectId, actor, { ip = '' } = {}) {
    const project = this.#project(projectId);
    this.#assertOwnerOrAdmin(project, actor);
    const revoked = this.keys.revokeAllForProject(project.id, { revokedBy: actor.id, at: this.now().toISOString() });
    this.audit.record({ userId: actor.id, projectId: project.id, event: 'key.revoke_all', ip });
    return { projectId: project.id, revoked };
  }

  auditLog({ projectId, apiKeyId, limit } = {}, actor) {
    this.#assertActor(actor);
    if (apiKeyId) this.#assertCanManageKey(this.#key(apiKeyId), actor);
    else if (projectId) this.#assertOwnerOrAdmin(this.#project(projectId), actor);
    else if (!this.auth.isAdmin(actor)) throw new ForbiddenError('pass projectId or apiKeyId');
    return this.audit.list({ projectId, apiKeyId, limit });
  }

  /* ---------- authentication (used by the MCP endpoint) ---------- */

  /**
   * Resolves a presented key to a principal `{ apiKeyId, keyUid, user, project, scopes }` or throws 401.
   * Updates last_used_at / last_used_ip and writes the audit log.
   */
  authenticate(plaintext, { ip = '' } = {}) {
    const fail = (apiKeyId, code, extra = {}) => {
      this.audit.record({ apiKeyId, event: 'auth.fail', result: 'denied', errorCode: code, ip, ...extra });
      return unauthorized();
    };
    if (!isKeyFormat(plaintext)) throw fail(null, 'BAD_FORMAT');
    const hash = this.hashKey(plaintext);
    const k = this.keys.findByPrefix(keyPrefix(plaintext)).find(c => this.safeEqual(c.keyHash, hash));
    if (!k) throw fail(null, 'UNKNOWN_KEY');
    const ctx = { userId: k.userId, projectId: k.projectId };
    const status = keyStatus(k, this.now());
    if (status === 'revoked') throw fail(k.id, 'REVOKED', ctx);
    if (status === 'expired') throw fail(k.id, 'EXPIRED', ctx);
    const user = this.users.get(k.userId);
    if (!user || user.status !== 'active') throw fail(k.id, 'USER_INACTIVE', ctx);
    if (isSystemUser(user)) throw fail(k.id, 'SYSTEM_USER', ctx);
    const base = {
      apiKeyId: k.id, keyUid: k.uid, keyName: k.name, prefix: k.prefix, scopes: k.scopes, expiresAt: k.expiresAt, status,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
    };
    if (k.kind === 'account') {
      // user-wide key: no project here; the MCP layer resolves and checks the project of every call
      const at = this.now().toISOString();
      this.keys.touch(k.id, { at, ip });
      this.audit.record({ apiKeyId: k.id, userId: k.userId, event: 'auth.ok', ip });
      return { ...base, kind: 'account', project: null };
    }
    const project = this.projects.get(k.projectId);
    if (!project) throw fail(k.id, 'PROJECT_GONE', ctx);
    if (Number(project.ownerId) !== Number(user.id)) throw fail(k.id, 'NOT_OWNER', ctx);

    const at = this.now().toISOString();
    this.keys.touch(k.id, { at, ip });
    this.audit.record({ apiKeyId: k.id, ...ctx, event: 'auth.ok', ip });
    return { ...base, kind: 'project', project: { id: project.id, key: project.key, name: project.name } };
  }

  hasScope(principal, scope) { return Array.isArray(principal?.scopes) && principal.scopes.includes(scope); }

  assertScope(principal, scope) {
    if (!this.hasScope(principal, scope)) {
      const e = new ForbiddenError(`this API key lacks the "${scope}" scope`);
      e.code = 'SCOPE_DENIED';
      throw e;
    }
  }

  /* ---------- project AI settings ---------- */

  getAiSettings(projectId, actor) {
    this.#assertActor(actor);
    const p = this.#project(projectId);
    return { projectId: p.id, ...normalizeAiSettings({}, p.settings?.ai || DEFAULT_AI_SETTINGS), canEdit: this.#isOwner(p, actor) || this.auth.isAdmin(actor) };
  }

  updateAiSettings(projectId, patch = {}, actor, { ip = '' } = {}) {
    const p = this.#project(projectId);
    this.#assertOwnerOrAdmin(p, actor);
    const ai = normalizeAiSettings(patch, p.settings?.ai || DEFAULT_AI_SETTINGS);
    this.projects.update(p.id, { settings: { ...(p.settings || {}), ai } });
    this.audit.record({ userId: actor.id, projectId: p.id, event: 'ai_settings.update', ip });
    return this.getAiSettings(p.id, actor);
  }
}
