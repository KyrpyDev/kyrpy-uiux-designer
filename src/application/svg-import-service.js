import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ValidationError } from '../domain/errors.js';
import { labelFromKey, slugify } from '../domain/naming.js';
import { parsePath, serializePath } from '../domain/path-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const IMPORT_TARGETS = ['path', 'icon', 'button', 'element'];

/** Built-in vector glyph paths (24x24 grid) for common icon/symbol font presets. */
const VECTOR_GLYPH_PRESETS = {
  'ui-symbols': [
    { name: 'glyph-star', char: '★', d: 'M12 2L14.9 8.6L22 9.3L16.6 14L18.2 21L12 17.3L5.8 21L7.4 14L2 9.3L9.1 8.6Z' },
    { name: 'glyph-heart', char: '♥', d: 'M12 21C12 21 4 14.8 4 8.8C4 5.8 6.4 3.5 9.3 3.5C11 3.5 12 4.5 12 4.5C12 4.5 13 3.5 14.7 3.5C17.6 3.5 20 5.8 20 8.8C20 14.8 12 21 12 21Z' },
    { name: 'glyph-bolt', char: '⚡', d: 'M13 2L4 14H11L10 22L20 10H13L13 2Z' },
    { name: 'glyph-check', char: '✓', d: 'M4 12.5L9.5 18L20 6.5' },
    { name: 'glyph-cross', char: '✕', d: 'M6 6L18 18M18 6L6 18' },
    { name: 'glyph-Sparkle', char: '✦', d: 'M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5Z' },
    { name: 'glyph-shield', char: '🛡', d: 'M12 2L4 5.5V11.5C4 16.8 7.4 20.8 12 22C16.6 20.8 20 16.8 20 11.5V5.5L12 2Z' },
    { name: 'glyph-bookmark', char: '🔖', d: 'M6 3H18V21L12 16.5L6 21V3Z' }
  ],
  'arrows-math': [
    { name: 'glyph-arrow-right', char: '→', d: 'M4 12H20M14 6L20 12L14 18' },
    { name: 'glyph-arrow-left', char: '←', d: 'M20 12H4M10 6L4 12L10 18' },
    { name: 'glyph-arrow-up', char: '↑', d: 'M12 20V4M6 10L12 4L18 10' },
    { name: 'glyph-arrow-down', char: '↓', d: 'M12 4V20M6 14L12 20L18 14' },
    { name: 'glyph-plus', char: '+', d: 'M12 5V19M5 12H19' },
    { name: 'glyph-minus', char: '−', d: 'M5 12H19' },
    { name: 'glyph-infinity', char: '∞', d: 'M7 9C4.8 9 3 10.3 3 12C3 13.7 4.8 15 7 15C9.5 15 11 12 12 12C13 12 14.5 15 17 15C19.2 15 21 13.7 21 12C21 10.3 19.2 9 17 9C14.5 9 13 12 12 12C11 12 9.5 9 7 9Z' },
    { name: 'glyph-delta', char: 'Δ', d: 'M12 4L20 20H4L12 4Z' }
  ],
  'geometric-shapes': [
    { name: 'glyph-diamond', char: '◆', d: 'M12 2L22 12L12 22L2 12Z' },
    { name: 'glyph-hexagon', char: '⬡', d: 'M12 2L20.7 7V17L12 22L3.3 17V7L12 2Z' },
    { name: 'glyph-octagon', char: '⯃', d: 'M8.5 2H15.5L22 8.5V15.5L15.5 22H8.5L2 15.5V8.5L8.5 2Z' },
    { name: 'glyph-triangle', char: '▲', d: 'M12 3L22 20H2L12 3Z' },
    { name: 'glyph-circle-ring', char: '◎', d: 'M12 3A9 9 0 1 0 12 21A9 9 0 1 0 12 3ZM12 8A4 4 0 1 1 12 16A4 4 0 1 1 12 8Z' },
    { name: 'glyph-crown', char: '♛', d: 'M3 18H21L19 7L15 12L12 5L9 12L5 7L3 18Z' }
  ]
};

/**
 * Transforms an SVG path `d` from font Cartesian space (where Y increases upward, `unitsPerEm` height)
 * into standard 24×24 top-down SVG coordinates (`padding = 2`, `20×20` inner box).
 */
