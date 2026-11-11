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
    const off = Math.max(0, Number(offset) || 0), lim = Math.min(1000, Math.max(1, Number(limit) || 200));
    // terms, pack and the page are applied in SQL: a page request reads one page, not the whole library
    const where = { ...filter, category, terms, pack: String(pack || '').toLowerCase() };
    const items = this.designs.list({ ...where, limit: lim, offset: off }).map(iconSummary);
    return { total: this.designs.countMatching(where), offset: off, limit: lim, version: this.version(), items };
  }

  /** Full icon records ({...summary, nodes}) for the given ids (max 400 unless `max`); unknown ids are skipped. */
  full(ids, { max = MAX_IDS } = {}) {
    const rows = new Map(this.designs.getMany(parseIds(ids, max)).map(d => [d.id, d]));
    const nodes = new Map();
    for (const n of this.nodes.listByOwners('icon', [...rows.keys()])) { if (!nodes.has(n.ownerId)) nodes.set(n.ownerId, []); nodes.get(n.ownerId).push(n); }
    // answer in the order asked for
    return parseIds(ids, max).filter(id => rows.has(id)).map(id => ({ ...iconSummary(rows.get(id)), nodes: nodes.get(id) || [] }));
  }

  /** `<svg>` sprite holding only the symbols of the given icon ids (max 400), with a content ETag. */
  sprite(themeKey, ids) {
    const known = new Set(this.designs.getMany(parseIds(ids)).map(d => d.id));
    const list = parseIds(ids).filter(id => known.has(id));
    const svg = this.render.sprite(themeKey, list);
    const etag = `"${createHash('sha1').update(svg).digest('base64url')}"`;
    return { svg, etag, ids: list };
  }
}
