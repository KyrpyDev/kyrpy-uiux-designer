/** Routes of themes, workflows, settings and project export. */
export function miscRoutes(router, c) {
  router.get('/api/settings', () => c.settings.get());
  router.put('/api/settings', ({ body }) => c.settings.update(body));

  router.get('/api/themes', () => c.themes.list());
  router.post('/api/themes', ({ body }) => c.themes.create(body));
  router.get('/api/themes/:id', ({ params }) => c.themes.get(params.id));
  router.put('/api/themes/:id', ({ params, body }) => c.themes.update(params.id, body));
  router.delete('/api/themes/:id', ({ params }) => c.themes.remove(params.id));
  router.post('/api/themes/:id/clone', ({ params, body }) => c.themes.clone(params.id, body?.name));

  router.get('/api/workflows', ({ query, actor }) =>
    c.workflows.list({
      q: query.get('q') || '',
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      projectIds: query.get('projectIds') || null,
      visibility: query.get('visibility') || '',
      creatorId: query.get('creatorId') ? Number(query.get('creatorId')) : null,
      actorId: actor?.id ?? null,
      includePublic: query.get('includePublic') !== '0',
      includePrivate: query.get('includePrivate') !== '0'
    })
  );
  router.post('/api/workflows', ({ body, actor, projectId }) =>
    c.workflows.create({ ...body, projectId: body?.projectId ?? projectId ?? 1 }, { actor })
  );
  router.get('/api/workflows/:id', ({ params }) => c.workflows.get(params.id));
  router.get('/api/workflows/:id/lineage', ({ params }) => c.workflows.getLineage(params.id));
  router.put('/api/workflows/:id', ({ params, body, actor }) => c.workflows.update(params.id, body, { actor }));
  router.delete('/api/workflows/:id', ({ params, actor, query }) =>
    c.workflows.remove(params.id, { actor, permanent: query.get('permanent') === '1' })
  );
  router.post('/api/workflows/:id/restore', ({ params, body, actor }) => c.workflows.restore(params.id, body, { actor }));
  router.post('/api/workflows/:id/clone', ({ params, body, actor, projectId }) =>
    c.workflows.clone(params.id, body?.name || { ...(body || {}), projectId: body?.projectId ?? projectId }, { actor })
  );
  router.put('/api/workflows/:id/screens', ({ params, body, actor }) => c.workflows.placeScreen(params.id, body, { actor }));
  router.delete('/api/workflows/:id/screens/:sid', ({ params }) => c.workflows.removeScreen(params.id, params.sid));
  router.post('/api/workflows/:id/links', ({ params, body, actor }) => c.workflows.addLink(params.id, body, { actor }));
  router.put('/api/workflows/:id/links/:lid', ({ params, body, actor }) => c.workflows.updateLink(params.lid, body, { actor }));
  router.delete('/api/workflows/:id/links/:lid', ({ params }) => c.workflows.removeLink(params.lid));

  // project export: either returns the files (the browser writes them to a picked folder) or writes to a server-side folder
  router.post('/api/export/bundle', ({ body }) => c.exporter.buildBundle(body));
  // the whole project as one browsable html file (?download=1 sets Content-Disposition)
  router.get('/api/export/project.html', ({ query, projectId }) => {
    const pid = Number(query.get('projectId')) || projectId || 1;
    const proj = c.projects.get(pid);
    const f = c.exporter.buildProjectHtml({ projectId: pid, themeKeys: query.get('theme') ? [query.get('theme')] : undefined, title: proj?.name || 'Project', projectKey: proj?.key || 'project' });
    return { raw: f.content, contentType: f.contentType, filename: query.get('download') === '1' ? f.filename : null };
  });
  router.post('/api/export/folder', ({ body }) => {
    const { folder, ...options } = body;
    const result = c.exporter.exportToFolder(options, folder);
    c.settings.update({ exportFolder: folder });
    return result;
  });
}
