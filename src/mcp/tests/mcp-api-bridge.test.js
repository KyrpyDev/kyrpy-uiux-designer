/**
 * M9 Sensor Suite — MCP Backend API Documentation & Dispatcher Bridge (`uiux_api_docs` + `uiux_api_call`).
 *
 * Verifies:
 * 1. 100% route catalog parity (`buildApiRouter(container).list()` ↔ `API_OPERATIONS`), `web/js/api.js` function
 *    coverage, `/docs/api` HTML documentation rendering, and `uiux://api/docs` + `uiux://api/docs/{group}` resources.
 * 2. End-to-end reverse-engineering workflow via `uiux_api_call`: custom device templates (`saveTemplateDevice`),
 *    project button settings (`applyProjectButtonSettings`), inline SVG import (`importSvg`), menu buttons
 *    (`menuConfig`, `addMenuItem`), popups & animations (`addNode`, `addAnimation`), screens with key-referenced
 *    actions (`onClick` screen & popup), automatic route crawling (`workflowFromScreen`, `importScreenRoutes`),
 *    multi-locale translations (`saveTranslation`, `translations`), dependency adoption (`adoptProjectDependencies`),
 *    version snapshots (`snapshotProjectVersion`), standalone HTML app export (`exportProjectHtml`), and SVG rendering.
 * 3. Standalone MCP server (`createMcpOnlyServer`) parity while HTTP `/api/*` returns 404.
 * 4. Security, scope, and tenant isolation guardrails (blocked routes, server filesystem paths, read-only keys,
 *    cross-tenant project/item/translation isolation, admin-role downgrade, `settings.ai` protection, and `design`
 *    strict-key isolation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { createMcpOnlyServer } from '../server/standalone.js';
import { buildApiRouter, API_OPERATIONS, OPERATION_BY_ACTION, OPERATION_BY_ROUTE } from '../../interfaces/http/api-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const CART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></svg>';

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const adaProj = c.projects.create({ name: 'Ada Shop', visibility: 'private' }, { actor: ada.user });
  const bobProj = c.projects.create({ name: 'Bob Vault', visibility: 'private' }, { actor: bob.user });

  const accFull = c.mcp.apiKeys.create({ name: 'ada-full', kind: 'account', scopes: ['read', 'propose', 'request', 'create'] }, ada.user).key;
  const accRead = c.mcp.apiKeys.create({ name: 'ada-read', kind: 'account', scopes: ['read'] }, ada.user).key;
  const designKey = c.mcp.apiKeys.create({ name: 'ada-design', kind: 'account', scopes: ['read', 'propose', 'create', 'design'] }, ada.user).key;
  const projFull = c.mcp.apiKeys.create({ name: 'ada-proj', projectId: adaProj.id, scopes: ['read', 'propose', 'request'] }, ada.user).key;

  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let id = 0;
  const rpc = async (method, params = {}, bearer = accFull, targetBase = base) => (await (await fetch(`${targetBase}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}, bearer = accFull, targetBase = base) =>
    (await rpc('tools/call', { name, arguments: args }, bearer, targetBase)).result;
  const ok = async (name, args = {}, bearer = accFull, targetBase = base) => {
    const r = await call(name, args, bearer, targetBase);
    assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
  const err = async (name, args = {}, bearer = accFull, targetBase = base) => {
    const r = await call(name, args, bearer, targetBase);
    assert.equal(r.isError, true, `${name} should have failed (${JSON.stringify(args)})`);
    return r.structuredContent.error;
  };

  return {
    c, ada, bob, adaProj, bobProj, accFull, accRead, designKey, projFull, base,
    rpc, call, ok, err,
    close: () => { server.close(); c.close(); }
  };
}

test('M9: 100% route catalog parity, web/js/api.js action coverage, /docs/api rendering, and uiux://api/docs resources', async () => {
  const w = await world();
  try {
    // 1. Every live route in buildApiRouter(c) is documented in API_OPERATIONS, and every API_OPERATIONS route is live
    const liveRoutes = buildApiRouter(w.c).list().map(r => `${r.method} ${r.pattern}`);
    assert.ok(liveRoutes.length >= 168, `expected >= 168 backend routes, got ${liveRoutes.length}`);
    for (const key of liveRoutes) {
      assert.ok(OPERATION_BY_ROUTE.has(key), `live backend route missing from API_OPERATIONS: ${key}`);
    }
    for (const op of API_OPERATIONS) {
      const key = `${op.method} ${op.pattern}`;
      assert.ok(liveRoutes.includes(key), `catalog entry does not match any live route: ${op.action} (${key})`);
    }

    // 2. Every method in interfaces/web/js/api.js (except raw HTTP / browser-state helpers) maps to OPERATION_BY_ACTION
    const webApiSrc = readFileSync(join(here, '..', '..', 'interfaces', 'web', 'js', 'api.js'), 'utf8');
    const clientOnlyHelpers = new Set([
      'get', 'post', 'put', 'patch', 'del',
      'getSession', 'setSession', 'outbox', 'flushOutbox',
      'sessionToken', 'projectId', 'setProjectId', 'userId', 'setUserId', 'eventsUrl'
    ]);
    const webMethods = [...webApiSrc.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/gm)]
      .map(m => m[1])
      .filter(name => !clientOnlyHelpers.has(name));
    assert.ok(webMethods.length >= 115, `expected >= 115 web api.* methods, parsed ${webMethods.length}`);
    for (const fn of webMethods) {
      assert.ok(OPERATION_BY_ACTION.has(fn), `interfaces/web/js/api.js method "${fn}" missing from API_OPERATIONS`);
    }

    // 3. uiux_api_docs returns live-verified operations, supports filters and includeBlocked
    const docsAll = await w.ok('uiux_api_docs', { limit: 300 });
    assert.ok(docsAll.total >= 95);
    assert.ok(docsAll.operations.every(o => o.live === true && o.mcpAllowed === true && o.callableNow === true));
    assert.ok(docsAll.groups.some(g => g.group === 'workflows') && docsAll.groups.some(g => g.group === 'designs'));

    const wfDocs = await w.ok('uiux_api_docs', { group: 'workflows' });
    assert.ok(wfDocs.operations.some(o => o.action === 'workflowFromScreen'));
    assert.ok(wfDocs.operations.some(o => o.action === 'importScreenRoutes'));

    const withBlocked = await w.ok('uiux_api_docs', { includeBlocked: true, query: 'login' });
    const loginOp = withBlocked.operations.find(o => o.action === 'login');
    assert.ok(loginOp && loginOp.mcpAllowed === false && loginOp.callableNow === false && loginOp.blockedReason);

    // 4. MCP resources uiux://api/docs and uiux://api/docs/{group} work for both project keys and account keys
    for (const key of [w.projFull, w.accFull]) {
      const rAll = await w.rpc('resources/read', { uri: 'uiux://api/docs' }, key);
      assert.ok(!rAll.error, JSON.stringify(rAll.error));
      const parsed = JSON.parse(rAll.result.contents[0].text);
      assert.ok(parsed.operations.some(o => o.action === 'createDesign'));

      const rWf = await w.rpc('resources/read', { uri: 'uiux://api/docs/workflows' }, key);
      assert.ok(!rWf.error);
      assert.ok(JSON.parse(rWf.result.contents[0].text).operations.every(o => o.group === 'workflows'));
    }
    const rBad = await w.rpc('resources/read', { uri: 'uiux://api/docs/nonexistent' }, w.accFull);
    assert.equal(rBad.error?.code, -32002);

    // 5. GET /docs/api renders api.<action> badges and parameter docs cleanly
    const htmlRes = await fetch(`${w.base}/docs/api`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /api\.workflowFromScreen/);
    assert.match(html, /api\.saveTemplateDevice/);
    assert.doesNotMatch(html, /kud_(live|test)_[0-9A-Za-z]{32}/);
  } finally {
    w.close();
  }
});

test('M9: end-to-end reverse-engineering workflow via uiux_api_call across every backend domain', async () => {
  const w = await world();
  try {
    // 1. Create a brand-new reverse-engineering target project via uiux_api_call
    const createdProj = await w.ok('uiux_api_call', {
      action: 'createProject',
      body: { name: 'Reversed Delivery App', description: 'Captured from Android emulator' }
    });
    const pKey = createdProj.result.project.key;
    assert.equal(pKey, 'reversed-delivery-app');

    // 2. Register custom emulator device dimensions (POST then PUT update by id)
    const devCreated = await w.ok('uiux_api_call', {
      project: pKey,
      action: 'saveTemplateDevice',
      body: { key: 'pixel-7-emu', name: 'Pixel 7 Emulator', category: 'mobile', width: 412, height: 915, cornerRadius: 36 }
    });
    assert.equal(devCreated.result.key, 'pixel-7-emu');
    assert.equal(devCreated.result.createdBy, w.ada.user.id);

    const devUpdated = await w.ok('uiux_api_call', {
      project: pKey,
      action: 'saveTemplateDevice',
      params: { id: devCreated.result.id },
      body: { height: 920 }
    });
    assert.equal(devUpdated.method, 'PUT');
    assert.equal(devUpdated.result.height, 920);

    // 3. Configure project-wide button settings
    const btnSettings = await w.ok('uiux_api_call', {
      project: pKey,
      action: 'applyProjectButtonSettings',
      body: { buttonStyleKey: 'pill', iconScale: 0.9 }
    });
    assert.ok(btnSettings.result);

    // 4. Import captured SVG icon inline
    const importedSvg = await w.ok('uiux_api_call', {
      project: pKey,
      action: 'importSvg',
      body: { targetType: 'icon', name: 'Cart Icon', key: 'icon-cart', svgText: CART_SVG, category: 'commerce' }
    });
    const cartIcon = importedSvg.result.item || importedSvg.result;
    assert.equal(cartIcon.key, 'icon-cart');

    // 5. Create a menu button + configure radial/drawer menu + add menu items
    const menuBtn = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'createDesign',
      params: { type: 'button' },
      body: {
        key: 'btn-overflow-menu',
        name: 'Overflow Menu',
        label: 'More options',
        width: 48,
        height: 48,
        descriptionDev: 'PURPOSE: Opens top-right overflow actions.',
        nodes: [{ kind: 'instance', tag: 'g', name: 'icoCart', refType: 'icon', refKey: 'icon-cart', attrs: { x: 12, y: 12, width: 24, height: 24 } }]
      }
    })).result;
    assert.equal(menuBtn.key, 'btn-overflow-menu');

    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'menuConfig',
      params: { id: 'btn-overflow-menu' },
      body: { enabled: true, layout: 'list' }
    });

    // 6. Create a popup element + node + animation
    const popupEl = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'createDesign',
      params: { type: 'element' },
      body: {
        key: 'cart-summary-sheet',
        name: 'Cart Summary Sheet',
        label: 'Cart Summary',
        category: 'sheet',
        width: 412,
        height: 320,
        descriptionDev: 'PURPOSE: Bottom sheet showing cart subtotal and checkout CTA.'
      }
    })).result;
    assert.equal(popupEl.key, 'cart-summary-sheet');

    const popupNode = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addNode',
      params: { type: 'element', id: 'cart-summary-sheet' },
      body: { kind: 'shape', tag: 'rect', name: 'sheetBg', role: 'surface', attrs: { x: 0, y: 0, width: 412, height: 320, rx: 24, fill: '{{surface}}' } }
    })).result;
    const sheetBgNode = Array.isArray(popupNode.nodes) ? popupNode.nodes.find(n => n.name === 'sheetBg') : popupNode;
    assert.ok(sheetBgNode?.id);

    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addAnimation',
      params: { type: 'element', id: 'cart-summary-sheet', eid: sheetBgNode.id },
      body: { type: 'fade', trigger: 'load', duration: 0.25, repeat: 1 }
    });

    // 7. Create screens (home, checkout, confirmation) and wire cross-screen & popup actions by item KEY!
    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'createDesign',
      params: { type: 'screen' },
      body: {
        key: 'checkout-screen',
        name: 'Checkout',
        label: 'Checkout',
        width: 412,
        height: 920,
        descriptionDev: 'PURPOSE: Address and payment summary.'
      }
    });

    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'createDesign',
      params: { type: 'screen' },
      body: {
        key: 'home-screen',
        name: 'Home Feed',
        label: 'Home',
        width: 412,
        height: 920,
        descriptionDev: 'PURPOSE: Restaurant feed and cart trigger.'
      }
    });

    // Add interactive nodes on home-screen targeting checkout-screen and cart-summary-sheet by key
    const afterGoCheckout = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addNode',
      params: { type: 'screen', id: 'home-screen' },
      body: {
        kind: 'shape',
        tag: 'rect',
        name: 'btnCheckout',
        role: 'button',
        attrs: { x: 24, y: 820, width: 364, height: 56, rx: 16, fill: '{{accent}}' },
        onClick: { type: 'screen', targetKey: 'checkout-screen' },
        descriptionDev: 'Navigates to checkout-screen.'
      }
    })).result;
    const btnCheckoutNode = (afterGoCheckout.nodes || []).find(n => n.name === 'btnCheckout') || afterGoCheckout;
    assert.ok(btnCheckoutNode?.id);

    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'patchNode',
      params: { type: 'screen', id: 'home-screen', eid: btnCheckoutNode.id },
      body: { label: 'Proceed to Checkout' }
    });

    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addNode',
      params: { type: 'screen', id: 'home-screen' },
      body: {
        kind: 'instance',
        tag: 'g',
        name: 'btnMenu',
        refType: 'button',
        refKey: 'btn-overflow-menu',
        attrs: { x: 348, y: 16, width: 48, height: 48 },
        onClick: { type: 'drawer', side: 'bottom', target: { key: 'cart-summary-sheet' } }
      }
    });

    // Add a menu item on btn-overflow-menu that also targets checkout-screen by key
    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addMenuItem',
      params: { id: 'btn-overflow-menu' },
      body: { name: 'go-checkout', label: 'Go to Checkout', action: 'screen', iconKey: 'icon-cart', targetScreenKey: 'checkout-screen' }
    });

    // 8. Auto-generate workflow from home-screen routes via workflowFromScreen!
    const wfGen = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'workflowFromScreen',
      body: { screenKey: 'home-screen', name: 'Order Flow' }
    })).result;
    const wf = wfGen.workflow || wfGen;
    assert.ok(wf.id);
    assert.ok((wf.nodes || []).length >= 2, 'workflowFromScreen crawled home-screen -> checkout-screen');
    assert.ok((wf.links || []).length >= 1, 'workflowFromScreen created transition link');

    // Add a third screen linked from checkout-screen and run importScreenRoutes on the existing workflow
    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'createDesign',
      params: { type: 'screen' },
      body: { key: 'order-confirmed-screen', name: 'Order Confirmed', label: 'Confirmed', width: 412, height: 920 }
    });
    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'addNode',
      params: { type: 'screen', id: 'checkout-screen' },
      body: {
        kind: 'shape',
        tag: 'rect',
        name: 'btnPlaceOrder',
        role: 'button',
        attrs: { x: 24, y: 820, width: 364, height: 56 },
        onClick: { type: 'screen', targetKey: 'order-confirmed-screen' }
      }
    });
    const wfImported = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'importScreenRoutes',
      params: { id: wf.key },
      body: { screenKey: 'checkout-screen' }
    })).result;
    const wfAfter = wfImported.workflow || wfImported;
    assert.equal((wfAfter.nodes || []).length, 3, 'importScreenRoutes added order-confirmed-screen to workflow');

    // 9. Translations: save multi-locale strings extracted from APK resources and list them back
    await w.ok('uiux_api_call', {
      project: pKey,
      action: 'saveTranslation',
      body: { itemType: 'screen', itemKey: 'home-screen', fieldName: 'label', langCode: 'tr', translatedText: 'Ana Sayfa' }
    });
    const trList = (await w.ok('uiux_api_call', { project: pKey, action: 'translations', query: { lang: 'tr' } })).result;
    assert.equal(trList.length, 1);
    assert.equal(trList[0].translatedText, 'Ana Sayfa');

    // 10. Adopt dependencies, snapshot project version, export standalone HTML & render screen SVG
    await w.ok('uiux_api_call', { project: pKey, action: 'adoptProjectDependencies' });
    const snap = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'snapshotProjectVersion',
      body: { message: 'Initial reverse-engineered capture', label: 'v0.1-apk' }
    })).result;
    assert.ok((snap.version?.number ?? snap.number) >= 1);

    const htmlOut = (await w.ok('uiux_api_call', { project: pKey, action: 'exportProjectHtml' })).result;
    assert.match(htmlOut.contentType, /text\/html/);
    assert.match(htmlOut.text, /Home Feed|Checkout/);

    const svgOut = (await w.ok('uiux_api_call', {
      project: pKey,
      action: 'designSvg',
      params: { type: 'screen', id: 'home-screen' }
    })).result;
    assert.equal(svgOut.contentType, 'image/svg+xml');
    assert.match(svgOut.text, /<svg/);

    // 11. Manifest reflects every item created via uiux_api_call
    const man = await w.ok('uiux_get_manifest', { project: pKey });
    assert.equal(man.counts.icon, 1);
    assert.equal(man.counts.button, 1);
    assert.equal(man.counts.element, 1);
    assert.equal(man.counts.screen, 3);
    assert.equal(man.counts.workflow, 1);
  } finally {
    w.close();
  }
});

test('M9: standalone MCP server (createMcpOnlyServer) executes uiux_api_docs and uiux_api_call while HTTP /api/* is 404', async () => {
  const w = await world();
  const mcpOnly = createMcpOnlyServer(w.c);
  await new Promise(r => mcpOnly.listen(0, '127.0.0.1', r));
  const mcpBase = `http://127.0.0.1:${mcpOnly.address().port}`;
  try {
    // HTTP /api/* does not exist on standalone MCP server
    const httpApi = await fetch(`${mcpBase}/api/projects`, { headers: { authorization: `Bearer ${w.accFull}` } });
    assert.equal(httpApi.status, 404);

    // Both uiux_api_docs and uiux_api_call work in-process on standalone MCP server
    const docs = await w.ok('uiux_api_docs', { group: 'designs' }, w.projFull, mcpBase);
    assert.ok(docs.operations.some(o => o.action === 'createDesign'));

    const created = await w.ok('uiux_api_call', {
      method: 'POST',
      path: '/api/icons',
      body: { key: 'standalone-icon', name: 'Standalone Icon', label: 'Star', width: 24, height: 24, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8 } }] }
    }, w.projFull, mcpBase);
    assert.equal(created.action, 'createDesign');
    assert.equal(created.result.key, 'standalone-icon');
  } finally {
    mcpOnly.close();
    w.close();
  }
});

test('M9: security guardrails — blocked routes, server paths, scopes, cross-tenant isolation, admin downgrade, and strict design keys', async () => {
  const w = await world();
  try {
    // 1. HTTP /api/* still rejects kud_… API keys with 401
    const rawHttp = await fetch(`${w.base}/api/projects`, { headers: { authorization: `Bearer ${w.accFull}` } });
    assert.equal(rawHttp.status, 401);

    // 2. Blocked routes & arguments fail with FORBIDDEN
    const blockedCases = [
      { action: 'login', body: { username: 'ada', password: 'secret123' } },
      { action: 'me' },
      { action: 'users' },
      { action: 'myApiKeys' },
      { project: w.adaProj.key, action: 'projectAiSettings' },
      { project: w.adaProj.key, action: 'updateProjectAiSettings', body: { pushRequiresReview: false } },
      { action: 'syncPush', body: { force: true } },
      { project: w.adaProj.key, action: 'approveChange', params: { id: 1 } },
      { project: w.adaProj.key, action: 'reviewChangeset', params: { uid: '00000000-0000-7000-8000-000000000000' }, body: {} },
      { project: w.adaProj.key, action: 'fulfillItemRequest', params: { uid: '00000000-0000-7000-8000-000000000000' }, body: {} },
      { project: w.adaProj.key, action: 'deleteProject' },
      { project: w.adaProj.key, action: 'addProjectMember', body: { username: 'bob', role: 'editor' } },
      { project: w.adaProj.key, action: 'exportToFolder', body: { folder: '/tmp/pwn' } },
      { project: w.adaProj.key, action: 'importFolders' },
      { project: w.adaProj.key, action: 'importFolder', body: { folderPath: '/etc' } },
      { project: w.adaProj.key, action: 'importFont', body: { fontPath: '/usr/share/fonts/foo.ttf' } }
    ];
    for (const args of blockedCases) {
      const e = await w.err('uiux_api_call', args);
      assert.equal(e.code, 'FORBIDDEN', `expected FORBIDDEN for ${JSON.stringify(args)}, got ${e.code}: ${e.message}`);
    }

    // Create an item in Ada's project and verify permanent=1 delete is blocked while normal Trash delete works
    const adaIcon = (await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'createDesign',
      params: { type: 'icon' },
      body: { key: 'ada-lock-test', name: 'Lock Test', width: 24, height: 24, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 6 } }] }
    })).result;
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'deleteDesign',
      params: { type: 'icon', id: 'ada-lock-test' },
      query: { permanent: '1' }
    })).code, 'FORBIDDEN');

    // 3. Read-only key can read via uiux_api_call, but mutations fail with SCOPE_DENIED
    const listed = await w.ok('uiux_api_call', { project: w.adaProj.key, action: 'list', params: { type: 'icon' } }, w.accRead);
    assert.ok(listed.result.some(i => i.key === 'ada-lock-test'));
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'createDesign',
      params: { type: 'icon' },
      body: { key: 'nope', name: 'Nope', width: 24, height: 24 }
    }, w.accRead)).code, 'SCOPE_DENIED');

    // 4. Cross-tenant isolation (for regular users AND when DB role is promoted to admin!)
    const bobScreen = w.c.services.screen.create({
      key: 'bob-secret-screen',
      name: 'Bob Secret',
      projectId: w.bobProj.id,
      visibility: 'project',
      width: 390,
      height: 844
    }, { actor: w.bob.user });
    w.c.translations.upsert({ tableName: 'screen', recordId: bobScreen.id, fieldName: 'label', langCode: 'fr', translatedText: 'Secret de Bob' });

    // Non-admin Ada gets NOT_FOUND when probing Bob's private project
    assert.equal((await w.err('uiux_api_call', { project: w.bobProj.key, action: 'list', params: { type: 'screen' } })).code, 'NOT_FOUND');

    // Promote Ada's DB role to admin: AccountService still denies mutating Bob's project, and ApiBridge downgrades actor role
    w.c.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(w.ada.user.id);
    assert.equal((await w.err('uiux_api_call', {
      project: w.bobProj.key,
      action: 'createDesign',
      params: { type: 'icon' },
      body: { key: 'admin-intrude', name: 'Intrude', width: 24, height: 24 }
    })).code, 'SCOPE_DENIED');
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'get',
      params: { type: 'screen', id: bobScreen.id }
    })).code, 'NOT_FOUND');
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'saveTranslation',
      body: { itemType: 'screen', itemId: bobScreen.id, fieldName: 'label', langCode: 'de', translatedText: 'Tampered' }
    })).code, 'SCOPE_DENIED');
    const adaTranslations = (await w.ok('uiux_api_call', { project: w.adaProj.key, action: 'translations' })).result;
    assert.equal(adaTranslations.length, 0, 'Bob translations never leak into Ada project translation list');

    // Built-in / public-library items and built-in device templates are immutable over MCP
    const builtinIcon = w.c.services.icon.create({
      key: 'pub-star',
      name: 'Public Star',
      visibility: 'public',
      width: 24,
      height: 24,
      nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8 } }]
    }, { actorId: w.c.publicUserId() });
    assert.ok(builtinIcon?.id, 'public-library icon exists');
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'updateDesign',
      params: { type: 'icon', id: builtinIcon.id },
      body: { name: 'Overwritten Public Icon' }
    })).code, 'SCOPE_DENIED');
    const builtinDev = w.c.templates.listDevices().find(d => d.builtin);
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'saveTemplateDevice',
      body: { key: builtinDev.key, name: 'Hijacked Builtin Device', width: 500, height: 900 }
    })).code, 'SCOPE_DENIED');

    // 5. Project governance settings (visibility: public, settings.ai) cannot be escalated via updateProject
    w.c.projects.update(w.adaProj.id, { settings: { ai: { pushRequiresReview: true, mayCreatePublicItems: false } } }, { actor: w.ada.user });
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'updateProject',
      body: { visibility: 'public' }
    })).code, 'SCOPE_DENIED');
    const updatedProj = (await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'updateProject',
      body: { description: 'Safe description update', requireApproval: false, settings: { theme: 'aurora', ai: { pushRequiresReview: false, mayCreatePublicItems: true } } }
    })).result;
    assert.equal(updatedProj.description, 'Safe description update');
    assert.deepEqual(updatedProj.settings.ai, { pushRequiresReview: true, mayCreatePublicItems: false }, 'settings.ai is preserved untouched');

    // 6. Strict (design) key isolation: uses focused project, can read/clone public items, still blocks foreign projects & publishToPublic
    await w.ok('uiux_edit_project', { project: w.adaProj.key }, w.designKey);
    const strictIcons = (await w.ok('uiux_api_call', { action: 'list', params: { type: 'icon' } }, w.designKey)).result;
    assert.ok(strictIcons.some(i => i.projectId === w.adaProj.id), 'design key receives focused project icons');
    const readPubViaDesign = (await w.ok('uiux_api_call', {
      action: 'get',
      params: { type: 'icon', id: builtinIcon.id }
    }, w.designKey)).result;
    assert.equal(readPubViaDesign.id, builtinIcon.id, 'design key can read public library items');
    assert.equal((await w.err('uiux_api_call', {
      action: 'get',
      params: { type: 'screen', id: bobScreen.id }
    }, w.designKey)).code, 'NOT_FOUND', 'design key cannot read another user\'s project items');
    assert.equal((await w.err('uiux_api_call', {
      action: 'publishToPublic',
      body: { type: 'icon', id: adaIcon.id }
    }, w.designKey)).code, 'SCOPE_DENIED');
  } finally {
    w.close();
  }
});

test('M9: trash lifecycle and cross-project library transfer via uiux_api_call', async () => {
  const w = await world();
  try {
    // Create a second project owned by Ada
    const p2 = (await w.ok('uiux_api_call', {
      action: 'createProject',
      body: { name: 'Ada Second App' }
    })).result.project;

    // Create an icon in Ada's first project, soft-delete to Trash, inspect trashList, then trashRestore
    await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'createDesign',
      params: { type: 'icon' },
      body: { key: 'icon-trash-me', name: 'Trash Me', width: 24, height: 24, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 9 } }] }
    });
    const del = (await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'deleteDesign',
      params: { type: 'icon', id: 'icon-trash-me' }
    })).result;
    assert.equal(del.trashed, true);

    const trash = (await w.ok('uiux_api_call', { project: w.adaProj.key, action: 'trashList' })).result;
    assert.equal(trash.length, 1);
    assert.equal(trash[0].key, 'icon-trash-me');

    await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'trashRestore',
      params: { id: trash[0].id }
    });
    const restored = (await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'getDesign',
      params: { type: 'icon', id: 'icon-trash-me' }
    })).result;
    assert.equal(restored.key, 'icon-trash-me');

    // Copy icon from Ada Shop to Ada Second App via copyToProjects (accepting project key!)
    await w.ok('uiux_api_call', {
      project: w.adaProj.key,
      action: 'copyToProjects',
      body: { items: [{ type: 'icon', key: 'icon-trash-me' }], projectIds: [p2.key] }
    });
    const p2Icons = (await w.ok('uiux_api_call', {
      project: p2.key,
      action: 'list',
      params: { type: 'icon' },
      query: { includePublic: '0' }
    })).result;
    assert.equal(p2Icons.length, 1);
    assert.equal(p2Icons[0].key, 'icon-trash-me');

    // Trying to copy into Bob's project fails with SCOPE_DENIED
    assert.equal((await w.err('uiux_api_call', {
      project: w.adaProj.key,
      action: 'copyToProjects',
      body: { items: [{ type: 'icon', key: 'icon-trash-me' }], projectIds: [w.bobProj.key] }
    })).code, 'SCOPE_DENIED');
  } finally {
    w.close();
  }
});

