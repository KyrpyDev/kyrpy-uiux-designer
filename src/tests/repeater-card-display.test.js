import test from 'node:test';
import assert from 'node:assert/strict';
import { repeaterConfig, repeaterPlan, repeaterMarkup, REPEATER_ATTR } from '../domain/repeater.js';

const inner = { x: 0, y: 0, w: 300, h: 600 };
const node = display => ({ attrs: { [REPEATER_ATTR.layout]: 'vertical', [REPEATER_ATTR.itemCount]: 3, [REPEATER_ATTR.gap]: 8, ...(display ? { [REPEATER_ATTR.display]: display } : {}) } });

test('repeater display: list is the default, card is opt-in and anything else is list', () => {
  assert.equal(repeaterConfig(node()).display, 'list');
  assert.equal(repeaterConfig(node('card')).display, 'card');
  assert.equal(repeaterConfig(node('weird')).display, 'list');
});

test('card display: slots grow by the card padding and every copy gets a card behind it; list is unchanged', () => {
  const list = repeaterPlan(repeaterConfig(node('list')), inner, { w: 200, h: 60 });
  const card = repeaterPlan(repeaterConfig(node('card')), inner, { w: 200, h: 60 });
  assert.equal(list.iw, 200); assert.equal(list.pad, 0);
  assert.equal(card.iw, 220); assert.equal(card.ih, 80); assert.equal(card.pad, 10);
  const listMk = repeaterMarkup('r1', repeaterConfig(node('list')), inner, { w: 200, h: 60 }, '<rect width="200" height="60"/>', 'static').markup;
  const cardMk = repeaterMarkup('r1', repeaterConfig(node('card')), inner, { w: 200, h: 60 }, '<rect width="200" height="60"/>', 'static').markup;
  assert.equal((listMk.match(/ud-rpt-card/g) || []).length, 0);
  assert.equal((cardMk.match(/class="ud-rpt-card"/g) || []).length, 3);
});

test('columns: N columns resize items to the column width, auto fits by width, 1 is the plain list', () => {
  const cfg = (cols, extra = {}) => repeaterConfig({ attrs: { [REPEATER_ATTR.layout]: 'vertical', [REPEATER_ATTR.itemCount]: 6, [REPEATER_ATTR.gap]: 10, [REPEATER_ATTR.columns]: cols, ...extra } });
  const box = { x: 0, y: 0, w: 320, h: 600 };
  const one = repeaterPlan(cfg(1), box, { w: 100, h: 50 });
  assert.equal(one.cols, undefined); assert.equal(one.copies[1].y, 60);
  const two = repeaterPlan(cfg(2), box, { w: 100, h: 50 });
  assert.equal(two.cols, 2); assert.equal(two.iw, 155);                       // (320 - 10) / 2
  assert.deepEqual([two.copies[1].x, two.copies[1].y, two.copies[2].x, two.copies[2].y], [165, 0, 0, 77.5 + 10]);
  assert.equal(two.copies[0].t, 'scale(1.55)');
  const auto = repeaterPlan(cfg(0), box, { w: 100, h: 50 });
  assert.equal(auto.cols, 3);                                                // floor((320 + 10) / (100 + 10))
  assert.equal(repeaterPlan(cfg(9), box, { w: 100, h: 50 }).cols, 6);        // never more columns than items
  assert.equal(repeaterConfig({ attrs: {} }).columns, 1);
});
