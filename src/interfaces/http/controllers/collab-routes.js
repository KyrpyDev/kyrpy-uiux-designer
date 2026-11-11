/**
 * Routes for User Management, Auth, Role ACL, Projects, Collaborator Invitations,
 * Change Request Approval/Rejection, Editable Templates (Devices & Buttons),
 * Translations, and Offline-First PostgreSQL Synchronization.
 */
import { USER_ROLES, PROJECT_ROLES, VISIBILITY_LEVELS, EVENT_TRIGGERS, CLICK_ACTIONS, TOOLBAR_POSITIONS, BUTTON_STYLES } from '../../../domain/entities.js';
import { ForbiddenError } from '../../../domain/errors.js';
import { intId } from '../input.js';

export function collabRoutes(router, c) {
  // ---- Auth & Session ----
  router.get('/api/auth/config', () => c.auth.getAuthConfig());
  router.post('/api/auth/dev-bypass', () => c.auth.devBypassLogin());
  router.post('/api/auth/login', ({ body, ip }) => c.auth.loginAsync({ ...(body || {}), ip }));
  // self-registration: `designer` (or the read-only `viewer`); higher roles are given by an admin (POST /api/users)
  router.post('/api/auth/register', ({ body }) => c.auth.registerAsync({ ...(body || {}), role: body?.role === 'viewer' ? 'viewer' : 'designer' }));
  router.post('/api/auth/logout', ({ token, body }) => c.auth.logout(token || body?.token));
  router.get('/api/auth/me', ({ actor, token }) => ({
    user: actor,
    authenticated: Boolean(token && actor),
    authConfig: c.auth.getAuthConfig(),
    roles: USER_ROLES,
    projectRoles: PROJECT_ROLES,
    visibilityLevels: VISIBILITY_LEVELS
  }));

  // ---- Admin & User Management ----
  // admins get the full records; everyone else only what the member pickers need (no email, role detail or permissions)
  router.get('/api/users', ({ actor }) => c.auth.isAdmin(actor)
    ? c.auth.listUsers()
    : c.auth.listUsers().map(u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role })));
  router.post('/api/users', ({ body, actor }) => c.auth.createUserByAdminAsync(actor, body || {}));
  router.put('/api/users/:id', ({ params, body, actor, token }) => c.auth.updateUserAsync(intId(params.id, 'id'), body || {}, actor, { token }));
  router.delete('/api/users/:id', ({ params, actor }) => c.auth.deleteUser(actor, intId(params.id, 'id')));
  router.post('/api/users/:id/transfer-superadmin', ({ params, body, actor }) => c.auth.transferSuperadminAsync(actor, intId(params.id, 'id'), body || {}));
  router.get('/api/acl/matrix', () => ({
    systemRoles: USER_ROLES,
    projectRoles: PROJECT_ROLES,
    visibilityLevels: VISIBILITY_LEVELS,
    eventTriggers: EVENT_TRIGGERS,
    eventActions: CLICK_ACTIONS,
    toolbarPositions: TOOLBAR_POSITIONS
  }));

  // ---- Projects & Collaborator Sharing ----
  router.get('/api/projects', ({ query, actor }) =>
    c.projects.list({ user: actor, includePublic: query.get('includePublic') !== '0', q: query.get('q') || '' })
  );
  router.post('/api/projects', ({ body, actor }) => c.projects.create(body, { actor }));
  // a private project is visible to its owner, accepted members and admins only
  const readableProject = (id, actor) => {
    const p = c.projects.get(id);
    if (actor && c.projects.userRole(p.id, actor) == null) throw new ForbiddenError('This project is private');
    return p;
  };
  router.get('/api/projects/:id', ({ params, actor }) => readableProject(params.id, actor));
  router.put('/api/projects/:id', ({ params, body, actor }) => c.projects.update(params.id, body, { actor }));
  router.post('/api/projects/:id/save', ({ params, body, actor }) => c.projects.saveProject(params.id, body || {}, { actor }));
  router.post('/api/projects/:id/clone', ({ params, body, actor }) => c.projects.clone(params.id, body || {}, { actor }));
  router.get('/api/projects/:id/button-settings', ({ params, actor }) => {
    const p = readableProject(params.id, actor);
    return {
      projectId: p.id,
      buttonStyle: p.settings?.buttonStyle || 'circle',
      buttonIconSizePct: p.settings?.buttonIconSizePct ?? 95,
      styles: BUTTON_STYLES
    };
  });
  router.post('/api/projects/:id/button-settings', ({ params, body, actor }) =>
    c.projects.applyButtonSettings(params.id, body || {}, { actor })
  );
  router.delete('/api/projects/:id', ({ params, actor }) => c.projects.remove(params.id, { actor }));
  router.post('/api/projects/:id/visibility', ({ params, body, actor }) =>
    c.projects.setAllItemsVisibility(params.id, body?.visibility || 'public', { actor })
  );
  router.post('/api/projects/:id/members', ({ params, body, actor }) =>
    c.projects.inviteMember(params.id, body, { actor })
  );
  router.put('/api/projects/:id/members/:uid', ({ params, body, actor }) =>
    c.projects.updateMemberRole(params.id, intId(params.uid, 'uid'), body?.role, actor)
  );
  router.delete('/api/projects/:id/members/:uid', ({ params, actor }) =>
    c.projects.removeMember(params.id, intId(params.uid, 'uid'), { actor })
  );

  // ---- Collaborative Change List (Owner Approve / Reject) ----
  const changeFilter = query => ({
    projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
    status: query.get('status') || '',
    targetType: query.get('targetType') || '',
    targetId: query.get('targetId') ? Number(query.get('targetId')) : null,
    authorId: query.get('authorId') ? Number(query.get('authorId')) : null,
    q: query.get('q') || ''
  });
  // a change request is visible to its author, its reviewer (owner) and admins
  const ownChange = (ch, actor) => !actor || c.auth.isAdmin(actor) || Number(ch.authorId) === Number(actor.id) || Number(ch.ownerId) === Number(actor.id);
  router.get('/api/changes', ({ query, actor }) => {
    // lite=1: list view without the before/after snapshots (they can be ~100 KB each; open one change for them)
    const lite = query.get('lite') === '1';
    return (lite ? c.collaboration.listLite(changeFilter(query)) : c.collaboration.list(changeFilter(query))).filter(ch => ownChange(ch, actor));
  });
  // { pending, approved, rejected, all } for the status tab badges (honours the other filters)
  router.get('/api/changes/counts', ({ query }) => c.collaboration.counts(changeFilter(query)));
  // body: { ids: [..], action: 'approve'|'reject', comment } or { filter: { targetType, authorId, q, projectId }, action }
  router.post('/api/changes/bulk', ({ body, actor }) =>
    c.collaboration.bulkReview(body?.ids, body?.action, { actor, comment: body?.comment || '', filter: body?.filter || null })
  );
  router.get('/api/changes/:id', ({ params, actor }) => {
    const ch = c.collaboration.get(intId(params.id, 'id'));
    if (!ownChange(ch, actor)) throw new ForbiddenError('This change request belongs to other users');
    return ch;
  });
  router.post('/api/changes', ({ body, actor }) => c.collaboration.recordChange({ ...body, actor }));
  router.post('/api/changes/:id/approve', ({ params, body, actor }) =>
    c.collaboration.approve(intId(params.id, 'id'), { reviewer: actor, comment: body?.comment || '' })
  );
  router.post('/api/changes/:id/reject', ({ params, body, actor }) =>
    c.collaboration.reject(intId(params.id, 'id'), { reviewer: actor, comment: body?.comment || '', force: body?.force === true })
  );

  // ---- Editable Template Devices & Button Types ----
  router.get('/api/templates/devices', ({ query, projectId }) =>
    c.templates.listDevices({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : projectId
    })
  );
  router.post('/api/templates/devices', ({ body, actor }) => c.templates.saveDevice(body, actor));
  router.put('/api/templates/devices/:id', ({ params, body, actor }) =>
    c.templates.saveDevice({ ...body, id: intId(params.id, 'id') }, actor)
  );
  router.delete('/api/templates/devices/:id', ({ params, actor }) => { c.auth.assertAdmin(actor); return c.templates.deleteDevice(intId(params.id, 'id')); });

  router.get('/api/templates/buttons', ({ query, projectId }) =>
    c.templates.listButtonTemplates({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : projectId
    })
  );
  router.post('/api/templates/buttons', ({ body, actor }) => c.templates.saveButtonTemplate(body, actor));
  router.put('/api/templates/buttons/:id', ({ params, body, actor }) =>
    c.templates.saveButtonTemplate({ ...body, id: intId(params.id, 'id') }, actor)
  );
  router.delete('/api/templates/buttons/:id', ({ params, actor }) => { c.auth.assertAdmin(actor); return c.templates.removeButtonTemplate(intId(params.id, 'id')); });
  router.post('/api/templates/buttons/:id/instantiate', ({ params, body, actor }) =>
    c.templates.instantiateButton(params.id, { ...(body || {}), creatorId: actor?.id })
  );

  // ---- Translations ----
  router.get('/api/translations', ({ query, projectId }) =>
    c.translations.list({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : projectId,
      lang: query.get('lang') || '',
      itemType: query.get('itemType') || '',
      itemId: query.get('itemId') ? Number(query.get('itemId')) : null
    })
  );
  router.post('/api/translations', ({ body }) => c.translations.upsert(body));
  router.put('/api/translations', ({ body }) => c.translations.upsert(body));
  router.delete('/api/translations/:id', ({ params }) => c.translations.remove(intId(params.id, 'id')));
  router.get('/api/translations/languages', () => c.translations.languages());

  // ---- Offline-First PostgreSQL Sync (kyrpy-uiux-designer-db) ----
  // connection details (host, database, last error text) are for admins; everyone else gets the state only
  router.get('/api/sync/status', ({ actor }) => {
    const st = c.pgSync.status();
    if (c.auth.isAdmin(actor)) return st;
    const { host, port, database, postgresHost, postgresDatabase, lastError, ...rest } = st;
    return { ...rest, lastError: lastError ? 'sync error (ask an administrator)' : null };
  });
  // push / pull replace a whole database: admins only
  router.post('/api/sync/now', ({ body, actor }) => { c.auth.assertAdmin(actor); return c.pgSync.syncNowAsync({ force: body?.force === true }); });
  router.post('/api/sync/push', ({ body, actor }) => { c.auth.assertAdmin(actor); return c.pgSync.pushAllAsync({ force: body?.force === true }); });
  router.post('/api/sync/pull', ({ body, actor }) => { c.auth.assertAdmin(actor); return c.pgSync.pullFromPostgresAsync({ force: body?.force === true }); });

  // ---- Trash Management (Restore, Purge, Empty) ----
  router.get('/api/trash', ({ query, actor }) =>
    c.trash.list({
      itemType: query.get('itemType') || query.get('type') || '',
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      visibility: query.get('visibility') || '',
      q: query.get('q') || ''
    }, { actor })
  );
  router.post('/api/trash/:id/restore', ({ params, actor }) => c.trash.restore(params.id, { actor }));
  router.delete('/api/trash/:id', ({ params, actor }) => c.trash.purge(params.id, { actor }));
  router.delete('/api/trash', ({ query, body, actor }) =>
    c.trash.empty({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : (body?.projectId ?? null),
      itemType: query.get('itemType') || query.get('type') || body?.itemType || '',
      actor
    })
  );

  // ---- Copy / Move / Multi-Target Save to Projects (with Cascading Sub-Items) & Empty Project Private Library ----
  router.post('/api/library/copy-to-projects', ({ body, actor }) =>
    c.libraryTransfer.copyToProjects({ ...(body || {}), actor })
  );
  router.post('/api/library/move-to-projects', ({ body, actor }) =>
    c.libraryTransfer.moveToProjects({ ...(body || {}), actor })
  );
  router.post('/api/library/publish', ({ body, actor }) => c.collaboration.requestPublish({ type: body?.type, id: body?.id, actor }));
  router.post('/api/library/save-to-targets', ({ body, actor }) =>
    c.libraryTransfer.saveAsToTargets({ ...(body || {}), actor })
  );
  router.post('/api/projects/:id/empty-library', ({ params, body, actor }) =>
    c.libraryTransfer.emptyProjectLibrary({
      projectId: intId(params.id, 'id'),
      itemType: body?.itemType || body?.type || 'all',
      scope: body?.scope || 'project',
      includePublic: Boolean(body?.includePublic),
      actor
    })
  );
  router.post('/api/library/empty', ({ body, actor, projectId }) =>
    c.libraryTransfer.emptyProjectLibrary({
      projectId: body?.projectId ?? projectId,
      itemType: body?.itemType || body?.type || 'all',
      scope: body?.scope || 'project',
      includePublic: Boolean(body?.includePublic),
      actor
    })
  );

  // ---- Export & Import Library Items (paths, icons, buttons, elements, screens, workflows) in HTML, SVG, JSON ----
  router.post('/api/library/export-items', ({ body, projectId }) =>
    c.libraryTransfer.exportLibraryItems({
      items: body?.items || [],
      types: body?.types || [],
      format: body?.format || 'json',
      projectId: body?.projectId ?? projectId,
      visibility: body?.visibility || 'all',
      includeSubItems: body?.includeSubItems !== false
    })
  );
  router.post('/api/library/import-items', ({ body, actor, projectId }) =>
    c.libraryTransfer.importLibraryItems({
      format: body?.format || 'auto',
      content: body?.content || '',
      targetType: body?.targetType || body?.type || 'auto',
      projectId: body?.projectId ?? projectId ?? 1,
      visibility: body?.visibility || 'project',
      category: body?.category || 'imported',
      name: body?.name || '',
      actor
    })
  );
}
