// Hub menu samples stay in sync (vertical = horizontal turned upright), hub glyphs follow the button's icon size,
// and the "back" button sits clear of the centre at the lower right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_MENUS } from '../infrastructure/import/sample-menus.js';
import { renderMenu, buildMenuTree, hubGeometry, hubBackSpot, menuExtent, HUB_FAN } from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';

const HUB = SAMPLE_MENUS.find(m => m.key === 'hub-menu-horizontal');
const HUB_V = SAMPLE_MENUS.find(m => m.key === 'hub-menu-vertical');

test('hub samples: the vertical bar has exactly the horizontal bar\'s items and settings (only direction and fan differ)', () => {
  assert.deepEqual(HUB_V.items, HUB.items, 'same item tree');
  assert.equal(HUB_V.icon, HUB.icon);
  const { direction: dh, startAngle: ah, sweep: sh, ...restH } = HUB.config;
  const { direction: dv, startAngle: av, sweep: sv, ...restV } = HUB_V.config;
  assert.deepEqual(restV, restH, 'every other setting matches');
  assert.equal(dh, 'horizontal'); assert.equal(dv, 'vertical');
  assert.deepEqual({ startAngle: ah, sweep: sh }, HUB_FAN.horizontal);
  assert.deepEqual({ startAngle: av, sweep: sv }, HUB_FAN.vertical);
});

const rows = items => { let id = 1; const out = []; const walk = (list, parentId) => list.forEach((it, i) => { const row = { id: id++, parentId, ord: i, name: it.name, label: it.label, iconId: 7, visible: true }; out.push(row); if (it.children) walk(it.children, row.id); }); walk(items, null); return out; };
const iconSizes = svg => [...svg.matchAll(/<use href="#i-ic"[^>]*? width="([\d.]+)"/g)].map(m => Number(m[1]));
const render = (iconFrac, cfg = HUB.config) => renderMenu({ button: { key: 'k', width: 64, height: 64 }, cfg: { ...cfg }, tree: buildMenuTree(rows(HUB.items)), ctx: createContext({ theme: BUILTIN_THEMES[0] }), iconKey: () => 'ic', iconFrac });

test('hub glyphs follow the button icon: full-box icon = the usual 62%, bigger icon scales up to the centre circle, never beyond', () => {
  const big = hubGeometry(HUB.config, 64).big;
  const ringGlyph = svg => Math.max(...iconSizes(svg.split('class="rm-level" data-level="logo"')[0]));
  assert.ok(Math.abs(ringGlyph(render(null)) - big * 0.62) < 0.02, 'no icon info: unchanged default');
  assert.ok(Math.abs(ringGlyph(render(1)) - big * 0.62) < 0.02, 'icon as big as the button: unchanged');
  assert.ok(Math.abs(ringGlyph(render(0.95)) - big * 0.62 * 0.95) < 0.02, '95% icon slider: 5% smaller');
  assert.ok(Math.abs(ringGlyph(render(104 / 64)) - big) < 0.02, 'icon scaled to 104/64: fills the centre circle');
  assert.ok(Math.abs(ringGlyph(render(3)) - big) < 0.02, 'clamped to the centre circle');
});

test('hub back button: lower right, clear of the centre button, mirrored for the vertical bar, inside the export extent', () => {
  for (const def of [HUB, HUB_V]) {
    const g = hubGeometry(def.config, 64), cx = 32, cy = 32;
    const { bx, by, r } = hubBackSpot(g, cx, cy);
    assert.ok(bx > cx && by > cy, 'lower right of the centre');
    assert.ok(Math.hypot(bx - cx, by - cy) > g.big / 2 + r, 'does not overlap the centre button');
    const ext = menuExtent({ width: 64, height: 64 }, def.config, buildMenuTree(rows(def.items)));
    assert.ok(ext.x + ext.w >= bx + r && ext.y + ext.h >= by + r, 'export box contains it');
  }
  const h = hubBackSpot(hubGeometry(HUB.config, 64), 0, 0), v = hubBackSpot(hubGeometry(HUB_V.config, 64), 0, 0);
  assert.ok(Math.abs(h.bx - v.by) < 1e-9 && Math.abs(h.by - v.bx) < 1e-9, 'vertical placement mirrors the horizontal one');
});
