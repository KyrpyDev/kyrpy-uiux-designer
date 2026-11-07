/**
 * Public base URL of a request behind reverse proxies.
 *
 * Each proxy may append to X-Forwarded-Proto / X-Forwarded-Host, producing a comma list such as "https,http".
 * Only the first (client-facing) entry is used; the scheme must be http or https and the host a plain
 * host[:port] — anything else falls back to the socket / Host header, so a forged header can never end up
 * in generated download URLs, config files or docs pages.
 */
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/i;

const first = v => String(Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0].trim();

export function publicBaseUrl(req) {
  const fp = first(req.headers['x-forwarded-proto']).toLowerCase();
  const proto = fp === 'http' || fp === 'https' ? fp : (req.socket?.encrypted ? 'https' : 'http');
  const fh = first(req.headers['x-forwarded-host']);
  const own = first(req.headers.host);
  const host = HOST_RE.test(fh) ? fh : (HOST_RE.test(own) ? own : 'localhost');
  return `${proto}://${host}`;
}
