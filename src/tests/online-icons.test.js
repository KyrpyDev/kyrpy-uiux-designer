import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { OnlineIconService, stripAnimation, MAX_IMPORT } from '../application/online-icon-service.js';

const ANIM = '<g fill="none" stroke="currentColor" stroke-width="2"><path stroke-dasharray="18" stroke-dashoffset="18" d="M4 21h15"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="18;0"/></path></g>';
const fakeFetch = async url => {
  const u = String(url);
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  if (u.includes('/collections?prefix=')) return ok({ 'line-md': { name: 'Line MD', license: { title: 'MIT', url: 'https://x' } } });
  if (u.endsWith('/collections')) return ok({ 'line-md': { name: 'Line MD', total: 2, license: { title: 'MIT' } }, zzz: { name: 'Zzz', total: 1 } });
  if (u.includes('cdn.jsdelivr.net') && u.includes('/line-md/')) return ok({ info: { name: 'Line MD', license: { title: 'MIT', url: 'https://x' } }, width: 24, height: 24, icons: { home: { body: ANIM }, account: { body: '<circle cx="12" cy="12" r="5"/>' }, gear: { body: '<circle cx="12" cy="12" r="3"/>' } } });
  if (u.includes('cdn.jsdelivr.net')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  if (u.includes('/search?')) return ok({ icons: ['line-md:home', 'tabler:home'], total: 2 });
  if (u.includes('/line-md.json')) return ok({ width: 24, height: 24, icons: { home: { body: ANIM }, account: { body: '<circle cx="12" cy="12" r="5"/>' } } });
  if (u.endsWith('.svg') || u.includes('.svg?')) return ok('<svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg>');
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};

test('stripAnimation removes SMIL and the dash attributes it drives', () => {
  const r = stripAnimation(`<svg>${ANIM}</svg>`);
  assert.equal(r.animated, true);
  assert.doesNotMatch(r.svg, /<animate|dash/);
  assert.equal(stripAnimation('<svg><path d="M0 0"/></svg>').animated, false);
});

test('online icons: collections, search, paged listing, import (idempotent, capped)', async () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const svc = new OnlineIconService({ services: c.services, fetchImpl: fakeFetch });
    const cols = await svc.collections();
    assert.equal(cols[0].prefix, 'line-md', 'featured sets first');
    assert.equal((await svc.search({ q: 'home' })).icons.length, 2);
    const page = await svc.search({ prefix: 'line-md', start: 1, limit: 2 });
    assert.equal(page.total, 3); assert.equal(page.icons.length, 2);
    await assert.rejects(() => svc.search({}), /search or pick/);
    await assert.rejects(() => svc.svg({ prefix: '../x', name: 'a' }), /invalid/);
    const r = await svc.importIcons({ prefix: 'line-md', names: ['home', 'account', 'nope'], projectId: 1 }, { actor: { id: 1, username: 'kyrpy', role: 'admin' } });
    assert.equal(r.imported, 2); assert.equal(r.failed, 1);
    const again = await svc.importIcons({ prefix: 'line-md', names: ['home'], projectId: 1 }, { actor: { id: 1, username: 'kyrpy', role: 'admin' } });
    assert.equal(again.skipped, 1);
    const icon = c.services.icon.get(r.ids[0]);
    assert.equal(icon.meta.pack, 'line-md'); assert.equal(icon.category, 'pack-line-md');
    assert.ok(icon.nodes.length > 1);
    const set = await svc.importSet({ prefix: 'line-md', projectId: 1 }, { actor: { id: 1, username: 'kyrpy', role: 'admin' } });
    assert.equal(set.total, 3);
    assert.equal(MAX_IMPORT, 10000);
  } finally { c.close(); }
});

test('inlineSymbols turns <symbol>/<use> into plain groups (Meteocons style)', async () => {
  const { inlineSymbols } = await import('../application/online-icon-service.js');
  const r = inlineSymbols('<svg viewBox="0 0 512 512"><defs><symbol id="a" viewBox="0 0 100 50"><path d="M0 0h100"/></symbol></defs><use href="#a" x="10" y="20" width="200" height="100"/></svg>');
  assert.doesNotMatch(r, /<symbol|<use/);
  assert.match(r, /translate\(10 20\) scale\(2 2\)/);
  assert.equal(inlineSymbols('<svg><use href="#nope"/></svg>'), '<svg></svg>');
});
