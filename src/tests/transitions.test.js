import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { normalizeTransitions, defaultTransitions, transitionAttr, transitionSeconds, transitionsOf, udTransition, TRANSITION_EVENTS } from '../domain/transition.js';

test('transitions: four events, known effects, durations in seconds (0..10), defaults per type', () => {
  assert.deepEqual(TRANSITION_EVENTS, ['goto', 'back', 'open', 'close']);
  assert.equal(defaultTransitions('screen').close.effect, 'none');
  assert.equal(defaultTransitions('element').close.effect, 'fade');
  const t = normalizeTransitions({ goto: { effect: 'flip', duration: '0,456' }, back: { effect: 'bogus', duration: 99 }, open: 'x' }, 'screen');
  assert.deepEqual(t.goto, { effect: 'flip', duration: 0.46 });
  assert.deepEqual(t.back, { effect: 'slide-right', duration: 10 });
  assert.deepEqual(t.open, defaultTransitions('screen').open);
  assert.equal(transitionSeconds(-1), 0);
  assert.equal(transitionAttr(t), 'goto=flip/0.46 back=slide-right/10 open=zoom/0.25 close=none/0');
  assert.deepEqual(transitionsOf({ meta: { transitions: { close: { effect: 'zoom-out', duration: 1.5 } } } }, 'element').close, { effect: 'zoom-out', duration: 1.5 });
});

test('udTransition: reads the export attribute, plays with the Web Animations API, out = the in frames reversed', async () => {
  const calls = [];
  const el = { animate(frames, opts) { calls.push({ frames, opts }); const a = { cancel() {} }; setTimeout(() => a.onfinish && a.onfinish(), 5); return a; } };
  await udTransition(el, 'goto=slide-left/0.3 back=slide-right/0.3 open=zoom/0.25 close=fade/1.2', 'close', 'out');
  assert.equal(calls[0].opts.duration, 1200);
  assert.deepEqual(calls[0].frames, [{ opacity: 1 }, { opacity: 0 }]);
  await udTransition(el, { effect: 'none', duration: 1 }, 'goto', 'in');
  await udTransition(el, 'goto=slide-left/0', 'goto', 'in');
  assert.equal(calls.length, 1, 'none / 0 s play nothing');
  assert.match(udTransition.toString(), /^function udTransition\(/, 'self-contained: it is stringified into exports');
});

test('exports carry the transitions: screen device and overlays get data-ud-tr, both runtimes include udTransition', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const el = c.services.element.create({ key: 'tr-dialog', name: 'Dialog', width: 200, height: 120, meta: { transitions: { open: { effect: 'flip', duration: 0.8 } } } }, {
    nodes: [{ kind: 'shape', tag: 'rect', attrs: { x: 0, y: 0, width: 200, height: 120 } }]
  });
  const b = c.services.screen.create({ key: 'tr-b', name: 'B', width: 360, height: 640, meta: { transitions: { goto: { effect: 'slide-up', duration: 0.5 } } } }, { nodes: [] });
  const a = c.services.screen.create({ key: 'tr-a', name: 'A', width: 360, height: 640 }, {
    nodes: [
      { kind: 'shape', tag: 'rect', name: 'go', attrs: { x: 0, y: 0, width: 100, height: 40 }, onClick: { type: 'screen', targetId: b.id } },
      { kind: 'shape', tag: 'rect', name: 'pop', attrs: { x: 0, y: 50, width: 100, height: 40 }, onClick: { type: 'popup', targetId: el.id } }
    ]
  });
  const out = c.exporter.buildBundle({ screenIds: [a.id, b.id], themeKeys: [c.settings.get().theme], includeIcons: 'none', title: 'T' });
  const file = name => out.files.find(f => f.path === name)?.content || '';
  assert.match(file('screens/tr-b.html'), /class="ud-device"[^>]*data-ud-tr="goto=slide-up\/0.5 back=slide-right\/0.3 open=zoom\/0.25 close=none\/0"/);
  assert.match(file('screens/tr-a.html'), /class="ud-overlay[^"]*"[^>]*data-ud-tr="goto=slide-left\/0.3 back=slide-right\/0.3 open=flip\/0.8 close=fade\/0.2"/);
  assert.match(file('js/app.js'), /function udTransition\(el, spec, event, phase\)/);
  assert.match(file('js/app.js'), /leave\(function \(\) \{ location\.href = href; \}, false\)/);
  const pv = c.exporter.buildProjectHtml({ projectId: a.projectId ?? 1, title: 'T' }).content;
  assert.match(pv, /function udTransition\(el, spec, event, phase\)/);
  assert.match(pv, /play\(oldDev, oldTr, 'close', 'out'\)/);
  assert.match(pv, /data-ud-tr="goto=slide-up\/0.5/);
});
