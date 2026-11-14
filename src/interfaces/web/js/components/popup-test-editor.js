/**
 * Test-phase popup editor: while a designer screen runs in test mode, a popup opened by a click can be
 * dragged to its real place (snap to grid / 9 points), given a show and a close animation with durations,
 * and saved onto the click binding that opened it (`binding.popup`).
 *
 * Position is stored as fractions of the viewport (x, y in 0..1), so it holds at any zoom.
 */
import { h } from '../dom.js';

export const POPUP_ANIMATIONS = ['none', 'fade', 'scale', 'bounce', 'slide-up', 'slide-down', 'slide-left', 'slide-right'];

export const DEFAULT_POPUP_CFG = { x: null, y: null, showAnim: 'fade', showMs: 300, closeAnim: 'fade', closeMs: 200 };

/** The saved popup settings of a click binding, with defaults for anything not saved yet. */
export function popupCfgOf(binding) {
  return { ...DEFAULT_POPUP_CFG, ...(binding?.popup || {}) };
}

/** Snaps a popup's left / top (px in the viewport): to the grid when `grid > 0`, and to the 9 reference points when `anchors`. */
export function snapPopupPosition(x, y, w, hgt, vw, vh, { grid = 0, anchors = false, threshold = 10 } = {}) {
  let nx = x, ny = y;
  if (grid > 0) { nx = Math.round(nx / grid) * grid; ny = Math.round(ny / grid) * grid; }
  if (anchors) {
    const xs = [0, (vw - w) / 2, vw - w], ys = [0, (vh - hgt) / 2, vh - hgt];
    const nearX = xs.find(t => Math.abs(t - nx) <= threshold);
    const nearY = ys.find(t => Math.abs(t - ny) <= threshold);
    if (nearX !== undefined) nx = nearX;
    if (nearY !== undefined) ny = nearY;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return { x: clamp(nx, 0, Math.max(0, vw - w)), y: clamp(ny, 0, Math.max(0, vh - hgt)) };
}

/** Keyframe name + inline animation string for a show (`in`) or close (`out`) animation. */
export function popupAnimation(kind, name, ms) {
  if (!name || name === 'none' || !(ms > 0)) return '';
  return `pv-${kind}-${name} ${ms}ms ${kind === 'in' ? 'ease-out' : 'ease-in'} both`;
}

/**
 * Makes `box` draggable by its `grip`. `place(x, y)` receives the snapped left / top in px.
 * `options.snap()` returns the snap options for the current settings; `options.size()` returns the viewport size.
 */
export function makeDraggable(box, grip, { snap, size, onMove, onEnd }) {
  let drag = null;
  grip.addEventListener('pointerdown', ev => {
    if (ev.button) return;
    const parent = box.parentElement, pr = parent.getBoundingClientRect(), br = box.getBoundingClientRect();
    drag = { dx: ev.clientX - br.left, dy: ev.clientY - br.top, pr };
    grip.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  });
  grip.addEventListener('pointermove', ev => {
    if (!drag) return;
    const vw = size().w, vh = size().h;
    const raw = { x: ev.clientX - drag.pr.left - drag.dx, y: ev.clientY - drag.pr.top - drag.dy };
    const p = snapPopupPosition(raw.x, raw.y, box.offsetWidth, box.offsetHeight, vw, vh, snap());
    box.style.position = 'absolute'; box.style.margin = '0';
    box.style.left = `${p.x}px`; box.style.top = `${p.y}px`;
    onMove?.(p);
  });
  const stop = () => {
    if (!drag) return;
    const vw = size().w, vh = size().h;
    drag = null;
    const left = parseFloat(box.style.left) || 0, top = parseFloat(box.style.top) || 0;
    onEnd?.({ x: vw ? left / vw : 0, y: vh ? top / vh : 0 });
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
}

/**
 * Applies a saved position to a box inside `viewport` (fractions of the viewport), or leaves it centred when unset.
 */
export function placePopupBox(box, cfg, viewport) {
  if (cfg.x == null || cfg.y == null) return;
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  box.style.position = 'absolute'; box.style.margin = '0';
  box.style.left = `${Math.round(cfg.x * vw)}px`;
  box.style.top = `${Math.round(cfg.y * vh)}px`;
}

/**
 * The test-phase controls under a popup: show / close animation with durations, Reset position and Save.
 * `onChange(patch)` updates the live preview, `onSave(patch)` stores the settings on the binding.
 */
export function popupTestControls({ cfg, onChange, onSave, onReset }) {
  const cur = { ...cfg };
  const sel = (label, key, options) => h('label', { class: 'pv-ctl' }, h('span', {}, label),
    h('select', { 'data-f': `pv-${key}`, onchange: e => { cur[key] = e.target.value; onChange({ [key]: cur[key] }); } },
      options.map(o => h('option', { value: o, selected: o === cur[key] }, o))));
  const num = (label, key) => h('label', { class: 'pv-ctl' }, h('span', {}, label),
    h('input', { type: 'number', min: 0, max: 5000, step: 50, value: String(cur[key]), 'data-f': `pv-${key}`, style: { width: '76px' },
      onchange: e => { cur[key] = Math.max(0, Math.min(5000, Number(e.target.value) || 0)); onChange({ [key]: cur[key] }); } }), h('span', { class: 'muted' }, 'ms'));
  const status = h('span', { class: 'muted', 'data-f': 'pv-status' }, '');
  return h('div', { class: 'pv-controls', 'data-f': 'pv-controls' },
    sel('Show animation', 'showAnim', POPUP_ANIMATIONS),
    num('Show duration', 'showMs'),
    sel('Close animation', 'closeAnim', POPUP_ANIMATIONS),
    num('Close duration', 'closeMs'),
    h('button', { class: 'btn sm', type: 'button', 'data-f': 'pv-reset', onclick: () => { cur.x = null; cur.y = null; onReset(); status.textContent = 'Position reset (centred)'; } }, 'Reset position'),
    h('button', { class: 'btn sm primary', type: 'button', 'data-f': 'pv-save', onclick: async () => { await onSave({ ...cur }); status.textContent = 'Saved'; } }, 'Save'),
    status);
}
