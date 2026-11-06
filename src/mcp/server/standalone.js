/** Standalone MCP server: only /mcp and /mcp/bundles/*, for running the MCP service as its own process. */
import http from 'node:http';

export function createMcpOnlyServer(container) {
  if (!container.mcp?.http) throw new Error('MCP module is not available in this container');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'kyrpy-uiux-mcp' })); return; }
    if (!(await container.mcp.http(req, res, url))) res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
}
