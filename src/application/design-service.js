import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../domain/errors.js';
import { normalizeDesign, normalizeNode, canContain, TYPES } from '../domain/entities.js';
import { uniqueKey, slugify } from '../domain/naming.js';
import { validateAnimation } from '../domain/animation.js';
import { stripOwnership } from '../domain/system-users.js';
import { assertItemAccess } from './access-policy.js';
import { fallbackOwnerId } from './default-owner.js';
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
    // each of these is several writes (rows, touch, trash row, change request): all or nothing (nesting-safe)
    for (const name of ['remove', 'replaceNodes', 'addNode', 'updateNode', 'removeNode']) {
      const fn = this[name].bind(this);
      this[name] = (...args) => this.transaction(() => fn(...args));
    }
  }

  /** `names`: a Map shared by one list call, so each user is read once instead of twice per row. */
  #enrichUsernames(d, names = null) {
    if (!d) return d;
    const nameOf = id => {
      if (!this.users) return null;
      if (!names) return this.users.get(id)?.username;
      if (!names.has(id)) names.set(id, this.users.get(id)?.username ?? null);
      return names.get(id);
    };
    return {
      ...d,
      creatorUsername: nameOf(d.creatorId || fallbackOwnerId(this)) || 'superadmin',
      rootOwnerUsername: nameOf(d.rootOwnerId || d.creatorId || fallbackOwnerId(this)) || 'superadmin'
    };
  }

  list(query = {}) {
    const names = new Map();
    const usage = this.ownerType !== 'screen' ? this.designs.usageCounts() : null;   // one grouped query, not one per row
    return this.designs.list(query).map(d => this.#enrichUsernames({
      ...d,
      ...(usage ? { usage: usage.get(d.id) || 0 } : {})
    }, names));
  }

  /** Every design of this type with its nodes (one query per table): the designer UI renders thumbnails from this. */
  listFull(query = {}) {
    const rows = this.designs.list(query);
    // a filtered list reads the nodes of its own rows only; the whole type is read when most of it is wanted
    const narrow = rows.length <= 2000 && rows.length * 2 < this.designs.count();
    const group = (list, key) => { const m = new Map(); for (const x of list) { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); } return m; };
    const byOwner = group(narrow ? this.nodes.listByOwners(this.ownerType, rows.map(r => r.id)) : this.nodes.listAllByType(this.ownerType), 'ownerId');
    const items = this.ownerType === 'button' && this.menus ? group(this.menus.listAll(), 'buttonId') : null;
    const names = new Map();
    return rows.map(d => this.#enrichUsernames({
      ...d,
      nodes: byOwner.get(d.id) || [],
      ...(items ? { menuItems: items.get(d.id) || [] } : {})
    }, names));
  }

  categories() { return this.designs.categories(); }

  #require(idOrKey) {
    const d = typeof idOrKey === 'number' || /^\d+$/.test(String(idOrKey)) ? this.designs.get(Number(idOrKey)) : this.designs.getByKey(String(idOrKey));
    if (!d) throw new NotFoundError(this.ownerType, idOrKey);
    return d;
  }

  /** Throws ForbiddenError unless `actor` may edit / read the design (no actor = internal caller). */
  assertCanEdit(d, actor) { assertItemAccess(d, actor, this.collaboration?.projects, 'edit', this.ownerType); return d; }
  assertCanRead(d, actor) { assertItemAccess(d, actor, this.collaboration?.projects, 'read', this.ownerType); return d; }
  /** The design a route addresses, after the edit check (used by nested routes: menus, animations). */
  requireEditable(idOrKey, actor) { return this.assertCanEdit(this.#require(idOrKey), actor); }

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
    const creator = this.users ? this.users.get(item.creatorId || fallbackOwnerId(this)) : { id: 1, username: 'superadmin' };
    const rootOwner = this.users ? this.users.get(item.rootOwnerId || fallbackOwnerId(this)) : { id: 1, username: 'superadmin' };
    const clones = this.designs.clonesOf(item.id);   // one indexed-size query instead of loading the whole table
    const chain = [];
    const seen = new Set();
    let cur = item;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const u = this.users ? this.users.get(cur.creatorId || fallbackOwnerId(this)) : null;
      chain.push({
        id: cur.id,
        key: cur.key,
        name: cur.name,
        creatorId: cur.creatorId || fallbackOwnerId(this),
        creatorUsername: u?.username || 'superadmin',
        clonedFromId: cur.clonedFromId || null,
        rootItemId: cur.rootItemId || cur.id,
        rootOwnerId: cur.rootOwnerId || fallbackOwnerId(this)
      });
      cur = cur.clonedFromId ? this.designs.get(cur.clonedFromId) : null;
    }
    return {
      item: { id: item.id, key: item.key, name: item.name, visibility: item.visibility, projectId: item.projectId },
      itemName: item.name,
      itemKey: item.key,
      visibility: item.visibility,
      projectId: item.projectId,
      creator: creator ? { id: creator.id, username: creator.username, displayName: creator.displayName } : { id: 1, username: 'superadmin' },
      rootOwner: rootOwner ? { id: rootOwner.id, username: rootOwner.username, displayName: rootOwner.displayName } : { id: 1, username: 'superadmin' },
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

  #isSuperadminId(actorId, actor = null) {
    const u = actor?.role ? actor : (actorId != null && this.users ? this.users.get(Number(actorId)) : null);
    if (!u) return false;
    return this.collaboration?.auth ? this.collaboration.auth.isSuperadmin(u) : u.role === 'superadmin';
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

  /** New public items of the default project created by the superadmin belong to the `public` library user. */
  #publicOwnership(data, actorId, actor) {
    const pub = this.#publicUserId();
    if (pub == null || data.visibility !== 'public' || Number(data.projectId ?? 1) !== 1 || !this.#isSuperadminId(actorId, actor)) return null;
    return Number(pub);
  }

  #maybeRecordCollabChange(beforeDoc, afterDoc, { actorId = null, action = 'update', summary = '', forceRecord = false } = {}) {
    if (!this.collaboration || !beforeDoc || !afterDoc) return null;
    let ownerId = beforeDoc.creatorId || beforeDoc.rootOwnerId || fallbackOwnerId(this);
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
      authorId: actorId ?? fallbackOwnerId(this),
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
    const creatorId = actorId ?? actor?.id ?? input.creatorId ?? fallbackOwnerId(this);
    const data = normalizeDesign(this.ownerType, { ...input, creatorId, rootOwnerId: input.rootOwnerId ?? creatorId });
    const pubOwner = this.#publicOwnership(data, actorId ?? actor?.id ?? null, actor);
    if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    // keys are unique per project (src/mcp: per-project keys)
    if (input.key && this.designs.keyExists(data.key, data.projectId)) throw new ConflictError(`${this.ownerType} key "${data.key}" already exists in this project`);
    if (!input.key) data.key = uniqueKey(data.name, k => this.designs.keyExists(k, data.projectId));
    if (input.builtin && (!actor || ['admin', 'superadmin'].includes(actor.role))) data.builtin = true;   // not for ordinary users
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
    const d = this.assertCanEdit(this.#require(id), actor);
    const beforeDoc = (effActorId || recordChange) ? this.get(d.id) : null;
    const { scaleContent, ...rest } = stripOwnership(patch);   // ownership and lineage are never changed by an edit
    this.#assertStaysPublic(d, rest.visibility, rest.projectId);
    const data = normalizeDesign(this.ownerType, { ...rest }, { partial: true });
    // an admin publishing an existing default-project item hands it to the `public` library user (as on create)
    // (also when a public item of another project is brought into the default project)
    const becomesLibrary = (data.visibility === 'public' && (d.visibility || 'public') !== 'public')
      || (data.projectId !== undefined && Number(data.projectId) === 1 && Number(d.projectId ?? 1) !== 1);
    if (becomesLibrary) {
      const pubOwner = this.#publicOwnership({ visibility: data.visibility ?? d.visibility ?? 'public', projectId: data.projectId ?? d.projectId ?? 1 }, effActorId, actor);
      if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    }
    if (data.key && data.key !== d.key && this.designs.keyExists(data.key, data.projectId ?? d.projectId)) throw new ConflictError(`key "${data.key}" already exists`);
    const resized = (data.width !== undefined && data.width !== d.width) || (data.height !== undefined && data.height !== d.height);
    const updated = this.transaction(() => {
      if (resized && (scaleContent ?? ['button', 'element'].includes(this.ownerType))) {
        const sx = d.width > 0 ? (data.width ?? d.width) / d.width : 1, sy = d.height > 0 ? (data.height ?? d.height) / d.height : 1;   // a zero-size design has nothing to scale
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
  restore(id, snap, { actor = null } = {}) {
    const d = this.assertCanEdit(this.#require(id), actor);
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

  /**
   * Display order of the library: move an item to the front / back, or one step forward / backward.
   * Items are ordered by (position, name); positions are renumbered densely 1..n, only changed rows are written.
   * Allowed for the item's creator and the superadmin (public-library items: superadmin only).
   * @returns {{id:number, mode:string, position:number, moved:boolean}}
   */
  reorder(id, mode, { actor = null } = {}) {
    if (!['front', 'back', 'forward', 'backward'].includes(mode)) throw new ValidationError('mode must be one of front, back, forward, backward');
    const d = this.#require(id);
    if (actor && actor.role !== 'superadmin' && Number(d.creatorId) !== Number(actor.id)) throw new ForbiddenError('Only the owner (or the superadmin for public-library items) can change the display order');
    return this.transaction(() => {
      // one or two rows are written, not the whole table: `front` / `back` take a position outside the current
      // range, a single step swaps positions with the neighbour of the same project
      const all = this.designs.positions();
      let touched = 0;
      const set = (row, position) => { if (row.position !== position) { this.designs.setPosition(row.id, position); row.position = position; touched++; } };
      if (new Set(all.map(r => r.position)).size !== all.length) all.forEach((r, i) => set(r, i + 1));   // old data with equal positions: number once
      const scope = all.filter(r => Number(r.projectId ?? 1) === Number(d.projectId ?? 1));
      const from = scope.findIndex(r => r.id === d.id);
      const to = mode === 'front' ? 0 : mode === 'back' ? scope.length - 1 : Math.min(scope.length - 1, Math.max(0, from + (mode === 'forward' ? -1 : 1)));
      if (to !== from) {
        const mine = scope[from];
        if (mode === 'front') set(mine, all[0].position - 1);
        else if (mode === 'back') set(mine, all[all.length - 1].position + 1);
        else { const other = scope[to], p = mine.position; set(mine, other.position); set(other, p); }
      }
      return { id: d.id, mode, position: to + 1, moved: to !== from, touched };
    });
  }

  /**
   * Deletes an item (to the trash unless `permanent`). Instances of it inside other designs are removed with it:
   * with `confirmUsage` (the HTTP route) that needs `force`, otherwise the call answers 409 `IN_USE` with the count.
   */
  remove(id, { actor = null, permanent = false, confirmUsage = false, force = false } = {}) {
    const d = this.assertCanEdit(this.#require(id), actor);
    if (d.locked) throw new ConflictError(`${this.ownerType} "${d.name || d.key}" is locked; unlock it before deleting`);
    if (confirmUsage && !force) {
      const usage = this.designs.usageCount(d.id);
      if (usage > 0) {
        const e = new ConflictError(`${this.ownerType} "${d.name || d.key}" is used ${usage} time(s) in other designs; deleting it removes those instances`);
        e.code = 'IN_USE';
        e.details = { usage };
        throw e;
      }
    }
    const isPublic = (d.visibility || 'public') === 'public' || Boolean(d.builtin);
    const pub = this.#publicUserId();
    const inLibrary = pub != null && Number(d.creatorId) === Number(pub) && (d.visibility || 'public') === 'public';
    if (actor && ((isPublic && !['admin', 'superadmin'].includes(actor.role)) || (inLibrary && actor.role !== 'superadmin'))) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items (public-library items: superadmin only)');
    }
    let trashRec = null;
    if (!permanent && this.trash) {
      const snapshot = {
        uid: this.designs.uidOf?.(d.id) ?? null,   // keeps the MCP identity on restore
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
        creatorId: d.creatorId ?? fallbackOwnerId(this),
        rootOwnerId: d.rootOwnerId ?? fallbackOwnerId(this),
        deletedBy: actor?.id ?? fallbackOwnerId(this),
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
    const rootOwnerId = src.rootOwnerId || src.creatorId || fallbackOwnerId(this);
    let effCreatorId = creatorId ?? actorId ?? actor?.id ?? src.creatorId ?? fallbackOwnerId(this);
    let effRootOwnerId = rootOwnerId;
    const pubOwner = creatorId == null
      ? this.#publicOwnership({ visibility: visibility ?? src.visibility ?? 'public', projectId: projectId ?? src.projectId ?? 1 }, actorId ?? actor?.id ?? null, actor)
      : null;
    if (pubOwner != null) { effCreatorId = pubOwner; effRootOwnerId = pubOwner; }
    return this.transaction(() => {
      const copy = this.designs.create({
        ...src,
        name: newName,
        label: name || (src.label ? `${src.label} copy` : ''),
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
      const srcById = new Map(src.nodes.map(n => [n.id, n]));
      const depthOf = n => { let d = 0; for (let p = srcById.get(n.parentId); p && d < 64; p = srcById.get(p.parentId)) d++; return d; };
      const byDepth = [...src.nodes].sort((a, b) => depthOf(a) - depthOf(b));   // parents before children at every level
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
    const d = this.assertCanEdit(this.#require(id), actor);
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
    const d = this.assertCanEdit(this.#require(id), actor);
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

  #node(nodeId, actor = null) {
    const e = this.nodes.get(Number(nodeId));
    if (!e || e.ownerType !== this.ownerType) throw new NotFoundError('node', nodeId);
    if (actor) { const d = this.designs.get(e.ownerId); if (d) this.assertCanEdit(d, actor); }
    return e;
  }

  updateNode(nodeId, patch, { actor = null, actorId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const e = this.#node(nodeId, actor);
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
    const e = this.#node(nodeId, actor);
    const beforeDoc = (effActorId || recordChange) ? this.get(e.ownerId) : null;
    this.nodes.delete(e.id);
    this.designs.touch(e.ownerId);
    if (beforeDoc) this.#maybeRecordCollabChange(beforeDoc, this.get(e.ownerId), { actorId: effActorId, action: 'node_delete', summary: `Removed ${e.tag} "${e.name || e.tag}"`, forceRecord: recordChange });
    return { deleted: true, id: e.id };
  }

  duplicateNode(nodeId, { dx = 12, dy = 12 } = {}, { actor = null } = {}) {
    const e = this.#node(nodeId, actor);
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

  addAnimation(nodeId, input, { actor = null } = {}) {
    const e = this.#node(nodeId, actor);
    const errors = validateAnimation(input);
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    const a = this.animations.create(e.id, input);
    this.designs.touch(e.ownerId);
    return a;
  }

  updateAnimation(animationId, patch, { actor = null, ownerId = null } = {}) {
    const a = this.animations.get(Number(animationId));
    if (!a) throw new NotFoundError('animation', animationId);
    const e = this.#node(a.nodeId, actor);
    if (ownerId != null && Number(e.ownerId) !== Number(ownerId)) throw new NotFoundError('animation', animationId);
    const errors = validateAnimation({ type: a.type, ...patch });
    if (errors.length) throw new ValidationError(errors.join('; '), errors);
    return this.animations.update(a.id, patch);
  }

  removeAnimation(animationId, { actor = null, ownerId = null } = {}) {
    const a = this.animations.get(Number(animationId));
    if (!a) throw new NotFoundError('animation', animationId);
    const e = this.#node(a.nodeId, actor);
    if (ownerId != null && Number(e.ownerId) !== Number(ownerId)) throw new NotFoundError('animation', animationId);
    this.animations.delete(a.id);
    return { deleted: true, id: a.id };
  }
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const TRANSLATE = new RegExp(`translate\\(\\s*(${NUM})(?:[\\s,]+(${NUM}))?\\s*\\)`);

/** Moves a copied node by (dx, dy). `translate(5)`, `translate(1e2, 3)` and `translate(5 6)` are all read (ty defaults to 0). */
export function shiftAttrs(el, attrs, dx, dy) {
  for (const [kx, ky] of [['x', 'y'], ['cx', 'cy'], ['x1', 'y1'], ['x2', 'y2']]) {
    if (attrs[kx] !== undefined) attrs[kx] = Number(attrs[kx]) + dx;
    if (attrs[ky] !== undefined) attrs[ky] = Number(attrs[ky]) + dy;
  }
  if (el.tag === 'path' || el.tag === 'g') {
    const cur = String(attrs.transform || '');
    const m = TRANSLATE.exec(cur);
    if (m) {
      // the first translate is replaced in place, so the order of the other transforms is kept
      attrs.transform = cur.replace(TRANSLATE, `translate(${Number(m[1]) + dx} ${Number(m[2] ?? 0) + dy})`);
    } else {
      attrs.transform = `translate(${dx} ${dy}) ${cur}`.trim();
    }
  }
}

export { TYPES };
