/**
 * Style switching for a repository that installed ALL design styles and button styles (uiux_init).
 * Pure text generators: the bundle ships `switch-style.mjs`, `tokens/button-styles.{css,ts}`.
 */

const num = v => (v === undefined || v === null ? undefined : Number(v));

/** CSS custom properties per button style: <html data-button-style="pill">. */
export function buttonStylesCss(styles, defaults) {
  const rule = s => {
    const lines = [`  --uiux-btn-shape: ${s.shape};`, `  --uiux-btn-radius-ratio: ${num(s.rxRatio)};`];
    if (s.fill) lines.push(`  --uiux-btn-fill: ${s.fill};`);
    if (s.strokeRatio !== undefined) lines.push(`  --uiux-btn-stroke-ratio: ${num(s.strokeRatio)};`);
    if (s.opacity !== undefined) lines.push(`  --uiux-btn-opacity: ${num(s.opacity)};`);
    return `[data-button-style="${s.key}"] {\n${lines.join('\n')}\n}`;
  };
  return `/* Button styles — switch with <html data-button-style="<key>"> or switch-style.mjs.\n   Radius = min(width, height) * --uiux-btn-radius-ratio. Icon size = ${defaults.buttonIconSizePct}% of the button by default. */\n:root { --uiux-btn-icon-size-pct: ${defaults.buttonIconSizePct}; }\n${styles.map(rule).join('\n')}\n`;
}

export function buttonStylesTs(styles, defaults) {
  return `// Generated button styles. Active style is chosen by switch-style.mjs (uiux/active/active.json).\nexport const BUTTON_STYLES = ${JSON.stringify(styles, null, 2)} as const;\nexport type ButtonStyleKey = (typeof BUTTON_STYLES)[number]['key'];\nexport const DEFAULT_BUTTON_STYLE: ButtonStyleKey = ${JSON.stringify(defaults.buttonStyle)};\nexport const DEFAULT_BUTTON_ICON_SIZE_PCT = ${Number(defaults.buttonIconSizePct)};\n`;
}

/** Node ESM script, no dependencies. Run from the repository root. */
export function switchStyleScript(root, defaultStyle, defaultButton) {
  return `#!/usr/bin/env node
// Switch the active design style and button style of this repository.
//   node ${root}/source/switch-style.mjs --list
//   node ${root}/source/switch-style.mjs <design-style> [<button-style>]
//   node ${root}/source/switch-style.mjs --button <button-style>
// Copies ${root}/source/adapters/web/<style>/ to ${root}/active/ and writes ${root}/active/active.json.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));      // ${root}/source
const out = join(here, '..', 'active');
const styles = JSON.parse(readFileSync(join(here, 'styles.json'), 'utf8'));
const args = process.argv.slice(2);
const activeFile = join(out, 'active.json');
const current = existsSync(activeFile) ? JSON.parse(readFileSync(activeFile, 'utf8')) : { designStyle: ${JSON.stringify(defaultStyle)}, buttonStyle: ${JSON.stringify(defaultButton)} };
if (args.includes('--list') || !args.length) {
  console.log('Design styles (active: ' + current.designStyle + ')');
  for (const s of styles.designStyles) console.log('  ' + (s.key === current.designStyle ? '* ' : '  ') + s.key + (s.mode ? '  [' + s.mode + ']' : '') + (s.pairKey ? '  pair: ' + s.pairKey : ''));
  console.log('Button styles (active: ' + current.buttonStyle + ')');
  for (const b of styles.buttonStyles) console.log('  ' + (b.key === current.buttonStyle ? '* ' : '  ') + b.key + '  ' + b.label);
  process.exit(0);
}
let design = current.designStyle, button = current.buttonStyle;
if (args[0] === '--button') button = args[1]; else { design = args[0]; if (args[1]) button = args[1]; }
if (!styles.designStyles.some(s => s.key === design)) { console.error('unknown design style: ' + design + ' (see --list)'); process.exit(1); }
if (!styles.buttonStyles.some(b => b.key === button)) { console.error('unknown button style: ' + button + ' (see --list)'); process.exit(1); }
const src = join(here, 'adapters', 'web', design);
if (!styles.spritesForAllStyles && !styles.spriteStyles.includes(design)) console.warn('note: this project is large; icon sprites exist only for ' + styles.spriteStyles.join(', ') + '. Tokens for ' + design + ' are applied, keep the existing icons.sprite.svg or re-run uiux_create_bundle with styles ["' + design + '"].');
if (!existsSync(src)) { console.error('style files missing: ' + src); process.exit(1); }
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
cpSync(join(here, 'tokens', 'button-styles.css'), join(out, 'button-styles.css'));
cpSync(join(here, 'tokens', 'button-styles.ts'), join(out, 'button-styles.ts'));
writeFileSync(activeFile, JSON.stringify({ designStyle: design, buttonStyle: button, switchedAt: new Date().toISOString() }, null, 2));
console.log('active design style: ' + design + ', button style: ' + button + ' -> ${root}/active/');
console.log('Set <html data-button-style="' + button + '"> and import ${root}/active/tokens.css + button-styles.css.');
`;
}
