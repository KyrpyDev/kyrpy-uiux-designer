/**
 * Milestone M7 hardening sensors: injection and traversal attempts, tenant isolation of changesets and
 * requests, size limits, expiry, and a load run of the protocol layer (latency budget).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = p => ({ descriptionDev: `m7 ${p}`, mcpContext: { purpose: p } });

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const eve = c.auth.register({ username: 'eve', email: 'eve@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada.user });
  const pe = c.projects.create({ name: 'Eve App' }, { actor: eve.user });
  c.icon.create({ name: 'Star', key: 'ada-star', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 6 } }] });
  c.icon.create({ name: 'Secret', key: 'eve-secret', projectId: pe.id, visibility: 'project' }, { actor: eve.user, nodes: [{ tag: 'rect', attrs: { x: 2, y: 2, width: 4, height: 4 } }] });
  const keys = {
    ada: c.mcp.apiKeys.create({ name: 'a', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key,
    eve: c.mcp.apiKeys.create({ name: 'e', projectId: pe.id, scopes: ['read', 'request', 'propose'] }, eve.user).key
  };
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const raw = (who, body) => fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${keys[who]}`, 'content-type': 'application/json' }, body });
  const rpc = async (who, method, params) => (await (await raw(who, JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }))).json());
  const call = async (who, name, args = {}) => (await rpc(who, 'tools/call', { name, arguments: args })).result;
  return { c, p, pe, ada, eve, keys, raw, rpc, call, close: () => { server.close(); c.close(); } };
}

test('M7: injection and traversal attempts are inert', async () => {
  const w = await world();
  try {
    for (const q of ["'; DROP TABLE icons; --", '%', '_', '\\', '" OR 1=1 --', '\u0000x']) {
      const r = await w.call('ada', 'uiux_search_items', { query: q });
      assert.ok(!r.isError, q);
    }
    assert.ok(w.c.icon.get('ada-star'), 'tables intact');
    for (const ref of ['../../etc/passwd', "ada-star' OR '1'='1", '1 OR 1=1']) {
      const r = await w.call('ada', 'uiux_get_item', { type: 'icon', ref });
      assert.equal(r.isError, true, ref);
    }
    assert.equal((await w.rpc('ada', 'resources/read', { uri: 'uiux://item/icon/..%2F..%2Fsecret' })).error.code, -32002);
    assert.equal((await w.rpc('ada', 'resources/read', { uri: 'uiux://tokens/../../x' })).error.code, -32002);
    // markup in text fields is data: stored as text, never interpreted by the validator as safe SVG
    const cs = (await w.call('ada', 'uiux_begin_changeset', {})).structuredContent;
    const evil = await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'x-evil', ...docs('x'), nodes: [{ tag: 'text', text: '<script>alert(1)</script>' }] } });
    assert.equal(evil.structuredContent.error.code, 'VALIDATION_FAILED');
    const href = await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'x-href', ...docs('x'), nodes: [{ tag: 'use', attrs: { href: 'javascript:alert(1)' } }] } });
    assert.equal(href.structuredContent.error.code, 'VALIDATION_FAILED');
    const big = await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'x-big', ...docs('x'), nodes: [{ tag: 'path', attrs: { d: 'M0 0'.repeat(70000) } }] } });
    assert.equal(big.structuredContent.error.details.errors[0].code, 'SIZE');
    assert.equal((await w.raw('ada', 'x'.repeat(1_100_000))).status, 413, 'body cap');
  } finally { w.close(); }
});

test('M7: tenant isolation of changesets, requests, bindings and items', async () => {
  const w = await world();
  try {
    const cs = (await w.call('ada', 'uiux_begin_changeset', {})).structuredContent;
    for (const [tool, args] of [['uiux_get_changeset', { changeset: cs.changeset }], ['uiux_diff_changeset', { changeset: cs.changeset }],
      ['uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'eve-x', ...docs('x') } }], ['uiux_submit_changeset', { changeset: cs.changeset }], ['uiux_discard_changeset', { changeset: cs.changeset }]]) {
      assert.equal((await w.call('eve', tool, args)).structuredContent.error.code, 'NOT_FOUND', tool);
    }
    const rq = (await w.call('ada', 'uiux_request_item', { type: 'icon', intent: 'heart icon' })).structuredContent.request;
    assert.equal((await w.call('eve', 'uiux_claim_request', { request: rq.uid })).structuredContent.error.code, 'NOT_FOUND');
    assert.equal((await w.call('ada', 'uiux_get_item', { type: 'icon', ref: 'eve-secret' })).isError, true, "another project's item");
    assert.equal((await w.call('ada', 'uiux_stage_delete', { changeset: cs.changeset, type: 'icon', ref: 'eve-secret' })).structuredContent.error.code, 'NOT_FOUND');
    assert.equal((await w.call('ada', 'uiux_bind_code', { bindings: [{ type: 'icon', ref: 'eve-secret', file: 'a.ts' }] })).isError, true);
    const eveSecretUid = w.c.mcp.query.reads.find('icon', 'eve-secret').uid;
    const steal = await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', uid: eveSecretUid, key: 'eve-secret', ...docs('x') } });
    assert.equal(steal.structuredContent.error.code, 'VALIDATION_FAILED', 'cannot update an item of another project by uid');
    const ref = await w.call('ada', 'uiux_validate_item', { item: { type: 'button', key: 'ada-b', label: 'B', ...docs('b'), nodes: [{ tag: 'use', kind: 'instance', ref: { type: 'icon', uid: eveSecretUid } }] } });
    assert.equal(ref.structuredContent.errors[0].code, 'REF', 'cannot reference (and so clone) a private item of another project');
    // REST review of another owner's changeset
    const sub = await (async () => {
      await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'ada-new', name: 'New', ...docs('n'), nodes: [{ tag: 'circle', attrs: { cx: 5, cy: 5, r: 3 } }] } });
      return (await w.call('ada', 'uiux_submit_changeset', { changeset: cs.changeset })).structuredContent;
    })();
    assert.throws(() => w.c.mcp.changesets.review(sub.changeset, { approve: sub.ops.map(o => o.opUid) }, w.eve.user), /owner/);
  } finally { w.close(); }
});

test('M7: open changesets expire after 24 h', async () => {
  const w = await world();
  try {
    const cs = (await w.call('ada', 'uiux_begin_changeset', {})).structuredContent;
    const real = w.c.mcp.changesets.now;
    w.c.mcp.changesets.now = () => new Date(Date.now() + 25 * 3600 * 1000);
    try {
      const r = await w.call('ada', 'uiux_stage_item', { changeset: cs.changeset, item: { type: 'icon', key: 'late', ...docs('l') } });
      assert.equal(r.structuredContent.error.code, 'CONFLICT');
      assert.equal((await w.call('ada', 'uiux_get_changeset', { changeset: cs.changeset })).structuredContent.status, 'expired');
    } finally { w.c.mcp.changesets.now = real; }
  } finally { w.close(); }
});

test('M7: load — 400 mixed protocol calls (8 concurrent) stay within the latency budget', async () => {
  const w = await world();
  try {
    for (let i = 0; i < 60; i++) w.c.icon.create({ name: `Load ${i}`, key: `load-${i}`, projectId: w.p.id, visibility: 'project' }, { actor: w.ada.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: (i % 9) + 1 } }] });
    const principal = w.c.mcp.apiKeys.authenticate(w.keys.ada);
    const calls = [
      ['uiux_search_items', { query: 'load' }], ['uiux_get_manifest', {}], ['uiux_get_item', { type: 'icon', ref: 'load-7' }],
      ['uiux_get_item', { type: 'icon', ref: 'load-9', format: 'svg' }], ['uiux_list_versions', {}], ['uiux_get_schema', {}],
      ['uiux_validate_item', { item: { type: 'icon', key: 'load-new', ...docs('n'), nodes: [{ tag: 'rect', attrs: { x: 1, y: 1, width: 2, height: 2 } }] } }]
    ];
    const times = [];
    let n = 0;
    const worker = async () => {
      while (n < 400) {
        const [name, args] = calls[n++ % calls.length];
        const t0 = performance.now();
        const res = await w.c.mcp.protocol.handle({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } }, { principal, ip: '127.0.0.1' });
        times.push(performance.now() - t0);
        assert.ok(!res.result.isError, `${name}: ${res.result.content?.[0]?.text}`);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`# load: ${times.length} calls, p50 ${times[times.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times.at(-1).toFixed(1)} ms`);
    assert.ok(p95 < 250, `p95 ${p95.toFixed(1)} ms`);
    assert.ok(w.c.mcp.apiKeys.audit.list({ projectId: w.p.id, limit: 1000 }).filter(e => e.event === 'tool.call').length >= 400, 'every call audited');
  } finally { w.close(); }
});
