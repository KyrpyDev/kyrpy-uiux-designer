import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Router } from './router.js';
import { designRoutes } from './controllers/design-routes.js';
import { miscRoutes } from './controllers/misc-routes.js';
import { collabRoutes } from './controllers/collab-routes.js';
import { DomainError } from '../../domain/errors.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 64 * 1024 * 1024;

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const ch of req) { size += ch.length; if (size > MAX_BODY) throw new DomainError('request body too large', 'TOO_LARGE', 413); chunks.push(ch); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('invalid JSON body', 'BAD_JSON', 400); }
}

async function serveFile(res, root, rel) {
  const safe = normalize(rel).replace(/^([/\\])+/, '');
  if (safe.split(sep).includes('..')) { res.writeHead(403).end('forbidden'); return; }
  const file = join(root, safe);
  try {
    const st = await stat(file);
    const target = st.isDirectory() ? join(file, 'index.html') : file;
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0'
    }).end(data);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); }
}

/** Builds the node http server around the container's use cases. Static: /domain/* (shared pure code) and the web app. */
export function createHttpServer(container, { webRoot, domainRoot }) {
  const router = new Router();
  designRoutes(router, container);
  miscRoutes(router, container);
  collabRoutes(router, container);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const hit = router.match(req.method, url.pathname);
        if (!hit) throw new DomainError(`no route ${req.method} ${url.pathname}`, 'NO_ROUTE', 404);
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
        const authHeader = String(req.headers.authorization || '');
        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : (req.headers['x-auth-token'] || url.searchParams.get('token') || null);
        const headerUserId = req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null;
        const headerProjectId = req.headers['x-project-id'] ? Number(req.headers['x-project-id']) : null;
        let actor;
        if (container.auth) {
          if (token && !url.pathname.startsWith('/api/auth/')) {
            actor = container.auth.resolveActor({ token, allowDefault: false });
            if (!actor) throw new DomainError('Invalid or expired session token', 'UNAUTHORIZED', 401);
          } else {
            actor = container.auth.resolveActor({ token, userId: headerUserId, allowDefault: true });
          }
          const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
          if (isMutation && !url.pathname.startsWith('/api/auth/')) {
            container.auth.assertCanWrite(actor);
          }
        } else {
          actor = { id: 1, username: 'kyrpy', role: 'admin' };
        }
        const projectId = headerProjectId || (url.searchParams.get('projectId') ? Number(url.searchParams.get('projectId')) : 1);
        const out = await hit.handler({ params: hit.params, query: url.searchParams, body, token, actor, projectId });
        if (out && out.raw !== undefined) {
          const h = { 'content-type': out.contentType || 'text/plain', 'cache-control': 'no-store' };
          if (out.filename) h['content-disposition'] = `attachment; filename="${out.filename}"`;
          res.writeHead(200, h).end(out.raw);
        } else res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(out ?? null));
        return;
      }
      if (url.pathname === '/favicon.ico') {
        const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><circle cx="16" cy="16" r="9" fill="none" stroke="#2e9bff" stroke-width="3"/></svg>';
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' }).end(svgIcon);
        return;
      }
      if (url.pathname.startsWith('/domain/')) return serveFile(res, domainRoot, url.pathname.slice('/domain/'.length));
      return serveFile(res, webRoot, url.pathname === '/' ? 'index.html' : url.pathname);
    } catch (e) {
      const status = e instanceof DomainError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'content-type': MIME['.json'] }).end(JSON.stringify({ error: { code: e.code || 'INTERNAL', message: status === 500 ? 'internal error' : e.message, details: e.details } }));
    }
  });
}
