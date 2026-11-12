import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distributeLevels } from '../domain/screen-routes.js';

const web = f => fs.readFileSync(new URL(`../interfaces/web/js/${f}`, import.meta.url), 'utf8');

test('distributeLevels: a hub with many targets is spread over several columns, not one tall strip', () => {
  const ids = Array.from({ length: 18 }, (_, i) => i + 1);          // 1 = home, 2..17 = its 16 targets, 18 = one level deeper
  const level = new Map(ids.map(id => [id, id === 1 ? 0 : id === 18 ? 2 : 1]));
  const { cells, cols, rows, maxRows } = distributeLevels(ids, level);
  assert.equal(cells.size, 18);
  assert.ok(rows <= maxRows && maxRows <= 6, `no column is taller than ${maxRows}`);
  assert.ok(cols > rows, `wider than tall: ${cols} columns × ${rows} rows`);
  // nobody shares a cell, levels keep their left → right order
  assert.equal(new Set([...cells.values()].map(c => `${c.col}|${c.row}`)).size, 18);
  const colsOf = lv => ids.filter(id => level.get(id) === lv).map(id => cells.get(id).col);
  assert.ok(Math.max(...colsOf(0)) < Math.min(...colsOf(1)));
  assert.ok(Math.max(...colsOf(1)) < Math.min(...colsOf(2)));
  // a short column is centred on the tallest one
  assert.equal(cells.get(1).row, (rows - 1) / 2);
});

test('distributeLevels: maxRows is respected and columns of a level are even', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const level = new Map(ids.map(id => [id, id === 1 ? 0 : 1]));       // 7 screens on level 1
  const { cells, cols, rows } = distributeLevels(ids, level, { maxRows: 6 });
  assert.equal(cols, 3);                                               // 1 + (4 + 3), not 1 + (6 + 1)
  assert.equal(rows, 4);
  const perCol = [0, 1, 2].map(c => [...cells.values()].filter(x => x.col === c).length);
  assert.deepEqual(perCol, [1, 4, 3]);
  assert.equal(distributeLevels([], new Map()).cols, 0);
});

test('workflow auto layout and the route import both use distributeLevels', () => {
  assert.match(web('components/workflow-designer.js'), /distributeLevels\(queue, level/);
  assert.match(fs.readFileSync(new URL('../application/workflow-service.js', import.meta.url), 'utf8'), /distributeLevels\(order, level/);
});

test('the designer device picker only previews: nothing is written, and the canvas is view-only meanwhile', () => {
  const src = web('components/designer.js');
  const body = src.slice(src.indexOf('  async setDevicePreview(dv) {'), src.indexOf('  syncDevicePreviewUi() {'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body, /api\.(updateDesign|patchNode|replaceNodes|restoreDesign)/, 'the preview never writes');
  assert.match(src, /await this\.setDevicePreview\(dv\);/, 'a device in the menu starts a preview');
  assert.match(src, /if \(this\.previewLocked\(\)\) return null;\n    const snap = this\.snapshot\(\)/, 'edits are refused while previewing');
  assert.match(src, /!this\.baseline \|\| this\.devicePreview\) return;/, 'a preview never marks the screen as changed');
  assert.match(src, /Apply \$\{pv\.name\} to this screen/, 'really changing the device stays possible, explicitly');
});

test('the Theme head opens the design style window with previews instead of a dropdown', () => {
  assert.match(web('main.js'), /\['Theme', \(\) => openThemePicker\(/);
  const tp = web('components/theme-picker.js');
  assert.match(tp, /api\.svgUrl\(sample\.type, sample\.id, \{ theme: t\.key \}\)/, 'each card renders the sample in its own style');
  assert.match(tp, /setTheme\(startKey\)/, 'Revert goes back to the style that was active');
});
