/** Copy / move of library items between projects (`LibraryTransferService`). */
import { ConflictError, ValidationError } from '../domain/errors.js';
import { VISIBILITY_LEVELS } from '../domain/entities.js';
import { slugify, uniqueKey } from '../domain/naming.js';
import { fallbackOwnerId } from './default-owner.js';
import { noteSkipped, parentsFirst, ForbiddenError } from './service-shared.js';

/**
 * Library Transfer & Project Private Library Management Service:
 *  - `copyToProjects`: copies selected items (`path`, `icon`, `button`, `element`, `screen`, `workflow`)
 *    into one or multiple target projects as private (`visibility: 'project'`) items, recursively copying
 *    all referenced sub-items (`screen -> element -> button -> icon -> path`) into each target project's
 *    private sub-item libraries and rewiring `refId`s.
 *  - `moveToProjects`: copies items (and cascading sub-items) into target projects as private items, then
 *    removes the source item (enforcing admin guard on public items and immutability on built-in default items);
 *    a public-library source (owned by the `public` system user, admins only) is cloned and kept (`keptSourceIds`).
 *  - `emptyProjectLibrary`: moves a project's private (`visibility === 'project'`, non-builtin) library items
 *    to Trash while rejecting attempts to empty immutable default/public libraries.
 */
export class LibraryTransferService {
  constructor({ services, workflows, menus, projects, auth, transaction, render = null, parseSvg = null }) {
    Object.assign(this, { services, workflows, menus, projects, auth, transaction, render, parseSvg });
  }

