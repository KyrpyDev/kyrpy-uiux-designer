/**
 * MCP Streamable HTTP transport (spec 2025-06-18), JSON responses only (no server-initiated SSE stream).
 *
 *   POST   /mcp                  one JSON-RPC message → application/json response (202 for notifications)
 *   GET    /mcp                  405 (no server → client stream in this version)
 *   DELETE /mcp                  ends the session named by Mcp-Session-Id
 *   GET    /mcp/bundles/<token>  single-use bundle download (no auth header; the token is the secret)
 *
 * Security: API key on every request (no caching, so revocation is immediate), Origin check against
 * DNS rebinding, body size cap, per-key rate limit, a limit on rejected keys per address, a cap on sessions
 * per key, audit log of every tool call.
 */
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../domain/errors.js';
import { RPC, SUPPORTED_PROTOCOL_VERSIONS } from './protocol.js';
import { publicBaseUrl } from '../../interfaces/http/base-url.js';

const MAX_BODY = 1024 * 1024;
const SESSION_TTL_MS = 24 * 3600 * 1000;
const MAX_SESSIONS_PER_KEY = 32;
const SWEEP_MS = 60_000;

const send = (res, status, body, headers = {}) => {
  const isJson = body !== undefined && typeof body !== 'string';
  res.writeHead(status, { 'cache-control': 'no-store', ...(isJson ? { 'content-type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
};
const rpcError = (code, message, id = null) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > MAX_BODY) throw new DomainError('request body too large', 'TOO_LARGE', 413);
    chunks.push(ch);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('invalid JSON', 'PARSE', 400); }
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];
const hostOf = v => { try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`).host.toLowerCase(); } catch { return ''; } };

/**
 * Origin is allowed when absent (non-browser clients), loopback, or listed in `extra` (MCP_ALLOWED_ORIGINS,
 * ALLOWED_ORIGINS, PUBLIC_BASE_URL: full origins or bare hosts).
 * The request's own `Host` header only counts when it is a loopback name: under DNS rebinding the browser sends
 * the attacker's domain as both Origin and Host, so "Origin equals Host" proves nothing for any other name.
 */
export function originAllowed(origin, host, extra = []) {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (LOOPBACK.includes(o.hostname)) return true;
    if (extra.some(x => x === o.origin || hostOf(x) === o.host.toLowerCase())) return true;
    return false;
  } catch { return false; }
}

export function createMcpHttpHandler({ apiKeys, protocol, bundles, limiter, allowedOrigins = [], versions = null, pollMs = 10_000 }) {
  // id → { apiKeyId, projectId, protocolVersion, lastSeen, subscriptions: Set<uri>, streams: Set<res> }
  const sessions = new Map();

  const closeStreams = s => { for (const r of s.streams || []) { try { r.end(); } catch { /* gone */ } } s.streams?.clear(); };
  const sweep = () => { const t = Date.now(); for (const [k, v] of sessions) if (t - v.lastSeen > SESSION_TTL_MS && !v.streams?.size) { closeStreams(v); sessions.delete(k); } };
  // expired sessions go on a timer, not on every request
  const sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref?.();
  /** A key that keeps initializing replaces its own oldest idle sessions instead of growing the table. */
  const capSessions = apiKeyId => {
    const own = [...sessions].filter(([, v]) => v.apiKeyId === apiKeyId).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    while (own.length >= MAX_SESSIONS_PER_KEY) { const [k, v] = own.shift(); closeStreams(v); sessions.delete(k); }
  };

  /** Sends notifications/resources/updated to every open stream of the project's sessions subscribed to the uri. */
  const notify = (projectId, uris) => {
    let sent = 0;
    for (const s of sessions.values()) {
      if (s.projectId !== Number(projectId) || !s.streams.size) continue;
      for (const uri of uris) {
        if (!s.subscriptions.has(uri)) continue;
        const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } })}\n\n`;
        for (const r of s.streams) { try { r.write(frame); sent++; } catch { /* closed */ } }
      }
    }
    return sent;
  };

  // designer edits only become a version when someone records the head: poll the projects that have listeners
  const poller = versions ? setInterval(() => {
    const projects = new Set([...sessions.values()].filter(s => s.streams.size && s.subscriptions.size).map(s => s.projectId));
    for (const pid of projects) { try { versions.ensureHead(pid); } catch { /* project gone */ } }
  }, pollMs) : null;
  poller?.unref?.();

  const baseUrlOf = publicBaseUrl;

  /** Checks the API key. Rejected keys are counted per client address; past the limit every attempt gets 429. */
  const authenticate = (req, ip) => {
    const fails = limiter.status('authfail', ip);
    if (fails.used >= fails.limit) throw new DomainError('too many rejected API keys from this address; try again later', 'RATE_LIMITED', 429);
    const header = String(req.headers.authorization || '');
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key) throw new DomainError('missing API key: send "Authorization: Bearer kud_…"', 'UNAUTHORIZED', 401);
    try { return apiKeys.authenticate(key, { ip }); }
    catch (e) { if (e?.status === 401 || e?.status === 403) limiter.hit('authfail', ip); throw e; }
  };

  /** Returns true when the request was an MCP request (handled), false otherwise. */
  const handle = async function handle(req, res, url) {
    const path = url.pathname;
    if (path !== '/mcp' && !path.startsWith('/mcp/')) return false;
    const ip = req.socket?.remoteAddress || '';
    try {
      if (!originAllowed(req.headers.origin, req.headers.host, allowedOrigins)) {
        send(res, 403, rpcError(RPC.INVALID_REQUEST, 'origin not allowed'));
        return true;
      }

      const bundleMatch = /^\/mcp\/bundles\/([A-Za-z0-9_-]{16,64})$/.exec(path);
      if (bundleMatch) {
        if (req.method !== 'GET') { send(res, 405, 'method not allowed', { allow: 'GET' }); return true; }
        const b = bundles.take(bundleMatch[1]);
        apiKeys.audit.record({ apiKeyId: b.apiKeyId, event: 'bundle.download', ip });
        res.writeHead(200, {
          'content-type': 'application/gzip', 'content-length': b.buffer.length, 'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${String(b.filename).replace(/[^A-Za-z0-9._-]/g, '_')}"`, 'x-content-sha256': b.sha256
        });
        res.end(b.buffer);
        return true;
      }
      if (path !== '/mcp') { send(res, 404, rpcError(RPC.METHOD_NOT_FOUND, 'not found')); return true; }

      if (req.method === 'GET') {
        if (!String(req.headers.accept || '').includes('text/event-stream')) { send(res, 405, 'GET needs Accept: text/event-stream', { allow: 'GET, POST, DELETE' }); return true; }
        const principal = authenticate(req, ip);
        const s = sessions.get(String(req.headers['mcp-session-id'] || ''));
        if (!s) { send(res, 400, rpcError(RPC.INVALID_REQUEST, 'a stream needs an initialized session (Mcp-Session-Id)')); return true; }
        if (s.apiKeyId !== principal.apiKeyId) { send(res, 403, rpcError(RPC.INVALID_REQUEST, 'session belongs to another API key')); return true; }
        if (s.streams.size >= 2) { send(res, 409, rpcError(RPC.INVALID_REQUEST, 'this session already has open streams')); return true; }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': kyrpy-uiux-mcp stream open\n\n');
        s.streams.add(res);
        const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
        beat.unref?.();
        req.on('close', () => { clearInterval(beat); s.streams.delete(res); });
        return true;
      }
      if (req.method === 'DELETE') {
        // ending a session needs the key that opened it
        const principal = authenticate(req, ip);
        const sid = req.headers['mcp-session-id'];
        const s = sid ? sessions.get(String(sid)) : null;
        if (s && s.apiKeyId !== principal.apiKeyId) { send(res, 403, rpcError(RPC.INVALID_REQUEST, 'session belongs to another API key')); return true; }
        if (s) { closeStreams(s); sessions.delete(String(sid)); }
        send(res, 200, '');
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, 'method not allowed', { allow: 'POST, DELETE' }); return true; }

      const principal = authenticate(req, ip);
      const rl = limiter.hit('calls', principal.apiKeyId);
      if (!rl.ok) { send(res, 429, rpcError(RPC.INVALID_REQUEST, `rate limit exceeded; retry in ${rl.retryAfterSec}s`), { 'retry-after': String(rl.retryAfterSec) }); return true; }

      const pv = req.headers['mcp-protocol-version'];
      if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(String(pv))) {
        send(res, 400, rpcError(RPC.INVALID_REQUEST, `unsupported MCP-Protocol-Version ${pv}; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`));
        return true;
      }

      let msg;
      try { msg = await readJson(req); }
      catch (e) { send(res, e.status === 413 ? 413 : 400, rpcError(RPC.PARSE, e.message)); return true; }
      if (Array.isArray(msg)) { send(res, 400, rpcError(RPC.INVALID_REQUEST, 'JSON-RPC batches are not supported')); return true; }

      const headers = {};
      const sid = req.headers['mcp-session-id'] ? String(req.headers['mcp-session-id']) : null;
      if (msg?.method === 'initialize') {
        const id = randomUUID();
        capSessions(principal.apiKeyId);
        sessions.set(id, { apiKeyId: principal.apiKeyId, projectId: principal.project?.id ?? null, protocolVersion: protocol.negotiate(msg.params?.protocolVersion), lastSeen: Date.now(), subscriptions: new Set(), streams: new Set() });
        headers['mcp-session-id'] = id;
      } else if (sid) {
        const s = sessions.get(sid);
        if (!s) { send(res, 404, rpcError(RPC.INVALID_REQUEST, 'unknown or expired session; initialize again')); return true; }
        if (s.apiKeyId !== principal.apiKeyId) { send(res, 403, rpcError(RPC.INVALID_REQUEST, 'session belongs to another API key')); return true; }
        s.lastSeen = Date.now();
      }

      const session = headers['mcp-session-id'] ? sessions.get(headers['mcp-session-id']) : sid ? sessions.get(sid) : null;
      const out = await protocol.handle(msg, { principal, ip, baseUrl: baseUrlOf(req), session });
      if (out === null) { send(res, 202, '', headers); return true; }
      send(res, 200, out, headers);
      return true;
    } catch (e) {
      if (e instanceof DomainError) {
        const h = e.status === 401 ? { 'www-authenticate': 'Bearer realm="kyrpy-uiux-mcp"' } : {};
        send(res, e.status, rpcError(e.status === 401 ? RPC.INVALID_REQUEST : RPC.INVALID_REQUEST, e.message), h);
        return true;
      }
      console.error('[mcp http]', e);
      send(res, 500, rpcError(RPC.INTERNAL, 'internal error'));
      return true;
    }
  };
  handle.notify = notify;
  handle.sessions = sessions;
  /** Public, secret-free counters for GET /api/health/mcp. */
  handle.status = () => {
    sweep();
    let openStreams = 0;
    for (const s of sessions.values()) openStreams += s.streams?.size || 0;
    return { activeSessions: sessions.size, openStreams };
  };
  handle.stop = () => { clearInterval(sweeper); if (poller) clearInterval(poller); for (const s of sessions.values()) closeStreams(s); };
  return handle;
}
