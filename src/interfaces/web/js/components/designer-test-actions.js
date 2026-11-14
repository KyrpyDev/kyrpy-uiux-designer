/**
 * Interactive "Test actions" engine for the Designer canvas (`button`, `element`, and `screen` designers).
 * Supports:
 *  - Buttons: radial/popup button menus (`bindMenus`), button animations, press feedback, and button events.
 *  - Elements: interactive HTML elements (edit forms, inputs, checkboxes, toggles, sliders, steppers, ratings,
 *    tabs, accordions, flip-boxes, choice chips, multi-choice, dropdowns, audio player, calendar, color picker)
 *    plus element events (`popup`, `drawer`, `toolbar`, `screen`, `animate`, `toggle`, `back`).
 *  - Screens: live interactive edit forms, clickable buttons & elements, animations, popups/drawers/toolbars,
 *    and full workflow link routing (`workflow_links` with `fromNodeId` or screen-level links).
 */
import { h, clear, toast } from '../dom.js';
import { api } from '../api.js';
import { state, findDesign } from '../state.js';
import { nodeBBox, isCarouselContainerNode, getContainerConfig, fitNodesToScreen } from '/domain/geometry.js';
import { DEVICES } from '/domain/entities.js';
import { openQuickEdit, reapplyQuickEdit } from './live-quick-edit.js';

const FORM_ELEMENT_KEYS = new Set([
  'html-input',
  'html-password-input',
  'html-number-input',
  'html-date-input',
  'html-textarea',
  'html-select',
  'html-search-bar',
  'html-form'
]);

