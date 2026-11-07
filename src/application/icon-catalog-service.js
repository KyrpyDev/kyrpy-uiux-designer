import { createHash } from 'node:crypto';
import { iconPack, iconSummary } from '../domain/icon-summary.js';

export { iconPack, iconSummary };

const MAX_IDS = 400;
const parseIds = (ids, max = MAX_IDS) => [...new Set((Array.isArray(ids) ? ids : String(ids || '').split(','))
  .map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, max);

/**
 * Icon catalog for large libraries (thousands of pack icons): summary lists, paged search, sprites of just
 * the requested icons, and full records by id for lazy client caches. `version()` changes whenever any icon
 * or icon node changes, so clients can skip re-downloading the icon list.
 */
export class IconCatalogService {
  /** @param {{ designs, nodes, render, version: () => string }} deps icon DesignRepository, NodeRepository, RenderService */
  constructor({ designs, nodes, render, version }) { Object.assign(this, { designs, nodes, render, versionFn: version }); }

  version() { return this.versionFn ? String(this.versionFn()) : ''; }

  /** Icon summaries matching the library filter (same filter shape as DesignRepository.list). */
  summaries(filter = {}) { return this.designs.list(filter).map(iconSummary); }

  /**
   * Paged search. `pack`: '' (all), 'builtin' (icons without a pack) or a pack name. `q` matches key, name,
   * label and tags (all whitespace-separated terms must match).
   */
  search({ q = '', category = '', pack = '', offset = 0, limit = 200, ...filter } = {}) {
    const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const p = String(pack || '').toLowerCase();
    const rows = this.designs.list({ ...filter, category }).filter(d => {
      const dp = iconPack(d);
      if (p && (p === 'builtin' ? dp : dp !== p)) return false;
      if (!terms.length) return true;
      const hay = `${d.key} ${d.name} ${d.label} ${(d.tags || []).join(' ')}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
    const off = Math.max(0, Number(offset) || 0), lim = Math.min(1000, Math.max(1, Number(limit) || 200));
    return { total: rows.length, offset: off, limit: lim, version: this.version(), items: rows.slice(off, off + lim).map(iconSummary) };
  }

  /** Full icon records ({...summary, nodes}) for the given ids (max 400 unless `max`); unknown ids are skipped. */
  full(ids, { max = MAX_IDS } = {}) {
    const out = [];
    for (const id of parseIds(ids, max)) {
      const d = this.designs.get(id);
      if (d) out.push({ ...iconSummary(d), nodes: this.nodes.listByOwner('icon', id) });
    }
    return out;
  }

  /** `<svg>` sprite holding only the symbols of the given icon ids (max 400), with a content ETag. */
  sprite(themeKey, ids) {
    const list = parseIds(ids).filter(id => this.designs.get(id));
    const svg = this.render.sprite(themeKey, list);
    const etag = `"${createHash('sha1').update(svg).digest('base64url')}"`;
    return { svg, etag, ids: list };
  }
}
