/**
 * Self-documenting HTML pages, built at request time (no secrets, every dynamic string escaped):
 *   GET /docs/api  REST API reference from the live Router's route table, auth notes, live /api/health box.
 *   GET /docs/mcp  MCP reference from the tool / resource / prompt registries, client setup snippets with a
 *                  placeholder key, src/mcp/README.md, live /api/health/mcp box.
 */
import { readFileSync } from 'node:fs';
import { SUPPORTED_PROTOCOL_VERSIONS, SERVER_INFO, RESOURCES, RESOURCE_TEMPLATES, PROMPTS } from '../../mcp/server/protocol.js';
import { TOOLS } from '../../mcp/server/tools.js';
import { buildClientSetup, CLIENTS, KEY_PLACEHOLDER, DEFAULT_ENV_VAR } from '../../mcp/interfaces/web/client-setup.js';
import { APP_VERSION } from './controllers/health-routes.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Optional one-line descriptions for well-known routes ("METHOD pattern" → text). Routes without one still list. */
const ROUTE_NOTES = {
  'GET /api/health': 'Server health: version, uptime, database probe (no auth).',
  'GET /api/health/mcp': 'MCP layer health: enabled, protocol version, tool / resource / prompt counts, active sessions (no auth).',
  'GET /api/bootstrap': 'Everything the web client needs at start-up (settings, themes, library, user).',
  'GET /api/auth/config': 'Login configuration (whether sign-in is required, registration open).',
  'POST /api/auth/login': 'Sign in; returns a session token.',
  'POST /api/auth/logout': 'Ends the current session.',
  'POST /api/auth/register': 'Creates a user account.',
  'GET /api/auth/me': 'The user behind the current token.',
  'GET /api/library': 'Library lists (icons, items, screens, workflows) of the visible projects.',
  'GET /api/catalog/search': 'Search across the item catalog.',
  'GET /api/settings': 'Designer settings.',
  'PUT /api/settings': 'Updates designer settings.',
  'GET /api/themes': 'Design styles (themes).',
  'GET /api/workflows': 'Workflow list (filters: q, projectId, visibility, creatorId).',
  'POST /api/workflows/from-screen': 'New workflow from a screen: the screen and every screen its menu items / click actions route to, recursively ({ screenId, name }).',
  'POST /api/workflows/:id/import-routes': 'Adds a screen and every screen its routes reach to the workflow, linked ({ screenId, x, y }).',
  'GET /api/projects': 'Projects visible to the actor.',
  'GET /api/changes': 'Collaborative change requests.',
  'GET /api/trash': 'Deleted items waiting for restore or purge.',
  'GET /api/me/api-keys': 'Your AI access keys (metadata only; the secret is shown once on creation).',
  'POST /api/me/api-keys': 'Creates an AI access key (kud_…) for MCP clients.',
  'POST /api/export/bundle': 'Builds an export bundle (files returned to the browser).',
  'GET /api/sync/status': 'PostgreSQL sync status.'
};

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f8fb; --panel: #ffffff; --line: #d9e1ec; --text: #142033; --muted: #5a6b84; --accent: #1a73e8; --code: #eef2f8;
  --get: #0f7b3f; --post: #1a5fd0; --put: #9a5b00; --patch: #7a3fc0; --delete: #b42318; --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --unk: #94a3b8; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a101c; --panel: #111a2b; --line: #22324d; --text: #e8f1ff; --muted: #8fa8c8; --accent: #2e9bff; --code: #0d1626;
  --get: #4ade80; --post: #60a5fa; --put: #fbbf24; --patch: #c084fc; --delete: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 19px; margin: 32px 0 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
