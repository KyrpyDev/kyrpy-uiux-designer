import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regression: actions.js used isSuperadminUser without importing it, so dropping an item on a screen threw
// "isSuperadminUser is not defined". Every state.js helper a web module calls must be imported there.
const web = f => readFileSync(fileURLToPath(new URL(`../interfaces/web/js/${f}`, import.meta.url)), 'utf8');
const stateExports = [...web('state.js').matchAll(/export (?:const|function|async function) (\w+)/g)].map(m => m[1]);

for (const file of ['actions.js', 'main.js']) {
  test(`${file} imports every state.js helper it calls`, () => {
    const src = web(file);
    const imported = new Set([...src.matchAll(/import \{([^}]*)\} from '\.\/state\.js'/g)].flatMap(m => m[1].split(',').map(x => x.trim())));
    const local = new Set([...src.matchAll(/(?:const|function|let) (\w+)/g)].map(m => m[1]));
    const missing = stateExports.filter(n => /^(is|can)[A-Z]/.test(n) && new RegExp(`\\b${n}\\(`).test(src) && !imported.has(n) && !local.has(n));
    assert.deepEqual(missing, []);
  });
}
