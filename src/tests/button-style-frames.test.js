import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { BUTTON_STYLES, buttonStyleFrameKey, buttonStyleFrameNodes, buttonStyleFrameSize, isButtonStyleFrame, isDesignButtonTemplate } from '../domain/entities.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', 'v1')) ? resolve(here, '..', '..', 'v1') : resolve(here, '..', '..', '.archive', 'v1');
const FRAME_KEYS = BUTTON_STYLES.map(s => buttonStyleFrameKey(s.key));
const LEDGER = 'preset-002-button-style-frames';

const frameRows = c => c.db.prepare(`SELECT id, key, name, category, width, height, position, project_id, visibility, creator_id, root_owner_id, builtin, uid
  FROM buttons WHERE project_id = 1 AND key LIKE 'button-frame-%' ORDER BY id`).all();
const surface = (c, id) => c.button.get(id).nodes.find(n => n.role === 'button');

test('button style frames: node shapes follow BUTTON_STYLES', () => {
  for (const s of BUTTON_STYLES) {
    const size = buttonStyleFrameSize(s.key);
    const nodes = buttonStyleFrameNodes(s.key, size);
    const surf = nodes.find(n => n.role === 'button');
    assert.equal(surf.tag, 'rect');
    assert.equal(surf.attrs.rx, Math.round(Math.min(size.width, size.height) * s.rxRatio * 100) / 100, `${s.key} rx`);
    assert.equal(nodes.some(n => n.refType === 'icon'), false, 'frame only, no icon slot filled');
  }
  const outline = buttonStyleFrameNodes('outline');
  assert.equal(outline[0].attrs.fill, 'none');
  assert.equal(outline[0].attrs.stroke, '{{accent}}');
  assert.equal(outline[0].attrs['stroke-width'], '{{sw*1.4}}');
  assert.equal(outline.some(n => n.role === 'shine'), false);
  assert.equal(buttonStyleFrameNodes('ghost')[0].attrs.opacity, '0.85');
  assert.deepEqual(buttonStyleFrameSize('pill'), { width: 112, height: 48 }, 'pill is wide so it differs from circle');
  assert.deepEqual(buttonStyleFrameSize('circle'), { width: 64, height: 64 });
  assert.equal(isButtonStyleFrame({ key: 'button-frame-pill', builtin: true }), true);
  assert.equal(isButtonStyleFrame({ key: 'button-frame-pill', builtin: false }), false);
  assert.equal(isButtonStyleFrame({ key: 'home-button', builtin: true }), false);
});

test('button style frames: a fresh database gets one public frame per style', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const pub = c.publicUserId();
    const rows = frameRows(c);
    assert.deepEqual(rows.map(r => r.key).sort(), [...FRAME_KEYS].sort());
    for (const r of rows) {
      const size = buttonStyleFrameSize(r.key.replace('button-frame-', ''));
      assert.equal(r.category, 'frames'); assert.equal(r.width, size.width); assert.equal(r.height, size.height);
      assert.equal(r.visibility, 'public'); assert.equal(r.builtin, 1);
      assert.equal(r.creator_id, pub); assert.equal(r.root_owner_id, pub);
      assert.ok(r.uid, 'uid assigned');
    }
    assert.equal(rows.find(r => r.key === 'button-frame-pill').name, 'Button frame pill');
    assert.deepEqual(c.importer.ensureButtonStyleFrames(), [], 'idempotent');
    assert.equal(frameRows(c).length, BUTTON_STYLES.length);
  } finally { c.close(); }
});

