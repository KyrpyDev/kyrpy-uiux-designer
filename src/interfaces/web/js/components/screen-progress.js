/**
 * On-Screen Progress Bar HUD (`#ud-screen-progress`) for runtime AI generation,
 * multi-screen FlowChart materialization, and model downloads.
 * Stays visible at the top of the Designer screen (even above/beside modals) with:
 *   - Smooth animated 0–100% progress bar (`role="progressbar"`),
 *   - Asymptotic thinking ticker while deep-reasoning frontier models (`gemini-4-carbon`, etc.) think,
 *   - Step counter (`Step 2 / 4`) for multi-screen builds,
 *   - Live elapsed timer (`00:06.2s`) and `✕ Cancel` (`AbortController`).
 */
import { h } from '../dom.js';

let activeHud = null;

export function startScreenProgress({
  title = '✨ AI Generating…',
  detail = 'Preparing request…',
  badge = '',
  initialPct = 8,
  totalSteps = 1,
  cancellable = true
} = {}) {
  if (activeHud) activeHud.close();

  const abortCtl = new AbortController();
  let pct = Math.max(0, Math.min(100, Number(initialPct) || 8));
  let curStep = 1;
  let maxSteps = Math.max(1, Number(totalSteps) || 1);
  let finished = false;
  const startedAt = performance.now();

  const titleEl = h('span', { class: 'sp-title' }, title);
  const badgeEl = h('span', { class: 'sp-badge', hidden: !badge }, badge);
  const stepEl = h('span', { class: 'sp-step', hidden: maxSteps <= 1 }, `1 / ${maxSteps}`);
  const pctEl = h('span', { class: 'sp-pct' }, `${Math.round(pct)}%`);
  const timeEl = h('span', { class: 'sp-time' }, '0.0s');
  const detailEl = h('div', { class: 'sp-detail' }, detail);

  const fillEl = h('div', { class: 'sp-bar-fill', style: { width: `${pct}%` } });
  const barEl = h('div', {
    class: 'sp-bar-track',
    role: 'progressbar',
    'aria-label': title,
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(Math.round(pct))
  }, fillEl);

  const cancelBtn = cancellable
    ? h('button', {
        type: 'button',
        class: 'btn sm sp-cancel-btn',
        dataset: { act: 'cancel-screen-progress' },
        title: 'Cancel in-flight operation',
        onclick: () => {
          if (finished) return;
          abortCtl.abort(new Error('Cancelled by user'));
          fail('Cancelled');
        }
      }, '✕ Cancel')
    : null;

  const hud = h('div', {
    id: 'ud-screen-progress',
    class: 'sp-hud state-running',
    role: 'status',
    'aria-live': 'polite'
  },
    h('div', { class: 'sp-row-top' },
      h('div', { class: 'sp-left' },
        h('span', { class: 'sp-spinner', 'aria-hidden': 'true' }),
        titleEl,
        badgeEl,
        stepEl
      ),
      h('div', { class: 'sp-right' },
        pctEl,
        timeEl,
        cancelBtn
      )
    ),
    barEl,
    detailEl
  );

  document.body.append(hud);

  const syncDom = () => {
    const clamped = Math.max(0, Math.min(100, pct));
    const rounded = Math.round(clamped);
    fillEl.style.width = `${clamped}%`;
    barEl.setAttribute('aria-valuenow', String(rounded));
    pctEl.textContent = `${rounded}%`;
    const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
    timeEl.textContent = `${secs}s`;
  };

  // Smooth asymptotic progress creep up to 88% while waiting on frontier LLM reasoning
  const timer = setInterval(() => {
    if (finished) return;
    const ceiling = maxSteps > 1 ? Math.min(92, (curStep / maxSteps) * 90) : 88;
    if (pct < ceiling) {
      const remaining = ceiling - pct;
      pct += Math.max(0.35, remaining * 0.065);
    }
    syncDom();
  }, 200);

  let fadeTimeout = null;

  const close = () => {
    finished = true;
    clearInterval(timer);
    if (fadeTimeout) clearTimeout(fadeTimeout);
    hud.remove();
    if (activeHud === api) activeHud = null;
  };

  const update = (patch = {}) => {
    if (finished) return;
    if (patch.title) titleEl.textContent = patch.title;
    if (patch.badge !== undefined) {
      badgeEl.textContent = patch.badge || '';
      badgeEl.hidden = !patch.badge;
    }
    if (patch.totalSteps !== undefined) maxSteps = Math.max(1, Number(patch.totalSteps) || 1);
    if (patch.step !== undefined) curStep = Math.max(1, Math.min(maxSteps, Number(patch.step) || 1));
    stepEl.hidden = maxSteps <= 1;
    if (maxSteps > 1) stepEl.textContent = `${curStep} / ${maxSteps}`;
    if (patch.detail) detailEl.textContent = patch.detail;
    if (typeof patch.pct === 'number' && Number.isFinite(patch.pct)) {
      pct = Math.max(pct, Math.min(99, patch.pct));
    }
    syncDom();
  };

  const complete = (doneMsg = '✓ Completed!') => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    pct = 100;
    hud.className = 'sp-hud state-done';
    if (cancelBtn) cancelBtn.hidden = true;
    detailEl.textContent = doneMsg;
    syncDom();
    fadeTimeout = setTimeout(close, 1400);
  };

  const fail = (errMsg = 'Failed') => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    hud.className = 'sp-hud state-error';
    if (cancelBtn) cancelBtn.textContent = 'Dismiss';
    if (cancelBtn) cancelBtn.onclick = close;
    detailEl.textContent = errMsg;
    syncDom();
    fadeTimeout = setTimeout(close, 3600);
  };

  const api = {
    el: hud,
    signal: abortCtl.signal,
    get pct() { return Math.round(pct); },
    update,
    complete,
    fail,
    close
  };
  activeHud = api;
  return api;
}
