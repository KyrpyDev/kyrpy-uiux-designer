#!/usr/bin/env node
/**
 * License-safe icon pack importer (`npm run icons:import`).
 *
 *   node scripts/import-icon-packs.js [--packs lucide,tabler,heroicons,phosphor,bootstrap] [--db <file>]
 *                                     [--cache <dir>] [--dry-run] [--limit N] [--paint theme|current]
 *                                     [--samples <dir>] [--no-notices]
 *
 * - Downloads EXACT pinned npm versions (`npm pack`, falling back to the registry tarball URL) into a cache dir
 *   (default `os.tmpdir()/kyrpy-icon-packs`) and verifies each tarball against its pinned sha512 integrity.
 * - Extracts every tarball with `tar` into a fresh, empty directory and reads the SVG files as DATA only
 *   (regular files only, no symlinks, size-capped); nothing from a package is ever executed or imported.
 * - Creates one public, builtin icon per SVG in project 1, owned by the `public` system user, with the geometry
 *   stored directly on the icon nodes (svg-import model: no path item, no instance). The root `<svg>` paint
 *   attributes (fill, stroke, stroke-width, ...) are copied onto a wrapping `g`, and non-24 viewBoxes
 *   (Phosphor 256, Bootstrap 16) are scaled into the 24 grid with a transform on that same group.
 *   With `--paint theme` (default) `currentColor` becomes the theme gradient `url(#lgS)`, so pack icons recolor
 *   with every theme like the built-in ones; `--paint current` keeps `currentColor` verbatim.
 * - Idempotent: keys (`<pack>-<slug>`) that already exist in project 1 are skipped. One transaction per pack.
 * - Brand / trademark logos are filtered out: one cross-pack deny-list (`isBrandSlug`: vendor / product names such as
 *   `bluetooth*`, `xbox-*`, `playstation-*`, `steam*`, `device-ipad*`) applied to EVERY pack, plus the per-pack rules
 *   (Tabler `brand-*`, Phosphor `*-logo*`, an explicit Bootstrap deny-list).
 * - Copies each pack's LICENSE verbatim to `src/third_party/icons/<pack>/LICENSE` and regenerates
 *   `src/THIRD_PARTY_NOTICES.md` from the pinned pack table below.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseXml } from '../infrastructure/import/xml-parser.js';
import { xmlToNodes, parseStyle } from '../infrastructure/import/svg-to-nodes.js';
import { publicUserId, ensurePublicUser } from '../domain/system-users.js';
import { inTransaction } from '../infrastructure/sqlite/database.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const PROJECT_ID = 1;
const MAX_SVG_BYTES = 64 * 1024;
const THEME_PAINT = 'url(#lgS)';

/* ------------------------------------------------------------------ pack table (pinned) */

/** Bootstrap Icons that are company / product logos (base names; `-fill`, `-square`, `-circle` variants match too). */
export const BOOTSTRAP_BRANDS = new Set([
  'alexa', 'alipay', 'amazon', 'amd', 'android', 'android2', 'anthropic', 'apple', 'apple-music', 'behance', 'bing',
  'bluesky', 'bluetooth', 'bootstrap', 'bootstrap-reboot', 'browser-chrome', 'browser-edge', 'browser-firefox',
  'browser-safari', 'claude', 'css', 'discord', 'dribbble', 'dropbox', 'facebook', 'git', 'github', 'gitlab', 'google',
  'google-play', 'instagram', 'javascript', 'linkedin', 'markdown', 'mastodon', 'medium', 'messenger', 'meta',
  'microsoft', 'microsoft-teams', 'nintendo-switch', 'nvidia', 'openai', 'opencollective', 'paypal', 'perplexity',
  'pinterest', 'playstation', 'quora', 'reddit', 'sina-weibo', 'skype', 'slack', 'snapchat', 'sourceforge', 'spotify',
  'stack-overflow', 'steam', 'strava', 'stripe', 'substack', 'telegram', 'tencent-qq', 'threads', 'tiktok', 'trello',
  'tux', 'twitch', 'twitter', 'twitter-x', 'typescript', 'ubuntu', 'unity', 'vimeo', 'wechat', 'whatsapp', 'wikipedia',
  'windows', 'wordpress', 'xbox', 'yelp', 'youtube', 'line', 'thunderbolt'
]);

