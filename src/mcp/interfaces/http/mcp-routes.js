/**
 * Designer-side REST routes of the MCP layer (session-authenticated, used by the web UI).
 * API keys themselves are only accepted by the MCP endpoint (M2), never by these routes.
 */
export function mcpRoutes(router, c) {
  const keys = c.mcp.apiKeys;

  // Profile → AI Access Keys
  router.get('/api/me/api-keys', ({ actor }) => keys.listMine(actor));
  router.post('/api/me/api-keys', ({ body, actor, ip }) => keys.create(body || {}, actor, { ip }));
  router.post('/api/me/api-keys/:id/rotate', ({ params, body, actor, ip }) =>
    keys.rotate(Number(params.id), actor, { ip, expiresInDays: body?.expiresInDays }));
  router.delete('/api/me/api-keys/:id', ({ params, actor, ip }) => keys.revoke(Number(params.id), actor, { ip }));
  router.get('/api/me/api-keys/:id/audit', ({ params, query, actor }) =>
    keys.auditLog({ apiKeyId: Number(params.id), limit: query.get('limit') }, actor));

  // Project → AI (owner or admin)
  router.get('/api/projects/:id/api-keys', ({ params, actor }) => keys.listForProject(Number(params.id), actor));
  router.post('/api/projects/:id/api-keys/revoke-all', ({ params, actor, ip }) => keys.revokeAllForProject(Number(params.id), actor, { ip }));
  router.get('/api/projects/:id/ai-settings', ({ params, actor }) => keys.getAiSettings(Number(params.id), actor));
  router.put('/api/projects/:id/ai-settings', ({ params, body, actor, ip }) => keys.updateAiSettings(Number(params.id), body || {}, actor, { ip }));
  router.get('/api/projects/:id/ai-audit', ({ params, query, actor }) =>
    keys.auditLog({ projectId: Number(params.id), limit: query.get('limit') }, actor));

  // Admin: every key in the system
  router.get('/api/admin/api-keys', ({ actor }) => keys.listAll(actor));

  // AI pack templates (M3): preview, project overrides (owner/admin), global edits (admin)
  if (c.mcp.aiPack) {
    const pack = c.mcp.aiPack;
    router.get('/api/projects/:id/ai-pack', ({ params, query, actor, baseUrl }) => pack.preview(Number(params.id), query.get('platform') || 'claude', actor, { baseUrl }));
    router.get('/api/projects/:id/ai-artifacts', ({ params, actor }) => pack.listTemplates(Number(params.id), actor));
    router.put('/api/projects/:id/ai-artifacts/:kind', ({ params, body, actor }) => pack.setOverride(Number(params.id), params.kind, body?.template, actor));
    router.delete('/api/projects/:id/ai-artifacts/:kind', ({ params, actor }) => pack.clearOverride(Number(params.id), params.kind, actor));
    router.put('/api/admin/ai-artifacts/:kind', ({ params, body, actor }) => pack.setGlobal(params.kind, body?.template, actor));
  }

  // Versions + AI changesets (M4): members read, owner/admin review. API keys never reach these routes.
  if (c.mcp.versions && c.mcp.changesets) {
    const { versions, changesets } = c.mcp;
    router.get('/api/projects/:id/versions', ({ params, actor }) => versions.listForActor(Number(params.id), actor));
    router.post('/api/projects/:id/versions', ({ params, body, actor }) => versions.snapshotForActor(Number(params.id), body || {}, actor));
    router.get('/api/projects/:id/versions/:number', ({ params, actor }) => versions.getForActor(Number(params.id), Number(params.number), actor));
    router.get('/api/projects/:id/changesets', ({ params, query, actor }) => changesets.listForActor(Number(params.id), actor, { status: query.get('status') || '' }));
    router.get('/api/changesets/:uid', ({ params, actor }) => changesets.getForActor(params.uid, actor));
    router.get('/api/changesets/:uid/ops/:op/preview', ({ params, query, actor }) => changesets.preview(params.uid, params.op, actor, { style: query.get('style') || '' }));
    router.post('/api/changesets/:uid/review', ({ params, body, actor }) => changesets.review(params.uid, {
      approve: Array.isArray(body?.approve) ? body.approve.map(String) : [], reject: Array.isArray(body?.reject) ? body.reject.map(String) : [], comment: body?.comment || ''
    }, actor));
  }

  // Item requests (M5): members see the inbox and may fulfil by hand or reject
  if (c.mcp.requests) {
    const rq = c.mcp.requests;
    router.get('/api/projects/:id/item-requests', ({ params, query, actor }) => rq.listForActor(Number(params.id), actor, { status: query.get('status') || '' }));
    router.post('/api/item-requests/:uid/fulfill', ({ params, body, actor }) => rq.fulfillByHand(params.uid, { type: body?.type, ref: body?.ref }, actor));
    router.post('/api/item-requests/:uid/reject', ({ params, body, actor }) => rq.rejectByHand(params.uid, { note: body?.note || '' }, actor));
  }
  // Project scope: clone every used foreign item into the project (also done automatically on versioning)
  if (c.mcp.library && c.mcp.versions) {
    router.post('/api/projects/:id/adopt-dependencies', ({ params, actor }) => {
      c.mcp.versions.listForActor(Number(params.id), actor);   // membership check (and records the head)
      return { adopted: c.mcp.library.adoptAll(Number(params.id)) };
    });
  }
}