export function normalizeFontGlyphPath(d, { unitsPerEm = 1000, ascent = 800, descent = -200, horizAdvX = null, flipY = true } = {}) {
  const cmds = parsePath(d);
  if (!cmds.length) return '';

  // Compute raw bounding box of the glyph path
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const touch = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const c of cmds) {
    if (c.t === 'Z') continue;
    touch(c.x, c.y);
    if (c.t === 'C') { touch(c.x1, c.y1); touch(c.x2, c.y2); }
    if (c.t === 'Q') { touch(c.x1, c.y1); }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return '';

  const rawW = Math.max(1, maxX - minX);
  const rawH = Math.max(1, maxY - minY);
  const em = Math.max(rawW, rawH, Number(unitsPerEm) || ( Number(ascent) - Number(descent) ) || 1000);
  const scale = 20 / Math.max(rawW, rawH, em * 0.65);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = x => 12 + (x - cx) * scale;
  const ty = y => 12 + (flipY ? -(y - cy) : (y - cy)) * scale;

  const transformed = cmds.map(c => {
    if (c.t === 'M' || c.t === 'L') return { t: c.t, x: tx(c.x), y: ty(c.y) };
    if (c.t === 'C') return { t: 'C', x1: tx(c.x1), y1: ty(c.y1), x2: tx(c.x2), y2: ty(c.y2), x: tx(c.x), y: ty(c.y) };
    if (c.t === 'Q') return { t: 'Q', x1: tx(c.x1), y1: ty(c.y1), x: tx(c.x), y: ty(c.y) };
    if (c.t === 'A') return { t: 'A', rx: c.rx * scale, ry: c.ry * scale, rot: c.rot, large: c.large, sweep: flipY ? (c.sweep ? 0 : 1) : c.sweep, x: tx(c.x), y: ty(c.y) };
    return { t: 'Z' };
  });
  void horizAdvX;
  return serializePath(transformed, 2);
}

/**
 * Extracts `<glyph>` entries from an SVG Font document (`<font>` / `<font-face>` / `<glyph>`).
 */
export function parseSvgFontGlyphs(svgText, { limit = 250 } = {}) {
  const s = String(svgText || '');
  if (!s.includes('<glyph')) return [];

  const faceMatch = s.match(/<font-face\b([^>]*)\/?>/i);
  const attr = (str, name, fallback) => {
    if (!str) return fallback;
    const m = str.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1] : fallback;
  };
  const unitsPerEm = Number(attr(faceMatch?.[1], 'units-per-em', 1000)) || 1000;
  const ascent = Number(attr(faceMatch?.[1], 'ascent', 800)) || 800;
  const descent = Number(attr(faceMatch?.[1], 'descent', -200)) || -200;

  const out = [];
  const glyphRe = /<glyph\b([^>]*)\/?>/gi;
  let m;
  let idx = 1;
  while ((m = glyphRe.exec(s)) !== null && out.length < limit) {
    const attrs = m[1];
    const d = attr(attrs, 'd', '').trim();
    if (!d || d.length < 4) continue;
    const rawName = attr(attrs, 'glyph-name', '') || attr(attrs, 'id', '');
    const unicode = attr(attrs, 'unicode', '');
    if (rawName === '.notdef' || rawName === 'space' || unicode === ' ') continue;

    let cleanName = rawName;
    if (!cleanName && unicode) {
      if (unicode.startsWith('&#x')) cleanName = `u${unicode.slice(3, -1)}`;
      else if (unicode.startsWith('&#')) cleanName = `u${Number(unicode.slice(2, -1)).toString(16)}`;
      else if (unicode.length === 1) {
        const cp = unicode.codePointAt(0);
        cleanName = /[a-zA-Z0-9]/.test(unicode) ? `char-${unicode}` : `u${cp.toString(16)}`;
      }
    }
    if (!cleanName) cleanName = `glyph-${idx}`;

    try {
      const normalizedD = normalizeFontGlyphPath(d, { unitsPerEm, ascent, descent, flipY: true });
      if (normalizedD) {
        out.push({
          name: cleanName,
          unicode,
          d: normalizedD
        });
        idx++;
      }
    } catch {
      // Skip malformed glyph paths
    }
  }
  return out;
}