/**
 * Cross-pack deny-list, applied to EVERY pack before its own rule: vendor, product and trademark names matched as a
 * whole `-`-separated segment (or segment run) anywhere in the slug, so `bluetooth-off`, `earphone-bluetooth`,
 * `xbox-a`, `playstation-x`, `device-ipad-horizontal` and `device-nintendo` are all caught. Built from scanning the
 * name lists of the pinned tarballs; generic words that a vendor also uses (`apple` the fruit, `line` the shape,
 * `git-branch`, `zoom-in`, `signal`, `switch`, `edge`, `medium`) are deliberately NOT here.
 */
export const BRAND_TERMS = [
  'airplay', 'airpods', 'airtag', 'alexa', 'alipay', 'amazon', 'amd', 'android', 'anthropic', 'apple-music',
  'apple-podcasts', 'behance', 'bing', 'bluesky', 'bluetooth', 'chatgpt', 'chromium', 'claude', 'codepen', 'codesandbox',
  'discord', 'dribbble', 'dropbox', 'facebook', 'figma', 'github', 'gitlab', 'google', 'imac', 'instagram', 'ipad',
  'iphone', 'jeep', 'lego', 'linkedin', 'macbook', 'mastodon', 'messenger', 'microsoft', 'nintendo', 'nvidia',
  'olympics', 'openai', 'pacman', 'paypal', 'perplexity', 'pinterest', 'playstation', 'pokeball', 'polaroid', 'reddit',
  'segway', 'skype', 'slack', 'snapchat', 'spotify', 'stripe', 'telegram', 'thunderbolt', 'tiktok', 'trello', 'tux',
  'twitch', 'twitter', 'ubuntu', 'vimeo', 'vision-pro', 'wechat', 'whatsapp', 'windows', 'wordpress', 'xbox', 'yelp',
  'youtube'
];
/** Brand words that only count at the START of a slug (later in a name they are generic: `ironing-steam`, `bowl-steam`). */
export const BRAND_PREFIXES = ['steam', 'markdown'];
const BRAND_RE = new RegExp(`(^|-)(${BRAND_TERMS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(-|$)`);
/** True when an icon slug names a vendor / product / trademark (cross-pack rule, see BRAND_TERMS / BRAND_PREFIXES). */
export function isBrandSlug(slug) {
  const s = String(slug).toLowerCase();
  return BRAND_RE.test(s) || BRAND_PREFIXES.some(p => s === p || s.startsWith(`${p}-`));
}
const bootstrapBase = slug => { let s = slug, prev; do { prev = s; s = s.replace(/-(fill|square|circle)$/, ''); } while (s !== prev); return s; };

