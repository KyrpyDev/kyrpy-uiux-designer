/**
 * Online icon sources (free APIs): search, preview and import of SVG icons from the Iconify API (https://api.iconify.design),
 * which serves 200k+ vector icons of 150+ open sets: Tabler, Lucide, Heroicons, Line MD (animated), SVG Spinners, Meteocons,
 * Devicon (devicons.io), Simple Icons / Logos (brands) and more.
 *
 * Only SVG vectors are fetched. Animated sets (SMIL `<animate>`) are imported as their static geometry: animation elements and the
 * dash attributes they drive are removed so no stroke stays hidden at frame 0 (the app has its own animation model).
 * Imports are capped at MAX_IMPORT (10 000) icons per call.
 */
import { ValidationError } from '../domain/errors.js';
import { packSvgToNodes } from '../scripts/import-icon-packs.js';

export const ICONIFY_API = 'https://api.iconify.design';
/** Whole icon sets (one request each, no per-icon API calls): the @iconify-json packages on the jsDelivr CDN. */
export const ICONIFY_CDN = 'https://cdn.jsdelivr.net/npm/@iconify-json';
export const MAX_IMPORT = 10000;
const CHUNK = 100;
const TTL = 60 * 60 * 1000;
/** Sets the user asked for (shown first). Every other Iconify set stays reachable. */
export const FEATURED_PREFIXES = ['tabler', 'lucide', 'line-md', 'svg-spinners', 'meteocons', 'devicon', 'devicon-plain', 'heroicons', 'simple-icons', 'logos', 'fa6-brands', 'mdi', 'ph', 'bi'];

const PREFIX_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const words = s => String(s).split(/[-_:]+/).filter(Boolean);
const human = s => words(s).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Removes SMIL animation elements and the stroke-dash attributes they drive (static first frame stays visible). */
export function stripAnimation(svg) {
  const had = /<(animate|animateTransform|animateMotion|set)\b/.test(svg);
  if (!had) return { svg, animated: false };
  const out = svg
    .replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*\/>/g, '')
    .replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/\sstroke-dash(?:array|offset)="[^"]*"/g, '');
  return { svg: out, animated: true };
}

/**
 * Inlines `<symbol>` + `<use href="#id">` (Meteocons, many colour sets): the parser skips defs / symbols, so every use becomes a
 * `<g transform>` holding the symbol's content scaled into the use box. Unknown references are dropped.
 */
export function inlineSymbols(svg) {
  const syms = new Map();
  for (const m of svg.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[1])?.[1];
    if (!id) continue;
    const vb = /viewBox="([^"]+)"/.exec(m[1])?.[1]?.trim().split(/[\s,]+/).map(Number);
    syms.set(id, { body: m[2], vb: vb?.length === 4 && vb.every(Number.isFinite) ? vb : null });
  }
  if (!syms.size && !/<use\b/.test(svg)) return svg;
  let out = svg;
  for (let pass = 0; pass < 3 && /<use\b/.test(out); pass++) {
    out = out.replace(/<use\b([^>]*?)\/?>(?:<\/use>)?/g, (all, attrs) => {
      const ref = /(?:xlink:)?href="#([^"]+)"/.exec(attrs)?.[1], sym = ref && syms.get(ref);
      if (!sym) return '';
      const num = n => parseFloat(new RegExp(`\\s${n}="([^"]*)"`).exec(attrs)?.[1]) || 0;
      const x = num('x'), y = num('y'), tf = /\stransform="([^"]*)"/.exec(attrs)?.[1] || '';
      let inner = `translate(${x} ${y})`;
      if (sym.vb) {
        const w = num('width') || sym.vb[2], h = num('height') || sym.vb[3];
        inner += ` scale(${w / sym.vb[2]} ${h / sym.vb[3]}) translate(${-sym.vb[0]} ${-sym.vb[1]})`;
      }
      return `<g transform="${tf ? `${tf} ` : ''}${inner}">${sym.body}</g>`;
    });
  }
  return out.replace(/<symbol\b[\s\S]*?<\/symbol>/g, '').replace(/<use\b[^>]*\/?>/g, '');
}