/**
 * Pure Node.js TrueType (`.ttf`) & WOFF (`.woff` wrapping `glyf`) binary glyph contour extractor.
 * Reads SFNT tables (`head`, `maxp`, `loca`, `glyf`, `post`) and converts TrueType quadratic Bézier contours
 * into standard 24×24 SVG `<path d="...">` strings.
 */
export function parseTrueTypeFontGlyphs(buffer, { limit = 120 } = {}) {
  let buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 12) throw new ValidationError('Font file is too small or empty');

  const sig = buf.toString('ascii', 0, 4);
  const tables = new Map();

  if (sig === 'wOFF') {
    // WOFF1 header: 44 bytes, followed by 20-byte table directory entries
    const numTables = buf.readUInt16BE(12);
    for (let i = 0; i < numTables; i++) {
      const base = 44 + i * 20;
      if (base + 20 > buf.length) break;
      const tag = buf.toString('ascii', base, base + 4);
      const offset = buf.readUInt32BE(base + 4);
      const compLength = buf.readUInt32BE(base + 8);
      const origLength = buf.readUInt32BE(base + 12);
      const slice = buf.subarray(offset, offset + compLength);
      const data = compLength < origLength ? inflateSync(slice) : slice;
      tables.set(tag, data);
    }
  } else if (sig === '\x00\x01\x00\x00' || sig === 'true' || sig === 'OTTO') {
    const numTables = buf.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;
      if (base + 16 > buf.length) break;
      const tag = buf.toString('ascii', base, base + 4);
      const offset = buf.readUInt32BE(base + 8);
      const length = buf.readUInt32BE(base + 12);
      tables.set(tag, buf.subarray(offset, offset + length));
    }
  } else {
    throw new ValidationError('Unsupported binary font header (expected .ttf, .otf, or .woff)');
  }

  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  if (!head || !maxp || !loca || !glyf) {
    throw new ValidationError('Font does not contain TrueType outline tables (head/maxp/loca/glyf)');
  }

  const unitsPerEm = head.readUInt16BE(18) || 1000;
  const indexToLocFormat = head.readInt16BE(50); // 0 = short (UInt16 * 2), 1 = long (UInt32)
  const numGlyphs = maxp.readUInt16BE(4);

  // Extract optional glyph names from `post` format 2.0 table if present
  const glyphNames = [];
  const post = tables.get('post');
  if (post && post.length >= 34 && post.readUInt32BE(0) === 0x00020000) {
    try {
      const count = post.readUInt16BE(32);
      const nameIndices = [];
      let pos = 34;
      for (let i = 0; i < count && pos + 2 <= post.length; i++, pos += 2) {
        nameIndices.push(post.readUInt16BE(pos));
      }
      const pascalStrings = [];
      while (pos < post.length) {
        const len = post.readUInt8(pos++);
        if (pos + len > post.length) break;
        pascalStrings.push(post.toString('ascii', pos, pos + len));
        pos += len;
      }
      for (let i = 0; i < count; i++) {
        const idx = nameIndices[i];
        if (idx >= 258 && pascalStrings[idx - 258]) glyphNames[i] = pascalStrings[idx - 258];
      }
    } catch { /* ignore post table parse issues */ }
  }

  const getOffset = i => {
    if (indexToLocFormat === 0) return loca.readUInt16BE(i * 2) * 2;
    return loca.readUInt32BE(i * 4);
  };

  const out = [];
  for (let gi = 1; gi < numGlyphs && out.length < limit; gi++) {
    const off0 = getOffset(gi);
    const off1 = getOffset(gi + 1);
    if (off1 <= off0 || off1 > glyf.length) continue;

    const g = glyf.subarray(off0, off1);
    if (g.length < 10) continue;
    const numberOfContours = g.readInt16BE(0);
    if (numberOfContours <= 0) continue; // skip empty or composite glyphs

    try {
      let pos = 10;
      const endPts = [];
      for (let c = 0; c < numberOfContours; c++, pos += 2) endPts.push(g.readUInt16BE(pos));
      const numPoints = endPts[endPts.length - 1] + 1;
      const instrLen = g.readUInt16BE(pos);
      pos += 2 + instrLen;

      const flags = [];
      while (flags.length < numPoints && pos < g.length) {
        const fl = g.readUInt8(pos++);
        flags.push(fl);
        if (fl & 8) {
          const repeat = g.readUInt8(pos++);
          for (let r = 0; r < repeat && flags.length < numPoints; r++) flags.push(fl);
        }
      }

      const xs = [];
      let curX = 0;
      for (let i = 0; i < numPoints; i++) {
        const fl = flags[i];
        if (fl & 2) {
          const dx = g.readUInt8(pos++);
          curX += (fl & 16) ? dx : -dx;
        } else if (!(fl & 16)) {
          curX += g.readInt16BE(pos);
          pos += 2;
        }
        xs.push(curX);
      }

      const ys = [];
      let curY = 0;
      for (let i = 0; i < numPoints; i++) {
        const fl = flags[i];
        if (fl & 4) {
          const dy = g.readUInt8(pos++);
          curY += (fl & 32) ? dy : -dy;
        } else if (!(fl & 32)) {
          curY += g.readInt16BE(pos);
          pos += 2;
        }
        ys.push(curY);
      }

      // Convert TrueType contours (on-curve + quadratic off-curve points) into SVG path `d`
      const parts = [];
      let startPt = 0;
      for (let c = 0; c < numberOfContours; c++) {
        const endPt = endPts[c];
        const pts = [];
        for (let i = startPt; i <= endPt; i++) {
          pts.push({ x: xs[i], y: ys[i], on: Boolean(flags[i] & 1) });
        }
        startPt = endPt + 1;
        if (pts.length < 2) continue;

        // Expand consecutive off-curve points by inserting their implied on-curve midpoints
        const expanded = [];
        for (let i = 0; i < pts.length; i++) {
          const cur = pts[i];
          const next = pts[(i + 1) % pts.length];
          expanded.push(cur);
          if (!cur.on && !next.on) {
            expanded.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, on: true });
          }
        }
        // Rotate so the first point is on-curve
        const firstOnIdx = expanded.findIndex(p => p.on);
        if (firstOnIdx === -1) continue;
        const ordered = [...expanded.slice(firstOnIdx), ...expanded.slice(0, firstOnIdx)];
        parts.push(`M${ordered[0].x} ${ordered[0].y}`);
        let i = 1;
        while (i < ordered.length) {
          const p = ordered[i];
          if (p.on) {
            parts.push(`L${p.x} ${p.y}`);
            i++;
          } else {
            const next = ordered[(i + 1) % ordered.length];
            parts.push(`Q${p.x} ${p.y} ${next.x} ${next.y}`);
            i += 2;
          }
        }
        parts.push('Z');
      }

      const rawD = parts.join('');
      if (!rawD) continue;
      const normalizedD = normalizeFontGlyphPath(rawD, { unitsPerEm, flipY: true });
      if (normalizedD) {
        const gName = glyphNames[gi] && glyphNames[gi] !== '.notdef' ? glyphNames[gi] : `ttf-glyph-${gi}`;
        out.push({ name: gName, d: normalizedD });
      }
    } catch {
      // Skip malformed glyph contour
    }
  }
  return out;
}

