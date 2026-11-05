/**
 * Reads the v1 prototype (J:\kyrpy-uiux-designer\v1): svg/*.svg icons, items/*.js, screens/<family>/<NN-name>/screen.js.
 * The v1 .js files are plain "register" scripts (UD.addItem / UD.addScreen); they are evaluated in an isolated vm
 * context with a stub registry, never with access to node APIs.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

function runRegistry(file) {
  const rec = { items: [], screens: [], defs: {}, topbar: null };
  const UD = { addItem: t => rec.items.push(t), addScreen: s => rec.screens.push(s), addDefs: (g, s) => { rec.defs[g] = s; }, setTopbar: c => { rec.topbar = c; } };
  vm.runInNewContext(readFileSync(file, 'utf8'), { UD }, { filename: file, timeout: 5000 });
  return rec;
}

export function loadLegacy(root) {
  const out = { icons: [], items: [], screens: [], labels: new Map() };

  // icon labels: "key : label"
  const labelsFile = join(root, 'icon-labels.txt');
  if (existsSync(labelsFile)) {
    for (const line of readFileSync(labelsFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([a-z0-9-]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out.labels.set(m[1], m[2]);
    }
  }

  // icons: every svg/<name>.svg except the button frame templates
  const svgDir = join(root, 'svg');
  if (existsSync(svgDir)) {
    for (const f of readdirSync(svgDir).filter(n => n.endsWith('.svg')).sort()) {
      const key = f.replace(/\.svg$/, '');
      if (key.startsWith('button-template-')) { out.icons.push({ key, template: true, svg: readFileSync(join(svgDir, f), 'utf8') }); continue; }
      out.icons.push({ key, svg: readFileSync(join(svgDir, f), 'utf8') });
    }
  }

  // items
  const itemsDir = join(root, 'items');
  if (existsSync(itemsDir)) {
    for (const f of readdirSync(itemsDir).filter(n => n.endsWith('.js')).sort()) out.items.push(...runRegistry(join(itemsDir, f)).items);
  }

  // screens (all families)
  const screensDir = join(root, 'screens');
  if (existsSync(screensDir)) {
    for (const fam of readdirSync(screensDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
      for (const d of readdirSync(join(screensDir, fam), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort()) {
        const file = join(screensDir, fam, d, 'screen.js');
        if (existsSync(file)) { const r = runRegistry(file); for (const s of r.screens) out.screens.push({ ...s, folder: d }); }
      }
    }
  }
  return out;
}

/** Icon geometry = the children of <g filter="url(#glow)"> in each exported svg (same rule v1 build-app-designs.py uses). */
export function iconBodyMarkup(svg) {
  const start = svg.indexOf('<g filter="url(#glow)">');
  if (start < 0) return null;
  const open = start + '<g filter="url(#glow)">'.length;
  let end = svg.lastIndexOf('</svg>');
  for (let i = 0; i < 2; i++) end = svg.lastIndexOf('</g>', end - 1);
  return svg.slice(open, end);
}
