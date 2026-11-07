/**
 * Large icon libraries (thousands of pack icons): the library list ships icon summaries without nodes,
 * a paged icon search, sprites / full records of just the requested icons, an icon version that lets
 * clients skip re-downloading the list, and ETag revalidation of sprite batches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { buildContainer } from '../composition-root.js';
import { createHttpServer } from '../interfaces/http/server.js';
import { compactIconSummary, expandIconSummary, iconSummary, iconPack } from '../domain/icon-summary.js';

const here = dirname(fileURLToPath(import.meta.url));
const CIRCLE = [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8 } }];

async function setup() {
  const c = buildContainer({ dbFile: ':memory:' });
  const mk = (name, extra = {}) => c.icon.create({ name, ...extra }, { nodes: CIRCLE });
  const own = [mk('Home'), mk('Star'), mk('Gear')];
  const packs = [];
  for (let i = 0; i < 25; i++) packs.push(mk(`Arrow ${i}`, { key: `lucide-arrow-${i}`, category: 'pack-lucide', tags: ['lucide', 'arrow', i % 2 ? 'odd' : 'even'], meta: { pack: 'lucide' } }));
  for (let i = 0; i < 5; i++) packs.push(mk(`Box ${i}`, { key: `tabler-box-${i}`, category: 'pack-tabler', tags: ['tabler', 'box'], meta: { pack: 'tabler' } }));
  // a button that draws one pack icon: the library list must ship that icon's geometry
  const btn = c.button.create({ name: 'Uses pack icon' }, { nodes: [{ kind: 'instance', tag: 'use', refType: 'icon', refId: packs[3].id, attrs: { x: 0, y: 0, width: 24, height: 24 } }] });
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async u => { const r = await fetch(base + u); return { status: r.status, body: await r.json().catch(() => null), res: r }; };
  const close = () => { server.close(); c.close(); };
  return { c, own, packs, btn, base, j, close };
}

test('icon summary helpers: pack detection and compact round trip', () => {
  const d = { id: 7, key: 'lucide-x', name: 'X', label: 'X', category: 'pack-lucide', tags: ['lucide', 'close'], width: 24, height: 24, visibility: 'public', creatorId: 3, rootOwnerId: 3, projectId: 1, builtin: true, locked: false, meta: { pack: 'lucide', license: 'ISC' } };
  assert.equal(iconPack(d), 'lucide');
  assert.equal(iconPack({ category: 'pack-tabler', meta: {} }), 'tabler');
  assert.equal(iconPack({ category: 'actions', meta: {} }), '');
  const s = iconSummary(d);
  assert.deepEqual(s.meta, { pack: 'lucide' });
  assert.equal('nodes' in s, false);
  const back = expandIconSummary(compactIconSummary(s));
  assert.deepEqual({ ...back, tags: [...back.tags].sort() }, { ...s, tags: [...s.tags].sort() });
  const odd = { ...s, name: 'Other', width: 32, visibility: 'project', projectId: 4, rootOwnerId: 1, locked: true, builtin: false };
  const back2 = expandIconSummary(compactIconSummary(odd));
  assert.deepEqual({ ...back2, tags: [...back2.tags].sort() }, { ...odd, tags: [...odd.tags].sort() });
});

test('GET /api/library?iconSummary=1 lists icons without nodes (except the ones library items draw)', async () => {
  const { packs, j, close } = await setup();
  try {
    const legacy = await j('/api/library');
    assert.equal(legacy.body.icons.length, 33);
    assert.ok(legacy.body.icons.every(i => Array.isArray(i.nodes)), 'legacy shape keeps full icons');

    const lib = await j('/api/library?iconSummary=1');
    assert.equal(lib.status, 200);
    assert.equal(lib.body.iconSummary, true);
    assert.ok(lib.body.iconsVersion);
    const icons = lib.body.icons.map(expandIconSummary);
    assert.equal(icons.length, 33);
    const withNodes = icons.filter(i => i.nodes);
    assert.deepEqual(withNodes.map(i => i.id), [packs[3].id], 'only the icon drawn by the button carries geometry');
    const arrow = icons.find(i => i.key === 'lucide-arrow-0');
    assert.equal(arrow.meta.pack, 'lucide');
    assert.ok(arrow.tags.includes('arrow'));
    assert.equal(arrow.width, 24);
    // other types are unchanged
    assert.ok(lib.body.buttons[0].nodes.length);

    // same version: the icon list is not re-sent
    const again = await j(`/api/library?iconSummary=1&iconsSince=${encodeURIComponent(lib.body.iconsVersion)}`);
    assert.equal(again.body.icons, null);
    assert.equal(again.body.iconsVersion, lib.body.iconsVersion);
    assert.equal(again.body.buttons.length, 1);
  } finally { close(); }
});

test('icon version moves on icon and icon-node changes only', async () => {
  const { c, own, j, close } = await setup();
  try {
    const v0 = c.iconCatalog.version();
    c.button.create({ name: 'Unrelated' }, { nodes: [] });
    assert.equal(c.iconCatalog.version(), v0, 'non-icon writes keep the version');
    c.icon.update(own[0].id, { label: 'Home sweet home' });
    const v1 = c.iconCatalog.version();
    assert.notEqual(v1, v0);
    c.icon.replaceNodes(own[1].id, [{ tag: 'rect', attrs: { x: 2, y: 2, width: 20, height: 20 } }]);
    const v2 = c.iconCatalog.version();
    assert.notEqual(v2, v1);
    const r = await j(`/api/library?iconSummary=1&iconsSince=${encodeURIComponent(v1)}`);
    assert.ok(Array.isArray(r.body.icons), 'a stale client version gets the list again');
    assert.equal(r.body.iconsVersion.split('~')[0], v2);
  } finally { close(); }
});

test('GET /api/icons/search pages and filters by text, pack and category', async () => {
  const { j, close } = await setup();
  try {
    const all = await j('/api/icons/search?limit=10');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 33);
    assert.equal(all.body.items.length, 10);
    assert.equal('nodes' in all.body.items[0], false);
    const page2 = await j('/api/icons/search?limit=10&offset=30');
    assert.equal(page2.body.items.length, 3);
    assert.equal(page2.body.offset, 30);

    const lucide = await j('/api/icons/search?pack=lucide&limit=100');
    assert.equal(lucide.body.total, 25);
    assert.ok(lucide.body.items.every(i => i.meta.pack === 'lucide'));
    const builtin = await j('/api/icons/search?pack=builtin');
    assert.deepEqual(builtin.body.items.map(i => i.name).sort(), ['Gear', 'Home', 'Star']);
    const odd = await j('/api/icons/search?q=arrow%20odd&limit=100');
    assert.equal(odd.body.total, 12, 'every term must match (key, name, label or tags)');
    const cat = await j('/api/icons/search?category=pack-tabler');
    assert.equal(cat.body.total, 5);
    const none = await j('/api/icons/search?q=zzz-nothing');
    assert.equal(none.body.total, 0);
  } finally { close(); }
});

test('icon sprite and full records by id; sprite ETag answers 304', async () => {
  const { packs, own, base, j, close } = await setup();
  try {
    const ids = [packs[0].id, packs[1].id, own[0].id];
    const r = await fetch(`${base}/api/icons/sprite?ids=${ids.join(',')}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
    const etag = r.headers.get('etag');
    assert.ok(etag);
    const svg = await r.text();
    assert.equal((svg.match(/<symbol /g) || []).length, 3);
    assert.ok(svg.includes(`id="i-${packs[0].key}"`) && svg.includes(`id="i-${own[0].key}"`));
    assert.ok(!svg.includes(`id="i-${packs[2].key}"`), 'only the requested icons');

    const again = await fetch(`${base}/api/icons/sprite?ids=${ids.join(',')}`, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);

    const post = await fetch(`${base}/api/icons/sprite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [packs[4].id, 999999] }) });
    assert.equal((( await post.text()).match(/<symbol /g) || []).length, 1, 'unknown ids are skipped');

    const full = await j(`/api/icons/full?ids=${packs[0].id},${own[2].id},424242`);
    assert.equal(full.body.items.length, 2);
    assert.ok(full.body.items.every(i => Array.isArray(i.nodes) && i.nodes.length === 1));
    // the per-id route still serves one full icon
    assert.equal((await j(`/api/icons/${packs[0].id}`)).body.nodes.length, 1);
  } finally { close(); }
});

test('large JSON responses are gzipped when the client accepts gzip', async () => {
  const c = buildContainer({ dbFile: ':memory:' });
  for (let i = 0; i < 400; i++) c.icon.create({ name: `Bulk icon ${i}`, tags: ['bulk', 'padding-tag-to-grow-the-payload'] }, { nodes: CIRCLE });
  const server = createHttpServer(c, { webRoot: join(here, '..', 'interfaces', 'web'), domainRoot: join(here, '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const { headers, body } = await new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port: server.address().port, path: '/api/library', headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    assert.equal(headers['content-encoding'], 'gzip');
    assert.equal(JSON.parse(gunzipSync(body).toString()).icons.length, 400);
  } finally { server.close(); c.close(); }
});

test('iconsSince is only honoured for the same actor and filter', async () => {
  const { j, base, close } = await setup();
  try {
    const anon = await j('/api/library?iconSummary=1');
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'icon_user', email: 'icon_user@kyrpy.com', password: 'password123' }) });
    const { token } = await reg.json();
    assert.ok(token);
    const asUser = await fetch(`${base}/api/library?iconSummary=1&iconsSince=${encodeURIComponent(anon.body.iconsVersion)}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
    assert.ok(Array.isArray(asUser.icons), 'a version issued to another actor never short-circuits the list');
    assert.notEqual(asUser.iconsVersion, anon.body.iconsVersion);
    const same = await fetch(`${base}/api/library?iconSummary=1&iconsSince=${encodeURIComponent(asUser.iconsVersion)}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
    assert.equal(same.icons, null, 'the same actor keeps its cached list');
    const filtered = await j(`/api/library?iconSummary=1&visibility=public&iconsSince=${encodeURIComponent(anon.body.iconsVersion)}`);
    assert.ok(Array.isArray(filtered.body.icons), 'a different filter gets its own list');
    assert.equal(filtered.body.iconsVersion.split('~')[0], anon.body.iconsVersion.split('~')[0], 'the catalog part is shared');
  } finally { close(); }
});

test('icon version notices icon writes made by another connection / process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'icon-ver-'));
  const file = join(dir, 'd.db');
  const c = buildContainer({ dbFile: file });
  const other = new DatabaseSync(file);
  try {
    const home = c.icon.create({ name: 'Home' }, { nodes: CIRCLE });
    c.button.create({ name: 'Local unrelated write' }, { nodes: [] });
    const v0 = c.iconCatalog.version();
    assert.equal(c.iconCatalog.version(), v0, 'stable without changes');
    other.exec("INSERT INTO buttons (key, name) VALUES ('ext-button', 'External button')");
    assert.equal(c.iconCatalog.version(), v0, 'external non-icon commits keep the version');
    other.exec("INSERT INTO icons (key, name) VALUES ('ext-icon', 'External icon')");
    const v1 = c.iconCatalog.version();
    assert.notEqual(v1, v0, 'an icon inserted by another connection moves the version');
    other.prepare("INSERT INTO nodes (owner_type, owner_id, tag) VALUES ('icon', ?, 'rect')").run(home.id);
    const v2 = c.iconCatalog.version();
    assert.notEqual(v2, v1, 'an icon node added by another connection moves the version');
    other.prepare('DELETE FROM icons WHERE key = ?').run('ext-icon');
    assert.notEqual(c.iconCatalog.version(), v2, 'an external delete moves the version');
  } finally { other.close(); c.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('client read cache keys leave out iconsSince', async () => {
  const { cacheKeyFor } = await import('../interfaces/web/js/api.js');
  const base = cacheKeyFor('/api/library?iconSummary=1');
  assert.equal(cacheKeyFor('/api/library?iconSummary=1&iconsSince=abc.1.0~x'), base);
  assert.equal(cacheKeyFor('/api/library?iconSummary=1&iconsSince=other'), base);
  assert.equal(cacheKeyFor('/api/library?iconsSince=v&projectId=2&iconSummary=1'), cacheKeyFor('/api/library?projectId=2&iconSummary=1'));
  assert.equal(cacheKeyFor('/api/library?iconsSince=v'), cacheKeyFor('/api/library'));
  assert.notEqual(cacheKeyFor('/api/library?projectId=2&iconSummary=1'), base, 'other filters still get their own entry');
});
