import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clickBinding, clickTargetOf, withClickTarget, changedKeys, placeBox } from '../domain/quick-edit.js';
import { normalizeEvents } from '../domain/entities.js';

const web = f => fs.readFileSync(new URL(`../interfaces/web/js/${f}`, import.meta.url), 'utf8');

test('quick edit: the click target of a placed item is read from its click event or the legacy onClick', () => {
  assert.deepEqual(clickTargetOf({ events: [{ trigger: 'mouseover', type: 'popup', targetId: 3 }, { trigger: 'click', type: 'screen', targetId: '12' }] }), { screenId: 12, elementId: null, other: '' });
  assert.deepEqual(clickTargetOf({ onClick: { type: 'popup', targetId: 7 } }), { screenId: null, elementId: 7, other: '' });
  assert.deepEqual(clickTargetOf({ events: [{ trigger: 'click', type: 'drawer', targetId: 9, side: 'left' }] }), { screenId: null, elementId: 9, other: '' });
  assert.deepEqual(clickTargetOf({ events: [{ trigger: 'click', type: 'animate' }] }), { screenId: null, elementId: null, other: 'animate' });
  assert.deepEqual(clickTargetOf({}), { screenId: null, elementId: null, other: '' });
  assert.equal(clickBinding({ events: [], onClick: { type: 'back' } }).trigger, 'click');
});

test('quick edit: replacing the click target keeps the other triggers and gives events the server accepts', () => {
  const events = [{ trigger: 'mouseover', type: 'popup', targetId: 3 }, { trigger: 'click', type: 'drawer', targetId: 9, side: 'left' }];
  const toScreen = withClickTarget(events, { screenId: 21 });
  assert.deepEqual(toScreen, [{ trigger: 'mouseover', type: 'popup', targetId: 3 }, { trigger: 'click', type: 'screen', targetId: 21 }]);
  // a drawer stays a drawer (and keeps its side) when only the element changes; a route becomes a popup
  assert.deepEqual(withClickTarget(events, { elementId: 44 }).at(-1), { trigger: 'click', type: 'drawer', targetId: 44, side: 'left' });
  assert.deepEqual(withClickTarget(toScreen, { elementId: 44 }).at(-1), { trigger: 'click', type: 'popup', targetId: 44 });
  assert.deepEqual(withClickTarget(events, {}), [{ trigger: 'mouseover', type: 'popup', targetId: 3 }]);
  assert.deepEqual(withClickTarget(null, { screenId: 5 }), [{ trigger: 'click', type: 'screen', targetId: 5 }]);
  assert.equal(events.length, 2, 'the input is not changed');
  for (const out of [toScreen, withClickTarget(events, { elementId: 44 })]) assert.equal(normalizeEvents(out).length, out.length);
});

test('quick edit: only changed values are saved; the box stays inside the window', () => {
  const base = { label: 'A', name: 'a', target: { screenId: 1, elementId: null }, tip: '' };
  assert.deepEqual(changedKeys(base, { ...base }), []);
  assert.deepEqual(changedKeys(base, { ...base, label: 'B', target: { screenId: 2, elementId: null } }), ['label', 'target']);
  assert.deepEqual(changedKeys(base, { ...base, target: { screenId: 1, elementId: null } }), [], 'an equal object is not a change');
  const win = { w: 1000, h: 700 }, size = { w: 300, h: 380 };
  assert.deepEqual(placeBox({ left: 100, right: 120, top: 200 }, size, win), { left: 130, top: 188 });
  assert.equal(placeBox({ left: 900, right: 920, top: 200 }, size, win).left, 590, 'no room on the right: left of the item');
  assert.equal(placeBox({ left: 100, right: 120, top: 690 }, size, win).top, 312, 'never below the window');
  assert.equal(placeBox({ left: 100, right: 120, top: 2 }, size, win).top, 8);
});