/**
 * Imports vector graphics (`<svg>` files, SVG folders, or Icon/TrueType/SVG Fonts) into the current library:
 * `path`, `icon`, `button`, or `element`.
 */
export class SvgImportService {
  constructor({ services, parseSvg, transaction = fn => fn() }) {
    Object.assign(this, { services, parseSvg, transaction });
  }

  /**
   * Imports a single `<svg>` document into the target library (`path`, `icon`, `button`, or `element`).
   */
  import({ svg, as = 'icon', name, category = 'imported', projectId = 1, visibility = 'public' } = {}, { actor = null, actorId = null } = {}) {
    if (typeof svg !== 'string' || !svg.includes('<svg')) throw new ValidationError('svg text is required');
    if (!IMPORT_TARGETS.includes(as)) throw new ValidationError('import as path, icon, button or element');
    let parsed;
    try { parsed = this.parseSvg(svg, {}); } catch (e) { throw new ValidationError(`cannot read svg: ${e.message}`); }
    if (!parsed.nodes.length) throw new ValidationError('the svg contains no supported shapes (rect, circle, ellipse, path, line, polyline, polygon, text, g)');
    const label = name || labelFromKey(slugify(`imported ${as}`));
    const baseMeta = {
      projectId: Number(projectId) || 1,
      visibility: visibility === 'project' ? 'project' : 'public'
    };
    const createOpts = { actor, actorId };

    if (as === 'element') {
      return this.services.element.create(
        {
          ...baseMeta,
          name: label,
          label,
          category,
          width: Math.round(parsed.width),
          height: Math.round(parsed.height),
          meta: { source: 'svg-import', htmlTag: 'div' },
          descriptionDev: `Imported element "${label}". Review colours: replace literals with theme tokens.`
        },
        { nodes: parsed.nodes, ...createOpts }
      );
    }

    // 24-grid glyphs: scale arbitrary viewBoxes with a wrapping group
    const k = 24 / Math.max(parsed.width || 24, parsed.height || 24);
    const glyphNodes = k === 1
      ? parsed.nodes
      : [
          { id: 0.5, parentId: null, tag: 'g', kind: 'group', attrs: { transform: `scale(${Math.round(k * 10000) / 10000})` }, name: 'scaled' },
          ...parsed.nodes.map(e => ({ ...e, parentId: e.parentId ?? 0.5 }))
        ];

    if (as === 'button') {
      // Create an icon first and wrap it in a 64×64 button in the current library
      const iconRec = this.services.icon.create(
        {
          ...baseMeta,
          name: `${label} icon`,
          label: `${label} icon`,
          category,
          meta: { source: 'svg-import' },
          descriptionDev: `Imported icon for button "${label}".`
        },
        { nodes: glyphNodes, ...createOpts }
      );
      return this.services.button.create(
        {
          ...baseMeta,
          name: label,
          label,
          category,
          width: 64,
          height: 64,
          meta: { shape: 'circle', source: 'svg-import' },
          descriptionDev: `Imported button "${label}" wrapping icon "${iconRec.key}".`
        },
        {
          nodes: [
            { tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: 64, height: 64, rx: 20 } },
            { tag: 'rect', role: 'shine', name: 'shine', attrs: { x: 5, y: 3, width: 54, height: 24, rx: 14 } },
            { tag: 'use', kind: 'instance', refType: 'icon', refId: iconRec.id, name: 'icon', attrs: { x: 14, y: 14, width: 36, height: 36 } }
          ],
          ...createOpts
        }
      );
    }

