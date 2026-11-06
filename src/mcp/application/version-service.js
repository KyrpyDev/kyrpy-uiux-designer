/**
 * Project versions (milestone M4): numbered, immutable manifest snapshots of a project.
 *
 * Head rule: the approved row is the head. Whenever the live project differs from the head (designers
 * edited it), `ensureHead()` records a new `designer` version first, so a version number always names one
 * exact manifest and a pull "since version N" is well defined. AI pushes become versions only on approval.
 */
import { NotFoundError, ValidationError, ForbiddenError } from '../../domain/errors.js';

export class VersionService {
  /**
   * @param {object} d
   * @param {import('../infrastructure/sqlite/version-repository.js').VersionRepository} d.repo
   * @param {import('./design-query-service.js').DesignQueryService} d.query
   * @param {any} d.projects core ProjectRepository
   * @param {any} d.auth core AuthService
   * @param {(fn: Function) => any} d.transaction
   */
  constructor(d) { Object.assign(this, d); }

  /** A principal-shaped view of the project itself (the manifest only depends on the project). */
  projectPrincipal(projectId) {
    const p = this.projects.get(Number(projectId));
    if (!p) throw new NotFoundError('project', projectId);
    return { project: { id: p.id, key: p.key, name: p.name }, user: { id: p.ownerId } };
  }

  liveManifest(projectId) { return this.query.manifest(this.projectPrincipal(projectId)); }

  #snapshot(m) { return m.items.map(e => ({ type: e.type, uid: e.uid, key: e.key, contentHash: e.contentHash, origin: e.origin })); }

  /** Returns the head version, recording a new one first when the live project differs from it. */
  ensureHead(projectId, { userId = null } = {}) {
    return this.transaction(() => {
      this.library?.adoptAll(projectId);   // project scope: used foreign items become project clones first
      const live = this.liveManifest(projectId);
      const head = this.repo.head(projectId);
      if (head && head.manifestHash === live.manifestHash) return head;
      this.repo.supersedeHead(projectId);
      return this.repo.insertVersion({
        projectId, number: this.repo.nextNumber(projectId), parentId: head?.id ?? null,
        source: head ? 'designer' : 'import', status: 'approved',
        manifest: this.#snapshot(live), manifestHash: live.manifestHash,
        message: head ? 'Designer changes' : 'Baseline', createdByUser: userId, approvedAt: new Date().toISOString()
      });
    });
  }

  /** Creates the pending version of a submitted changeset (no number yet). */
  createPending({ projectId, parentId, changesetId, message, label, userId, apiKeyId }) {
    return this.repo.insertVersion({ projectId, parentId, source: 'ai-push', status: 'pending', changesetId, message, label, createdByUser: userId, createdByKey: apiKeyId });
  }

  /** Approves a pending version: it becomes the head with the live manifest and the next number. */
  approvePending(versionId, { reviewerId = null } = {}) {
    const v = this.repo.version(versionId);
    if (!v || v.status !== 'pending') throw new ValidationError('version is not pending');
    this.library?.adoptAll(v.projectId);
    const live = this.liveManifest(v.projectId);
    const head = this.repo.head(v.projectId);
    this.repo.supersedeHead(v.projectId);
    return this.repo.updateVersion(v.id, {
      status: 'approved', number: this.repo.nextNumber(v.projectId), parentId: head?.id ?? v.parentId,
      manifest: this.#snapshot(live), manifestHash: live.manifestHash, approvedBy: reviewerId, approvedAt: new Date().toISOString()
    });
  }

  reject(versionId) { return this.repo.updateVersion(versionId, { status: 'rejected' }); }

  /** Version by number (or the head when number is omitted). */
  get(projectId, number) {
    if (number === undefined || number === null) return this.ensureHead(projectId);
    const v = this.repo.byNumber(projectId, number);
    if (!v) throw new NotFoundError('version', number);
    return v;
  }

  view(v, { withManifest = false } = {}) {
    if (!v) return null;
    const { manifest, ...rest } = v;
    return { ...rest, items: manifest.length, ...(withManifest ? { manifest } : {}) };
  }

  list(projectId, { limit } = {}) {
    const head = this.ensureHead(projectId);
    return { head: head.number, versions: this.repo.listVersions(projectId, { limit }).map(v => this.view(v)) };
  }

  /** What changed from version `since` to the head: added / changed / removed items. */
  delta(projectId, since) {
    const head = this.ensureHead(projectId);
    const from = this.repo.byNumber(projectId, since);
    if (!from || from.number == null) throw new NotFoundError('version', since);
    const a = new Map(from.manifest.map(e => [e.uid, e]));
    const b = new Map(head.manifest.map(e => [e.uid, e]));
    const added = [], changed = [], removed = [];
    for (const [uid, e] of b) {
      if (!a.has(uid)) added.push(e);
      else if (a.get(uid).contentHash !== e.contentHash) changed.push({ ...e, previousHash: a.get(uid).contentHash });
    }
    for (const [uid, e] of a) if (!b.has(uid)) removed.push(e);
    return {
      fromVersion: from.number, toVersion: head.number, manifestHash: head.manifestHash,
      empty: !added.length && !changed.length && !removed.length, added, changed, removed
    };
  }

  /* ---------- designer (session) side ---------- */

  #assertMember(projectId, actor) {
    if (!actor) throw new ForbiddenError('sign in first');
    const p = this.projects.get(Number(projectId));
    if (!p) throw new NotFoundError('project', projectId);
    const m = this.projects.getMember?.(p.id, actor.id);
    const member = p.ownerId === actor.id || this.auth.isAdmin(actor) || (m && (m.status || 'accepted') === 'accepted');
    if (!member) throw new ForbiddenError('not a member of this project');
    return p;
  }

  listForActor(projectId, actor) { this.#assertMember(projectId, actor); return this.list(projectId); }

  getForActor(projectId, number, actor) {
    this.#assertMember(projectId, actor);
    return this.view(this.get(projectId, number), { withManifest: true });
  }

  /** "Save version": records the live state (if it changed) and labels the head. */
  snapshotForActor(projectId, { label = '', message = '' } = {}, actor) {
    this.#assertMember(projectId, actor);
    if (label && !/^[0-9A-Za-z.+-]{1,40}$/.test(label)) throw new ValidationError('label: up to 40 characters of letters, digits, ".", "+" or "-"');
    const head = this.ensureHead(projectId, { userId: actor.id });
    return this.view(this.repo.updateVersion(head.id, { ...(label ? { label } : {}), ...(message ? { message: String(message).slice(0, 500) } : {}) }));
  }
}
