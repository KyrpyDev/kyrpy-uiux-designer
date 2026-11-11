#!/usr/bin/env node
/**
 * Meta Astryx Harvest & Ingestion Pipeline for kyrpy-uiux-designer.
 *
 * Imports the Astryx design system into the public designer library:
 *   - 16 Themes (8 families: Neutral, Butter, Chocolate, Gothic, Matcha, Probe, Stone, Y2K in Light & Dark modes)
 *   - Apple/WWDC Spring Physics & Motion Runtime (`astryx-motion-runtime.js` + `web/js/astryx-motion.js`)
 *   - 5 Astryx Buttons (Primary, Secondary, Ghost, Destructive, Icon)
 *   - 18 Astryx UI Elements (ChatComposer, User/Assistant Bubbles, ToolCall, CommandPalette, StatCard, etc.)
 *   - 5 Astryx Screen Templates (AI Chat Studio, Analytics Dashboard, Canvas Editor, Form Wizard, Kanban)
 *   - Astryx Application Flow Workflow
 *
 * Usage:
 *   node src/scripts/harvest-astryx.js
 *   node src/scripts/harvest-astryx.js --db=src/data/designer.db
 *   node src/scripts/harvest-astryx.js --source=/tmp/astryx_inspect
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const defaultDb = resolve(process.env.DB_FILE || join(srcRoot, 'data', 'designer.prod.db'));

export async function harvestAstryx({ dbFile = defaultDb, sourceDir = '/tmp/astryx_inspect' } = {}) {
  console.log(`[astryx-harvester] Opening database: ${dbFile}`);
  const c = buildContainer({ dbFile });

  try {
    console.log(`[astryx-harvester] Seeding Astryx design system into library...`);
    const stats = c.importer.ensureAstryxLibrary();

    console.log(`[astryx-harvester] Done! Ingestion results:`);
    console.log(`  - Themes:    ${stats.themes} added`);
    console.log(`  - Buttons:   ${stats.buttons} added`);
    console.log(`  - Elements:  ${stats.elements} added`);
    console.log(`  - Screens:   ${stats.screens} added`);
    console.log(`  - Workflows: ${stats.workflows} added`);

    return stats;
  } finally {
    c.close();
  }
}

// Direct execution CLI runner
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let dbFile = defaultDb;
  let sourceDir = '/tmp/astryx_inspect';

  for (const a of args) {
    if (a.startsWith('--db=')) dbFile = resolve(a.slice(5));
    if (a.startsWith('--source=')) sourceDir = resolve(a.slice(9));
  }

  harvestAstryx({ dbFile, sourceDir })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[astryx-harvester] ERROR:', err);
      process.exit(1);
    });
}
