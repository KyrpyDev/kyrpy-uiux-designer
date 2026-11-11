/** Trash: archive, restore and purge of deleted items (`TrashService`). */
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { uniqueKey } from '../domain/naming.js';
import { fallbackOwnerId } from './default-owner.js';
import { noteSkipped, parentsFirst, ForbiddenError } from './service-shared.js';

/**
 * Trash Management Service (`path`, `icon`, `button`, `element`, `screen`, `workflow`).
 * - All deleted items are archived here first with a complete JSON snapshot.
 * - Items can be restored (preserving original IDs and links when free) or permanently purged.
 * - Only `admin` or `superadmin` can purge `public` or built-in items; public-library (public user) items: superadmin only.
 */
export class TrashService {
  constructor({ trash, services, workflows, designs, nodes, animations, menus, auth, transaction }) {
    Object.assign(this, { trash, services, workflows, designs, nodes, animations, menus, auth, transaction });
  }

  /** Every user has a trash of their own: with an actor, only the items that actor deleted are visible or actionable. */
  list(filter = {}, { actor = null } = {}) {
    return this.trash.list(actor ? { ...filter, deletedBy: actor.id } : filter);
  }

  count(filter = {}, { actor = null } = {}) {
    return this.trash.count(actor ? { ...filter, deletedBy: actor.id } : filter);
  }

  get(id, actor = null) {
    const item = this.trash.get(Number(id));
    if (!item || (actor && Number(item.deletedBy) !== Number(actor.id))) throw new NotFoundError('trash_item', id);   // another user's trash item does not exist for you
    return item;
  }

