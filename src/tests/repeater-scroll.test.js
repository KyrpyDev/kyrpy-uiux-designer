import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repeaterPlan, repeaterMarkup, bindRepeaterScroll, repeaterDefaultAttrs, repeaterConfig } from '../domain/repeater.js';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = o => repeaterConfig({ attrs: repeaterDefaultAttrs(o) });
const inner = { x: 10, y: 20, w: 200, h: 100 }, item = { w: 60, h: 40 };

/** Minimal stage: one `.ud-rpt-stage` (attributes parsed from the real markup) inside a host group scaled 2× at (100, 50). */
function fakeStage(markup, { animatedAt = null } = {}) {
  const attrs = Object.fromEntries([...markup.match(/<g class="ud-rpt-stage"[^>]*>/)[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const track = { style: {} };
  const st = { getAttribute: k => attrs[k] ?? null, querySelector: () => track,
    parentNode: { getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }) } };
  const handlers = {};
  const root = {
    addEventListener: (type, fn, opt) => { (handlers[type] ||= []).push({ fn, capture: opt === true }); },
    querySelectorAll: () => (attrs['data-rpt-axis'] ? [st] : []),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ transform: animatedAt == null ? 'none' : `matrix(1, 0, 0, 1, 0, ${animatedAt})` }) } }
  };
  const fire = (type, ev) => {
    const e = { button: 0, deltaX: 0, deltaY: 0, deltaMode: 0, prevented: false, stopped: false, ...ev,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const hd of handlers[type] || []) hd.fn(e);
    return e;
  };
  return { root, st, track, attrs, fire };
}
// client point inside the content box: user (50, 60) → client (100 + 2·50, 50 + 2·60)
const INSIDE = { clientX: 200, clientY: 170 }, OUTSIDE = { clientX: 20, clientY: 20 };

test('repeater plan + markup say what a wheel / drag may scroll', () => {
  // a list that fits its box has nothing to scroll; an overflowing one scrolls by the overflow
  assert.equal(repeaterPlan(cfg({ layout: 'vertical', itemCount: 2 }), inner, item).scroll.max, 0);
  const list = repeaterPlan(cfg({ layout: 'vertical', itemCount: 6, gap: 10 }), inner, item);
  assert.deepEqual(list.scroll, { axis: 'y', step: 50, kind: 'list', loop: 0, max: 6 * 50 - 10 - 100 });
  const loop = repeaterPlan(cfg({ layout: 'scroll', itemCount: 4, gap: 10 }), inner, item);
  assert.deepEqual(loop.scroll, { axis: 'y', step: 50, kind: 'loop', loop: 200, max: 0 });
  assert.equal(repeaterPlan(cfg({ layout: 'carousel', itemCount: 4 }), inner, item).scroll.axis, 'x');
  assert.equal(repeaterPlan(cfg({ layout: 'slide', itemCount: 4, gap: 10 }), inner, item).scroll.max, 150);

  const m = repeaterMarkup('7', cfg({ layout: 'scroll', itemCount: 4, gap: 10 }), inner, item, '<rect/>', 'animate').markup;
  assert.match(m, /data-rpt-axis="y" data-rpt-kind="loop" data-rpt-step="50" data-rpt-loop="200" data-rpt-max="0" data-rpt-box="10 20 200 100" data-rpt-period="7200" data-rpt-count="4"/);
  // nothing to scroll: no scroll attributes (a fitting list, a static export frame, a 3D ring)
  assert.ok(!repeaterMarkup('7', cfg({ layout: 'vertical', itemCount: 2 }), inner, item, '<rect/>', 'animate').markup.includes('data-rpt-axis'));
  assert.ok(!repeaterMarkup('7', cfg({ layout: 'scroll', itemCount: 4 }), inner, item, '<rect/>', 'static').markup.includes('data-rpt-axis'));
  assert.ok(!repeaterMarkup('7', cfg({ layout: 'carousel', dimension: '3d', itemCount: 4 }), inner, item, '<rect/>', 'animate').markup.includes('data-rpt-axis'));
});

