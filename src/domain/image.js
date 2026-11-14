/**
 * Image library and the `image` node.
 *
 * An image node shows a raster picture (photo, avatar, illustration) inside a design:
 *   { tag: 'image', kind: 'shape', attrs: { x, y, width, height, imageId, preserveAspectRatio?, 'data-clip'?, 'data-radius'? } }
 * - `imageId` points at an image of the image library (served by the API at /api/images/:id/file); an inline
 *   `href` is accepted only as a base64 data URI of a PNG, JPEG, GIF or WebP picture.
 * - `data-clip`: 'circle' (round avatar) or 'rounded' (corner radius `data-radius` px); nothing = the plain rectangle.
 * - `preserveAspectRatio`: 'xMidYMid slice' (cover, the default), 'xMidYMid meet' (contain) or 'none' (stretch).
 * SVG is not an image format here: an uploaded SVG opened from its file URL could run scripts.
 */
import { esc } from './svg-util.js';

/** Accepted raster formats and their file extension. */
export const IMAGE_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** Largest stored image (decoded bytes). The browser downsizes uploads before sending them. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_FITS = ['xMidYMid slice', 'xMidYMid meet', 'none'];
export const IMAGE_CLIPS = ['circle', 'rounded'];

const DATA_URI = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Parses a base64 data URI of an accepted image: { mime, base64, bytes } or null. */
export function parseImageDataUri(v) {
  const m = DATA_URI.exec(String(v ?? '').replace(/\s+/g, ''));
  if (!m) return null;
  const bytes = Math.floor(m[2].length * 3 / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
  return { mime: m[1], base64: m[2], bytes };
}

/** True for bytes that really start like the format they claim (magic numbers), so a renamed file is refused. */
export function imageBytesMatch(mime, buf) {
  if (!buf || buf.length < 12) return false;
  const b = i => buf[i];
  if (mime === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  if (mime === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (mime === 'image/gif') return b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46;
  if (mime === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return false;
}

/** Pixel size read from the file header (PNG, GIF, WebP, JPEG): { width, height } or null. */
export function imageSize(mime, buf) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const v = buf.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
      return null;
    }
    if (mime === 'image/jpeg') {
      for (let i = 2; i + 9 < buf.length;) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch { /* truncated header */ }
  return null;
}

/** The only hrefs an image node may carry: a library image file URL or an accepted data URI. */
export function safeImageHref(v) {
  const s = String(v ?? '').trim();
  if (/^\/api\/images\/\d+\/file$/.test(s)) return s;
  return parseImageDataUri(s) ? s.replace(/\s+/g, '') : null;
}

/** Cleans the attributes of an image node (server-side normalisation): numeric imageId, safe href, known fit / clip. */
export function normalizeImageAttrs(attrs = {}) {
  const out = { ...attrs };
  if (out.imageId != null && out.imageId !== '') { const n = Number(out.imageId); if (Number.isInteger(n) && n > 0) out.imageId = n; else delete out.imageId; } else delete out.imageId;
  for (const k of ['href', 'xlink:href']) {
    if (out[k] == null) continue;
    const safe = safeImageHref(out[k]);
    delete out[k];
    if (safe && k === 'href') out.href = safe;
  }
  if (out.preserveAspectRatio != null && !IMAGE_FITS.includes(out.preserveAspectRatio)) delete out.preserveAspectRatio;
  if (out['data-clip'] != null && !IMAGE_CLIPS.includes(out['data-clip'])) delete out['data-clip'];
  return out;
}

const escAttr = s => esc(s).replace(/"/g, '&quot;');

/**
 * Markup of an image node. `a` = its resolved, sanitised attributes (attrString drops any href); `imageHref(id)` gives the
 * URL / data URI of a library image (the web app: its file URL; exports: a data URI). A missing picture is a grey box.
 */
export function imageMarkup(el, a, { attrString, imageHref } = {}) {
  const { imageId, href: rawHref, preserveAspectRatio, 'data-clip': clip, 'data-radius': radius, ...rest } = a;
  const href = imageId != null ? (imageHref ? imageHref(Number(imageId)) : `/api/images/${Number(imageId)}/file`) : safeImageHref(rawHref);
  const w = Number(rest.width) || 0, h = Number(rest.height) || 0;
  let clipDef = '', clipRef = null;
  if (clip === 'circle' || (clip === 'rounded' && Number(radius) > 0 && w > 0 && h > 0)) {
    const id = `udimg-clip-${el.id}${clip === 'rounded' ? `-${Number(radius)}` : ''}`;
    const shape = clip === 'circle'
      ? '<ellipse cx="0.5" cy="0.5" rx="0.5" ry="0.5"/>'
      : `<rect width="1" height="1" rx="${Math.min(0.5, Number(radius) / w)}" ry="${Math.min(0.5, Number(radius) / h)}"/>`;
    clipDef = `<clipPath id="${id}" clipPathUnits="objectBoundingBox">${shape}</clipPath>`;
    clipRef = `url(#${id})`;
  }
  const attrs = { ...rest, 'data-image-id': imageId ?? null, 'clip-path': clipRef ?? rest['clip-path'] ?? null };
  if (!href) {
    // no picture (deleted image, nothing chosen yet): a grey placeholder of the same box
    return `${clipDef}<rect${attrString({ ...attrs, fill: '#8a8f9a', 'fill-opacity': 0.35, stroke: '#8a8f9a', 'stroke-dasharray': '4 3' })}/>`;
  }
  return `${clipDef}<image${attrString({ ...attrs, preserveAspectRatio: preserveAspectRatio || 'xMidYMid slice' })} href="${escAttr(href)}"/>`;
}
