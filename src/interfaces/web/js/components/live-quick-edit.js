/**
 * Quick edit box of the live test (test window / Test actions mode): the ✎ pills open it beside the item.
 * Only basic values: label, variable name, icon / button type, click action (screen or popup), mouse-over label and
 * description-dev. Every change is applied to the running test at once (in memory); Save stores it, Reset puts the
 * values of the last save back. Closing the box with unsaved changes drops them.
 *
 * Subjects:
 *   { kind: 'node', nodeId }             a button / element / icon placed on the tested design
 *   { kind: 'item', buttonId, itemId }   one item of a button menu
 *   { kind: 'lib', type, id }            a library item itself (a menu button nested in a placed element)
 */
import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state, findDesign } from '../state.js';
import { ensureDesignDeps } from '../actions.js';
import { pickIcon, pickButton, pickTarget, targetPatch, targetSummary } from './menu-editor.js';
import { clickTargetOf, withClickTarget, changedKeys, placeBox } from '/domain/quick-edit.js';

const TIP_ATTR = 'data-tip';
let current = null;               // the one open box

export function closeQuickEdit() { current?.close(); }

/** The menu rows of a button as the running test draws them. */
function menuHost(d, buttonId) {
  return d.type === 'button' && d.doc?.id === buttonId ? d.doc : findDesign('button', buttonId);
}

/* ---------- what each subject reads / applies / saves ---------- */

