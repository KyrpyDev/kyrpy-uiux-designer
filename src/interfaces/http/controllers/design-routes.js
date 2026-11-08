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
import { compactIconSummary } from '../../../domain/icon-summary.js';
import { createHash } from 'node:crypto';

const T = ':types(paths|icons|buttons|elements|screens)';

/** Routes of paths, icons, buttons, elements and screens: CRUD, nodes, animations, svg export, menus, import, lineage. */
export function designRoutes(router, c) {
  const svc = p => c.services[PLURAL_TO_TYPE[p.types]];

  // icon catalog for large libraries (registered before `/api/icons/:id`): paged search, full records and sprites by id
  const libFilter = (query, actor) => ({
    projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
    projectIds: query.get('projectIds') || null,
    visibility: query.get('visibility') || '',
    creatorId: query.get('creatorId') ? Number(query.get('creatorId')) : null,
    actorId: actor?.id ?? null,
    includePublic: query.get('includePublic') !== '0',
    includePrivate: query.get('includePrivate') !== '0'
  });
  router.get('/api/icons/search', ({ query, actor }) => c.iconCatalog.search({
    ...libFilter(query, actor),
    q: query.get('q') || '', category: query.get('category') || '', pack: query.get('pack') || '',
    offset: Number(query.get('offset')) || 0, limit: Number(query.get('limit')) || 200
  }));
  router.get('/api/icons/full', ({ query }) => ({ version: c.iconCatalog.version(), items: c.iconCatalog.full(query.get('ids')) }));
  const iconSprite = (themeKey, ids) => {
    const { svg, etag } = c.iconCatalog.sprite(themeKey || c.settings.get().theme, ids);
    return { raw: svg, contentType: 'image/svg+xml', etag, cacheControl: 'private, no-cache' };
  };
  router.get('/api/icons/sprite', ({ query }) => iconSprite(query.get('theme'), query.get('ids')));
  router.post('/api/icons/sprite', ({ body }) => iconSprite(body?.theme, body?.ids));

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
  // display order: { mode: front | back | forward | backward }
  router.post(`/api/${T}/:id/order`, ({ params, body, actor }) => svc(params).reorder(params.id, body?.mode, { actor }));
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
    const usedKeys = filter.projectId ? c.nodes.usedByProject(filter.projectId) : [];
    if (query.get('iconSummary') !== '1') {
      return {
        usedKeys,
        paths: c.services.path.listFull(filter),
        icons: c.services.icon.listFull(filter),
        buttons: c.services.button.listFull(filter),
        elements: c.services.element.listFull(filter),
        animations: c.animationList()
      };
    }
    // large-library mode: icons as compact summaries (domain/icon-summary.js; no nodes) except the ones the other library items draw;
    // `icons: null` when the client's `iconsSince` is still current (it keeps its cached list)
    // the version a client echoes back is only valid for the same actor and filter (it differs per user / visibility)
    const scope = createHash('sha1').update(JSON.stringify(filter)).digest('hex').slice(0, 10);
    const iconsVersion = `${c.iconCatalog.version()}~${scope}`;
    const paths = c.services.path.listFull(filter), buttons = c.services.button.listFull(filter), elements = c.services.element.listFull(filter);
    let icons = null;
    if (query.get('iconsSince') !== iconsVersion) {
      const used = new Set();
      for (const d of [...paths, ...buttons, ...elements]) {
        for (const n of d.nodes || []) if (n.refType === 'icon' && n.refId) used.add(n.refId);
        for (const m of d.menuItems || []) if (m.iconId) used.add(m.iconId);
      }
      const full = new Map(c.iconCatalog.full([...used], { max: Infinity }).map(i => [i.id, i.nodes]));
      icons = c.iconCatalog.summaries(filter).map(i => compactIconSummary(full.has(i.id) ? { ...i, nodes: full.get(i.id) } : i));
    }
    return { usedKeys, paths, icons, iconsVersion, iconSummary: true, buttons, elements, animations: c.animationList() };
  });
  router.get('/api/sprite', ({ query }) => ({ raw: c.render.sprite(query.get('theme') || c.settings.get().theme), contentType: 'image/svg+xml' }));
  // online icon sources (Iconify API): browse sets, search, preview, import one / many / a whole set (<= 10 000)
  router.get('/api/online/sources', () => ({ sources: c.onlineIcons.sources() }));
  router.get('/api/online/collections', async () => ({ collections: await c.onlineIcons.collections() }));
  router.get('/api/online/search', ({ query }) => c.onlineIcons.search({ q: query.get('q') || '', prefix: query.get('prefix') || '', start: query.get('start'), limit: query.get('limit') }));
  router.get('/api/online/svg', async ({ query }) => ({ raw: await c.onlineIcons.svg({ prefix: query.get('prefix'), name: query.get('name'), color: query.get('color') || '' }), contentType: 'image/svg+xml' }));
  router.post('/api/online/import', ({ body, actor, projectId }) => c.onlineIcons.importIcons({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor }));
  router.post('/api/online/import-set', ({ body, actor, projectId }) => c.onlineIcons.importSet({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor }));
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
      // owner of the immutable public library (system user `public`); only the superadmin edits its items directly
      publicUserId: typeof c.publicUserId === 'function' ? c.publicUserId() : (c.auth?.publicUserId?.() ?? null),
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
        users: c.auth ? c.auth.listUsers({ includeSystem: false }).length : 1,
        pendingChanges: pendingChangesCount,
        trash: c.trash ? c.trash.count({}, { actor }) : 0
      },
      trashCount: c.trash ? c.trash.count({}, { actor }) : 0
    };
  });
}
