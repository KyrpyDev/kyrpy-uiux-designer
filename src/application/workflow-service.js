import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../domain/errors.js';
import { normalizeWorkflow, normalizeLink } from '../domain/entities.js';
import { uniqueKey, slugify } from '../domain/naming.js';

/** Workflows: screens placed on an infinite canvas plus named links between them (optionally from a specific element). */
export class WorkflowService {
  constructor({ workflows, screens, nodes, users = null, collaboration = null, trash = null, transaction }) {
    Object.assign(this, { workflows, screens, nodes, users, collaboration, trash, transaction });
  }

  #enrichUsernames(w) {
    if (!w) return w;
    const creator = this.users ? this.users.get(w.creatorId || 1) : null;
    const rootOwner = this.users ? this.users.get(w.rootOwnerId || w.creatorId || 1) : null;
    return { ...w, creatorUsername: creator?.username || 'kyrpy', rootOwnerUsername: rootOwner?.username || 'kyrpy' };
  }

  list(query = {}) { return this.workflows.list(query).map(w => this.#enrichUsernames(w)); }

  #require(idOrKey) {
    const w = /^\d+$/.test(String(idOrKey)) ? this.workflows.get(Number(idOrKey)) : this.workflows.getByKey(String(idOrKey));
    if (!w) throw new NotFoundError('workflow', idOrKey);
    return w;
  }

  get(idOrKey) {
    const w = this.#require(idOrKey);
    return this.#enrichUsernames({ ...w, nodes: this.workflows.nodes(w.id), links: this.workflows.links(w.id) });
  }

  lineage(idOrKey) {
    const w = this.get(idOrKey);
    const rootItem = w.rootItemId && w.rootItemId !== w.id ? this.workflows.get(w.rootItemId) : w;
    const clonedFrom = w.clonedFromId ? this.workflows.get(w.clonedFromId) : null;
    const creator = this.users ? this.users.get(w.creatorId || 1) : { id: 1, username: 'kyrpy' };
    const rootOwner = this.users ? this.users.get(w.rootOwnerId || 1) : { id: 1, username: 'kyrpy' };
    const chain = [];
    const seen = new Set();
    let cur = w;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const u = this.users ? this.users.get(cur.creatorId || 1) : null;
      chain.push({
        id: cur.id,
        key: cur.key,
        name: cur.name,
        creatorId: cur.creatorId || 1,
        creatorUsername: u?.username || 'kyrpy',
        clonedFromId: cur.clonedFromId || null,
        rootItemId: cur.rootItemId || cur.id,
        rootOwnerId: cur.rootOwnerId || 1
      });
      cur = cur.clonedFromId ? this.workflows.get(cur.clonedFromId) : null;
    }
    return {
      item: { id: w.id, key: w.key, name: w.name, visibility: w.visibility, projectId: w.projectId },
      itemName: w.name,
      itemKey: w.key,
      visibility: w.visibility,
      projectId: w.projectId,
      creator: creator ? { id: creator.id, username: creator.username } : { id: 1, username: 'kyrpy' },
      rootOwner: rootOwner ? { id: rootOwner.id, username: rootOwner.username } : { id: 1, username: 'kyrpy' },
      rootItem: rootItem ? { id: rootItem.id, key: rootItem.key, name: rootItem.name } : { id: w.id, key: w.key, name: w.name },
      clonedFrom: clonedFrom ? { id: clonedFrom.id, key: clonedFrom.key, name: clonedFrom.name } : null,
      chain
    };
  }

  getLineage(idOrKey) {
    return this.lineage(idOrKey);
  }

  create(input, { actor = null, actorId = null } = {}) {
    const creatorId = actorId ?? actor?.id ?? input.creatorId ?? 1;
    const data = normalizeWorkflow({ ...input, creatorId, rootOwnerId: input.rootOwnerId ?? creatorId });
    if (input.key && this.workflows.keyExists(data.key, data.projectId)) throw new ConflictError(`workflow key "${data.key}" exists in this project`);
    if (!input.key) data.key = uniqueKey(data.name, k => this.workflows.keyExists(k, data.projectId));
    return this.get(this.workflows.create(data).id);
  }

  update(id, patch, { actor = null, actorId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const w = this.#require(id);
    const beforeDoc = (effActorId || recordChange) ? this.get(w.id) : null;
    const data = normalizeWorkflow({ ...patch }, { partial: true });
    if (data.key && data.key !== w.key && this.workflows.keyExists(data.key, data.projectId ?? w.projectId)) throw new ConflictError(`workflow key "${data.key}" exists`);
    this.workflows.update(w.id, data);
    const afterDoc = this.get(w.id);
    if (beforeDoc && this.collaboration && (recordChange || (effActorId && Number(effActorId) !== Number(w.creatorId || 1)))) {
      this.collaboration.recordEdit({
        projectId: afterDoc.projectId || 1,
        targetType: 'workflow',
        targetId: afterDoc.id,
        targetKey: afterDoc.key,
        targetName: afterDoc.name,
        authorId: effActorId ?? 1,
        ownerId: w.creatorId || 1,
        action: 'update',
        beforeDoc,
        afterDoc
      });
    }
    return afterDoc;
  }

  remove(id, { actor = null, permanent = false } = {}) {
    const w = this.#require(id);
    if (w.locked) throw new ConflictError(`workflow "${w.name || w.key}" is locked; unlock it before deleting`);
    const isPublic = (w.visibility || 'public') === 'public';
    if (isPublic && actor && !['admin', 'superadmin'].includes(actor.role)) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items');
    }
    let trashRec = null;
    if (!permanent && this.trash) {
      const snapshot = {
        uid: this.workflows.db?.prepare('SELECT uid FROM workflows WHERE id = ?').get(w.id)?.uid ?? null,   // keeps the MCP identity on restore
        record: w,
        nodes: this.workflows.nodes(w.id),
        links: this.workflows.links(w.id)
      };
      trashRec = this.trash.put({
        itemType: 'workflow',
        originalId: w.id,
        itemKey: w.key,
        itemName: w.name,
        label: w.label || '',
        category: 'workflow',
        projectId: w.projectId ?? 1,
        visibility: w.visibility || 'public',
        builtin: false,
        creatorId: w.creatorId ?? 1,
        rootOwnerId: w.rootOwnerId ?? 1,
        deletedBy: actor?.id ?? 1,
        snapshot
      });
    }
    this.workflows.delete(w.id);
    return { deleted: true, trashed: !permanent && Boolean(trashRec), id: w.id, trashId: trashRec?.id ?? null };
  }

  clone(id, opts = {}, { actor = null, actorId = null } = {}) {
    const name = typeof opts === 'string' ? opts : opts?.name;
    const { projectId, visibility, creatorId } = typeof opts === 'object' && opts ? opts : {};
    const src = this.get(id);
    const rootItemId = src.rootItemId || src.id;
    const rootOwnerId = src.rootOwnerId || src.creatorId || 1;
    const effCreatorId = creatorId ?? actorId ?? actor?.id ?? src.creatorId ?? 1;
    return this.transaction(() => {
      const copy = this.workflows.create({
        ...src,
        name: name || `${src.name} copy`,
        label: name || `${src.label} copy`,
        key: uniqueKey(slugify(name || ((projectId ?? src.projectId) !== src.projectId ? src.key : `${src.key}-copy`)), k => this.workflows.keyExists(k, projectId ?? src.projectId ?? 1)),
        projectId: projectId ?? src.projectId ?? 1,
        visibility: visibility ?? src.visibility ?? 'public',
        creatorId: effCreatorId,
        clonedFromId: src.id,
        rootItemId,
        rootOwnerId
      });
      for (const n of src.nodes) this.workflows.upsertNode({ ...n, workflowId: copy.id });
      for (const l of src.links) this.workflows.createLink(copy.id, l);
      return this.get(copy.id);
    });
  }

  /** Puts a workflow back to a saved version: { record, nodes: [{screenId,x,y,collapsed,locked}], links }. Atomic. */
  restore(id, snap) {
    const w = this.#require(id);
    if (!snap || !Array.isArray(snap.nodes) || !Array.isArray(snap.links)) throw new ValidationError('restore needs a saved version: { record, nodes, links }');
    const rec = normalizeWorkflow({ ...(snap.record || {}) }, { partial: true });
    if (rec.key && rec.key !== w.key && this.workflows.keyExists(rec.key, w.projectId)) throw new ConflictError(`workflow key "${rec.key}" exists`);
    return this.transaction(() => {
      this.workflows.update(w.id, rec);
      this.workflows.clearContent(w.id);
      const placed = new Set();
      for (const n of snap.nodes || []) if (this.screens.get(n.screenId)) {
        this.workflows.upsertNode({ workflowId: w.id, screenId: n.screenId, x: n.x, y: n.y, collapsed: n.collapsed, locked: !!n.locked });
        placed.add(n.screenId);
      }
      for (const l of snap.links || []) {
        if (!placed.has(l.fromScreenId) || !placed.has(l.toScreenId)) continue;
        this.workflows.createLink(w.id, { ...l, fromNodeId: l.fromNodeId != null && this.nodes.get(l.fromNodeId) ? l.fromNodeId : null });
      }
      return this.get(w.id);
    });
  }

  /** Adds a screen to the workflow canvas (or moves/collapses/locks it). */
  placeScreen(id, { screenId, x = 0, y = 0, collapsed = false, locked = false }) {
    const w = this.#require(id);
    if (!this.screens.get(Number(screenId))) throw new NotFoundError('screen', screenId);
    return this.workflows.upsertNode({ workflowId: w.id, screenId: Number(screenId), x, y, collapsed, locked: !!locked });
  }

  removeScreen(id, screenId) { const w = this.#require(id); this.workflows.removeNode(w.id, Number(screenId)); return { deleted: true }; }

  addLink(id, input) {
    const w = this.#require(id);
    const data = normalizeLink(input);
    const nodes = new Set(this.workflows.nodes(w.id).map(n => n.screenId));
    for (const sid of [data.fromScreenId, data.toScreenId]) {
      if (!this.screens.get(sid)) throw new NotFoundError('screen', sid);
      if (!nodes.has(sid)) this.workflows.upsertNode({ workflowId: w.id, screenId: sid, x: 0, y: 0, collapsed: false });
    }
    if (data.fromNodeId != null) {
      const el = this.nodes.get(data.fromNodeId);
      if (!el || el.ownerType !== 'screen' || el.ownerId !== data.fromScreenId) throw new ValidationError('fromNodeId must belong to the source screen');
    }
    return this.workflows.createLink(w.id, data);
  }

  updateLink(linkId, patch) {
    const l = this.workflows.link(Number(linkId));
    if (!l) throw new NotFoundError('link', linkId);
    return this.workflows.updateLink(l.id, normalizeLink({ ...patch }, { partial: true }));
  }

  /** Outgoing links of the given screens across all workflows, de-duplicated. */
  linksFromScreens(screenIds) {
    const seen = new Set(), out = [];
    for (const l of this.workflows.linksForScreens(screenIds)) {
      const k = `${l.fromScreenId}|${l.toScreenId}|${l.fromNodeId}|${l.name}`;
      if (!seen.has(k)) { seen.add(k); out.push(l); }
    }
    return out;
  }

  removeLink(linkId) {
    if (!this.workflows.deleteLink(Number(linkId))) throw new NotFoundError('link', linkId);
    return { deleted: true, id: Number(linkId) };
  }
}
