/** Projects, their settings, members and clones (`ProjectService`). */
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { PROJECT_ROLES, VISIBILITY_LEVELS, BUTTON_STYLES, DEFAULT_PROJECT_BUTTON_SETTINGS, normalizeButtonIconSizePct, normalizeButtonStyleKey, applyButtonStyleAndIconSizeToNodes, isButtonStyleFrame, isDesignButtonTemplate } from '../domain/entities.js';
import { isValidKey, slugify, uniqueKey, isValidProjectPrefix } from '../domain/naming.js';
import { fallbackOwnerId } from './default-owner.js';
import { isSystemUser } from '../domain/system-users.js';
import { ForbiddenError } from './service-shared.js';

export class ProjectService {
  constructor({ projects, users, auth, changes, designs, nodes, workflows, services = null, libraryTransfer = null, transaction }) {
    Object.assign(this, { projects, users, auth, changes, designs, nodes, workflows, services, libraryTransfer, transaction });
  }

  /** Start-up write, called by the composition root: the default project. */
  seed() { this.ensureDefaultProject(); return this; }

  /**
   * Second half of the wiring: the design services and the library transfer are built after this service (they
   * need it), so they arrive here. Called once by the composition root; a missing one is an error, not a null.
   */
  bind({ services, libraryTransfer }) {
    if (!services || !libraryTransfer) throw new Error('ProjectService.bind needs services and libraryTransfer');
    Object.assign(this, { services, libraryTransfer });
    return this;
  }

  ensureDefaultProject() {
    let p = this.projects.get(1) || this.projects.getByKey('default-project');
    if (!p) {
      p = this.projects.create({
        key: 'default-project',
        name: 'Default Public Project',
        label: 'Default Public Project',
        description: 'Default workspace project containing public and shared UI/UX designs.',
        ownerId: 1,
        visibility: 'public',
        requireApproval: true,
        settings: { ...DEFAULT_PROJECT_BUTTON_SETTINGS }
      });
    }
    this.projects.upsertMember({ projectId: p.id, userId: 1, invitedBy: 1, role: 'owner', status: 'accepted' });
  }

  /** Projects `user` may see: public ones (unless includePublic is false), their own and those they are a member of; admins see all. No user = no filter (internal callers). */
  list({ user = null, includePublic = true, q = '' } = {}) {
    const all = this.projects.list();
    const text = String(q || '').trim().toLowerCase();
    return all.filter(p => {
      if (text && !`${p.key} ${p.name} ${p.label} ${p.description}`.toLowerCase().includes(text)) return false;
      if (!user || this.auth.isAdmin(user) || p.ownerId === user.id) return true;
      if (p.visibility === 'public') return includePublic !== false;
      const m = this.projects.getMember(p.id, user.id);
      return !!m && m.status === 'accepted';
    }).map(p => this.#enrich(p));
  }

  #enrich(p) {
    const members = this.projects.members(p.id);
    const owner = this.users.get(p.ownerId);
    const pendingChanges = this.changes ? (this.changes.countByStatus ? this.changes.countByStatus({ projectId: p.id }).pending : this.changes.list({ projectId: p.id, status: 'pending' }).length) : 0;
    const rawSettings = (p.settings && typeof p.settings === 'object') ? p.settings : {};
    const settings = {
      ...DEFAULT_PROJECT_BUTTON_SETTINGS,
      ...rawSettings,
      buttonStyle: normalizeButtonStyleKey(rawSettings.buttonStyle, DEFAULT_PROJECT_BUTTON_SETTINGS.buttonStyle),
      buttonIconSizePct: normalizeButtonIconSizePct(rawSettings.buttonIconSizePct, DEFAULT_PROJECT_BUTTON_SETTINGS.buttonIconSizePct)
    };
    return {
      ...p,
      settings,
      buttonStyle: settings.buttonStyle,
      buttonIconSizePct: settings.buttonIconSizePct,
      ownerUsername: owner?.username || 'superadmin',
      members,
      memberCount: members.length,
      pendingChanges
    };
  }

