/**
 * Test runner: a full-screen modal that runs a design live.
 *  - button (menu):  the button with its menu effects; items without a target screen say so; popups open inside.
 *  - screen:         the screen with every menu / button / event working; routes only announce their target
 *                    ("would go to <screen>" or "no target screen") and never leave the screen.
 *  - workflow:       a browsable app: starts on the screen selected on the workflow canvas (else the workflow's first
 *                    screen) and follows its links; Back walks back.
 * The live HUD is the toolbar (back, animations, edit pills, edit in a new tab, restart, close). Edits made in another tab
 * (the ✎ pills) show up at once through the sync event, so the design can be changed while it runs.
 */
import { h, modal, toast } from '../dom.js';
import { api } from '../api.js';
import { Designer } from './designer.js';
import { reapplyQuickEdit } from './live-quick-edit.js';

/** First screen of a workflow: a node no link points to (the entry), else the first node. */
export function workflowStart(wf) {
  const ids = (wf?.nodes || []).map(n => n.screenId);
  const targets = new Set((wf?.links || []).filter(l => l.fromScreenId !== l.toScreenId).map(l => l.toScreenId));
  return ids.find(id => !targets.has(id)) ?? ids[0] ?? null;
}

/**
 * Opens the test runner. `target` = { type: 'button' | 'screen' | 'element', id } or { type: 'workflow', id }.
 * Resolves to the Designer that runs inside the modal (or null).
 */
export async function openTestRunner(app, target) {
  const isWf = target.type === 'workflow';
  let wf = null, startId = null;
  if (isWf) {
    try { wf = await api.workflow(target.id); } catch (e) { toast(e.message, 'error'); return null; }
    startId = target.startScreenId ?? workflowStart(wf);
    if (startId == null) { toast('This workflow has no screens to test yet', 'error'); return null; }
  }
  const root = h('div', { class: 'test-runner', style: { display: 'flex', flex: 1, minHeight: 0, height: '100%' } });
  const stack = [];                          // workflow test: screens visited before the current one (Back)
  let d = null;
  const title = isWf ? `▶ Test workflow “${wf.name}”` : `▶ Test ${target.type}`;
  const m = modal({ title, full: true, content: root, onClose: () => { app.modals = app.modals.filter(x => x !== d); } });
  d = new Designer(root, {
    modal: true,
    testRunner: { mode: isWf ? 'navigate' : 'notify', workflowId: isWf ? wf.id : null, wf, close: () => m.close(),
      restart: () => { stack.length = 0; return go(isWf ? startId : target.id, isWf ? 'screen' : target.type); } },
    onClose: () => m.close(),
    canBack: () => stack.length > 0,
    onBack: () => { if (stack.length) go(stack.pop(), 'screen', false); },
    backTarget: () => 'the previous screen',
    // a route inside the runner: the workflow test follows it, the design test only announces it (see navigateLiveToScreen)
    openDesign: async (t, i) => { if (t === 'screen' && isWf) { if (d.doc) stack.push(d.doc.id); return go(i, 'screen'); } }
  });
  app.modals.push(d);
  d.inspectorOpen = false; d.inspectorEl.classList.add('collapsed');
  // a workflow test follows the links of this workflow only (a screen's own list mixes the workflows it is in)
  d.on('loaded', rec => {
    if (isWf) { rec.links = (wf.links || []).filter(l => l.fromScreenId === rec.id); rec._wfLinks = true; d.renderStage(); }   // this workflow's routes out of the screen
    d.root.dataset.testScreen = rec.name;
    // the device chosen in the test window stays while the test walks from screen to screen
    if (d._testDevice && d.type === 'screen' && (rec.width !== d._testDevice.width || rec.height !== d._testDevice.height)) d.previewDevice(d._testDevice);
  });
  // a re-read of the screen (live sync after an edit) keeps this workflow's routes and the values being quick-edited
  d.on('doc', async rec => {
    if (!rec || rec !== d.doc) return;
    if (isWf && d.type === 'screen' && !rec._wfLinks) { rec.links = (wf.links || []).filter(l => l.fromScreenId === rec.id); rec._wfLinks = true; }
    await reapplyQuickEdit(d);
    if (rec === d.doc) d.renderStage();
  });
  async function go(id, type) {
    d._keepActionsLive = true;
    try { await d.load(type, id); } catch (e) { toast(e.message, 'error'); return; }
    if (!d.actionsLive) d.setTestActions(true);
  }
  await go(isWf ? startId : target.id, isWf ? 'screen' : target.type);
  if (!d.doc) { m.close(); return null; }
  return d;
}