  restore(trashId, { actor = null } = {}) {
    const item = this.get(trashId, actor);
    const snap = item.snapshot || {};
    const skipped = [];
    return this.transaction(() => {
      if (item.itemType === 'workflow') {
        const wfRepo = this.workflows.workflows;
        const rec = snap.record || {
          key: item.itemKey,
          name: item.itemName || item.itemKey,
          description: '',
          projectId: item.projectId ?? 1,
          visibility: item.visibility || 'public',
          creatorId: item.creatorId ?? fallbackOwnerId(this),
          rootOwnerId: item.rootOwnerId ?? fallbackOwnerId(this)
        };
        const freeId = item.originalId && !wfRepo.get(item.originalId);
        const key = wfRepo.keyExists(rec.key, rec.projectId)
          ? uniqueKey(rec.key, k => wfRepo.keyExists(k, rec.projectId))
          : rec.key;
        const created = wfRepo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
        wfRepo.restoreUid(created.id, snap.uid);
        for (const n of snap.nodes || []) {
          try {
            wfRepo.placeScreen({
              workflowId: created.id,
              screenId: n.screenId,
              x: n.x ?? 0,
              y: n.y ?? 0,
              zoom: n.zoom ?? 1,
              collapsed: Boolean(n.collapsed)
            });
          } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
        }
        for (const l of snap.links || []) {
          try {
            wfRepo.addLink({
              workflowId: created.id,
              fromScreenId: l.fromScreenId,
              toScreenId: l.toScreenId,
              triggerNodeId: l.triggerNodeId ?? null,
              triggerLabel: l.triggerLabel ?? '',
              kind: l.kind ?? 'navigate',
              color: l.color ?? '#2e9bff',
              waypoints: l.waypoints ?? []
            });
          } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
        }
        this.trash.delete(item.id);
        return { restored: true, itemType: 'workflow', item: this.workflows.get(created.id), ...(skipped.length ? { partial: true, skipped } : {}) };
      }

      const svc = this.services[item.itemType];
      const repo = this.designs[item.itemType];
      if (!svc || !repo) throw new ValidationError(`Unsupported trash item type "${item.itemType}"`);
      const rec = snap.record || {
        key: item.itemKey,
        name: item.itemName || item.itemKey,
        label: item.label || item.itemName || item.itemKey,
        category: item.category || 'general',
        projectId: item.projectId ?? 1,
        visibility: item.visibility || 'public',
        builtin: Boolean(item.builtin),
        creatorId: item.creatorId ?? fallbackOwnerId(this),
        rootOwnerId: item.rootOwnerId ?? fallbackOwnerId(this)
      };
      const freeId = item.originalId && !repo.get(item.originalId);
      const key = repo.keyExists(rec.key, rec.projectId)
        ? uniqueKey(rec.key, k => repo.keyExists(k, rec.projectId))
        : rec.key;
      const created = repo.create({ ...rec, key }, freeId ? { id: item.originalId } : {});
      repo.restoreUid(created.id, snap.uid);
      const nodesWithAnims = (snap.nodes || []).map(n => ({
        ...n,
        animations: (snap.animations || []).filter(a => a.nodeId === n.id)
      }));
      if (nodesWithAnims.length) {
        this.nodes.replaceAll(item.itemType, created.id, nodesWithAnims, { restoreIds: Boolean(freeId) });
      }
      if (item.itemType === 'button' && this.menus && Array.isArray(snap.menuItems)) {
        const idMap = new Map();
        const sorted = parentsFirst(snap.menuItems);
        for (const mi of sorted) {
          try {
            const parentId = mi.parentId == null ? null : (idMap.get(mi.parentId) ?? null);
            const made = this.menus.create(created.id, { ...mi, parentId });
            idMap.set(mi.id, made.id);
          } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
        }
      }
      if (freeId) {
        for (const rn of snap.referringNodes || []) {
          try {
            if (!this.nodes.get(rn.id)) {
              this.nodes.create(rn.ownerType, rn.ownerId, rn, { id: rn.id });
            }
          } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
        }
        if (item.itemType === 'screen' && this.workflows?.workflows) {
          const wfRepo = this.workflows.workflows;
          for (const wn of snap.workflowNodes || []) {
            try {
              wfRepo.placeScreen({
                workflowId: wn.workflowId,
                screenId: created.id,
                x: wn.x ?? 0,
                y: wn.y ?? 0,
                zoom: wn.zoom ?? 1,
                collapsed: Boolean(wn.collapsed)
              });
            } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
          }
          for (const wl of snap.workflowLinks || []) {
            try {
              wfRepo.addLink({
                workflowId: wl.workflowId,
                fromScreenId: wl.fromScreenId,
                toScreenId: wl.toScreenId,
                triggerNodeId: wl.triggerNodeId ?? null,
                triggerLabel: wl.triggerLabel ?? '',
                kind: wl.kind ?? 'navigate',
                color: wl.color ?? '#2e9bff',
                waypoints: wl.waypoints ?? []
              });
            } catch (e) { skipped.push(noteSkipped('trash restore', e)); }
          }
        }
      }
      this.trash.delete(item.id);
      // `skipped`: parts of the snapshot (menu items, instances elsewhere, workflow placements) that could not be put back
      return { restored: true, itemType: item.itemType, item: svc.get(created.id), ...(skipped.length ? { partial: true, skipped } : {}) };
    });
  }

  /** True for items owned by the immutable `public` user (the public library): only the superadmin curates those. */
  #inPublicLibrary(item) {
    const pub = this.auth?.publicUserId?.() ?? null;
    return pub != null && item.visibility === 'public' && Number(item.creatorId) === Number(pub);
  }

  purge(trashId, { actor = null } = {}) {
    const item = this.get(trashId, actor);
    const isPublic = item.visibility === 'public' || Boolean(item.builtin);
    if (actor && ((isPublic && !this.auth.isAdmin(actor)) || (this.#inPublicLibrary(item) && !this.auth.isSuperadmin(actor)))) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items (public-library items: superadmin only)');
    }
    this.trash.delete(item.id);
    return { purged: true, id: item.id, itemType: item.itemType, originalId: item.originalId };
  }

  empty({ projectId = null, itemType = '', actor = null } = {}) {
    const items = this.trash.list({ projectId, itemType, deletedBy: actor ? actor.id : null });
    const hasPublic = items.some(it => it.visibility === 'public' || Boolean(it.builtin));
    if (actor && ((hasPublic && !this.auth.isAdmin(actor)) || (items.some(it => this.#inPublicLibrary(it)) && !this.auth.isSuperadmin(actor)))) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items (public-library items: superadmin only)');
    }
    return this.transaction(() => {
      const ids = [];
      for (const it of items) {
        this.trash.delete(it.id);
        ids.push(it.id);
      }
      return { purgedCount: ids.length, ids };
    });
  }
}