test('live test: pills open the quick edit box, menu items get a toolbar, and the box applies / saves / resets', () => {
  const ta = web('components/designer-test-actions.js'), qe = web('components/live-quick-edit.js');
  assert.match(ta, /openQuickEdit\(this, at, \{ kind: 'node', nodeId: n\.id \}\)/);
  assert.match(ta, /openQuickEdit\(this, at, \{ kind: 'lib', type: 'button', id \}\)/);
  for (const act of ['item-quick', 'item-target', 'item-full']) assert.match(ta, new RegExp(`'${act}'`), `menu item tool ${act}`);
  assert.match(ta, /showFor\(this\.menuUnder\(ev\)\)/, 'the item under a route hotspot is still found');
  assert.match(ta, /this\.applyLiveHoverLabels\(\);/);
  for (const f of ['qe-label', 'qe-name', 'qe-type', 'qe-target', 'qe-tip', 'qe-descriptionDev']) assert.ok(qe.includes(f.replace('qe-', '')), f);
  assert.match(qe, /dataset: \{ act: 'qe-reset' \}/); assert.match(qe, /dataset: \{ act: 'qe-save' \}/);
  assert.match(qe, /model\.apply\(draft\)\)\.then\(\(\) => \{ if \(!closed\) rerender\(\); \}\)/, 'every change is applied to the running test');
  assert.match(qe, /if \(lost\) \{ model\.apply\(base\)/, 'closing drops unsaved changes');
  assert.match(qe, /api\.updateMenuItem\(buttonId, itemId, patch\)/); assert.match(qe, /api\.patchNode\(d\.type, d\.doc\.id, nodeId, patch\)/);
  assert.match(qe, /api\.updateLink\(wfId, l\.id, \{ toScreenId: v\.target\.screenId \}\)/, 'a route inside a workflow test is the workflow link');
});

test('Test workflow starts on the screen selected on the workflow canvas', () => {
  const wd = web('components/workflow-designer.js'), tr = web('components/test-runner.js');
  assert.match(wd, /startScreenId: this\.testStartScreenId\(\)/);
  assert.match(wd, /this\.sel\?\.kind === 'node' \? this\.sel\.id : null/);
  assert.match(tr, /startId = target\.startScreenId \?\? workflowStart\(wf\)/);
  assert.match(tr, /reapplyQuickEdit\(d\)/, 'a live re-read keeps the values being edited');
});

test('isBackOrCancel / withBackAction: back, cancel and close buttons get the Go back click', async () => {
  const { isBackOrCancel, withBackAction } = await import('../domain/quick-edit.js');
  for (const t of ['Back', 'btn-cancel', 'Close', 'go_back', 'arrow-left', 'İptal', 'Geri']) assert.equal(isBackOrCancel(t), true, t);
  for (const t of ['Background', 'Feedback', 'Save', 'Closet', '', undefined]) assert.equal(isBackOrCancel(t), false, String(t));
  const ev = withBackAction([{ trigger: 'click', type: 'screen', targetId: 3 }, { trigger: 'dblclick', type: 'animate' }]);
  assert.deepEqual(ev, [{ trigger: 'dblclick', type: 'animate' }, { trigger: 'click', type: 'back' }]);
});

test('popup surface role: auto close after x seconds in the preview and the exported pages', async () => {
  const { SURFACE_ROLES, popupAutoCloseSecs, roleAttrs } = await import('../domain/theme.js');
  assert.ok(SURFACE_ROLES.includes('popup'));
  assert.equal(popupAutoCloseSecs([{ role: 'popup', attrs: { 'data-autoclose': '3' } }, { role: 'card', attrs: { 'data-autoclose': '9' } }]), 3);
  assert.equal(popupAutoCloseSecs([{ role: 'popup', attrs: {} }]), 0);
  const th = { tokens: {}, surfaces: { card: { fill: '#fff' } } };
  assert.deepEqual(roleAttrs(th, 'popup'), { fill: '#fff' });
  const { screenParts } = await import('../application/export/templates.js');
  const parts = screenParts({ screen: { key: 's', name: 's', width: 10, height: 10 }, inlineSvgs: [], links: [], components: [], overlays: [{ id: 'ov1', kind: 'popup', label: 'p', svgs: [], width: 10, height: 10, autoClose: 4 }] });
  assert.match(parts.overlays, /data-ud-autoclose="4"/);
  assert.match(web('components/designer.js'), /popupAutoCloseSecs\(el\.nodes\)/);
});

test('button inspector: the button icon is shown and changed from the inspector panel', () => {
  const src = web('components/inspector.js');
  assert.match(src, /'doc-change-icon'/);
  assert.match(src, /d\.changeButtonIcon\(inst\)/);
});
