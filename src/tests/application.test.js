import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacy = existsSync(resolve(here, '..', '..', 'v1'))
  ? resolve(here, '..', '..', 'v1')
  : resolve(here, '..', '..', '.archive', 'v1');
const fresh = () => buildContainer({ dbFile: ':memory:' });

test('built-in themes are seeded on an empty database', () => {
  const c = fresh();
  assert.deepEqual(c.themes.list().map(t => t.key), ['liquid', 'glow', 'neu-light', 'neu-dark']);
  c.close();
});

test('icon CRUD: create, update, clone, delete, key uniqueness', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Dot' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } }] });
  assert.equal(ic.key, 'dot'); assert.equal(ic.nodes.length, 1);
  assert.throws(() => c.icon.create({ name: 'Dot', key: 'dot' }), ConflictError);
  const up = c.icon.update(ic.id, { label: 'A dot', descriptionDev: 'use for bullets' });
  assert.equal(up.descriptionDev, 'use for bullets');
  const cl = c.icon.clone(ic.id, { name: 'Dot two' });
  assert.notEqual(cl.id, ic.id); assert.equal(cl.nodes.length, 1);
  c.icon.remove(ic.id);
  assert.throws(() => c.icon.get(ic.id), NotFoundError);
  assert.equal(c.icon.list().length, 1);
  c.close();
});

test('nodes: add, patch, duplicate, delete, replace (undo) and animations', () => {
  const c = fresh();
  const s = c.screen.create({ name: 'Home' });
  const r = c.screen.addNode(s.id, { tag: 'rect', name: 'box', attrs: { x: 1, y: 2, width: 3, height: 4 } });
  assert.equal(c.screen.updateNode(r.id, { attrs: { x: 9 } }).attrs.x, 9);
  const anim = c.screen.addAnimation(r.id, { type: 'pulse', durationMs: 900 });
  assert.equal(c.screen.get(s.id).animations.length, 1);
  assert.throws(() => c.screen.addAnimation(r.id, { type: 'explode' }), ValidationError);
  const dup = c.screen.duplicateNode(r.id);
  assert.equal(c.screen.get(s.id).nodes.length, 2);
  assert.equal(c.screen.get(s.id).animations.length, 2, 'animations are duplicated with the element');
  const snapshot = c.screen.get(s.id);
  c.screen.removeNode(dup.id);
  c.screen.removeAnimation(anim.id);
  // undo = replace with the snapshot (ids are restored, animations too)
  const withAnims = snapshot.nodes.map(e => ({ ...e, animations: snapshot.animations.filter(a => a.nodeId === e.id).map(({ id, nodeId, ...a }) => a) }));
  const restored = c.screen.replaceNodes(s.id, withAnims);
  assert.equal(restored.nodes.length, 2); assert.equal(restored.animations.length, 2);
  assert.ok(restored.nodes.some(e => e.id === dup.id));
  c.close();
});

test('instances render through the library and deleting an icon removes its instances', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Plus' }, { nodes: [{ tag: 'path', attrs: { d: 'M12 5v14M5 12h14' } }] });
  const s = c.screen.create({ name: 'Scr' }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: ic.id, attrs: { x: 10, y: 10, width: 48, height: 48 } }] });
  const svg = c.render.screenSvg(s.id, 'neu-dark');
  assert.match(svg, /<symbol id="i-plus"/); assert.match(svg, /href="#i-plus"/);
  assert.equal(c.icon.get(ic.id).usage, 1);
  c.icon.remove(ic.id);
  assert.equal(c.screen.get(s.id).nodes.length, 0);
  c.close();
});