  #normalizeTargetProjects(projectIds, { allowEmpty = false } = {}) {
    const raw = Array.isArray(projectIds)
      ? projectIds
      : String(projectIds || '').split(',').map(x => x.trim()).filter(Boolean);
    const ids = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))];
    if (!ids.length && !allowEmpty) throw new ValidationError('At least one target projectId is required');
    for (const pid of ids) this.projects.get(pid);
    return ids;
  }

  #normalizeItems(items) {
    if (!Array.isArray(items) || !items.length) {
      throw new ValidationError('At least one item ({ type, id }) is required');
    }
    return items.map(it => {
      const type = String(it.type || it.itemType || '').trim().replace(/s$/, '');
      const id = Number(it.id ?? it.itemId);
      if (!['path', 'icon', 'button', 'element', 'screen', 'workflow'].includes(type) || !id) {
        throw new ValidationError(`Invalid library item reference: ${JSON.stringify(it)}`);
      }
      return { type, id };
    });
  }

  #copySingleWithCascade(type, id, targetProjectId, memo, subItemsCreated, actor, { visibility = 'project', overrideName = null } = {}) {
    const effVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';
    const cacheKey = `${type}:${Number(id)}:${effVis}:${overrideName || ''}`;
    if (memo.has(cacheKey)) return memo.get(cacheKey);

    if (type === 'workflow') {
      const src = this.workflows.get(Number(id));
      const wfRepo = this.workflows.workflows;
      const screenMap = new Map();
      for (const n of src.nodes || []) {
        if (n.screenId) {
          const copiedScreen = this.#copySingleWithCascade('screen', n.screenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (copiedScreen?.id) {
            screenMap.set(Number(n.screenId), copiedScreen.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(n.screenId), id: copiedScreen.id, key: copiedScreen.key, projectId: targetProjectId, visibility: effVis });
          }
        }
      }
      for (const l of src.links || []) {
        if (l.fromScreenId && !screenMap.has(Number(l.fromScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.fromScreenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (cs?.id) {
            screenMap.set(Number(l.fromScreenId), cs.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(l.fromScreenId), id: cs.id, key: cs.key, projectId: targetProjectId, visibility: effVis });
          }
        }
        if (l.toScreenId && !screenMap.has(Number(l.toScreenId))) {
          const cs = this.#copySingleWithCascade('screen', l.toScreenId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (cs?.id) {
            screenMap.set(Number(l.toScreenId), cs.id);
            subItemsCreated.push({ type: 'screen', sourceId: Number(l.toScreenId), id: cs.id, key: cs.key, projectId: targetProjectId, visibility: effVis });
          }
        }
      }
      const wfName = overrideName || src.name;
      const wfKey = uniqueKey(slugify(overrideName || src.key), k => wfRepo.keyExists(k, targetProjectId));   // keys are per project
      const createdWf = wfRepo.create({
        key: wfKey,
        name: wfName,
        label: wfName,
        description: src.description || '',
        projectId: targetProjectId,
        visibility: effVis,
        creatorId: actor?.id ?? src.creatorId ?? fallbackOwnerId(this),
        rootOwnerId: src.rootOwnerId || src.creatorId || fallbackOwnerId(this),
        clonedFromId: src.id
      });
      for (const n of src.nodes || []) {
        const newSid = screenMap.get(Number(n.screenId)) || n.screenId;
        try {
          wfRepo.upsertNode({
            workflowId: createdWf.id,
            screenId: newSid,
            x: n.x ?? 0,
            y: n.y ?? 0,
            collapsed: Boolean(n.collapsed),
            locked: Boolean(n.locked)
          });
        } catch (e) { noteSkipped('library copy', e); }
      }
      for (const l of src.links || []) {
        const fromSid = screenMap.get(Number(l.fromScreenId)) || l.fromScreenId;
        const toSid = screenMap.get(Number(l.toScreenId)) || l.toScreenId;
        try {
          wfRepo.createLink(createdWf.id, {
            fromScreenId: fromSid,
            toScreenId: toSid,
            fromNodeId: null,
            name: l.name ?? l.triggerLabel ?? '',
            descriptionDev: l.descriptionDev ?? '',
            style: l.style ?? 'curved',
            trigger: l.trigger ?? 'tap'
          });
        } catch (e) { noteSkipped('library copy', e); }
      }
      const fullWf = this.workflows.get(createdWf.id);
      memo.set(cacheKey, fullWf);
      return fullWf;
    }

    const svc = this.services[type];
    if (!svc) throw new ValidationError(`Unsupported item type "${type}"`);
    const src = svc.get(Number(id));

    // Recursively copy all referenced sub-items first (path <- icon <- button <- element <- screen)
    const nodesCopy = JSON.parse(JSON.stringify(src.nodes || []));
    for (const n of nodesCopy) {
      if (n.kind === 'instance' && n.refType && n.refId && this.services[n.refType]) {
        const origRefId = Number(n.refId);
        try {
          const subCopy = this.#copySingleWithCascade(n.refType, origRefId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (subCopy?.id) {
            n.refId = subCopy.id;
            subItemsCreated.push({ type: n.refType, sourceId: origRefId, id: subCopy.id, key: subCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch { /* ignore missing sub-item */ }
      }
      if (n.onClick?.elementId && this.services.element) {
        const origElId = Number(n.onClick.elementId);
        try {
          const elCopy = this.#copySingleWithCascade('element', origElId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (elCopy?.id) {
            n.onClick.elementId = elCopy.id;
            subItemsCreated.push({ type: 'element', sourceId: origElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch (e) { noteSkipped('library copy', e); }
      }
      if (n.onClick?.targetId && ['element', 'popup', 'drawer', 'toolbar'].includes(n.onClick.type) && this.services.element) {
        const origTargetId = Number(n.onClick.targetId);
        try {
          const elCopy = this.#copySingleWithCascade('element', origTargetId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
          if (elCopy?.id) {
            n.onClick.targetId = elCopy.id;
            subItemsCreated.push({ type: 'element', sourceId: origTargetId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
          }
        } catch (e) { noteSkipped('library copy', e); }
      }
      if (Array.isArray(n.events)) {
        for (const ev of n.events) {
          if (ev?.elementId && this.services.element) {
            const origEvElId = Number(ev.elementId);
            try {
              const elCopy = this.#copySingleWithCascade('element', origEvElId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
              if (elCopy?.id) {
                ev.elementId = elCopy.id;
                subItemsCreated.push({ type: 'element', sourceId: origEvElId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
              }
            } catch (e) { noteSkipped('library copy', e); }
          }
          if (ev?.targetId && ['element', 'popup', 'drawer', 'toolbar'].includes(ev.type) && this.services.element) {
            const origEvTargetId = Number(ev.targetId);
            try {
              const elCopy = this.#copySingleWithCascade('element', origEvTargetId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
              if (elCopy?.id) {
                ev.targetId = elCopy.id;
                subItemsCreated.push({ type: 'element', sourceId: origEvTargetId, id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
              }
            } catch (e) { noteSkipped('library copy', e); }
          }
        }
      }
    }

    const finalName = overrideName || src.name;
    const baseKey = slugify(overrideName || src.key);   // keys are per project: a copy keeps its key
    const newKey = uniqueKey(baseKey, k => svc.designs.keyExists(k, targetProjectId));
    const rootItemId = src.rootItemId || src.id;
    const rootOwnerId = src.rootOwnerId || src.creatorId || fallbackOwnerId(this);
    const effCreatorId = actor?.id ?? src.creatorId ?? fallbackOwnerId(this);

    const copyRec = svc.designs.create({
      ...src,
      name: finalName,
      label: overrideName || src.label || src.name,
      key: newKey,
      builtin: false,
      position: undefined,
      projectId: targetProjectId,
      visibility: effVis,
      creatorId: effCreatorId,
      clonedFromId: src.id,
      rootItemId,
      rootOwnerId
    });

    const idMap = new Map();
    const byDepth = parentsFirst(nodesCopy);
    for (const e of byDepth) {
      const made = svc.nodes.create(type, copyRec.id, {
        ...e,
        parentId: e.parentId == null ? null : (idMap.get(e.parentId) ?? null)
      });
      idMap.set(e.id, made.id);
    }
    for (const a of src.animations || []) {
      const targetNodeId = idMap.get(a.nodeId);
      if (targetNodeId) svc.animations.create(targetNodeId, a);
    }

    if (type === 'button' && this.menus) {
      const rawMenuItems = this.menus.list ? this.menus.list(src.id) : [];
      const menuIdMap = new Map();
      const sortedMenu = parentsFirst(rawMenuItems);
      for (const mi of sortedMenu) {
        let iconId = mi.iconId;
        if (iconId && this.services.icon) {
          try {
            const icCopy = this.#copySingleWithCascade('icon', iconId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
            if (icCopy?.id) {
              iconId = icCopy.id;
              subItemsCreated.push({ type: 'icon', sourceId: Number(mi.iconId), id: icCopy.id, key: icCopy.key, projectId: targetProjectId, visibility: effVis });
            }
          } catch (e) { noteSkipped('library copy', e); }
        }
        let targetElementId = mi.targetElementId ?? null;
        if (targetElementId && this.services.element) {
          try {
            const elCopy = this.#copySingleWithCascade('element', targetElementId, targetProjectId, memo, subItemsCreated, actor, { visibility: effVis });
            if (elCopy?.id) {
              targetElementId = elCopy.id;
              subItemsCreated.push({ type: 'element', sourceId: Number(mi.targetElementId), id: elCopy.id, key: elCopy.key, projectId: targetProjectId, visibility: effVis });
            }
          } catch (e) { noteSkipped('library copy', e); }
        }
        try {
          const parentId = mi.parentId == null ? null : (menuIdMap.get(mi.parentId) ?? null);
          const createdMi = this.menus.create(copyRec.id, { ...mi, parentId, iconId, targetElementId });
          menuIdMap.set(mi.id, createdMi.id);
        } catch (e) { noteSkipped('library copy', e); }
      }
    }

    const fullCopy = svc.get(copyRec.id);
    memo.set(cacheKey, fullCopy);
    return fullCopy;
  }

  /** Copies an item (and every sub-item) into the public library: project 1, `public` visibility, owned by the immutable `public` user. */
  publishToPublic({ type, id, actor = null } = {}) {
    const pub = this.auth.publicUserId();
    if (pub == null) throw new ValidationError('The public library owner is missing');
    return this.transaction(() => {
      const res = this.copyToProjects({ items: [{ type, id: Number(id) }], projectIds: [1], visibility: 'public', actor: { id: pub, username: 'public', role: 'viewer' } });
      for (const c of [...res.copied, ...res.subItems]) {
        const rec = c.item || c;
        try {
          if (c.type === 'workflow') this.workflows.workflows.update?.(c.id, { rootOwnerId: pub });
          else this.services[c.type].designs.update(c.id, { rootOwnerId: pub, creatorId: pub });
        } catch { /* ownership fix is best effort per item */ }
        void rec;
      }
      return { publishedCount: res.copiedCount, subItemsCount: res.subItemsCount, copy: res.copied[0]?.item || null, by: actor?.username || null };
    });
  }

  copyToProjects({ items, projectIds = [], visibility = 'project', includeUserPrivate = false, overrideName = null, actor = null } = {}) {
    const targetProjectIds = this.#normalizeTargetProjects(projectIds, { allowEmpty: Boolean(includeUserPrivate || visibility === 'private') });
    const cleanItems = this.#normalizeItems(items);
    const effVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';
    return this.transaction(() => {
      const copied = [];
      const subItems = [];
      for (const pid of targetProjectIds) {
        const memo = new Map();
        for (const it of cleanItems) {
          const created = this.#copySingleWithCascade(it.type, it.id, pid, memo, subItems, actor, {
            visibility: effVis,
            overrideName
          });
          copied.push({
            type: it.type,
            sourceId: it.id,
            projectId: pid,
            id: created.id,
            key: created.key,
            name: created.name,
            visibility: created.visibility,
            creatorId: created.creatorId,
            item: created
          });
        }
      }
      if (includeUserPrivate || (!targetProjectIds.length && effVis === 'private')) {
        const privPid = targetProjectIds[0] || 1;
        const memo = new Map();
        for (const it of cleanItems) {
          const created = this.#copySingleWithCascade(it.type, it.id, privPid, memo, subItems, actor, {
            visibility: 'private',
            overrideName
          });
          copied.push({
            type: it.type,
            sourceId: it.id,
            projectId: privPid,
            id: created.id,
            key: created.key,
            name: created.name,
            visibility: 'private',
            creatorId: created.creatorId,
            item: created
          });
        }
      }
      return {
        copiedCount: copied.length,
        subItemsCount: subItems.length,
        projectIds: targetProjectIds,
        copied,
        subItems
      };
    });
  }

  /**
   * Saves / clones an item (and all its cascading sub-items) into multiple target projects and/or the user's
   * global private item library (`visibility = 'private'`), optionally restoring the source item's baseline.
   */
  saveAsToTargets({
    type,
    id,
    name = '',
    projectIds = [],
    visibility = 'project',
    includeUserPrivate = false,
    restoreBaseline = null,
    actor = null
  } = {}) {
    const cleanType = String(type || '').trim().replace(/s$/, '');
    const cleanId = Number(id);
    if (!['path', 'icon', 'button', 'element', 'screen', 'workflow'].includes(cleanType) || !cleanId) {
      throw new ValidationError('Valid item type and id are required for saveAsToTargets');
    }
    return this.transaction(() => {
      const res = this.copyToProjects({
        items: [{ type: cleanType, id: cleanId }],
        projectIds,
        visibility,
        includeUserPrivate,
        overrideName: name ? String(name).trim() : null,
        actor
      });
      if (restoreBaseline && typeof restoreBaseline === 'object') {
        if (cleanType === 'workflow') {
          this.workflows.restore(cleanId, restoreBaseline);
        } else if (this.services[cleanType]) {
          this.services[cleanType].restore(cleanId, restoreBaseline);
        }
      }
      return {
        ...res,
        savedCount: res.copiedCount,
        primaryCopy: res.copied[0]?.item || null
      };
    });
  }

  moveToProjects({ items, projectIds, actor = null, actorId = null } = {}) {
    const effActorId = Number(actorId ?? actor?.id ?? fallbackOwnerId(this));
    const targetProjectIds = this.#normalizeTargetProjects(projectIds);
    const cleanItems = this.#normalizeItems(items);

    // Move items ONLY works with the acting user's owned projects
    for (const pid of targetProjectIds) {
      const proj = this.projects.get(pid);
      if (Number(proj.ownerId || fallbackOwnerId(this)) !== effActorId) {
        throw new ForbiddenError(`Move items only works with your own projects (project "${proj.name}" is owned by another user)`);
      }
    }

    // Pre-validate source items: default basic items (`builtin`) or items owned by other users cannot be moved (only copied)
    const sources = cleanItems.map(it => {
      const record = it.type === 'workflow'
        ? this.workflows.get(it.id)
        : this.services[it.type].get(it.id);
      if (record.builtin) {
        throw new ForbiddenError(`Default basic item "${record.name || record.key}" cannot be moved; it can only be copied`);
      }
      const ownerId = Number(record.creatorId || record.rootOwnerId || fallbackOwnerId(this));
      const publicCurator = ownerId === Number(this.auth?.publicUserId?.()) && this.auth?.isSuperadmin(actor || this.projects?.users?.get(effActorId));
      if (ownerId !== effActorId && !publicCurator) {
        throw new ForbiddenError(`Item "${record.name || record.key}" is owned by another user and cannot be moved; it can only be copied`);
      }
      // the public library is immutable: an admin "moving" a public-library item clones it (the source stays)
      return { ...it, record, keepSource: publicCurator };
    });

    return this.transaction(() => {
      const copyResult = this.copyToProjects({ items: cleanItems, projectIds: targetProjectIds, actor: actor || { id: effActorId } });
      const removedSourceIds = [];
      const keptSourceIds = [];
      for (const src of sources) {
        if (src.keepSource) { keptSourceIds.push({ type: src.type, id: src.id }); continue; }
        if (src.type === 'workflow') {
          this.workflows.remove(src.id, { actor, permanent: true });
        } else {
          this.services[src.type].remove(src.id, { actor, permanent: true });
        }
        removedSourceIds.push({ type: src.type, id: src.id });
      }
      return {
        ...copyResult,
        movedCount: copyResult.copiedCount,
        moved: copyResult.copied,
        removedSourceIds,
        keptSourceIds
      };
    });
  }

  /**
   * Empties a project's private item library (`visibility === 'project'` and `builtin === false`).
   * Default/public libraries are immutable and cannot be emptied (`ConflictError`).
   */
  emptyProjectLibrary({ projectId, itemType = 'all', scope = 'project', includePublic = false, actor = null } = {}) {
    if (scope === 'public' || scope === 'default' || includePublic) {
      throw new ConflictError('Default public libraries are immutable and cannot be emptied');
    }
    const pid = Number(projectId);
    if (!pid || !Number.isFinite(pid)) {
      throw new ValidationError('A valid projectId is required to empty a project library');
    }
    const proj = this.projects.get(pid);
    if (actor && !this.projects.isOwnerOrAdmin(proj.id, actor)) {
      throw new ForbiddenError('Only the project owner or admin can empty the project private library');
    }

    const types = (!itemType || itemType === 'all')
      ? ['screen', 'element', 'button', 'icon', 'path', 'workflow']
      : [String(itemType).replace(/s$/, '')];

    const toTrash = [];
    let defaultOrPublicCount = 0;

    for (const t of types) {
      if (t === 'workflow') {
        const allWf = this.workflows.list({ projectId: pid, includePublic: true });
        for (const wf of allWf) {
          if (wf.projectId === pid && wf.visibility === 'project') {
            toTrash.push({ type: 'workflow', id: wf.id });
          } else if (wf.projectId === pid || wf.visibility === 'public') {
            defaultOrPublicCount++;
          }
        }
      } else if (this.services[t]) {
        const allItems = this.services[t].list({ projectId: pid, includePublic: true });
        for (const it of allItems) {
          if (it.projectId === pid && it.visibility === 'project' && !it.builtin) {
            toTrash.push({ type: t, id: it.id });
          } else if (it.projectId === pid && (it.builtin || it.visibility === 'public')) {
            defaultOrPublicCount++;
          }
        }
      }
    }

    if (toTrash.length === 0 && (pid === 1 || defaultOrPublicCount > 0)) {
      throw new ConflictError('Default public libraries are immutable and cannot be emptied');
    }

    return this.transaction(() => {
      const trashed = [];
      for (const entry of toTrash) {
        if (entry.type === 'workflow') {
          const res = this.workflows.remove(entry.id, { actor });
          trashed.push({ type: 'workflow', id: entry.id, trashId: res.trashId });
        } else {
          const res = this.services[entry.type].remove(entry.id, { actor });
          trashed.push({ type: entry.type, id: entry.id, trashId: res.trashId });
        }
      }
      return {
        emptied: true,
        projectId: pid,
        emptiedCount: trashed.length,
        trashed
      };
    });
  }

  /**
   * Export paths, icons, buttons, elements, screens, and workflows in JSON, SVG, or HTML format.
   * Supports exporting either an explicit list of `items: [{ type, id }]` or all items matching
   * `types` / `projectId` / `visibility`, optionally cascading referenced sub-items (`includeSubItems`).
   */
  exportLibraryItems({
    items = [],
    types = [],
    format = 'json',
    projectId = null,
    visibility = 'all',
    includeSubItems = true
  } = {}) {
    const fmt = String(format || 'json').trim().toLowerCase();
    if (!['json', 'svg', 'html'].includes(fmt)) {
      throw new ValidationError(`Unsupported export format '${format}'. Expected json, svg, or html.`);
    }

    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const collected = {
      path: new Map(),
      icon: new Map(),
      button: new Map(),
      element: new Map(),
      screen: new Map(),
      workflow: new Map()
    };

    const collectEntity = (type, id) => {
      const normType = String(type || '').trim().replace(/s$/, '');
      const numId = Number(id);
      if (!ALL_TYPES.includes(normType) || !numId) return;
      if (collected[normType].has(numId)) return;

      if (normType === 'workflow') {
        try {
          const wf = this.workflows.get(numId);
          collected.workflow.set(numId, wf);
          if (includeSubItems && Array.isArray(wf.nodes)) {
            for (const wn of wf.nodes) {
              if (wn.screenId) collectEntity('screen', Number(wn.screenId));
            }
          }
        } catch { /* ignore missing */ }
        return;
      }

      const svc = this.services[normType];
      if (!svc) return;
      try {
        const entity = svc.get(numId);
        let menuItems = [];
        if (this.menus && (normType === 'element' || normType === 'screen')) {
          try {
            menuItems = this.menus.list({ ownerType: normType, ownerId: numId });
          } catch (e) { noteSkipped('library transfer', e); }
        }
        collected[normType].set(numId, { ...entity, menuItems });
        if (includeSubItems) {
          for (const node of (entity.nodes || [])) {
            if (node.kind === 'instance' && node.refType && node.refId) {
              collectEntity(node.refType, Number(node.refId));
            }
          }
          for (const mi of menuItems) {
            if (mi.popupElementId) collectEntity('element', Number(mi.popupElementId));
          }
        }
      } catch { /* ignore missing */ }
    };

    if (Array.isArray(items) && items.length > 0) {
      for (const ref of this.#normalizeItems(items)) {
        collectEntity(ref.type, ref.id);
      }
    } else {
      const requestedTypes = (Array.isArray(types) && types.length > 0)
        ? types.map(t => String(t).trim().replace(/s$/, '')).filter(t => ALL_TYPES.includes(t))
        : ALL_TYPES;
      const pid = projectId ? Number(projectId) : null;
      const visFilter = String(visibility || 'all').toLowerCase();

      for (const t of requestedTypes) {
        const list = t === 'workflow'
          ? this.workflows.list({ projectId: pid, includePublic: true })
          : this.services[t].list({ projectId: pid, includePublic: true });
        for (const row of list) {
          if (visFilter === 'public' && row.visibility !== 'public') continue;
          if (visFilter === 'private' && row.visibility !== 'private') continue;
          if (visFilter === 'project' && row.visibility !== 'project') continue;
          if (pid && visFilter === 'project' && Number(row.projectId) !== pid) continue;
          collectEntity(t, row.id);
        }
      }
    }

    const payload = {
      schema: 'kyrpy-uiux-library-v2',
      exportedAt: new Date().toISOString(),
      format: fmt,
      counts: {},
      items: {}
    };
    let totalCount = 0;
    for (const t of ALL_TYPES) {
      const arr = [...collected[t].values()];
      payload.items[t] = arr;
      payload.counts[t] = arr.length;
      totalCount += arr.length;
    }

    const jsonString = JSON.stringify(payload, null, 2);
    const b64Payload = Buffer.from(jsonString, 'utf8').toString('base64');

    if (fmt === 'json') {
      return {
        format: 'json',
        filename: 'kyrpy-library-export.json',
        contentType: 'application/json',
        totalCount,
        counts: payload.counts,
        content: jsonString
      };
    }

    const renderItemSvg = (type, item) => {
      if (type === 'workflow') {
        const nodes = item.nodes || [];
        const edges = item.edges || [];
        const w = 720;
        const h = Math.max(260, nodes.length * 70 + 80);
        const nodeMap = new Map(nodes.map((n, i) => [n.id, { ...n, x: Number(n.x ?? (80 + (i % 3) * 210)), y: Number(n.y ?? (60 + Math.floor(i / 3) * 100)) }]));
        const edgeLines = edges.map(e => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) return '';
          return `<line x1="${from.x + 70}" y1="${from.y + 28}" x2="${to.x + 70}" y2="${to.y + 28}" stroke="#6C5CE7" stroke-width="2" />`;
        }).join('\n  ');
        const nodeBoxes = [...nodeMap.values()].map(n => {
          const safeTitle = String(n.title || n.id || 'Screen').replace(/[<>&"]/g, '');
          return `<g transform="translate(${n.x},${n.y})"><rect width="140" height="56" rx="12" fill="#171B26" stroke="#00D2D3" stroke-width="2"/><text x="70" y="32" text-anchor="middle" fill="#F1F5F9" font-family="Inter, sans-serif" font-size="12" font-weight="600">${safeTitle}</text></g>`;
        }).join('\n  ');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-item-type="workflow" data-item-id="${item.id}" data-item-name="${String(item.name || '').replace(/"/g, '&quot;')}">\n  <rect width="${w}" height="${h}" rx="16" fill="#0F1117"/>\n  ${edgeLines}\n  ${nodeBoxes}\n</svg>`;
      }
      if (this.render) {
        try {
          return this.render.renderEntity(type, item.id).svg;
        } catch { /* fallback */ }
      }
      const vb = item.viewBox || '0 0 24 24';
      const w = item.width || 64;
      const h = item.height || 64;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" data-item-type="${type}" data-item-id="${item.id}"></svg>`;
    };

    if (fmt === 'svg') {
      const renderedBlocks = [];
      let yCursor = 20;
      let maxW = 640;
      for (const t of ALL_TYPES) {
        for (const item of payload.items[t]) {
          const rawSvg = renderItemSvg(t, item);
          const w = Number(item.width) || (t === 'workflow' ? 720 : t === 'screen' ? 390 : 96);
          const h = Number(item.height) || (t === 'workflow' ? 280 : t === 'screen' ? 844 : 96);
          maxW = Math.max(maxW, w + 40);
          const inner = rawSvg.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
          const vb = item.viewBox || `0 0 ${w} ${h}`;
          const safeName = String(item.name || `${t}-${item.id}`).replace(/[<>&"]/g, '');
          renderedBlocks.push(
            `  <g id="item-${t}-${item.id}" data-item-type="${t}" data-item-id="${item.id}" data-item-name="${safeName}" transform="translate(20, ${yCursor})">\n` +
            `    <svg viewBox="${vb}" width="${w}" height="${h}">\n${inner}\n    </svg>\n` +
            `  </g>`
          );
          yCursor += h + 32;
        }
      }

      if (totalCount === 1) {
        for (const t of ALL_TYPES) {
          if (payload.items[t].length === 1) {
            const singleSvg = renderItemSvg(t, payload.items[t][0]);
            const annotated = `<!-- KYRPY_UIUX_LIBRARY_PAYLOAD:${b64Payload} -->\n${singleSvg}`;
            return {
              format: 'svg',
              filename: `${payload.items[t][0].slug || `${t}-${payload.items[t][0].id}`}.svg`,
              contentType: 'image/svg+xml',
              totalCount,
              counts: payload.counts,
              content: annotated
            };
          }
        }
      }

      const sheetH = Math.max(120, yCursor);
      const svgContent =
        `<!-- KYRPY_UIUX_LIBRARY_PAYLOAD:${b64Payload} -->\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${sheetH}" width="${maxW}" height="${sheetH}">\n` +
        `${renderedBlocks.join('\n')}\n` +
        `</svg>`;

      return {
        format: 'svg',
        filename: 'kyrpy-library-export.svg',
        contentType: 'image/svg+xml',
        totalCount,
        counts: payload.counts,
        content: svgContent
      };
    }

    // fmt === 'html'
    const cardsHtml = [];
    for (const t of ALL_TYPES) {
      for (const item of payload.items[t]) {
        const svgMarkup = renderItemSvg(t, item);
        const safeName = String(item.name || `${t}-${item.id}`).replace(/[<>&"]/g, '');
        const safeCat = String(item.category || 'general').replace(/[<>&"]/g, '');
        const safeVis = String(item.visibility || 'public').replace(/[<>&"]/g, '');
        cardsHtml.push(
          `    <article class="ud-lib-card" data-item-type="${t}" data-item-id="${item.id}" data-item-name="${safeName}" data-item-visibility="${safeVis}">\n` +
          `      <header class="ud-lib-card-head">\n` +
          `        <span class="ud-badge ud-badge-${t}">${t.toUpperCase()}</span>\n` +
          `        <strong>${safeName}</strong>\n` +
          `        <small>${safeCat} · ${safeVis}</small>\n` +
          `      </header>\n` +
          `      <div class="ud-lib-preview">${svgMarkup}</div>\n` +
          `    </article>`
        );
      }
    }

    const htmlContent = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8"/>',
      '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
      '  <title>Kyrpy UI/UX Designer — Library Export</title>',
      '  <style>',
      '    body { margin: 0; padding: 24px; background: #0B0D14; color: #F1F5F9; font-family: Inter, system-ui, sans-serif; }',
      '    h1 { font-size: 20px; margin: 0 0 16px; }',
      '    .ud-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }',
      '    .ud-lib-card { background: #141824; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }',
      '    .ud-lib-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }',
      '    .ud-lib-card-head small { color: #94A3B8; margin-left: auto; }',
      '    .ud-badge { padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; background: rgba(108,92,231,0.22); color: #A29BFE; }',
      '    .ud-lib-preview { display: flex; align-items: center; justify-content: center; min-height: 110px; background: rgba(0,0,0,0.28); border-radius: 8px; padding: 12px; overflow: auto; }',
      '    .ud-lib-preview svg { max-width: 100%; max-height: 300px; height: auto; }',
      '  </style>',
      '</head>',
      '<body>',
      `  <h1>Kyrpy UI/UX Library Export (${totalCount} items)</h1>`,
      '  <section class="ud-lib-grid">',
      cardsHtml.join('\n'),
      '  </section>',
      `  <script type="application/json" id="ud-library-payload">${jsonString}</script>`,
      '</body>',
      '</html>'
    ].join('\n');

    return {
      format: 'html',
      filename: 'kyrpy-library-export.html',
      contentType: 'text/html',
      totalCount,
      counts: payload.counts,
      content: htmlContent
    };
  }

  /**
   * Import paths, icons, buttons, elements, screens, and workflows from HTML, SVG, or JSON content
   * into either a Project library (`visibility: 'project'`) or the Public library (`visibility: 'public'`).
   */
  importLibraryItems({
    format = 'auto',
    content = '',
    targetType = 'auto',
    projectId = 1,
    visibility = 'project',
    category = 'imported',
    name = '',
    actor = null
  } = {}) {
    const rawText = typeof content === 'string' ? content.trim() : JSON.stringify(content || {});
    if (!rawText) {
      throw new ValidationError('Import content is required (HTML, SVG, or JSON)');
    }

    const pid = Number(projectId) || 1;
    this.projects.get(pid);
    const targetVis = VISIBILITY_LEVELS.includes(visibility) ? visibility : 'project';

    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const normTargetType = String(targetType || 'auto').trim().toLowerCase().replace(/s$/, '');

    // 1. Detect embedded or direct JSON library bundle (`kyrpy-uiux-library-v2` or single/array JSON)
    let parsedBundle = null;
    const svgPayloadMatch = rawText.match(/<!--\s*KYRPY_UIUX_LIBRARY_PAYLOAD:([A-Za-z0-9+/=]+)\s*-->/);
    const htmlPayloadMatch = rawText.match(/<script[^>]*id=["']ud-library-payload["'][^>]*>([\s\S]*?)<\/script>/i);

    if (svgPayloadMatch) {
      try {
        parsedBundle = JSON.parse(Buffer.from(svgPayloadMatch[1], 'base64').toString('utf8'));
      } catch { /* fallback to raw SVG */ }
    } else if (htmlPayloadMatch) {
      try {
        parsedBundle = JSON.parse(htmlPayloadMatch[1].trim());
      } catch { /* fallback to raw HTML */ }
    } else if (format === 'json' || rawText.startsWith('{') || rawText.startsWith('[')) {
      try {
        parsedBundle = JSON.parse(rawText);
      } catch (err) {
        if (format === 'json') throw new ValidationError(`Invalid JSON payload: ${err.message}`);
      }
    }

    if (parsedBundle) {
      return this.#importStructuredBundle(parsedBundle, {
        projectId: pid,
        visibility: targetVis,
        targetType: normTargetType,
        category,
        name,
        actor
      });
    }

    // 2. Raw SVG or HTML without embedded JSON payload
    const isHtml = format === 'html' || /<!doctype\s+html|<html[\s>]|<article[\s>]|<div[\s>]/i.test(rawText);
    const effectiveType = ALL_TYPES.includes(normTargetType) ? normTargetType : 'icon';

    return this.transaction(() => {
      const created = [];
      const svgMatches = [...rawText.matchAll(/<svg[\s\S]*?<\/svg>/gi)].map(m => m[0]);

      if (svgMatches.length > 0) {
        svgMatches.forEach((svgBlock, idx) => {
          const itemName = name
            ? (svgMatches.length > 1 ? `${name} ${idx + 1}` : name)
            : (svgBlock.match(/data-item-name=["']([^"']+)["']/i)?.[1] || `Imported ${effectiveType} ${idx + 1}`);
          const itemTypeAttr = svgBlock.match(/data-item-type=["']([^"']+)["']/i)?.[1]?.toLowerCase()?.replace(/s$/, '');
          const chosenType = (normTargetType === 'auto' && ALL_TYPES.includes(itemTypeAttr))
            ? itemTypeAttr
            : effectiveType;
          const record = this.#createEntityFromSvg(chosenType, svgBlock, {
            name: itemName,
            category,
            projectId: pid,
            visibility: targetVis,
            actor
          });
          created.push({ type: chosenType, id: record.id, name: record.name, visibility: targetVis, projectId: pid });
        });
      } else if (isHtml) {
        const chosenType = ALL_TYPES.includes(normTargetType) ? normTargetType : 'element';
        const itemName = name || `Imported HTML ${chosenType}`;
        const record = this.#createEntityFromHtml(chosenType, rawText, {
          name: itemName,
          category,
          projectId: pid,
          visibility: targetVis,
          actor
        });
        created.push({ type: chosenType, id: record.id, name: record.name, visibility: targetVis, projectId: pid });
      } else {
        throw new ValidationError('Could not recognize valid JSON, SVG (<svg>...</svg>), or HTML content to import');
      }

      return {
        importedCount: created.length,
        projectId: pid,
        visibility: targetVis,
        created
      };
    });
  }

  #importStructuredBundle(bundle, { projectId, visibility, targetType, category, name, actor }) {
    const ALL_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
    const buckets = { path: [], icon: [], button: [], element: [], screen: [], workflow: [] };

    if (bundle && typeof bundle === 'object' && bundle.items && typeof bundle.items === 'object') {
      for (const t of ALL_TYPES) {
        if (Array.isArray(bundle.items[t])) buckets[t].push(...bundle.items[t]);
        else if (Array.isArray(bundle.items[`${t}s`])) buckets[t].push(...bundle.items[`${t}s`]);
      }
    } else if (Array.isArray(bundle)) {
      for (const entry of bundle) {
        const t = String(entry.type || entry.itemType || (ALL_TYPES.includes(targetType) ? targetType : 'icon')).replace(/s$/, '');
        if (ALL_TYPES.includes(t)) buckets[t].push(entry);
      }
    } else if (bundle && typeof bundle === 'object') {
      let matched = false;
      for (const t of ALL_TYPES) {
        if (Array.isArray(bundle[t])) { buckets[t].push(...bundle[t]); matched = true; }
        else if (Array.isArray(bundle[`${t}s`])) { buckets[t].push(...bundle[`${t}s`]); matched = true; }
      }
      if (!matched) {
        const t = String(bundle.type || bundle.itemType || (ALL_TYPES.includes(targetType) ? targetType : 'icon')).replace(/s$/, '');
        if (ALL_TYPES.includes(t)) buckets[t].push(bundle);
      }
    }

    return this.transaction(() => {
      const idMap = new Map(); // `${type}:${oldId}` -> newEntity
      const created = [];
      const slugSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      for (const t of ['path', 'icon', 'button', 'element', 'screen']) {
        for (let i = 0; i < buckets[t].length; i++) {
          const src = buckets[t][i];
          const oldId = Number(src.id);
          const itemName = (name && buckets[t].length === 1 && targetType === t) ? name : (src.name || `Imported ${t}`);
          const baseSlug = String(src.slug || itemName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || t;
          const remappedNodes = (src.nodes || []).map(n => {
            const copy = structuredClone(n);
            if (copy.kind === 'instance' && copy.refType && copy.refId) {
              const rType = String(copy.refType).replace(/s$/, '');
              const mapped = idMap.get(`${rType}:${Number(copy.refId)}`);
              if (mapped) copy.refId = mapped.id;
            }
            return copy;
          });

          const saved = this.services[t].create({
            name: itemName,
            slug: `${baseSlug}-${slugSuffix}-${i}`,
            category: src.category || category || 'imported',
            width: src.width || (t === 'screen' ? 390 : t === 'element' ? 320 : t === 'button' ? 140 : 24),
            height: src.height || (t === 'screen' ? 844 : t === 'element' ? 180 : t === 'button' ? 44 : 24),
            viewBox: src.viewBox || `0 0 ${src.width || 24} ${src.height || 24}`,
            nodes: remappedNodes,
            events: structuredClone(src.events || []),
            animations: structuredClone(src.animations || []),
            meta: structuredClone(src.meta || {}),
            projectId,
            visibility,
            createdBy: actor?.id ?? null
          });

          if (oldId) idMap.set(`${t}:${oldId}`, saved);

          if (this.menus && Array.isArray(src.menuItems) && src.menuItems.length > 0) {
            for (const mi of src.menuItems) {
              const mappedPopup = mi.popupElementId ? idMap.get(`element:${Number(mi.popupElementId)}`) : null;
              const mappedScreen = mi.targetScreenId ? idMap.get(`screen:${Number(mi.targetScreenId)}`) : null;
              this.menus.create({
                projectId,
                ownerType: t,
                ownerId: saved.id,
                nodeId: mi.nodeId || '',
                label: mi.label || 'Menu Item',
                iconId: mi.iconId ?? null,
                targetScreenId: mappedScreen ? mappedScreen.id : (mi.targetScreenId ?? null),
                targetAction: mi.targetAction || 'navigate',
                popupElementId: mappedPopup ? mappedPopup.id : (mi.popupElementId ?? null),
                visible: mi.visible !== undefined ? Boolean(mi.visible) : true,
                sortOrder: mi.sortOrder ?? 0,
                meta: structuredClone(mi.meta || {})
              });
            }
          }

          created.push({ type: t, id: saved.id, name: saved.name, visibility, projectId });
        }
      }

      for (let i = 0; i < buckets.workflow.length; i++) {
        const wf = buckets.workflow[i];
        const wfName = (name && buckets.workflow.length === 1 && targetType === 'workflow') ? name : (wf.name || 'Imported Workflow');
        const baseSlug = String(wf.slug || wfName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
        const remappedNodes = (wf.nodes || []).map(wn => {
          const copy = structuredClone(wn);
          if (copy.screenId) {
            const mappedScreen = idMap.get(`screen:${Number(copy.screenId)}`);
            if (mappedScreen) copy.screenId = mappedScreen.id;
          }
          return copy;
        });

        const savedWf = this.workflows.create({
          name: wfName,
          slug: `${baseSlug}-${slugSuffix}-${i}`,
          description: wf.description || '',
          projectId,
          visibility,
          nodes: remappedNodes,
          edges: structuredClone(wf.edges || []),
          meta: structuredClone(wf.meta || {}),
          createdBy: actor?.id ?? null
        });
        created.push({ type: 'workflow', id: savedWf.id, name: savedWf.name, visibility, projectId });
      }

      return {
        importedCount: created.length,
        projectId,
        visibility,
        created
      };
    });
  }

  #createEntityFromSvg(type, svgText, { name, category, projectId, visibility, actor }) {
    const parsed = this.parseSvg
      ? this.parseSvg(svgText)
      : { viewBox: '0 0 24 24', width: 24, height: 24, nodes: [] };
    const slug = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    if (type === 'workflow') {
      return this.workflows.create({
        name,
        slug,
        description: 'Imported from SVG',
        projectId,
        visibility,
        nodes: [{ id: 'wn-1', title: name, x: 80, y: 80 }],
        edges: [],
        meta: { importedFrom: 'svg' },
        createdBy: actor?.id ?? null
      });
    }

    const defaultW = type === 'screen' ? 390 : type === 'element' ? 320 : type === 'button' ? 140 : (parsed.width || 24);
    const defaultH = type === 'screen' ? 844 : type === 'element' ? 180 : type === 'button' ? 44 : (parsed.height || 24);
    return this.services[type].create({
      name,
      slug,
      category: category || 'imported',
      width: defaultW,
      height: defaultH,
      viewBox: parsed.viewBox || `0 0 ${defaultW} ${defaultH}`,
      nodes: parsed.nodes?.length ? parsed.nodes : [{ id: 'shape-1', kind: 'rect', x: 0, y: 0, width: defaultW, height: defaultH, rx: 8, fill: '#6C5CE7' }],
      events: [],
      animations: [],
      meta: { importedFrom: 'svg' },
      projectId,
      visibility,
      createdBy: actor?.id ?? null
    });
  }

  #createEntityFromHtml(type, htmlText, { name, category, projectId, visibility, actor }) {
    const slug = `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const plainTitle = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      || htmlText.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
      || name;

    if (type === 'workflow') {
      return this.workflows.create({
        name: plainTitle || name,
        slug,
        description: 'Imported from HTML',
        projectId,
        visibility,
        nodes: [{ id: 'wn-1', title: plainTitle || name, x: 80, y: 80 }],
        edges: [],
        meta: { importedFrom: 'html' },
        createdBy: actor?.id ?? null
      });
    }

    const w = type === 'screen' ? 390 : type === 'element' ? 320 : type === 'button' ? 140 : 24;
    const h = type === 'screen' ? 844 : type === 'element' ? 180 : type === 'button' ? 44 : 24;
    return this.services[type].create({
      name: plainTitle || name,
      slug,
      category: category || 'imported',
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      nodes: [
        { id: 'bg-rect', kind: 'rect', x: 0, y: 0, width: w, height: h, rx: 10, fill: '#171B26', stroke: '#6C5CE7', strokeWidth: 1.5 },
        { id: 'label-txt', kind: 'text', x: Math.round(w / 2), y: Math.round(h / 2), text: plainTitle || name, fill: '#F1F5F9', fontSize: 13, textAnchor: 'middle' }
      ],
      events: [],
      animations: [],
      meta: { importedFrom: 'html', rawHtmlSnippet: htmlText.slice(0, 4000) },
      projectId,
      visibility,
      createdBy: actor?.id ?? null
    });
  }
}
