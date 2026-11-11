/**
 * End-to-end MCP verification for:
 *  1. Public Elements & Public Library (`uiux_public_library`, `uiux_use_public_element`)
 *  2. Search & Copy Any Item into an Existing Project to Edit (`uiux_copy_item_to_project`)
 *  3. Full Direct CRUD across ALL 6 Item Types (`uiux_create_item`, `uiux_list_project_items`, `uiux_update_item`, `uiux_delete_item` + Trash restore)
 *  4. Pure-Domain Graphical Canvas & Vector Editing Tools (`uiux_graphic_tool`)
 *  5. Tenant isolation, public-library immutability, and read-only scope enforcement
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));

async function createWorld() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'Password123!' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'Password123!' });

  const adaProj = c.projects.create({ name: 'Ada Studio', key: 'ada-studio', visibility: 'private' }, { actor: ada.user });
  const bobPub = c.projects.create({ name: 'Bob Shared Kit', key: 'bob-kit', visibility: 'public' }, { actor: bob.user });
  const bobPriv = c.projects.create({ name: 'Bob Vault', key: 'bob-vault', visibility: 'private' }, { actor: bob.user });

  // Seed Bob's public kit with a full hierarchy: path -> icon -> button -> element -> screen
  const bobPath = c.path.create({ name: 'Bob Spark Path', key: 'bob-spark-path', projectId: bobPub.id, visibility: 'public' }, { actor: bob.user });
  c.path.addNode(bobPath.id, { kind: 'shape', tag: 'path', name: 'spark', role: 'glyph', attrs: { d: 'M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z', fill: 'none', stroke: '{{accent}}' } }, { actor: bob.user });

  const bobIcon = c.icon.create({ name: 'Bob Spark Icon', key: 'bob-spark-icon', projectId: bobPub.id, visibility: 'public' }, { actor: bob.user });
  c.icon.addNode(bobIcon.id, { kind: 'instance', tag: 'use', name: 'spark-ref', refType: 'path', refId: bobPath.id, attrs: { x: 0, y: 0, width: 24, height: 24 } }, { actor: bob.user });

  const bobBtn = c.button.create({ name: 'Bob CTA Button', key: 'bob-cta-btn', width: 120, height: 44, projectId: bobPub.id, visibility: 'public' }, { actor: bob.user });
  c.button.addNode(bobBtn.id, { kind: 'shape', tag: 'rect', name: 'bg', role: 'surface', attrs: { x: 0, y: 0, width: 120, height: 44, rx: 10, fill: '{{accent}}' } }, { actor: bob.user });
  c.button.addNode(bobBtn.id, { kind: 'instance', tag: 'use', name: 'icon', refType: 'icon', refId: bobIcon.id, attrs: { x: 12, y: 10, width: 24, height: 24 } }, { actor: bob.user });

  const bobCard = c.element.create({ name: 'Bob Promo Card', key: 'bob-promo-card', category: 'cards', width: 320, height: 140, projectId: bobPub.id, visibility: 'public', descriptionDev: 'Public promo card with nested CTA button.' }, { actor: bob.user });
  c.element.addNode(bobCard.id, { kind: 'shape', tag: 'rect', name: 'card-bg', role: 'surface', attrs: { x: 0, y: 0, width: 320, height: 140, rx: 16, fill: '{{surface}}', stroke: '{{border}}' } }, { actor: bob.user });
  c.element.addNode(bobCard.id, { kind: 'instance', tag: 'use', name: 'cta', refType: 'button', refId: bobBtn.id, attrs: { x: 20, y: 80, width: 120, height: 44 } }, { actor: bob.user });

  const bobScreen = c.screen.create({ name: 'Bob Landing Screen', key: 'bob-landing', width: 390, height: 844, projectId: bobPub.id, visibility: 'public' }, { actor: bob.user });
  c.screen.addNode(bobScreen.id, { kind: 'instance', tag: 'use', name: 'promo', refType: 'element', refId: bobCard.id, attrs: { x: 35, y: 120, width: 320, height: 140 } }, { actor: bob.user });

  // Seed Bob's private vault item (must NEVER be visible or copyable by Ada)
  const bobSecret = c.element.create({ name: 'Bob Secret Widget', key: 'bob-secret-widget', width: 200, height: 80, projectId: bobPriv.id, visibility: 'project' }, { actor: bob.user });

  const projKey = c.mcp.apiKeys.create({ name: 'ada-proj', kind: 'project', projectId: adaProj.id, scopes: ['read', 'request', 'propose'] }, ada.user).key;
  const readOnlyKey = c.mcp.apiKeys.create({ name: 'ada-ro', kind: 'project', projectId: adaProj.id, scopes: ['read'] }, ada.user).key;
  const designKey = c.mcp.apiKeys.create({ name: 'ada-design', kind: 'account', scopes: ['read', 'request', 'propose', 'create', 'design'] }, ada.user).key;

  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let rpcId = 0;

  const rpc = async (method, params, bearer = projKey) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    });
    return res.json();
  };
  const call = async (name, args = {}, bearer = projKey) => rpc('tools/call', { name, arguments: args }, bearer);
  const ok = async (name, args = {}, bearer = projKey) => {
    const r = await call(name, args, bearer);
    assert.ok(r.result && !r.result.isError, `${name} failed: ${JSON.stringify(r.result?.content?.[0]?.text ?? r)}`);
    return r.result.structuredContent;
  };
  const err = async (name, args = {}, bearer = projKey) => {
    const r = await call(name, args, bearer);
    if (r.error) return { code: 'RPC', message: r.error.message };
    assert.ok(r.result?.isError, `Expected ${name} to return tool error`);
    return r.result.structuredContent.error;
  };

  return {
    c, ada, bob, adaProj, bobPub, bobPriv, bobCard, bobScreen, bobSecret,
    projKey, readOnlyKey, designKey, rpc, call, ok, err,
    close: () => { server.close(); c.close(); }
  };
}

test('Public Elements & Copy-to-Project: browse public library, place public element on screen, and cascade-copy complex items to edit', async t => {
  const w = await createWorld();
  t.after(() => w.close());

  // 1. Browse public elements via `uiux_public_library`
  const pubSearch = await w.ok('uiux_public_library', { onlyElements: true, query: 'promo' });
  assert.ok(pubSearch.total >= 1);
  assert.ok(pubSearch.items.some(it => it.key === 'bob-promo-card'));
  assert.ok(Array.isArray(pubSearch.categories));

  // Fetch single public element as JSON & SVG
  const pubItemJson = await w.ok('uiux_public_library', { type: 'element', ref: 'bob-promo-card' });
  assert.equal(pubItemJson.mode, 'item');
  assert.equal(pubItemJson.item.key, 'bob-promo-card');
  assert.equal(pubItemJson.dependencies.length, 1);

  const pubItemSvg = await w.ok('uiux_public_library', { type: 'element', ref: 'bob-promo-card', format: 'svg' });
  assert.match(pubItemSvg.svg, /<svg/);

  // 2. Create a target screen in Ada's project, then use `uiux_use_public_element` to copy + place `bob-promo-card` onto it
  await w.ok('uiux_create_item', {
    type: 'screen',
    name: 'Home Screen',
    key: 'home-screen',
    width: 390,
    height: 844,
    descriptionDev: 'Ada home screen.'
  });

  const used = await w.ok('uiux_use_public_element', {
    ref: 'bob-promo-card',
    placeOn: {
      type: 'screen',
      ref: 'home-screen',
      name: 'hero-promo',
      anchor: 'tc',
      margin: 24
    }
  });
  assert.equal(used.reusedExistingClone, false);
  assert.equal(used.item.scope, 'project');
  // Cascaded button + icon + path into Ada's project!
  assert.ok(used.subItemsCopied.length >= 3);
  assert.equal(used.placedOn.key, 'home-screen');
  assert.ok(used.placedNode.id > 0);

  // Calling `uiux_use_public_element` again reuses the existing project clone unless `copyAsNew` is requested
  const reused = await w.ok('uiux_use_public_element', { ref: 'bob-promo-card' });
  assert.equal(reused.reusedExistingClone, true);
  assert.equal(reused.item.uid, used.item.uid);

  // 3. Search & Copy ANY item (`bob-landing` screen) into Ada's project to edit, then edit the copy without touching Bob's source
  const candidates = await w.ok('uiux_copy_item_to_project', { query: 'landing', searchOnly: true });
  assert.equal(candidates.mode, 'search');
  assert.ok(candidates.candidates.some(it => it.key === 'bob-landing'));
  // Ensure Bob's private vault widget NEVER appears in candidates
  const secretSearch = await w.ok('uiux_copy_item_to_project', { query: 'secret', searchOnly: true });
  assert.equal(secretSearch.candidates.some(it => it.key === 'bob-secret-widget'), false);

  // Attempting to copy Bob's private item fails with NOT_FOUND
  const secretCopyErr = await w.err('uiux_copy_item_to_project', { type: 'element', ref: 'bob-secret-widget' });
  assert.equal(secretCopyErr.code, 'NOT_FOUND');

  // Copy `bob-landing` into Ada's project under a new key & edit it
  const copiedScreen = await w.ok('uiux_copy_item_to_project', {
    type: 'screen',
    ref: 'bob-landing',
    newName: 'Ada Customized Landing',
    newKey: 'ada-landing',
    descriptionDev: 'Customized landing screen in Ada Studio.'
  });
  assert.equal(copiedScreen.mode, 'copied');
  assert.equal(copiedScreen.item.key, 'ada-landing');
  assert.equal(copiedScreen.item.scope, 'project');

  await w.ok('uiux_graphic_tool', {
    type: 'screen',
    ref: 'ada-landing',
    operation: 'add_shape',
    shape: 'text',
    name: 'headline',
    text: 'Welcome to Ada Studio',
    x: 35,
    y: 70,
    fontSize: 24
  });

  // Verify Bob's original screen still has only 1 node while Ada's copy has 2
  assert.equal(w.c.screen.get(w.bobScreen.id).nodes.length, 1);
  const adaLanding = await w.ok('uiux_get_item', { type: 'screen', ref: 'ada-landing' });
  assert.equal(adaLanding.nodes.length, 2);

  // Read-only key cannot copy or mutate
  const roErr = await w.err('uiux_use_public_element', { ref: 'bob-promo-card' }, w.readOnlyKey);
  assert.equal(roErr.code, 'SCOPE_DENIED');
});

test('Full Direct CRUD across ALL 6 Item Types (path, icon, button, element, screen, workflow) + Trash & Restore', async t => {
  const w = await createWorld();
  t.after(() => w.close());

  // 1. Create `path`
  const p = await w.ok('uiux_create_item', {
    type: 'path',
    name: 'Chevron Path',
    key: 'chevron-path',
    svg: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    mcpContext: { purpose: 'Right chevron arrow.' }
  });
  assert.equal(p.item.key, 'chevron-path');
  assert.ok(p.item.nodes.length >= 1);

  // 2. Create `icon` referencing `chevron-path`
  const ic = await w.ok('uiux_create_item', {
    type: 'icon',
    name: 'Next Icon',
    key: 'next-icon',
    nodes: [{ kind: 'instance', tag: 'use', name: 'chev', ref: { type: 'path', key: 'chevron-path' }, attrs: { x: 0, y: 0, width: 24, height: 24 } }]
  });
  assert.equal(ic.item.key, 'next-icon');

  // 3. Create `screen`s so button menu & workflow can route between them
  const s1 = await w.ok('uiux_create_item', {
    type: 'screen',
    name: 'Catalog Screen',
    key: 'catalog-screen',
    width: 390,
    height: 844
  });
  const s2 = await w.ok('uiux_create_item', {
    type: 'screen',
    name: 'Checkout Screen',
    key: 'checkout-screen',
    width: 390,
    height: 844
  });
  assert.equal(s1.item.key, 'catalog-screen');
  assert.equal(s2.item.key, 'checkout-screen');

  // 4. Create `button` with `iconRef`, `menuConfig`, and `menuItems`
  const btn = await w.ok('uiux_create_item', {
    type: 'button',
    name: 'Actions Menu Button',
    key: 'actions-btn',
    width: 56,
    height: 56,
    iconRef: 'next-icon',
    menuConfig: { enabled: true, layout: 'list', trigger: 'click' },
    menuItems: [
      { name: 'go-checkout', label: 'Go to Checkout', action: 'navigate', icon: 'next-icon', targetScreen: 'checkout-screen' }
    ]
  });
  assert.equal(btn.item.key, 'actions-btn');
  assert.equal(btn.item.menuItems.length, 1);
  assert.equal(btn.item.menuItems[0].targetScreen.key, 'checkout-screen');

  // 5. Create `element` (carousel container) containing `actions-btn` + pulse animation
  const el = await w.ok('uiux_create_item', {
    type: 'element',
    name: 'Promo Carousel',
    key: 'promo-carousel',
    width: 350,
    height: 160,
    isContainer: true,
    containerType: 'carousel',
    nodes: [
      { index: 0, kind: 'shape', tag: 'rect', name: 'shell', role: 'carousel-container', attrs: { x: 0, y: 0, width: 350, height: 160, rx: 16, fill: '{{surface}}', 'data-container': 'carousel' } },
      { index: 1, parentIndex: 0, kind: 'instance', tag: 'use', name: 'menu-trigger', ref: { type: 'button', key: 'actions-btn' }, attrs: { x: 24, y: 24, width: 56, height: 56 } }
    ],
    animations: [
      { nodeName: 'menu-trigger', name: 'fade-in', type: 'fade', durationMs: 600, trigger: 'load' }
    ]
  });
  assert.equal(el.item.key, 'promo-carousel');
  assert.equal(el.item.animations.length, 1);

  // Place `promo-carousel` onto `catalog-screen` via `uiux_update_item` (`appendNodes`)
  const updatedS1 = await w.ok('uiux_update_item', {
    type: 'screen',
    ref: 'catalog-screen',
    label: 'Product Catalog',
    appendNodes: [
      {
        kind: 'instance',
        tag: 'use',
        name: 'hero-carousel',
        ref: { type: 'element', key: 'promo-carousel' },
        attrs: { x: 20, y: 80, width: 350, height: 160 },
        onClick: { type: 'screen', targetKey: 'checkout-screen' }
      }
    ]
  });
  assert.equal(updatedS1.item.label, 'Product Catalog');
  assert.equal(updatedS1.item.nodes.length, 1);

  // 6. Create `workflow` auto-crawled from `catalog-screen`!
  const wf = await w.ok('uiux_create_item', {
    type: 'workflow',
    name: 'Shopping Flow',
    key: 'shopping-flow',
    fromScreen: 'catalog-screen',
    mcpContext: { purpose: 'Catalog to Checkout flow.' }
  });
  assert.equal(wf.item.key, 'shopping-flow');
  assert.equal(wf.item.screens.length, 2);
  assert.ok(wf.item.links.length >= 1);

  // 7. Read / List all 6 item types in the project
  const listed = await w.ok('uiux_list_project_items', {});
  for (const kind of ['path', 'icon', 'button', 'element', 'screen', 'workflow']) {
    assert.ok(listed.countsByType[kind] >= 1, `Expected at least 1 ${kind} in project`);
  }

  // 8. Updating a public item without `copyIfForeign` fails cleanly; with `copyIfForeign: true` it clones & updates!
  const mutPubErr = await w.err('uiux_update_item', { type: 'icon', ref: 'bob-spark-icon', label: 'Hacked' });
  assert.equal(mutPubErr.code, 'SCOPE_DENIED');

  const forkedIcon = await w.ok('uiux_update_item', {
    type: 'icon',
    ref: 'bob-spark-icon',
    copyIfForeign: true,
    newKey: 'ada-spark-icon',
    label: 'Ada Spark'
  });
  assert.equal(forkedIcon.copiedFromForeign, true);
  assert.equal(forkedIcon.item.key, 'ada-spark-icon');
  assert.equal(forkedIcon.item.scope, 'project');

  // 9. Delete `workflow` and `icon` to Trash, inspect Trash, and restore both!
  const delWf = await w.ok('uiux_delete_item', { type: 'workflow', ref: 'shopping-flow' });
  assert.equal(delWf.deleted, true);
  assert.equal(delWf.trashed, true);

  const delIcon = await w.ok('uiux_delete_item', { type: 'icon', ref: 'ada-spark-icon' });
  assert.equal(delIcon.deleted, true);

  const withTrash = await w.ok('uiux_list_project_items', { includeTrash: true });
  assert.equal(withTrash.trash.length, 2);

  const restoredWf = await w.ok('uiux_delete_item', { restore: true, trashId: delWf.trashId });
  assert.equal(restoredWf.restored, true);
  assert.equal(restoredWf.item.key, 'shopping-flow');
  assert.equal(restoredWf.item.screens.length, 2);

  const restoredIcon = await w.ok('uiux_delete_item', { restore: true, type: 'icon', ref: 'ada-spark-icon' });
  assert.equal(restoredIcon.restored, true);
  assert.equal(restoredIcon.item.key, 'ada-spark-icon');
});

test('Graphical Editing Tools (`uiux_graphic_tool`): boolean pathfinder, crop, pen/vertex ops, icon explode/extract, layout & grouping', async t => {
  const w = await createWorld();
  t.after(() => w.close());

  // 1. Vector Pathfinder (`union`, `subtract`, `intersect`, `exclude`), `crop`, `round_corners`, `reverse_path`, `simplify_path`, `bake_transform`
  await w.ok('uiux_create_item', { type: 'icon', name: 'Badge Lab', key: 'badge-lab' });

  const boolRes = await w.ok('uiux_graphic_tool', {
    type: 'icon',
    ref: 'badge-lab',
    includeSvg: true,
    operations: [
      { operation: 'add_shape', shape: 'rect', name: 'base', x: 2, y: 2, width: 14, height: 14 },
      { operation: 'add_shape', shape: 'circle', name: 'lobe', cx: 14, cy: 14, r: 7 },
      { operation: 'union', nodeNames: ['base', 'lobe'], name: 'united' },
      { operation: 'add_shape', shape: 'rect', name: 'punch', x: 8, y: 8, width: 4, height: 4 },
      { operation: 'subtract', nodeNames: ['united', 'punch'], name: 'hollow-badge' },
      { operation: 'crop', nodeName: 'hollow-badge', x: 2, y: 2, width: 18, height: 18 },
      { operation: 'round_corners', nodeName: 'hollow-badge', radius: 1.5 },
      { operation: 'simplify_path', nodeName: 'hollow-badge', tolerance: 0.05 },
      { operation: 'reverse_path', nodeName: 'hollow-badge' },
      { operation: 'rotate', nodeName: 'hollow-badge', degrees: 45 },
      { operation: 'bake_transform', nodeName: 'hollow-badge' }
    ]
  });
  assert.equal(boolRes.steps.length, 11);
  assert.equal(boolRes.item.nodes.length, 1);
  assert.match(boolRes.svg, /<svg/);

  // Test `intersect` and `exclude` + `break_apart` + `combine_paths`
  await w.ok('uiux_create_item', { type: 'icon', name: 'Overlap Icon', key: 'overlap-icon' });
  const overlapRes = await w.ok('uiux_graphic_tool', {
    type: 'icon',
    ref: 'overlap-icon',
    operations: [
      { operation: 'add_shape', shape: 'rect', name: 'a', x: 2, y: 2, width: 14, height: 14 },
      { operation: 'add_shape', shape: 'rect', name: 'b', x: 8, y: 8, width: 14, height: 14 },
      { operation: 'exclude', nodeNames: ['a', 'b'], name: 'xor-shape' },
      { operation: 'break_apart', nodeName: 'xor-shape' },
      { operation: 'combine_paths', name: 'recombined' },
      { operation: 'crop_to_canvas' }
    ]
  });
  assert.equal(overlapRes.steps.length, 6);
  assert.equal(overlapRes.item.nodes.length, 1);

  // 2. Pen tool, `smooth_vertices`, `sharp_vertices`, `cut_path`, `join_paths`, `edit_vertices`
  await w.ok('uiux_create_item', { type: 'icon', name: 'Wave Icon', key: 'wave-icon' });
  const waveRes = await w.ok('uiux_graphic_tool', {
    type: 'icon',
    ref: 'wave-icon',
    operations: [
      { operation: 'add_pen_path', name: 'seg-a', points: [{ x: 2, y: 12 }, { x: 7, y: 6, smooth: true }, { x: 12, y: 12 }], closed: false },
      { operation: 'add_pen_path', name: 'seg-b', points: [{ x: 12, y: 12 }, { x: 17, y: 18, smooth: true }, { x: 22, y: 12 }], closed: false },
      { operation: 'join_paths', nodeNames: ['seg-a', 'seg-b'] },
      { operation: 'smooth_vertices', vertexIndices: [1, 2] },
      { operation: 'sharp_vertices', vertexIndices: [1] },
      { operation: 'edit_vertices', edits: [{ index: 0, x: 3, y: 12 }] },
      { operation: 'cut_path', vertexIndex: 2 }
    ]
  });
  assert.equal(waveRes.steps.length, 7);

  // 3. `explode_icon` & `extract_paths_to_library`
  const explodeRes = await w.ok('uiux_graphic_tool', {
    type: 'icon',
    ref: 'bob-spark-icon',
    copyIfForeign: true,
    operations: [
      { operation: 'explode_icon' },
      { operation: 'extract_paths_to_library' }
    ]
  });
  assert.equal(explodeRes.copiedFromForeign, true);
  assert.ok(explodeRes.createdLibraryItems.length >= 1);
  assert.equal(explodeRes.createdLibraryItems[0].type, 'path');

  // 4. Screen Layout, Alignment, Distribution, Flip, Group/Ungroup, Layer Order, Style Copy, Duplicate Grid & `extract_as_element` (tested via `design` key!)
  await w.ok('uiux_edit_project', { project: 'ada-studio' }, w.designKey);
  await w.ok('uiux_create_item', { type: 'screen', name: 'Dashboard', key: 'dashboard-screen', width: 390, height: 844 }, w.designKey);

  const layoutRes = await w.ok('uiux_graphic_tool', {
    type: 'screen',
    ref: 'dashboard-screen',
    operations: [
      { operation: 'add_shape', shape: 'rect', name: 'chip-1', x: 20, y: 40, width: 80, height: 36, rx: 18, fill: '{{accent}}' },
      { operation: 'add_shape', shape: 'rect', name: 'chip-2', x: 110, y: 52, width: 80, height: 36, rx: 18 },
      { operation: 'add_shape', shape: 'rect', name: 'chip-3', x: 280, y: 44, width: 80, height: 36, rx: 18 },
      { operation: 'style_nodes', nodeNames: ['chip-2', 'chip-3'], copyStyleFromNodeName: 'chip-1' },
      { operation: 'align', nodeNames: ['chip-1', 'chip-2', 'chip-3'], mode: 'top' },
      { operation: 'distribute', nodeNames: ['chip-1', 'chip-2', 'chip-3'], axis: 'h' },
      { operation: 'group', nodeNames: ['chip-1', 'chip-2', 'chip-3'], name: 'chip-bar' },
      { operation: 'ungroup', nodeName: 'chip-bar' },
      // Add a card + label inside its bounds, then extract them into a reusable `element`!
      { operation: 'add_shape', shape: 'rect', name: 'stat-card-bg', x: 24, y: 140, width: 342, height: 120, rx: 16, fill: '{{surface}}' },
      { operation: 'add_shape', shape: 'text', name: 'stat-card-title', text: 'Active Revenue', x: 44, y: 180, fontSize: 18 },
      { operation: 'extract_as_element', nodeName: 'stat-card-bg', elementName: 'Stat Card', elementKey: 'stat-card', replaceWithInstance: true },
      // Place a public icon directly onto the screen via `place_instance` (auto-adopted!)
      { operation: 'place_instance', itemType: 'icon', itemRef: 'bob-spark-icon', name: 'spark-badge', anchor: 'tr', margin: 20, width: 28, height: 28 },
      { operation: 'reorder_layer', nodeName: 'spark-badge', position: 'front' },
      { operation: 'flip', nodeName: 'chip-1', axis: 'h' },
      { operation: 'move', nodeName: 'chip-1', dx: 0, dy: 4 },
      { operation: 'resize', nodeName: 'chip-1', width: 88, height: 36 },
      { operation: 'duplicate_nodes', nodeName: 'spark-badge', rows: 2, cols: 2, gapX: 8, gapY: 8 },
      { operation: 'fit_to_screen', width: 412, height: 915 }
    ]
  }, w.designKey);

  assert.equal(layoutRes.steps.length, 18);
  assert.equal(layoutRes.item.width, 412);
  assert.equal(layoutRes.item.height, 915);
  assert.ok(layoutRes.createdLibraryItems.some(x => x.type === 'element' && x.key === 'stat-card'));
  assert.ok(layoutRes.item.nodes.some(n => n.kind === 'instance' && n.ref?.key === 'stat-card'));
});