    return this.services[as].create(
      {
        ...baseMeta,
        name: label,
        label,
        category,
        meta: { source: 'svg-import' },
        descriptionDev: `Imported ${as} "${label}". Review the paths and rename the variable name.`
      },
      { nodes: glyphNodes, ...createOpts }
    );
  }

  /**
   * Lists suggested/available SVG and font folders on the server/workspace for quick selection.
   */
  listSuggestedFolders() {
    const candidates = [
      { label: 'Liquid Glow Icons SVG Folder', path: resolve(repoRoot, 'assets', 'Liquid-glow-iconsset-generator', 'svg') },
      { label: 'Archive v1 SVG Folder', path: resolve(repoRoot, '.archive', 'v1', 'svg') },
      { label: 'Workspace Assets Folder', path: resolve(repoRoot, 'assets') },
      { label: 'System TrueType Fonts (/usr/share/fonts)', path: '/usr/share/fonts' }
    ];
    const results = [];
    for (const c of candidates) {
      if (!existsSync(c.path)) continue;
      try {
        const files = this.#scanDirectory(c.path, { extensions: ['.svg', '.ttf', '.otf', '.woff'], recursive: true, maxFiles: 300 });
        const svgCount = files.filter(f => f.toLowerCase().endsWith('.svg')).length;
        const fontCount = files.filter(f => /\.(ttf|otf|woff)$/i.test(f)).length;
        if (svgCount > 0 || fontCount > 0) {
          results.push({ label: c.label, path: c.path, svgCount, fontCount });
        }
      } catch { /* ignore unreadable dirs */ }
    }
    return results;
  }

  #scanDirectory(dirPath, { extensions = ['.svg'], recursive = true, maxFiles = 500 } = {}) {
    const out = [];
    const extSet = new Set(extensions.map(e => e.toLowerCase()));
    const walk = cur => {
      if (out.length >= maxFiles) return;
      let entries = [];
      try { entries = readdirSync(cur, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= maxFiles) break;
        if (entry.name.startsWith('.')) continue;
        const full = join(cur, entry.name);
        if (entry.isDirectory() && recursive) {
          walk(full);
        } else if (entry.isFile() && extSet.has(extname(entry.name).toLowerCase())) {
          out.push(full);
        }
      }
    };
    walk(dirPath);
    return out.sort();
  }

  /**
   * Batch-imports an SVG folder into the current library (`path`, `icon`, `button`, or `element`).
   * Accepts either:
   *  - `files`: `[{ name, path?, svg }]` from browser `<input type="file" webkitdirectory multiple>`
   *  - `folderPath`: server/workspace directory path containing `.svg` files
   */
  importFolder(
    {
      files = [],
      folderPath = '',
      as = 'icon',
      category = 'folder-import',
      projectId = 1,
      visibility = 'public',
      recursive = true,
      limit = 200
    } = {},
    { actor = null, actorId = null } = {}
  ) {
    if (!IMPORT_TARGETS.includes(as)) throw new ValidationError('import as path, icon, button or element');

    const entries = [];
    if (Array.isArray(files) && files.length > 0) {
      for (const f of files.slice(0, limit)) {
        if (!f || typeof f.svg !== 'string') continue;
        const rawName = String(f.name || f.path || 'svg-item').split(/[/\\]/).pop().replace(/\.svg$/i, '');
        entries.push({ name: rawName.replace(/[-_]+/g, ' ').trim() || 'svg item', svg: f.svg });
      }
    } else if (folderPath && String(folderPath).trim()) {
      const resolved = resolve(repoRoot, String(folderPath).trim());
      if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
        throw new ValidationError(`SVG folder not found: "${folderPath}"`);
      }
      const svgPaths = this.#scanDirectory(resolved, { extensions: ['.svg'], recursive, maxFiles: Number(limit) || 200 });
      if (!svgPaths.length) {
        throw new ValidationError(`No .svg files found in folder "${folderPath}"`);
      }
      for (const p of svgPaths) {
        const rawName = basename(p, extname(p)).replace(/[-_]+/g, ' ').trim() || 'svg item';
        const svg = readFileSync(p, 'utf8');
        entries.push({ name: rawName, svg });
      }
    } else {
      throw new ValidationError('Provide either uploaded SVG files or a valid server folderPath');
    }

    if (!entries.length) throw new ValidationError('No valid SVG files to import');

    const items = [];
    const errors = [];

    this.transaction(() => {
      for (const entry of entries) {
        try {
          // If an SVG file in the folder is actually an SVG Font (<font><glyph.../>), import its glyphs!
          if (entry.svg.includes('<glyph') && entry.svg.includes('<font')) {
            const fontRes = this.importFont(
              { fontSvg: entry.svg, fontName: entry.name, as, category, projectId, visibility, limit: 100 },
              { actor, actorId }
            );
            items.push(...fontRes.items);
            continue;
          }
          const created = this.import(
            { svg: entry.svg, as, name: entry.name, category, projectId, visibility },
            { actor, actorId }
          );
          items.push(created);
        } catch (e) {
          errors.push({ name: entry.name, error: e.message });
        }
      }
    });

    if (!items.length && errors.length) {
      throw new ValidationError(`Failed to import SVG folder: ${errors[0].error}`);
    }

    return {
      importedCount: items.length,
      failedCount: errors.length,
      as,
      category,
      projectId: Number(projectId) || 1,
      visibility,
      items,
      errors
    };
  }

  /**
   * Imports glyphs from a Font into the current library (`path`, `icon`, `button`, or `element`).
   * Supports:
   *  1. SVG Font (`fontSvg` or `.svg` file with `<font>` / `<glyph d="...">`)
   *  2. Binary TrueType / OpenType / WOFF Font (`fontData` base64 or `fontPath` `.ttf`/`.otf`/`.woff`)
   *  3. Built-in Symbol/Icon Font Preset (`preset`: `'ui-symbols' | 'arrows-math' | 'geometric-shapes'`) or custom characters (`chars` / `glyphs`)
   */
  importFont(
    {
      fontSvg = '',
      fontData = '',
      fontPath = '',
      fontName = 'font',
      preset = '',
      chars = '',
      glyphs = [],
      as = 'icon',
      category = 'font-icons',
      projectId = 1,
      visibility = 'public',
      limit = 120
    } = {},
    { actor = null, actorId = null } = {}
  ) {
    if (!IMPORT_TARGETS.includes(as)) throw new ValidationError('import as path, icon, button or element');
    const maxItems = Math.max(1, Math.min(500, Number(limit) || 120));
    const extracted = [];

    // 1. Check server fontPath if provided
    if (fontPath && String(fontPath).trim()) {
      const resolved = resolve(repoRoot, String(fontPath).trim());
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        throw new ValidationError(`Font file not found: "${fontPath}"`);
      }
      const ext = extname(resolved).toLowerCase();
      if (ext === '.svg') {
        fontSvg = readFileSync(resolved, 'utf8');
      } else {
        const buf = readFileSync(resolved);
        extracted.push(...parseTrueTypeFontGlyphs(buf, { limit: maxItems }));
      }
    }

    // 2. Check SVG font markup
    if (!extracted.length && fontSvg && String(fontSvg).includes('<glyph')) {
      extracted.push(...parseSvgFontGlyphs(fontSvg, { limit: maxItems }));
    }

    // 3. Check base64 binary fontData (.ttf / .otf / .woff or base64 SVG font)
    if (!extracted.length && fontData && typeof fontData === 'string') {
      const cleanBase64 = fontData.replace(/^data:[^;]+;base64,/i, '').trim();
      const buf = Buffer.from(cleanBase64, 'base64');
      const headText = buf.subarray(0, 512).toString('utf8');
      if (headText.includes('<svg') || headText.includes('<font') || headText.includes('<glyph')) {
        extracted.push(...parseSvgFontGlyphs(buf.toString('utf8'), { limit: maxItems }));
      } else {
        extracted.push(...parseTrueTypeFontGlyphs(buf, { limit: maxItems }));
      }
    }

    // 4. Check explicit glyphs array `[{ name, d, char }]`
    if (!extracted.length && Array.isArray(glyphs) && glyphs.length) {
      for (const g of glyphs.slice(0, maxItems)) {
        if (g.d) extracted.push({ name: g.name || `glyph-${extracted.length + 1}`, d: g.d, char: g.char });
        else if (g.char) extracted.push({ name: g.name || `char-${g.char}`, char: g.char });
      }
    }

    // 5. Check preset (`ui-symbols`, `arrows-math`, `geometric-shapes`)
    if (!extracted.length && preset && VECTOR_GLYPH_PRESETS[preset]) {
      extracted.push(...VECTOR_GLYPH_PRESETS[preset].slice(0, maxItems));
    }

    // 6. Check custom characters string (`chars: "A B C ★ ♥"`)
    if (!extracted.length && chars && String(chars).trim()) {
      const charList = [...new Set(Array.from(String(chars).replace(/\s+/g, '')))].slice(0, maxItems);
      const presetLookup = new Map(
        Object.values(VECTOR_GLYPH_PRESETS).flat().map(g => [g.char, g])
      );
      for (const ch of charList) {
        if (presetLookup.has(ch)) {
          extracted.push(presetLookup.get(ch));
        } else {
          const cp = ch.codePointAt(0).toString(16);
          extracted.push({
            name: /[a-zA-Z0-9]/.test(ch) ? `${fontName}-${ch}` : `${fontName}-u${cp}`,
            char: ch
          });
        }
      }
    }

    if (!extracted.length) {
      throw new ValidationError('No extractable glyphs found in font source (provide an SVG font, .ttf/.woff font, preset, or characters)');
    }

    const items = [];
    const prefix = slugify(fontName || 'font');

    this.transaction(() => {
      for (const g of extracted.slice(0, maxItems)) {
        const itemName = g.name.startsWith(prefix) ? g.name : `${prefix} ${g.name}`.trim();
        let svgMarkup;
        if (g.d) {
          svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${g.d}"/></svg>`;
        } else {
          // Vector frame + centered typographic glyph node for arbitrary Unicode characters
          const escaped = String(g.char || '?').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><text x="12" y="17" font-size="14" font-weight="700" text-anchor="middle">${escaped}</text></svg>`;
        }
        try {
          const created = this.import(
            { svg: svgMarkup, as, name: itemName, category, projectId, visibility },
            { actor, actorId }
          );
          items.push(created);
        } catch {
          // Skip invalid single glyph
        }
      }
    });

    if (!items.length) throw new ValidationError('Failed to import any glyphs from font');

    return {
      importedCount: items.length,
      as,
      category,
      projectId: Number(projectId) || 1,
      visibility,
      items
    };
  }
}
