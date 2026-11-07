import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildContainer } from '../composition-root.js';
import { DEFAULT_BUTTON_TEMPLATES, designButtonTemplateNodes, isDesignButtonTemplate, buttonStyleFrameKey } from '../domain/entities.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', 'v1')) ? resolve(here, '..', '..', 'v1') : resolve(here, '..', '..', '.archive', 'v1');
const TPL_KEYS = DEFAULT_BUTTON_TEMPLATES.map(t => t.key);
const LEDGER = 'preset-003-design-button-templates';

const tplRows = c => c.db.prepare(`SELECT id, key, name, category, width, height, position, project_id, visibility, creator_id, root_owner_id, builtin, uid
  FROM buttons WHERE project_id = 1 AND key IN (${TPL_KEYS.map(() => '?').join(',')}) ORDER BY id`).all(...TPL_KEYS);
const shapeOf = b => b.nodes.map(n => ({ tag: n.tag, role: n.role, attrs: n.attrs }));

test('design button templates: 40 templates, nodes follow the template_buttons builder', () => {
  assert.equal(DEFAULT_BUTTON_TEMPLATES.length, 40);
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    for (const t of DEFAULT_BUTTON_TEMPLATES) {
      const nodes = designButtonTemplateNodes(t);
      assert.deepEqual(c.templates.listButtons().find(x => x.key === t.key).nodesTemplate, JSON.parse(JSON.stringify(nodes)), `${t.key} same nodes as template_buttons`);
      assert.equal(nodes[0].attrs.width, t.width); assert.equal(nodes[0].attrs.height, t.height);
    }
  } finally { c.close(); }
  assert.equal(isDesignButtonTemplate({ key: 'glass-pill', builtin: true }), true);
  assert.equal(isDesignButtonTemplate({ key: 'glass-pill', builtin: false }), false);
  assert.equal(isDesignButtonTemplate({ key: 'home-button', builtin: true }), false);
});

test('design button templates: a fresh database gets all 40 as public buttons right below the frames', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const pub = c.publicUserId();
    const rows = tplRows(c);
    assert.deepEqual(rows.map(r => r.key).sort(), [...TPL_KEYS].sort());
    const framePos = c.button.get(buttonStyleFrameKey('circle')).position;
    for (const r of rows) {
      const t = DEFAULT_BUTTON_TEMPLATES.find(x => x.key === r.key);
      assert.equal(r.name, t.name); assert.equal(r.category, 'templates');
      assert.equal(r.width, t.width); assert.equal(r.height, t.height);
      assert.equal(r.visibility, 'public'); assert.equal(r.builtin, 1);
      assert.equal(r.creator_id, pub); assert.equal(r.root_owner_id, pub);
      assert.equal(r.position, framePos + 1, `${r.key} sorts right after the frames`);
      assert.ok(r.uid, 'uid assigned');
    }
    const b = c.button.get('glass-pill');
    assert.equal(b.meta.themeKey, 'liquid'); assert.equal(b.meta.templateCategory, 'glass');
    assert.ok(b.descriptionDev.includes('glass-pill'));
    assert.equal(b.nodes.find(n => n.name === 'label').text, 'Button', 'short label that fits the box');
    const surf = b.nodes.find(n => n.role === 'button'), want = designButtonTemplateNodes(DEFAULT_BUTTON_TEMPLATES[0])[0];
    for (const k of ['width', 'height', 'rx', 'stroke-width']) assert.equal(String(surf.attrs[k]), String(want.attrs[k]), `surface ${k}`);
    assert.ok(b.nodes.some(n => n.role === 'shine'));
    const order = c.button.list({ projectId: 1 }).map(x => x.key);
    const lastFrame = Math.max(...order.map((k, i) => (k.startsWith('button-frame-') ? i : -1)));
    const firstOther = order.findIndex(k => !k.startsWith('button-frame-') && !TPL_KEYS.includes(k));
    assert.ok(order.slice(lastFrame + 1, lastFrame + 1 + TPL_KEYS.length).every(k => TPL_KEYS.includes(k)), 'templates follow the frames');
    assert.ok(firstOther > lastFrame + TPL_KEYS.length);
    assert.deepEqual(c.importer.ensureDesignButtonTemplates(), [], 'idempotent');
    assert.equal(tplRows(c).length, TPL_KEYS.length);
  } finally { c.close(); }
});

