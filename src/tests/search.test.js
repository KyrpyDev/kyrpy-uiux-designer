import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { searchTerms, matchesSearch, itemSearchFields, sqlSearch } from '../domain/search.js';
import { appJs } from '../application/export/templates.js';

test('a query is split into words at spaces, dashes and underscores, case and accents folded', () => {
  assert.deepEqual(searchTerms('  Home-Screen  untrap_menu '), ['home', 'screen', 'untrap', 'menu']);
  assert.deepEqual(searchTerms('Şablon İçerik ılık'), ['sablon', 'icerik', 'ilik']);
  assert.deepEqual(searchTerms(''), []);
});

test('every word must appear in the label, variable name parts, tags or description-dev, in any order', () => {
  const it = { label: 'Family members', key: 'untrap-screen-family-member-profiles', tags: ['people'], descriptionDev: 'Lists the parents and children' };
  const f = itemSearchFields(it);
  for (const q of ['family members', 'members family', 'member profiles', 'untrap profiles', 'family-member', 'people children', 'FAMILY Parents', '']) assert.ok(matchesSearch(q, ...f), q);
  for (const q of ['family settings', 'home screen']) assert.ok(!matchesSearch(q, ...f), q);
});

test('sqlSearch makes one LIKE per word over all columns', () => {
  const m = sqlSearch('home screen', ['key', 'label']);
  assert.equal(m.args.length, 2);
  assert.match(m.sql, /ufold\(COALESCE\(key, ''\) \|\| ' ' \|\| COALESCE\(label, ''\)\) LIKE \? .* AND /);
  assert.deepEqual(sqlSearch(' ', ['key']), { sql: '', args: [] });
});

test('the library list finds items by several words across label, dashed key and description-dev', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  c.screen.create({ name: 'Untrap Home Screen', key: 'untrap-screen-home-main', label: 'Ana Sayfa', descriptionDev: 'Lists the scanned documents' });
  c.screen.create({ name: 'Settings', key: 'untrap-screen-settings' });
  const names = q => c.screen.list({ q }).map(s => s.name);
  assert.ok(names('home screen').includes('Untrap Home Screen'));
  assert.ok(names('screen home').includes('Untrap Home Screen'));
  assert.ok(names('untrap main').includes('Untrap Home Screen'));
  assert.ok(names('ana sayfa').includes('Untrap Home Screen'));
  assert.ok(names('scanned documents').includes('Untrap Home Screen'));
  assert.ok(!names('home settings').includes('Untrap Home Screen'));
  assert.ok(names('untrap settings').includes('Settings'));
});

test('the exported index page filters cards by every word', () => {
  assert.doesNotThrow(() => new Function(appJs()));
  assert.match(appJs(), /split\(\/\[\\s\\-_\.,\\\/\]\+\/\)/);
});