test('wheel inside the repeater area scrolls its copies only; outside or switched off it is left alone', () => {
  const m = repeaterMarkup('7', cfg({ layout: 'vertical', itemCount: 6, gap: 10, autoplay: false }), inner, item, '<rect/>', 'animate').markup;
  let on = false;
  const s = fakeStage(m);
  bindRepeaterScroll(s.root, () => on);
  bindRepeaterScroll(s.root, () => on);                       // binding twice adds no second set of listeners
  let e = s.fire('wheel', { ...INSIDE, deltaY: 40 });
  assert.equal(e.prevented, false, 'not in test mode: the canvas zooms as before');
  assert.equal(s.track.style.transform, undefined);
  on = true;
  e = s.fire('wheel', { ...OUTSIDE, deltaY: 40 });
  assert.equal(e.prevented, false, 'outside the element area');
  e = s.fire('wheel', { ...INSIDE, deltaY: 40 });             // 40 screen px at 2× zoom = 20 user units
  assert.ok(e.prevented && e.stopped);
  assert.equal(s.track.style.transform, 'translateY(-20px)');
  assert.equal(s.track.style.animation, 'none');
  s.fire('wheel', { ...INSIDE, deltaY: 4000 });
  assert.equal(s.track.style.transform, 'translateY(-190px)', 'a list stops at its last copy');
  e = s.fire('wheel', { ...INSIDE, deltaY: 40 });
  assert.equal(e.prevented, false, 'at the end the wheel goes on to the page');
  s.fire('wheel', { ...INSIDE, deltaY: -9000 });
  assert.equal(s.track.style.transform, 'translateY(0px)');
});

test('loops wrap around and take over from the running animation; a drag scrolls and swallows its click', () => {
  const m = repeaterMarkup('7', cfg({ layout: 'scroll', itemCount: 4, gap: 10 }), inner, item, '<rect/>', 'animate').markup;
  const s = fakeStage(m, { animatedAt: -120 });               // autoplay has already moved the track 120 units
  bindRepeaterScroll(s.root);
  s.fire('wheel', { ...INSIDE, deltaY: 100 });                // + 50 user units
  assert.equal(s.track.style.transform, 'translateY(-170px)');
  s.fire('wheel', { ...INSIDE, deltaY: 100 });                // 220 wraps around the 200-unit set
  assert.equal(s.track.style.transform, 'translateY(-20px)');
  s.fire('wheel', { ...INSIDE, deltaY: -100 });               // backwards past the start wraps too
  assert.equal(s.track.style.transform, 'translateY(-170px)');
  clearTimeout(s.st.__udT);

  s.fire('pointerdown', INSIDE);
  s.fire('pointermove', { clientX: 200, clientY: 168 });      // below the 5 px threshold: still a click
  assert.equal(s.track.style.transform, 'translateY(-170px)');
  assert.equal(s.fire('click', INSIDE).stopped, false);
  s.fire('pointermove', { clientX: 200, clientY: 150 });      // dragged up 20 px = 10 user units further
  assert.equal(s.track.style.transform, 'translateY(-180px)');
  assert.equal(s.fire('click', INSIDE).stopped, true, 'the click that ends a scrolling drag is not an item click');
  clearTimeout(s.st.__udT);
});

test('the designer binds it to test mode and every export ships it', () => {
  const read = p => readFileSync(resolve(here, '..', p), 'utf8');
  assert.match(read('interfaces/web/js/components/designer.js'), /bindRepeaterScroll\(this\.stage, \(\) => this\.actionsLive\)/);
  assert.match(read('application/export/templates.js'), /bindRepeaters\(document\);\n\s*bindRepeaterScroll\(document\);/);
  assert.match(read('application/export/project-viewer.js'), /bindRepeaterScroll\(stage\);/);
  assert.equal((read('application/export/export-service.js').match(/bindRepeaters, bindRepeaterScroll\]/g) || []).length, 2);
});