  get(idOrKey) {
    const p = /^\d+$/.test(String(idOrKey)) ? this.projects.get(Number(idOrKey)) : this.projects.getByKey(String(idOrKey));
    if (!p) throw new NotFoundError('project', idOrKey);
    return this.#enrich(p);
  }

  userRole(projectId, user) {
    if (!user) return 'viewer';
    if (this.auth.isAdmin(user)) return 'owner';
    const p = this.projects.get(Number(projectId));
    if (!p) return null;
    if (p.ownerId === user.id) return 'owner';
    const m = this.projects.getMember(p.id, user.id);
    if (m && m.status === 'accepted') return m.role;
    return p.visibility === 'public' ? 'contributor' : null;
  }

  isOwnerOrAdmin(projectId, user) {
    const r = this.userRole(projectId, user);
    return r === 'owner' || r === 'admin';
  }

  create(input, { actor = null } = {}) {
    if (actor) this.auth.assertCanWrite(actor);
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('Project name is required');
    const key = input.key ? String(input.key).trim() : uniqueKey(slugify(name), k => this.projects.keyExists(k));
    if (!isValidKey(key)) throw new ValidationError('Project key must be dashed lowercase words');
    if (this.projects.keyExists(key)) throw new ConflictError(`Project key "${key}" already exists`);
    // a project created by a user needs its global prefix (set once here, used for every dropped public item)
    let prefix = null;
    if (input.prefix !== undefined && input.prefix !== null) {
      prefix = String(input.prefix ?? '').trim().toLowerCase();
      if (!isValidProjectPrefix(prefix)) throw new ValidationError('Project prefix is required: 2-16 lowercase letters or digits, starting with a letter');
      if (this.list({ includePublic: true }).some(p => p.settings?.prefix === prefix)) throw new ConflictError(`Project prefix "${prefix}" is already used by another project`);
    }
    const ownerId = actor?.id ?? Number(input.ownerId || fallbackOwnerId(this));
    if (isSystemUser(this.users.get(ownerId))) throw new ValidationError('A system account cannot own a project');
    const rawVis = input.visibility === 'project' ? 'private' : input.visibility;
    const visibility = ['public', 'private'].includes(rawVis) ? rawVis : 'public';
    return this.transaction(() => {
      const mergedSettings = {
        ...DEFAULT_PROJECT_BUTTON_SETTINGS,
        ...(input.settings && typeof input.settings === 'object' ? input.settings : {}),
        ...(input.buttonStyle !== undefined ? { buttonStyle: normalizeButtonStyleKey(input.buttonStyle) } : {}),
        ...(input.buttonIconSizePct !== undefined ? { buttonIconSizePct: normalizeButtonIconSizePct(input.buttonIconSizePct) } : {}),
        ...(prefix ? { prefix } : {})
      };
      const p = this.projects.create({
        key,
        name,
        label: input.label || name,
        description: input.description || '',
        ownerId,
        visibility,
        requireApproval: input.requireApproval !== false,
        settings: mergedSettings
      });
      this.projects.upsertMember({ projectId: p.id, userId: ownerId, invitedBy: ownerId, role: 'owner', status: 'accepted' });
      return this.get(p.id);
    });
  }

