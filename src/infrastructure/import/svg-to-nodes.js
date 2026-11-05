import { parseXml } from './xml-parser.js';

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon']);
const SKIP = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'script', 'symbol', 'filter', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'marker', 'pattern']);
const DROP_ATTRS = /^(id|aria-label|aria-hidden|role|xmlns.*|data-.*|version|focusable|xml:space)$/;

export function parseStyle(style) {
  const out = {};
  for (const part of String(style || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Cleans a raw attribute map: flatten style="", drop ids/aria/data. */
export function cleanAttrs(raw, { keepClass = true } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP_ATTRS.test(k)) continue;
    if (k === 'class' && !keepClass) continue;
    if (k === 'style') { Object.assign(out, parseStyle(v)); continue; }
    out[k] = v;
  }
  return out;
}

/**
 * Converts parsed svg children into a flat element list (parent links by temporary numeric ids).
 * @param {object} opts
 *   mapAttrs(tag, attrs, node) -> { attrs, role?, name? }   hook for tokenizing / classification
 *   resolveUse(href) -> { refType, refId } | null           resolves <use href="#i-x"> to a library instance
 */
export function xmlToNodes(nodes, { mapAttrs, resolveUse } = {}) {
  const out = [];
  let temp = 1;
  const walk = (list, parentTemp) => {
    for (const node of list) {
      if (SKIP.has(node.tag)) continue;
      if (node.tag === 'use') {
        const href = node.attrs.href || '';
        const ref = resolveUse?.(href);
        if (!ref) continue;
        let attrs = cleanAttrs(node.attrs, { keepClass: false });
        delete attrs.href;
        for (const k of ['x', 'y', 'width', 'height']) if (attrs[k] === undefined) attrs[k] = k === 'width' || k === 'height' ? '24' : '0';
        const mapped = mapAttrs ? mapAttrs('use', attrs, node) : { attrs };
        out.push({ id: temp, parentId: parentTemp, tag: 'use', kind: 'instance', refType: ref.refType, refId: ref.refId,
          attrs: mapped.attrs, role: mapped.role ?? null, name: mapped.name ?? '', ...(mapped.animation ? { animations: [mapped.animation] } : {}) });
        temp++; continue;
      }
      if (node.tag === 'text') {
        const attrs = cleanAttrs(node.attrs);
        const mapped = mapAttrs ? mapAttrs('text', attrs, node) : { attrs };
        out.push({ id: temp++, parentId: parentTemp, tag: 'text', kind: 'text', text: collectText(node), attrs: mapped.attrs, role: mapped.role ?? null, name: mapped.name ?? '', ...(mapped.animation ? { animations: [mapped.animation] } : {}) });
        continue;
      }
      if (node.tag === 'g') {
        const attrs = cleanAttrs(node.attrs);
        const mapped = mapAttrs ? mapAttrs('g', attrs, node) : { attrs };
        const id = temp++;
        out.push({ id, parentId: parentTemp, tag: 'g', kind: 'group', attrs: mapped.attrs, role: mapped.role ?? null, name: mapped.name ?? '', ...(mapped.animation ? { animations: [mapped.animation] } : {}) });
        walk(node.children, id);
        continue;
      }
      if (SHAPES.has(node.tag)) {
        const attrs = cleanAttrs(node.attrs);
        const mapped = mapAttrs ? mapAttrs(node.tag, attrs, node) : { attrs };
        out.push({ id: temp++, parentId: parentTemp, tag: node.tag, kind: 'shape', attrs: mapped.attrs, role: mapped.role ?? null, name: mapped.name ?? '', ...(mapped.animation ? { animations: [mapped.animation] } : {}) });
      }
    }
  };
  walk(nodes, null);
  return out;
}

function collectText(node) {
  return (node.text || '') + node.children.map(collectText).join('');
}

/** Parses an svg string; returns { width, height, viewBox, nodes } for user imports. */
export function svgTextToNodes(svgText, opts = {}) {
  const root = parseXml(svgText);
  const vb = (root.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  const width = parseFloat(root.attrs.width) || vb[2] || 24;
  const height = parseFloat(root.attrs.height) || vb[3] || 24;
  return { width: vb[2] || width, height: vb[3] || height, viewBox: root.attrs.viewBox || `0 0 ${width} ${height}`, nodes: xmlToNodes(root.children, opts) };
}
