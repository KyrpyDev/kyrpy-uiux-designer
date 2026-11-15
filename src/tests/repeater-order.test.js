import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeaterConfig, assignRepeaterItems, repeaterMarkup, REPEATER_ATTR } from '../domain/repeater.js';

const node = order => ({ attrs: { [REPEATER_ATTR.layout]: 'vertical', [REPEATER_ATTR.itemCount]: 5, ...(order ? { [REPEATER_ATTR.order]: order } : {}) } });

test('repeater order: "listed" follows the sub-item order and turns the per-load random pick off', () => {
  const cfg = repeaterConfig(node('listed'));
  assert.equal(cfg.ordered, true);
  assert.equal(cfg.random, false);
  assert.deepEqual(assignRepeaterItems(3, 5, 'seed', { ordered: true }), [0, 1, 2, 0, 1]);
});

test('repeater order: default stays random (seeded), each sub-item still shown once', () => {
  const cfg = repeaterConfig(node());
  assert.equal(cfg.ordered, false);
  assert.equal(cfg.random, true);
  const pick = assignRepeaterItems(3, 5, 'seed');
  for (const i of [0, 1, 2]) assert.ok(pick.includes(i));
});

test('repeater order: markup without precomputed assignments places the sub-items in listed order', () => {
  const cfg = { ...repeaterConfig(node('listed')), autoplay: false };
  const tpl = ['<rect data-t="a"/>', '<rect data-t="b"/>', '<rect data-t="c"/>'];
  const m = repeaterMarkup('r9', cfg, { x: 0, y: 0, w: 200, h: 600 }, { w: 200, h: 60 }, tpl, 'static').markup;
  const seq = [...m.matchAll(/data-t="(\w)"/g)].map(x => x[1]);
  assert.deepEqual(seq.slice(0, 5), ['a', 'b', 'c', 'a', 'b']);
});
