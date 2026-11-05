import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';
import { animationsToCss } from '../domain/animation.js';
import { normalizeEventBinding, normalizeEvents } from '../domain/entities.js';

const here = dirname(fileURLToPath(import.meta.url));
const fresh = () => buildContainer({ dbFile: ':memory:' });

test('default admin user kyrpy is seeded and all items default to public + creator/rootOwner kyrpy', () => {
  const c = fresh();
  const kyrpy = c.users.findByUsernameOrEmail('kyrpy');
  assert.ok(kyrpy, 'default user kyrpy exists');
  assert.equal(kyrpy.id, 1);
  assert.equal(kyrpy.username, 'kyrpy');
  assert.equal(kyrpy.role, 'admin');

  const pathRec = c.path.create({ name: 'Wave Path' });
  const iconRec = c.icon.create({ name: 'Wave Icon' });
  const btnRec = c.button.create({ name: 'Wave Button' });
  const elRec = c.element.create({ name: 'Wave Element' });
  const scrRec = c.screen.create({ name: 'Wave Screen' });
  const wfRec = c.workflows.create({ name: 'Wave Flow' });

  for (const item of [pathRec, iconRec, btnRec, elRec, scrRec, wfRec]) {
    assert.equal(item.visibility, 'public');
    assert.equal(item.creatorId, 1);
    assert.equal(item.rootOwnerId, 1);
    assert.equal(item.projectId, 1);
  }
  c.close();
});

test('auth & ACL system: register, login with username or email, session token, and admin user management', () => {
  const c = fresh();
  // Default kyrpy login
  const kyrpyAuth = c.auth.login({ usernameOrEmail: 'kyrpy', password: 'kyrpy' });
  assert.equal(kyrpyAuth.user.username, 'kyrpy');
  assert.equal(kyrpyAuth.user.role, 'admin');
  assert.ok(kyrpyAuth.token.length > 16);
  assert.equal(c.auth.resolveToken(kyrpyAuth.token).username, 'kyrpy');

  // Register new user
  const reg = c.auth.register({
    username: 'ada_designer',
    email: 'ada@kyrpy.com',
    password: 'secretPassword123',
    displayName: 'Ada Designer'
  });
  assert.equal(reg.user.username, 'ada_designer');
  assert.equal(reg.user.role, 'designer');

  // Login by email
  const emailLogin = c.auth.login({ usernameOrEmail: 'ada@kyrpy.com', password: 'secretPassword123' });
  assert.equal(emailLogin.user.id, reg.user.id);

  // Admin updates user ACL role
  const promoted = c.auth.updateUser({
    actorId: 1,
    userId: reg.user.id,
    patch: { role: 'reviewer', acl: { canApproveChanges: true } }
  });
  assert.equal(promoted.role, 'reviewer');
  assert.equal(promoted.acl.canApproveChanges, true);
  c.close();
});

test('project-based UI designs, public vs project-only visibility, and collaborator invitations', () => {
  const c = fresh();
  const alice = c.auth.register({ username: 'alice', email: 'alice@kyrpy.com', password: 'password123' }).user;
  const bob = c.auth.register({ username: 'bob', email: 'bob@kyrpy.com', password: 'password123' }).user;

  const projA = c.projects.create({ name: 'Untrap Mobile v2', visibility: 'private' }, { actorId: 1 });
  const projB = c.projects.create({ name: 'Internal Admin', visibility: 'private' }, { actorId: alice.id });

  // Invite Alice as contributor to ProjA
  const members = c.projects.addCollaborator({
    projectId: projA.id,
    actorId: 1,
    usernameOrEmail: 'alice',
    role: 'contributor'
  });
  assert.ok(members.some(m => m.userId === alice.id && m.role === 'contributor'));

  // Create a public element and a project-specific element in ProjA, plus a project-specific element in ProjB
  const pubEl = c.element.create({ name: 'Public Header', projectId: projA.id, visibility: 'public' });
  const projAEl = c.element.create({ name: 'ProjA Secret Card', projectId: projA.id, visibility: 'project' });
  const projBEl = c.element.create({ name: 'ProjB Only Widget', projectId: projB.id, visibility: 'project' });

  // Filtering for projA returns public items + projA items, NOT projB project-only items
  const listForA = c.element.list({ projectId: projA.id });
  assert.ok(listForA.some(e => e.id === pubEl.id), 'includes public element');
  assert.ok(listForA.some(e => e.id === projAEl.id), 'includes projA element');
  assert.ok(!listForA.some(e => e.id === projBEl.id), 'excludes projB project-only element');

  // Filtering only project-specific items for projA
  const onlyProjA = c.element.list({ projectId: projA.id, visibility: 'project' });
  assert.equal(onlyProjA.length, 1);
  assert.equal(onlyProjA[0].id, projAEl.id);
  void bob;
  c.close();
});