export class OnlineIconService {
  constructor({ services, fetchImpl = globalThis.fetch, transaction = fn => fn(), backoffMs = 1500 }) {
    Object.assign(this, { services, fetchImpl, transaction, backoffMs });
    this.cache = new Map();            // url -> { at, value }
    this.svgCache = new Map();
    this.setCache = new Map();         // prefix -> full set json (kept small: sets can be several MB)         // `${prefix}:${name}:${color}` -> svg (small LRU)
  }

  async #json(url) {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {           // the free API answers 429 when asked too fast: back off and retry
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(25000), headers: { accept: 'application/json' } });
      if (res.status !== 429) break;
      await new Promise(r => setTimeout(r, this.backoffMs * 2 ** attempt));
    }
    if (!res.ok) throw new ValidationError(res.status === 429 ? 'the icon source is rate-limiting requests; try again in a minute' : `icon source answered ${res.status}`);
    const value = await res.json();
    this.cache.set(url, { at: Date.now(), value });
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  sources() {
    return [{ id: 'iconify', title: 'Iconify API (free, open icon sets, SVG only)', url: 'https://iconify.design', needsKey: false }];
  }

  /** Every set of the source: { prefix, title, total, license, palette, animated?, featured }. Featured sets first. */
  async collections() {
    const all = await this.#json(`${ICONIFY_API}/collections`);
    const rows = Object.entries(all).map(([prefix, c]) => ({
      prefix, title: c.name || prefix, total: c.total || 0, license: c.license?.title || '', licenseUrl: c.license?.url || '',
      author: c.author?.name || '', palette: Boolean(c.palette), category: c.category || '', featured: FEATURED_PREFIXES.includes(prefix)
    }));
    const rank = p => { const i = FEATURED_PREFIXES.indexOf(p); return i < 0 ? 999 : i; };
    return rows.sort((a, b) => rank(a.prefix) - rank(b.prefix) || a.title.localeCompare(b.title));
  }

  /** The full set (icons, aliases, info) from the CDN; cached for the last few sets. */
  async #setData(prefix) {
    if (!PREFIX_RE.test(prefix)) throw new ValidationError('invalid set prefix');
    if (this.setCache.has(prefix)) return this.setCache.get(prefix);
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await this.fetchImpl(`${ICONIFY_CDN}/${prefix}/icons.json`, { signal: AbortSignal.timeout(90000) });
      if (res.status !== 429 && res.status < 500) break;
      await new Promise(r => setTimeout(r, this.backoffMs * 2 ** attempt));
    }
    if (!res.ok) throw new ValidationError(res.status === 404 ? `set "${prefix}" is not available` : `icon source answered ${res.status}`);
    const data = await res.json();
    this.setCache.set(prefix, data);
    if (this.setCache.size > 3) this.setCache.delete(this.setCache.keys().next().value);
    return data;
  }

  async #names(prefix) {
    const data = await this.#setData(prefix);
    const names = [...new Set([...Object.keys(data.icons || {}), ...Object.keys(data.aliases || {})])].sort();
    return { names, info: data.info || {} };
  }

  /**
   * Search (q) within one set or across all (prefix empty), or list one set (q empty + prefix). Paged: start / limit (<= 200).
   * @returns {{icons: {id,prefix,name}[], total:number, start:number, limit:number}}
   */
  async search({ q = '', prefix = '', start = 0, limit = 60 } = {}) {
    limit = Math.max(1, Math.min(200, Number(limit) || 60)); start = Math.max(0, Number(start) || 0);
    q = String(q).trim().slice(0, 80);
    if (prefix && !PREFIX_RE.test(prefix)) throw new ValidationError('invalid set prefix');
    if (!q && !prefix) throw new ValidationError('type a search or pick a set');
    const toRow = id => { const [p, n] = id.split(':'); return { id, prefix: p, name: n }; };
    if (!q) {
      const { names } = await this.#names(prefix);
      return { icons: names.slice(start, start + limit).map(n => toRow(`${prefix}:${n}`)), total: names.length, start, limit };
    }
    const u = `${ICONIFY_API}/search?query=${encodeURIComponent(q)}&limit=${Math.min(999, start + limit)}${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`;
    const r = await this.#json(u);
    const ids = r.icons || [];
    return { icons: ids.slice(start, start + limit).map(toRow), total: Math.min(r.total ?? ids.length, 999), start, limit };
  }

  /** One icon as an svg text for previews (cached, recolourable). */
  async svg({ prefix, name, color = '' }) {
    if (!PREFIX_RE.test(prefix || '') || !NAME_RE.test(name || '')) throw new ValidationError('invalid icon id');
    const col = /^#?[0-9a-fA-F]{3,8}$/.test(color) ? `%23${color.replace('#', '')}` : '';
    const key = `${prefix}:${name}:${col}`;
    if (this.svgCache.has(key)) return this.svgCache.get(key);
    const res = await this.fetchImpl(`${ICONIFY_API}/${prefix}/${name}.svg${col ? `?color=${col}` : ''}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new ValidationError(`icon not found (${res.status})`);
    const text = (await res.text()).slice(0, 200000);
    this.svgCache.set(key, text);
    if (this.svgCache.size > 600) this.svgCache.delete(this.svgCache.keys().next().value);
    return text;
  }

  /**
   * Imports the named icons of one set into the actor's library (existing keys `<prefix>-<name>` are skipped).
   * @returns {{imported:number, skipped:number, failed:number, errors:string[], truncated:boolean, ids:number[]}}
   */
  async importIcons({ prefix, names, projectId = 1, visibility } = {}, { actor = null } = {}) {
    if (!PREFIX_RE.test(prefix || '')) throw new ValidationError('invalid set prefix');
    if (!Array.isArray(names) || !names.length) throw new ValidationError('names[] is required');
    const clean = [...new Set(names.map(String).filter(n => NAME_RE.test(n)))];
    const truncated = clean.length > MAX_IMPORT;
    const list = clean.slice(0, MAX_IMPORT);
    const pid = Number(projectId) || 1;
    const vis = visibility || (pid === 1 ? 'public' : 'project');
    const res = { imported: 0, skipped: 0, failed: 0, errors: [], truncated, ids: [] };
    let full = null;
    try { full = await this.#setData(prefix); } catch { /* falls back to the per-icon API below */ }
    const info = full?.info || null;
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      let data = full;
      if (!data) {
        try { data = await this.#json(`${ICONIFY_API}/${prefix}.json?icons=${chunk.join(',')}`); }
        catch (e) { res.failed += chunk.length; res.errors.push(`${chunk[0]}…: ${e.message}`); continue; }
      }
      const defW = data.width || 24, defH = data.height || 24;
      this.transaction(() => {
        for (const name of chunk) {
          const key = `${prefix}-${name}`;
          try {
            let ic = data.icons?.[name];
            if (!ic && data.aliases?.[name]) { const a = data.aliases[name]; ic = { ...data.icons?.[a.parent], ...a }; }
            if (!ic?.body) { res.failed++; continue; }
            if (this.services.icon.designs.keyExists(key, pid)) { res.skipped++; continue; }
            const w = ic.width || defW, h = ic.height || defH;
            const { svg, animated } = stripAnimation(inlineSymbols(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${ic.body}</svg>`));
            const nodes = packSvgToNodes(svg, { paintMode: 'theme' });
            const rec = this.services.icon.create({
              key, name: human(name), label: human(name), category: `pack-${prefix}`, tags: [...new Set([prefix, ...words(name)])].slice(0, 12),
              width: 24, height: 24, visibility: vis, projectId: pid,
              descriptionDev: `${info?.name || prefix} icon "${name}" (Iconify)${info?.license?.title ? ` — ${info.license.title}` : ''}.`,
              meta: {
                source: 'online/iconify', pack: prefix, license: info?.license?.title || '', licenseUrl: info?.license?.url || '',
                sourceUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`, ...(animated ? { animatedSource: true } : {})
              }
            }, { nodes, actor });
            res.imported++; res.ids.push(rec.id);
          } catch (e) { res.failed++; if (res.errors.length < 10) res.errors.push(`${name}: ${e.message}`); }
        }
      });
    }
    return res;
  }

  /** Imports a whole set (first MAX_IMPORT icons). */
  async importSet({ prefix, max = MAX_IMPORT, projectId = 1, visibility } = {}, ctx = {}) {
    const { names } = await this.#names(prefix);
    const cap = Math.min(MAX_IMPORT, Math.max(1, Number(max) || MAX_IMPORT));
    const r = await this.importIcons({ prefix, names: names.slice(0, cap), projectId, visibility }, ctx);
    return { ...r, total: names.length, truncated: names.length > cap };
  }
}
