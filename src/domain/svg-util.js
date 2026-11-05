/** Escaping and attribute serialization shared by the renderers. Only plain svg attribute names are emitted. */
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');

/* No event handlers (on*), no odd characters in names; href only to local ids. */
const SAFE_ATTR = /^[a-zA-Z_][-a-zA-Z0-9_:.]*$/;
export const SAFE_TAGS = new Set(['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon', 'text', 'g', 'use']);

export const attrString = a => Object.entries(a)
  .filter(([k, v]) => v !== null && v !== undefined && v !== '' && SAFE_ATTR.test(k) && !/^on/i.test(k) && !(/^(xlink:)?href$/.test(k) && !String(v).startsWith('#')))
  .map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
