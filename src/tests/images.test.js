import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { normalizeNode } from '../domain/entities.js';
import { imageMarkup, safeImageHref, imageSize } from '../domain/image.js';
import { attrString } from '../domain/svg-util.js';
import { StockImageService, isPublicHttpsUrl } from '../application/stock-image-service.js';

// a 2×3 PNG and a 1×1 GIF
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR42mP8z8DAwMDAwAAAD/AB/0fN8VEAAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const png = `data:image/png;base64,${PNG}`;

test('image nodes keep only a library id or a safe data URI', () => {
  const n = normalizeNode({ tag: 'image', attrs: { x: 1, imageId: '7', href: 'javascript:alert(1)', 'xlink:href': 'https://evil', preserveAspectRatio: 'bogus', 'data-clip': 'circle' } });
  assert.deepEqual(n.attrs, { x: 1, imageId: 7, 'data-clip': 'circle' });
  assert.equal(normalizeNode({ tag: 'image', attrs: { href: png } }).attrs.href, png);
  assert.equal(safeImageHref('data:image/svg+xml;base64,PHN2Zz4='), null, 'no SVG pictures');
  assert.equal(safeImageHref('/api/images/12/file'), '/api/images/12/file');
});

test('image markup: library file URL by default, data URI from the context, circle clip, grey placeholder', () => {
  const el = { id: 3 };
  const a = { x: 0, y: 0, width: 40, height: 40, imageId: 9, 'data-clip': 'circle' };
  const m = imageMarkup(el, a, { attrString });
  assert.match(m, /<clipPath id="udimg-clip-3" clipPathUnits="objectBoundingBox"><ellipse/);
  assert.match(m, /<image[^>]*clip-path="url\(#udimg-clip-3\)"[^>]*href="\/api\/images\/9\/file"/);
  assert.match(imageMarkup(el, a, { attrString, imageHref: () => png }), /href="data:image\/png;base64,/);
  assert.match(imageMarkup(el, { x: 0, y: 0, width: 10, height: 10 }, { attrString }), /<rect[^>]*stroke-dasharray="4 3"/);
  assert.deepEqual(imageSize('image/png', Buffer.from(PNG, 'base64')), { width: 2, height: 3 });
});

test('image library: upload, dedupe, search by every word, access rules, file, delete', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const alice = c.auth.register({ username: 'alice', email: 'alice@kyrpy.com', password: 'password123' }).user;
  const bob = c.auth.register({ username: 'bob', email: 'bob@kyrpy.com', password: 'password123' }).user;
  const img = c.images.create({ data: png, name: 'Smiling Woman Portrait', tags: ['people', 'avatar'], descriptionDev: 'Team page header photo', visibility: 'private' }, { actor: alice });
  assert.equal(img.width, 2); assert.equal(img.height, 3); assert.equal(img.mime, 'image/png');
  assert.equal(c.images.create({ data: png, name: 'again' }, { actor: alice }).duplicate, true);
  assert.throws(() => c.images.create({ data: `data:image/png;base64,${GIF}` }, { actor: alice }), /not a valid PNG/);
  assert.throws(() => c.images.create({ data: 'data:image/svg+xml;base64,PHN2Zz4=' }, { actor: alice }), /data URI/);
  const find = (q, actor = alice) => c.images.list({ q }, { actor }).items.map(i => i.id);
  for (const q of ['woman portrait', 'portrait woman', 'smiling-woman', 'avatar people', 'team header']) assert.deepEqual(find(q), [img.id], q);
  assert.deepEqual(find('woman landscape'), []);
  assert.deepEqual(find('woman', bob), [], 'private images stay with their owner');
  assert.throws(() => c.images.get(img.id, { actor: bob }), /private/);
  c.images.update(img.id, { visibility: 'public' }, { actor: alice });
  assert.deepEqual(find('woman', bob), [img.id]);
  assert.throws(() => c.images.update(img.id, { name: 'x' }, { actor: bob }), /owner of a public image/);
  const f = c.images.file(img.id, { actor: bob });
  assert.equal(f.contentType, 'image/png'); assert.equal(f.raw.length, Buffer.from(PNG, 'base64').length);
  assert.equal(c.images.remove(img.id, { actor: alice }).removed, true);
});

test('svg import moves embedded pictures into the image library; renders embed them', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><image x="5" y="5" width="50" height="50" href="${png}"/><image href="https://example.com/a.jpg" width="9" height="9"/></svg>`;
  const el = c.svgImport.import({ svg, as: 'element', name: 'Profile card' });
  const out = c.render.svg('element', el.id, c.settings.get().theme, {});
  assert.match(out, /<image[^>]*href="data:image\/png;base64,/);
  assert.match(out, /stroke-dasharray="4 3"/, 'the remote picture is a placeholder');
  assert.equal(c.images.list({ q: 'profile card' }).total, 1);
});

test('stock photos: search and import through the provider record, never a caller URL', async () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url.startsWith('https://api.openverse.org/v1/images/?')) return { ok: true, status: 200, json: async () => ({ result_count: 1, results: [{ id: 'abc-1', title: 'Desk', url: 'https://img.example.org/desk.png', thumbnail: 'https://api.openverse.org/v1/images/abc-1/thumb/', creator: 'Ann', license: 'by', license_version: '4.0', foreign_landing_url: 'https://flickr.example/abc' }] }) };
    if (url === 'https://api.openverse.org/v1/images/abc-1/') return { ok: true, status: 200, json: async () => ({ id: 'abc-1', title: 'Desk', url: 'https://img.example.org/desk.png', creator: 'Ann', license: 'by', license_version: '4.0', foreign_landing_url: 'https://flickr.example/abc' }) };
    if (url === 'https://img.example.org/desk.png') return { ok: true, status: 200, url, headers: new Map([['content-type', 'image/png']]), body: [Buffer.from(PNG, 'base64')] };
    throw new Error(`unexpected ${url}`);
  };
  const stock = new StockImageService({ images: c.images, env: {}, fetchImpl });
  const r = await stock.search({ provider: 'openverse', q: 'office desk' });
  assert.equal(r.items[0].id, 'abc-1'); assert.equal(r.items[0].downloadUrl, undefined, 'download addresses stay on the server');
  await assert.rejects(stock.search({ provider: 'pexels', q: 'x' }), /PEXELS_API_KEY/);
  const imp = await stock.importImages({ items: [{ provider: 'openverse', id: 'abc-1' }] });
  assert.equal(imp.failed.length, 0);
  assert.equal(imp.imported[0].author, 'Ann'); assert.equal(imp.imported[0].license, 'CC BY 4.0'); assert.equal(imp.imported[0].source, 'openverse');
  const bad = await stock.importImages({ items: [{ provider: 'openverse', id: '../../etc' }] });
  assert.match(bad.failed[0].error, /invalid photo id/);
  assert.equal(isPublicHttpsUrl('https://10.0.0.5/x.png'), false);
});
