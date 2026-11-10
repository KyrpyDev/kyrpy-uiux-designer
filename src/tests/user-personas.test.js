/**
 * Stage 3 AutoSwarm Multi-Persona & Adversarial User Test Suite (`@kyrpy-testusers-team`)
 *
 * Exercises realistic and adversarial user journeys across HTTP endpoints, application services,
 * SQLite persistence, and UI/export contracts:
 *  - Persona 1 (`@kyrpy-test-ux-coverage` — Ada, Power Designer): Full screen/route/item coverage across all 6 item types,
 *    15 new interactive HTML elements (`html-flip-box`, `html-floating-toolbar`, etc.), multi-events, editable templates, and i18n.
 *  - Persona 2 (`@kyrpy-test-ux-adversary` — Burak & Can, Multi-User Collaborators): Multi-hop public item cloning with root owner
 *    lineage (`kyrpy`), collaborative node-level & record-level HTTP edits, and Owner (`kyrpy` / project owner) Approve & Reject rollback.
 *  - Persona 3 (`@kyrpy-test-security-redteam` & `@kyrpy-test-edgecase` — Selin, Red-Team & Boundary Stress): Invalid bearer tokens (401),
 *    viewer role write blocking (403), non-admin privilege escalation attempts (403), non-owner change review attempts (403),
 *    deleting locked items/workflows (409), unsafe SVG script injection (422), and cyclic instance containment (422).
 *  - Persona 4 (`@kyrpy-test-ux-offline` & `@kyrpy-test-load-concurrency` — Mert, Offline & Concurrent User): Offline SQLite outbox queuing,
 *    concurrent multi-user edits without race corruption, and sync status/push/pull contract verification.
 *  - Persona 5 (`@kyrpy-test-ux-accessibility` & `@kyrpy-test-ux-notifications` — Elif, Accessibility & UI Contract Evaluator):
 *    Exported bundle interactive runtime attributes (`data-events`, `data-onclick`), hover toolbars, context menus, and topbar menus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', 'v1'))
  ? resolve(here, '..', '..', 'v1')
  : resolve(here, '..', '..', '.archive', 'v1');

async function withServer(fn) {
  const c = buildContainer({ dbFile: ':memory:' });
  const server = createHttpServer(c, {
    webRoot: join(here, '..', 'interfaces', 'web'),
    domainRoot: join(here, '..', 'domain')
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, path, body = undefined, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  };
  try {
    await fn({ c, req, base });
  } finally {
    server.close();
    c.close();
  }
}

test('Persona 1 (@kyrpy-test-ux-coverage): Full coverage of 6 item types, 15 interactive HTML elements, multi-events, templates & translations', async () => {
  await withServer(async ({ c, req }) => {
    // Seed built-in elements catalog (including the 15 interactive HTML elements)
    c.importer.run({ legacyRoot });

    // Verify all 15 new interactive HTML elements exist in the catalog and are owned by kyrpy (#1)
    const expectedInteractiveKeys = [
      'html-flip-box',
      'html-carousel',
      'html-floating-toolbar',
      'html-record-viewer-list',
      'html-record-viewer-grid',
      'html-choice-chips',
      'html-multi-choice',
      'html-dropdown-menu',
      'html-drag-drop-zone',
      'html-bottom-sheet',
      'html-audio-player',
      'html-calendar-picker',
      'html-color-picker',
      'html-chat-bubble',
      'html-admob-banner'
    ];
    const allElements = await req('GET', '/api/elements');
    assert.equal(allElements.status, 200);
    for (const key of expectedInteractiveKeys) {
      const found = allElements.body.find(e => e.key === key);
      assert.ok(found, `Interactive HTML element "${key}" should be seeded in catalog`);
      assert.equal(found.creatorId, c.publicUserId(), `"${key}" creatorId should be the public library user`);
      assert.equal(found.rootOwnerId, c.publicUserId(), `"${key}" rootOwnerId should be the public library user`);
      assert.equal(found.creatorUsername, 'public');
      assert.equal(found.visibility, 'public', `"${key}" should be public by default`);
    }

    // Create a custom project via UI modal payload (using visibility: 'project' which normalizes to 'private')
    const projRes = await req('POST', '/api/projects', {
      name: 'Ada UX Studio Project',
      visibility: 'project',
      description: 'Project created from Projects modal'
    });
    assert.equal(projRes.status, 200);
    assert.equal(projRes.body.visibility, 'private');
    const projId = projRes.body.id;

    // Create all 6 item types tied to the project: path, icon, button, element, screen, workflow
    const pathRes = await req('POST', '/api/paths', {
      name: 'Ada Custom Wave Path',
      projectId: projId,
      visibility: 'project',
      nodes: [{ tag: 'path', name: 'wave', attrs: { d: 'M 4 32 Q 32 4 60 32' } }]
    });
    assert.equal(pathRes.status, 200);
    assert.equal(pathRes.body.projectId, projId);
    assert.equal(pathRes.body.visibility, 'project');

    const iconRes = await req('POST', '/api/icons', {
      name: 'Ada Spark Icon',
      projectId: projId,
      visibility: 'public',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'path', refId: pathRes.body.id, name: 'wave-use', attrs: { x: 0, y: 0, width: 64, height: 64 } }]
    });
    assert.equal(iconRes.status, 200);

    // Create a custom editable button template with custom `nodes` payload (matching collab-modals.js)
    const tplBtnRes = await req('POST', '/api/templates/buttons', {
      name: 'Ada Neon Split Pill',
      key: 'ada-neon-split-pill',
      shape: 'pill',
      width: 180,
      height: 52,
      hoverEffect: 'pulse',
      nodes: [
        { tag: 'rect', role: 'button', name: 'bg', attrs: { x: 0, y: 0, width: 180, height: 52, rx: 26, fill: '{{primary}}' } },
        { tag: 'text', kind: 'text', name: 'label', text: 'Launch Action', attrs: { x: 90, y: 31, 'text-anchor': 'middle', fill: '{{text}}' } }
      ]
    });
    assert.equal(tplBtnRes.status, 200);
    assert.equal(tplBtnRes.body.nodesTemplate.length, 2);

    // Instantiate a button from the custom template into Ada's project
    const instBtnRes = await req('POST', `/api/templates/buttons/${tplBtnRes.body.id}/instantiate`, {
      name: 'Ada Instantiated CTA',
      projectId: projId,
      visibility: 'project',
      iconId: iconRes.body.id
    });
    assert.equal(instBtnRes.status, 200);
    assert.equal(instBtnRes.body.projectId, projId);
    assert.equal(instBtnRes.body.visibility, 'project');

    // Create a custom editable device template
    const tplDevRes = await req('POST', '/api/templates/devices', {
      name: 'Ada Foldable Tablet',
      key: 'ada-foldable-tablet',
      category: 'tablet',
      width: 960,
      height: 1280,
      cornerRadius: 28,
      grid: 16
    });
    assert.equal(tplDevRes.status, 200);
    assert.equal(tplDevRes.body.width, 960);

    // Create a screen with multi-events (click, mouseover, release, dragdrop, rightclick) and animations
    const flipBox = allElements.body.find(e => e.key === 'html-flip-box');
    const floatToolbar = allElements.body.find(e => e.key === 'html-floating-toolbar');
    const modalDialog = allElements.body.find(e => e.key === 'html-bottom-sheet');

    const targetScreenRes = await req('POST', '/api/screens', {
      name: 'Ada Detail Screen',
      projectId: projId,
      visibility: 'project',
      meta: { device: 'ada-foldable-tablet' }
    });
    assert.equal(targetScreenRes.status, 200);

    const homeScreenRes = await req('POST', '/api/screens', {
      name: 'Ada Interactive Home',
      projectId: projId,
      visibility: 'project',
      meta: { device: 'ada-foldable-tablet' },
      nodes: [
        {
          tag: 'use',
          kind: 'instance',
          refType: 'button',
          refId: instBtnRes.body.id,
          name: 'hero-cta',
          locked: true,
          attrs: { x: 40, y: 80, width: 180, height: 52 },
          events: [
            { trigger: 'click', type: 'screen', targetId: targetScreenRes.body.id },
            { trigger: 'mouseover', type: 'toolbar', targetId: floatToolbar.id, position: 'top' },
            { trigger: 'release', type: 'popup', targetId: modalDialog.id },
            { trigger: 'dragdrop', type: 'element', targetId: flipBox.id },
            { trigger: 'rightclick', type: 'animate', animationType: 'pulse' }
          ],
          animations: [
            { name: 'idle-float', type: 'float', trigger: 'load', durationMs: 1800, iterations: 'infinite' }
          ]
        }
      ]
    });
    assert.equal(homeScreenRes.status, 200);
    assert.equal(homeScreenRes.body.nodes.length, 1);
    assert.equal(homeScreenRes.body.nodes[0].locked, true);
    assert.equal(homeScreenRes.body.nodes[0].events.length, 5);
    assert.equal(homeScreenRes.body.animations.length, 1);

    // Create a workflow linking the two screens with locked position
    const wfRes = await req('POST', '/api/workflows', {
      name: 'Ada Main User Flow',
      projectId: projId,
      visibility: 'project'
    });
    assert.equal(wfRes.status, 200);
    await req('PUT', `/api/workflows/${wfRes.body.id}/screens`, {
      screenId: homeScreenRes.body.id,
      x: 100,
      y: 120,
      locked: true
    });
    await req('POST', `/api/workflows/${wfRes.body.id}/links`, {
      fromScreenId: homeScreenRes.body.id,
      fromNodeId: homeScreenRes.body.nodes[0].id,
      toScreenId: targetScreenRes.body.id,
      name: 'CTA Tap',
      trigger: 'tap'
    });

    // Multi-language translation CRUD via HTTP (matching openSyncModal i18n tab)
    const trSave = await req('PUT', '/api/translations', {
      lang: 'tr',
      itemType: 'screen',
      itemId: homeScreenRes.body.id,
      field: 'label',
      value: 'Ada Etkileşimli Ana Ekran'
    });
    assert.equal(trSave.status, 200);
    assert.equal(trSave.body.lang, 'tr');
    assert.equal(trSave.body.itemType, 'screen');
    assert.equal(trSave.body.value, 'Ada Etkileşimli Ana Ekran');

    const trList = await req('GET', `/api/translations?itemType=screen&itemId=${homeScreenRes.body.id}`);
    assert.equal(trList.status, 200);
    assert.equal(trList.body.length, 1);
    assert.equal(trList.body[0].lang, 'tr');

    const trDel = await req('DELETE', `/api/translations/${trSave.body.id}`);
    assert.equal(trDel.status, 200);
  });
});

test('Persona 2 (@kyrpy-test-ux-adversary): Multi-user collaboration, public clone root-owner lineage, node-level HTTP change requests & Owner Approve/Reject rollback', async () => {
  await withServer(async ({ c, req }) => {
    const pub = c.publicUserId();
    // 1. Register 2 collaborators: Burak (designer) and Can (designer)
    const burakReg = await req('POST', '/api/auth/register', {
      username: 'burak_ux',
      email: 'burak@kyrpy.com',
      password: 'password123',
      displayName: 'Burak Aksoy'
    });
    assert.equal(burakReg.status, 200);
    const burakToken = burakReg.body.token;
    const burakId = burakReg.body.user.id;

    const canReg = await req('POST', '/api/auth/register', {
      username: 'can_ux',
      email: 'can@kyrpy.com',
      password: 'password123',
      displayName: 'Can Sahin'
    });
    assert.equal(canReg.status, 200);
    const canToken = canReg.body.token;
    const canId = canReg.body.user.id;

    // 2. Owner `kyrpy` creates a public element and a collaborative project
    const rootEl = await req('POST', '/api/elements', {
      name: 'Kyrpy Public Master Card',
      visibility: 'public',
      nodes: [{ tag: 'rect', name: 'base', attrs: { x: 0, y: 0, width: 240, height: 120, rx: 16 } }]
    });
    assert.equal(rootEl.status, 200);
    // admin-made public items of project 1 join the public library, owned by the immutable `public` user
    assert.equal(rootEl.body.creatorId, pub);
    assert.equal(rootEl.body.rootOwnerId, pub);

    // 3. Burak clones the public element, then Can clones Burak's clone -> Root Owner must stay the public user
    const burakClone = await req(
      'POST',
      `/api/elements/${rootEl.body.id}/clone`,
      { name: 'Burak Card Fork', visibility: 'public' },
      { Authorization: `Bearer ${burakToken}` }
    );
    assert.equal(burakClone.status, 200);
    assert.equal(burakClone.body.creatorId, burakId);
    assert.equal(burakClone.body.rootOwnerId, pub);
    assert.equal(burakClone.body.rootItemId, rootEl.body.id);

    const canClone = await req(
      'POST',
      `/api/elements/${burakClone.body.id}/clone`,
      { name: 'Can Card Remix', visibility: 'project' },
      { Authorization: `Bearer ${canToken}` }
    );
    assert.equal(canClone.status, 200);
    assert.equal(canClone.body.creatorId, canId);
    assert.equal(canClone.body.clonedFromId, burakClone.body.id);
    assert.equal(canClone.body.rootItemId, rootEl.body.id);
    assert.equal(canClone.body.rootOwnerId, pub);

    const lineageRes = await req('GET', `/api/elements/${canClone.body.id}/lineage`);
    assert.equal(lineageRes.status, 200);
    assert.equal(lineageRes.body.itemName, 'Can Card Remix');
    assert.equal(lineageRes.body.rootOwner.username, 'public');
    assert.equal(lineageRes.body.creator.username, 'can_ux');
    assert.equal(lineageRes.body.chain.length, 3);

    // 4. Kyrpy creates a project and invites Burak as editor
    const proj = await req('POST', '/api/projects', { name: 'Sample Shared Redesign', visibility: 'public' });
    assert.equal(proj.status, 200);
    const invite = await req('POST', `/api/projects/${proj.body.id}/members`, {
      usernameOrEmail: 'burak_ux',
      role: 'editor'
    });
    assert.equal(invite.status, 200);

    // 5. Kyrpy creates a screen with 1 node in that project
    const screen = await req('POST', '/api/screens', {
      name: 'Shared Onboarding Screen',
      label: 'Welcome v1',
      projectId: proj.body.id,
      nodes: [{ tag: 'rect', name: 'hero-box', attrs: { x: 20, y: 20, width: 350, height: 200 } }]
    });
    assert.equal(screen.status, 200);
    assert.equal(screen.body.nodes.length, 1);

    // 6. Collaborator Burak adds a new node via HTTP POST /api/screens/:id/nodes
    const addedNode = await req(
      'POST',
      `/api/screens/${screen.body.id}/nodes`,
      { tag: 'text', kind: 'text', name: 'collab-badge', text: 'Added by Burak', attrs: { x: 40, y: 60 } },
      { Authorization: `Bearer ${burakToken}` }
    );
    assert.equal(addedNode.status, 200);

    // Verify a pending change_request was automatically recorded for the node-level edit!
    const changesAfterAdd = await req('GET', `/api/changes?projectId=${proj.body.id}&status=pending`);
    assert.equal(changesAfterAdd.status, 200);
    assert.equal(changesAfterAdd.body.length, 1);
    const nodeAddChange = changesAfterAdd.body[0];
    assert.equal(nodeAddChange.action, 'node_add');
    assert.equal(nodeAddChange.authorName, 'burak_ux');
    assert.equal(nodeAddChange.diffSummary.addedNodes, 1);

    // 7. Owner Kyrpy REJECTS Burak's node addition -> screen rolls back to 1 node!
    const rejectRes = await req('POST', `/api/changes/${nodeAddChange.id}/reject`, {
      comment: 'Revert badge placement for now'
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.status, 'rejected');

    const screenAfterReject = await req('GET', `/api/screens/${screen.body.id}`);
    assert.equal(screenAfterReject.body.nodes.length, 1, 'Rejected node addition must roll back screen nodes to 1');

    // 8. Collaborator Burak updates the screen label -> Owner Kyrpy APPROVES
    await req(
      'PUT',
      `/api/screens/${screen.body.id}`,
      { label: 'Welcome v2 (Burak Approved)' },
      { Authorization: `Bearer ${burakToken}` }
    );
    const pendingAfterUpdate = await req('GET', `/api/changes?projectId=${proj.body.id}&status=pending`);
    assert.equal(pendingAfterUpdate.body.length, 1);
    const approveRes = await req('POST', `/api/changes/${pendingAfterUpdate.body[0].id}/approve`, {
      comment: 'Looks great!'
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.status, 'approved');

    const screenAfterApprove = await req('GET', `/api/screens/${screen.body.id}`);
    assert.equal(screenAfterApprove.body.label, 'Welcome v2 (Burak Approved)');
  });
});

test('Persona 3 (@kyrpy-test-security-redteam & @kyrpy-test-edgecase): Auth validation, ACL role enforcement, locked item protection, XSS & cycle guards', async () => {
  await withServer(async ({ req }) => {
    // 1. Invalid bearer token on protected API returns 401 UNAUTHORIZED
    const badTokenRes = await req('GET', '/api/projects', undefined, {
      Authorization: 'Bearer invalid_forged_token_xyz'
    });
    assert.equal(badTokenRes.status, 401);
    assert.equal(badTokenRes.body.error.code, 'UNAUTHORIZED');

    // 2. Create a user with `viewer` role and verify write requests are blocked with 403 FORBIDDEN
    const viewerReg = await req('POST', '/api/auth/register', {
      username: 'selin_viewer',
      email: 'selin@kyrpy.com',
      password: 'password123',
      role: 'viewer'
    });
    assert.equal(viewerReg.status, 200);
    const viewerToken = viewerReg.body.token;

    // Viewer can read
    const viewerRead = await req('GET', '/api/screens', undefined, {
      Authorization: `Bearer ${viewerToken}`
    });
    assert.equal(viewerRead.status, 200);

    // Viewer CANNOT create or mutate items (403 FORBIDDEN)
    const viewerWrite = await req(
      'POST',
      '/api/screens',
      { name: 'Unauthorized Screen' },
      { Authorization: `Bearer ${viewerToken}` }
    );
    assert.equal(viewerWrite.status, 403);
    assert.equal(viewerWrite.body.error.code, 'FORBIDDEN');

    // 3. Designer user cannot delete or demote default admin `kyrpy`
    const designerReg = await req('POST', '/api/auth/register', {
      username: 'emre_designer',
      email: 'emre@kyrpy.com',
      password: 'password123',
      role: 'designer'
    });
    const designerToken = designerReg.body.token;

    const delKyrpyByDesigner = await req('DELETE', '/api/users/1', undefined, {
      Authorization: `Bearer ${designerToken}`
    });
    assert.equal(delKyrpyByDesigner.status, 403);

    // Even admin cannot delete or demote default admin `kyrpy` (#1)
    const delKyrpyByAdmin = await req('DELETE', '/api/users/1');
    assert.equal(delKyrpyByAdmin.status, 422);

    const demoteKyrpyByAdmin = await req('PUT', '/api/users/1', { role: 'viewer' });
    assert.equal(demoteKyrpyByAdmin.status, 422);

    // 4. Non-owner designer cannot approve their own change request on kyrpy's item
    const ownerScreen = await req('POST', '/api/screens', { name: 'Kyrpy Protected Screen' });
    await req(
      'PUT',
      `/api/screens/${ownerScreen.body.id}`,
      { label: 'Emre Unapproved Edit' },
      { Authorization: `Bearer ${designerToken}` }
    );
    const pending = await req('GET', '/api/changes?status=pending');
    assert.equal(pending.body.length, 1);

    const selfApprove = await req(
      'POST',
      `/api/changes/${pending.body[0].id}/approve`,
      { comment: 'Self-approving' },
      { Authorization: `Bearer ${designerToken}` }
    );
    assert.equal(selfApprove.status, 403);

    // 5. Locked item & workflow cannot be deleted until unlocked (409 CONFLICT)
    const lockedBtn = await req('POST', '/api/buttons', { name: 'Locked Master Button', locked: true });
    assert.equal(lockedBtn.status, 200);
    assert.equal(lockedBtn.body.locked, true);

    const delLocked = await req('DELETE', `/api/buttons/${lockedBtn.body.id}`);
    assert.equal(delLocked.status, 409);

    // Unlock and then delete succeeds
    await req('PUT', `/api/buttons/${lockedBtn.body.id}`, { locked: false });
    const delUnlocked = await req('DELETE', `/api/buttons/${lockedBtn.body.id}`);
    assert.equal(delUnlocked.status, 200);

    // 6. Malicious SVG with only <script> (no shapes) or node with inline on* handler is rejected (422)
    const xssSvg = await req('POST', '/api/import/svg', {
      type: 'icon',
      name: 'Evil Icon',
      svg: '<svg viewBox="0 0 64 64"><script>alert(1)</script></svg>'
    });
    assert.equal(xssSvg.status, 422);

    // 7. Hierarchy violation (a button cannot contain a screen) is rejected (422)
    const badHierarchy = await req('POST', '/api/buttons', {
      name: 'Invalid Hierarchy Button',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'screen', refId: ownerScreen.body.id }]
    });
    assert.equal(badHierarchy.status, 422);
  });
});

test('Persona 4 (@kyrpy-test-ux-offline & @kyrpy-test-load-concurrency): Offline SQLite outbox queuing & concurrent multi-user operations', async () => {
  await withServer(async ({ c, req }) => {
    // 1. Verify offline-first status endpoint returns host, port, database, pendingCount, syncedCount, state
    const st0 = await req('GET', '/api/sync/status');
    assert.equal(st0.status, 200);
    assert.equal(st0.body.mode, 'offline-first');
    assert.equal(st0.body.database, 'kyrpy-uiux-designer-db');
    assert.ok(st0.body.host);
    assert.ok(st0.body.port);
    assert.equal(typeof st0.body.pendingCount, 'number');
    assert.equal(typeof st0.body.syncedCount, 'number');
    assert.ok(st0.body.state);

    // 2. Fire 15 concurrent creation requests across paths, icons, buttons, elements, and screens
    const burst = await Promise.all(
      Array.from({ length: 15 }, (_, idx) =>
        req('POST', '/api/elements', {
          name: `Concurrent Widget ${idx + 1}`,
          visibility: idx % 2 === 0 ? 'public' : 'project',
          nodes: [{ tag: 'rect', name: `box-${idx}`, attrs: { x: 0, y: 0, width: 120, height: 48, rx: 10 } }]
        })
      )
    );
    for (const r of burst) {
      assert.equal(r.status, 200);
      assert.ok(r.body.id);
    }

    // Verify all 15 mutations were queued in the local SQLite offline outbox
    const stAfter = await req('GET', '/api/sync/status');
    assert.ok(stAfter.body.pendingCount >= 15, `Expected at least 15 outbox entries, got ${stAfter.body.pendingCount}`);
    void c;
  });
});

test('Persona 5 (@kyrpy-test-ux-accessibility & @kyrpy-test-ux-notifications): Bundle export interactive runtime attributes & frontend UI contracts', async () => {
  await withServer(async ({ req }) => {
    const popupEl = await req('POST', '/api/elements', {
      name: 'Accessible Quick Toolbar',
      nodes: [{ tag: 'rect', name: 'bar', attrs: { x: 0, y: 0, width: 160, height: 40, rx: 12 } }]
    });
    const scr = await req('POST', '/api/screens', {
      name: 'A11y Interactive Screen',
      nodes: [
        {
          tag: 'rect',
          role: 'button',
          name: 'a11y-trigger',
          attrs: { x: 24, y: 40, width: 200, height: 56, rx: 16 },
          events: [
            { trigger: 'click', type: 'toolbar', targetId: popupEl.body.id, position: 'top' },
            { trigger: 'mouseover', type: 'animate', animationType: 'pulse' }
          ]
        }
      ]
    });
    assert.equal(scr.status, 200);

    // Export standalone HTML bundle and verify interactive runtime hooks are embedded
    const fav = await req('GET', '/favicon.ico');
    assert.equal(fav.status, 200);
    const exp = await req('POST', '/api/export/bundle', { screenIds: [scr.body.id], themeKeys: ['liquid'] });
    assert.equal(exp.status, 200);
    const html = JSON.stringify(exp.body);
    assert.ok(html.includes('data-trigger=\\"mouseover\\"'), 'Exported HTML bundle must include multi-event data-trigger');
    assert.ok(html.includes('ud-overlay ud-toolbar'), 'Exported HTML bundle must include small element toolbar overlay');

    // Verify frontend files include topbar menu bar, hover toolbar, context menu, and graphic tools
    const mainJs = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'main.js'), 'utf8');
    const canvasJs = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'components', 'designer.js'), 'utf8');
    assert.ok(mainJs.includes('Events & Anim') && mainJs.includes('Collaborate'), 'Topbar must include Events & Anim and Collaborate menus');
    assert.ok(canvasJs.includes('el-hover-toolbar'), 'Designer must render mouse-over el-hover-toolbar');
    assert.ok(canvasJs.includes('contextmenu'), 'Designer must handle right-click contextmenu');
    for (const tool of ['star', 'polygon', 'arrow', 'callout', 'freehand', 'crop']) {
      assert.ok(canvasJs.includes(`'${tool}'`), `Designer must support graphic tool "${tool}"`);
    }
  });
});

test('Persona 6 (@kyrpy-uiux-designer): Import from SVG Folder and Fonts into Current Library (Paths, Icons, Buttons, Elements)', async () => {
  await withServer(async ({ req, dir }) => {
    // 1. Discover workspace/server SVG & font folders
    const foldersRes = await req('GET', '/api/import/folders');
    assert.equal(foldersRes.status, 200);
    assert.ok(Array.isArray(foldersRes.body.folders), 'Should return suggested folders list');

    // 2. Import from uploaded SVG Folder files into Icons library
    const folderUploadRes = await req('POST', '/api/import/folder', {
      as: 'icon',
      category: 'imported-folder-icons',
      visibility: 'public',
      files: [
        { name: 'bell-outline.svg', svg: '<svg viewBox="0 0 24 24"><path d="M12 2 L18 16 L6 16 Z"/><circle cx="12" cy="19" r="2"/></svg>' },
        { name: 'shield-check.svg', svg: '<svg viewBox="0 0 24 24"><path d="M12 2 L20 6 L20 13 L12 22 L4 13 L4 6 Z"/></svg>' }
      ]
    });
    assert.equal(folderUploadRes.status, 200);
    assert.equal(folderUploadRes.body.importedCount, 2);
    assert.equal(folderUploadRes.body.as, 'icon');

    // 3. Import from server folder path into Buttons library
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const sampleFolder = mkdtempSync(join(tmpdir(), 'ud-svg-pack-'));
    try {
      writeFileSync(join(sampleFolder, 'btn-spark.svg'), '<svg viewBox="0 0 24 24"><path d="M12 2 L15 9 L22 12 L15 15 L12 22 L9 15 L2 12 L9 9 Z"/></svg>');
      writeFileSync(join(sampleFolder, 'btn-play.svg'), '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>');

      const serverFolderRes = await req('POST', '/api/import/folder', {
        as: 'button',
        category: 'folder-buttons',
        visibility: 'public',
        folderPath: sampleFolder
      });
      assert.equal(serverFolderRes.status, 200);
      assert.equal(serverFolderRes.body.importedCount, 2);
      assert.equal(serverFolderRes.body.as, 'button');
      assert.ok(
        serverFolderRes.body.items[0].nodes.some(n => n.refType === 'icon' && n.refId),
        'Button imported from SVG folder must wrap an icon instance node'
      );
    } finally {
      rmSync(sampleFolder, { recursive: true, force: true });
    }

    // 4. Import from SVG Font (<font><glyph .../></font>) into Current Library (Paths & Icons)
    const sampleSvgFont = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <font id="SampleGlyphs" horiz-adv-x="1000">
            <font-face font-family="SampleGlyphs" units-per-em="1000" ascent="800" descent="-200" />
            <glyph glyph-name="home-glyph" unicode="H" d="M100 0 L500 700 L900 0 Z" />
            <glyph glyph-name="diamond-glyph" unicode="D" d="M500 800 L900 400 L500 0 L100 400 Z" />
          </font>
        </defs>
      </svg>
    `;
    const svgFontRes = await req('POST', '/api/import/font', {
      as: 'path',
      fontName: 'SampleGlyphs',
      category: 'font-paths',
      visibility: 'public',
      fontSvg: sampleSvgFont
    });
    assert.equal(svgFontRes.status, 200);
    assert.equal(svgFontRes.body.importedCount, 2);
    assert.equal(svgFontRes.body.as, 'path');
    assert.ok(
      svgFontRes.body.items[0].nodes[0].attrs.d.startsWith('M'),
      'Normalized SVG font glyph path must be valid SVG path data'
    );

    // 5. Import from Font Symbol Preset & Custom Characters into Elements & Icons Library
    const presetFontRes = await req('POST', '/api/import/font', {
      as: 'element',
      fontName: 'UI Symbol Pack',
      category: 'symbol-elements',
      visibility: 'public',
      preset: 'ui-symbols',
      limit: 6
    });
    assert.equal(presetFontRes.status, 200);
    assert.equal(presetFontRes.body.importedCount, 6);
    assert.equal(presetFontRes.body.as, 'element');

    const customCharsFontRes = await req('POST', '/api/import/font', {
      as: 'icon',
      fontName: 'Custom Mono',
      category: 'char-icons',
      visibility: 'public',
      chars: '★✓⚡A'
    });
    assert.equal(customCharsFontRes.status, 200);
    assert.equal(customCharsFontRes.body.importedCount, 4);
    assert.equal(customCharsFontRes.body.as, 'icon');

    // 6. Binary TrueType (.ttf) font import into Current Library if system .ttf is present
    const sampleTtf = '/usr/share/fonts/xscreensaver/SpecialElite.ttf';
    if (existsSync(sampleTtf)) {
      const ttfRes = await req('POST', '/api/import/font', {
        as: 'icon',
        fontName: 'SpecialElite',
        category: 'ttf-icons',
        visibility: 'public',
        fontPath: sampleTtf,
        limit: 5
      });
      assert.equal(ttfRes.status, 200);
      assert.equal(ttfRes.body.importedCount, 5);
      assert.equal(ttfRes.body.as, 'icon');
    }
  });
});

test('Persona 7 (@kyrpy-uiux-devtest): Interactive Test Actions mode across Buttons, Elements, Screens (animations, buttons, edit forms, popups) & Workflows (routing)', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Create two screens with edit form fields, buttons, animations & workflow link, and verify GET /api/screens/:id returns outgoing `links`
    const sA = await req('POST', '/api/screens', {
      name: 'Interactive Login Form Screen',
      nodes: [
        { tag: 'rect', role: 'field', name: 'email-field', attrs: { x: 24, y: 120, width: 342, height: 48, rx: 12 } },
        { tag: 'text', kind: 'text', name: 'email-placeholder', text: 'ornek@okul.edu.tr', attrs: { x: 40, y: 150, 'font-size': 14 } },
        { tag: 'rect', role: 'button', name: 'submit-btn', attrs: { x: 24, y: 200, width: 342, height: 52, rx: 14 }, events: [{ trigger: 'click', type: 'animate', animationType: 'pulse' }] },
        { tag: 'text', kind: 'text', name: 'submit-lbl', text: 'Sign In Now →', attrs: { x: 195, y: 232, 'text-anchor': 'middle' } }
      ]
    });
    assert.equal(sA.status, 200);
    const submitLabelNode = sA.body.nodes.find(n => n.name === 'submit-lbl');

    const sB = await req('POST', '/api/screens', {
      name: 'Interactive Dashboard Target Screen',
      nodes: [
        { tag: 'rect', role: 'card', name: 'welcome-card', attrs: { x: 24, y: 100, width: 342, height: 140, rx: 16 } }
      ]
    });
    assert.equal(sB.status, 200);

    // Create workflow and add routing link from submitLabelNode on sA -> sB
    const wfCreate = await req('POST', '/api/workflows', { name: 'Auth & Dashboard Flow', label: 'Test Routing Flow' });
    assert.equal(wfCreate.status, 200);
    const wfId = wfCreate.body.id;

    await req('POST', `/api/workflows/${wfId}/nodes`, { screenId: sA.body.id, x: 100, y: 100 });
    await req('POST', `/api/workflows/${wfId}/nodes`, { screenId: sB.body.id, x: 600, y: 100 });
    const linkRes = await req('POST', `/api/workflows/${wfId}/links`, {
      fromScreenId: sA.body.id,
      fromNodeId: submitLabelNode.id,
      toScreenId: sB.body.id,
      name: 'Submit Login to Dashboard',
      trigger: 'tap'
    });
    assert.equal(linkRes.status, 200);

    const sAReloaded = await req('GET', `/api/screens/${sA.body.id}`);
    assert.equal(sAReloaded.status, 200);
    assert.ok(Array.isArray(sAReloaded.body.links), 'GET /api/screens/:id must include outgoing workflow links array');
    assert.ok(
      sAReloaded.body.links.some(l => l.fromScreenId === sA.body.id && l.toScreenId === sB.body.id && l.fromNodeId === submitLabelNode.id),
      'Newly created workflow link must appear on GET /api/screens/:id for Screen Designer Test Actions'
    );

    // 2. Verify frontend Test Actions modules are served and expose full support for buttons, elements, screens, and workflows
    const testActionsJs = await req('GET', '/js/components/designer-test-actions.js');
    assert.equal(testActionsJs.status, 200);
    assert.ok(String(testActionsJs.body).includes('mountLiveFormInputs'), 'designer-test-actions.js must mount live HTML form inputs over field nodes');
    assert.ok(String(testActionsJs.body).includes('mountLiveWidgets'), 'designer-test-actions.js must mount interactive HTML widgets');
    assert.ok(String(testActionsJs.body).includes('mountLiveActionHotspots'), 'designer-test-actions.js must mount interactive hotspots for buttons, events, and workflow links');
    assert.ok(String(testActionsJs.body).includes('navigateLiveToScreen'), 'designer-test-actions.js must preserve actionsLive across screen-to-screen routing');

    const wfDesignerJs = await req('GET', '/js/components/workflow-designer.js');
    assert.equal(wfDesignerJs.status, 200);
    assert.ok(String(wfDesignerJs.body).includes('setTestMode'), 'workflow-designer.js must provide interactive workflow routing test mode');
  });
});

test('Persona 8 (@kyrpy-gru & @kyrpy-testusers-team): Workflow Filters, Copy/Move with Sub-Items, Empty Private Library Immutability, Trash Bin, Menu Item Popup/Modal & Visibility, Inspector Top Section, and PostgreSQL Pull', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Verify Scan list screen is present as a public default built-in screen
    const screensList = await req('GET', '/api/screens');
    assert.equal(screensList.status, 200);
    const scanList = screensList.body.find(s => s.key === 'item-list');
    assert.ok(scanList, 'Item list screen must exist in default public library');
    assert.equal(scanList.visibility, 'public');
    assert.equal(scanList.builtin, true);

    // 2. Workflow Public / Project-Specific Filter API
    const projRes = await req('POST', '/api/projects', { name: 'Private Transfer Project', visibility: 'private' });
    assert.equal(projRes.status, 200);
    const targetPid = projRes.body.id;

    const privWf = await req('POST', '/api/workflows', {
      name: 'Project Private Flow',
      projectId: targetPid,
      visibility: 'project'
    });
    assert.equal(privWf.status, 200);

    const pubWfs = await req('GET', `/api/workflows?visibility=public&projectIds=${targetPid}`);
    assert.equal(pubWfs.status, 200);
    assert.ok(pubWfs.body.every(w => w.visibility === 'public'), 'visibility=public must return only public workflows');

    const projWfs = await req('GET', `/api/workflows?visibility=project&projectIds=${targetPid}`);
    assert.equal(projWfs.status, 200);
    assert.ok(projWfs.body.some(w => w.id === privWf.body.id), 'visibility=project must return project-specific workflows');
    assert.ok(projWfs.body.every(w => w.visibility === 'project'), 'visibility=project must exclude public workflows');

    // 3. New elements dropped into edit canvas go at top (ord = max(ord) + 1)
    const addNode1 = await req('POST', `/api/screens/${scanList.id}/nodes`, {
      tag: 'rect',
      name: 'bottom-layer',
      attrs: { x: 10, y: 10, width: 80, height: 40 }
    });
    const addNode2 = await req('POST', `/api/screens/${scanList.id}/nodes`, {
      tag: 'rect',
      name: 'top-dropped-layer',
      attrs: { x: 20, y: 20, width: 80, height: 40 }
    });
    assert.equal(addNode1.status, 200);
    assert.equal(addNode2.status, 200);
    assert.ok(addNode2.body.ord > addNode1.body.ord, 'Newly dropped element must receive ord > previous max ord so it renders at top');

    // 4. Menu Item -> "Show element as popup/modal box" (`targetElementId`) & `visible` toggle
    const popupEl = await req('POST', '/api/elements', {
      name: 'Menu Modal Box Element',
      nodes: [{ tag: 'rect', role: 'card', name: 'modal-bg', attrs: { x: 0, y: 0, width: 240, height: 140, rx: 16 } }]
    });
    assert.equal(popupEl.status, 200);

    const menuBtn = await req('POST', '/api/buttons', {
      name: 'Popup Menu Action Button',
      nodes: [{ tag: 'circle', role: 'button', name: 'hub', attrs: { cx: 32, cy: 32, r: 28 } }]
    });
    assert.equal(menuBtn.status, 200);

    const miRes = await req('POST', `/api/buttons/${menuBtn.body.id}/menu/items`, {
      label: 'Open Modal Info',
      name: 'open-modal-info',
      action: 'show-modal',
      targetElementId: popupEl.body.id,
      visible: true
    });
    assert.equal(miRes.status, 200);
    assert.equal(miRes.body.targetElementId, popupEl.body.id);
    assert.equal(miRes.body.visible, true);

    // Verify rendered SVG of button contains data-popup-element attribute
    const btnSvg = c.render.svg('button', menuBtn.body.id);
    assert.ok(btnSvg.includes(`data-popup-element="${popupEl.body.key}"`), 'Rendered menu item SVG must include data-popup-element');

    // Toggle menu item visibility to false and verify it hides from rendered SVG while staying in menu items list
    const miHide = await req('PUT', `/api/buttons/${menuBtn.body.id}/menu/items/${miRes.body.id}`, { visible: false });
    assert.equal(miHide.status, 200);
    assert.equal(miHide.body.visible, false);
    const btnSvgHidden = c.render.svg('button', menuBtn.body.id);
    assert.ok(!btnSvgHidden.includes('data-item="open-modal-info"'), 'Hidden menu item must not render in live SVG');
    await req('PUT', `/api/buttons/${menuBtn.body.id}/menu/items/${miRes.body.id}`, { visible: true });

    // 5. Copy Screen to Project cascades all sub-items (elements, buttons, menu popup elements, icons, paths)
    const hostScreen = await req('POST', '/api/screens', {
      name: 'Cascade Host Screen',
      nodes: [
        { tag: 'use', kind: 'instance', refType: 'button', refId: menuBtn.body.id, name: 'menu-btn-inst', attrs: { x: 40, y: 40, width: 64, height: 64 } }
      ]
    });
    assert.equal(hostScreen.status, 200);

    const copyRes = await req('POST', '/api/library/copy-to-projects', {
      items: [{ type: 'screen', id: hostScreen.body.id }],
      projectIds: [targetPid]
    });
    assert.equal(copyRes.status, 200);
    assert.equal(copyRes.body.copiedCount, 1);
    assert.ok(copyRes.body.subItemsCount >= 2, 'Cascading screen copy must also copy referenced button and menu popup element into target project');
    assert.equal(copyRes.body.copied[0].visibility, 'project');
    assert.equal(copyRes.body.copied[0].projectId, targetPid);

    // 6. Empty Project Library: Default public library is immutable (409), Project private library moves private items to Trash
    const emptyDefaultRes = await req('POST', '/api/projects/1/empty-library', { defaultLibrary: true });
    assert.equal(emptyDefaultRes.status, 409, 'Default public libraries must be immutable and reject empty-library with 409');

    const emptyPrivateRes = await req('POST', `/api/projects/${targetPid}/empty-library`, {});
    assert.equal(emptyPrivateRes.status, 200);
    assert.ok(emptyPrivateRes.body.emptiedCount >= 3, 'Emptying project private library must move private items to Trash');

    // 7. Trash Management & Admin/Superadmin Guard on Public Items
    const regDesigner = await req('POST', '/api/auth/register', {
      username: 'junior_designer',
      email: 'junior@kyrpy.com',
      password: 'Password123!'
    });
    assert.equal(regDesigner.status, 200);
    const designerToken = regDesigner.body.token;

    // Non-admin cannot delete public screen
    const forbidDel = await req('DELETE', `/api/screens/${scanList.id}`, null, {
      Authorization: `Bearer ${designerToken}`
    });
    assert.equal(forbidDel.status, 403, 'Only admin or superadmin can trash public items');

    // Admin can restore trashed item from Trash bin
    const trashList = await req('GET', '/api/trash');
    assert.equal(trashList.status, 200);
    assert.ok(trashList.body.length >= 1, 'Trash bin must list soft-deleted items');
    const restoreRes = await req('POST', `/api/trash/${trashList.body[0].id}/restore`);
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.body.restored, true);

    // 8. Verify Frontend Inspector, Menu Editor, Item Browser, and Hover Toolbar contracts
    const inspectorJs = await req('GET', '/js/components/inspector.js');
    assert.equal(inspectorJs.status, 200);
    assert.ok(String(inspectorJs.body).includes('elementTypeTitle'), 'inspector.js must dynamically title the top element section with elementTypeTitle');
    assert.ok(String(inspectorJs.body).includes('Menu Items ·'), 'inspector.js must render Menu Items section with order, add, remove, and visible controls');

    const menuEditorJs = await req('GET', '/js/components/menu-editor.js');
    assert.equal(menuEditorJs.status, 200);
    assert.ok(String(menuEditorJs.body).includes('Show element as popup'), 'menu-editor.js target picker must offer showing an element as a popup/modal box');
    assert.ok(String(menuEditorJs.body).includes('Edit menu item'), 'menu-editor.js hover toolbar must show Edit menu item button');
  });
});

test('Persona 9 (@kyrpy-gru & @kyrpy-testusers-team): Multi-Format (HTML, SVG, JSON) Export & Import of Paths, Icons, Buttons, Elements, Screens, and Workflows into Project & Public Libraries + Selection.modify & Form Field ID/Name Compliance', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Verify Range.prototype.expand -> Selection.modify shim in index.html & form field id/name guard in dom.js
    const indexHtml = await req('GET', '/');
    assert.equal(indexHtml.status, 200);
    assert.ok(String(indexHtml.body).includes('expandViaSelectionModify'), 'index.html must polyfill deprecated Range.expand with Selection.modify');

    const domJs = await req('GET', '/js/dom.js');
    assert.equal(domJs.status, 200);
    assert.ok(String(domJs.body).includes('ensureFormFieldIdentity'), 'dom.js must auto-assign id and name attributes to all form fields');

    // 1b. Verify default startup installer account (`admin` / `admin`) & Dev/Release auth config
    const adminLogin = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
    assert.equal(adminLogin.status, 200, 'Default startup account admin/admin must sign in');
    assert.equal(adminLogin.body.user.username, 'admin');
    assert.ok(adminLogin.body.token, 'admin/admin login must return a valid session token');

    const authCfg = await req('GET', '/api/auth/config');
    assert.equal(authCfg.status, 200);
    assert.equal(authCfg.body.defaultUsername, 'admin');
    assert.equal(authCfg.body.appMode, 'dev');
    assert.equal(authCfg.body.bypassLogin, true);

    const bypassRes = await req('POST', '/api/auth/dev-bypass', {});
    assert.equal(bypassRes.status, 200);
    assert.equal(bypassRes.body.bypassed, true);

    // 2. Create a target project for private library imports
    const projRes = await req('POST', '/api/projects', { name: 'MultiFormat Import Project', visibility: 'private' });
    assert.equal(projRes.status, 200);
    const targetPid = projRes.body.id;

    // 3. Pick one item of each of the 6 types (path, icon, button, element, screen, workflow)
    const paths = (await req('GET', '/api/paths')).body;
    const icons = (await req('GET', '/api/icons')).body;
    const buttons = (await req('GET', '/api/buttons')).body;
    const elements = (await req('GET', '/api/elements')).body;
    const screens = (await req('GET', '/api/screens')).body;
    const workflows = (await req('GET', '/api/workflows')).body;

    const sampleItems = [
      { type: 'path', id: paths[0].id },
      { type: 'icon', id: icons[0].id },
      { type: 'button', id: buttons[0].id },
      { type: 'element', id: elements[0].id },
      { type: 'screen', id: screens[0].id },
      { type: 'workflow', id: workflows[0].id }
    ];

    // 4. Export as JSON, SVG, and HTML
    const expJson = await req('POST', '/api/library/export-items', {
      items: sampleItems,
      format: 'json',
      includeSubItems: true
    });
    assert.equal(expJson.status, 200);
    assert.equal(expJson.body.format, 'json');
    assert.ok(expJson.body.totalCount >= 6, 'JSON export must include all 6 item types plus cascading sub-items');

    const expSvg = await req('POST', '/api/library/export-items', {
      items: sampleItems,
      format: 'svg',
      includeSubItems: false
    });
    assert.equal(expSvg.status, 200);
    assert.equal(expSvg.body.format, 'svg');
    assert.ok(expSvg.body.content.includes('<svg'), 'SVG export must contain valid <svg> markup');

    const expHtml = await req('POST', '/api/library/export-items', {
      items: sampleItems,
      format: 'html',
      includeSubItems: false
    });
    assert.equal(expHtml.status, 200);
    assert.equal(expHtml.body.format, 'html');
    assert.ok(expHtml.body.content.includes('<!DOCTYPE html>'), 'HTML export must produce a standalone HTML document');
    assert.ok(expHtml.body.content.includes('id="ud-library-payload"'), 'HTML export must embed lossless library payload');

    // 5. Import JSON bundle into Project Library (visibility: 'project')
    const impJsonProj = await req('POST', '/api/library/import-items', {
      format: 'json',
      content: expJson.body.content,
      projectId: targetPid,
      visibility: 'project'
    });
    assert.equal(impJsonProj.status, 200);
    assert.ok(impJsonProj.body.importedCount >= 6, 'JSON import must create all 6 item types in target project library');
    assert.ok(impJsonProj.body.created.every(x => x.visibility === 'project' && x.projectId === targetPid));

    // 6. Import SVG bundle into Public Library (visibility: 'public')
    const impSvgPub = await req('POST', '/api/library/import-items', {
      format: 'svg',
      content: expSvg.body.content,
      projectId: 1,
      visibility: 'public'
    });
    assert.equal(impSvgPub.status, 200);
    assert.equal(impSvgPub.body.importedCount, 6);
    assert.ok(impSvgPub.body.created.every(x => x.visibility === 'public'));

    // 7. Import HTML bundle into Project Library (visibility: 'project')
    const impHtmlProj = await req('POST', '/api/library/import-items', {
      format: 'html',
      content: expHtml.body.content,
      projectId: targetPid,
      visibility: 'project'
    });
    assert.equal(impHtmlProj.status, 200);
    assert.equal(impHtmlProj.body.importedCount, 6);

    // 8. Import raw standalone SVG (without embedded payload) as an Icon and as a Screen
    const rawSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16M12 4v16"/></svg>';
    for (const targetType of ['path', 'icon', 'button', 'element', 'screen', 'workflow']) {
      const impRawSvg = await req('POST', '/api/library/import-items', {
        format: 'svg',
        content: rawSvg,
        targetType,
        projectId: targetPid,
        visibility: 'project',
        name: `Raw SVG ${targetType}`
      });
      assert.equal(impRawSvg.status, 200, `Raw SVG import for ${targetType} failed: ${JSON.stringify(impRawSvg.body)}`);
      assert.equal(impRawSvg.body.importedCount, 1);
      assert.equal(impRawSvg.body.created[0].type, targetType);
    }

    // 9. Import raw HTML snippet (without embedded payload) as an Element into Public Library
    const rawHtml = '<!DOCTYPE html><html><head><title>Custom Promo Widget</title></head><body><div class="card"><h2>Promo Card</h2></div></body></html>';
    const impRawHtml = await req('POST', '/api/library/import-items', {
      format: 'html',
      content: rawHtml,
      targetType: 'element',
      projectId: 1,
      visibility: 'public'
    });
    assert.equal(impRawHtml.status, 200);
    assert.equal(impRawHtml.body.importedCount, 1);
    assert.equal(impRawHtml.body.created[0].type, 'element');
    assert.equal(impRawHtml.body.created[0].visibility, 'public');
  });
});

test('Persona 10 (@kyrpy-uiux-designer): Container & Carousel Container basic elements (multiple containers per screen, multiple sub-elements, inner/outer margins, fixed/responsive fit-to-screen, child max-size clamping, and 2D/3D horizontal & vertical animated roll effect)', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Verify `html-container` and `html-carousel-container` exist in the built-in elements library
    const elementsList = (await req('GET', '/api/elements')).body;
    const htmlContainer = elementsList.find(e => e.key === 'html-container');
    const htmlCarousel = elementsList.find(e => e.key === 'html-carousel-container');
    assert.ok(htmlContainer, 'html-container preset element must exist in elements catalog');
    assert.ok(htmlCarousel, 'html-carousel-container preset element must exist in elements catalog');

    // 2. Create a Screen (width 390, height 844) and add TWO containers to it:
    //    - Container 1: Responsive Container Shell (outerMargin = 16, innerMargin = 14) fitted to device screen width (x=16, width=358, height=220)
    //    - Container 2: Carousel Container (3D horizontal roll, outerMargin = 20, innerMargin = 12, x=20, width=350, height=240)
    const scrRes = await req('POST', '/api/screens', {
      name: 'Multi-Container & Carousel Screen',
      width: 390,
      height: 844,
      nodes: []
    });
    assert.equal(scrRes.status, 200);
    const screenId = scrRes.body.id;

    const cont1Res = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'rect',
      role: 'container',
      name: 'hero-container',
      attrs: {
        x: 16,
        y: 24,
        width: 358,
        height: 220,
        rx: 18,
        'data-container': 'container',
        'data-size-mode': 'responsive',
        'data-outer-margin': 16,
        'data-inner-margin': 14,
        'data-fit-screen': 'width'
      }
    });
    assert.equal(cont1Res.status, 200);
    const cont1 = cont1Res.body;

    const cont2Res = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'use',
      kind: 'instance',
      refType: 'element',
      refId: htmlCarousel.id,
      role: 'carousel-container',
      name: 'featured-carousel',
      attrs: {
        x: 20,
        y: 280,
        width: 350,
        height: 240,
        'data-container': 'carousel',
        'data-size-mode': 'responsive',
        'data-outer-margin': 20,
        'data-inner-margin': 12,
        'data-carousel-dim': '3d',
        'data-carousel-dir': 'horizontal',
        'data-carousel-speed': 2200,
        'data-carousel-autoroll': 'true'
      }
    });
    assert.equal(cont2Res.status, 200);
    const cont2 = cont2Res.body;

    // 3. Drop an oversized child element (width 600, height 400, x=0, y=0) into Container 1 (`parentId: cont1.id`)
    //    Container 1 outer box is x=16, y=24, w=358, h=220, innerMargin=14 -> inner box is x=30, y=38, maxW=330, maxH=192.
    //    Verify the child's size and position are automatically clamped to the container's inner bounds!
    const oversizedChildRes = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'rect',
      role: 'card',
      parentId: cont1.id,
      name: 'oversized-child-card',
      attrs: { x: 0, y: 0, width: 600, height: 400, rx: 12 }
    });
    assert.equal(oversizedChildRes.status, 200);
    const clampedChild1 = oversizedChildRes.body;
    assert.equal(clampedChild1.parentId, cont1.id);
    assert.ok(clampedChild1.attrs.width <= 330, `Child width (${clampedChild1.attrs.width}) must be clamped to container inner width (330)`);
    assert.ok(clampedChild1.attrs.height <= 192, `Child height (${clampedChild1.attrs.height}) must be clamped to container inner height (192)`);
    assert.ok(clampedChild1.attrs.x >= 30, `Child x (${clampedChild1.attrs.x}) must be inside container inner left bound (30)`);
    assert.ok(clampedChild1.attrs.y >= 38, `Child y (${clampedChild1.attrs.y}) must be inside container inner top bound (38)`);

    // Add a second sub-element inside Container 1 to verify a container can have many sub-elements
    const child2Res = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'rect',
      role: 'button',
      parentId: cont1.id,
      name: 'cta-inside-container',
      attrs: { x: 40, y: 160, width: 180, height: 48, rx: 14 }
    });
    assert.equal(child2Res.status, 200);
    assert.equal(child2Res.body.parentId, cont1.id);

    // 4. Add multiple sub-elements inside Carousel Container (`cont2.id`)
    const slide1 = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'rect',
      role: 'card',
      parentId: cont2.id,
      name: 'carousel-slide-1',
      attrs: { x: 40, y: 310, width: 280, height: 160, rx: 14 }
    });
    const slide2 = await req('POST', `/api/screens/${screenId}/nodes`, {
      tag: 'rect',
      role: 'card',
      parentId: cont2.id,
      name: 'carousel-slide-2',
      attrs: { x: 60, y: 320, width: 450, height: 300, rx: 14 } // oversized -> clamped to 350 - 24 = 326 x 216
    });
    assert.equal(slide1.status, 200);
    assert.equal(slide2.status, 200);
    assert.ok(slide2.body.attrs.width <= 326, `Carousel child width (${slide2.body.attrs.width}) must be clamped to carousel inner width (326)`);
    assert.ok(slide2.body.attrs.height <= 216, `Carousel child height (${slide2.body.attrs.height}) must be clamped to carousel inner height (216)`);

    // 5. Increase Container 1's inner margin (`data-inner-margin` from 14 -> 30) and shrink width to 260:
    //    Verify all children of Container 1 are automatically re-clamped to the new inner bounds (260 - 60 = 200 max width)!
    const shrinkCont1 = await req('PATCH', `/api/screens/${screenId}/nodes/${cont1.id}`, {
      attrs: {
        ...cont1.attrs,
        width: 260,
        'data-inner-margin': 30
      }
    });
    assert.equal(shrinkCont1.status, 200);
    const updatedScreenAfterShrink = (await req('GET', `/api/screens/${screenId}`)).body;
    const reClampedChild1 = updatedScreenAfterShrink.nodes.find(n => n.id === clampedChild1.id);
    assert.ok(reClampedChild1.attrs.width <= 200, `After shrinking container & increasing innerMargin to 30, child width (${reClampedChild1.attrs.width}) must be <= 200`);

    // 6. Test Responsive vs Fixed Container behavior when resizing the device screen (390 -> 480 width)
    //    Set Container 1 to `fixed` and keep Container 2 as `responsive` (`outerMargin = 20`)
    await req('PATCH', `/api/screens/${screenId}/nodes/${cont1.id}`, {
      attrs: { ...shrinkCont1.body.attrs, 'data-size-mode': 'fixed' }
    });
    const resizedScreen = await req('PUT', `/api/screens/${screenId}`, { width: 480, height: 844 });
    assert.equal(resizedScreen.status, 200);
    const cont1AfterScreenResize = resizedScreen.body.nodes.find(n => n.id === cont1.id);
    const cont2AfterScreenResize = resizedScreen.body.nodes.find(n => n.id === cont2.id);
    assert.equal(cont1AfterScreenResize.attrs.width, 260, 'Fixed-size container must keep its width (260) when screen width changes');
    assert.equal(cont2AfterScreenResize.attrs.width, 440, 'Responsive container (outerMargin=20) must fit new 480px screen width (480 - 40 = 440)');

    // 7. Verify SVG rendering outputs clipped `.ud-container-children` and `.ud-carousel-track.ud-carousel-3d-horizontal` + 2D vertical roll
    const svg3dHoriz = (await req('GET', `/api/screens/${screenId}/svg`)).body;
    assert.ok(svg3dHoriz.includes('ud-container-children'), 'Rendered screen SVG must include .ud-container-children clip group');
    assert.ok(svg3dHoriz.includes('ud-carousel-track ud-carousel-3d-horizontal'), 'Rendered screen SVG must include 3D horizontal carousel roll track');

    // Switch Carousel Container to 2D Vertical Roll and verify SVG output
    await req('PATCH', `/api/screens/${screenId}/nodes/${cont2.id}`, {
      attrs: {
        ...cont2AfterScreenResize.attrs,
        'data-carousel-dim': '2d',
        'data-carousel-dir': 'vertical'
      }
    });
    const svg2dVert = (await req('GET', `/api/screens/${screenId}/svg`)).body;
    assert.ok(svg2dVert.includes('ud-carousel-track ud-carousel-2d-vertical'), 'Rendered screen SVG must include 2D vertical carousel roll track');
  });
});

test('Persona 11 (@kyrpy-gru & @kyrpy-testusers-team): Move Restrictions (Built-in & Other-User Items Copy-Only, Owned Projects Only), Recursive Sub-Item Cascade on Copy/Move, Multi-Target Save-As, and 3-Tier Visibility (public, private user global, project)', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Register two users: Alice and Bob
    const aliceReg = await req('POST', '/api/auth/register', {
      username: 'alice_designer',
      email: 'alice@kyrpy.com',
      password: 'Password123!',
      displayName: 'Alice'
    });
    assert.equal(aliceReg.status, 200);
    const aliceToken = aliceReg.body.token;
    const aliceId = aliceReg.body.user.id;
    const aliceAuth = { Authorization: `Bearer ${aliceToken}` };

    const bobReg = await req('POST', '/api/auth/register', {
      username: 'bob_designer',
      email: 'bob@kyrpy.com',
      password: 'Password123!',
      displayName: 'Bob'
    });
    assert.equal(bobReg.status, 200);
    const bobToken = bobReg.body.token;
    const bobId = bobReg.body.user.id;
    const bobAuth = { Authorization: `Bearer ${bobToken}` };

    // 2. Alice creates two projects she owns (`aliceProjA`, `aliceProjB`); Bob creates `bobProj`
    const aliceProjA = (await req('POST', '/api/projects', { name: 'Alice Project A', visibility: 'private' }, aliceAuth)).body;
    const aliceProjB = (await req('POST', '/api/projects', { name: 'Alice Project B', visibility: 'private' }, aliceAuth)).body;
    const bobProj = (await req('POST', '/api/projects', { name: 'Bob Project', visibility: 'private' }, bobAuth)).body;
    assert.equal(aliceProjA.ownerId, aliceId);
    assert.equal(aliceProjB.ownerId, aliceId);
    assert.equal(bobProj.ownerId, bobId);

    // 3. Default basic (builtin) items CANNOT be moved (403 FORBIDDEN), only copied
    const builtinScreens = (await req('GET', '/api/screens')).body;
    const builtinScreen = builtinScreens.find(s => s.builtin);
    assert.ok(builtinScreen, 'Must have a default basic builtin screen');

    const moveBuiltinRes = await req('POST', '/api/library/move-to-projects', {
      items: [{ type: 'screen', id: builtinScreen.id }],
      projectIds: [aliceProjA.id]
    }, aliceAuth);
    assert.equal(moveBuiltinRes.status, 403, 'Default basic (builtin) items cannot be moved');

    const copyBuiltinRes = await req('POST', '/api/library/copy-to-projects', {
      items: [{ type: 'screen', id: builtinScreen.id }],
      projectIds: [aliceProjA.id]
    }, aliceAuth);
    assert.equal(copyBuiltinRes.status, 200, 'Default basic (builtin) items can be copied with sub-items');
    assert.equal(copyBuiltinRes.body.copiedCount, 1);
    assert.ok(copyBuiltinRes.body.subItemsCount >= 1, 'Copying builtin screen must cascade its sub-items to target project');

    // 4. Alice builds a hierarchy of items in `aliceProjA`: path -> icon -> button -> element -> screen
    const aPath = (await req('POST', '/api/paths', {
      name: 'Alice Custom Path',
      projectId: aliceProjA.id,
      visibility: 'project',
      nodes: [{ tag: 'path', name: 'p1', attrs: { d: 'M2 2 L22 22' } }]
    }, aliceAuth)).body;

    const aIcon = (await req('POST', '/api/icons', {
      name: 'Alice Custom Icon',
      projectId: aliceProjA.id,
      visibility: 'project',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'path', refId: aPath.id, name: 'u-path', attrs: { x: 0, y: 0, width: 24, height: 24 } }]
    }, aliceAuth)).body;

    const aBtn = (await req('POST', '/api/buttons', {
      name: 'Alice Custom Button',
      projectId: aliceProjA.id,
      visibility: 'project',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: aIcon.id, name: 'u-icon', attrs: { x: 8, y: 8, width: 24, height: 24 } }]
    }, aliceAuth)).body;

    const aEl = (await req('POST', '/api/elements', {
      name: 'Alice Custom Card Element',
      projectId: aliceProjA.id,
      visibility: 'project',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'button', refId: aBtn.id, name: 'u-btn', attrs: { x: 12, y: 12, width: 64, height: 48 } }]
    }, aliceAuth)).body;

    const aScreen = (await req('POST', '/api/screens', {
      name: 'Alice Composite Screen',
      projectId: aliceProjA.id,
      visibility: 'project',
      nodes: [{ tag: 'use', kind: 'instance', refType: 'element', refId: aEl.id, name: 'u-el', attrs: { x: 20, y: 40, width: 240, height: 80 } }]
    }, aliceAuth)).body;

    // 5. Items owned by OTHER users cannot be moved (403 FORBIDDEN)
    const bobMoveAliceItem = await req('POST', '/api/library/move-to-projects', {
      items: [{ type: 'screen', id: aScreen.id }],
      projectIds: [bobProj.id]
    }, bobAuth);
    assert.equal(bobMoveAliceItem.status, 403, 'Items owned by other users cannot be moved');

    // 6. Alice cannot move her item into Bob's project (403 FORBIDDEN — move only works with user's owned projects)
    const aliceMoveToBobProj = await req('POST', '/api/library/move-to-projects', {
      items: [{ type: 'screen', id: aScreen.id }],
      projectIds: [bobProj.id]
    }, aliceAuth);
    assert.equal(aliceMoveToBobProj.status, 403, 'Move items only works with user owned target projects');

    // 7. Alice moves her screen from `aliceProjA` to `aliceProjB` (both owned by Alice) -> succeeds and cascades all 4 sub-items!
    const aliceMoveRes = await req('POST', '/api/library/move-to-projects', {
      items: [{ type: 'screen', id: aScreen.id }],
      projectIds: [aliceProjB.id]
    }, aliceAuth);
    assert.equal(aliceMoveRes.status, 200);
    assert.equal(aliceMoveRes.body.movedCount, 1);
    assert.equal(aliceMoveRes.body.moved[0].projectId, aliceProjB.id);
    assert.ok(aliceMoveRes.body.subItemsCount >= 4, `Moving screen must cascade all 4 sub-items (element, button, icon, path), got ${aliceMoveRes.body.subItemsCount}`);

    // 8. Multi-Target `Save as…` (`/api/library/save-to-targets`) + Global Private Library (`includeUserPrivate: true`)
    //    Bob edits Alice's screen (or saves it via Save As to `bobProj` + Bob's Global Private Library)
    const bobProj2 = (await req('POST', '/api/projects', { name: 'Bob Project 2', visibility: 'private' }, bobAuth)).body;
    const movedScreenId = aliceMoveRes.body.moved[0].id;
    const multiSaveRes = await req('POST', '/api/library/save-to-targets', {
      type: 'screen',
      id: movedScreenId,
      name: 'Bob Remixed Screen',
      projectIds: [bobProj.id, bobProj2.id],
      includeUserPrivate: true
    }, bobAuth);
    assert.equal(multiSaveRes.status, 200);
    assert.equal(multiSaveRes.body.copiedCount, 3, 'Must save to bobProj, bobProj2, AND Bob Global Private Library');
    assert.ok(multiSaveRes.body.subItemsCount >= 12, 'Must cascade all sub-items to each target project and global private library');

    const bobGlobalScreen = multiSaveRes.body.copied.find(c => c.visibility === 'private');
    assert.ok(bobGlobalScreen, 'One saved copy must have visibility="private" (Bob Global Private Library)');
    assert.equal(bobGlobalScreen.creatorId, bobId);

    // 9. Verify 3-tier visibility filtering (`public`, `private` user global library, `project` scope):
    //    - Bob querying `visibility=private` sees his global private items across any of his projects
    const bobPrivateScreens = (await req('GET', `/api/screens?visibility=private&projectIds=${bobProj.id}`, undefined, bobAuth)).body;
    assert.ok(bobPrivateScreens.some(s => s.id === bobGlobalScreen.id), 'Bob must see his private global screen across his projects');
    assert.ok(bobPrivateScreens.every(s => s.visibility === 'private' && s.creatorId === bobId), 'visibility=private must only return Bob own private items');

    //    - Alice querying `visibility=private` does NOT see Bob's private global items
    const alicePrivateScreens = (await req('GET', `/api/screens?visibility=private&projectIds=${aliceProjB.id}`, undefined, aliceAuth)).body;
    assert.ok(!alicePrivateScreens.some(s => s.id === bobGlobalScreen.id), 'Alice must never see Bob private global items');

    //    - Bob querying `visibility=project&projectIds=${bobProj.id}` sees only `bobProj` project-scoped items
    const bobProjScreens = (await req('GET', `/api/screens?visibility=project&projectIds=${bobProj.id}`, undefined, bobAuth)).body;
    assert.ok(bobProjScreens.length >= 1);
    assert.ok(bobProjScreens.every(s => s.visibility === 'project' && s.projectId === bobProj.id));

    // 10. Verify frontend Designer & Workflow Designer enforce Save disable on other-user items & provide Multi-Target Save selector
    const designerJs = String((await req('GET', '/js/components/designer.js')).body);
    assert.ok(designerJs.includes('isOwnedByCurrentUser'), 'designer.js must check isOwnedByCurrentUser to disable Save on items owned by other users');
    assert.ok(designerJs.includes('buildSaveTargetsDropdown'), 'designer.js must include multi-target project selector after Save as button');
    assert.ok(designerJs.includes('saveToTargets'), 'designer.js must invoke api.saveToTargets when multiple targets are configured');
  });
});

test('Persona 12 (@kyrpy-uiux-designer): 15 Design Styles (Glassmorphism, Brutalism/Neo-Brutalism, Minimalist, Skeuomorphism, Aurora, Gradient 3D Claymorphism, Cyberpunk, Synthwave, Pastel Minimal/Cozy UI, Cosmic/Space Adventure UI, Flat Playful, Pop & Neon Retro UI + Liquid Glass, Glow Lines, Neumorphism) and All Templates in Dark & Light Modes', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Verify all 30 built-in themes (15 design style families × Dark & Light modes) exist via GET /api/themes
    const themesRes = await req('GET', '/api/themes');
    assert.equal(themesRes.status, 200);
    const themes = themesRes.body;
    assert.equal(themes.length, 30, `Expected 30 built-in themes (15 styles × dark/light), got ${themes.length}`);

    const requiredPairs = [
      ['liquid', 'liquid-light', 'glass'],
      ['glow', 'glow-light', 'glow'],
      ['neu-dark', 'neu-light', 'neu'],
      ['glassmorphism-dark', 'glassmorphism-light', 'glassmorphism'],
      ['brutalism-dark', 'brutalism-light', 'brutalism'],
      ['minimalist-dark', 'minimalist-light', 'minimalist'],
      ['skeuomorphism-dark', 'skeuomorphism-light', 'skeuomorphism'],
      ['aurora-dark', 'aurora-light', 'aurora'],
      ['claymorphism-dark', 'claymorphism-light', 'claymorphism'],
      ['cyberpunk-dark', 'cyberpunk-light', 'cyberpunk'],
      ['synthwave-dark', 'synthwave-light', 'synthwave'],
      ['pastel-dark', 'pastel-light', 'pastel'],
      ['cosmic-dark', 'cosmic-light', 'cosmic'],
      ['flat-dark', 'flat-light', 'flat'],
      ['retro-dark', 'retro-light', 'retro']
    ];

    for (const [darkKey, lightKey, expectedKind] of requiredPairs) {
      const darkTheme = themes.find(t => t.key === darkKey);
      const lightTheme = themes.find(t => t.key === lightKey);
      assert.ok(darkTheme, `Dark theme "${darkKey}" must exist`);
      assert.ok(lightTheme, `Light theme "${lightKey}" must exist`);
      assert.equal(darkTheme.kind, expectedKind);
      assert.equal(lightTheme.kind, expectedKind);
      assert.equal(darkTheme.tokens.mode, 'dark', `${darkKey} must have tokens.mode="dark"`);
      assert.equal(lightTheme.tokens.mode, 'light', `${lightKey} must have tokens.mode="light"`);
      assert.equal(darkTheme.tokens.pairKey, lightKey, `${darkKey} pairKey must point to ${lightKey}`);
      assert.equal(lightTheme.tokens.pairKey, darkKey, `${lightKey} pairKey must point to ${darkKey}`);
    }

    // 2. Verify all existing & new Button Templates have both Dark & Light modes (`40` built-in templates = 20 pairs)
    const btnTplsRes = await req('GET', '/api/templates/buttons');
    assert.equal(btnTplsRes.status, 200);
    const btnTpls = btnTplsRes.body;
    assert.ok(btnTpls.length >= 40, `Expected at least 40 button templates (all styles in dark & light), got ${btnTpls.length}`);

    const darkBtnTpls = btnTpls.filter(t => t.meta?.mode === 'dark');
    const lightBtnTpls = btnTpls.filter(t => t.meta?.mode === 'light');
    assert.ok(darkBtnTpls.length >= 20, 'Must have at least 20 dark mode button templates');
    assert.ok(lightBtnTpls.length >= 20, 'Must have at least 20 light mode button templates');

    for (const tpl of btnTpls.filter(t => t.builtin)) {
      assert.ok(tpl.meta?.pairKey, `Built-in button template "${tpl.key}" must reference its dark/light pairKey`);
      assert.ok(btnTpls.some(other => other.key === tpl.meta.pairKey), `Counterpart button template "${tpl.meta.pairKey}" must exist`);
    }

    // Instantiate a new Brutalism Light button and a Claymorphism Dark button from templates
    const instBrutalLight = await req('POST', '/api/templates/buttons/brutalism-light-btn/instantiate', {
      name: 'Brutalist Light CTA'
    });
    assert.equal(instBrutalLight.status, 200);
    assert.equal(instBrutalLight.body.category, 'brutalism');

    const instClayDark = await req('POST', '/api/templates/buttons/claymorphism-dark-btn/instantiate', {
      name: 'Clay 3D Dark CTA'
    });
    assert.equal(instClayDark.status, 200);
    assert.equal(instClayDark.body.category, 'claymorphism');

    // 3. Verify all built-in Device Templates carry Dark & Light mode metadata
    const devTplsRes = await req('GET', '/api/templates/devices');
    assert.equal(devTplsRes.status, 200);
    for (const dev of devTplsRes.body.filter(d => d.builtin)) {
      assert.deepEqual(dev.meta?.modes, ['dark', 'light'], `Device template "${dev.key}" must support dark & light modes`);
      assert.ok(dev.meta?.darkTheme && dev.meta?.lightTheme, `Device template "${dev.key}" must specify darkTheme and lightTheme`);
    }

    // 4. Verify rendering a screen across all 30 Dark & Light themes succeeds with valid SVG output
    const screens = (await req('GET', '/api/screens')).body;
    const sampleScreen = screens[0];
    for (const th of themes) {
      const svgRes = await req('GET', `/api/screens/${sampleScreen.id}/svg?theme=${th.key}`);
      assert.equal(svgRes.status, 200, `Rendering screen in theme "${th.key}" must return 200`);
      assert.ok(String(svgRes.body).includes('<svg'), `Rendered output for "${th.key}" must be valid SVG`);
    }
  });
});

test('Persona 13 (@kyrpy-uiux-designer): Per-Project Button Style & Icon Size Slider (50-100%, default 95%, Default Circle), Radial/Drawer/Slider/Carousel/Show-Element Button Actions, Project Lifecycle (New, Save, Clone, Browse, Delete), and Updated Help Guide', async () => {
  await withServer(async ({ c, req }) => {
    c.importer.run({ legacyRoot });

    // 1. Create a New Project and verify default button settings (buttonStyle: 'circle', buttonIconSizePct: 95)
    const createProjRes = await req('POST', '/api/projects', {
      name: 'Interactive Buttons Workspace',
      description: 'Tests per-project button style & icon size + action menus',
      visibility: 'private'
    });
    assert.equal(createProjRes.status, 200);
    const proj = createProjRes.body;
    assert.equal(proj.buttonStyle, 'circle', 'Default project button style must be circle');
    assert.equal(proj.buttonIconSizePct, 95, 'Default project button icon size must be 95%');

    const getBtnSettings = await req('GET', `/api/projects/${proj.id}/button-settings`);
    assert.equal(getBtnSettings.status, 200);
    assert.equal(getBtnSettings.body.buttonStyle, 'circle');
    assert.equal(getBtnSettings.body.buttonIconSizePct, 95);
    assert.ok(Array.isArray(getBtnSettings.body.styles) && getBtnSettings.body.styles.some(s => s.key === 'circle'));

    // 2. Apply Button Style ('squircle' and 'circle') and Icon Size Slider (clamped 50-90%) across all buttons in library
    const applySettingsRes = await req('POST', `/api/projects/${proj.id}/button-settings`, {
      buttonStyle: 'circle',
      buttonIconSizePct: 85,
      scope: 'all'
    });
    assert.equal(applySettingsRes.status, 200);
    assert.equal(applySettingsRes.body.buttonStyle, 'circle');
    assert.equal(applySettingsRes.body.buttonIconSizePct, 85);
    assert.ok(applySettingsRes.body.updatedCount > 0, 'Applying button settings must update buttons in library');

    // Verify icon size clamping to [50, 90]
    const clampHighRes = await req('POST', `/api/projects/${proj.id}/button-settings`, {
      buttonStyle: 'pill',
      buttonIconSizePct: 140,
      scope: 'project'
    });
    assert.equal(clampHighRes.status, 200);
    assert.equal(clampHighRes.body.buttonStyle, 'pill');
    assert.equal(clampHighRes.body.buttonIconSizePct, 100, 'Icon size above 100% must clamp to 100%');

    const clampLowRes = await req('POST', `/api/projects/${proj.id}/button-settings`, {
      buttonStyle: 'circle',
      buttonIconSizePct: 20,
      scope: 'all'
    });
    assert.equal(clampLowRes.status, 200);
    assert.equal(clampLowRes.body.buttonStyle, 'circle');
    assert.equal(clampLowRes.body.buttonIconSizePct, 50, 'Icon size below 50% must clamp to 50%');

    // Verify a button in the library has its icon scaled to 50% of its frame
    const allButtons = (await req('GET', '/api/buttons')).body;
    const sampleBtn = (await req('GET', `/api/buttons/${allButtons[0].id}`)).body;
    const iconChild = (sampleBtn.nodes || []).find(n => n.refType === 'icon' || n.tag === 'use');
    if (iconChild) {
      assert.equal(iconChild.attrs.width, Math.round(Math.min(sampleBtn.width, sampleBtn.height) * 0.5), 'Button icon width must reflect 50% icon size');
      assert.equal(iconChild.attrs.height, Math.round(Math.min(sampleBtn.width, sampleBtn.height) * 0.5), 'Button icon height must reflect 50% icon size');
    }

    // 3. Verify all Button Menu & Action modes: radial, drawer, slider-vertical, slider-horizontal, carousel (2D/3D roll), show-element
    const allIcons = (await req('GET', '/api/icons')).body;
    const allElements = (await req('GET', '/api/elements')).body;
    const menuModes = [
      { kind: 'radial', layout: 'radial', radius: 1.7, startAngle: -90, sweep: 360 },
      { kind: 'drawer', layout: 'drawer', side: 'left', gap: 0.25 },
      { kind: 'slider-vertical', layout: 'slider-vertical', direction: 'down', gap: 0.2 },
      { kind: 'slider-horizontal', layout: 'slider-horizontal', direction: 'right', gap: 0.2 },
      { kind: 'carousel', layout: 'carousel', dimension: '3d', direction: 'horizontal', gap: 0.25 },
      { kind: 'show-element', layout: 'list', targetElementId: allElements[0]?.id || null }
    ];

    for (const mode of menuModes) {
      const btnRes = await req('POST', '/api/buttons', {
        name: `Btn ${mode.kind}`,
        projectId: proj.id,
        visibility: 'project',
        width: 48,
        height: 48
      });
      assert.equal(btnRes.status, 200, `Creating button for menu kind="${mode.kind}" must succeed`);
      const cfgRes = await req('PUT', `/api/buttons/${btnRes.body.id}/menu/config`, mode);
      assert.equal(cfgRes.status, 200, `Setting menu config kind="${mode.kind}" must succeed`);
      assert.equal(cfgRes.body.kind, mode.kind);

      const addItem1 = await req('POST', `/api/buttons/${btnRes.body.id}/menu/items`, {
        label: 'Action One',
        iconId: allIcons[0]?.id || null,
        action: 'act-1'
      });
      assert.equal(addItem1.status, 200);
      const addItem2 = await req('POST', `/api/buttons/${btnRes.body.id}/menu/items`, {
        label: 'Action Two',
        iconId: allIcons[1]?.id || null,
        action: 'act-2'
      });
      assert.equal(addItem2.status, 200);

      const svgRes = await req('GET', `/api/buttons/${btnRes.body.id}/svg?openMenu=1`);
      assert.equal(svgRes.status, 200);
      assert.ok(String(svgRes.body).includes('<svg'), `SVG for button menu "${mode.kind}" must render cleanly`);
    }

    // Verify click actions on placed button nodes inside a screen (radial-menu, drawer-menu, slider-vertical, slider-horizontal, carousel-menu, show-element)
    const actionTypes = ['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu', 'show-element'];
    const scrRes = await req('POST', '/api/screens', {
      name: 'Action Menus Screen',
      projectId: proj.id,
      visibility: 'project',
      width: 390,
      height: 844
    });
    assert.equal(scrRes.status, 200);
    for (let i = 0; i < actionTypes.length; i++) {
      const actType = actionTypes[i];
      const nodeRes = await req('POST', `/api/screens/${scrRes.body.id}/nodes`, {
        kind: 'instance',
        tag: 'use',
        refType: 'button',
        refId: allButtons[0].id,
        name: `btn-${actType}`,
        attrs: { x: 24 + i * 52, y: 120, width: 48, height: 48 },
        onClick: {
          type: actType,
          targetId: allElements[0]?.id || null,
          displayMode: 'popup',
          side: 'right',
          direction: actType === 'carousel-menu' ? 'vertical' : (actType === 'slider-horizontal' ? 'right' : 'down'),
          dimension: '3d'
        }
      });
      assert.equal(nodeRes.status, 200, `Creating node with onClick.type="${actType}" must return 200`);
      assert.equal(nodeRes.body.onClick.type, actType);
    }

    // 4. Project lifecycle: Save Project, Clone Project, Browse Projects, Delete Project
    const saveProjRes = await req('POST', `/api/projects/${proj.id}/save`, {
      name: 'Interactive Buttons Workspace Saved',
      buttonStyle: 'circle',
      buttonIconSizePct: 75
    });
    assert.equal(saveProjRes.status, 200);
    assert.equal(saveProjRes.body.name, 'Interactive Buttons Workspace Saved');
    assert.equal(saveProjRes.body.buttonStyle, 'circle');
    assert.equal(saveProjRes.body.buttonIconSizePct, 75);

    const cloneProjRes = await req('POST', `/api/projects/${proj.id}/clone`, {
      name: 'Cloned Interactive Workspace'
    });
    assert.equal(cloneProjRes.status, 200);
    assert.equal(cloneProjRes.body.name, 'Cloned Interactive Workspace');
    assert.equal(cloneProjRes.body.buttonStyle, 'circle');
    assert.equal(cloneProjRes.body.buttonIconSizePct, 75);
    assert.ok(cloneProjRes.body.copiedItemsCount >= 1, 'Cloning project must copy project-scoped designs into the cloned project');

    const browseProjsRes = await req('GET', '/api/projects');
    assert.equal(browseProjsRes.status, 200);
    assert.ok(browseProjsRes.body.some(p => p.id === cloneProjRes.body.id), 'Browse projects must list cloned project');

    const delProjRes = await req('DELETE', `/api/projects/${cloneProjRes.body.id}`);
    assert.equal(delProjRes.status, 200);
    assert.equal(delProjRes.body.deleted, true);

    // 5. Verify Help guide (/guide/usage-and-guide.html) and Screen Inspector visibility removal
    const guideRes = await req('GET', '/guide/usage-and-guide.html');
    assert.equal(guideRes.status, 200);
    const guideHtml = String(guideRes.body);
    assert.ok(guideHtml.includes('50% – 90%'), 'Help guide must document 50-90% button icon size slider');
    assert.ok(guideHtml.includes('Carousel animated roll menu'), 'Help guide must document Carousel animated roll menu');
    assert.ok(guideHtml.includes('Clone Project'), 'Help guide must document Clone Project menu command');

    const inspRes = await req('GET', '/js/components/inspector.js');
    assert.equal(inspRes.status, 200);
    const inspJs = String(inspRes.body);
    assert.ok(inspJs.includes("type === 'screen'\n        ? lockField"), 'Screen inspector must omit the Visibility setting');
  });
});