function nodeModel(d, { nodeId }) {
  const node = () => d.byId(nodeId);
  const n0 = node();
  if (!n0) return null;
  const refType = n0.refType;
  const wfId = d.opts.testRunner?.workflowId ?? null, wf = d.opts.testRunner?.wf ?? null;
  const link = () => (d.doc.links || []).find(l => l.fromNodeId === nodeId) || null;
  const libLabel0 = new Map();                       // library labels as stored, per item this box touched
  const lib = id => findDesign(refType, id);
  const rememberLib = id => { const l = lib(id); if (l && !libLabel0.has(id)) libLabel0.set(id, l.label || ''); };
  let events0 = JSON.parse(JSON.stringify(n0.events || [])), onClick0 = n0.onClick || null, attrs0 = { ...(n0.attrs || {}) }, link0 = link() ? { ...link() } : null;
  const read = () => {
    const n = node(), l = link(), t = clickTargetOf(n);
    rememberLib(n.refId);
    return { label: lib(n.refId)?.label || '', name: n.name || '', refId: n.refId, tip: String(n.attrs?.[TIP_ATTR] || ''), descriptionDev: n.descriptionDev || '',
      target: l ? { screenId: l.toScreenId, elementId: null } : { screenId: t.screenId, elementId: t.elementId } };
  };
  return {
    title: () => `${refType} “${lib(node()?.refId)?.label || lib(node()?.refId)?.name || node()?.name || `#${nodeId}`}”`,
    projectId: () => d.doc.projectId ?? state.activeProjectId,
    typeKind: ['icon', 'button'].includes(refType) ? refType : null,
    fields: ['label', 'name', 'type', 'target', 'tip', 'descriptionDev'],
    labelNote: `Label of the ${refType} in the library: every place that uses it shows the change`,
    otherAction: () => clickTargetOf(node()).other,
    read,
    async apply(v) {
      const n = node(); if (!n) return;
      for (const [id, lbl] of libLabel0) { const l = lib(id); if (l) l.label = lbl; }      // labels of items no longer shown go back
      rememberLib(v.refId);
      n.refId = v.refId; n.name = v.name; n.descriptionDev = v.descriptionDev;
      const a = { ...attrs0 }; if (v.tip) a[TIP_ATTR] = v.tip; else delete a[TIP_ATTR];
      n.attrs = a;
      const l = lib(v.refId); if (l) l.label = v.label;
      // a route to a screen inside a workflow test is this workflow's link; anything else is the item's own click event
      const asLink = wfId != null && v.target.screenId != null;
      const cur = link();
      if (asLink) {
        if (cur) cur.toScreenId = v.target.screenId;
        else { const nl = { id: null, workflowId: wfId, fromScreenId: d.doc.id, fromNodeId: nodeId, toScreenId: v.target.screenId, name: '', trigger: 'tap' }; (d.doc.links ||= []).push(nl); wf?.links?.push(nl); }
        n.events = JSON.parse(JSON.stringify(events0)); n.onClick = onClick0;
      } else {
        if (cur && cur.id == null) { d.doc.links = d.doc.links.filter(x => x !== cur); if (wf?.links) wf.links = wf.links.filter(x => x !== cur); }
        else if (cur && link0) cur.toScreenId = link0.toScreenId;
        const t0 = clickTargetOf({ events: events0, onClick: onClick0 });
        const same = !cur && t0.screenId === v.target.screenId && t0.elementId === v.target.elementId;
        if (cur || same) { n.events = JSON.parse(JSON.stringify(events0)); n.onClick = onClick0; }
        else { n.events = withClickTarget(events0, v.target); n.onClick = null; }
      }
      await ensureDesignDeps(d.doc).catch(() => {});
    },
    async save(v, base) {
      const n = node(), diff = changedKeys(base, v), patch = {};
      if (diff.includes('name')) patch.name = v.name;
      if (diff.includes('descriptionDev')) patch.descriptionDev = v.descriptionDev;
      if (diff.includes('refId')) patch.refId = v.refId;
      if (diff.includes('tip')) patch.attrs = n.attrs;
      if (diff.includes('target')) {
        const l = link();
        if (wfId != null && v.target.screenId != null) {
          if (l && l.id != null) await api.updateLink(wfId, l.id, { toScreenId: v.target.screenId });
          else {
            const saved = await api.addLink(wfId, { fromScreenId: d.doc.id, fromNodeId: nodeId, toScreenId: v.target.screenId, name: '', trigger: 'tap' });
            const rec = (saved?.links || []).find(x => x.fromScreenId === d.doc.id && x.fromNodeId === nodeId && x.toScreenId === v.target.screenId) || saved;
            if (l && rec?.id != null) l.id = rec.id;
          }
        } else if (!l) { patch.events = n.events; patch.onClick = null; }
        else toast('This item is a route of the workflow: pick a screen, or remove the link on the workflow canvas', 'info', 3200);
      }
      if (Object.keys(patch).length) await api.patchNode(d.type, d.doc.id, nodeId, patch);
      const stored = libLabel0.get(v.refId);
      if (stored !== undefined && stored !== v.label) { await api.updateDesign(refType, v.refId, { label: v.label }); libLabel0.set(v.refId, v.label); }
      const nn = node();
      events0 = JSON.parse(JSON.stringify(nn.events || [])); onClick0 = nn.onClick || null; attrs0 = { ...(nn.attrs || {}) }; link0 = link() ? { ...link() } : null;
    },
    fullEdit: () => d.editInNewTab(refType, node()?.refId)
  };
}

function itemModel(d, { buttonId, itemId }) {
  const item = () => (menuHost(d, buttonId)?.menuItems || []).find(r => r.id === itemId);
  if (!item()) return null;
  return {
    title: () => `menu item “${item()?.label || item()?.name || `#${itemId}`}”`,
    projectId: () => menuHost(d, buttonId)?.projectId ?? state.activeProjectId,
    typeKind: 'item',
    fields: ['label', 'name', 'type', 'target', 'descriptionDev'],
    tipNote: 'The mouse-over text of a menu item is its label',
    otherAction: () => '',
    read() {
      const it = item();
      return { label: it.label || '', name: it.name || '', iconId: it.iconId ?? null, refButtonId: it.refButtonId ?? null, action: it.action || '', descriptionDev: it.descriptionDev || '',
        target: { screenId: it.targetScreenId ?? null, elementId: it.targetScreenId ? null : it.targetElementId ?? null } };
    },
    async apply(v) {
      const it = item(); if (!it) return;
      Object.assign(it, { label: v.label, name: v.name, iconId: v.iconId, refButtonId: v.refButtonId, action: v.action, descriptionDev: v.descriptionDev, targetScreenId: v.target.screenId, targetElementId: v.target.elementId });
      await ensureDesignDeps({ menuItems: [it] }).catch(() => {});
      d.menu?.afterChange?.();
    },
    async save(v, base) {
      const body = { label: v.label, name: v.name, iconId: v.iconId, refButtonId: v.refButtonId, action: v.action, descriptionDev: v.descriptionDev, targetScreenId: v.target.screenId, targetElementId: v.target.elementId };
      const diff = changedKeys(base, v);
      const patch = Object.fromEntries(Object.entries(body).filter(([k]) => diff.includes(k) || (diff.includes('target') && k.startsWith('target'))));
      if (Object.keys(patch).length) await api.updateMenuItem(buttonId, itemId, patch);
    },
    fullEdit: () => d.editInNewTab('button', buttonId, { item: itemId })
  };
}

