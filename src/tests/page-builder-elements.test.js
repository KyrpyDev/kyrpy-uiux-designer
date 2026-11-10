import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { HTML_ELEMENTS, BUTTON_ELEMENTS, PAGE_BUILDER_ELEMENTS } from '../infrastructure/import/elements-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', 'v1')) ? resolve(here, '..', '..', 'v1') : resolve(here, '..', '..', '.archive', 'v1');
const KEYS = PAGE_BUILDER_ELEMENTS.map(e => e.key);

test('page-builder blocks: unique html-* keys, not clashing with the other presets, nodes inside the box', () => {
  assert.ok(KEYS.length >= 40);
  assert.equal(new Set(KEYS).size, KEYS.length);
  const others = new Set([...HTML_ELEMENTS, ...BUTTON_ELEMENTS].map(e => e.key));
  for (const d of PAGE_BUILDER_ELEMENTS) {
    assert.match(d.key, /^html-[a-z0-9-]+$/);
    assert.ok(!others.has(d.key), `${d.key} clashes`);
    assert.ok(d.dev, `${d.key} has dev notes`);
    for (const n of d.nodes) assert.ok(n.name, `${d.key}: every node is named`);
    const rects = d.nodes.filter(n => n.tag === 'rect');
    for (const r of rects) assert.ok(r.attrs.x + r.attrs.width <= d.width + 1 && r.attrs.y + r.attrs.height <= d.height + 1, `${d.key}/${r.name} inside the box`);
  }
});

test('page-builder blocks: a fresh database gets them all as public built-in elements', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const pub = c.publicUserId();
    const byKey = new Map(c.services.element.list().map(e => [e.key, e]));
    for (const k of KEYS) {
      const e = byKey.get(k);
      assert.ok(e, `${k} imported`);
      assert.equal(e.builtin, true);
      assert.equal(e.meta.preset, true);
      const row = c.db.prepare('SELECT visibility, creator_id FROM elements WHERE id = ?').get(e.id);
      assert.equal(row.visibility, 'public'); assert.equal(row.creator_id, pub);
      assert.match(c.render.boxSvg('element', e.id, 'liquid'), /^<svg/);
    }
  } finally { c.close(); }
});

test('page-builder blocks: an older library without them gets them all, once', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    for (const k of KEYS) c.services.element.remove(c.services.element.list().find(e => e.key === k).id, { permanent: true });
    assert.deepEqual(c.importer.ensurePresets(KEYS).sort(), [...KEYS].sort(), 'older library: all added');
    assert.deepEqual(c.importer.ensurePresets(KEYS), [], 'idempotent');
  } finally { c.close(); }
});