test('button style frames: an existing database gets the missing frames once, circle/square untouched', { skip: !existsSync(legacyRoot) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ud-frames-'));
  const dbFile = join(dir, 'frames.db');
  try {
    let c = buildContainer({ dbFile });
    c.importer.run({ legacyRoot });
    // an "older" database: only circle + square, the square edited by someone, no ledger row
    for (const r of frameRows(c)) if (!['button-frame-circle', 'button-frame-square'].includes(r.key)) c.button.remove(r.id, { permanent: true });
    c.db.prepare('DELETE FROM mcp_migrations WHERE id = ?').run(LEDGER);
    const sq = c.button.get('button-frame-square');
    c.button.update(sq.id, { name: 'My square', nodes: sq.nodes.map(n => n.role === 'button' ? { ...n, attrs: { ...n.attrs, rx: 7 } } : n) });
    const before = { circle: c.button.get('button-frame-circle'), square: c.button.get('button-frame-square') };
    assert.equal(frameRows(c).length, 2);
    c.close();

    c = buildContainer({ dbFile });
    const rows = frameRows(c);
    assert.deepEqual(rows.map(r => r.key).sort(), [...FRAME_KEYS].sort(), 'all styles present, no duplicates');
    const pub = c.publicUserId();
    for (const r of rows) { assert.equal(r.creator_id, pub); assert.equal(r.visibility, 'public'); }
    for (const k of ['circle', 'square']) {
      const now = c.button.get(`button-frame-${k}`);
      assert.equal(now.id, before[k].id);
      assert.equal(now.name, before[k].name);
      assert.deepEqual(now.nodes.map(n => n.attrs), before[k].nodes.map(n => n.attrs), `${k} nodes untouched`);
    }
    const circlePos = rows.find(r => r.key === 'button-frame-circle').position;
    for (const r of rows) if (!['button-frame-circle', 'button-frame-square'].includes(r.key)) assert.equal(r.position, circlePos, `${r.key} sorts next to the other frames`);
    assert.ok(c.db.prepare('SELECT 1 FROM mcp_migrations WHERE id = ?').get(LEDGER));
    // the ledger keeps a deleted template deleted
    c.button.remove(c.button.get('button-frame-ghost').id, { permanent: true });
    c.close();
    c = buildContainer({ dbFile });
    assert.equal(frameRows(c).length, BUTTON_STYLES.length - 1);
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('button style frames: Apply All keeps every frame template on its own style', { skip: !existsSync(legacyRoot) }, () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const rows = frameRows(c);
    const shapes = new Map(rows.map(r => [r.key, c.button.get(r.id).nodes.map(n => ({ tag: n.tag, attrs: n.attrs }))]));
    const other = c.button.list().find(b => b.projectId === 1 && !isButtonStyleFrame(b) && !isDesignButtonTemplate(b) && b.width === 64);
    const res = c.projects.applyButtonSettings(1, { buttonStyle: 'sharp', buttonIconSizePct: 80, scope: 'all' });
    assert.ok(res.updatedCount > 0);
    for (const r of rows) {
      const b = c.button.get(r.id);
      assert.deepEqual(b.nodes.map(n => ({ tag: n.tag, attrs: n.attrs })), shapes.get(r.key), `${r.key} keeps its shape`);
      assert.equal(b.meta.buttonStyle, r.key.replace('button-frame-', ''));
    }
    assert.equal(surface(c, other.id).attrs.rx, Math.round(64 * 0.03 * 100) / 100, 'other buttons are re-styled');
  } finally { c.close(); }
});

test('button style frames: a built-in frame left re-styled by Apply All is repaired; user copies are not', { skip: !existsSync(legacyRoot) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ud-frames-fix-'));
  const dbFile = join(dir, 'frames.db');
  try {
    let c = buildContainer({ dbFile });
    c.importer.run({ legacyRoot });
    for (const r of frameRows(c)) if (!['button-frame-circle', 'button-frame-square'].includes(r.key)) c.button.remove(r.id, { permanent: true });
    c.db.prepare('DELETE FROM mcp_migrations WHERE id = ?').run(LEDGER);
    // the square frame turned into a circle by an earlier "Apply All" (as in an existing production database)
    const sq = c.button.get('button-frame-square');
    c.button.update(sq.id, { meta: { ...sq.meta, shape: 'circle', buttonStyle: 'circle' } });
    c.button.replaceNodes(sq.id, buttonStyleFrameNodes('circle').map(({ id, ...n }) => n));
    // a non-builtin user copy of a frame with a mismatched style stays as it is
    const copy = c.button.create({ key: 'my-frame', name: 'My frame', width: 64, height: 64, builtin: false,
      meta: { shape: 'circle', buttonStyle: 'circle' } }, { nodes: buttonStyleFrameNodes('circle') });
    assert.equal(surface(c, sq.id).attrs.rx, 32);
    c.close();

    c = buildContainer({ dbFile });
    const fixed = c.button.get('button-frame-square');
    assert.equal(fixed.id, sq.id);
    assert.equal(fixed.meta.buttonStyle, 'square');
    assert.equal(fixed.meta.shape, 'square');
    assert.equal(surface(c, fixed.id).attrs.rx, Math.round(64 * 0.1 * 100) / 100);
    assert.deepEqual(fixed.nodes.map(n => ({ tag: n.tag, attrs: n.attrs })), buttonStyleFrameNodes('square').map(n => ({ tag: n.tag, attrs: n.attrs })));
    assert.equal(c.button.get(copy.id).meta.buttonStyle, 'circle', 'user copy untouched');
    assert.equal(frameRows(c).length, BUTTON_STYLES.length);
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