test('multi-hop clone lineage tracking traces clonedFromId, rootItemId, and rootOwnerId back to kyrpy', () => {
  const c = fresh();
  const userB = c.auth.register({ username: 'user_b', email: 'b@kyrpy.com', password: 'password123' }).user;
  const userC = c.auth.register({ username: 'user_c', email: 'c@kyrpy.com', password: 'password123' }).user;

  // Root item created by kyrpy (id = 1)
  const rootBtn = c.button.create({ name: 'Kyrpy Master Button', visibility: 'public' }, { actorId: 1 });
  assert.equal(rootBtn.creatorId, 1);
  assert.equal(rootBtn.rootOwnerId, 1);

  // First clone by userB into project 1
  const clone1 = c.button.clone(rootBtn.id, { name: 'UserB Fork Button', visibility: 'public' }, { actorId: userB.id });
  assert.equal(clone1.creatorId, userB.id);
  assert.equal(clone1.clonedFromId, rootBtn.id);
  assert.equal(clone1.rootItemId, rootBtn.id);
  assert.equal(clone1.rootOwnerId, 1, 'root owner remains kyrpy (#1)');

  // Second clone by userC from clone1
  const clone2 = c.button.clone(clone1.id, { name: 'UserC Remix Button', visibility: 'project' }, { actorId: userC.id });
  assert.equal(clone2.creatorId, userC.id);
  assert.equal(clone2.clonedFromId, clone1.id);
  assert.equal(clone2.rootItemId, rootBtn.id, 'root item ID still points to kyrpy original');
  assert.equal(clone2.rootOwnerId, 1, 'root owner still points to kyrpy (#1)');

  const lineage = c.button.getLineage(clone2.id);
  assert.equal(lineage.rootOwner.username, 'kyrpy');
  assert.equal(lineage.creator.username, 'user_c');
  assert.equal(lineage.chain.length, 3);
  assert.equal(lineage.chain[0].id, clone2.id);
  assert.equal(lineage.chain[1].id, clone1.id);
  assert.equal(lineage.chain[2].id, rootBtn.id);
  c.close();
});