function libModel(d, { type, id }) {
  const rec = () => findDesign(type, id);
  if (!rec()) return null;
  return {
    title: () => `${type} “${rec()?.label || rec()?.name || `#${id}`}”`,
    projectId: () => rec()?.projectId ?? state.activeProjectId,
    typeKind: null,
    fields: ['label', 'name', 'descriptionDev'],
    labelNote: `Label of the ${type} in the library`,
    nameNote: 'Variable name (key) of the library item: dashed lowercase words',
    otherAction: () => '',
    read() { const r = rec(); return { label: r.label || '', name: r.key || '', descriptionDev: r.descriptionDev || '', target: { screenId: null, elementId: null } }; },
    async apply(v) { const r = rec(); if (r) { r.label = v.label; r.descriptionDev = v.descriptionDev; } },
    async save(v, base) {
      const diff = changedKeys(base, v), patch = {};
      if (diff.includes('label')) patch.label = v.label;
      if (diff.includes('name')) patch.key = v.name;
      if (diff.includes('descriptionDev')) patch.descriptionDev = v.descriptionDev;
      if (Object.keys(patch).length) await api.updateDesign(type, id, patch);
    },
    fullEdit: () => d.editInNewTab(type, id)
  };
}

const MODELS = { node: nodeModel, item: itemModel, lib: libModel };

/**
 * Opens the box beside `anchor` (a DOMRect-like { left, top, right, bottom }). Returns { close } or null.
 * `focus` = 'target' opens the click-action picker straight away (the 🖥 tool of a menu item).
 */
