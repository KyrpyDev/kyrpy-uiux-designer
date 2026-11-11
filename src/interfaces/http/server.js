import http from 'node:http';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { buildApiRouter } from './api-catalog.js';
import { mcpHealth } from './controllers/health-routes.js';
import { renderApiDocs, renderMcpDocs, mcpReadme } from './docs-pages.js';
import { DomainError } from '../../domain/errors.js';
import { publicBaseUrl } from './base-url.js';
import { checkQuery, checkBody } from './input.js';
import { checkBodyShape } from './body-schemas.js';
import { createHash, randomBytes } from 'node:crypto';

/** GET routes whose (large) answer is revalidated with an ETag instead of being sent again. */
const REVALIDATED = new Set(['/api/library', '/api/catalog/search']);
const BOOT = randomBytes(4).toString('hex');
const stampStatements = new WeakMap();
/**
 * ETag of a read-only answer: it changes with any write to the database (this connection: `total_changes()`,
 * other connections / processes: `PRAGMA data_version`), with the user, the active project, the query and the
 * server start. Returns null when the database cannot say (the answer is then sent in full).
 */
function dataEtag(container, actor, projectId, url) {
  const db = container.db;
  if (!db?.prepare) return null;
  try {
    let st = stampStatements.get(db);
    if (!st) stampStatements.set(db, st = { changes: db.prepare('SELECT total_changes() AS n'), version: db.prepare('PRAGMA data_version') });
    const stamp = `${BOOT}.${st.changes.get().n}.${st.version.get().data_version}`;
    const scope = createHash('sha1').update(`${actor?.id ?? 0}|${actor?.role ?? ''}|${projectId}|${url.pathname}?${url.searchParams}`).digest('hex').slice(0, 12);
    return `W/"${stamp}-${scope}"`;
  } catch { return null; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 64 * 1024 * 1024;
const gzipAsync = promisify(gzip);   // large answers are compressed on the thread pool, not on the event loop

/** Hosts a browser may send mutations from: the request's own host (direct or behind the proxy), loopback, ALLOWED_ORIGINS. */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;   // not a browser cross-origin request (curl, MCP clients, same-origin GET navigation)
  let host;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const own = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',')].map(h => String(h || '').trim().toLowerCase()).filter(Boolean);
  try { own.push(new URL(publicBaseUrl(req)).host.toLowerCase()); } catch { /* no base url */ }
  if (own.includes(host)) return true;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return true;
  return String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')).filter(Boolean).includes(host);
}

