import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../domain/errors.js';
import { normalizeDesign, normalizeNode, canContain, TYPES } from '../domain/entities.js';
import { uniqueKey, slugify } from '../domain/naming.js';
import { validateAnimation } from '../domain/animation.js';
import { stripOwnership } from '../domain/system-users.js';
import { scaleNodeSet, isContainerNode, clampNodeToContainer, fitContainerToScreenBox, resizeAttrs, nodeBBox } from '../domain/geometry.js';

/**
 * CRUD use cases for paths, icons, buttons, elements and screens. They share one shape: a design record + its nodes +
 * animations. Constructed once per owner type; depends only on repository ports.
 * Supports project-based scoping, public/project visibility, creator & root-owner lineage tracking on clones,
 * position locking, and collaborative change list recording for owner approval/rejection.
 */
export class DesignService {
  /** @param {{ownerType:'path'|'icon'|'button'|'element'|'screen', designs, nodes, animations, menus?, users?, collaboration?, trash?, workflows?, transaction:(fn:Function)=>any}} deps */
  constructor({ ownerType, designs, nodes, animations, menus = null, users = null, collaboration = null, trash = null, workflows = null, transaction }) {
    Object.assign(this, { ownerType, designs, nodes, animations, menus, users, collaboration, trash, workflows, transaction });
  }

