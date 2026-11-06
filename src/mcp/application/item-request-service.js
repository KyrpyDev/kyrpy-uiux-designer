/**
 * Item requests (milestone M5): a coding agent asks for a missing UI item; the server searches first and
 * returns the closest candidates; the designer agent claims the request, stages the item in a changeset
 * and links it; the request is fulfilled when the item exists in the project (after approval).
 *
 *   open → claimed → in-review (staged in a submitted changeset) → fulfilled
 *        ↘ cancelled (requester)            ↘ claimed again if the op was rejected
 *        ↘ rejected (human)
 */
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../domain/errors.js';
import { ITEM_TYPES } from '../domain/item-validation.js';

const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const toRequest = r => r && ({
  id: r.id, uid: r.uid, projectId: r.project_id, type: r.item_type, intent: r.intent, constraints: json(r.constraints, {}),
  context: json(r.context, {}), candidates: json(r.candidates, []), status: r.status, requestedByUser: r.requested_by_user,
  requestedByKey: r.requested_by_key, claimedByKey: r.claimed_by_key, claimedAt: r.claimed_at,
  item: r.fulfilled_item_uid ? { type: r.fulfilled_item_type, uid: r.fulfilled_item_uid, key: r.fulfilled_item_key } : null,
  changeset: r.changeset_uid, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at
});
const plainObject = (v, name) => {
  if (v === undefined) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`${name} must be an object`);
  if (JSON.stringify(v).length > 8000) throw new ValidationError(`${name} must be at most 8000 characters as JSON`);
  return v;
};

export class ItemRequestService {
  /** @param {{db, query, reads, versionRepo, projects, auth, newUid, now?}} d */
  constructor(d) { Object.assign(this, { now: () => new Date(), ...d }); }

