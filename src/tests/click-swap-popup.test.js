import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClickAction, normalizePopupCfg } from '../domain/entities.js';

test('swap: the "change to the target item" click action is accepted and needs a target', () => {
  assert.deepEqual(normalizeClickAction({ type: 'swap', targetId: '230' }), { type: 'swap', targetId: 230 });
  assert.throws(() => normalizeClickAction({ type: 'swap' }), /needs a target element/);
});

test('popup settings survive a save of a popup-type click action and are cleaned', () => {
  const out = normalizeClickAction({ type: 'show-element', targetId: 7, popup: { x: 0.25, y: 2, showAnim: 'slide-up', showMs: 400, closeAnim: 'bogus', closeMs: 9999 } });
  assert.deepEqual(out.popup, { x: 0.25, y: 1, showAnim: 'slide-up', showMs: 400, closeAnim: 'fade', closeMs: 5000 });
  assert.equal(normalizeClickAction({ type: 'screen', targetId: 3, popup: { x: 0.1 } }).popup, undefined);
  assert.equal(normalizePopupCfg(null), null);
});