test('collaborative design change list: collaborator edits record change_requests; owner approves or rejects (rolls back)', () => {
  const c = fresh();
  const collab = c.auth.register({ username: 'collab_dev', email: 'collab@kyrpy.com', password: 'password123' }).user;
  const proj = c.projects.create({ name: 'Collab App' }, { actorId: 1 });
  c.projects.addCollaborator({ projectId: proj.id, actorId: 1, usernameOrEmail: 'collab_dev', role: 'contributor' });

  // Owner kyrpy creates a screen
  const scr = c.screen.create(
    { name: 'Checkout Screen', label: 'Original Title', projectId: proj.id },
    { nodes: [{ tag: 'rect', name: 'card', attrs: { x: 10, y: 10, width: 100, height: 50 } }], actorId: 1 }
  );

  // Collaborator updates the screen -> creates a pending change request in change_requests
  c.screen.update(scr.id, { label: 'Collaborator Proposed Title' }, { actorId: collab.id, projectId: proj.id });
  const pending = c.collab.listChanges({ projectId: proj.id, status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].authorUsername, 'collab_dev');
  assert.equal(pending[0].targetType, 'screen');
  assert.equal(pending[0].targetId, scr.id);
  assert.equal(pending[0].beforeSnapshot.label, 'Original Title');
  assert.equal(pending[0].afterSnapshot.label, 'Collaborator Proposed Title');

  // Owner rejects the change -> rolls back the screen to beforeSnapshot
  const rejected = c.collab.rejectChange({ id: pending[0].id, reviewerId: 1, reviewNote: 'Keep original title' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(c.screen.get(scr.id).label, 'Original Title', 'rejecting rolls back to beforeSnapshot');

  // Collaborator proposes another change, and owner approves it
  c.screen.update(scr.id, { label: 'Approved V2 Title' }, { actorId: collab.id, projectId: proj.id });
  const pending2 = c.collab.listChanges({ projectId: proj.id, status: 'pending' });
  assert.equal(pending2.length, 1);
  const approved = c.collab.approveChange({ id: pending2[0].id, reviewerId: 1, reviewNote: 'LGTM' });
  assert.equal(approved.status, 'approved');
  assert.equal(c.screen.get(scr.id).label, 'Approved V2 Title');
  c.close();
});

test('multi-events (click, mouseover, release, drag, drop), small element toolbar, flip-box & new animations, and export bundle', () => {
  const c = fresh();
  const popupEl = c.element.create({ name: 'Quick Info Popup' });
  const toolbarEl = c.element.create({ name: 'Mini Floating Bar' });
  const targetScr = c.screen.create({ name: 'Details Screen' });

  const events = normalizeEvents([
    { trigger: 'click', type: 'popup', targetId: popupEl.id },
    { trigger: 'mouseover', type: 'toolbar', targetId: toolbarEl.id },
    { trigger: 'release', type: 'screen', targetId: targetScr.id },
    { trigger: 'drop', type: 'animate', animationType: 'flip' }
  ]);
  assert.equal(events.length, 4);
  assert.equal(normalizeEventBinding({ trigger: 'mouseover', type: 'toolbar', targetId: toolbarEl.id }).type, 'toolbar');

  const homeScr = c.screen.create({ name: 'Interactive Screen' });
  const node = c.screen.addNode(homeScr.id, {
    tag: 'rect',
    name: 'flip-card',
    locked: true,
    attrs: { x: 20, y: 40, width: 200, height: 120 },
    onClick: { type: 'toolbar', targetId: toolbarEl.id },
    events
  });
  assert.equal(node.locked, true);
  assert.equal(node.onClick.type, 'toolbar');
  assert.equal(node.events.length, 4);

  // Add new animation types (flip, shake, swing, float, shine, contour-blink, slide-in)
  for (const type of ['flip', 'shake', 'swing', 'float', 'shine', 'contour-blink', 'slide-in']) {
    const a = c.screen.addAnimation(node.id, { type, durationMs: 600, trigger: 'hover' });
    assert.equal(a.type, type);
  }
  const fullScr = c.screen.get(homeScr.id);
  const css = animationsToCss(fullScr.animations);
  assert.match(css, /rotateY/);
  assert.match(css, /drop-shadow/);

  // Export bundle includes multi-event hotspots and toolbar overlay
  const bundle = c.exporter.buildBundle({ screenIds: [homeScr.id, targetScr.id], themeKeys: ['liquid'] });
  const htmlFile = bundle.files.find(f => f.path === 'screens/interactive-screen.html');
  assert.ok(htmlFile);
  assert.match(htmlFile.content, /data-trigger="mouseover"/, 'exported hotspot carries multi-events');
  assert.match(htmlFile.content, /class="ud-overlay ud-toolbar/, 'exported page includes small element toolbar overlay');
  c.close();
});

test('editable template buttons, template devices, workflow screen lock, and translations', () => {
  const c = fresh();
  const devs = c.templates.listDevices();
  assert.ok(devs.length >= 6);
  const customDev = c.templates.saveDevice({
    name: 'Galaxy Fold Unfolded',
    category: 'foldable',
    width: 768,
    height: 1076,
    radius: 28
  }, { actorId: 1 });
  assert.equal(customDev.width, 768);

  const btns = c.templates.listButtons();
  assert.ok(btns.length >= 6);
  const createdBtn = c.templates.instantiateButtonTemplate({
    templateKey: btns[0].key,
    name: 'Checkout CTA Button',
    projectId: 1,
    actorId: 1,
    designServices: { button: c.button }
  });
  assert.equal(createdBtn.name, 'Checkout CTA Button');
  assert.ok(createdBtn.nodes.length >= 2);

  // Workflow screen position lock
  const s = c.screen.create({ name: 'Locked Screen' });
  const wf = c.workflows.create({ name: 'Lockable Flow' });
  c.workflows.placeScreen(wf.id, { screenId: s.id, x: 120, y: 240, collapsed: false, locked: true });
  const wfNode = c.workflows.get(wf.id).nodes.find(n => n.screenId === s.id);
  assert.equal(wfNode.locked, true);

  // Translations
  c.translations.set({ itemType: 'button', itemId: createdBtn.id, locale: 'tr', field: 'label', value: 'Satın Al' });
  const trRows = c.translations.listForItem('button', createdBtn.id);
  assert.equal(trRows.length, 1);
  assert.equal(trRows[0].value, 'Satın Al');
  c.close();
});

test('HTTP collaboration, auth, project, lineage, template & sync routes', async () => {
  const c = fresh();
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (m, u, b, headers = {}) => {
    const r = await fetch(base + u, {
      method: m,
      headers: { 'content-type': 'application/json', ...headers },
      body: b ? JSON.stringify(b) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const boot = await req('GET', '/api/bootstrap');
    assert.equal(boot.status, 200);
    assert.equal(boot.body.currentUser.username, 'kyrpy');
    assert.ok(boot.body.projects.length >= 1);
    assert.ok(boot.body.templateDevices.length >= 6);
    assert.ok(boot.body.templateButtons.length >= 6);

    const login = await req('POST', '/api/auth/login', { usernameOrEmail: 'kyrpy', password: 'kyrpy' });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);

    const el = await req('POST', '/api/elements', { name: 'Root Element', visibility: 'public' });
    assert.equal(el.status, 200);
    const clone = await req('POST', `/api/elements/${el.body.id}/clone`, { name: 'Cloned Element' });
    assert.equal(clone.status, 200);
    const lineage = await req('GET', `/api/elements/${clone.body.id}/lineage`);
    assert.equal(lineage.status, 200);
    assert.equal(lineage.body.rootOwner.username, 'kyrpy');
    assert.equal(lineage.body.chain.length, 2);
  } finally {
    server.close();
    c.close();
  }
});