  #iso() { return this.now().toISOString(); }
  #get(uid) { return toRequest(this.db.prepare('SELECT * FROM item_requests WHERE uid = ?').get(String(uid || ''))); }
  #set(id, patch) {
    const cols = { status: 'status', claimedByKey: 'claimed_by_key', claimedAt: 'claimed_at', itemType: 'fulfilled_item_type', itemUid: 'fulfilled_item_uid',
      itemKey: 'fulfilled_item_key', changeset: 'changeset_uid', note: 'note', resolvedAt: 'resolved_at' };
    const sets = ['updated_at = ?'], args = [this.#iso()];
    for (const [k, c] of Object.entries(cols)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    this.db.prepare(`UPDATE item_requests SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const pid = this.db.prepare('SELECT project_id FROM item_requests WHERE id = ?').get(id)?.project_id;
    if (pid != null) this.onChange?.(pid);
  }

  #mine(principal, uid) {
    const r = this.#get(uid);
    if (!r || r.projectId !== principal.project.id) throw new NotFoundError('item request', uid);
    return r;
  }

  view(r) { return r; }

  /** Searches, then records the request with the candidates (unless searchOnly). */
  request(principal, { type, intent, constraints, context, searchOnly = false } = {}) {
    if (!ITEM_TYPES.includes(type)) throw new ValidationError(`type must be one of ${ITEM_TYPES.join(', ')}`);
    const text = String(intent || '').trim();
    if (text.length < 3) throw new ValidationError('intent: describe the item in a few words');
    const c1 = plainObject(constraints, 'constraints'), c2 = plainObject(context, 'context');
    const found = this.query.search(principal, { query: text, types: [type], limit: 5 });
    const candidates = found.results.map(r => ({ type: r.type, uid: r.uid, key: r.key, name: r.name, scope: r.scope, score: r.score, purpose: r.purpose, untrusted: r.untrusted }));
    if (searchOnly) return { request: null, candidates, hint: candidates.length ? 'Use a candidate if it fits.' : 'Nothing similar exists; call again without searchOnly to request it.' };
    const uid = this.newUid();
    this.db.prepare(`INSERT INTO item_requests (uid, project_id, item_type, intent, constraints, context, candidates, requested_by_user, requested_by_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, principal.project.id, type, text.slice(0, 1000), JSON.stringify(c1), JSON.stringify(c2),
      JSON.stringify(candidates), principal.user.id, principal.apiKeyId ?? null);
    this.onChange?.(principal.project.id);
    return { request: this.#get(uid), candidates,
      hint: candidates.length ? 'Check the candidates: if one fits, use it and call uiux_cancel_request.' : 'Hand the request uid to the kyrpy-uiux-designer agent.' };
  }

  list(principal, { status, limit = 50 } = {}) {
    const where = ['project_id = ?'], args = [principal.project.id];
    if (status) { where.push('status = ?'); args.push(status); }
    return { requests: this.db.prepare(`SELECT * FROM item_requests WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 50, 200)).map(toRequest) };
  }

  get(principal, { request } = {}) { return this.#mine(principal, request); }

  cancel(principal, { request, reason = '' } = {}) {
    const r = this.#mine(principal, request);
    if (!['open', 'claimed'].includes(r.status)) throw new ConflictError(`request is ${r.status}`);
    this.#set(r.id, { status: 'cancelled', note: String(reason).slice(0, 500), resolvedAt: this.#iso() });
    return this.#get(r.uid);
  }

  claim(principal, { request } = {}) {
    const r = this.#mine(principal, request);
    if (r.status === 'claimed' && r.claimedByKey === principal.apiKeyId) return r;
    if (r.status !== 'open') throw new ConflictError(`request is ${r.status}`);
    this.#set(r.id, { status: 'claimed', claimedByKey: principal.apiKeyId ?? null, claimedAt: this.#iso() });
    return this.#get(r.uid);
  }

  /**
   * Links the item that fulfils the request: an existing project item (fulfilled now), or an item staged
   * in a changeset (in review until that changeset op is applied).
   */
  fulfill(principal, { request, type, ref, changeset } = {}) {
    const r = this.#mine(principal, request);
    if (!['open', 'claimed', 'in-review'].includes(r.status)) throw new ConflictError(`request is ${r.status}`);
    const t = type || r.type;
    if (!ITEM_TYPES.includes(t)) throw new ValidationError(`type must be one of ${ITEM_TYPES.join(', ')}`);
    if (changeset) {
      const cs = this.versionRepo.changeset(String(changeset));
      if (!cs || cs.projectId !== principal.project.id) throw new NotFoundError('changeset', changeset);
      const op = this.versionRepo.ops(cs.id).find(o => o.type === t && (o.key === ref || o.itemUid === ref) && o.op !== 'delete');
      if (!op) throw new NotFoundError(`staged ${t} in the changeset`, ref);
      if (op.status === 'applied') return this.#done(r, t, op.itemUid, op.key);
      this.#set(r.id, { status: 'in-review', itemType: t, itemUid: op.itemUid, itemKey: op.key, changeset: cs.uid });
      return this.#get(r.uid);
    }
    const row = this.reads.find(t, ref, principal.project.id);
    if (!row || row.project_id !== principal.project.id) throw new NotFoundError(`project ${t}`, ref);
    return this.#done(r, t, row.uid, row.key);
  }

  #done(r, type, uid, key, note) {
    this.#set(r.id, { status: 'fulfilled', itemType: type, itemUid: uid, itemKey: key, resolvedAt: this.#iso(), ...(note ? { note } : {}) });
    return this.#get(r.uid);
  }

  /** Called by the changeset review for every reviewed op. */
  onOpReviewed(changesetUid, op, status) {
    const rows = this.db.prepare("SELECT * FROM item_requests WHERE changeset_uid = ? AND fulfilled_item_uid = ? AND status = 'in-review'").all(changesetUid, op.itemUid).map(toRequest);
    for (const r of rows) {
      if (status === 'applied') this.#done(r, r.item.type, r.item.uid, r.item.key);
      else this.#set(r.id, { status: 'claimed', note: `the proposed item was ${status} in review; propose another` });
    }
  }

  /* ---------- designer (session) side ---------- */

  #assertMember(projectId, actor) {
    if (!actor) throw new ForbiddenError('sign in first');
    const p = this.projects.get(Number(projectId));
    if (!p) throw new NotFoundError('project', projectId);
    const m = this.projects.getMember?.(p.id, actor.id);
    if (p.ownerId !== actor.id && !this.auth.isAdmin(actor) && !(m && (m.status || 'accepted') === 'accepted')) throw new ForbiddenError('not a member of this project');
    return p;
  }

  listForActor(projectId, actor, { status } = {}) {
    const p = this.#assertMember(projectId, actor);
    return this.list({ project: { id: p.id } }, { status, limit: 200 }).requests;
  }

  /** A human fulfils a request by hand with an existing project item. */
  fulfillByHand(uid, { type, ref } = {}, actor) {
    const r = this.#get(uid);
    if (!r) throw new NotFoundError('item request', uid);
    this.#assertMember(r.projectId, actor);
    if (!['open', 'claimed', 'in-review'].includes(r.status)) throw new ConflictError(`request is ${r.status}`);
    const t = type || r.type;
    const row = this.reads.find(t, ref, r.projectId);
    if (!row || row.project_id !== r.projectId) throw new NotFoundError(`project ${t}`, ref);
    return this.#done(r, t, row.uid, row.key, `fulfilled by @${actor.username}`);
  }

  rejectByHand(uid, { note = '' } = {}, actor) {
    const r = this.#get(uid);
    if (!r) throw new NotFoundError('item request', uid);
    this.#assertMember(r.projectId, actor);
    if (['fulfilled', 'cancelled', 'rejected'].includes(r.status)) throw new ConflictError(`request is ${r.status}`);
    this.#set(r.id, { status: 'rejected', note: String(note || `rejected by @${actor.username}`).slice(0, 500), resolvedAt: this.#iso() });
    return this.#get(r.uid);
  }
}
