/**
 * MCP Streamable HTTP transport (spec 2025-06-18), JSON responses only (no server-initiated SSE stream).
 *
 *   POST   /mcp                  one JSON-RPC message → application/json response (202 for notifications)
 *   GET    /mcp                  405 (no server → client stream in this version)
 *   DELETE /mcp                  ends the session named by Mcp-Session-Id
 *   GET    /mcp/bundles/<token>  single-use bundle download (no auth header; the token is the secret)
 *
 * Security: API key on every request (no caching, so revocation is immediate), Origin check against
 * DNS rebinding, body size cap, per-key rate limit, audit log of every tool call.
 */
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../domain/errors.js';
import { RPC, SUPPORTED_PROTOCOL_VERSIONS } from './protocol.js';

const MAX_BODY = 1024 * 1024;
const SESSION_TTL_MS = 24 * 3600 * 1000;

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

/** Origin is allowed when absent (non-browser clients), loopback, or the server's own host. */
export function originAllowed(origin, host, extra = []) {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(o.hostname)) return true;
    if (host && o.host === host) return true;
    return extra.includes(o.origin);
  } catch { return false; }
}

export function createMcpHttpHandler({ apiKeys, protocol, bundles, limiter, allowedOrigins = [] }) {
  const sessions = new Map();   // id → { apiKeyId, protocolVersion, lastSeen }

  const sweep = () => { const t = Date.now(); for (const [k, v] of sessions) if (t - v.lastSeen > SESSION_TTL_MS) sessions.delete(k); };

  const baseUrlOf = req => {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  };

  const authenticate = (req, ip) => {
    const header = String(req.headers.authorization || '');
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key) throw new DomainError('missing API key: send "Authorization: Bearer kud_…"', 'UNAUTHORIZED', 401);
    return apiKeys.authenticate(key, { ip });
  };

  /** Returns true when the request was an MCP request (handled), false otherwise. */
  return async function handle(req, res, url) {
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
          'content-disposition': `attachment; filename="${b.filename}"`, 'x-content-sha256': b.sha256
        });
        res.end(b.buffer);
        return true;
      }
      if (path !== '/mcp') { send(res, 404, rpcError(RPC.METHOD_NOT_FOUND, 'not found')); return true; }

      if (req.method === 'GET') { send(res, 405, 'this server does not offer a server-to-client stream', { allow: 'POST, DELETE' }); return true; }
      if (req.method === 'DELETE') {
        const sid = req.headers['mcp-session-id'];
        if (sid) sessions.delete(String(sid));
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

      sweep();
      const headers = {};
      const sid = req.headers['mcp-session-id'] ? String(req.headers['mcp-session-id']) : null;
      if (msg?.method === 'initialize') {
        const id = randomUUID();
        sessions.set(id, { apiKeyId: principal.apiKeyId, protocolVersion: protocol.negotiate(msg.params?.protocolVersion), lastSeen: Date.now() });
        headers['mcp-session-id'] = id;
      } else if (sid) {
        const s = sessions.get(sid);
        if (!s) { send(res, 404, rpcError(RPC.INVALID_REQUEST, 'unknown or expired session; initialize again')); return true; }
        if (s.apiKeyId !== principal.apiKeyId) { send(res, 403, rpcError(RPC.INVALID_REQUEST, 'session belongs to another API key')); return true; }
        s.lastSeen = Date.now();
      }

      const out = await protocol.handle(msg, { principal, ip, baseUrl: baseUrlOf(req) });
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
}
