#!/usr/bin/env node
/**
 * One-time backfill of the global project prefix for existing projects (idempotent).
 *   node src/scripts/set-project-prefixes.js --db=path/to/designer.db [--apply]
 * Without --apply it only prints what would change. A project that already has a prefix is never changed.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { isValidProjectPrefix } from '../domain/naming.js';

// existing projects named by the user: kyrpy-untrap app -> untrap, reverse-engineered Untrap -> untraprev.
// The public library keeps its own prefix; the plain "untrap" project gets untrapcore so the prefixes stay unique.
export const PREFIX_BY_KEY = {
  'kyrpy-untrap-app': 'untrap',
  'untrap-reverse-engineered': 'untraprev',
  'default-project': 'public',
  untrap: 'untrapcore'
};

export function planPrefixes(rows) {
  const taken = new Map(rows.map(r => [r.key, JSON.parse(r.settings || '{}').prefix]).filter(([, p]) => p));
  const usedPrefixes = new Set(taken.values());
  const plan = [];
  for (const r of rows) {
    const settings = JSON.parse(r.settings || '{}');
    if (settings.prefix) continue;                             // never change a prefix that is already set
    const prefix = PREFIX_BY_KEY[r.key];
    if (!prefix) { plan.push({ id: r.id, key: r.key, error: 'no prefix mapped for this project' }); continue; }
    if (!isValidProjectPrefix(prefix)) { plan.push({ id: r.id, key: r.key, error: `invalid prefix ${prefix}` }); continue; }
    if (usedPrefixes.has(prefix)) { plan.push({ id: r.id, key: r.key, error: `prefix ${prefix} already used` }); continue; }
    usedPrefixes.add(prefix);
    plan.push({ id: r.id, key: r.key, prefix, settings: { ...settings, prefix } });
  }
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const dbArg = process.argv.find(a => a.startsWith('--db='));
  if (!dbArg) { console.error('usage: --db=path [--apply]'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  const db = new DatabaseSync(resolve(dbArg.slice(5)));
  const rows = db.prepare('SELECT id, key, settings FROM projects').all();
  const plan = planPrefixes(rows);
  for (const p of plan) console.log(p.error ? `SKIP ${p.key}: ${p.error}` : `${p.key} -> prefix "${p.prefix}"`);
  if (apply) {
    const upd = db.prepare('UPDATE projects SET settings = ?, updated_at = datetime(\'now\') WHERE id = ?');
    for (const p of plan) if (!p.error) upd.run(JSON.stringify(p.settings), p.id);
    console.log(`applied ${plan.filter(p => !p.error).length} prefix(es)`);
  } else console.log('dry run (add --apply to write)');
  db.close();
}