test('design button templates: an existing database gets them once, existing keys are not duplicated', { skip: !existsSync(legacyRoot) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ud-tpl-'));
  const dbFile = join(dir, 'tpl.db');
  try {
    let c = buildContainer({ dbFile });
    c.importer.run({ legacyRoot });
    // an "older" database: no templates, no ledger row, a user's own button already uses one template key,
    // the square frame one slot below circle (as in production)
    for (const r of tplRows(c)) c.button.remove(r.id, { permanent: true });
    c.db.prepare('DELETE FROM mcp_migrations WHERE id = ?').run(LEDGER);
    const mine = c.button.create({ key: 'retro-dark-btn', name: 'My retro', width: 64, height: 64, projectId: 1, visibility: 'public', creatorId: 1 }, { nodes: [] });
    const circlePos = c.button.get('button-frame-circle').position;
    c.button.update(c.button.get('button-frame-square').id, { position: circlePos + 1 });
    c.close();

    c = buildContainer({ dbFile });
    const rows = tplRows(c);
    assert.deepEqual(rows.map(r => r.key).sort(), [...TPL_KEYS].sort(), 'all keys present once');
    const kept = c.button.get(mine.id);
    assert.equal(kept.name, 'My retro'); assert.equal(kept.builtin, false);
    assert.equal(c.button.get('button-frame-square').position, circlePos, 'square frame joins the other frames');
    const pub = c.publicUserId();
    for (const r of rows) if (r.key !== 'retro-dark-btn') { assert.equal(r.creator_id, pub); assert.equal(r.builtin, 1); assert.equal(r.position, circlePos + 1); }
    assert.ok(c.db.prepare('SELECT 1 FROM mcp_migrations WHERE id = ?').get(LEDGER));
    // the ledger keeps a deleted template deleted
    c.button.remove(c.button.get('glass-pill').id, { permanent: true });
    c.close();
    c = buildContainer({ dbFile });
    assert.equal(tplRows(c).length, TPL_KEYS.length - 1);
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('design button templates: Apply All leaves them on their own design style', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const rows = tplRows(c);
    const before = new Map(rows.map(r => { const b = c.button.get(r.id); return [r.key, { shape: shapeOf(b), meta: b.meta }]; }));
    const res = c.projects.applyButtonSettings(1, { buttonStyle: 'sharp', buttonIconSizePct: 80, scope: 'all' });
    assert.ok(res.updatedCount > 0);
    for (const r of rows) {
      const b = c.button.get(r.id);
      assert.deepEqual(shapeOf(b), before.get(r.key).shape, `${r.key} keeps its nodes`);
      assert.deepEqual(b.meta, before.get(r.key).meta, `${r.key} keeps its meta`);
    }
  } finally { c.close(); }
});

test('design button templates: the public export keeps them (public-user library items)', { skip: !existsSync(legacyRoot) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ud-tpl-export-'));
  try {
    const prod = join(dir, 'designer.prod.db');
    const out = join(dir, 'designer.db');
    let c = buildContainer({ dbFile: prod, syncEnabled: false });
    c.importer.run({ legacyRoot });
    const pub = c.publicUserId();
    c.close();
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, '..', 'scripts', 'export-public-db.js')], {
      env: { ...process.env, PROD_DB_FILE: prod, DB_FILE: out, SQL_DIR: join(dir, 'sql'), PG_SYNC_ENABLED: 'false' }, stdio: 'pipe'
    });
    const db = new DatabaseSync(out, { readOnly: true });
    try {
      const rows = db.prepare(`SELECT key, creator_id, visibility, builtin FROM buttons WHERE project_id = 1 AND key IN (${TPL_KEYS.map(() => '?').join(',')})`).all(...TPL_KEYS);
      assert.equal(rows.length, TPL_KEYS.length);
      for (const r of rows) { assert.equal(r.creator_id, pub); assert.equal(r.visibility, 'public'); assert.equal(r.builtin, 1); }
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
