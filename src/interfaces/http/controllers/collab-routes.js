/**
 * Routes for User Management, Auth, Role ACL, Projects, Collaborator Invitations,
 * Change Request Approval/Rejection, Editable Templates (Devices & Buttons),
 * Translations, and Offline-First PostgreSQL Synchronization.
 */
import { USER_ROLES, PROJECT_ROLES, VISIBILITY_LEVELS, EVENT_TRIGGERS, CLICK_ACTIONS, TOOLBAR_POSITIONS } from '../../../domain/entities.js';

export function collabRoutes(router, c) {
  // ---- Auth & Session ----
  router.get('/api/auth/config', () => c.auth.getAuthConfig());
  router.post('/api/auth/dev-bypass', () => c.auth.devBypassLogin());
  router.post('/api/auth/login', ({ body }) => c.auth.login(body));
  router.post('/api/auth/register', ({ body }) => c.auth.register(body));
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
  router.get('/api/users', () => c.auth.listUsers());
  router.post('/api/users', ({ body, actor }) => c.auth.createUser(body, actor));
  router.put('/api/users/:id', ({ params, body, actor }) => c.auth.updateUser(Number(params.id), body, actor));
  router.delete('/api/users/:id', ({ params, actor }) => c.auth.removeUser(Number(params.id), actor));
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
    c.projects.list({
      userId: query.get('userId') ? Number(query.get('userId')) : actor?.id,
      includePublic: query.get('includePublic') !== '0',
      q: query.get('q') || ''
    })
  );
  router.post('/api/projects', ({ body, actor }) => c.projects.create(body, actor));
  router.get('/api/projects/:id', ({ params }) => c.projects.get(params.id));
  router.put('/api/projects/:id', ({ params, body, actor }) => c.projects.update(params.id, body, actor));
  router.delete('/api/projects/:id', ({ params, actor }) => c.projects.remove(params.id, actor));
  router.post('/api/projects/:id/visibility', ({ params, body, actor }) =>
    c.projects.setAllItemsVisibility(params.id, body?.visibility || 'public', actor)
  );
  router.post('/api/projects/:id/members', ({ params, body, actor }) =>
    c.projects.inviteMember(params.id, body, actor)
  );
  router.put('/api/projects/:id/members/:uid', ({ params, body, actor }) =>
    c.projects.updateMemberRole(params.id, Number(params.uid), body?.role, actor)
  );
  router.delete('/api/projects/:id/members/:uid', ({ params, actor }) =>
    c.projects.removeMember(params.id, Number(params.uid), actor)
  );

  // ---- Collaborative Change List (Owner Approve / Reject) ----
  router.get('/api/changes', ({ query }) =>
    c.collaboration.list({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      status: query.get('status') || '',
      targetType: query.get('targetType') || '',
      targetId: query.get('targetId') ? Number(query.get('targetId')) : null,
      authorId: query.get('authorId') ? Number(query.get('authorId')) : null
    })
  );
  router.get('/api/changes/:id', ({ params }) => c.collaboration.get(Number(params.id)));
  router.post('/api/changes', ({ body, actor }) => c.collaboration.recordChange({ ...body, actor }));
  router.post('/api/changes/:id/approve', ({ params, body, actor }) =>
    c.collaboration.approve(Number(params.id), { reviewer: actor, comment: body?.comment || '' })
  );
  router.post('/api/changes/:id/reject', ({ params, body, actor }) =>
    c.collaboration.reject(Number(params.id), { reviewer: actor, comment: body?.comment || '' })
  );

  // ---- Editable Template Devices & Button Types ----
  router.get('/api/templates/devices', ({ query, projectId }) =>
    c.templates.listDevices({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : projectId
    })
  );
  router.post('/api/templates/devices', ({ body, actor }) => c.templates.saveDevice(body, actor));
  router.put('/api/templates/devices/:id', ({ params, body, actor }) =>
    c.templates.saveDevice({ ...body, id: Number(params.id) }, actor)
  );
  router.delete('/api/templates/devices/:id', ({ params }) => c.templates.removeDevice(Number(params.id)));

  router.get('/api/templates/buttons', ({ query, projectId }) =>
    c.templates.listButtonTemplates({
      projectId: query.get('projectId') ? Number(query.get('projectId')) : projectId
    })
  );
  router.post('/api/templates/buttons', ({ body, actor }) => c.templates.saveButtonTemplate(body, actor));
  router.put('/api/templates/buttons/:id', ({ params, body, actor }) =>
    c.templates.saveButtonTemplate({ ...body, id: Number(params.id) }, actor)
  );
  router.delete('/api/templates/buttons/:id', ({ params }) => c.templates.removeButtonTemplate(Number(params.id)));
  router.post('/api/templates/buttons/:id/instantiate', ({ params, body, actor }) =>
    c.templates.instantiateButtonFromTemplate(params.id, body || {}, actor)
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
  router.delete('/api/translations/:id', ({ params }) => c.translations.remove(Number(params.id)));
  router.get('/api/translations/languages', () => c.translations.languages());

  // ---- Offline-First PostgreSQL Sync (kyrpy-uiux-designer-db) ----
  router.get('/api/sync/status', () => c.pgSync.status());
  router.post('/api/sync/now', ({ body }) => c.pgSync.syncNow({ pull: body?.pull !== false, forceFullPush: Boolean(body?.forceFullPush) }));
  router.post('/api/sync/push', ({ body }) => c.pgSync.pushAll({ forceFull: Boolean(body?.forceFull) }));
  router.post('/api/sync/pull', () => c.pgSync.pullFromPostgres());

  // ---- Trash Management (Restore, Purge, Empty) ----
  router.get('/api/trash', ({ query }) =>
    c.trash.list({
      itemType: query.get('itemType') || query.get('type') || '',
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      visibility: query.get('visibility') || '',
      q: query.get('q') || ''
    })
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
  router.post('/api/library/save-to-targets', ({ body, actor }) =>
    c.libraryTransfer.saveAsToTargets({ ...(body || {}), actor })
  );
  router.post('/api/projects/:id/empty-library', ({ params, body, actor }) =>
    c.libraryTransfer.emptyProjectLibrary({
      projectId: Number(params.id),
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