h3 { font-size: 16px; margin: 20px 0 8px; } a { color: var(--accent); } .muted { color: var(--muted); }
nav.top { display: flex; gap: 14px; flex-wrap: wrap; font-size: 14px; margin-bottom: 18px; }
code, pre { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); border-radius: 5px; }
code { padding: 1px 5px; overflow-wrap: anywhere; } pre { padding: 12px; overflow-x: auto; white-space: pre; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.health { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--unk); margin-right: 6px; vertical-align: middle; }
.dot.ok { background: var(--ok); } .dot.slow { background: var(--warn); } .dot.down { background: var(--bad); }
table { width: 100%; border-collapse: collapse; font-size: 14px; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; } .tbl { overflow-x: auto; }
.m { display: inline-block; min-width: 58px; font: 700 12px ui-monospace, monospace; } .m.GET { color: var(--get); } .m.POST { color: var(--post); }
.m.PUT { color: var(--put); } .m.PATCH { color: var(--patch); } .m.DELETE { color: var(--delete); }
.badge { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); color: var(--muted); margin-left: 6px; }
ul.props { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; } ul.props li { margin: 2px 0; }
details > summary { cursor: pointer; font-weight: 600; }
`;

const healthScript = endpoint => `<script>
(function(){
  var box = document.getElementById('health'); var dot = box.querySelector('.dot'); var txt = box.querySelector('.txt'); var raw = document.getElementById('health-raw');
  function show(cls, label, data){ dot.className = 'dot ' + cls; txt.textContent = label; raw.textContent = data ? JSON.stringify(data, null, 2) : ''; }
  function check(){
    var t0 = performance.now(); var ctl = new AbortController(); var to = setTimeout(function(){ ctl.abort(); }, 5000);
    fetch(${JSON.stringify(endpoint)}, { cache: 'no-store', signal: ctl.signal }).then(function(r){ return r.json(); }).then(function(d){
      clearTimeout(to); var ms = Math.round(performance.now() - t0);
      var cls = d && d.ok ? (ms > 1500 ? 'slow' : 'ok') : 'down';
      show(cls, (d && d.ok ? 'Healthy' : 'Unhealthy' + (d && d.reason ? ' — ' + d.reason : '')) + ' · ' + ms + ' ms · checked ' + new Date().toLocaleTimeString(), d);
    }).catch(function(e){ clearTimeout(to); show('down', 'Unreachable — ' + (e && e.name === 'AbortError' ? 'timeout' : (e && e.message || 'error')) + ' · checked ' + new Date().toLocaleTimeString(), null); });
  }
  check(); setInterval(function(){ if (!document.hidden) check(); }, 30000);
  document.getElementById('health-refresh').addEventListener('click', check);
})();
</script>`;

const healthBox = (endpoint, label) => `<div class="card" id="health"><div class="health"><strong>${esc(label)}</strong>
<span><span class="dot"></span><span class="txt">checking…</span></span>
<button type="button" id="health-refresh">Re-check</button> <a href="${esc(endpoint)}" target="_blank" rel="noopener"><code>GET ${esc(endpoint)}</code></a></div>
<details style="margin-top:8px"><summary class="muted">Raw response</summary><pre id="health-raw"></pre></details></div>`;

const page = (title, body, endpoint) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>
<nav class="top"><a href="/">← Designer</a><a href="/docs/api">API reference</a><a href="/docs/mcp">MCP reference</a></nav>
${body}
</main>${healthScript(endpoint)}</body></html>`;

/* ---------- /docs/api ---------- */

const groupOf = pattern => { const seg = pattern.split('/').filter(Boolean); return seg[0] === 'api' ? (seg[1] || '').replace(/^:(\w+).*$/, '{$1}') : seg[0]; };
const prettyPattern = p => p.replace(/\/:(\w+)\(([^)]+)\)/g, '/{$1: $2}').replace(/\/:(\w+)/g, '/{$1}');

