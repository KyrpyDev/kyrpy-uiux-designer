import {
  DEVICES,
  TYPES,
  PLURAL_TO_TYPE,
  MENU_LAYOUTS,
  MENU_KINDS,
  DEFAULT_MENU,
  USER_ROLES,
  PROJECT_ROLES,
  VISIBILITY_LEVELS,
  EVENT_TRIGGERS,
  CLICK_ACTIONS,
  TOOLBAR_POSITIONS
} from '../../../domain/entities.js';

const T = ':types(paths|icons|buttons|elements|screens)';

/** Routes of paths, icons, buttons, elements and screens: CRUD, nodes, animations, svg export, menus, import, lineage. */
export function designRoutes(router, c) {
  const svc = p => c.services[PLURAL_TO_TYPE[p.types]];

  router.get(`/api/${T}`, ({ params, query, actor }) =>
    svc(params).list({
      q: query.get('q') || '',
      category: query.get('category') || '',
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      projectIds: query.get('projectIds') || null,
      visibility: query.get('visibility') || '',
      creatorId: query.get('creatorId') ? Number(query.get('creatorId')) : null,
      actorId: actor?.id ?? null,
      includePublic: query.get('includePublic') !== '0',
      includePrivate: query.get('includePrivate') !== '0'
    })
  );
  router.get(`/api/${T}/categories`, ({ params }) => svc(params).categories());
  router.post(`/api/${T}`, ({ params, body, actor, projectId }) =>
    svc(params).create(
      { ...body, projectId: body?.projectId ?? projectId ?? 1 },
      { nodes: body?.nodes || [], actor }
    )
  );
  router.get(`/api/${T}/:id`, ({ params }) => {
    const rec = svc(params).get(params.id);
    if (PLURAL_TO_TYPE[params.types] === 'screen' && rec?.id) {
      return { ...rec, links: c.workflows.linksFromScreens([rec.id]) };
    }
    return rec;
  });
  router.get(`/api/${T}/:id/lineage`, ({ params }) => svc(params).getLineage(params.id));
  router.put(`/api/${T}/:id`, ({ params, body, actor }) => svc(params).update(params.id, body, { actor }));
  router.delete(`/api/${T}/:id`, ({ params, actor, query }) =>
    svc(params).remove(params.id, { actor, permanent: query.get('permanent') === '1' })
  );
  router.post(`/api/${T}/:id/restore`, ({ params, body, actor }) => svc(params).restore(params.id, body, { actor }));
  router.post(`/api/${T}/:id/clone`, ({ params, body, actor, projectId }) =>
    svc(params).clone(params.id, { ...(body || {}), projectId: body?.projectId ?? projectId }, { actor })
  );

  // nodes (the shapes / texts / groups / instances inside a design)
  router.put(`/api/${T}/:id/nodes`, ({ params, body, actor }) => svc(params).replaceNodes(params.id, body.nodes || [], { actor }));
  router.post(`/api/${T}/:id/nodes`, ({ params, body, actor }) => svc(params).addNode(params.id, body, { actor }));
  router.patch(`/api/${T}/:id/nodes/:eid`, ({ params, body, actor }) => svc(params).updateNode(params.eid, body, { actor }));
  router.delete(`/api/${T}/:id/nodes/:eid`, ({ params, actor }) => svc(params).removeNode(params.eid, { actor }));
  router.post(`/api/${T}/:id/nodes/:eid/duplicate`, ({ params, body, actor }) => svc(params).duplicateNode(params.eid, body || {}, { actor }));

  // animations
  router.post(`/api/${T}/:id/nodes/:eid/animations`, ({ params, body }) => svc(params).addAnimation(params.eid, body));
  router.put(`/api/${T}/:id/animations/:aid`, ({ params, body }) => svc(params).updateAnimation(params.aid, body));
  router.delete(`/api/${T}/:id/animations/:aid`, ({ params }) => svc(params).removeAnimation(params.aid));

  // standalone svg (animations included); ?download=1 sets Content-Disposition
  router.get(`/api/${T}/:id/svg`, ({ params, query }) => {
    const f = c.exporter.svgFile(PLURAL_TO_TYPE[params.types], params.id, {
      theme: query.get('theme') || undefined, animated: query.get('animated') !== '0', frame: query.get('frame') === '1',
      size: Number(query.get('size')) || 192
    });
    return { raw: f.content, contentType: f.contentType, filename: query.get('download') === '1' ? f.filename : null };
  });

  // button menus: nested items (popup / rotating)
  router.get('/api/buttons/:id/menu', ({ params }) => c.menus.get(params.id));
  router.put('/api/buttons/:id/menu/config', ({ params, body }) => c.menus.setConfig(params.id, body));
  router.post('/api/buttons/:id/menu/items', ({ params, body }) => c.menus.addItem(params.id, body));
  router.put('/api/buttons/:id/menu/items/:iid', ({ params, body }) => c.menus.updateItem(params.iid, body));
  router.delete('/api/buttons/:id/menu/items/:iid', ({ params }) => c.menus.removeItem(params.iid));

  router.get('/api/library', ({ query, actor }) => {
    const filter = {
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      projectIds: query.get('projectIds') || null,
      visibility: query.get('visibility') || '',
      creatorId: query.get('creatorId') ? Number(query.get('creatorId')) : null,
      actorId: actor?.id ?? null,
      includePublic: query.get('includePublic') !== '0',
      includePrivate: query.get('includePrivate') !== '0'
    };
    return {
      paths: c.services.path.listFull(filter),
      icons: c.services.icon.listFull(filter),
      buttons: c.services.button.listFull(filter),
      elements: c.services.element.listFull(filter),
      animations: c.animationList()
    };
  });
  router.get('/api/sprite', ({ query }) => ({ raw: c.render.sprite(query.get('theme') || c.settings.get().theme), contentType: 'image/svg+xml' }));
  router.get('/api/import/folders', () => ({ folders: c.svgImport.listSuggestedFolders() }));
  router.post('/api/import/svg', ({ body, actor, projectId }) =>
    c.svgImport.import({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor })
  );
  router.post('/api/import/folder', ({ body, actor, projectId }) =>
    c.svgImport.importFolder({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor })
  );
  router.post('/api/import/font', ({ body, actor, projectId }) =>
    c.svgImport.importFont({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor })
  );

  router.get('/api/catalog/search', ({ query }) => {
    const q = query.get('q') || '';
    const projectId = query.get('projectId') ? Number(query.get('projectId')) : null;
    return Object.fromEntries(Object.entries(TYPES).map(([t, v]) => [v.plural, c.services[t].list({ q, projectId })]));
  });

  router.get('/api/bootstrap', ({ actor, token, projectId }) => {
    const activeProjId = projectId || 1;
    const customDevices = c.templates ? c.templates.listDevices({ projectId: activeProjId }) : DEVICES;
    const buttonTemplates = c.templates ? c.templates.listButtonTemplates({ projectId: activeProjId }) : [];
    const projects = c.projects ? c.projects.list({ userId: actor?.id }) : [];
    const pendingChangesCount = c.collaboration ? c.collaboration.pendingCount(null) : 0;
    const authConfig = c.auth ? c.auth.getAuthConfig() : { appMode: 'dev', bypassLogin: true, requireAuth: false };
    return {
      settings: c.settings.get(),
      themes: c.themes.list(),
      devices: customDevices.length ? customDevices : DEVICES,
      templateDevices: customDevices,
      templateButtons: buttonTemplates,
      types: TYPES,
      menu: { defaults: DEFAULT_MENU, layouts: MENU_LAYOUTS, kinds: MENU_KINDS },
      user: actor,
      currentUser: actor,
      authenticated: Boolean(token && actor),
      authConfig,
      projects,
      activeProjectId: activeProjId,
      pendingChangesCount,
      syncStatus: c.pgSync ? c.pgSync.status() : { enabled: false },
      userRoles: USER_ROLES,
      projectRoles: PROJECT_ROLES,
      visibilityLevels: VISIBILITY_LEVELS,
      eventTriggers: EVENT_TRIGGERS,
      eventActions: CLICK_ACTIONS,
      toolbarPositions: TOOLBAR_POSITIONS,
      counts: {
        ...Object.fromEntries(Object.entries(TYPES).map(([t, v]) => [v.plural, c.services[t].list().length])),
        workflows: c.workflows.list().length,
        projects: projects.length,
        users: c.auth ? c.auth.listUsers().length : 1,
        pendingChanges: pendingChangesCount,
        trash: c.trash ? c.trash.count() : 0
      },
      trashCount: c.trash ? c.trash.count() : 0
    };
  });
}