export const PACKS = {
  lucide: {
    title: 'Lucide', npm: 'lucide-static', version: '1.70.0',
    integrity: 'sha512-A9UgY98g94IuHQY7rl7/AFwHX7T1qNpzryim+Kw5CGhdV2STobtBY+ib/Z44ohyqXEJB88gvXFAeJ87uOOHKLw==',
    license: 'ISC', licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    copyright: 'Copyright (c) 2026 Lucide Icons and Contributors (icons derived from Feather: Copyright (c) 2013-present Cole Bemis, MIT)',
    homepage: 'https://lucide.dev', iconUrl: s => `https://lucide.dev/icons/${s}`,
    variants: [{ dir: 'package/icons', suffix: '' }],
    imported: 'All `icons/*.svg` (24x24 outline, stroke 2) except the cross-pack brand deny-list (`bluetooth*`, `airplay`).',
    tagsFile: 'package/tags.json', readTags: (json, slug) => json[slug] || []
  },
  tabler: {
    title: 'Tabler Icons', npm: '@tabler/icons', version: '3.50.0',
    integrity: 'sha512-HflLxyrH1cqC7s7jzQGSjpsTAVIoaf7+/yHjbdM59rJQBMjliibp+LYhDPFxOMcwa1M8DNpOk6ENzQiWn9a1Dg==',
    license: 'MIT', licenseUrl: 'https://github.com/tabler/tabler-icons/blob/main/LICENSE',
    copyright: 'Copyright (c) 2020-2026 Paweł Kuna',
    homepage: 'https://tabler.io/icons', iconUrl: s => `https://tabler.io/icons/icon/${s}`,
    variants: [{ dir: 'package/icons/outline', suffix: '' }],
    exclude: slug => slug.startsWith('brand-'),
    imported: '`icons/outline/*.svg` only (24x24 outline, stroke 2); the filled set is not imported. All `brand-*` icons are excluded, and so is the cross-pack brand deny-list (`bluetooth*`, `xbox-*`, `playstation-*`, `steam`, `device-ipad*` / `device-imac*` / `airpods*`, `device-nintendo*`, `lego*`, `pokeball*`, `pacman`, `olympics*`, `markdown*`, ...).',
    tagsFile: 'package/icons.json', readTags: (json, slug) => json[slug]?.tags || [],
    readCategory: (json, slug) => json[slug]?.category || ''
  },
  heroicons: {
    title: 'Heroicons', npm: 'heroicons', version: '2.2.0',
    integrity: 'sha512-yOwvztmNiBWqR946t+JdgZmyzEmnRMC2nxvHFC90bF1SUttwB6yJKYeme1JeEcBfobdOs827nCyiWBS2z/brog==',
    license: 'MIT', licenseUrl: 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE',
    copyright: 'Copyright (c) Tailwind Labs, Inc.',
    homepage: 'https://heroicons.com', iconUrl: () => 'https://heroicons.com',
    variants: [{ dir: 'package/24/outline', suffix: '', style: 'outline' }, { dir: 'package/24/solid', suffix: '-solid', style: 'solid' }],
    imported: '`24/outline/*.svg` (stroke 1.5) and `24/solid/*.svg` (keys end in `-solid`); the 20 px and 16 px sets are not imported. The pack has no brand logos (the cross-pack deny-list matches none of its names).'
  },
  phosphor: {
    title: 'Phosphor Icons', npm: '@phosphor-icons/core', version: '2.1.1',
    integrity: 'sha512-v4ARvrip4qBCImOE5rmPUylOEK4iiED9ZyKjcvzuezqMaiRASCHKcRIuvvxL/twvLpkfnEODCOJp5dM4eZilxQ==',
    license: 'MIT', licenseUrl: 'https://github.com/phosphor-icons/core/blob/main/LICENSE',
    copyright: 'Copyright (c) 2023 Phosphor Icons',
    homepage: 'https://phosphoricons.com', iconUrl: s => `https://phosphoricons.com/?q=${encodeURIComponent(s)}`,
    variants: [{ dir: 'package/assets/regular', suffix: '' }],
    exclude: slug => slug.includes('-logo'),
    imported: '`assets/regular/*.svg` only (viewBox 256, fill), scaled into the 24 grid; the thin, light, bold, fill and duotone weights are not imported. All `*-logo*` icons are excluded, and so is the cross-pack brand deny-list (`bluetooth*`, `airplay`, `jeep`, `lego*`).'
  },
  bootstrap: {
    title: 'Bootstrap Icons', npm: 'bootstrap-icons', version: '1.13.2',
    integrity: 'sha512-fAU1Ly3dH7hwRg+CB8EZ0Vl0fF80zgXHeUVJyfUOKzoURr+TbwISbCW5tKUoQLERaWYG2emTCybcPbD96hdD1A==',
    license: 'MIT', licenseUrl: 'https://github.com/twbs/icons/blob/main/LICENSE',
    copyright: 'Copyright (c) 2019-2024 The Bootstrap Authors',
    homepage: 'https://icons.getbootstrap.com', iconUrl: s => `https://icons.getbootstrap.com/icons/${s}/`,
    variants: [{ dir: 'package/icons', suffix: '' }],
    exclude: slug => BOOTSTRAP_BRANDS.has(bootstrapBase(slug)),
    imported: 'All `icons/*.svg` (viewBox 16, fill), scaled into the 24 grid, except company and product logos (an explicit deny-list of ' +
      `${BOOTSTRAP_BRANDS.size} base names in \`scripts/import-icon-packs.js\`, matched together with their \`-fill\`, \`-square\` and \`-circle\` variants).`
  }
};

