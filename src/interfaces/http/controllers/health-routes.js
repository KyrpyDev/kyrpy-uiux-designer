/**
 * Health endpoints (no auth needed, no secrets in the output). Both always answer HTTP 200 and report
 * the state in `ok`, so the topbar indicator and monitors can tell "server up, MCP off" from "server down".
 *
 *   GET /api/health      { ok, time, version, uptimeS, db: { ok, latencyMs } }
 *   GET /api/health/mcp  { ok, enabled, endpoint, protocolVersion, supportedProtocolVersions, server,
 *                          tools, accountTools, resources, resourceTemplates, prompts, activeSessions, openStreams, time, reason? }
 */
import { readFileSync } from 'node:fs';
import { SUPPORTED_PROTOCOL_VERSIONS, SERVER_INFO, RESOURCES, RESOURCE_TEMPLATES, PROMPTS } from '../../../mcp/server/protocol.js';
import { TOOLS } from '../../../mcp/server/tools.js';

let VERSION = null;
try { VERSION = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version || null; } catch { /* unknown */ }
export const APP_VERSION = VERSION;

const STARTED = Date.now();

/** Cheap database probe: SELECT 1 with its latency. */
export function dbHealth(db) {
  if (!db?.prepare) return { ok: false, latencyMs: null, reason: 'no database' };
  const t = process.hrtime.bigint();
  try {
    const ok = db.prepare('SELECT 1 AS one').get()?.one === 1;
    return { ok, latencyMs: Number(process.hrtime.bigint() - t) / 1e6 };
  } catch { return { ok: false, latencyMs: null, reason: 'query failed' }; }
}

export function apiHealth(c) {
  const db = dbHealth(c.db);
  return { ok: db.ok, time: new Date().toISOString(), version: VERSION, uptimeS: Math.round((Date.now() - STARTED) / 1000), db: { ok: db.ok, latencyMs: db.latencyMs === null ? null : Math.round(db.latencyMs * 100) / 100 } };
}

export function mcpHealth(c) {
  const time = new Date().toISOString();
  const tools = c.mcp?.protocol?.tools ? [...c.mcp.protocol.tools.values()] : TOOLS;
  const base = {
    endpoint: '/mcp', protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0], supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    server: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    tools: tools.length, accountTools: tools.filter(t => t.accountOnly).length,
    resources: RESOURCES.length, resourceTemplates: RESOURCE_TEMPLATES.length, prompts: PROMPTS.length, time
  };
  if (process.env.MCP_MODE === 'off') return { ok: false, enabled: false, ...base, activeSessions: 0, openStreams: 0, reason: 'disabled (MCP_MODE=off)' };
  if (!c.mcp?.http) return { ok: false, enabled: false, ...base, activeSessions: 0, openStreams: 0, reason: 'MCP module not mounted in this server' };
  let st = { activeSessions: 0, openStreams: 0 };
  try { st = c.mcp.http.status?.() || st; } catch { return { ok: false, enabled: true, ...base, ...st, reason: 'MCP status failed' }; }
  const db = dbHealth(c.db);
  return { ok: db.ok, enabled: true, ...base, activeSessions: st.activeSessions, openStreams: st.openStreams, ...(db.ok ? {} : { reason: 'database unavailable' }) };
}

export function healthRoutes(router, c) {
  router.get('/api/health', () => apiHealth(c));
  router.get('/api/health/mcp', () => mcpHealth(c));
}
