/**
 * Lazy icon data for large libraries (thousands of pack icons). The library list only carries icon summaries
 * (no nodes), so this module:
 *  - keeps an in-memory cache of full icon geometry, fetched by id in batches (`requestIconNodes`) when a
 *    render meets an icon whose nodes are unknown; `icons:loaded` is emitted so views re-render;
 *  - appends `<symbol>`s of just the icons on screen to the shared sprite (`ensureIconSymbols`), fetched in
 *    batches from `/api/icons/sprite` (ETag-revalidated) for the current theme.
 * Both caches are dropped when the server's icon version changes (`syncIconVersion`).
 */
import { api } from './api.js';
import { state, emit } from './state.js';

const full = new Map();              // id -> { key, width, height, nodes }
const wantNodes = new Set(), fetchingNodes = new Set(), failedNodes = new Set();
let nodesTimer = null;
let version = '';

const spriteLoaded = new Set();      // icon ids whose symbol is in #sprite-host for spriteTheme
const wantSymbols = new Set(), fetchingSymbols = new Set();
let symbolsTimer = null;
let spriteTheme = null;
let spriteEpoch = 0;                 // bumps on every sprite reset so late responses are ignored

const BATCH = 150;

/** Called with every library load; a new server icon version invalidates both caches. */
export function syncIconVersion(v) {
  if (!v || v === version) return false;
  const first = !version;
  version = v;
  if (!first) { full.clear(); failedNodes.clear(); }
  return !first;
}

/** Cached full geometry of an icon, or undefined. */
export const cachedIcon = id => full.get(id);
export const cachedIconCount = () => full.size;

/** Queues ids whose nodes are needed; one batched request per tick. */
export function requestIconNodes(ids) {
  for (const id of ids) if (id && !full.has(id) && !fetchingNodes.has(id) && !failedNodes.has(id)) wantNodes.add(id);
  if (!wantNodes.size || nodesTimer) return;
  nodesTimer = setTimeout(flushNodes, 16);
}

async function flushNodes() {
  nodesTimer = null;
  const ids = [...wantNodes].slice(0, BATCH);
  ids.forEach(id => { wantNodes.delete(id); fetchingNodes.add(id); });
  if (wantNodes.size) nodesTimer = setTimeout(flushNodes, 0);
  const v = version;
  try {
    const r = await api.iconsFull(ids);
    if (v !== version) return;
    const got = new Set();
    for (const it of r?.items || []) { full.set(it.id, { key: it.key, width: it.width, height: it.height, nodes: it.nodes || [] }); got.add(it.id); }
    ids.forEach(id => { if (!got.has(id)) failedNodes.add(id); });
    if (got.size) emit('icons:loaded', [...got]);
  } catch (e) {
    ids.forEach(id => failedNodes.add(id));
    console.warn('icon fetch failed', e);
  } finally {
    ids.forEach(id => fetchingNodes.delete(id));
  }
}

/** Fetches full icon records now (e.g. before a drop), resolving once they are cached. */
export async function loadIcons(ids) {
  const missing = [...new Set(ids)].filter(id => id && !full.has(id));
  for (let i = 0; i < missing.length; i += BATCH) {
    const r = await api.iconsFull(missing.slice(i, i + BATCH));
    for (const it of r?.items || []) full.set(it.id, { key: it.key, width: it.width, height: it.height, nodes: it.nodes || [] });
  }
  if (missing.length) emit('icons:loaded', missing);
  return ids.map(id => full.get(id)).filter(Boolean);
}

/* ---------------- sprite symbols ---------------- */

/** The sprite was rebuilt (theme or library change): `ids` are the symbols it now holds. */
export function resetSprite(ids, theme) {
  spriteLoaded.clear();
  for (const id of ids) spriteLoaded.add(id);
  wantSymbols.clear();
  fetchingSymbols.clear();
  spriteTheme = theme;
  spriteEpoch++;
  emit('sprite:reset');
}

/** Marks symbols appended by someone else (e.g. locally rendered after a node load). */
export function markSymbols(ids) { for (const id of ids) spriteLoaded.add(id); }
export const hasSymbol = id => spriteLoaded.has(id);

/** Makes sure the shared sprite holds symbols for these icon ids (fetches the missing ones in batches). */
export function ensureIconSymbols(ids) {
  for (const id of ids) if (id && !spriteLoaded.has(id) && !fetchingSymbols.has(id)) wantSymbols.add(id);
  if (!wantSymbols.size || symbolsTimer) return;
  symbolsTimer = setTimeout(flushSymbols, 16);
}

async function flushSymbols() {
  symbolsTimer = null;
  const ids = [...wantSymbols].slice(0, BATCH);
  ids.forEach(id => { wantSymbols.delete(id); fetchingSymbols.add(id); });
  if (wantSymbols.size) symbolsTimer = setTimeout(flushSymbols, 0);
  const epoch = spriteEpoch, theme = spriteTheme || state.themeKey;
  try {
    const svg = await api.iconSprite(ids, theme);
    if (epoch !== spriteEpoch) return;
    appendSymbols(svg);
    ids.forEach(id => spriteLoaded.add(id));
    emit('sprite:symbols', ids);
  } catch (e) {
    console.warn('icon sprite fetch failed', e);
  } finally {
    if (epoch === spriteEpoch) ids.forEach(id => fetchingSymbols.delete(id));
  }
}

/** Moves the `<symbol>`s of an sprite document into the shared sprite's `<defs>` (replacing same ids). */
export function appendSymbols(svgText) {
  const host = document.getElementById('sprite-host');
  if (!host || !svgText) return;
  let defs = host.querySelector('svg > defs');
  if (!defs) {
    host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs></defs></svg>';
    defs = host.querySelector('svg > defs');
  }
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const frag = document.createDocumentFragment();
  for (const sym of doc.querySelectorAll('symbol')) {
    const old = sym.id ? defs.querySelector(`symbol[id="${CSS.escape(sym.id)}"]`) : null;
    if (old) old.remove();
    frag.appendChild(document.importNode(sym, true));
  }
  defs.appendChild(frag);
}
