/**
 * Topbar API / MCP health indicators. Each is a link that opens its reference page (/docs/api, /docs/mcp)
 * in a new tab and carries a status dot: green ok, amber slow (> 1.5 s) or degraded, red down, grey unknown.
 *
 * renderTopbar() rebuilds the topbar often, so the polling lives here as a module-level singleton: one timer,
 * one state per indicator; healthIndicators() returns fresh nodes, remembers them and paints the last result.
 */
import { h } from './dom.js';
import { iconEl } from './icons.js';

const POLL_MS = 30_000;
const TIMEOUT_MS = 5_000;
const SLOW_MS = 1_500;

const TARGETS = {
  api: { label: 'API', icon: 'globe', endpoint: '/api/health', docs: '/docs/api', name: 'REST API' },
  mcp: { label: 'MCP', icon: 'zap', endpoint: '/api/health/mcp', docs: '/docs/mcp', name: 'MCP server' }
};
const STATUS_TEXT = { ok: 'healthy', slow: 'slow', degraded: 'degraded', down: 'down', unknown: 'checking…' };

const state = Object.fromEntries(Object.keys(TARGETS).map(k => [k, { status: 'unknown', ms: null, at: null, reason: '' }]));
const nodes = new Map();          // key → the anchor currently in the DOM
let timer = null, inflight = null, started = false, listening = false;

function tipOf(key) {
  const t = TARGETS[key], s = state[key];
  const lines = [`${t.name}: ${STATUS_TEXT[s.status] || s.status}${s.reason ? ` — ${s.reason}` : ''}`];
  if (s.ms !== null) lines.push(`Latency ${s.ms} ms`);
  if (s.at) lines.push(`Checked ${s.at.toLocaleTimeString()}`);
  lines.push(`Click: open the ${t.label} reference in a new tab`);
  return lines.join('\n');
}

function paint(key) {
  const a = nodes.get(key);
  if (!a) return;
  const s = state[key];
  a.dataset.status = s.status;
  const tip = tipOf(key);
  a.setAttribute('data-tip', tip);
  a.setAttribute('aria-label', tip.replace(/\n/g, '. '));
}

async function probe(key) {
  const t = TARGETS[key];
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctl?.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    // plain fetch on purpose: no session token, so an expired login never turns the indicator red
    const r = await fetch(t.endpoint, { cache: 'no-store', signal: ctl?.signal, headers: { accept: 'application/json' } });
    const ms = Math.round(performance.now() - t0);
    const body = await r.json().catch(() => null);
    let status, reason = '';
    if (!r.ok || !body) { status = 'down'; reason = `HTTP ${r.status}`; }
    else if (!body.ok) {
      // server reachable but the part is off / failing: MCP disabled or unmounted is "down", anything else "degraded"
      status = key === 'mcp' && body.enabled === false ? 'down' : 'degraded';
      reason = body.reason || (body.db && !body.db.ok ? 'database unavailable' : 'not ok');
    } else {
      status = ms > SLOW_MS ? 'slow' : 'ok';
      if (key === 'mcp') reason = `${body.tools} tools, ${body.activeSessions} active sessions`;
      else if (body.version) reason = `v${body.version}`;
    }
    state[key] = { status, ms, at: new Date(), reason };
  } catch (e) {
    state[key] = { status: 'down', ms: null, at: new Date(), reason: e?.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : 'unreachable' };
  } finally { clearTimeout(to); }
  paint(key);
}

/** Probes every indicator now (coalesces overlapping calls). */
export function checkHealth() {
  if (!inflight) inflight = Promise.all(Object.keys(TARGETS).map(probe)).finally(() => { inflight = null; });
  return inflight;
}

function start() {
  if (started) return;
  started = true;
  timer = setInterval(() => { if (!document.hidden) checkHealth(); }, POLL_MS);
  checkHealth();
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkHealth(); });
  window.addEventListener('focus', () => checkHealth());
  window.addEventListener('online', () => checkHealth());
  window.addEventListener('offline', () => {
    for (const k of Object.keys(TARGETS)) { state[k] = { status: 'down', ms: null, at: new Date(), reason: 'browser offline' }; paint(k); }
  });
}

/** Fresh indicator nodes for a topbar render: [API, MCP]. */
export function healthIndicators() {
  const out = Object.entries(TARGETS).map(([key, t]) => {
    const a = h('a', {
      class: 'tb-health', href: t.docs, target: '_blank', rel: 'noopener', dataset: { health: key, status: state[key].status }
    }, h('span', { class: 'tb-health-dot', 'aria-hidden': 'true' }), iconEl(t.icon, { size: 15 }), h('span', { class: 'tb-health-label' }, t.label));
    nodes.set(key, a);
    return a;
  });
  for (const k of nodes.keys()) paint(k);
  start();
  return out;
}

/** Test / teardown hook. */
export function stopHealth() { if (timer) clearInterval(timer); timer = null; started = false; }
