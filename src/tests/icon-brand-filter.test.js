/**
 * import-icon-packs: one cross-pack brand / trademark deny-list (`isBrandSlug`) is applied to every pack,
 * on top of each pack's own rule; generic words a vendor also uses stay importable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBrandSlug, PACKS } from '../scripts/import-icon-packs.js';

test('cross-pack brand deny-list catches vendor / product names in every pack', () => {
  for (const s of ['bluetooth', 'bluetooth-off', 'earphone-bluetooth', 'xbox-a', 'playstation-x', 'steam', 'steam-logo',
    'airplay', 'device-ipad-horizontal-x', 'device-imac', 'airpods-l', 'device-nintendo', 'device-vision-pro-wifi',
    'lego', 'lego-smiley', 'pokeball-off', 'pacman', 'olympics', 'jeep', 'markdown-off', 'android', 'windows', 'github']) {
    assert.equal(isBrandSlug(s), true, s);
  }
});

test('generic names that share a word with a vendor are kept', () => {
  for (const s of ['apple', 'line', 'line-dashed', 'git-branch', 'git-pull-request', 'zoom-in', 'signal', 'switch',
    'ironing-steam', 'bowl-steam', 'battery-medium', 'wifi', 'usb', 'rss', 'qr-code', 'currency-bitcoin', 'pocket-knife']) {
    assert.equal(isBrandSlug(s), false, s);
  }
});

test('per-pack rules still apply alongside the cross-pack list', () => {
  assert.equal(PACKS.tabler.exclude('brand-figma'), true);
  assert.equal(PACKS.phosphor.exclude('notion-logo'), true);
  assert.equal(PACKS.bootstrap.exclude('line'), true, 'Bootstrap `line` is the LINE messenger logo');
  assert.equal(PACKS.bootstrap.exclude('thunderbolt-fill'), true);
  assert.equal(PACKS.bootstrap.exclude('house'), false);
});