const EXCLUDED_PACKS = [
  ['Remix Icon (`remixicon` 4.9.1)', 'npm metadata says Apache-2.0, but the shipped `License` file is the custom "Remix Icon License v1.0", which forbids redistributing the icons as an icon pack or library and using them in a competing icon library. Not OSI-approved; a designer app that ships an icon catalog would breach it.'],
  ['Material Design Icons (`@mdi/svg` 7.4.47)', 'the shipped LICENSE is the "Pictogrammers Free License": icons are Apache-2.0 "or their respective licenses" (community contributions), so the license of an individual icon is ambiguous.'],
  ['Font Awesome Free (`@fortawesome/fontawesome-free`)', 'icons are CC BY 4.0, which requires visible per-use attribution, and the set includes trademarked brand icons.'],
  ['Simple Icons (`simple-icons`)', 'CC0 for the drawings, but every icon is a company or product logo protected by trademark law; a public UI library must not ship them as generic icons.']
];

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const o = { packs: Object.keys(PACKS), db: process.env.DB_FILE || join(srcRoot, 'data', 'designer.prod.db'), cache: join(tmpdir(), 'kyrpy-icon-packs'), dryRun: false, limit: 0, paint: 'theme', samples: '', notices: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--packs') o.packs = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--db') o.db = resolve(val());
    else if (a === '--cache') o.cache = resolve(val());
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--limit') o.limit = Math.max(0, Number.parseInt(val(), 10) || 0);
    else if (a === '--paint') o.paint = val();
    else if (a === '--samples') o.samples = resolve(val());
    else if (a === '--no-notices') o.notices = false;
    else if (a === '-h' || a === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 8).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  for (const p of o.packs) if (!PACKS[p]) throw new Error(`unknown pack "${p}" (known: ${Object.keys(PACKS).join(', ')})`);
  if (!['theme', 'current'].includes(o.paint)) throw new Error('--paint must be theme or current');
  return o;
}

/* ------------------------------------------------------------------ download + extract */

const sri = buf => `sha512-${createHash('sha512').update(buf).digest('base64')}`;
const tarballName = pack => `${pack.npm.replace(/^@/, '').replace('/', '-')}-${pack.version}.tgz`;

