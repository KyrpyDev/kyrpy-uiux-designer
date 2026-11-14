/**
 * Free stock photo search and import into the image library.
 *
 * Providers (all free):
 *  - openverse: Openverse (https://openverse.org), 800M+ openly licensed images (CC / public domain); no API key.
 *  - pexels:    Pexels (https://www.pexels.com/api/), Pexels License; needs PEXELS_API_KEY in the server environment.
 *  - pixabay:   Pixabay (https://pixabay.com/api/docs/), Pixabay Content License; needs PIXABAY_API_KEY.
 *
 * Import takes a provider and the provider's photo id, never a URL from the caller: the server reads the photo's record from the
 * provider again and downloads only the address the provider gives (https, an image type, at most MAX_IMAGE_BYTES), so the
 * endpoint cannot be used to fetch arbitrary addresses. The author, source page and license are stored with the image.
 */
import { DomainError, ValidationError } from '../domain/errors.js';
import { IMAGE_MIME, MAX_IMAGE_BYTES } from '../domain/image.js';

const UA = 'kyrpy-uiux-designer (image library)';

/** A download address must be public https: no localhost, no private / link-local IP literals (an image host could redirect there). */
export function isPublicHttpsUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(':') && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:'))) return false;
  return true;
}
const TTL = 10 * 60 * 1000;

const PROVIDERS = {
  openverse: {
    label: 'Openverse', home: 'https://openverse.org', license: 'CC licenses / public domain (per image)', needsKey: null,
    async search({ q, page, perPage }, get) {
      const u = `https://api.openverse.org/v1/images/?${new URLSearchParams({ q, page: String(page), page_size: String(Math.min(perPage, 20)), mature: 'false' })}`;
      const j = await get(u);
      return { total: Number(j.result_count) || 0, items: (j.results || []).map(openverseItem) };
    },
    async item(id, get) { return openverseItem(await get(`https://api.openverse.org/v1/images/${encodeURIComponent(id)}/`)); }
  },
  pexels: {
    label: 'Pexels', home: 'https://www.pexels.com', license: 'Pexels License (free to use, no attribution required)', needsKey: 'PEXELS_API_KEY',
    async search({ q, page, perPage }, get, key) {
      const j = await get(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, page: String(page), per_page: String(Math.min(perPage, 80)) })}`, { authorization: key });
      return { total: Number(j.total_results) || 0, items: (j.photos || []).map(pexelsItem) };
    },
    async item(id, get, key) { return pexelsItem(await get(`https://api.pexels.com/v1/photos/${encodeURIComponent(id)}`, { authorization: key })); }
  },
  pixabay: {
    label: 'Pixabay', home: 'https://pixabay.com', license: 'Pixabay Content License (free to use, no attribution required)', needsKey: 'PIXABAY_API_KEY',
    async search({ q, page, perPage }, get, key) {
      const j = await get(`https://pixabay.com/api/?${new URLSearchParams({ key, q, page: String(page), per_page: String(Math.max(3, Math.min(perPage, 200))), image_type: 'photo', safesearch: 'true' })}`);
      return { total: Number(j.totalHits) || 0, items: (j.hits || []).map(pixabayItem) };
    },
    async item(id, get, key) {
      const j = await get(`https://pixabay.com/api/?${new URLSearchParams({ key, id: String(id) })}`);
      if (!j.hits?.length) throw new DomainError('photo not found at Pixabay', 'NOT_FOUND', 404);
      return pixabayItem(j.hits[0]);
    }
  }
};

function openverseItem(r) {
  const license = r.license ? `CC ${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`.replace('CC PDM', 'Public Domain Mark').replace('CC CC0', 'CC0') : null;
  return {
    provider: 'openverse', id: String(r.id), title: r.title || 'Openverse image', width: r.width ?? null, height: r.height ?? null,
    thumbUrl: r.thumbnail || null, downloadUrl: r.url, fallbackUrl: r.thumbnail || null, pageUrl: r.foreign_landing_url || null,
    author: r.creator || null, authorUrl: r.creator_url || null, license, licenseUrl: r.license_url || null,
    tags: (r.tags || []).map(t => t?.name).filter(Boolean).slice(0, 20)
  };
}
function pexelsItem(p) {
  return {
    provider: 'pexels', id: String(p.id), title: p.alt || `Pexels photo ${p.id}`, width: p.width ?? null, height: p.height ?? null,
    thumbUrl: p.src?.medium || p.src?.small || null, downloadUrl: p.src?.large2x || p.src?.large || p.src?.original, fallbackUrl: p.src?.large || p.src?.medium || null,
    pageUrl: p.url || null, author: p.photographer || null, authorUrl: p.photographer_url || null,
    license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', tags: []
  };
}
function pixabayItem(p) {
  return {
    provider: 'pixabay', id: String(p.id), title: (p.tags || `Pixabay photo ${p.id}`).split(',').slice(0, 3).join(', '), width: p.imageWidth ?? null, height: p.imageHeight ?? null,
    thumbUrl: p.webformatURL || p.previewURL || null, downloadUrl: p.largeImageURL || p.webformatURL, fallbackUrl: p.webformatURL || null,
    pageUrl: p.pageURL || null, author: p.user || null, authorUrl: p.user_id ? `https://pixabay.com/users/${encodeURIComponent(p.user)}-${p.user_id}/` : null,
    license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', tags: String(p.tags || '').split(',').map(t => t.trim()).filter(Boolean)
  };
}

