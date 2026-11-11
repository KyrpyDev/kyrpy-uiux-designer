/** Change requests: record, list, approve / reject with rollback (`CollaborationService`). */
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { restoreBody, workflowRestoreBody } from '../domain/doc-fingerprint.js';
import { fallbackOwnerId } from './default-owner.js';
import { noteSkipped, ForbiddenError } from './service-shared.js';

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
    const ownerId = Number(doc.creatorId || doc.rootOwnerId || fallbackOwnerId(this));
    const pub = this.auth?.publicUserId?.() ?? null;
    if (pub != null && ownerId === Number(pub)) {
      const actor = actorId != null ? this.users?.get(Number(actorId)) : null;
      if (!force && actor && this.auth?.isSuperadmin(actor)) return null;
      if (!force && actorId == null) return null;
      let reviewer = 1;
      try { reviewer = Number(this.projects?.get(1)?.ownerId || fallbackOwnerId(this)); } catch { /* no default project */ }
      return { ownerId: reviewer };
    }
    const isCollaborator = actorId != null && Number(actorId) !== ownerId;
    return force || isCollaborator ? { ownerId } : null;
  }

  /**
   * Second half of the wiring: the design services, the workflow service and the library transfer need this service
   * and are built after it. Called by the composition root; `libraryTransfer` follows in a second call.
   */
  bind({ services = this.services, workflows = this.workflows, libraryTransfer = this.libraryTransfer } = {}) {
    if (!services || !Object.keys(services).length || !workflows) throw new Error('CollaborationService.bind needs services and workflows');
    Object.assign(this, { services, workflows, libraryTransfer });
    return this;
  }

  list(filter = {}) {
    return this.changes.list(filter).map(c => this.#enrichChange(c));
  }

  /** The same list without the before / after snapshots (open one change for them). */
  listLite(filter = {}) {
    return (this.changes.listLite ? this.changes.listLite(filter) : this.changes.list(filter)).map(c => this.#enrichChange(c));
  }


  pendingCount(projectId = null) {
    if (typeof this.changes.countByStatus === 'function') return this.changes.countByStatus({ projectId }).pending;
    return this.changes.list({ projectId, status: 'pending' }).length;
  }

  #enrichChange(c) {
    if (!c) return c;
    const beforeSnapshot = c.beforeSnapshot?.record ? { ...c.beforeSnapshot.record, ...c.beforeSnapshot } : c.beforeSnapshot;
    const afterSnapshot = c.afterSnapshot?.record ? { ...c.afterSnapshot.record, ...c.afterSnapshot } : c.afterSnapshot;
    return {
      ...c,
      title: c.title || c.summary,
      authorName: c.authorName || c.authorUsername || 'superadmin',
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
    // one open request per author and item: further edits extend it (its "before" is the state a reject restores)
    const open = action !== 'publish' && typeof this.changes.openEdit === 'function'
      ? this.changes.openEdit({ authorId: authorId ?? fallbackOwnerId(this), targetType, targetId }) : null;
    if (open) {
      const diff = this.computeDiff(open.beforeSnapshot || {}, afterSnapshot);
      return this.changes.updateAfter(open.id, {
        afterSnapshot, diffSummary: diff, action: 'update',
        targetKey: targetKey || afterDoc?.key || open.targetKey, targetName: targetName || afterDoc?.name || open.targetName,
        summary: `update on ${targetType} "${targetName || targetKey || open.targetName}": ${diff.addedNodes} added, ${diff.modifiedNodes} modified, ${diff.removedNodes} removed` +
          (diff.changedFields.length ? ` (fields: ${diff.changedFields.join(', ')})` : '')
      });
    }
    const diffSummary = this.computeDiff(beforeSnapshot, afterSnapshot);
    const autoSummary = summary || `${action} on ${targetType} "${targetName || targetKey}": ${diffSummary.addedNodes} added, ${diffSummary.modifiedNodes} modified, ${diffSummary.removedNodes} removed` +
      (diffSummary.changedFields.length ? ` (fields: ${diffSummary.changedFields.join(', ')})` : '');

    return this.changes.create({
      projectId: projectId ?? 1,
      targetType,
      targetId,
      targetKey: targetKey || afterDoc?.key || beforeDoc?.key || '',
      targetName: targetName || afterDoc?.name || beforeDoc?.name || '',
      authorId: authorId ?? fallbackOwnerId(this),
      ownerId: ownerId ?? fallbackOwnerId(this),
      action,
      summary: autoSummary,
      beforeSnapshot,
      afterSnapshot,
      diffSummary,
      status: 'pending'
    });
  }

  /**
   * "Publish to public": copies an item (with all sub-items) into the public library. The superadmin and admins publish
   * right away; everybody else files a pending `publish` change request that the admins are informed about (the
   * "Collaborative changes" list + badge) and the copy is made only after an admin approves it.
   */
  requestPublish({ type, id, actor = null } = {}) {
    const t = String(type || '').trim().replace(/s$/, '');
    if (!['path', 'icon', 'button', 'element', 'screen', 'workflow'].includes(t) || !Number(id)) throw new ValidationError('Valid item type and id are required');
    if (!actor) throw new ForbiddenError('Sign in to publish');
    const svc = t === 'workflow' ? this.workflows : this.services?.[t];
    const item = svc?.get(Number(id));
    if (!item) throw new ValidationError(`${t} #${id} not found`);
    const pub = this.auth.publicUserId();
    if (pub != null && Number(item.creatorId) === Number(pub) && (item.visibility || 'public') === 'public') throw new ValidationError(`"${item.name}" is already in the public library`);
    if (!this.auth.isAdmin(actor) && Number(item.creatorId) !== Number(actor.id)) throw new ForbiddenError('Only the owner or an admin can publish this item');
    if (this.auth.isAdmin(actor)) {
      const res = this.libraryTransfer.publishToPublic({ type: t, id: Number(id), actor });
      return { status: 'published', ...res };
    }
    const dup = this.changes.list({ status: 'pending' }).find(c => c.action === 'publish' && c.targetType === t && Number(c.targetId) === Number(id));
    if (dup) return { status: 'pending', change: dup, duplicate: true };
    const superadmin = this.users.list().find(u => u.role === 'superadmin');
    const change = this.changes.create({
      projectId: item.projectId ?? 1, targetType: t, targetId: Number(id), targetKey: item.key || '', targetName: item.name || '',
      authorId: actor.id, ownerId: superadmin?.id ?? fallbackOwnerId(this), action: 'publish',
      summary: `publish ${t} "${item.name || item.key}" (with all sub-items) to the public library — needs admin approval`,
      beforeSnapshot: {}, afterSnapshot: {}, diffSummary: {}, status: 'pending'
    });
    return { status: 'pending', change };
  }

  recordChange(input = {}) {
    return this.recordEdit({
      ...input,
      authorId: input.authorId ?? input.actor?.id ?? fallbackOwnerId(this)
    });
  }

  /**
   * Owner approves a change: ensures `afterSnapshot` is applied and marks the change request as `approved`.
   */
  approve(changeId, { actor = null, reviewer = null, reviewerId = null, comment = '', reviewNote = '' } = {}) {
    const ch = this.get(changeId);
    if (ch.status !== 'pending') throw new ConflictError(`Change #${ch.id} is already ${ch.status}`);
    const effActor = actor || reviewer || (reviewerId ? this.users.get(Number(reviewerId)) : null);
    // AI changeset ops (src/mcp) are applied by their own review flow, not by snapshot restore
    if (this.externalReviewer?.handles(ch)) return this.externalReviewer.review(ch, 'approve', { actor: effActor, comment: comment || reviewNote || '' });
    if (ch.action === 'publish') {   // only admins may put items into the public library
      if (effActor && !this.auth.isAdmin(effActor)) throw new ForbiddenError('Only an admin can approve publishing to the public library');
      const author = this.users.get(ch.authorId);
      this.libraryTransfer.publishToPublic({ type: ch.targetType, id: ch.targetId, actor: effActor || author });
      return this.changes.updateStatus(ch.id, { status: 'approved', reviewerId: effActor?.id ?? reviewerId ?? ch.ownerId ?? fallbackOwnerId(this), reviewComment: comment || reviewNote || '' });
    }
    if (effActor && !this.auth.isAdmin(effActor) && effActor.id !== ch.ownerId) {
      const p = this.projects.get(ch.projectId);
      if (!p || p.ownerId !== effActor.id) throw new ForbiddenError('Only the item/project owner or admin can approve changes');
    }
    // Edits are applied to the item the moment they are made; approving only records the decision. The stored
    // snapshot is re-applied ONLY when the item was not touched since the change (a staged edit): restoring an old
    // snapshot over an item that has been edited again would silently undo those newer edits.
    if (ch.afterSnapshot && Array.isArray(ch.afterSnapshot.nodes) && !this.#editIsLive(ch)) {
      if (ch.targetType === 'workflow' && this.workflows) {
        try { this.workflows.restore(ch.targetId, ch.afterSnapshot); } catch (e) { noteSkipped('approve: re-applying the approved snapshot', e); }
      } else if (this.services[ch.targetType]) {
        try { this.services[ch.targetType].restore(ch.targetId, ch.afterSnapshot); } catch (e) { noteSkipped('approve: re-applying the approved snapshot', e); }
      }
    }
    return this.changes.updateStatus(ch.id, { status: 'approved', reviewerId: effActor?.id ?? reviewerId ?? ch.ownerId ?? fallbackOwnerId(this), reviewComment: comment || reviewNote || '' });
  }

  /** True when the target item was modified at or after the change was recorded (or no longer exists): nothing to re-apply. */
  #editIsLive(ch) {
    try {
      const svc = ch.targetType === 'workflow' ? this.workflows : this.services?.[ch.targetType];
      const cur = svc?.designs?.get ? svc.designs.get(ch.targetId) : svc?.get?.(ch.targetId);
      if (!cur) return true;                                        // deleted: nothing to apply
      const at = v => (v ? Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')) : NaN);
      const changed = at(ch.createdAt), updated = at(cur.updatedAt);
      return !(Number.isFinite(changed) && Number.isFinite(updated)) || updated >= changed;
    } catch { return true; }
  }

  /**
   * Owner rejects a change: restores `beforeSnapshot` (rolling back the collaborator's edit) and marks as `rejected`.
   */
  reject(changeId, { actor = null, reviewer = null, reviewerId = null, comment = '', reviewNote = '', force = false } = {}) {
    const ch = this.get(changeId);
    if (ch.status !== 'pending') throw new ConflictError(`Change #${ch.id} is already ${ch.status}`);
    // rejecting restores the state before this request: later requests of other people on the same item would be undone too
    if (!force && ch.action !== 'publish') {
      const later = this.changes.list({ targetType: ch.targetType, targetId: ch.targetId })
        .filter(o => o.id > ch.id && o.status !== 'rejected' && Number(o.authorId) !== Number(ch.authorId));
      if (later.length) {
        throw new ConflictError(`"${ch.targetName || ch.targetKey}" was changed again after this request (#${later.map(o => o.id).join(', #')}); rejecting it would undo those edits. Review them first, or reject with force.`);
      }
    }
    const effActor = actor || reviewer || (reviewerId ? this.users.get(Number(reviewerId)) : null);
    if (this.externalReviewer?.handles(ch)) return this.externalReviewer.review(ch, 'reject', { actor: effActor, comment: comment || reviewNote || '' });
    if (effActor && !this.auth.isAdmin(effActor) && effActor.id !== ch.ownerId) {
      const p = this.projects.get(ch.projectId);
      if (!p || p.ownerId !== effActor.id) throw new ForbiddenError('Only the item/project owner or admin can reject changes');
    }
    if (ch.action !== 'publish' && ch.beforeSnapshot && Array.isArray(ch.beforeSnapshot.nodes)) {
      // a failed restore is reported (the request stays pending); an item that no longer exists has nothing to restore
      try {
        if (ch.targetType === 'workflow' && this.workflows) this.workflows.restore(ch.targetId, ch.beforeSnapshot);
        else if (this.services[ch.targetType]) this.services[ch.targetType].restore(ch.targetId, ch.beforeSnapshot);
      } catch (e) {
        if (e?.status !== 404) throw new ConflictError(`Change #${ch.id} could not be undone: ${e.message}`);
      }
    }
    return this.changes.updateStatus(ch.id, { status: 'rejected', reviewerId: effActor?.id ?? reviewerId ?? ch.ownerId ?? fallbackOwnerId(this), reviewComment: comment || reviewNote || '' });
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