  #enrichUsernames(d) {
    if (!d) return d;
    const creator = this.users ? this.users.get(d.creatorId || 1) : null;
    const rootOwner = this.users ? this.users.get(d.rootOwnerId || d.creatorId || 1) : null;
    return {
      ...d,
      creatorUsername: creator?.username || 'kyrpy',
      rootOwnerUsername: rootOwner?.username || 'kyrpy'
    };
  }

  list(query = {}) {
    return this.designs.list(query).map(d => this.#enrichUsernames({
      ...d,
      ...(this.ownerType !== 'screen' ? { usage: this.designs.usageCount(d.id) } : {})
    }));
  }

  /** Every design of this type with its nodes (one query per table): the designer UI renders thumbnails from this. */
  listFull(query = {}) {
    const byOwner = new Map();
    for (const e of this.nodes.listAllByType(this.ownerType)) { if (!byOwner.has(e.ownerId)) byOwner.set(e.ownerId, []); byOwner.get(e.ownerId).push(e); }
    const items = this.ownerType === 'button' && this.menus ? this.menus.listAll() : null;
    return this.designs.list(query).map(d => this.#enrichUsernames({
      ...d,
      nodes: byOwner.get(d.id) || [],
      ...(items ? { menuItems: items.filter(m => m.buttonId === d.id) } : {})
    }));
  }

  categories() { return this.designs.categories(); }

  #require(idOrKey) {
    const d = typeof idOrKey === 'number' || /^\d+$/.test(String(idOrKey)) ? this.designs.get(Number(idOrKey)) : this.designs.getByKey(String(idOrKey));
    if (!d) throw new NotFoundError(this.ownerType, idOrKey);
    return d;
  }

  /** Full record: design + nodes + animations (+ menu items of a button). */
  get(idOrKey) {
    const d = this.#require(idOrKey);
    return this.#enrichUsernames({
      ...d,
      nodes: this.nodes.listByOwner(this.ownerType, d.id),
      animations: this.animations.listByOwner(this.ownerType, d.id),
      usage: this.ownerType === 'screen' ? 0 : this.designs.usageCount(d.id),
      ...(this.ownerType === 'button' && this.menus ? { menuItems: this.menus.list(d.id) } : {})
    });
  }

  /** Full lineage chain back to the root owner and root public item. */
  lineage(idOrKey) {
    const item = this.get(idOrKey);
    const rootItem = item.rootItemId && item.rootItemId !== item.id ? this.designs.get(item.rootItemId) : item;
    const clonedFrom = item.clonedFromId ? this.designs.get(item.clonedFromId) : null;
    const creator = this.users ? this.users.get(item.creatorId || 1) : { id: 1, username: 'kyrpy' };
    const rootOwner = this.users ? this.users.get(item.rootOwnerId || 1) : { id: 1, username: 'kyrpy' };
    const clones = this.designs.list().filter(x => x.id !== item.id && (x.clonedFromId === item.id || x.rootItemId === item.id));
    const chain = [];
    const seen = new Set();
    let cur = item;
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
      cur = cur.clonedFromId ? this.designs.get(cur.clonedFromId) : null;
    }
    return {
      item: { id: item.id, key: item.key, name: item.name, visibility: item.visibility, projectId: item.projectId },
      itemName: item.name,
      itemKey: item.key,
      visibility: item.visibility,
      projectId: item.projectId,
      creator: creator ? { id: creator.id, username: creator.username, displayName: creator.displayName } : { id: 1, username: 'kyrpy' },
      rootOwner: rootOwner ? { id: rootOwner.id, username: rootOwner.username, displayName: rootOwner.displayName } : { id: 1, username: 'kyrpy' },
      rootItem: rootItem ? { id: rootItem.id, key: rootItem.key, name: rootItem.name } : { id: item.id, key: item.key, name: item.name },
      clonedFrom: clonedFrom ? { id: clonedFrom.id, key: clonedFrom.key, name: clonedFrom.name } : null,
      chain,
      clones: clones.map(c => ({ id: c.id, key: c.key, name: c.name, creatorId: c.creatorId, projectId: c.projectId }))
    };
  }

  getLineage(idOrKey) {
    return this.lineage(idOrKey);
  }

  /** Id of the immutable `public` library owner, or null when unknown (no users repository). */
  #publicUserId() { return this.users?.publicUserId?.() ?? null; }

  #isAdminId(actorId, actor = null) {
    const u = actor?.role ? actor : (actorId != null && this.users ? this.users.get(Number(actorId)) : null);
    if (!u) return false;
    return this.collaboration?.auth ? this.collaboration.auth.isAdmin(u) : ['admin', 'superadmin'].includes(u.role);
  }

  /**
   * Public-library items (owned by the `public` system user) stay public and stay in the default project (id 1);
   * users — admins included — clone them instead (moveToProjects / copyToProjects already copy, never re-home).
   */
  #assertStaysPublic(d, visibility, projectId) {
    const pub = this.#publicUserId();
    if (pub == null || Number(d.creatorId) !== Number(pub) || (d.visibility || 'public') !== 'public') return;
    if (visibility !== undefined && visibility !== 'public') {
      throw new ValidationError(`${this.ownerType} "${d.name || d.key}" belongs to the immutable public library and must stay public; clone it instead`);
    }
    const target = Number(projectId);   // same fallback as normalize* (posNum(projectId, 1))
    if (projectId !== undefined && (Number.isFinite(target) && target > 0 ? target : 1) !== Number(d.projectId ?? 1)) {
      throw new ConflictError(`${this.ownerType} "${d.name || d.key}" belongs to the public library of the default project and cannot be moved to another project; clone it instead`);
    }
  }

  /** New public items of the default project created by an admin belong to the `public` library user. */
  #publicOwnership(data, actorId, actor) {
    const pub = this.#publicUserId();
    if (pub == null || data.visibility !== 'public' || Number(data.projectId ?? 1) !== 1 || !this.#isAdminId(actorId, actor)) return null;
    return Number(pub);
  }

  #maybeRecordCollabChange(beforeDoc, afterDoc, { actorId = null, action = 'update', summary = '', forceRecord = false } = {}) {
    if (!this.collaboration || !beforeDoc || !afterDoc) return null;
    let ownerId = beforeDoc.creatorId || beforeDoc.rootOwnerId || 1;
    if (this.collaboration.changeReviewer) {
      const r = this.collaboration.changeReviewer(beforeDoc, actorId, { force: forceRecord });
      if (!r) return null;
      ownerId = r.ownerId;
    } else {
      const isCollaborator = actorId != null && Number(actorId) !== Number(ownerId);
      if (!forceRecord && !isCollaborator) return null;
    }
    return this.collaboration.recordEdit({
      projectId: afterDoc.projectId || beforeDoc.projectId || 1,
      targetType: this.ownerType,
      targetId: afterDoc.id,
      targetKey: afterDoc.key,
      targetName: afterDoc.name,
      authorId: actorId ?? 1,
      ownerId,
      action,
      summary,
      beforeDoc,
      afterDoc
    });
  }

  /** The hierarchy rule (path → icon → button → element → screen) and no element inside itself. */
  #assertInstances(list, selfId = null) {
    for (const n of list) {
      if (n.kind !== 'instance') continue;
      if (!canContain(this.ownerType, n.refType)) throw new ValidationError(`a ${this.ownerType} cannot contain a ${n.refType} (hierarchy: path → icon → button → element → screen)`);
      if (selfId != null && n.refType === this.ownerType && this.#reaches(n.refId, selfId)) throw new ValidationError(`a ${this.ownerType} cannot contain itself`);
    }
  }
  #reaches(fromId, targetId, seen = new Set()) {
    if (fromId === targetId) return true;
    if (seen.has(fromId)) return false;
    seen.add(fromId);
    return this.nodes.listByOwner(this.ownerType, fromId).some(n => n.kind === 'instance' && n.refType === this.ownerType && this.#reaches(n.refId, targetId, seen));
  }

  create(input, { nodes = [], actor = null, actorId = null } = {}) {
    const creatorId = actorId ?? actor?.id ?? input.creatorId ?? 1;
    const data = normalizeDesign(this.ownerType, { ...input, creatorId, rootOwnerId: input.rootOwnerId ?? creatorId });
    const pubOwner = this.#publicOwnership(data, actorId ?? actor?.id ?? null, actor);
    if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    // keys are unique per project (src/mcp: per-project keys)
    if (input.key && this.designs.keyExists(data.key, data.projectId)) throw new ConflictError(`${this.ownerType} key "${data.key}" already exists in this project`);
    if (!input.key) data.key = uniqueKey(data.name, k => this.designs.keyExists(k, data.projectId));
    if (input.builtin) data.builtin = true;
    const clean = nodes.map(e => ({ ...normalizeNode(e), id: e.id, animations: e.animations }));
    this.#assertInstances(clean);
    return this.transaction(() => {
      const d = this.designs.create(data);
      if (clean.length) this.nodes.replaceAll(this.ownerType, d.id, clean);
      return this.get(d.id);
    });
  }

  /**
   * Updates the record. When the bounding box (width/height) changes and `scaleContent` is on (default for buttons and
   * elements), every sub node is scaled with it so all sub items stay inside the box.
   */
  update(id, patch, { actor = null, actorId = null, recordChange = false, changeSummary = '' } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const d = this.#require(id);
    const beforeDoc = (effActorId || recordChange) ? this.get(d.id) : null;
    const { scaleContent, ...rest } = stripOwnership(patch);   // ownership and lineage are never changed by an edit
    this.#assertStaysPublic(d, rest.visibility, rest.projectId);
    const data = normalizeDesign(this.ownerType, { ...rest }, { partial: true });
    // an admin publishing an existing default-project item hands it to the `public` library user (as on create)
    if (data.visibility === 'public' && (d.visibility || 'public') !== 'public') {
      const pubOwner = this.#publicOwnership({ visibility: 'public', projectId: data.projectId ?? d.projectId ?? 1 }, effActorId, actor);
      if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    }
    if (data.key && data.key !== d.key && this.designs.keyExists(data.key, data.projectId ?? d.projectId)) throw new ConflictError(`key "${data.key}" already exists`);
    const resized = (data.width !== undefined && data.width !== d.width) || (data.height !== undefined && data.height !== d.height);
    const updated = this.transaction(() => {
      if (resized && (scaleContent ?? ['button', 'element'].includes(this.ownerType))) {
        const sx = (data.width ?? d.width) / d.width, sy = (data.height ?? d.height) / d.height;
        for (const p of scaleNodeSet(this.nodes.listByOwner(this.ownerType, d.id), sx, sy)) this.nodes.update(p.id, { attrs: p.attrs });
      } else if (resized && this.ownerType === 'screen') {
        const nw = data.width ?? d.width;
        const nh = data.height ?? d.height;
        const allNodes = this.nodes.listByOwner(this.ownerType, d.id);
        for (const n of allNodes) {
          if (n.parentId == null && isContainerNode(n) && (n.attrs?.['data-size-mode'] || 'responsive') === 'responsive') {
            const fitMode = n.attrs?.['data-fit-screen'] === 'full' ? 'full' : 'width';
            const fromBox = nodeBBox(n, allNodes);
            const toBox = fitContainerToScreenBox(n, nw, nh, { fitMode, allNodes });
            const nextAttrs = resizeAttrs(n, fromBox, toBox);
            const updatedContainer = this.nodes.update(n.id, { attrs: nextAttrs });
            for (const ch of allNodes.filter(c => c.parentId === n.id)) {
              const clampedAttrs = clampNodeToContainer(ch, updatedContainer, allNodes);
              this.nodes.update(ch.id, { attrs: clampedAttrs });
            }
          }
        }
      }
      this.designs.update(d.id, data);
      return this.get(d.id);
    });
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, updated, { actorId: effActorId, action: 'update', summary: changeSummary, forceRecord: recordChange });
    return updated;
  }

  /**
   * Puts a design back to a saved version: { record, nodes (each with its animations), menuItems }.
   * Used by Reset and by Save as (which leaves the original as it was last saved). Atomic.
   */
  restore(id, snap) {
    const d = this.#require(id);
    if (!snap || !Array.isArray(snap.nodes)) throw new ValidationError('restore needs a saved version: { record, nodes, menuItems }');
    const rec = normalizeDesign(this.ownerType, stripOwnership(snap.record || {}), { partial: true });
    this.#assertStaysPublic(d, rec.visibility, rec.projectId);
    if (rec.key && rec.key !== d.key && this.designs.keyExists(rec.key, d.projectId)) throw new ConflictError(`key "${rec.key}" already exists`);
    const nodes = (snap.nodes || []).map(e => ({ ...normalizeNode(e), id: e.id, animations: Array.isArray(e.animations) ? e.animations : [] }));
    this.#assertInstances(nodes, d.id);
    return this.transaction(() => {
      this.designs.update(d.id, rec);
      this.nodes.replaceAll(this.ownerType, d.id, nodes, { restoreIds: true });
      if (this.ownerType === 'button' && this.menus) this.menus.replaceAll(d.id, snap.menuItems || []);
      this.designs.touch(d.id);
      return this.get(d.id);
    });
  }

  remove(id, { actor = null, permanent = false } = {}) {
    const d = this.#require(id);
    if (d.locked) throw new ConflictError(`${this.ownerType} "${d.name || d.key}" is locked; unlock it before deleting`);
    const isPublic = (d.visibility || 'public') === 'public' || Boolean(d.builtin);
    if (isPublic && actor && !['admin', 'superadmin'].includes(actor.role)) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items');
    }
    let trashRec = null;
    if (!permanent && this.trash) {
      const snapshot = {
        uid: this.designs.db?.prepare(`SELECT uid FROM ${this.designs.table} WHERE id = ?`).get(d.id)?.uid ?? null,   // keeps the MCP identity on restore
        record: d,
        nodes: this.nodes.listByOwner(this.ownerType, d.id),
        animations: this.animations.listByOwner(this.ownerType, d.id),
        menuItems: this.ownerType === 'button' && this.menus ? this.menus.list(d.id) : [],
        referringNodes: this.ownerType !== 'screen' ? this.nodes.listByRef(this.ownerType, d.id) : [],
        workflowNodes: this.ownerType === 'screen' && this.workflows ? this.workflows.nodesForScreen(d.id) : [],
        workflowLinks: this.ownerType === 'screen' && this.workflows ? this.workflows.linksInvolvingScreen(d.id) : []
      };
      trashRec = this.trash.put({
        itemType: this.ownerType,
        originalId: d.id,
        itemKey: d.key,
        itemName: d.name,
        label: d.label || '',
        category: d.category || 'general',
        projectId: d.projectId ?? 1,
        visibility: d.visibility || 'public',
        builtin: Boolean(d.builtin),
        creatorId: d.creatorId ?? 1,
        rootOwnerId: d.rootOwnerId ?? 1,
        deletedBy: actor?.id ?? 1,
        snapshot
      });
    }
    this.designs.delete(d.id);
    return { deleted: true, trashed: !permanent && Boolean(trashRec), id: d.id, trashId: trashRec?.id ?? null };
  }

  /**
   * Deep copy (nodes, groups, animations, menu) under a new unique key.
   * Preserves root owner lineage (`clonedFromId`, `rootItemId`, `rootOwnerId`) when cloned from any public or project item.
   */
  clone(id, { name, projectId, visibility, creatorId } = {}, { actor = null, actorId = null } = {}) {
    const src = this.get(id);
    const newName = name || `${src.name} copy`;
    const rootItemId = src.rootItemId || src.id;
    const rootOwnerId = src.rootOwnerId || src.creatorId || 1;
    let effCreatorId = creatorId ?? actorId ?? actor?.id ?? src.creatorId ?? 1;
    let effRootOwnerId = rootOwnerId;
    const pubOwner = creatorId == null
      ? this.#publicOwnership({ visibility: visibility ?? src.visibility ?? 'public', projectId: projectId ?? src.projectId ?? 1 }, actorId ?? actor?.id ?? null, actor)
      : null;
    if (pubOwner != null) { effCreatorId = pubOwner; effRootOwnerId = pubOwner; }
    return this.transaction(() => {
      const copy = this.designs.create({
        ...src,
        name: newName,
        label: name || `${src.label} copy`,
        key: uniqueKey(slugify(name || ((projectId ?? src.projectId) !== src.projectId ? src.key : `${src.key}-copy`)), k => this.designs.keyExists(k, projectId ?? src.projectId ?? 1)),
        builtin: false,
        position: undefined,
        projectId: projectId ?? src.projectId ?? 1,
        visibility: visibility ?? src.visibility ?? 'public',
        creatorId: effCreatorId,
        clonedFromId: src.id,
        rootItemId,
        rootOwnerId: effRootOwnerId
      });
      const idMap = new Map();
      const byDepth = [...src.nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
      for (const e of byDepth) {
        const made = this.nodes.create(this.ownerType, copy.id, { ...e, parentId: e.parentId == null ? null : idMap.get(e.parentId) ?? null });
        idMap.set(e.id, made.id);
      }
      for (const a of src.animations) this.animations.create(idMap.get(a.nodeId), a);
      if (this.ownerType === 'button' && this.menus) this.menus.copyAll(src.id, copy.id);
      return this.get(copy.id);
    });
  }

  /* ---------- nodes ---------- */
  replaceNodes(id, list, { actor = null, actorId = null, recordChange = false, changeSummary = '' } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const d = this.#require(id);
    const beforeDoc = (effActorId || recordChange) ? this.get(d.id) : null;
    const clean = list.map(e => ({ ...normalizeNode(e), id: e.id, animations: e.animations }));
    this.#assertInstances(clean, d.id);
    this.nodes.replaceAll(this.ownerType, d.id, clean, { restoreIds: true });
    this.designs.touch(d.id);
    const afterDoc = this.get(d.id);
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, afterDoc, { actorId: effActorId, action: 'nodes_replace', summary: changeSummary, forceRecord: recordChange });
    return afterDoc;
  }

  addNode(id, input, { actor = null, actorId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const d = this.#require(id);
    const beforeDoc = (effActorId || recordChange) ? this.get(d.id) : null;
    const data = normalizeNode(input);
    if (input.ord === undefined) delete data.ord;
    this.#assertInstances([data], d.id);
    if (data.parentId != null) {
      const allNodes = this.nodes.listByOwner(this.ownerType, d.id);
      const parent = allNodes.find(n => n.id === Number(data.parentId));
      if (parent && isContainerNode(parent)) {
        data.attrs = clampNodeToContainer(data, parent, allNodes);
      }
    }
    const e = this.nodes.create(this.ownerType, d.id, data);
    this.designs.touch(d.id);
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, this.get(d.id), { actorId: effActorId, action: 'node_add', summary: `Added ${e.tag} "${e.tag}"`, forceRecord: recordChange });
    return e;
  }

  #node(nodeId) {
    const e = this.nodes.get(Number(nodeId));
    if (!e || e.ownerType !== this.ownerType) throw new NotFoundError('node', nodeId);
    return e;
  }

  updateNode(nodeId, patch, { actor = null, actorId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const e = this.#node(nodeId);
    const beforeDoc = (effActorId || recordChange) ? this.get(e.ownerId) : null;
    const data = normalizeNode({ ...patch }, { partial: true });
    const allNodes = this.nodes.listByOwner(this.ownerType, e.ownerId);
    const effParentId = data.parentId !== undefined ? data.parentId : e.parentId;
    if (effParentId != null) {
      const parent = allNodes.find(n => n.id === Number(effParentId));
      if (parent && isContainerNode(parent)) {
        const merged = { ...e, ...data, attrs: { ...(e.attrs || {}), ...(data.attrs || {}) } };
        data.attrs = clampNodeToContainer(merged, parent, allNodes);
      }
    }
    const saved = this.nodes.update(e.id, data);
    if (isContainerNode(saved)) {
      const freshNodes = this.nodes.listByOwner(this.ownerType, e.ownerId);
      for (const ch of freshNodes.filter(c => c.parentId === saved.id)) {
        const clampedAttrs = clampNodeToContainer(ch, saved, freshNodes);
        this.nodes.update(ch.id, { attrs: clampedAttrs });
      }
    }
    this.designs.touch(e.ownerId);
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, this.get(e.ownerId), { actorId: effActorId, action: 'node_patch', summary: `Edited ${saved.tag} "${saved.name || saved.tag}"`, forceRecord: recordChange });
    return saved;
  }

  removeNode(nodeId, { actor = null, actorId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const e = this.#node(nodeId);
    const beforeDoc = (effActorId || recordChange) ? this.get(e.ownerId) : null;
    this.nodes.delete(e.id);
    this.designs.touch(e.ownerId);
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, this.get(e.ownerId), { actorId: effActorId, action: 'node_delete', summary: `Removed ${e.tag} "${e.name || e.tag}"`, forceRecord: recordChange });
    return { deleted: true, id: e.id };
  }

  duplicateNode(nodeId, { dx = 12, dy = 12 } = {}) {
    const e = this.#node(nodeId);
    const all = this.nodes.listByOwner(this.ownerType, e.ownerId);
    const copyTree = (src, parentId) => {
      const attrs = { ...src.attrs };
      if (!src.parentId || src.id === e.id) shiftAttrs(src, attrs, dx, dy);
      const made = this.nodes.create(this.ownerType, e.ownerId, { ...src, parentId, ord: undefined, name: src.id === e.id && src.name ? `${src.name}-copy` : src.name, attrs });
      for (const a of this.animations.listByNode(src.id)) this.animations.create(made.id, a);
      for (const k of all.filter(c => c.parentId === src.id)) copyTree(k, made.id);
      return made;
    };
    return this.transaction(() => { const m = copyTree(e, e.parentId); this.designs.touch(e.ownerId); return m; });
  }

  /* ---------- animations ---------- */
  listAnimations(id) { const d = this.#require(id); return this.animations.listByOwner(this.ownerType, d.id); }

  addAnimation(nodeId, input) {
    const e = this.#node(nodeId);
    const errors = validateAnimation(input);
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    const a = this.animations.create(e.id, input);
    this.designs.touch(e.ownerId);
    return a;
  }

  updateAnimation(animationId, patch) {
    const a = this.animations.get(Number(animationId));
    if (!a) throw new NotFoundError('animation', animationId);
    this.#node(a.nodeId);
    const errors = validateAnimation({ type: a.type, ...patch });
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    return this.animations.update(a.id, patch);
  }

  removeAnimation(animationId) {
    const a = this.animations.get(Number(animationId));
    if (!a) throw new NotFoundError('animation', animationId);
    this.#node(a.nodeId);
    this.animations.delete(a.id);
    return { deleted: true, id: a.id };
  }
}

function shiftAttrs(el, attrs, dx, dy) {
  for (const [kx, ky] of [['x', 'y'], ['cx', 'cy'], ['x1', 'y1'], ['x2', 'y2']]) {
    if (attrs[kx] !== undefined) attrs[kx] = Number(attrs[kx]) + dx;
    if (attrs[ky] !== undefined) attrs[ky] = Number(attrs[ky]) + dy;
  }
  if (el.tag === 'path' || el.tag === 'g') {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(attrs.transform || '');
    const tx = (m ? +m[1] : 0) + dx, ty = (m ? +m[2] : 0) + dy;
    attrs.transform = `translate(${tx} ${ty}) ${(attrs.transform || '').replace(/translate\([^)]*\)\s*/, '')}`.trim();
  }
}

export { TYPES };
