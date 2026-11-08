#!/usr/bin/env node
/**
 * Downloads online icon sets (Iconify API, SVG only) and imports them into the live database (`npm run icons:online`).
 *
 *   node scripts/import-online-sets.js [--sets tabler,lucide,line-md,svg-spinners,meteocons,devicon,heroicons,simple-icons]
 *        [--db <file>] [--project 1] [--visibility public|project] [--max 10000] [--delay 400] [--list] [--dry-run]
 *
 * - Default sets: the ones the library's "Online" panel features. `--list` prints every available set and exits.
 * - Idempotent: keys `<set>-<name>` already in the project are skipped. At most `--max` (default and hard cap 10 000) icons per set.
 * - Animated sets import as static geometry (SMIL stripped); symbol/use sets (Meteocons) are inlined.
 * - Polite to the free API: `--delay` ms between sets, automatic back-off on HTTP 429.
 * - Stop the dev server (or accept that it caches the library) and restart it afterwards to see the new icons.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
export const DEFAULT_SETS = ['tabler', 'lucide', 'line-md', 'svg-spinners', 'meteocons', 'devicon', 'heroicons', 'simple-icons'];

export function parseArgs(argv) {
  const o = { sets: DEFAULT_SETS, db: resolve(process.env.DB_FILE || resolve(srcRoot, 'data/designer.prod.db')), project: 1, visibility: '', max: 10000, delay: 400, list: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--sets') o.sets = String(next()).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--db') o.db = resolve(next());
    else if (a === '--project') o.project = Number(next()) || 1;
    else if (a === '--visibility') o.visibility = next();
    else if (a === '--max') o.max = Math.min(10000, Math.max(1, Number(next()) || 10000));
    else if (a === '--delay') o.delay = Math.max(0, Number(next()) || 0);
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') { console.log('see the header of scripts/import-online-sets.js'); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const { buildContainer } = await import('../composition-root.js');
  if (!existsSync(opt.db) && !opt.list) throw new Error(`database not found: ${opt.db}`);
  const c = buildContainer({ dbFile: opt.list ? ':memory:' : opt.db, syncEnabled: false });
  try {
    const { OnlineIconService } = await import('../application/online-icon-service.js');
    const svc = new OnlineIconService({ services: c.services, transaction: c.transaction, backoffMs: 6000 });
    const cols = await svc.collections();
    if (opt.list) { for (const s of cols) console.log(`${s.prefix.padEnd(28)} ${String(s.total).padStart(6)}  ${s.license.padEnd(14)} ${s.title}`); return; }
    const known = new Map(cols.map(s => [s.prefix, s]));
    const admin = c.auth?.resolveActor?.({ allowDefault: true }) || { id: 1, username: 'superadmin', role: 'admin' };
    console.log(`${opt.dryRun ? '[dry-run] ' : ''}db ${opt.db} · project ${opt.project} · up to ${opt.max} icons per set`);
    const total = { imported: 0, skipped: 0, failed: 0 };
    for (const prefix of opt.sets) {
      const info = known.get(prefix);
      if (!info) { console.log(`${prefix.padEnd(14)} unknown set (use --list)`); continue; }
      if (opt.dryRun) { console.log(`${prefix.padEnd(14)} would import ${Math.min(info.total, opt.max)} of ${info.total} (${info.license})`); continue; }
      const t = Date.now();
      try {
        const r = await svc.importSet({ prefix, max: opt.max, projectId: opt.project, visibility: opt.visibility || undefined }, { actor: admin });
        for (const k of Object.keys(total)) total[k] += r[k];
        console.log(`${prefix.padEnd(14)} imported ${String(r.imported).padStart(5)}  existing ${String(r.skipped).padStart(5)}  failed ${String(r.failed).padStart(4)}  of ${r.total}${r.truncated ? ' (capped)' : ''}  ${((Date.now() - t) / 1000).toFixed(1)}s  ${info.license}`);
        for (const e of r.errors.slice(0, 3)) console.log(`   ! ${e}`);
      } catch (e) { console.log(`${prefix.padEnd(14)} FAILED: ${e.message}`); }
      await new Promise(r => setTimeout(r, opt.delay));
    }
    if (!opt.dryRun) console.log(`done: ${total.imported} imported, ${total.skipped} existing, ${total.failed} failed`);
  } finally { c.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
