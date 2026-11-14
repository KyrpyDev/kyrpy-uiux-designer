import test from 'node:test';
import assert from 'node:assert/strict';
import { snapPopupPosition, popupCfgOf, popupAnimation, DEFAULT_POPUP_CFG } from '../interfaces/web/js/components/popup-test-editor.js';

test('popup settings default when nothing is saved and keep saved values', () => {
  assert.deepEqual(popupCfgOf(null), DEFAULT_POPUP_CFG);
  assert.equal(popupCfgOf({ popup: { showMs: 800 } }).showMs, 800);
  assert.equal(popupCfgOf({ popup: { showMs: 800 } }).closeAnim, 'fade');
});

test('snap: grid rounds, 9-point anchors catch the centre and edges, position stays inside the viewport', () => {
  assert.deepEqual(snapPopupPosition(23, 47, 100, 50, 400, 300, { grid: 10 }), { x: 20, y: 50 });
  assert.deepEqual(snapPopupPosition(148, 5, 100, 50, 400, 300, { anchors: true }), { x: 150, y: 0 });
  assert.deepEqual(snapPopupPosition(500, -20, 100, 50, 400, 300), { x: 300, y: 0 });
  assert.deepEqual(snapPopupPosition(10, 10, 100, 50, 400, 300), { x: 10, y: 10 });
});

test('animations: none or zero duration gives no animation; in / out use their keyframes', () => {
  assert.equal(popupAnimation('in', 'none', 300), '');
  assert.equal(popupAnimation('out', 'fade', 0), '');
  assert.equal(popupAnimation('in', 'slide-up', 250), 'pv-in-slide-up 250ms ease-out both');
  assert.equal(popupAnimation('out', 'scale', 120), 'pv-out-scale 120ms ease-in both');
});