export class StockImageService {
  /** @param {{ images: import('./image-service.js').ImageService, env?: object, fetchImpl?: typeof fetch }} deps */
  constructor({ images, env = process.env, fetchImpl = globalThis.fetch }) {
    this.images = images; this.env = env; this.fetch = fetchImpl; this.cache = new Map();
  }

  #key(name) { const p = PROVIDERS[name]; return p?.needsKey ? String(this.env[p.needsKey] || '').trim() : ''; }
  #ready(name) { const p = PROVIDERS[name]; return !!p && (!p.needsKey || !!this.#key(name)); }

  /** The providers and whether each can be used now (a key-gated one says which environment variable it needs). */
  sources() {
    return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, home: p.home, license: p.license, needsKey: p.needsKey, ready: this.#ready(id) }));
  }

  async #get(url, headers = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await this.fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: ctl.signal });
      if (r.status === 429) throw new DomainError('the stock photo service is busy (rate limit); try again in a minute', 'RATE_LIMITED', 429);
      if (!r.ok) throw new DomainError(`the stock photo service answered ${r.status}`, 'UPSTREAM', 502);
      return await r.json();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError(`the stock photo service could not be reached (${e.name === 'AbortError' ? 'timeout' : e.message})`, 'UPSTREAM', 502);
    } finally { clearTimeout(t); }
  }

  #provider(name) {
    const id = String(name || 'openverse').toLowerCase();
    const p = PROVIDERS[id];
    if (!p) throw new ValidationError(`unknown provider "${name}"; use ${Object.keys(PROVIDERS).join(', ')}`);
    if (!this.#ready(id)) throw new ValidationError(`${p.label} needs an API key: set ${p.needsKey} in the server environment and restart`);
    return { id, p };
  }

  /** Searches one provider: { provider, q, page, total, items: [{ id, title, thumbUrl, width, height, author, license, pageUrl, … }] }. */
  async search({ provider = 'openverse', q = '', page = 1, perPage = 20 } = {}) {
    const { id, p } = this.#provider(provider);
    const query = String(q || '').trim().slice(0, 200);
    if (!query) throw new ValidationError('type what to search for');
    const pg = Math.max(1, Math.min(50, Number(page) || 1)), per = Math.max(1, Math.min(40, Number(perPage) || 20));
    const ck = `${id}|${query}|${pg}|${per}`, hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const res = await p.search({ q: query, page: pg, perPage: per }, (u, h) => this.#get(u, h), this.#key(id));
    const value = { provider: id, q: query, page: pg, total: res.total, items: res.items.map(({ downloadUrl, fallbackUrl, ...rest }) => rest) };
    this.cache.set(ck, { at: Date.now(), value });
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  /** Downloads one picture (https only, an image type, size-capped while streaming): { buffer, mime } or null. */
  async #download(url) {
    if (!isPublicHttpsUrl(url)) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await this.fetch(url, { headers: { 'user-agent': UA, accept: 'image/webp,image/jpeg,image/png,image/gif' }, signal: ctl.signal, redirect: 'follow' });
      if (!r.ok || !isPublicHttpsUrl(r.url || url)) return null;   // also where a redirect ended
      const mime = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
      if (!IMAGE_MIME[mime]) return null;
      if (Number(r.headers.get('content-length')) > MAX_IMAGE_BYTES) return null;
      const chunks = []; let size = 0;
      for await (const ch of r.body) { size += ch.length; if (size > MAX_IMAGE_BYTES) { ctl.abort(); return null; } chunks.push(ch); }
      return { buffer: Buffer.concat(chunks.map(c => Buffer.from(c))), mime };
    } catch { return null; } finally { clearTimeout(t); }
  }

  /**
   * Imports photos into the image library: `items` = [{ provider, id, name?, tags?, descriptionDev? }] (max 20 per call).
   * Returns { imported: [image records], failed: [{ provider, id, error }] }.
   */
  async importImages({ items = [], projectId = 1, visibility = 'project', category = 'stock' } = {}, { actor = null } = {}) {
    if (!Array.isArray(items) || !items.length) throw new ValidationError('items: pick at least one photo ({ provider, id })');
    if (items.length > 20) throw new ValidationError('import at most 20 photos at a time');
    const imported = [], failed = [];
    for (const it of items) {
      try {
        const { id: prov, p } = this.#provider(it?.provider);
        const photoId = String(it?.id ?? '').trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(photoId)) throw new ValidationError('invalid photo id');
        const rec = await p.item(photoId, (u, h) => this.#get(u, h), this.#key(prov));
        const file = (await this.#download(rec.downloadUrl)) || (rec.fallbackUrl ? await this.#download(rec.fallbackUrl) : null);
        if (!file) throw new DomainError('the photo could not be downloaded (not a PNG / JPEG / GIF / WebP, or larger than 6 MB)', 'UPSTREAM', 502);
        const credit = [rec.author ? `Photo by ${rec.author}` : null, `on ${p.label}`, rec.license ? `(${rec.license})` : null].filter(Boolean).join(' ');
        imported.push(this.images.create({
          buffer: file.buffer, mime: file.mime, name: it.name || rec.title, tags: it.tags || rec.tags,
          descriptionDev: it.descriptionDev ?? `${credit}. Source: ${rec.pageUrl || p.home}`,
          category, visibility, projectId, source: prov, sourceId: rec.id, sourceUrl: rec.pageUrl,
          author: rec.author, authorUrl: rec.authorUrl, license: rec.license, licenseUrl: rec.licenseUrl
        }, { actor }));
      } catch (e) {
        failed.push({ provider: it?.provider, id: it?.id, error: e.message });
      }
    }
    return { imported, failed };
  }
}