  update(id, patch, { actor = null } = {}) {
    const p = this.get(id);
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only the project owner or admin can update project settings');
    // the prefix is immutable: whatever the route (save, settings, API), a project keeps the prefix it was created with
    if (patch.settings && typeof patch.settings === 'object' && patch.settings.prefix !== undefined && p.settings?.prefix && patch.settings.prefix !== p.settings.prefix) {
      throw new ValidationError('The project prefix is set once when the project is created and cannot be changed');
    }
    const clean = {};
    if (patch.name !== undefined) clean.name = String(patch.name).trim();
    if (patch.label !== undefined) clean.label = String(patch.label).trim();
    if (patch.description !== undefined) clean.description = String(patch.description);
    if (patch.visibility !== undefined) {
      const rawVis = patch.visibility === 'project' ? 'private' : patch.visibility;
      if (!['public', 'private'].includes(rawVis)) throw new ValidationError('Project visibility must be public or private');
      clean.visibility = rawVis;
    }
    if (patch.requireApproval !== undefined) clean.requireApproval = !!patch.requireApproval;
    if (patch.settings !== undefined || patch.buttonStyle !== undefined || patch.buttonIconSizePct !== undefined) {
      const nextSettings = {
        ...(p.settings || {}),
        ...(patch.settings && typeof patch.settings === 'object' ? patch.settings : {})
      };
      if (patch.buttonStyle !== undefined) nextSettings.buttonStyle = normalizeButtonStyleKey(patch.buttonStyle, nextSettings.buttonStyle);
      if (patch.buttonIconSizePct !== undefined) nextSettings.buttonIconSizePct = normalizeButtonIconSizePct(patch.buttonIconSizePct, nextSettings.buttonIconSizePct);
      clean.settings = nextSettings;
    }
    this.projects.update(p.id, clean);
    return this.get(p.id);
  }

  /**
   * Saves project metadata & per-project settings (`Save Project` menu action).
   */
  saveProject(id, patch = {}, { actor = null } = {}) {
    const current = this.get(id).settings?.prefix;
    if (patch.settings && patch.settings.prefix !== undefined && current && patch.settings.prefix !== current) {
      throw new ValidationError('The project prefix is set once when the project is created and cannot be changed');
    }
    const p = this.update(id, {
      ...patch,
      settings: {
        ...(this.get(id).settings || {}),
        ...(patch.settings && typeof patch.settings === 'object' ? patch.settings : {}),
        lastSavedAt: new Date().toISOString()
      }
    }, { actor });
    if (patch.applyToButtons || patch.applyButtonSettings) {
      return this.applyButtonSettings(p.id, {
        buttonStyle: p.settings.buttonStyle,
        buttonIconSizePct: p.settings.buttonIconSizePct,
        scope: patch.scope || 'all'
      }, { actor });
    }
    return { ...p, saved: true, project: p };
  }

  /**
   * Stores `buttonStyle` (default `'circle'`) and `buttonIconSizePct` (`50–100%`, default 95%) per project
   * and applies them to all buttons in the Buttons library.
   */
  applyButtonSettings(projectId, { buttonStyle, buttonIconSizePct, scope = 'all' } = {}, { actor = null } = {}) {
    const p = this.get(projectId || 1);
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) {
      throw new ForbiddenError('Only the project owner or admin can update project button settings');
    }
    // buttons of other projects are never restyled; the shared public library only by the superadmin
    const pubId = this.auth?.publicUserId?.() ?? null;
    const curator = !actor || this.auth?.isSuperadmin?.(actor);
    const styleKey = normalizeButtonStyleKey(buttonStyle ?? p.settings?.buttonStyle, 'circle');
    const pct = normalizeButtonIconSizePct(buttonIconSizePct ?? p.settings?.buttonIconSizePct, DEFAULT_PROJECT_BUTTON_SETTINGS.buttonIconSizePct);
    const nextSettings = {
      ...(p.settings || {}),
      buttonStyle: styleKey,
      buttonIconSizePct: pct
    };