export function renderApiDocs(routes, { version = APP_VERSION } = {}) {
  const groups = new Map();
  for (const r of routes) {
    const g = groupOf(r.pattern);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const names = [...groups.keys()].sort((a, b) => (a === 'health' ? -1 : b === 'health' ? 1 : a.localeCompare(b)));
  const toc = names.map(g => `<a href="#g-${esc(g)}">${esc(g)}</a> <span class="muted">(${groups.get(g).length})</span>`).join(' · ');
  const sections = names.map(g => `<h3 id="g-${esc(g)}">/api/${esc(g)}</h3><div class="tbl"><table><tbody>${groups.get(g).map(r => {
    const note = ROUTE_NOTES[`${r.method} ${r.pattern}`];
    return `<tr><td style="white-space:nowrap"><span class="m ${esc(r.method)}">${esc(r.method)}</span></td><td><code>${esc(prettyPattern(r.pattern))}</code>${note ? `<div class="muted">${esc(note)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`).join('\n');

  const body = `<h1>REST API reference</h1>
<p class="muted">Kyrpy UI/UX Designer${version ? ` v${esc(version)}` : ''} · ${routes.length} routes, generated from the live route table at ${esc(new Date().toISOString())}.</p>
${healthBox('/api/health', 'API health')}
<h2>Conventions</h2>
<ul>
<li>JSON in, JSON out (<code>content-type: application/json</code>). Responses over 64 KB are gzipped when the client sends <code>Accept-Encoding: gzip</code>. Request bodies are capped at 64 MB.</li>
<li>Errors: <code>{"error": {"code", "message", "details"}}</code> with the HTTP status (400 validation, 401 unauthorized, 403 forbidden, 404 not found / <code>NO_ROUTE</code>, 413 too large, 500 internal).</li>
<li>Path parameters are written <code>{name}</code>; <code>{name: a|b}</code> accepts only the listed values.</li>
</ul>
<h2>Authentication</h2>
<ul>
<li><strong>Session token</strong> from <code>POST /api/auth/login</code>, sent as <code>Authorization: Bearer &lt;token&gt;</code>, <code>x-auth-token: &lt;token&gt;</code> or the <code>ud_auth_token</code> cookie the sign-in sets (never in the URL). An invalid or expired token answers <code>401</code> (except on <code>/api/auth/*</code> and <code>/api/bootstrap</code>).</li>
<li><strong>No token</strong>: the request runs as the user named by the <code>x-user-id</code> header (active, non-system accounts only) or, without it, as the local default admin (offline / single-user mode).</li>
<li>Every <code>POST / PUT / PATCH / DELETE</code> outside <code>/api/auth/*</code> needs write permission for the acting user, and broadcasts a <code>library-changed</code> event to <code>/api/events</code> listeners.</li>
<li><strong>Project scope</strong>: <code>x-project-id</code> header or <code>?projectId=</code> (default 1).</li>
<li>AI access keys (<code>kud_…</code>) are for the <a href="/docs/mcp">MCP endpoint</a>, not for this API.</li>
</ul>
<h2>Health</h2>
<p>Both health endpoints need no authentication, contain no secrets and <strong>always answer HTTP 200</strong>: read the <code>ok</code> field (a 5xx or a network error means the server itself is down).</p>
<ul>
<li><code>GET /api/health</code> → <code>{ ok, time, version, uptimeS, db: { ok, latencyMs } }</code></li>
<li><code>GET /api/health/mcp</code> → <code>{ ok, enabled, endpoint, protocolVersion, supportedProtocolVersions, server, tools, accountTools, resources, resourceTemplates, prompts, activeSessions, openStreams, time, reason? }</code></li>
</ul>
<h2>Other endpoints (outside the route table)</h2>
<div class="tbl"><table><tbody>
<tr><td><span class="m GET">GET</span></td><td><code>/api/events</code><div class="muted">Server-sent events: <code>hello</code> and <code>library-changed</code> with a version counter; ping every 25 s.</div></td></tr>
<tr><td><span class="m POST">POST</span></td><td><code>/mcp</code><div class="muted">MCP Streamable HTTP endpoint for AI coding agents — see the <a href="/docs/mcp">MCP reference</a>.</div></td></tr>
<tr><td><span class="m GET">GET</span></td><td><code>/docs/api</code>, <code>/docs/mcp</code><div class="muted">These reference pages.</div></td></tr>
<tr><td><span class="m GET">GET</span></td><td><code>/domain/*</code>, <code>/mcp-web/*</code>, <code>/*</code><div class="muted">Static files: shared domain modules, MCP web modules, the web app.</div></td></tr>
</tbody></table></div>
<h2>Routes</h2>
<p>${toc}</p>
${sections}`;
  return page('API reference — UI/UX Designer', body, '/api/health');
}

/* ---------- /docs/mcp ---------- */

const clip = (s, n = 220) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const typeOf = p => {
  if (!p || typeof p !== 'object') return '';
  if (p.enum) return p.enum.map(v => JSON.stringify(v)).join(' | ');
  if (p.type === 'array') return `${typeOf(p.items) || 'any'}[]`;
  return Array.isArray(p.type) ? p.type.join(' | ') : (p.type || 'any');
};
function schemaSummary(schema, extra = null) {
  const props = { ...(schema?.properties || {}), ...(extra || {}) };
  const req = new Set(schema?.required || []);
  const keys = Object.keys(props);
  if (!keys.length) return '<div class="muted">No arguments.</div>';
  return `<ul class="props">${keys.map(k => {
    const p = props[k];
    return `<li><code>${esc(k)}</code>${req.has(k) ? ' <strong>required</strong>' : ''} <span class="muted">${esc(clip(typeOf(p), 160))}</span>${extra && k in extra && !(k in (schema?.properties || {})) ? '<span class="badge">account keys</span>' : ''}${p?.description ? ` — ${esc(clip(p.description))}` : ''}</li>`;
  }).join('')}</ul>`;
}

const SETUP_CLIENTS = ['claude-code', 'codex', 'gemini', 'cursor', 'vscode', 'claude-desktop', 'generic'];

export function renderMcpDocs({ baseUrl = 'http://localhost:5180', status = null, tools = TOOLS, readme = null } = {}) {
  const url = `${baseUrl}/mcp`;
  const toolRows = tools.map(t => `<div class="card"><h3 id="t-${esc(t.name)}" style="margin:0 0 4px"><code>${esc(t.name)}</code>${t.title ? ` <span class="muted" style="font-weight:400">${esc(t.title)}</span>` : ''}
<span class="badge">scope: ${esc(t.scope || 'read')}</span>${t.accountOnly ? '<span class="badge">account keys only</span>' : ''}${t.readOnly === false ? '<span class="badge">writes</span>' : ''}</h3>
<div>${esc(t.description)}</div>${schemaSummary(t.inputSchema, t.accountProperties)}</div>`).join('\n');

  const setups = SETUP_CLIENTS.map(id => {
    let s;
    try { s = buildClientSetup({ client: id, url, key: '', keyKind: 'project' }); } catch { return ''; }
    const label = CLIENTS.find(c => c.id === id)?.label || id;
    return `<details class="card"><summary>${esc(label)}</summary>${s.steps.map(st => `<p><strong>${esc(st.title)}</strong>${st.path ? ` <span class="muted">(${esc(st.path)})</span>` : ''}</p><pre>${esc(st.text)}</pre>`).join('')}${s.notes?.length ? `<ul>${s.notes.map(n => `<li class="muted">${esc(n)}</li>`).join('')}</ul>` : ''}${s.prompt ? `<p>Then tell your agent: <code>${esc(s.prompt)}</code></p>` : ''}</details>`;
  }).join('\n');

  const st = status || {};
  const body = `<h1>MCP server reference</h1>
<p class="muted">${esc(SERVER_INFO.title)} · <code>${esc(SERVER_INFO.name)}</code> v${esc(SERVER_INFO.version)} · generated at ${esc(new Date().toISOString())}.</p>
${healthBox('/api/health/mcp', 'MCP health')}
<h2>Endpoint</h2>
<div class="tbl"><table><tbody>
<tr><th>URL</th><td><code>${esc(url)}</code></td></tr>
<tr><th>Transport</th><td>Streamable HTTP: <code>POST /mcp</code> one JSON-RPC message → JSON response (202 for notifications); <code>GET /mcp</code> with <code>Accept: text/event-stream</code> and <code>Mcp-Session-Id</code> opens the resource-update stream; <code>DELETE /mcp</code> ends a session. Batches are not supported.</td></tr>
<tr><th>Protocol</th><td><code>${esc(SUPPORTED_PROTOCOL_VERSIONS[0])}</code> (also ${SUPPORTED_PROTOCOL_VERSIONS.slice(1).map(v => `<code>${esc(v)}</code>`).join(', ')}); send <code>MCP-Protocol-Version</code> after initialize.</td></tr>
<tr><th>Auth</th><td><code>Authorization: Bearer kud_…</code> on every request. Create keys in the designer: profile icon → <em>AI access keys</em> (project keys or account keys). The key is shown once; keep it in an environment variable such as <code>${esc(DEFAULT_ENV_VAR)}</code>, never in a committed file.</td></tr>
<tr><th>Limits</th><td>1 MB request body, per-key rate limit (HTTP 429 with <code>retry-after</code>), Origin check against DNS rebinding, every tool call audited.</td></tr>
<tr><th>State</th><td>${status ? `${st.enabled ? 'enabled' : `disabled${st.reason ? ` — ${esc(st.reason)}` : ''}`} · ${esc(st.activeSessions ?? 0)} active sessions` : 'unknown'}</td></tr>
</tbody></table></div>
<h2>Tools (${tools.length})</h2>
<p class="muted">The list a key sees (<code>tools/list</code>) depends on its scopes and kind: project keys do not see the account-only tools.</p>
<p>${tools.map(t => `<a href="#t-${esc(t.name)}"><code>${esc(t.name)}</code></a>`).join(' ')}</p>
${toolRows}
<h2>Resources (${RESOURCES.length}) and templates (${RESOURCE_TEMPLATES.length})</h2>
<div class="tbl"><table><thead><tr><th>URI</th><th>Description</th></tr></thead><tbody>
${RESOURCES.map(r => `<tr><td><code>${esc(r.uri)}</code></td><td>${esc(r.title)}${r.description ? ` — <span class="muted">${esc(r.description)}</span>` : ''} <span class="badge">${esc(r.mimeType)}</span></td></tr>`).join('')}
${RESOURCE_TEMPLATES.map(r => `<tr><td><code>${esc(r.uriTemplate)}</code></td><td>${esc(r.title)} <span class="badge">${esc(r.mimeType)}</span></td></tr>`).join('')}
</tbody></table></div>
<h2>Prompts (${PROMPTS.length})</h2>
<div class="tbl"><table><tbody>
${PROMPTS.map(p => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.title)} — <span class="muted">${esc(p.description)}</span>${p.arguments?.length ? `<ul class="props">${p.arguments.map(a => `<li><code>${esc(a.name)}</code>${a.required ? ' <strong>required</strong>' : ''} — ${esc(a.description)}</li>`).join('')}</ul>` : ''}</td></tr>`).join('')}
</tbody></table></div>
<h2>Client setup</h2>
<p class="muted">Replace <code>${esc(KEY_PLACEHOLDER)}</code> with your key. The AI access keys modal generates the same snippets with your own key and server name.</p>
<pre>${esc(JSON.stringify({ mcpServers: { 'kyrpy-uiux': { type: 'http', url, headers: { Authorization: `Bearer \${${DEFAULT_ENV_VAR}}` } } } }, null, 2))}</pre>
${setups}
${readme ? `<h2>src/mcp/README.md</h2><details class="card"><summary>Show the MCP layer README</summary><pre style="white-space:pre-wrap">${esc(readme)}</pre></details>` : ''}`;
  return page('MCP reference — UI/UX Designer', body, '/api/health/mcp');
}

let README_CACHE;
export function mcpReadme() {
  if (README_CACHE === undefined) {
    try { README_CACHE = readFileSync(new URL('../../mcp/README.md', import.meta.url), 'utf8'); } catch { README_CACHE = null; }
  }
  return README_CACHE;
}
