#!/usr/bin/env node
/**
 * CLI entry point.
 *   node main.js serve  [--port 5180] [--db data/designer.db]
 *   node main.js import [--legacy ../v1] [--reset] [--db ...]     seed/refresh from the v1 prototype + html catalog
 *   node main.js guide  [--out usage-and-guide.html]                 write the standalone usage guide
 *   node main.js export --out <folder> [--themes liquid,glow] [--screens all|key1,key2] [--icons used|all|none]
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { buildContainer } from './composition-root.js';
import { createHttpServer } from './interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[k] = true; else { args[k] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'serve';
const dbFile = resolve(args.db || join(here, 'data', 'designer.db'));
const defaultLegacy = existsSync(resolve(here, '..', 'v1'))
  ? resolve(here, '..', 'v1')
  : resolve(here, '..', '.archive', 'v1');

async function main() {
  const c = buildContainer({ dbFile, log: m => console.log(m) });
  try {
    if (cmd === 'guide') {
      // writes the standalone usage guide: node main.js guide --out C:\\docs\\usage-and-guide.html
      const target = resolve(args.out && args.out !== true ? args.out : 'usage-and-guide.html');
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(here, 'interfaces', 'web', 'guide', 'usage-and-guide.html'), target);
      console.log('usage guide written to', target);
      c.close();
    } else if (cmd === 'import') {
      const legacyRoot = resolve(args.legacy || defaultLegacy);
      if (!existsSync(legacyRoot)) console.warn(`legacy folder not found (${legacyRoot}); importing the built-in HTML catalog only`);
      const stats = c.importer.run({ legacyRoot: existsSync(legacyRoot) ? legacyRoot : null, reset: !!args.reset });
      console.log('import finished', stats);
      c.close();
    } else if (cmd === 'sync') {
      const res = await c.pgSync.syncNow({ forceFullPush: !!args.force });
      console.log('postgresql sync finished', res);
      c.close();
    } else if (cmd === 'export') {
      if (!args.out || args.out === true) throw new Error('--out <folder> is required');
      const screens = !args.screens || args.screens === 'all' ? 'all' : String(args.screens).split(',');
      const result = c.exporter.exportToFolder({ screenIds: screens, themeKeys: args.themes ? String(args.themes).split(',') : undefined, includeIcons: args.icons || 'used' }, resolve(args.out));
      console.log('exported', result);
      c.close();
    } else if (cmd === 'serve') {
      if (c.screen.list().length === 0 && c.icon.list().length === 0) {
        console.log('empty database: importing the v1 prototype and the HTML element catalog ...');
        const stats = c.importer.run({ legacyRoot: existsSync(defaultLegacy) ? defaultLegacy : null });
        console.log('import finished', stats);
      }
      const port = Number(args.port || process.env.PORT || 5180);
      const server = createHttpServer(c, { webRoot: join(here, 'interfaces', 'web'), domainRoot: join(here, 'domain') });
      server.listen(port, '127.0.0.1', () => console.log(`UI/UX designer running at http://127.0.0.1:${port}  (db: ${dbFile})`));
      process.on('SIGINT', () => { server.close(); c.close(); process.exit(0); });
    } else {
      console.error(`unknown command "${cmd}". Use serve, import or export.`);
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
main();