    return this.transaction(() => {
      this.projects.update(p.id, { settings: nextSettings });
      let updatedCount = 0;
      const btnRepo = this.designs?.button || this.services?.button?.designs;
      const nodeRepo = this.nodes || this.services?.button?.nodes;
      if (btnRepo && nodeRepo) {
        const allButtons = btnRepo.list({ projectId: p.id, includePublic: scope !== 'project', includePrivate: true, actorId: actor?.id ?? fallbackOwnerId(this) });
        for (const b of allButtons) {
          const foreign = Number(b.projectId ?? 1) !== Number(p.id);
          if (foreign && (scope === 'project' || !curator)) continue;   // `scope: 'all'` reaches the shared library for the superadmin only
          if (!curator && pubId != null && Number(b.creatorId) === Number(pubId)) continue;
          if (isButtonStyleFrame(b) || isDesignButtonTemplate(b)) continue;   // per-style frames and design-style templates keep their own style
          const curNodes = nodeRepo.listByOwner('button', b.id);
          const nextNodes = applyButtonStyleAndIconSizeToNodes(curNodes, {
            width: b.width,
            height: b.height,
            buttonStyle: styleKey,
            buttonIconSizePct: pct
          });
          nodeRepo.replaceAll('button', b.id, nextNodes);
          btnRepo.update(b.id, {
            meta: {
              ...(b.meta || {}),
              shape: styleKey,
              buttonStyle: styleKey,
              buttonIconSizePct: pct
            }
          });
          updatedCount++;
        }
      }
      const updatedProject = this.get(p.id);
      return {
        ...updatedProject,
        saved: true,
        projectId: p.id,
        buttonStyle: styleKey,
        buttonIconSizePct: pct,
        updatedCount,
        styles: BUTTON_STYLES,
        project: updatedProject
      };
    });
  }

  /**
   * Clones a project (`Clone Project` menu action), copying its per-project settings (`buttonStyle`, `buttonIconSizePct`)
   * and all project-scoped designs (`paths`, `icons`, `buttons`, `elements`, `screens`, `workflows`) into the new project.
   */
  clone(id, input = {}, { actor = null } = {}) {
    const src = this.get(id);
    return this.transaction(() => this.#cloneInto(src, input, actor));   // project and copied items: all or nothing
  }

  #cloneInto(src, input, actor) {
    const cloneName = String(input.name || `${src.name} (Clone)`).trim();
    // a clone is a new project: it never inherits the prefix (they are unique), it needs its own
    const { prefix: _inherited, ...copiedSettings } = src.settings || {};
    const created = this.create({
      name: cloneName,
      key: input.key,
      ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
      label: input.label || cloneName,
      description: input.description !== undefined ? input.description : src.description,
      visibility: input.visibility || src.visibility || 'private',
      requireApproval: src.requireApproval,
      settings: copiedSettings
    }, { actor: actor || this.users.get(Number(src.ownerId)) });

    let copiedCount = 0;
    if (this.libraryTransfer) {
      const itemsToCopy = [];
      // the default project (id 1) also holds the public library: only its project-scoped items are copied
      for (const [t, repo] of this.#itemRepos()) {
        for (const id of repo.idsOfProject(src.id, { projectOnly: src.id === 1 })) itemsToCopy.push({ type: t, id });
      }
      if (itemsToCopy.length > 0) {
        const res = this.libraryTransfer.copyToProjects({
          items: itemsToCopy,
          projectIds: [created.id],
          visibility: 'project',
          actor: actor || { id: created.ownerId, role: 'admin' }
        });
        copiedCount = res.copiedCount || 0;
      }
    }
    const clonedProject = this.get(created.id);
    return {
      ...clonedProject,
      cloned: true,
      sourceProjectId: src.id,
      copiedCount,
      copiedItemsCount: copiedCount,
      project: clonedProject
    };
  }

  /** The repositories of everything a project owns: `[type, repository]` for the five design types and workflows. */
  #itemRepos() {
    return [...['path', 'icon', 'button', 'element', 'screen'].map(t => [t, this.designs?.[t]]), ['workflow', this.workflows]].filter(([, r]) => r);
  }

  /** Bulk-updates visibility ('public' | 'project') of all items belonging to a project. */
  setAllItemsVisibility(projectId, visibility, { actor = null } = {}) {
    if (!VISIBILITY_LEVELS.includes(visibility)) throw new ValidationError(`visibility must be one of ${VISIBILITY_LEVELS.join(', ')}`);
    const pid = Number(projectId);
    if (actor && !this.isOwnerOrAdmin(pid, actor)) throw new ForbiddenError('Only the project owner or admin can change the visibility of all its items');
    const pub = this.auth?.publicUserId?.() ?? null;
    if (visibility !== 'public' && pub != null) {
      const locked = this.#itemRepos().reduce((n, [, repo]) => n + repo.countPublicOf(pid, pub), 0);
      if (locked) throw new ValidationError(`${locked} item(s) of this project belong to the immutable public library and must stay public; clone them instead`);
    }
    this.transaction(() => {
      for (const [, repo] of this.#itemRepos()) repo.setProjectVisibility(pid, visibility);
    });
    return { projectId: pid, visibility, updated: true };
  }

  remove(id, { actor = null } = {}) {
    const p = this.get(id);
    if (p.id === 1) throw new ValidationError('The default project cannot be deleted');
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only the project owner or admin can delete this project');
    this.projects.delete(p.id);
    return { deleted: true, id: p.id };
  }

  /** Invites or adds a user to collaborate on a project. */
  inviteMember(projectId, { userId = null, usernameOrEmail = '', role = 'editor', status = 'accepted' } = {}, { actor = null } = {}) {
    const p = this.get(projectId);
    if (actor && !this.isOwnerOrAdmin(p.id, actor)) throw new ForbiddenError('Only project owner or admin can invite collaborators');
    if (!PROJECT_ROLES.includes(role)) throw new ValidationError(`Project role must be one of ${PROJECT_ROLES.join(', ')}`);
    const targetUser = userId ? this.users.get(Number(userId)) : this.users.getByUsernameOrEmail(usernameOrEmail);
    if (!targetUser) throw new NotFoundError('user', userId || usernameOrEmail);
    if (isSystemUser(targetUser)) throw new ValidationError(`System account "${targetUser.username}" cannot be invited to a project`);
    return this.projects.upsertMember({
      projectId: p.id,
      userId: targetUser.id,
      invitedBy: actor?.id ?? p.ownerId,
      role,
      status: ['accepted', 'pending', 'rejected', 'revoked'].includes(status) ? status : 'accepted'
    });
  }

  addCollaborator({ projectId, actorId = null, userId = null, usernameOrEmail = '', role = 'contributor', status = 'accepted' }) {
    this.inviteMember(projectId, { userId, usernameOrEmail, role, status }, { actor: actorId != null ? this.users.get(Number(actorId)) : null });
    return this.projects.members(Number(projectId));
  }

  updateMemberRole(projectId, userId, role, actor = null) {
    return this.inviteMember(projectId, { userId, role, status: 'accepted' }, { actor });
  }

  respondInvitation(projectId, userId, { accept = true } = {}) {
    const m = this.projects.getMember(projectId, userId);
    if (!m) throw new NotFoundError('project invitation', `${projectId}:${userId}`);
    return this.projects.upsertMember({
      projectId: Number(projectId),
      userId: Number(userId),
      invitedBy: m.invitedBy,
      role: m.role,
      status: accept ? 'accepted' : 'rejected'
    });
  }

  removeMember(projectId, userId, { actor = null } = {}) {
    const p = this.get(projectId);
    if (Number(userId) === p.ownerId) throw new ValidationError('Cannot remove the project owner');
    if (actor && !this.isOwnerOrAdmin(p.id, actor) && Number(actor.id) !== Number(userId)) {
      throw new ForbiddenError('Only project owner/admin can remove collaborators');
    }
    this.projects.removeMember(p.id, Number(userId));
    return { removed: true, projectId: p.id, userId: Number(userId) };
  }
}