/** The ✎ edit pills of the live test are a per-viewer setting (on by default). */
const LIVE_PILLS_KEY = 'ud_live_edit_pills';
export function livePillsShown() { try { return localStorage.getItem(LIVE_PILLS_KEY) !== '0'; } catch { return true; } }
function setLivePills(on) { try { localStorage.setItem(LIVE_PILLS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } }

export function installTestActions(Designer) {
  const proto = Designer.prototype;

  /** Toggles interactive "Test actions" mode on or off for button, element, or screen designers. */
  proto.setTestActions = function (v) {
    const on = !!v;
    this.actionsLive = on;
    if (this.type === 'button') {
      this.menuLive = on;
      this.menu.menuState = on ? { open: false, path: [] } : { open: true, path: [] };
    }
    if (on) {
      state.playAnimations = true;
      this.vtx?.exit();
      this.pen?.cancel?.();
      this.clearSelection();
    } else {
      this.closePreview();
    }
    this.root.classList.toggle('actions-live', on);
    if (this.pathBar) this.pathBar.hidden = on;
    this.stage.classList.toggle('menu-live', !!(this.menuLive || this.actionsLive));
    this.buildBar();
    this.renderStage();
    this.renderOverlay();
    requestAnimationFrame(() => this.fit());
  };

  /** Replays all CSS keyframe animations on the current stage and triggers click/hover animated nodes. */
  proto.replayAllAnimations = function () {
    state.playAnimations = true;
    this.renderStage();
    const animEls = [...this.stage.querySelectorAll('[class*="ud-e"]')];
    if (animEls.length) {
      for (const el of animEls) {
        el.classList.add('ud-on');
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      }
      toast(`✨ Replayed ${animEls.length} animation(s) on "${this.doc?.name || ''}"`, 'ok', 1600);
    } else {
      const svgEl = this.stage.querySelector('svg');
      if (svgEl) {
        svgEl.animate(
          [
            { transform: 'scale(1)', filter: 'brightness(1)' },
            { transform: 'scale(1.025)', filter: 'brightness(1.18)' },
            { transform: 'scale(1)', filter: 'brightness(1)' }
          ],
          { duration: 420, easing: ' cubic-bezier(.2,.8,.2,1)' }
        );
      }
      toast(`✨ Triggered live animation preview on "${this.doc?.name || ''}"`, 'info', 1500);
    }
  };

  /** Routes to a target screen ID while keeping Test actions mode active. */
  proto.navigateLiveToScreen = async function (targetScreenId, label = '') {
    const tr = this.opts.testRunner;
    if (targetScreenId == null || targetScreenId === '') return toast(`${label ? `${label}: ` : ''}no target screen set`, 'info', 2200);
    const screens = await api.list('screen');
    const s = screens.find(x => Number(x.id) === Number(targetScreenId) || x.key === String(targetScreenId));
    if (!s) return toast('Target screen no longer exists', 'error');
    // design test (button / screen): the route is announced, the screen stays; workflow test: it is followed
    if (tr?.mode === 'notify') return toast(`🔗 ${label ? `${label} → ` : ''}would go to “${s.name}” (test the workflow to follow routes)`, 'info', 2600);
    toast(`🔗 ${label ? `${label} → ` : '→ '}${s.name}`, 'ok', 1800);
    this._keepActionsLive = true;
    return this.opts.openDesign?.('screen', s.id);
  };

  /** Expands a small node's bbox (e.g. a <text> or <use> icon inside a button) to its enclosing button/pill <rect> if present. */
  proto.expandToButtonBox = function (node, baseBox) {
    if (!node || !baseBox) return baseBox;
    if (node.tag !== 'text' && node.tag !== 'use') return baseBox;
    const cx = baseBox.x + baseBox.w / 2;
    const cy = baseBox.y + baseBox.h / 2;
    let best = null;
    for (const cand of this.nodes) {
      if (cand.id === node.id || cand.visible === false) continue;
      if (cand.tag !== 'rect' || cand.role === 'bg' || cand.role === 'bg-glow') continue;
      const cb = nodeBBox(cand, this.nodes);
      // Must enclose (cx, cy) and be a button/pill/row sized rect (not a full-screen background)
      if (cb.w > this.doc.width * 0.92 && cb.h > 140) continue;
      if (cb.h > 120) continue;
      if (cx >= cb.x - 4 && cx <= cb.x + cb.w + 4 && cy >= cb.y - 4 && cy <= cb.y + cb.h + 4) {
        // Do not expand a single tab text to a multi-tab segmented bar that holds 2+ distinct text labels
        const textsInside = this.nodes.filter(t => {
          if (t.visible === false || t.tag !== 'text') return false;
          const tb = nodeBBox(t, this.nodes);
          const tcx = tb.x + tb.w / 2, tcy = tb.y + tb.h / 2;
          return tcx >= cb.x && tcx <= cb.x + cb.w && tcy >= cb.y && tcy <= cb.y + cb.h;
        });
        if (textsInside.length >= 2 && cb.w > 180) continue;
        if (!best || cb.w * cb.h < best.w * best.h) best = cb;
      }
    }
    return best || {
      x: Math.max(0, Math.min(baseBox.x - 14, cx - 48)),
      y: Math.max(0, Math.min(baseBox.y - 8, cy - 18)),
      w: Math.max(96, baseBox.w + 28),
      h: Math.max(36, baseBox.h + 16)
    };
  };

  /** The menu element (`.ud-btn` item or centre) under a pointer event on the live layer, or null. */
  proto.menuUnder = function (ev) {
    if (!this.liveLayer || ev.clientX == null) return null;
    const prev = this.liveLayer.style.visibility;
    this.liveLayer.style.visibility = 'hidden';
    let t = null;
    try { t = document.elementFromPoint(ev.clientX, ev.clientY); } finally { this.liveLayer.style.visibility = prev; }
    return t && this.stage.contains(t) && t.closest?.('.ud-btn') ? t : null;
  };

  /** Re-dispatches a hotspot click to the menu under it; true when a menu took it. */
  proto.forwardToMenu = function (ev) {
    const t = this.menuUnder(ev);
    if (!t) return false;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY }));
    return true;
  };

  /** URL that opens a design (and optionally a menu item of a button) in the designer, e.g. in a new browser tab. */
  proto.designUrl = function (type, id, extra = {}) {
    const q = new URLSearchParams({ open: `${type}:${id}`, ...extra });
    return `${location.origin}${location.pathname}?${q}`;
  };

  /** Opens a design in a new browser tab to edit it while this tab keeps testing; the edits come back through the sync event. */
  proto.editInNewTab = function (type, id, extra = {}) {
    const w = window.open(this.designUrl(type, id, extra), '_blank');
    if (!w) toast('The browser blocked the new tab: allow pop-ups for this site', 'error');
    else toast('Editing in a new tab: saved changes show up here at once', 'info', 2200);
  };

  /**
   * Small ✎ pills over every placed button / element / icon (and every menu) of the tested design. A pill opens the quick
   * edit box beside the item (basic values, applied to the running test at once); the box has ↗ for the full designer.
   */
  proto.mountLiveEditPills = function () {
    const pill = (box, title, onClick) => {
      const b = h('button', { type: 'button', class: 'dz-live-edit', title, 'aria-label': title,
        style: { left: `${Math.round(box.x + box.w - 6)}px`, top: `${Math.round(box.y - 10)}px` } }, '✎');
      b.addEventListener('pointerdown', ev => ev.stopPropagation());
      b.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); onClick(b.getBoundingClientRect()); });
      this.liveLayer.append(b);
    };
    const seen = new Set();
    for (const n of this.nodes) {
      if (n.visible === false || n.kind !== 'instance' || !['button', 'element', 'icon'].includes(n.refType)) continue;
      const lib = findDesign(n.refType, n.refId);
      if (!lib) continue;
      seen.add(`${n.refType}:${n.refId}`);
      pill(nodeBBox(n, this.nodes), `Quick edit ${n.refType} “${lib.label || lib.name}”`, at => openQuickEdit(this, at, { kind: 'node', nodeId: n.id }));
    }
    // menu buttons nested inside placed elements: one pill per menu, at its place on the canvas
    const sr = this.stage.getBoundingClientRect(), k = sr.width / (this.doc.width || 1) || 1;
    for (const el of this.stage.querySelectorAll('.ud-btn[data-btn-id]')) {
      const id = Number(el.getAttribute('data-btn-id'));
      if (!id || seen.has(`button:${id}`) || (this.type === 'button' && id === this.doc.id)) continue;
      seen.add(`button:${id}`);
      const r = (el.querySelector('.rm-hit') || el).getBoundingClientRect();
      const lib = findDesign('button', id);
      pill({ x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k }, `Quick edit menu button “${lib?.label || lib?.name || el.getAttribute('data-menu')}”`, at => openQuickEdit(this, at, { kind: 'lib', type: 'button', id }));
    }
  };

  /**
   * While testing, hovering a menu item shows a small toolbar: ✎ quick edit (label, icon, button, action …), 🖥 choose the
   * screen / popup it opens, ↗ the item in its button's designer (new tab). This is how a workflow is edited while it runs.
   */
  proto.installLiveItemPill = function () {
    if (this._liveItemPill) return;
    let hideT = null, cur = null;
    const tool = (txt, title, act, fn) => h('button', { type: 'button', class: 'dz-live-edit', title, 'aria-label': title, dataset: { act },
      onclick: ev => { ev.stopPropagation(); if (cur) fn(cur, tip.getBoundingClientRect()); tip.hidden = true; } }, txt);
    const editBtn = tool('✎', 'Quick edit this menu item', 'item-quick', (c, at) => openQuickEdit(this, at, { kind: 'item', buttonId: c.btnId, itemId: c.itemId }));
    const tip = h('div', { class: 'dz-live-item-edit', role: 'toolbar', 'aria-label': 'Menu item tools', hidden: true },
      editBtn,
      tool('🖥', 'Choose the screen or popup this item opens', 'item-target', (c, at) => openQuickEdit(this, at, { kind: 'item', buttonId: c.btnId, itemId: c.itemId }, { focus: 'target' })),
      tool('↗', 'Edit this menu item in its button designer (new tab)', 'item-full', c => this.editInNewTab('button', c.btnId, { item: c.itemId })));
    document.body.append(tip);
    this._liveItemPill = tip;
    const hide = () => { clearTimeout(hideT); hideT = setTimeout(() => { tip.hidden = true; cur = null; }, 700); };
    tip.addEventListener('mouseenter', () => clearTimeout(hideT));
    tip.addEventListener('mouseleave', hide);
    this.stage.addEventListener('mouseleave', hide);
    // the toolbar lives on <body>: it goes with this designer (e.g. a test window that closes)
    if (this.opts.modal) {
      const gone = new MutationObserver(() => { if (!this.root.isConnected) { tip.remove(); gone.disconnect(); } });
      gone.observe(document.getElementById('modal-root') || document.body, { childList: true });
    }
    const showFor = target => {
      if (!this.actionsLive || !livePillsShown()) return hide();
      const it = target?.closest?.('.rm-item[data-menu-id]');
      const btnEl = it?.closest('.ud-btn[data-btn-id]');
      if (!it || !btnEl || it.getAttribute('data-hub-pos') === 'hidden') return hide();
      clearTimeout(hideT);
      cur = { btnId: Number(btnEl.getAttribute('data-btn-id')), itemId: Number(it.getAttribute('data-menu-id')) };
      const r = it.getBoundingClientRect();
      editBtn.textContent = `✎ ${it.querySelector('title')?.textContent || 'item'}`;
      Object.assign(tip.style, { left: `${Math.round(r.right - 4)}px`, top: `${Math.round(r.top - 14)}px` });
      tip.hidden = false;
    };
    this.stage.addEventListener('mouseover', ev => showFor(ev.target));
    // a route / event hotspot often lies over a menu (a hub bar on a screen): the item under the pointer is looked up through it
    let moveQueued = false;
    this.liveLayer.addEventListener('mousemove', ev => {
      if (moveQueued || !ev.target.closest?.('.dz-live-hotspot')) return;
      moveQueued = true;
      requestAnimationFrame(() => { moveQueued = false; showFor(this.menuUnder(ev)); });
    });
    this.liveLayer.addEventListener('mouseleave', hide);
  };

  /** Mouse-over labels of placed items (the quick edit box sets them): shown as the native hover text in the test. */
  proto.applyLiveHoverLabels = function () {
    for (const n of this.nodes) {
      const tipText = n.attrs?.['data-tip'];
      const el = tipText ? this.stage.querySelector(`[data-el="${n.id}"]`) : null;
      if (!el || el.querySelector(':scope > title')) continue;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = String(tipText);
      el.prepend(t);
    }
  };

  /** Builds the floating Test Actions HUD and the interactive overlay layer (`this.liveLayer`) over `this.stage`. */
  proto.renderLiveTestLayer = function () {
    if (!this.liveLayer || !this.liveHud) return;
    if (!this.actionsLive || !this.doc) {
      this.liveLayer.hidden = true;
      this.liveHud.hidden = true;
      clear(this.liveLayer);
      clear(this.liveHud);
      return;
    }

    this.liveFormValues ??= new Map();
    const d = this.doc;
    clear(this.liveLayer);
    clear(this.liveHud);
    this.liveLayer.hidden = false;
    this.liveHud.hidden = false;
    this.liveLayer.style.width = `${d.width}px`;
    this.liveLayer.style.height = `${d.height}px`;

    const seenLinks = new Set();
    const links = (Array.isArray(d.links) ? d.links : []).filter(l => {
      const k = `${l.fromScreenId}:${l.fromNodeId ?? ''}:${l.toScreenId}:${l.name || ''}`;
      if (seenLinks.has(k)) return false;
      seenLinks.add(k);
      return true;
    });

    // 1. Render Floating Test HUD at top of viewport
    const hudItems = [
      h('span', { class: 'dz-live-badge' }, `🟢 LIVE TEST · ${this.type.toUpperCase()}: ${d.name}`),
      this.opts.onBack
        ? h('button', {
            class: 'btn small',
            disabled: !(this.opts.canBack?.() ?? false),
            title: 'Go back to previous screen/design',
            onclick: () => this.opts.onBack()
          }, '← Back')
        : null,
      h('button', {
        class: 'btn small',
        title: 'Replay all animations on this design',
        onclick: () => this.replayAllAnimations()
      }, '✨ Animations')
    ];

    if (this.type === 'button' && d.menuItems?.length) {
      hudItems.push(
        h('button', {
          class: 'btn small primary',
          onclick: () => {
            const btnEl = this.stage.querySelector('.ud-btn');
            if (btnEl && this.menu?.ctl) {
              const cur = this.menu.ctl.get(btnEl);
              this.menu.ctl.set(btnEl, { open: !cur.open, path: [] });
            }
          }
        }, '🎯 Toggle Menu')
      );
    }

    // Add workflow routing pills to HUD for screens
    if (this.type === 'screen' && links.length) {
      hudItems.push(h('span', { class: 'sep-v' }), h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Routes:'));
      for (const l of links) {
        hudItems.push(
          h('button', {
            class: 'btn small dz-route-pill',
            title: l.descriptionDev || `Workflow route (${l.trigger || 'tap'})`,
            onclick: () => this.navigateLiveToScreen(l.toScreenId, l.name || 'Route')
          }, `🔗 ${l.name || `Screen #${l.toScreenId}`} →`)
        );
      }
    }

    const tr = this.opts.testRunner;
    // device menu of the test window: lays the screen out for another device for this test only (nothing is saved)
    if (tr && this.type === 'screen') {
      const devices = state.templateDevices?.length
        ? state.templateDevices.map(dv => ({ key: dv.key, name: dv.name, width: dv.width, height: dv.height }))
        : Object.entries(DEVICES).map(([k, v]) => ({ key: k, name: v.name, width: v.width, height: v.height }));
      const curKey = this._testDevice?.key || d.meta?.device;
      const cur = devices.find(x => x.key === curKey);
      const menu = this.toolMenu('monitor', 'Device: test this screen on another device (not saved)', () =>
        devices.map(dv => ['monitor', `${dv.key === curKey ? '✓ ' : ''}${dv.name} (${dv.width}×${dv.height})`, () => this.previewDevice(dv), 'Lay the screen out for this device in the test only']));
      menu.classList.add('text-menu', 'test-device-menu'); menu.dataset.act = 'test-device';
      menu.firstChild.replaceWith(h('span', { class: 'text-menu-label' }, cur ? cur.name : `${d.width}×${d.height}`));
      hudItems.push(menu);
    }
    if (tr) hudItems.push(
      h('span', { class: 'badge', title: tr.mode === 'navigate' ? 'Routes are followed: a full browsable app' : 'Routes only say where they would go' }, tr.mode === 'navigate' ? '🧭 Workflow: routes navigate' : '🔔 Design test: routes are announced'),
      h('button', { class: 'btn small', title: 'Start the test again from the beginning', onclick: () => tr.restart() }, '⟲ Restart'));
    hudItems.push(
      h('span', { class: 'grow' }),
      h('button', { class: `btn small${livePillsShown() ? ' primary' : ''}`, title: 'Show / hide the ✎ edit pills on the tested items (remembered in this browser)',
        onclick: () => { setLivePills(!livePillsShown()); this.renderLiveTestLayer(); } }, livePillsShown() ? '✎ Pills on' : '✎ Pills off'),
      h('button', { class: 'btn small', title: `Edit this ${this.type} in a new tab (saved edits show up here at once)`, onclick: () => this.editInNewTab(this.type, d.id) }, `✎ Edit ${this.type} ↗`),
      h('button', {
        class: 'btn small danger',
        title: tr ? 'Close the test window' : 'Exit Test actions mode and return to editing',
        onclick: () => (tr ? tr.close() : this.setTestActions(false))
      }, tr ? '✕ Close test' : '✕ Exit Test')
    );
    this.liveHud.append(...hudItems.filter(Boolean));

    // 2. Render Interactive Edit Form Inputs (`role === 'field'` or form/input elements)
    this.mountLiveFormInputs();

    // 3. Render Interactive HTML Widgets (`html-flip-box`, `html-toggle-switch`, `html-checkbox`, `html-slider`, etc.)
    this.mountLiveWidgets();

    // 4. Render Interactive Action, Button & Workflow Route Hotspots
    this.mountLiveActionHotspots(links);

    // 5. Edit pills: every placed item / menu (and menu items on hover) open their designer in a new tab
    if (livePillsShown()) this.mountLiveEditPills();
    this.installLiveItemPill();
    this.applyLiveHoverLabels();
  };

  /**
   * Test window: shows the open screen on another device. The frame takes the device size and the contents are laid
   * out responsively (fitNodesToScreen), in memory only — the saved screen keeps its own device.
   */
  proto.previewDevice = function (dv) {
    if (!this.doc || !dv) return;
    const attrs = new Map(fitNodesToScreen(this.nodes, { w: this.doc.width || 1, h: this.doc.height || 1 }, { w: dv.width, h: dv.height }).map(p => [p.id, p.attrs]));
    const nodes = this.nodes.map(n => (attrs.has(n.id) ? { ...n, attrs: attrs.get(n.id) } : n));
    this.doc = { ...this.doc, nodes, width: dv.width, height: dv.height };
    this._testDevice = dv;
    this.renderStage();
    this.fitted = false; this.fit();
  };

  /** Mounts real HTML <input>, <textarea>, and <select> controls over form fields in `this.liveLayer`. */
  proto.mountLiveFormInputs = function () {
    const d = this.doc;
    const fieldRects = [];

    // Find all `<rect role="field">` nodes that are leaf input boxes (not large form background containers or tab bars)
    const rawFields = this.nodes.filter(n => n.visible !== false && n.tag === 'rect' && n.role === 'field');
    const linkedNodeIds = new Set((d.links || []).map(l => l.fromNodeId).filter(Boolean));

    for (const r of rawFields) {
      const b = nodeBBox(r, this.nodes);
      if (b.w < 48 || b.h < 20 || b.h > 130) continue;
      // Skip if this rect encloses another `role="field"` rect
      const wrapsAnotherField = rawFields.some(other => {
        if (other.id === r.id) return false;
        const ob = nodeBBox(other, this.nodes);
        return ob.x >= b.x - 2 && ob.y >= b.y - 2 && ob.x + ob.w <= b.x + b.w + 2 && ob.y + ob.h <= b.y + b.h + 2;
      });
      if (wrapsAnotherField) continue;

      // Skip if this rect encloses a workflow-linked tab text (e.g. Sign in / Sign up / Google segmented control)
      const textsInside = this.nodes.filter(t => {
        if (t.visible === false || t.tag !== 'text') return false;
        const tb = nodeBBox(t, this.nodes);
        const cx = tb.x + tb.w / 2, cy = tb.y + tb.h / 2;
        return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
      });
      if (textsInside.some(t => linkedNodeIds.has(t.id)) || textsInside.length >= 3) continue;

      // Also skip if this rect is actually a clickable button (like "Google ile Doğrudan Giriş" on Screen 66)
      const combinedText = textsInside.map(t => t.text || '').join(' ').toLowerCase();
      if (combinedText.includes('doğrudan giriş') || combinedText.includes('giriş yap') || combinedText.includes('kaydol')) continue;

      fieldRects.push({ node: r, box: b, textNode: textsInside[0] || null, kind: b.h >= 72 ? 'textarea' : 'input' });
    }

    // If we are inside the Element Designer for an input/textarea/select/search-bar element without `role="field"`, add its main box
    if (this.type === 'element' && !fieldRects.length && (FORM_ELEMENT_KEYS.has(d.key) || ['input', 'textarea', 'select'].includes(d.meta?.htmlTag))) {
      const mainRect = this.nodes.find(n => n.tag === 'rect' && n.role !== 'bg') || this.nodes[0];
      const b = mainRect ? nodeBBox(mainRect, this.nodes) : { x: 0, y: 0, w: d.width, h: d.height };
      const textNode = this.nodes.find(n => n.tag === 'text') || null;
      const kind = d.key === 'html-textarea' || d.meta?.htmlTag === 'textarea' ? 'textarea' : d.key === 'html-select' || d.meta?.htmlTag === 'select' ? 'select' : 'input';
      fieldRects.push({ node: mainRect || { id: 'el-root' }, box: b, textNode, kind, elementKey: d.key });
    }

    // Also check placed instances of form elements (`refType === 'element'`) on a Screen
    for (const inst of this.nodes.filter(n => n.visible !== false && n.kind === 'instance' && n.refType === 'element')) {
      const libEl = findDesign('element', inst.refId);
      if (!libEl) continue;
      if (!FORM_ELEMENT_KEYS.has(libEl.key) && !['input', 'textarea', 'select', 'form'].includes(libEl.meta?.htmlTag)) continue;
      const ib = nodeBBox(inst, this.nodes);
      const sx = ib.w / (libEl.width || ib.w || 1);
      const sy = ib.h / (libEl.height || ib.h || 1);
      const subFields = (libEl.nodes || []).filter(sn => sn.tag === 'rect' && (sn.role === 'field' || (sn.attrs?.height >= 24 && sn.attrs?.height <= 110)));
      if (subFields.length && libEl.key === 'html-form') {
        for (const sf of subFields) {
          const sb = nodeBBox(sf, libEl.nodes);
          if (sb.h > 100 || sb.w < 60) continue;
          fieldRects.push({
            node: inst,
            box: { x: ib.x + sb.x * sx, y: ib.y + sb.y * sy, w: sb.w * sx, h: sb.h * sy },
            textNode: null,
            kind: 'input',
            elementKey: libEl.key,
            fieldId: `${inst.id}-${sf.id}`
          });
        }
      } else {
        const kind = libEl.key === 'html-textarea' ? 'textarea' : libEl.key === 'html-select' ? 'select' : 'input';
        fieldRects.push({
          node: inst,
          box: ib,
          textNode: null,
          kind,
          elementKey: libEl.key,
          fieldId: `inst-${inst.id}`
        });
      }
    }

    for (const f of fieldRects) {
      const stateKey = `${this.type}:${d.id}:${f.fieldId || f.node.id}`;
      const rawInitial = f.textNode?.text || '';
      const isPassword = rawInitial.includes('••') || f.elementKey === 'html-password-input';
      const isDate = f.elementKey === 'html-date-input';
      const isNumber = f.elementKey === 'html-number-input';
      const savedVal = this.liveFormValues.get(stateKey);

      let control;
      if (f.kind === 'select') {
        control = h('select', { class: 'dz-live-input' },
          h('option', { value: 'Option 1' }, rawInitial || 'Select an option…'),
          h('option', { value: 'Option 2' }, 'Option 2 — Active'),
          h('option', { value: 'Option 3' }, 'Option 3 — Custom')
        );
      } else if (f.kind === 'textarea') {
        control = h('textarea', {
          class: 'dz-live-input',
          placeholder: rawInitial || 'Type here…',
          value: savedVal ?? rawInitial
        });
        control.value = savedVal ?? rawInitial;
      } else {
        control = h('input', {
          type: isPassword ? 'password' : isDate ? 'date' : isNumber ? 'number' : 'text',
          class: 'dz-live-input',
          placeholder: rawInitial || 'Enter value…',
          value: savedVal ?? (isPassword ? 'password123' : rawInitial)
        });
      }

      Object.assign(control.style, {
        left: `${Math.round(f.box.x)}px`,
        top: `${Math.round(f.box.y)}px`,
        width: `${Math.round(f.box.w)}px`,
        height: `${Math.round(f.box.h)}px`,
        borderRadius: `${Number(f.node.attrs?.rx) || 10}px`
      });

      // Hide the underlying static SVG text while the live HTML input overlay is displayed
      if (f.textNode) {
        const svgTxt = this.stage.querySelector(`[data-el="${f.textNode.id}"]`);
        if (svgTxt) svgTxt.style.opacity = '0';
      }

      control.addEventListener('pointerdown', ev => ev.stopPropagation());
      control.addEventListener('click', ev => ev.stopPropagation());
      control.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && f.kind !== 'textarea') {
          toast(`✓ Form input: "${control.value}"`, 'ok', 1400);
        }
      });
      control.addEventListener('input', () => {
        this.liveFormValues.set(stateKey, control.value);
        if (f.textNode) {
          const svgTxt = this.stage.querySelector(`[data-el="${f.textNode.id}"]`);
          if (svgTxt) svgTxt.textContent = control.value;
        }
      });

      this.liveLayer.append(control);
    }
  };

  /** Mounts interactive overlays for HTML widgets (`html-flip-box`, `html-toggle-switch`, `html-slider`, etc.). */
  proto.mountLiveWidgets = function () {
    const d = this.doc;
    const widgets = [];

    if (this.type === 'element') {
      widgets.push({ key: d.key, box: { x: 0, y: 0, w: d.width, height: d.height, h: d.height }, targetEl: this.stage.querySelector('svg'), id: `self-${d.id}` });
    }
    for (const inst of this.nodes.filter(n => n.visible !== false && n.kind === 'instance' && n.refType === 'element')) {
      const libEl = findDesign('element', inst.refId);
      if (!libEl) continue;
      const b = nodeBBox(inst, this.nodes);
      widgets.push({
        key: libEl.key,
        box: b,
        targetEl: this.stage.querySelector(`[data-el="${inst.id}"]`),
        id: `inst-${inst.id}`,
        node: inst
      });
    }

    for (const w of widgets) {
      if (w.key === 'html-flip-box') {
        const flipOverlay = h('div', {
          class: 'dz-live-widget dz-live-flip',
          title: 'Click to flip 3D card (Front ↔ Back)',
          style: { left: `${w.box.x}px`, top: `${w.box.y}px`, width: `${w.box.w}px`, height: `${w.box.h}px` }
        });
        const backCard = h('div', { class: 'dz-flip-back', hidden: true },
          h('strong', {}, 'Flip Box — Back Side'),
          h('span', {}, 'Interactive 3D card flipped! Click again to return to front.')
        );
        flipOverlay.append(backCard);
        flipOverlay.addEventListener('click', ev => {
          ev.stopPropagation();
          const flipped = flipOverlay.classList.toggle('flipped');
          flipOverlay.classList.toggle('is-flipped', flipped);
          backCard.hidden = !flipped;
          if (w.targetEl) {
            w.targetEl.style.transition = 'transform 0.45s cubic-bezier(.2,.8,.2,1)';
            w.targetEl.style.transformOrigin = 'center center';
            w.targetEl.classList.toggle('ud-on', flipped);
          }
          toast(flipped ? '🔄 Flip Box: Flipped to Back Side' : '🔄 Flip Box: Returned to Front Side', 'info', 1400);
        });
        this.liveLayer.append(flipOverlay);
      } else if (w.key === 'html-slider') {
        const range = h('input', {
          type: 'range',
          min: 0,
          max: 100,
          value: 62,
          class: 'dz-live-widget dz-live-slider',
          style: { left: `${w.box.x + 8}px`, top: `${w.box.y}px`, width: `${Math.max(60, w.box.w - 16)}px`, height: `${w.box.h}px` }
        });
        range.addEventListener('pointerdown', ev => ev.stopPropagation());
        range.addEventListener('input', ev => {
          ev.stopPropagation();
          const txt = (w.targetEl || this.stage).querySelector('text');
          if (txt) txt.textContent = `${range.value}%`;
        });
        range.addEventListener('change', () => toast(`🎚 Slider value: ${range.value}%`, 'info', 1200));
        this.liveLayer.append(range);
      } else if (['html-checkbox', 'html-checkbox-checked', 'html-radio', 'html-toggle-switch'].includes(w.key)) {
        let checked = w.key === 'html-checkbox-checked' || w.key === 'html-toggle-switch';
        const toggleBox = h('button', {
          type: 'button',
          class: `dz-live-widget dz-live-toggle${checked ? ' is-on' : ''}`,
          title: 'Click to toggle state',
          style: { left: `${w.box.x}px`, top: `${w.box.y}px`, width: `${w.box.w}px`, height: `${w.box.h}px` },
          onclick: ev => {
            ev.stopPropagation();
            checked = !checked;
            toggleBox.classList.toggle('is-on', checked);
            if (w.targetEl) w.targetEl.style.filter = checked ? 'brightness(1.2) drop-shadow(0 0 8px var(--accent))' : 'opacity(0.75)';
            toast(`${checked ? '✓ Enabled' : '○ Disabled'}: ${w.key.replace('html-', '')}`, 'ok', 1200);
          }
        });
        this.liveLayer.append(toggleBox);
      } else if (w.key === 'html-stepper-input') {
        let count = 3;
        const valSpan = h('span', { class: 'dz-stepper-val' }, String(count));
        const stepper = h('div', {
          class: 'dz-live-widget dz-live-stepper',
          style: { left: `${w.box.x}px`, top: `${w.box.y}px`, width: `${w.box.w}px`, height: `${w.box.h}px` }
        },
          h('button', { type: 'button', onclick: ev => { ev.stopPropagation(); count--; valSpan.textContent = String(count); toast(`Stepper: ${count}`, 'info', 1000); } }, '−'),
          valSpan,
          h('button', { type: 'button', onclick: ev => { ev.stopPropagation(); count++; valSpan.textContent = String(count); toast(`Stepper: ${count}`, 'info', 1000); } }, '+')
        );
        this.liveLayer.append(stepper);
      }
    }

    // Mount live 2D/3D horizontal & vertical roll controls for any Carousel Container nodes on the canvas
    for (const cNode of this.nodes.filter(n => n.visible !== false && isCarouselContainerNode(n, state.library.elements))) {
      const cfg = getContainerConfig(cNode, state.library.elements);
      const b = nodeBBox(cNode, this.nodes);
      let rollDeg = 0;
      const trackEl = this.stage.querySelector(`.ud-container-children[data-container-for="${cNode.id}"] .ud-carousel-track`)
        || this.stage.querySelector(`[data-el="${cNode.id}"]`);
      const applyRoll = dir => {
        rollDeg += dir * 120;
        if (trackEl) {
          trackEl.style.transition = 'transform 0.55s cubic-bezier(.2,.8,.2,1)';
          trackEl.style.transformOrigin = `${b.x + b.w / 2}px ${b.y + b.h / 2}px`;
          if (cfg.carouselDim === '3d') {
            trackEl.style.transform = cfg.carouselDir === 'vertical'
              ? `perspective(600px) rotateX(${rollDeg}deg)`
              : `perspective(600px) rotateY(${rollDeg}deg)`;
          } else {
            const shift = ((rollDeg / 120) % 3) * 14;
            trackEl.style.transform = cfg.carouselDir === 'vertical'
              ? `translateY(${shift}px)`
              : `translateX(${shift}px)`;
          }
        }
        toast(`🎠 Carousel ${cfg.carouselDim.toUpperCase()} ${cfg.carouselDir} roll`, 'info', 1100);
      };
      const ctrlBar = h('div', {
        class: 'dz-live-widget dz-live-carousel-bar',
        style: {
          position: 'absolute',
          left: `${Math.round(b.x + 8)}px`,
          top: `${Math.round(b.y + b.h - 32)}px`,
          width: `${Math.max(80, Math.round(b.w - 16))}px`,
          height: '26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          background: 'rgba(10,16,28,0.72)',
          borderRadius: '12px',
          pointerEvents: 'auto',
          zIndex: 12
        }
      },
        h('button', { type: 'button', class: 'btn small', style: { padding: '1px 7px', fontSize: '11px' }, onclick: ev => { ev.stopPropagation(); applyRoll(-1); } }, cfg.carouselDir === 'vertical' ? '▲ Roll' : '◀ Roll'),
        h('span', { class: 'muted', style: { fontSize: '10px' } }, `${cfg.carouselDim.toUpperCase()} · ${cfg.carouselDir}`),
        h('button', { type: 'button', class: 'btn small', style: { padding: '1px 7px', fontSize: '11px' }, onclick: ev => { ev.stopPropagation(); applyRoll(1); } }, cfg.carouselDir === 'vertical' ? '▼ Roll' : 'Roll ▶')
      );
      this.liveLayer.append(ctrlBar);
    }
  };

  /** Mounts interactive hotspots for node events, buttons, animations, and workflow routing links. */
  proto.mountLiveActionHotspots = function (links = []) {
    const usedBoxes = [];
    const addHotspot = ({ box, title, cls = '', onClick, onMouseOver, onRelease, onDblClick, onContextMenu }) => {
      if (!box || box.w <= 0 || box.h <= 0) return;
      const btn = h('button', {
        type: 'button',
        class: `dz-live-hotspot ${cls}`.trim(),
        title: title || 'Interactive action',
        'aria-label': title || 'Interactive action',
        style: {
          left: `${Math.round(box.x)}px`,
          top: `${Math.round(box.y)}px`,
          width: `${Math.round(box.w)}px`,
          height: `${Math.round(box.h)}px`
        }
      });
      btn.addEventListener('pointerdown', ev => ev.stopPropagation());
      if (onClick) {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          // a menu drawn under this hotspot gets the click (its own items / centre), not the hotspot's event
          if (this.forwardToMenu(ev)) return;
          btn.classList.remove('ud-pulse');
          void btn.offsetWidth;
          btn.classList.add('ud-pulse');
          onClick(ev);
        });
      }
      if (onMouseOver) btn.addEventListener('mouseenter', ev => onMouseOver(ev));
      if (onRelease) btn.addEventListener('mouseup', ev => onRelease(ev));
      if (onDblClick) btn.addEventListener('dblclick', ev => { ev.stopPropagation(); onDblClick(ev); });
      if (onContextMenu) btn.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); onContextMenu(ev); });
      usedBoxes.push(box);
      this.liveLayer.append(btn);
    };

    // 1. Node-level `events` and `onClick` on `this.nodes`
    for (const n of this.nodes) {
      if (n.visible === false) continue;
      const evs = [...(Array.isArray(n.events) ? n.events : [])];
      if (n.onClick && !evs.some(x => x.trigger === 'click')) {
        evs.push({ trigger: 'click', ...n.onClick });
      }
      // Also inherit events from library button/element if this is an instance without override events
      if (!evs.length && n.kind === 'instance' && ['button', 'element'].includes(n.refType)) {
        const libItem = findDesign(n.refType, n.refId);
        for (const ln of libItem?.nodes || []) {
          if (Array.isArray(ln.events)) evs.push(...ln.events);
          else if (ln.onClick) evs.push({ trigger: 'click', ...ln.onClick });
        }
      }
      if (!evs.length) continue;

      // Do not cover a button that has its own radial/popup `.ud-btn` menu unless it also has explicit events
      if (n.kind === 'instance' && n.refType === 'button') {
        const libBtn = findDesign('button', n.refId);
        if (libBtn?.menuItems?.length && !n.events?.length && !n.onClick) continue;
      }

      const rawBox = nodeBBox(n, this.nodes);
      const box = this.expandToButtonBox(n, rawBox);
      const clickEv = evs.find(x => x.trigger === 'click' || x.trigger === 'mousedown');
      const overEv = evs.find(x => x.trigger === 'mouseover');
      const relEv = evs.find(x => x.trigger === 'release' || x.trigger === 'drop');
      const dblEv = evs.find(x => x.trigger === 'dblclick');
      const ctxEv = evs.find(x => x.trigger === 'rightclick');

      addHotspot({
        box,
        cls: 'is-event',
        title: `${n.name || n.tag}: ${evs.map(e => `${e.trigger} → ${e.type}`).join(', ')}`,
        onClick: clickEv ? () => this.runAction(n, clickEv) : null,
        onMouseOver: overEv ? () => this.runAction(n, overEv) : null,
        onRelease: relEv ? () => this.runAction(n, relEv) : null,
        onDblClick: dblEv ? () => this.runAction(n, dblEv) : null,
        onContextMenu: ctxEv ? () => this.runAction(n, ctxEv) : null
      });
    }

    // 2. Workflow links with `fromNodeId != null`
    const routedNodes = new Set();
    for (const l of links.filter(x => x.fromNodeId != null)) {
      const n = this.byId(l.fromNodeId);
      if (!n || n.visible === false) continue;
      // a menu button's routes belong to its menu items (the menu runs them): a box over it would hide and block the menu
      if (n.kind === 'instance' && n.refType === 'button' && findDesign('button', n.refId)?.menuItems?.length) continue;
      if (routedNodes.has(n.id)) continue;     // one box per node (more links from it are listed in the Routes bar)
      routedNodes.add(n.id);
      const rawBox = nodeBBox(n, this.nodes);
      const box = this.expandToButtonBox(n, rawBox);
      addHotspot({
        box,
        cls: 'is-route',
        title: `🔗 ${l.name || 'Navigate'} (${l.trigger || 'tap'})`,
        onClick: () => this.navigateLiveToScreen(l.toScreenId, l.name)
      });
    }

    // 3. Screen-level Workflow links (`fromNodeId == null`) — smart-match to cards / CTA buttons on the screen
    const unboundLinks = links.filter(x => x.fromNodeId == null);
    if (this.type === 'screen' && unboundLinks.length) {
      const candidateNodes = this.nodes.filter(n => {
        if (n.visible === false || n.role === 'bg' || n.role === 'bg-glow' || n.role === 'shine') return false;
        // a menu button runs its own items (slide, long press, navigate): a route box over it would block them
        if (n.kind === 'instance' && n.refType === 'button' && findDesign('button', n.refId)?.menuItems?.length) return false;
        if (n.role === 'button' || n.role === 'card') return true;
        if (n.kind === 'instance' && n.refType === 'button') return true;
        if (n.tag === 'rect') {
          const fill = String(n.attrs?.fill || '');
          const b = nodeBBox(n, this.nodes);
          if ((fill.includes('accent') || fill.includes('10B981') || fill.includes('4285F4')) && b.w >= 36 && b.h >= 28 && b.h <= 96) return true;
          // Also match Google sign-in button rect or action row rects
          if (n.role === 'field' && b.h >= 40 && b.h <= 64 && this.nodes.some(t => t.tag === 'text' && (t.text || '').toLowerCase().includes('giriş'))) return true;
        }
        return false;
      });

      if (unboundLinks.length === 1) {
        const link = unboundLinks[0];
        if (candidateNodes.length) {
          for (const cn of candidateNodes) {
            const cb = nodeBBox(cn, this.nodes);
            addHotspot({
              box: cb,
              cls: 'is-route',
              title: `🔗 ${link.name || 'Continue'}`,
              onClick: () => this.navigateLiveToScreen(link.toScreenId, link.name)
            });
          }
        } else {
          // e.g. Splash screen (#48): make the screen body clickable to advance
          addHotspot({
            box: { x: 20, y: 80, w: this.doc.width - 40, h: this.doc.height - 160 },
            cls: 'is-route',
            title: `🔗 ${link.name || 'Continue'} (${link.trigger || 'tap'})`,
            onClick: () => this.navigateLiveToScreen(link.toScreenId, link.name)
          });
        }
      } else {
        // Multiple unbound links (e.g. Scan list #49 or Question menu #55): map cards/buttons in order
        candidateNodes.forEach((cn, idx) => {
          const link = unboundLinks[idx % unboundLinks.length];
          const cb = nodeBBox(cn, this.nodes);
          addHotspot({
            box: cb,
            cls: 'is-route',
            title: `🔗 ${link.name || 'Open'}`,
            onClick: () => this.navigateLiveToScreen(link.toScreenId, link.name)
          });
        });
      }
    }

    // 4. Interactive Buttons & Animated Nodes (any button/animated node not yet covered by a hotspot)
    const animNodeIds = new Set((this.doc.animations || []).map(a => a.nodeId));
    for (const n of this.nodes) {
      if (n.visible === false || n.role === 'bg' || n.role === 'bg-glow' || n.role === 'shine') continue;
      // Skip buttons with their own `.ud-btn` radial/popup menu so `bindMenus` handles their clicks directly
      if (n.kind === 'instance' && n.refType === 'button') {
        const libBtn = findDesign('button', n.refId);
        if (libBtn?.menuItems?.length) continue;
      }
      const isBtn =
        n.role === 'button' ||
        (n.kind === 'instance' && n.refType === 'button') ||
        (n.tag === 'rect' && String(n.attrs?.fill || '').includes('accent') && (Number(n.attrs?.height) || 0) <= 84);
      const isAnim = animNodeIds.has(n.id);
      if (!isBtn && !isAnim) continue;

      const b = nodeBBox(n, this.nodes);
      const alreadyCovered = usedBoxes.some(
        u => Math.abs(u.x - b.x) < 8 && Math.abs(u.y - b.y) < 8 && Math.abs(u.w - b.w) < 16 && Math.abs(u.h - b.h) < 16
      );
      if (alreadyCovered) continue;

      // Find any text label inside this button rect
      const labelNode = this.nodes.find(t => {
        if (t.tag !== 'text' || !t.text) return false;
        const tb = nodeBBox(t, this.nodes);
        return tb.x + tb.w / 2 >= b.x && tb.x + tb.w / 2 <= b.x + b.w && tb.y + tb.h / 2 >= b.y && tb.y + tb.h / 2 <= b.y + b.h;
      });
      const btnName = labelNode?.text || n.name || (n.kind === 'instance' ? findDesign(n.refType, n.refId)?.name : '') || 'Button';

      addHotspot({
        box: b,
        cls: 'is-btn',
        title: `Click: ${btnName}`,
        onClick: () => {
          const domNode = this.stage.querySelector(`[data-el="${n.id}"]`);
          if (domNode) {
            domNode.classList.toggle('ud-on');
            domNode.animate(
              [
                { transform: 'scale(1)' },
                { transform: 'scale(0.94)' },
                { transform: 'scale(1.03)' },
                { transform: 'scale(1)' }
              ],
              { duration: 260, easing: 'ease-out' }
            );
          }
          toast(`⚡ Triggered "${btnName}"`, 'info', 1300);
        }
      });
    }

    // 5. If in the Button Designer (`this.type === 'button'`) and the button has no radial menu, mount a full-button interactive hotspot
    if (this.type === 'button' && !this.doc?.menuItems?.length && usedBoxes.length === 0) {
      addHotspot({
        box: { x: 0, y: 0, w: this.doc.width, h: this.doc.height },
        cls: 'is-btn',
        title: `Click button: ${this.doc.name}`,
        onClick: () => {
          this.replayAllAnimations();
          toast(`⚡ Button clicked: "${this.doc.name}"`, 'ok', 1400);
        }
      });
    }
  };
}