test('SVG import turns shapes into editable nodes and scales to the icon grid', () => {
  const c = fresh();
  const rec = c.svgImport.import({ svg: '<svg viewBox="0 0 48 48"><path d="M0 0L48 48" onclick="x()"/><circle cx="24" cy="24" r="10"/></svg>', name: 'Cross dot', as: 'icon' });
  assert.equal(rec.nodes.length, 3); // wrapper group + 2 shapes
  assert.match(rec.nodes[0].attrs.transform, /scale\(0\.5/);
  assert.throws(() => c.svgImport.import({ svg: '<svg></svg>' }), ValidationError);
  assert.ok(!c.render.glyphSvg('icon', rec.id, 'liquid').includes('onclick'));
  c.close();
});

test('workflows: screens, links from nodes, cascade', () => {
  const c = fresh();
  const a = c.screen.create({ name: 'A' }, { nodes: [{ tag: 'text', kind: 'text', text: 'Go', attrs: { x: 1, y: 1 } }] });
  const b = c.screen.create({ name: 'B' });
  const wf = c.workflows.create({ name: 'Flow', descriptionDev: 'dev text' });
  const el = c.screen.get(a.id).nodes[0];
  const l = c.workflows.addLink(wf.id, { fromScreenId: a.id, toScreenId: b.id, fromNodeId: el.id, name: 'Open B', style: 'cornered' });
  const full = c.workflows.get(wf.id);
  assert.equal(full.nodes.length, 2); assert.equal(full.links[0].name, 'Open B');
  assert.throws(() => c.workflows.addLink(wf.id, { fromScreenId: b.id, toScreenId: a.id, fromNodeId: el.id }), ValidationError);
  c.screen.remove(b.id);
  assert.equal(c.workflows.get(wf.id).links.length, 0, 'links disappear with their screen');
  c.close(); void l;
});

test('theme service protects built-ins and supports clones', () => {
  const c = fresh();
  assert.throws(() => c.themes.remove('liquid'), ConflictError);
  const t = c.themes.clone('liquid', 'My brand');
  assert.equal(c.themes.update(t.id, { tokens: { accent: '#ff0066' } }).tokens.accent, '#ff0066');
  c.themes.remove(t.id);
  c.close();
});

test('legacy import builds paths -> icons -> buttons -> elements -> screens and workflows (idempotent)', { skip: !existsSync(legacy) }, () => {
  const c = fresh();
  const s1 = c.importer.run({ legacyRoot: legacy });
  assert.equal(s1.icons, 206); assert.equal(s1.paths, 206); assert.ok(s1.sharedPaths >= 3); assert.ok(s1.buttons >= 206); assert.ok(s1.menuItems >= 20); assert.equal(s1.elements, 33); assert.ok(s1.presets >= 50); assert.equal(s1.screens, 23); assert.ok(s1.workflows >= 3);
  const s2 = c.importer.run({ legacyRoot: legacy });
  assert.equal(s2.icons + s2.paths + s2.buttons + s2.elements + s2.presets + s2.screens, 0, 'second run adds nothing');
  for (const d of [...c.path.list(), ...c.icon.list(), ...c.button.list(), ...c.element.list(), ...c.screen.list()]) assert.ok(d.descriptionDev.length > 10, `${d.key} has description-dev`);
  for (const w of c.workflows.list()) assert.ok(c.workflows.get(w.id).descriptionDev);
  // every theme renders every screen without dangling references
  for (const sc of c.screen.list()) for (const th of c.themes.list()) {
    const svg = c.render.screenSvg(sc.id, th.key);
    const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]), ids = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
    for (const r of refs) assert.ok(ids.has(r), `${sc.key}/${th.key}: missing #${r}`);
  }
  c.close();
});

test('export bundle writes a working html/css/ts/js/svg project', { skip: !existsSync(legacy) }, () => {
  const c = fresh();
  c.importer.run({ legacyRoot: legacy });
  const dir = mkdtempSync(join(tmpdir(), 'ud-export-'));
  try {
    const screens = c.screen.list().slice(0, 3).map(s => s.id);
    const r = c.exporter.exportToFolder({ screenIds: screens, themeKeys: ['liquid', 'neu-dark'], title: 'T' }, dir);
    assert.equal(r.screens, 3);
    for (const f of ['index.html', 'css/themes.css', 'css/app.css', 'js/app.js', 'js/screens.js', 'ts/app.ts', 'ts/screens.ts', 'ts/types.ts', 'data/manifest.json', 'DEV-NOTES.md', 'svg/sprite.svg']) assert.ok(existsSync(join(dir, f)), f);
    const manifest = JSON.parse(readFileSync(join(dir, 'data/manifest.json'), 'utf8'));
    assert.equal(manifest.themes.length, 2); assert.ok(manifest.screens.every(s => s.descriptionDev));
    const page = readFileSync(join(dir, manifest.screens[0].file), 'utf8');
    assert.match(page, /data-theme="liquid"/); assert.match(page, /data-theme="neu-dark"/);
    assert.throws(() => c.exporter.exportToFolder({ screenIds: [] }, dir), ValidationError);
    assert.throws(() => c.exporter.exportToFolder({ screenIds: 'all' }, 'relative/path'), ValidationError);
  } finally { rmSync(dir, { recursive: true, force: true }); c.close(); }
});

test('svg download carries animation css', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Spin' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 5 }, animations: [{ type: 'rotate', durationMs: 800, params: { from: 0, to: 360 } }] }] });
  const f = c.exporter.svgFile('icon', ic.id, { theme: 'glow' });
  assert.match(f.content, /@keyframes ud-k/); assert.equal(f.filename, 'spin-glow.svg');
  assert.ok(!c.exporter.svgFile('icon', ic.id, { theme: 'glow', animated: false }).content.includes('@keyframes'));
  c.close();
});

test('HTTP API: CRUD, errors, svg download, static domain files', async () => {
  const c = fresh();
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null), res: r }; };
  try {
    const made = await j('POST', '/api/icons', { name: 'Api icon', nodes: [{ tag: 'circle', attrs: { cx: 1, cy: 1, r: 1 } }] });
    assert.equal(made.status, 200);
    assert.equal((await j('POST', '/api/icons', { name: 'Api icon', key: 'api-icon' })).status, 409);
    assert.equal((await j('POST', '/api/icons', { name: '' })).status, 422);
    assert.equal((await j('GET', '/api/icons/nope')).status, 404);
    assert.equal((await j('PUT', `/api/icons/${made.body.id}`, { descriptionDev: 'x' })).body.descriptionDev, 'x');
    const svg = await fetch(`${base}/api/icons/${made.body.id}/svg?download=1`);
    assert.match(svg.headers.get('content-disposition'), /api-icon\.svg/);
    assert.equal((await fetch(`${base}/domain/svg.js`)).status, 200);
    assert.equal((await fetch(`${base}/domain/../main.js`)).status, 404);
    assert.equal((await j('GET', '/api/library')).body.icons.length, 1);
  } finally { server.close(); c.close(); }
});
