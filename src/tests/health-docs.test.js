import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';
import { renderMcpDocs, esc } from '../interfaces/http/docs-pages.js';
import { TOOLS } from '../mcp/server/tools.js';

const here = dirname(fileURLToPath(import.meta.url));

async function boot() {
  const c = buildContainer({ dbFile: ':memory:' });
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => { c.mcp?.http?.stop?.(); server.close(); c.close(); };
  return { c, base, close };
}

const SECRET_PATTERNS = [/kud_(live|test)_[0-9A-Za-z]{32}/, /pepper/i, /password/i, /hash/i, /KYRPY_UIUX_KEY_PEPPER=\S/];

test('GET /api/health keeps ok/time and adds version, uptime and a db probe', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.ok(!Number.isNaN(Date.parse(b.time)));
    assert.equal(typeof b.version, 'string');
    assert.equal(typeof b.uptimeS, 'number');
    assert.equal(b.db.ok, true);
    assert.equal(typeof b.db.latencyMs, 'number');
  } finally { close(); }
});

test('GET /api/health/mcp reports the MCP layer without auth and without secrets', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/api/health/mcp`);
    assert.equal(r.status, 200);
    const text = await r.text();
    const b = JSON.parse(text);
    assert.equal(b.ok, true);
    assert.equal(b.enabled, true);
    assert.equal(b.endpoint, '/mcp');
    assert.match(b.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(b.tools, TOOLS.length);
    assert.ok(b.resources > 0 && b.prompts > 0);
    assert.equal(b.activeSessions, 0);
    for (const re of SECRET_PATTERNS) assert.doesNotMatch(text, re);
    assert.deepEqual(Object.keys(b).sort(), ['accountTools', 'activeSessions', 'enabled', 'endpoint', 'ok', 'openStreams', 'prompts', 'protocolVersion', 'resourceTemplates', 'resources', 'server', 'supportedProtocolVersions', 'time', 'tools'].sort());
  } finally { close(); }
});

test('GET /api/health/mcp says ok:false (HTTP 200) when MCP_MODE=off', async () => {
  const { base, close } = await boot();
  const prev = process.env.MCP_MODE;
  process.env.MCP_MODE = 'off';
  try {
    const r = await fetch(`${base}/api/health/mcp`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, false);
    assert.equal(b.enabled, false);
    assert.match(b.reason, /MCP_MODE=off/);
  } finally { if (prev === undefined) delete process.env.MCP_MODE; else process.env.MCP_MODE = prev; close(); }
});

test('GET /docs/api lists the live routes, auth notes and the health box', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/docs/api`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    for (const route of ['/api/health', '/api/health/mcp', '/api/workflows/{id}/lineage', '/api/themes', '/api/auth/login', '/api/projects/{id}/versions']) {
      assert.ok(html.includes(`<code>${route}</code>`), `missing ${route}`);
    }
    assert.match(html, /x-user-id/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /fetch\("\/api\/health"/);
    assert.match(html, /name="viewport"/);
  } finally { close(); }
});

test('GET /docs/mcp lists every tool, resources, prompts and a placeholder-key setup', async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/docs/mcp`);
    assert.equal(r.status, 200);
    const html = await r.text();
    for (const t of TOOLS) assert.ok(html.includes(`<code>${t.name}</code>`), `missing tool ${t.name}`);
    assert.match(html, /uiux:\/\/schema/);
    assert.match(html, /init-uiux/);
    assert.match(html, /Authorization: Bearer kud_/);
    assert.match(html, /kud_live_&lt;paste-your-key-here&gt;/);
    assert.match(html, /fetch\("\/api\/health\/mcp"/);
    assert.doesNotMatch(html, /kud_(live|test)_[0-9A-Za-z]{32}/);
  } finally { close(); }
});

test('docs escape dynamic text from tool descriptions and the Host header', async () => {
  const evil = [{ name: 'x<script>alert(1)</script>', title: '"><img src=x onerror=alert(1)>', description: '<b>bold</b> & "quotes"', scope: 'read',
    inputSchema: { type: 'object', properties: { '<p>': { type: 'string', description: '</li><script>bad()</script>' } }, required: ['<p>'] } }];
  const html = renderMcpDocs({ baseUrl: 'http://evil"><script>x()</script>', tools: evil });
  assert.doesNotMatch(html, /<script>alert|<img src=x|<b>bold|<script>bad|<script>x\(\)|<code><p><\/code>/);
  assert.match(html, /x&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');

  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/docs/mcp`, { headers: { 'x-forwarded-host': 'h"><script>pwn()</script>' } });
    const page = await r.text();
    assert.doesNotMatch(page, /<script>pwn/);
  } finally { close(); }
});
