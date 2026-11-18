/** Routes of Conceptual FlowCharts (CRUD, interactive ComfyUI graph ops, approval, reverse-engineering, UI materialization & project-definition export). */
export function flowchartRoutes(router, c) {
  if (!c.flowcharts) return;

  router.get('/api/flowcharts', ({ query, actor }) =>
    c.flowcharts.list({
      q: query.get('q') || '',
      domain: query.get('domain') || '',
      status: query.get('status') || '',
      projectId: query.get('projectId') ? Number(query.get('projectId')) : null,
      projectIds: query.get('projectIds') || null,
      visibility: query.get('visibility') || '',
      creatorId: query.get('creatorId') ? Number(query.get('creatorId')) : null,
      actorId: actor?.id ?? null,
      includePublic: query.get('includePublic') !== '0',
      includePrivate: query.get('includePrivate') !== '0'
    })
  );

  router.post('/api/flowcharts', ({ body, actor, projectId }) =>
    c.flowcharts.create({ ...(body || {}), projectId: body?.projectId ?? projectId ?? 1 }, { actor })
  );

  router.post('/api/flowcharts/reverse-engineer', ({ body, actor, projectId }) => {
    const payload = { ...(body || {}), projectId: body?.projectId ?? projectId ?? 1 };
    const mode = payload.mode || ((payload.screens || payload.endpoints || payload.steps || payload.rawText || payload.transitions) ? 'app-spec' : 'project');
    return mode === 'app-spec'
      ? c.flowcharts.reverseEngineerFromAppSpec(payload, { actor })
      : c.flowcharts.reverseEngineerFromProject(payload, { actor });
  });

  router.get('/api/flowcharts/:id', ({ params, query, actor }) =>
    c.flowcharts.assertCanRead(
      c.flowcharts.get(params.id, {
        includeMermaid: query.get('mermaid') === '1',
        includeValidation: query.get('validate') !== '0'
      }),
      actor
    )
  );

  router.get('/api/flowcharts/:id/lineage', ({ params }) => c.flowcharts.getLineage(params.id));

  router.put('/api/flowcharts/:id', ({ params, body, actor }) =>
    c.flowcharts.update(params.id, body || {}, { actor })
  );

  router.delete('/api/flowcharts/:id', ({ params, query, actor }) =>
    c.flowcharts.remove(params.id, { actor, permanent: query.get('permanent') === '1' })
  );

  router.post('/api/flowcharts/:id/clone', ({ params, body, actor, projectId }) =>
    c.flowcharts.clone(params.id, { ...(body || {}), projectId: body?.projectId ?? projectId }, { actor })
  );

  router.post('/api/flowcharts/:id/restore', ({ params, body, actor }) =>
    c.flowcharts.restore(params.id, body || {}, { actor })
  );

  router.post('/api/flowcharts/:id/ops', ({ params, body, actor }) =>
    c.flowcharts.applyOps(params.id, body?.ops ?? body, { actor })
  );

  router.post('/api/flowcharts/:id/status', ({ params, body, actor }) =>
    c.flowcharts.setStatus(params.id, body || {}, { actor })
  );

  router.post('/api/flowcharts/:id/materialize', ({ params, body, actor }) =>
    c.flowcharts.materializeToScreens(params.id, body || {}, { actor })
  );

  router.get('/api/projects/:id/project-definition', ({ params, query, actor }) => {
    const pid = Number(params.id) || 1;
    const format = query.get('format') || 'both';
    const onlyApproved = query.get('onlyApproved') === '1';
    const flowchartIds = query.get('flowchartIds')
      ? query.get('flowchartIds').split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const out = c.flowcharts.buildProjectDefinition({ projectId: pid, flowchartIds, onlyApproved, format }, { actor });
    if (query.get('download') === '1') {
      if (format === 'json') {
        return {
          raw: JSON.stringify(out.definition, null, 2),
          contentType: 'application/json; charset=utf-8',
          filename: out.filename
        };
      }
      return {
        raw: out.markdown,
        contentType: 'text/markdown; charset=utf-8',
        filename: out.filename
      };
    }
    return out;
  });
}