export function openQuickEdit(d, anchor, subject, { focus = '' } = {}) {
  closeQuickEdit();
  const model = MODELS[subject.kind]?.(d, subject);
  if (!model) { toast('This item can not be edited here: open it in its designer', 'info'); return null; }
  let base = model.read(), draft = JSON.parse(JSON.stringify(base)), busy = false, closed = false;
  const dirty = () => changedKeys(base, draft).length > 0;
  const has = f => model.fields.includes(f);

  const box = h('div', { class: 'qe-box', role: 'dialog', 'aria-label': `Quick edit ${model.title()}`, dataset: { kind: subject.kind } });
  const status = h('span', { class: 'qe-status' });
  const resetBtn = h('button', { class: 'btn small', type: 'button', dataset: { act: 'qe-reset' }, title: 'Put back the values of the last save' }, 'Reset');
  const saveBtn = h('button', { class: 'btn small primary', type: 'button', dataset: { act: 'qe-save' }, title: 'Store these values' }, 'Save');
  const titleEl = h('span', { class: 'qe-title' });
  const inputs = {};
  const field = (key, label, el, note) => h('label', { class: 'qe-field', title: note || '' }, h('span', {}, label), el);
  const text = (key, ph = '') => { const i = h('input', { type: 'text', placeholder: ph, dataset: { f: `qe-${key}` } }); i.addEventListener('input', () => change({ [key]: i.value })); inputs[key] = i; return i; };

  const typeBtn = h('button', { class: 'btn small qe-pick', type: 'button', dataset: { f: 'qe-type' } });
  const iconBtn = h('button', { class: 'btn small qe-pick', type: 'button', dataset: { f: 'qe-icon' } });
  const targetBtn = h('button', { class: 'btn small qe-pick', type: 'button', dataset: { f: 'qe-target' } });
  const dev = h('textarea', { rows: 3, placeholder: 'What the dev team must implement', dataset: { f: 'qe-descriptionDev' } });
  dev.addEventListener('input', () => change({ descriptionDev: dev.value }));

  // target names: screens are not part of the loaded library, and a target can live in another project
  const screens = new Map(), elements = new Map();
  api.list('screen', '', { includePublic: true }).then(l => { for (const x of l.items || l || []) screens.set(Number(x.id), x); if (!closed) paint(); }).catch(() => {});
  const nameOf = (type, id) => { const r = id == null ? null : findDesign(type, id); return r ? (r.label || r.name || r.key) : id == null ? '' : `#${id}`; };
  const paint = () => {
    titleEl.textContent = `✎ ${model.title()}`;
    for (const [k, i] of Object.entries(inputs)) if (document.activeElement !== i) i.value = draft[k] ?? '';
    if (document.activeElement !== dev) dev.value = draft.descriptionDev ?? '';
    if (model.typeKind === 'item') {
      iconBtn.textContent = draft.iconId ? `Icon: ${nameOf('icon', draft.iconId)}` : 'Icon: none';
      typeBtn.textContent = draft.refButtonId ? `Button: ${nameOf('button', draft.refButtonId)}` : 'Button: plain circle';
    } else if (model.typeKind) typeBtn.textContent = `${model.typeKind === 'icon' ? 'Icon' : 'Button'}: ${nameOf(model.typeKind, draft.refId)}`;
    const other = model.otherAction();
    targetBtn.textContent = (draft.target.screenId == null && draft.target.elementId == null && other)
      ? `⚡ ${other} (click to replace)`
      : targetSummary(draft.target.screenId, draft.target.elementId, { screen: screens.get(Number(draft.target.screenId)), element: elements.get(Number(draft.target.elementId)) }, draft.action || '').replace('Choose screen, popup element or repeater…', 'Nothing: choose a screen or popup…');
    targetBtn.title = targetBtn.textContent;
    const dty = dirty();
    status.textContent = busy ? 'Saving…' : dty ? '● Not saved' : '✓ Saved';
    status.classList.toggle('dirty', dty);
    resetBtn.disabled = !dty || busy; saveBtn.disabled = !dty || busy;
  };
  const rerender = () => { d.renderStage(); };
  let applying = Promise.resolve();
  const change = patch => {
    Object.assign(draft, patch);
    paint();
    applying = applying.then(() => model.apply(draft)).then(() => { if (!closed) rerender(); }).catch(e => toast(e.message, 'error'));
    return applying;
  };

  iconBtn.addEventListener('click', async () => { const r = await pickIcon(draft.iconId); if (r !== null) change({ iconId: r || null }); });
  typeBtn.addEventListener('click', async () => {
    if (model.typeKind === 'item') { const r = await pickButton(draft.refButtonId, subject.buttonId); if (r !== null) change({ refButtonId: r || null }); return; }
    const r = model.typeKind === 'icon' ? await pickIcon(draft.refId) : await pickButton(draft.refId);
    if (r === null) return;
    if (!r) return toast(`A placed ${model.typeKind} needs a ${model.typeKind}: remove it in the designer instead`, 'info');
    await ensureDesignDeps({ nodes: [{ kind: 'instance', refType: model.typeKind, refId: r }] }).catch(() => {});
    change({ refId: r, label: findDesign(model.typeKind, r)?.label || '' });
  });
  const chooseTarget = async () => {
    const r = await pickTarget({ currentScreenId: draft.target.screenId, currentElementId: draft.target.elementId, currentAction: draft.action || '', projectId: model.projectId(), allowCreate: false });
    const p = await targetPatch(r, model.projectId());
    if (!p) return;
    if (p.action === 'scroll-repeater' && subject.kind !== 'item') return toast('Scrolling a repeater is a menu item action', 'info');
    if (p.target) (p.type === 'screen' ? screens : elements).set(Number(p.target.id), p.target);
    change({ target: { screenId: p.targetScreenId, elementId: p.targetElementId }, ...(subject.kind === 'item' && p.action !== undefined ? { action: p.action } : {}) });
  };
  targetBtn.addEventListener('click', chooseTarget);

  resetBtn.addEventListener('click', async () => { draft = JSON.parse(JSON.stringify(base)); await change({}); toast('Back to the saved values', 'ok', 1400); });
  saveBtn.addEventListener('click', async () => {
    if (busy || !dirty()) return;
    busy = true; paint();
    try {
      await applying;
      await model.save(draft, base);
      base = JSON.parse(JSON.stringify(draft));
      toast(`Saved ${model.title()}`, 'ok', 1600);
    } catch (e) { toast(e.message, 'error'); }
    busy = false; paint();
  });

  const close = () => {
    if (closed) return;
    const lost = dirty();
    closed = true; current = null;
    box.remove(); document.removeEventListener('keydown', onKey, true);
    if (lost) { model.apply(base).then(rerender).catch(() => {}); toast('Quick edit closed: unsaved changes dropped', 'info', 2000); }
  };
  const onKey = e => { if (e.key === 'Escape' && box.isConnected && box === box.parentElement.lastElementChild) { e.stopPropagation(); close(); } };

  box.append(
    h('div', { class: 'qe-head' }, titleEl,
      h('button', { class: 'icon-btn', type: 'button', title: 'Open in its designer (new tab) for everything else', dataset: { act: 'qe-full' }, onclick: () => model.fullEdit() }, '↗'),
      h('button', { class: 'icon-btn', type: 'button', title: 'Close', dataset: { act: 'qe-close' }, onclick: close }, '✕')),
    h('div', { class: 'qe-body' },
      has('label') ? field('label', 'Label / title', text('label', 'Shown to users'), model.labelNote) : null,
      has('name') ? field('name', 'Variable name', text('name', 'variable-name'), model.nameNote) : null,
      has('type') && model.typeKind === 'item' ? h('div', { class: 'qe-field' }, h('span', {}, 'Icon / button type'), h('div', { class: 'qe-row' }, iconBtn, typeBtn)) : null,
      has('type') && model.typeKind && model.typeKind !== 'item' ? h('div', { class: 'qe-field' }, h('span', {}, `${model.typeKind === 'icon' ? 'Icon' : 'Button'} type`), typeBtn) : null,
      has('target') ? h('div', { class: 'qe-field' }, h('span', {}, 'When clicked (screen or popup)'), targetBtn) : null,
      has('tip') ? field('tip', 'Mouse-over label', text('tip', 'Shown on hover')) : model.tipNote ? h('div', { class: 'qe-note' }, model.tipNote) : null,
      has('descriptionDev') ? h('label', { class: 'qe-field' }, h('span', {}, 'description-dev'), dev) : null),
    h('div', { class: 'qe-foot' }, status, h('span', { class: 'grow' }), resetBtn, saveBtn));
  box.addEventListener('pointerdown', e => e.stopPropagation());
  (document.getElementById('modal-root') || document.body).append(box);
  paint();                                              // filled in before it is measured
  const size = { w: box.offsetWidth || 300, h: box.offsetHeight || 360 };
  const at = placeBox(anchor, size, { w: window.innerWidth, h: window.innerHeight });
  Object.assign(box.style, { left: `${at.left}px`, top: `${at.top}px` });
  document.addEventListener('keydown', onKey, true);

  // the box goes with the screen it edits: another screen (a followed route, Back, Restart) or a closed test window closes it
  if (!d._qeHooked) {
    d._qeHooked = true;
    d.on('loaded', () => { if (current?.d === d) current.close(); });
  }
  const gone = new MutationObserver(() => { if (!d.root.isConnected || !d.actionsLive) { gone.disconnect(); close(); } });
  gone.observe(document.body, { childList: true, subtree: true });

  current = { d, close, reapply: () => (dirty() ? model.apply(draft) : Promise.resolve()) };
  if (focus === 'target' && has('target')) chooseTarget();
  else setTimeout(() => (inputs.label || inputs.name)?.focus(), 30);
  return current;
}

/** A re-read of the tested design (live sync) keeps showing the values being edited. */
export function reapplyQuickEdit(d) { return current?.d === d ? current.reapply() : Promise.resolve(); }