async function fetchTarball(pack, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, tarballName(pack));
  if (existsSync(file) && sri(readFileSync(file)) === pack.integrity) return file;
  rmSync(file, { force: true });
  try {
    // `npm pack <name>@<exact version>` only downloads the registry tarball; no lifecycle scripts run for a registry spec
    execFileSync('npm', ['pack', `${pack.npm}@${pack.version}`, '--pack-destination', cacheDir, '--silent', '--ignore-scripts'], { cwd: cacheDir, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const url = `https://registry.npmjs.org/${pack.npm}/-/${basename(pack.npm)}-${pack.version}.tgz`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cannot download ${pack.npm}@${pack.version}: npm pack failed (${e.message.split('\n')[0]}) and ${url} -> HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  if (!existsSync(file)) throw new Error(`npm pack did not produce ${file}`);
  const got = sri(readFileSync(file));
  if (got !== pack.integrity) { rmSync(file, { force: true }); throw new Error(`integrity mismatch for ${pack.npm}@${pack.version}: expected ${pack.integrity}, got ${got}`); }
  return file;
}

function extract(tgz, cacheDir, id) {
  const dir = mkdtempSync(join(cacheDir, `x-${id}-`));   // fresh, empty directory per pack
  execFileSync('tar', ['-xzf', tgz, '-C', dir, '--no-same-owner', '--no-same-permissions'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return dir;
}

/** Regular `.svg` files (no symlinks, no sub-directories) of one directory inside the extracted package. */
function listSvgs(dir) {
  if (!existsSync(dir)) throw new Error(`expected directory missing in tarball: ${dir}`);
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.svg') && !e.name.startsWith('.'))
    .map(e => e.name).sort();
}

function readJsonData(file) {
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/* ------------------------------------------------------------------ svg -> icon nodes */

const PAINT_ATTRS = ['fill', 'stroke'];
const ROOT_PRESENTATION = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'fill-opacity', 'stroke-opacity', 'opacity'];
const num = v => Math.round(v * 10000) / 10000;

function mapPaint(attrs, paintMode) {
  if (paintMode !== 'theme') return attrs;
  for (const k of PAINT_ATTRS) if (typeof attrs[k] === 'string' && attrs[k].trim().toLowerCase() === 'currentcolor') attrs[k] = THEME_PAINT;
  return attrs;
}

/**
 * Converts one pack svg into icon nodes: a wrapping `g` carrying the root paint attributes (+ 24-grid scale),
 * then the shapes. Both `fill` and `stroke` are always explicit on the wrapper so the theme's icon defaults
 * (stroke gradient, fill none) never leak into a fill-style glyph.
 */
export function packSvgToNodes(svgText, { paintMode = 'theme' } = {}) {
  const root = parseXml(svgText);
  const vb = String(root.attrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const w = hasVb ? vb[2] : parseFloat(root.attrs.width) || 24;
  const h = hasVb ? vb[3] : parseFloat(root.attrs.height) || 24;
  const k = 24 / Math.max(w, h);

  const rootStyle = { ...root.attrs, ...parseStyle(root.attrs.style) };
  const wrap = {};
  for (const a of ROOT_PRESENTATION) if (rootStyle[a] !== undefined && rootStyle[a] !== '') wrap[a] = String(rootStyle[a]);
  // svg defaults: fill black (= currentColor here), stroke none
  if (wrap.fill === undefined) wrap.fill = 'currentColor';
  if (wrap.stroke === undefined) wrap.stroke = 'none';
  const tf = [];
  if (hasVb && (vb[0] || vb[1])) tf.push(`translate(${num(-vb[0] * k)} ${num(-vb[1] * k)})`);
  if (k !== 1) tf.push(`scale(${num(k)})`);
  if (tf.length) wrap.transform = tf.join(' ');

  const shapes = xmlToNodes(root.children)
    .map(n => { const attrs = { ...n.attrs }; delete attrs.class; return { ...n, attrs: mapPaint(attrs, paintMode) }; })
    // Tabler's invisible 24x24 bounding-box helper (`<path stroke="none" d="M0 0h24v24H0z" fill="none"/>`)
    .filter(n => !(n.kind === 'shape' && n.attrs.fill === 'none' && n.attrs.stroke === 'none'));
  if (!shapes.some(n => n.kind === 'shape')) throw new Error('no supported shapes');
  const WRAP_ID = 0.5;
  return [
    { id: WRAP_ID, parentId: null, tag: 'g', kind: 'group', name: 'glyph', attrs: mapPaint(wrap, paintMode) },
    ...shapes.map(n => ({ ...n, parentId: n.parentId ?? WRAP_ID }))
  ];
}

const humanize = slug => { const s = slug.replace(/-/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const toSlug = file => file.replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const tagWords = list => list.flatMap(t => String(t).toLowerCase().split(/[^a-z0-9]+/)).filter(t => t.length > 1);

/* ------------------------------------------------------------------ licenses + notices */

function copyLicense(id, pkgDir) {
  const src = join(pkgDir, 'package', 'LICENSE');
  if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`${id}: LICENSE missing from tarball`);
  const dest = join(srcRoot, 'third_party', 'icons', id, 'LICENSE');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));   // verbatim bytes
}

export function noticesMarkdown() {
  const rows = Object.entries(PACKS).map(([id, p]) =>
    `| ${p.title} | \`${p.npm}\` | ${p.version} | ${p.license} | ${p.copyright} | ${p.homepage} | [third_party/icons/${id}/LICENSE](third_party/icons/${id}/LICENSE) |`);
  const details = Object.entries(PACKS).map(([id, p]) =>
    `### ${p.title} (\`${id}-*\` keys)\n\n- Package: \`${p.npm}@${p.version}\` (integrity \`${p.integrity}\`)\n- License: ${p.license} (${p.licenseUrl}), ${p.copyright}\n- Imported: ${p.imported}\n- Stored as: public builtin icons in project 1, category \`pack-${id}\`, key \`${id}-<file name>\`; every icon's \`meta\` carries \`pack\`, \`packVersion\`, \`license\`, \`licenseUrl\`, \`sourceUrl\` and \`file\`.`);
  return `# Third-party notices

This file is generated by \`src/scripts/import-icon-packs.js\` (\`npm run icons:import\`). Do not edit it by hand; change the pack table in the script and re-run it.

The icon library bundles SVG icons from the open-source packs below. Each one is under a permissive license (MIT or ISC) whose only condition is that the copyright notice and the license text are kept with the icons. The full license text of each pack is copied verbatim into \`src/third_party/icons/<pack>/LICENSE\`. The icons were converted from SVG into the designer's node model (geometry unchanged, scaled into a 24x24 grid, paint mapped to the theme); no other change was made.

| Pack | npm package | Version | License | Copyright | Homepage | License text |
|---|---|---|---|---|---|---|
${rows.join('\n')}

${details.join('\n\n')}

## Brand and logo icons

Company and product logos are trademarks even when the drawing is under an open-source license, so they are never imported. One cross-pack deny-list is applied to EVERY pack (\`isBrandSlug\` in the import script): a slug is excluded when one of its \`-\`-separated segments is a vendor, product or trademark name (\`BRAND_TERMS\`: ${BRAND_TERMS.join(', ')}) or when it starts with ${BRAND_PREFIXES.map(p => `\`${p}\``).join(' / ')} (\`BRAND_PREFIXES\`; later in a name these are generic, e.g. \`ironing-steam\`). Generic words a vendor also uses (\`apple\` the fruit, \`line\` the shape, \`git-branch\`, \`zoom-in\`, \`signal\`) are kept. On top of that each pack keeps its own rule: Tabler \`brand-*\`, Phosphor \`*-logo*\` and the explicit Bootstrap Icons deny-list (\`BOOTSTRAP_BRANDS\`: ${[...BOOTSTRAP_BRANDS].join(', ')}).

## Packs deliberately not bundled

${EXCLUDED_PACKS.map(([n, r]) => `- **${n}**: ${r}`).join('\n')}
`;
}

/* ------------------------------------------------------------------ main */

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  mkdirSync(opt.cache, { recursive: true });
  const dbFile = opt.db;
  if (!existsSync(dbFile) && opt.dryRun) throw new Error(`database not found: ${dbFile}`);
  const sizeOf = f => (existsSync(f) ? statSync(f).size : 0) + (existsSync(`${f}-wal`) ? statSync(`${f}-wal`).size : 0);

  let c = null, ro = null, publicId = null;
  if (opt.dryRun) {
    ro = new DatabaseSync(dbFile, { readOnly: true });
    publicId = publicUserId(ro);
  } else {
    const { buildContainer } = await import('../composition-root.js');
    c = buildContainer({ dbFile, syncEnabled: false });
    publicId = publicUserId(c.db) ?? ensurePublicUser(c.db);
    if (publicId == null) throw new Error('cannot resolve or create the public library user');
  }
  const db = c?.db ?? ro;
  const keyExists = key => !!db.prepare('SELECT 1 FROM icons WHERE key = ? AND project_id = ?').get(key, PROJECT_ID);
  const nodeCount = () => db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  const nodesBefore = nodeCount();
  const sizeBefore = sizeOf(dbFile);
  console.log(`${opt.dryRun ? '[dry-run] ' : ''}db ${dbFile} (public user id ${publicId ?? 'n/a'}), cache ${opt.cache}, paint ${opt.paint}`);

  const report = [];
  const samples = [];
  for (const id of opt.packs) {
    const pack = PACKS[id];
    const r = { pack: id, version: pack.version, candidates: 0, imported: 0, skipped: 0, excluded: 0, errors: [], nodes: 0 };
    report.push(r);
    const tgz = await fetchTarball(pack, opt.cache);
    const pkgDir = extract(tgz, opt.cache, id);
    try {
      if (!opt.dryRun) copyLicense(id, pkgDir);
      const tagJson = pack.tagsFile ? readJsonData(join(pkgDir, pack.tagsFile)) : null;
      const work = [];
      for (const v of pack.variants) {
        const dir = join(pkgDir, v.dir);
        for (const file of listSvgs(dir)) {
          const slug = toSlug(file);
          if (isBrandSlug(slug) || pack.exclude?.(slug)) { r.excluded++; continue; }
          work.push({ v, dir, file, slug });
        }
      }
      const todo = opt.limit ? work.slice(0, opt.limit) : work;
      r.candidates = todo.length;

      const runPack = () => {
        for (const { v, dir, file, slug } of todo) {
          const key = `${id}-${slug}${v.suffix}`;
          if (keyExists(key)) { r.skipped++; continue; }
          try {
            const full = join(dir, file);
            if (statSync(full).size > MAX_SVG_BYTES) throw new Error('svg larger than 64 KB');
            const nodes = packSvgToNodes(readFileSync(full, 'utf8'), { paintMode: opt.paint });
            const human = humanize(slug) + (v.style === 'solid' ? ' (solid)' : '');
            const packTags = tagJson ? (pack.readTags(tagJson, slug) || []).slice(0, 6) : [];
            const packCategory = tagJson && pack.readCategory ? pack.readCategory(tagJson, slug) : '';
            const tags = [...new Set([id, ...(v.style ? [v.style] : []), ...tagWords([slug, packCategory, ...packTags])])].slice(0, 16);
            r.nodes += nodes.length;
            if (opt.dryRun) { r.imported++; continue; }
            const rec = c.services.icon.create({
              key, name: human, label: human, category: `pack-${id}`, tags,
              width: 24, height: 24, builtin: true, visibility: 'public', projectId: PROJECT_ID,
              creatorId: publicId, rootOwnerId: publicId,
              descriptionDev: `${pack.title} icon "${slug}"${v.style ? ` (${v.style})` : ''} — ${pack.license}, ${pack.npm}@${pack.version}.`,
              meta: {
                source: `pack/${id}`, pack: id, packVersion: pack.version, license: pack.license, licenseUrl: pack.licenseUrl,
                sourceUrl: pack.iconUrl(slug), file: `${v.dir.replace(/^package\//, '')}/${file}`,
                ...(packCategory ? { packCategory } : {}), ...(v.style ? { style: v.style } : {})
              }
            }, { nodes, actorId: publicId });
            r.imported++;
            if (!samples.some(s => s.pack === id)) samples.push({ pack: id, id: rec.id, key });
          } catch (e) {
            r.errors.push({ file: `${v.dir}/${file}`, error: e.message });
          }
        }
      };
      if (opt.dryRun) runPack(); else inTransaction(c.db, runPack);
    } finally {
      rmSync(pkgDir, { recursive: true, force: true });
    }
    console.log(`${id.padEnd(10)} v${pack.version.padEnd(7)} candidates ${String(r.candidates).padStart(5)}  imported ${String(r.imported).padStart(5)}  skipped ${String(r.skipped).padStart(5)}  brand-excluded ${String(r.excluded).padStart(4)}  errors ${r.errors.length}  nodes ${r.nodes}`);
    for (const e of r.errors.slice(0, 10)) console.log(`   ! ${e.file}: ${e.error}`);
  }

  if (!opt.dryRun && opt.notices) writeFileSync(join(srcRoot, 'THIRD_PARTY_NOTICES.md'), noticesMarkdown());

  if (opt.samples && c) {
    mkdirSync(opt.samples, { recursive: true });
    const theme = c.settings?.get?.().theme;
    // fall back to the first already-present icon of a pack when this run skipped everything
    for (const id of opt.packs) {
      if (samples.some(s => s.pack === id)) continue;
      const row = c.db.prepare("SELECT id, key FROM icons WHERE project_id = ? AND category = ? ORDER BY id LIMIT 1").get(PROJECT_ID, `pack-${id}`);
      if (row) samples.push({ pack: id, id: row.id, key: row.key });
    }
    for (const s of samples) {
      const svg = c.render.svg('icon', s.id, theme, { size: 96 });
      writeFileSync(join(opt.samples, `${s.key}.svg`), svg);
      console.log(`sample ${s.key}.svg written`);
    }
  }

  const nodesAfter = nodeCount();
  const total = report.reduce((a, r) => ({ imported: a.imported + r.imported, skipped: a.skipped + r.skipped, errors: a.errors + r.errors.length, excluded: a.excluded + r.excluded }), { imported: 0, skipped: 0, errors: 0, excluded: 0 });
  (c ?? { close: () => ro.close() }).close();
  console.log(`total: imported ${total.imported}, skipped ${total.skipped}, brand-excluded ${total.excluded}, errors ${total.errors}; node rows added ${opt.dryRun ? `${report.reduce((a, r) => a + r.nodes, 0)} (would be)` : nodesAfter - nodesBefore}`);
  if (!opt.dryRun) console.log(`db size (incl. WAL): ${(sizeBefore / 1048576).toFixed(1)} MB -> ${(sizeOf(dbFile) / 1048576).toFixed(1)} MB`);
  return total.errors ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code), e => { console.error(`import-icon-packs: ${e.message}`); process.exit(2); });
}