/** Session token of the `ud_auth_token` cookie: what `<img src="/api/…/svg">` and downloads send (they cannot set a header). */
function cookieToken(req) {
  const m = /(?:^|;\s*)ud_auth_token=([^;]+)/.exec(String(req.headers.cookie || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/** `content-disposition` value for a download: an ASCII fallback name plus the UTF-8 name (RFC 6266); no quotes, slashes or control characters. */
export function attachmentHeader(filename) {
  const clean = String(filename || 'download').replace(/[\u0000-\u001f\u007f"\\/]/g, '_').slice(0, 200) || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

const ITEM_EDIT = /^\/api\/(paths|icons|buttons|elements|screens)\/\d+(\/(nodes|animations|menu)(\/.*)?)?$/;

/**
 * What a successful write changed, for the live-sync event: `'item'` = only the design in the path (an edit of the
 * record, or any write to its nodes / animations / menu), so clients refresh that one design; `'list'` = anything
 * else (create, delete, reorder, clone, imports, projects ...), so clients reload their lists.
 */
export function changeScope(path = '', method = '') {
  const m = ITEM_EDIT.exec(path);
  if (!m) return 'list';
  if (m[2]) return 'item';
  return method === 'PUT' || method === 'PATCH' ? 'item' : 'list';
}

async function readBody(req) {
  // a cross-site "simple request" (form or text/plain body) must never be parsed as an API call
  if (/^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/i.test(String(req.headers['content-type'] || ''))) {
    throw new DomainError('send JSON (content-type: application/json)', 'UNSUPPORTED_MEDIA_TYPE', 415);
  }
  const chunks = []; let size = 0;
  for await (const ch of req) { size += ch.length; if (size > MAX_BODY) throw new DomainError('request body too large', 'TOO_LARGE', 413); chunks.push(ch); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('invalid JSON body', 'BAD_JSON', 400); }
}

async function serveFile(res, root, rel, req = null) {
  const safe = normalize(rel).replace(/^([/\\])+/, '');
  if (safe.split(sep).includes('..')) { res.writeHead(403).end('forbidden'); return; }
  const file = join(root, safe);
  try {
    const st = await stat(file);
    const target = st.isDirectory() ? join(file, 'index.html') : file;
    // revalidate on every load (`no-cache`), but answer 304 while the file is unchanged: no re-read, no re-download
    const ts = st.isDirectory() ? await stat(target) : st;
    const etag = `W/"${ts.size.toString(36)}-${Math.round(ts.mtimeMs).toString(36)}"`;
    const head = { 'content-type': MIME[extname(target)] || 'application/octet-stream', 'cache-control': 'no-cache', etag };
    if (req?.headers['if-none-match'] === etag) { res.writeHead(304, head).end(); return; }
    res.writeHead(200, head).end(await readFile(target));
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); }
}

/** Builds the node http server around the container's use cases. Static: /domain/* (shared pure code) and the web app. */
export function createHttpServer(container, { webRoot, domainRoot }) {
  const mcpWebRoot = fileURLToPath(new URL('../../mcp/interfaces/web/', import.meta.url));
  const router = buildApiRouter(container);

  // Sync signal: every successful write bumps the library version and tells connected clients to re-sync,
  // so their cached lists (including duplicates or stale rows) are replaced with the server's copy.
  const syncClients = new Set();
  let syncVersion = 0;
  const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE'];
  // the design a write touched (e.g. PUT /api/buttons/12/menu/items/3 -> button 12) lets clients refresh just that one at once
  const PLURAL_TYPES = { paths: 'path', icons: 'icon', buttons: 'button', elements: 'element', screens: 'screen' };
  const touched = path => { const m = /^\/api\/(paths|icons|buttons|elements|screens)\/(\d+)(?:\/|$)/.exec(path || ''); return m ? { designType: PLURAL_TYPES[m[1]], designId: Number(m[2]) } : {}; };
  const broadcastSync = (path = '', method = '') => {
    syncVersion += 1;
    const scope = changeScope(path, method);
    const msg = `data: ${JSON.stringify({ type: 'library-changed', version: syncVersion, scope, ...touched(path) })}\n\n`;
    for (const c of syncClients) c.write(msg);
  };
  container.notifySync = broadcastSync;

  // A write repeated with the same `x-idempotency-key` by the same user (the offline queue replays a write whose
  // answer was lost) is answered from here instead of being done twice. Kept for an hour, at most 1000 answers;
  // a large answer is replaced by a short note (the client reloads what it needs).
  const replays = new Map();
  const REPLAY_TTL = 3600 * 1000, REPLAY_MAX = 1000, REPLAY_BODY_MAX = 32 * 1024;
  const replayKey = (req, actor, url) => {
    const k = String(req.headers['x-idempotency-key'] || '').trim();
    return k && k.length <= 100 && actor?.id ? `${actor.id}|${req.method}|${url.pathname}|${k}` : null;
  };

  // housekeeping: expired sessions go once an hour (they were only removed when their token was presented again)
  const purgeSessions = () => { try { container.users?.purgeExpiredSessions?.(); } catch { /* closed db */ } };
  purgeSessions();
  const purgeTimer = setInterval(purgeSessions, 3600 * 1000);
  purgeTimer.unref?.();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // MCP endpoint for AI coding agents (src/mcp); MCP_MODE=off disables it
      if (container.mcp?.http && process.env.MCP_MODE !== 'off' && await container.mcp.http(req, res, url)) return;
      if (url.pathname === '/api/events') {
        if (container.auth && !container.auth.getAuthConfig().bypassLogin
          && !container.auth.resolveActor({ token: cookieToken(req), allowDefault: false })) {
          res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Sign in to use the API"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 3000\ndata: ${JSON.stringify({ type: 'hello', version: syncVersion })}\n\n`);
        syncClients.add(res);
        const beat = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(beat); syncClients.delete(res); });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const hit = router.match(req.method, url.pathname);
        if (!hit) throw new DomainError(`no route ${req.method} ${url.pathname}`, 'NO_ROUTE', 404);
        if (MUTATIONS.includes(req.method) && !originAllowed(req)) throw new DomainError('cross-origin request refused', 'FORBIDDEN_ORIGIN', 403);
        // the session token comes from a header or the HttpOnly cookie, never from the URL (URLs end up in logs and history)
        const authHeader = String(req.headers.authorization || '');
        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : (req.headers['x-auth-token'] || cookieToken(req) || null);
        const headerUserId = req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null;
        const headerProjectId = req.headers['x-project-id'] ? Number(req.headers['x-project-id']) : null;
        let actor;
        if (container.auth) {
          // open routes: sign-in / register / auth config, health, and the bootstrap the sign-in page needs
          const open = url.pathname.startsWith('/api/auth/') || url.pathname === '/api/bootstrap' || url.pathname.startsWith('/api/health');
          // release mode (requireAuth): only a valid session identifies a user; the x-user-id header and the
          // default-admin fallback exist for the local dev bypass only
          const bypass = container.auth.getAuthConfig().bypassLogin;
          if (token && !open) {
            actor = container.auth.resolveActor({ token, allowDefault: false });
            if (!actor) throw new DomainError('Invalid or expired session token', 'UNAUTHORIZED', 401);
          } else {
            actor = container.auth.resolveActor({ token, userId: bypass ? headerUserId : null, allowDefault: bypass });
            if (!actor && !open) throw new DomainError('Sign in to use the API', 'UNAUTHORIZED', 401);
          }
          const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
          if (isMutation && !url.pathname.startsWith('/api/auth/')) {
            container.auth.assertCanWrite(actor);
          }
        } else {
          actor = { id: 1, username: 'superadmin', role: 'admin' };
        }
        // the body (up to 64 MB) is only read for a caller that passed the checks above
        const body = MUTATIONS.includes(req.method) ? checkBodyShape(req.method, hit.pattern, checkBody(await readBody(req))) : {};
        checkQuery(url.searchParams);
        const projectId = headerProjectId || (url.searchParams.get('projectId') ? Number(url.searchParams.get('projectId')) : 1);
        const ip = req.socket?.remoteAddress || '';
        const baseUrl = publicBaseUrl(req);
        const rk = MUTATIONS.includes(req.method) && !url.pathname.startsWith('/api/auth/') ? replayKey(req, actor, url) : null;
        const seen = rk ? replays.get(rk) : null;
        if (seen && Date.now() - seen.at < REPLAY_TTL) {
          res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'x-idempotent-replay': '1' }).end(seen.json);
          return;
        }
        // large read-only answers: unchanged database + same user + same query -> 304 before the handler runs
        const dataTag = req.method === 'GET' && REVALIDATED.has(url.pathname) ? dataEtag(container, actor, projectId, url) : null;
        if (dataTag && String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(dataTag)) {
          res.writeHead(304, { etag: dataTag, 'cache-control': 'private, no-cache', vary: 'Authorization, Cookie, X-Project-Id' }).end();
          return;
        }
        const out = await hit.handler({ params: hit.params, query: url.searchParams, body, token, actor, projectId, ip, baseUrl });
        if (rk && !(out && out.raw !== undefined)) {
          const json = JSON.stringify(out ?? null);
          replays.set(rk, { at: Date.now(), json: json.length <= REPLAY_BODY_MAX ? json : '{"replayed":true}' });
          if (replays.size > REPLAY_MAX) replays.delete(replays.keys().next().value);
        }
        if (MUTATIONS.includes(req.method) && !url.pathname.startsWith('/api/auth/')) broadcastSync(url.pathname, req.method);
        // the session cookie is kept by the server (HttpOnly): images and downloads cannot send the token header.
        // A sign-in sets it, a sign-out clears it, and any call that proves a session with the header repairs it
        // (pages that were open before this cookie existed start loading their previews again).
        const fresh = /^\/api\/auth\/(login|register|dev-bypass)$/.test(url.pathname) && out?.token ? out.token : null;
        const live = fresh || (token && actor && container.auth && cookieToken(req) !== token ? token : null);
        const secure = baseUrl.startsWith('https:') ? '; Secure' : '';
        if (url.pathname === '/api/auth/logout') res.setHeader('set-cookie', `ud_auth_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
        else if (live) res.setHeader('set-cookie', `ud_auth_token=${encodeURIComponent(live)}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}`);
        if (out && out.raw !== undefined) {
          const h = { 'content-type': out.contentType || 'text/plain', 'cache-control': out.cacheControl || 'no-store' };
          if (out.filename) h['content-disposition'] = attachmentHeader(out.filename);
          if (out.etag) {
            h.etag = out.etag;
            // conditional GET: unchanged content (e.g. an icon sprite batch) answers 304 without a body
            if (req.method === 'GET' && String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(out.etag)) { res.writeHead(304, h).end(); return; }
          }
          res.writeHead(200, h).end(out.raw);
        } else {
          const json = JSON.stringify(out ?? null);
          const h = dataTag
            ? { 'content-type': MIME['.json'], 'cache-control': 'private, no-cache', etag: dataTag, vary: 'Authorization, Cookie, X-Project-Id' }
            : { 'content-type': MIME['.json'], 'cache-control': 'no-store' };
          // large payloads (the library list with thousands of icons) go out gzipped when the client accepts it
          if (json.length > 64 * 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
            const packed = await gzipAsync(json, { level: 4 });
            res.writeHead(200, { ...h, 'content-encoding': 'gzip', vary: h.vary ? `${h.vary}, Accept-Encoding` : 'Accept-Encoding' }).end(packed);
          } else res.writeHead(200, h).end(json);
        }
        return;
      }
      // reference pages (opened from the topbar API / MCP status icons)
      if ((url.pathname === '/docs/api' || url.pathname === '/docs/mcp') && req.method === 'GET') {
        const baseUrl = publicBaseUrl(req);
        const html = url.pathname === '/docs/api'
          ? renderApiDocs(router.list())
          : renderMcpDocs({ baseUrl, status: mcpHealth(container), tools: container.mcp?.protocol?.tools ? [...container.mcp.protocol.tools.values()] : undefined, readme: mcpReadme() });
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(html);
        return;
      }
      if (url.pathname === '/favicon.ico') {
        const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><circle cx="16" cy="16" r="9" fill="none" stroke="#2e9bff" stroke-width="3"/></svg>';
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' }).end(svgIcon);
        return;
      }
      if (url.pathname.startsWith('/domain/')) return serveFile(res, domainRoot, url.pathname.slice('/domain/'.length), req);
      if (url.pathname.startsWith('/mcp-web/')) return serveFile(res, mcpWebRoot, url.pathname.slice('/mcp-web/'.length), req);
      return serveFile(res, webRoot, url.pathname === '/' ? 'index.html' : url.pathname, req);
    } catch (e) {
      const status = e instanceof DomainError ? e.status : 500;
      if (status === 500) console.error(e);
      const eh = { 'content-type': MIME['.json'] };
      if (e.retryAfterSec) eh['retry-after'] = String(e.retryAfterSec);
      res.writeHead(status, eh).end(JSON.stringify({ error: { code: e.code || 'INTERNAL', message: status === 500 ? 'internal error' : e.message, details: e.details } }));
    }
  });
}
