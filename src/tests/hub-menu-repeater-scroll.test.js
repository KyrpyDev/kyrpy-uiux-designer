/**
 * Tests for Hub Menu Centered Button & Menu Item Repeater Scroll Feature:
 *  - Hub center button press down & slide up/down scrolls repeater container on screen.
 *  - Menu items configured with action 'scroll-repeater' scroll targeted or auto-bound repeater.
 *  - Automatic binding between menu and repeater on the same screen.
 *  - Distinguishes sliding gestures (which scroll repeater and suppress click) from quick taps (which fire normal click).
 *  - Horizontal and vertical repeater track scrolling support.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLICK_ACTIONS, CLICK_TARGET_TYPE, normalizeClickAction, DEFAULT_MENU } from '../domain/entities.js';
import { renderMenu, buildMenuTree, menuConfig } from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { bindMenus } from '../domain/menu-runtime.js';

test('entities: scroll-repeater is a recognized click action with optional targetId', () => {
  assert.ok(CLICK_ACTIONS.includes('scroll-repeater'));
  assert.equal(CLICK_TARGET_TYPE['scroll-repeater'], 'element');

  const withTarget = normalizeClickAction({ type: 'scroll-repeater', targetId: 12 });
  assert.deepEqual(withTarget, { type: 'scroll-repeater', targetId: 12 });

  const autoBound = normalizeClickAction({ type: 'scroll-repeater' });
  assert.deepEqual(autoBound, { type: 'scroll-repeater' });

  assert.equal(DEFAULT_MENU.hubCenterScrollRepeater, true);
  assert.equal(DEFAULT_MENU.hubRepeaterTargetId, null);
});

test('menu markup: renderMenu outputs repeater scroll attributes on items and hub center', () => {
  const cfg = menuConfig({
    menu: {
      kind: 'hub',
      hubCenterScrollRepeater: true,
      hubRepeaterTargetId: 88
    }
  });
  const items = [
    { id: 1, name: 'home', label: 'Home', action: 'scroll-repeater', targetElementId: 42 },
    { id: 2, name: 'explore', label: 'Explore', action: 'custom-action' },
    { id: 3, name: 'profile', label: 'Profile' }
  ];
  const tree = buildMenuTree(items);
  const ctx = createContext({ theme: BUILTIN_THEMES[0] });
  const svg = renderMenu({
    button: { key: 'test-hub', width: 64, height: 64 },
    cfg,
    tree,
    ctx,
    iconKey: () => null
  });

  assert.match(svg, /data-hub-center-scroll="1"/);
  assert.match(svg, /data-target-repeater="88"/);
  assert.match(svg, /data-action="scroll-repeater"/);
  assert.match(svg, /data-target-repeater="42"/);
});

// Minimal DOM simulation for menu + repeater integration
function createScreenWorld({ repeaterAxis = 'y', repeaterLoop = 300, repeaterMax = 0, targetId = null } = {}) {
  const handlers = {};
  const docHandlers = {};

  const makeEl = (tag, attrs = {}, classes = []) => {
    const el = {
      tag,
      attrs: { ...attrs },
      classes: new Set(classes),
      children: [],
      style: {},
      styleVars: {},
      parentNode: null,
      getAttribute(k) { return this.attrs[k] != null ? String(this.attrs[k]) : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      hasAttribute(k) { return k in this.attrs; },
      removeAttribute(k) { delete this.attrs[k]; },
      classList: {
        add(c) { el.classes.add(c); },
        remove(c) { el.classes.delete(c); },
        toggle(c, on) { if (on ?? !el.classes.has(c)) el.classes.add(c); else el.classes.delete(c); },
        contains(c) { return el.classes.has(c); }
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      matches(sel) {
        if (sel === '.ud-btn') return this.classes.has('ud-btn');
        if (sel === '.ud-screen') return this.classes.has('ud-screen');
        if (sel === '.ud-repeater') return this.classes.has('ud-repeater');
        if (sel === '.ud-rpt-stage') return this.classes.has('ud-rpt-stage');
        if (sel === '[data-rm="center"]') return this.attrs['data-rm'] === 'center';
        if (sel === '[data-rm="center"], .rm-hub-item, .rm-item') return this.attrs['data-rm'] === 'center' || this.classes.has('rm-hub-item') || this.classes.has('rm-item');
        if (sel === '[data-rm="center"], .rm-item') return this.attrs['data-rm'] === 'center' || this.classes.has('rm-item');
        return false;
      },
      querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all[0] || null;
      },
      querySelectorAll(sel) {
        const res = [];
        const walk = node => {
          for (const ch of node.children) {
            let match = false;
            if (sel === '.ud-btn' && ch.classes.has('ud-btn')) match = true;
            else if (sel === '.ud-menu' && ch.classes.has('ud-menu')) match = true;
            else if (sel === '.ud-menu[data-kind="hub"]' && ch.classes.has('ud-menu') && ch.attrs['data-kind'] === 'hub') match = true;
            else if (sel === '.ud-rpt-track' && ch.classes.has('ud-rpt-track')) match = true;
            else if (sel === '.ud-rpt-stage' && ch.classes.has('ud-rpt-stage')) match = true;
            else if (sel.includes('.ud-rpt-stage') && ch.classes.has('ud-rpt-stage')) match = true;
            else if (sel === '.rm-level' && ch.classes.has('rm-level')) match = true;
            else if (sel === '.rm-item' && ch.classes.has('rm-item')) match = true;
            else if (sel === '.rm-center' && ch.classes.has('rm-center')) match = true;
            else if (sel.includes('.rm-hub-item') && ch.classes.has('rm-hub-item')) match = true;
            else if (sel.includes('[data-repeater-for="') && ch.attrs['data-repeater-for'] === targetId) match = true;
            else if (sel.includes('[data-container-for="') && ch.attrs['data-container-for'] === targetId) match = true;
            else if (sel.includes('[data-el="') && ch.attrs['data-el'] === targetId) match = true;
            if (match) res.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return res;
      },
      appendChild(ch) {
        ch.parentNode = this;
        this.children.push(ch);
        return ch;
      }
    };
    el.style.setProperty = (k, v) => { el.styleVars[k] = v; el.style[k] = v; };
    el.style.getPropertyValue = k => el.styleVars[k] ?? el.style[k] ?? '';
    return el;
  };

  const root = makeEl('div', { class: 'root' }, ['root']);
  const screen = makeEl('g', { class: 'ud-screen' }, ['ud-screen']);
  root.appendChild(screen);

  // Repeater container & stage
  const repeaterContainer = makeEl('g', {
    class: 'ud-container-children ud-repeater',
    'data-container-for': targetId || 'rpt-1',
    'data-repeater-for': targetId || 'rpt-1'
  }, ['ud-container-children', 'ud-repeater']);
  const repeaterStage = makeEl('g', {
    class: 'ud-rpt-stage',
    'data-rpt-axis': repeaterAxis,
    'data-rpt-loop': String(repeaterLoop),
    'data-rpt-max': String(repeaterMax),
    'data-rpt-step': '60',
    'data-rpt-period': '3600',
    'data-rpt-kind': repeaterLoop ? 'loop' : 'list'
  }, ['ud-rpt-stage']);
  const repeaterTrack = makeEl('g', { class: 'ud-rpt-track' }, ['ud-rpt-track']);
  repeaterStage.appendChild(repeaterTrack);
  repeaterContainer.appendChild(repeaterStage);
  screen.appendChild(repeaterContainer);

  // Hub menu button
  const btn = makeEl('g', { class: 'ud-btn', 'data-menu': 'hub' }, ['ud-btn']);
  const menu = makeEl('g', {
    class: 'ud-menu',
    'data-kind': 'hub',
    'data-cx': '32',
    'data-cy': '32',
    'data-hub-small': '24',
    'data-hub-big': '64',
    'data-hub-k': '1',
    'data-hub-gap': '8',
    'data-hub-vertical': '0',
    'data-hub-center-scroll': '1'
  }, ['ud-menu']);
  btn.appendChild(menu);

  // Menu level and items
  const level = makeEl('g', { class: 'rm-level', 'data-level': '' }, ['rm-level']);
  const centerItem = makeEl('g', {
    class: 'rm-item rm-hub-item',
    'data-hub-index': '0',
    'data-hub-pos': 'center',
    'data-item': 'center-item',
    'data-action': 'hub-select'
  }, ['rm-item', 'rm-hub-item']);
  const scrollItem = makeEl('g', {
    class: 'rm-item rm-hub-item',
    'data-hub-index': '1',
    'data-item': 'scroll-item',
    'data-action': 'scroll-repeater',
    'data-target-repeater': targetId || 'rpt-1'
  }, ['rm-item', 'rm-hub-item']);
  level.appendChild(centerItem);
  level.appendChild(scrollItem);
  menu.appendChild(level);

  // Center hit area
  const centerHit = makeEl('circle', {
    class: 'rm-hit',
    'data-rm': 'center',
    'data-hub-center-scroll': '1'
  }, ['rm-hit']);
  menu.appendChild(centerHit);
  screen.appendChild(btn);

  // Event dispatch wiring
  root.addEventListener = (evName, fn) => { (handlers[evName] ||= []).push(fn); };
  const ownerDoc = {
    addEventListener: (evName, fn) => { (docHandlers[evName] ||= []).push(fn); },
    defaultView: {
      getComputedStyle: () => ({ transform: 'none' })
    }
  };
  root.ownerDocument = ownerDoc;

  const fire = (evName, target, extra = {}) => {
    const ev = {
      target,
      button: 0,
      clientX: extra.clientX ?? 100,
      clientY: extra.clientY ?? 100,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...extra
    };
    for (const fn of handlers[evName] || []) fn(ev);
    for (const fn of docHandlers[evName] || []) fn(ev);
    return ev;
  };

  return { root, screen, btn, centerHit, centerItem, scrollItem, repeaterStage, repeaterTrack, fire };
}

test('hub center button: press down and slide up/down scrolls repeater container on the same screen', () => {
  const w = createScreenWorld({ repeaterAxis: 'y', repeaterLoop: 400 });
  const actions = [];
  bindMenus(w.root, { onAction: a => actions.push(a) });

  // 1. Pointerdown on hub center hit circle
  w.fire('pointerdown', w.centerHit, { clientX: 100, clientY: 200 });

  // 2. Slide up (clientY 200 -> 160, dy = +40 units)
  const moveEv = w.fire('pointermove', w.centerHit, { clientX: 100, clientY: 160 });
  assert.equal(moveEv.defaultPrevented, true, 'pointermove is prevented during repeater slide');
  assert.equal(w.repeaterTrack.style.transform, 'translateY(-40px)', 'track moved up by 40px');
  assert.equal(w.repeaterTrack.style.animation, 'none', 'animation paused');

  // 3. Pointerup completes slide
  w.fire('pointerup', w.centerHit, { clientX: 100, clientY: 160 });

  // 4. Subsequent click event is suppressed because user was sliding
  const clickEv = w.fire('click', w.centerHit);
  assert.equal(clickEv.defaultPrevented, true, 'click suppressed after slide');
  assert.equal(actions.length, 0, 'no action triggered after sliding');
});

test('hub center button: quick tap (<4px) fires normal click action instead of scrolling', () => {
  const w = createScreenWorld({ repeaterAxis: 'y', repeaterLoop: 400 });
  const actions = [];
  bindMenus(w.root, { onAction: a => actions.push(a) });

  // Quick tap: down, move 1px (below 4px threshold), up, click
  w.fire('pointerdown', w.centerHit, { clientX: 100, clientY: 200 });
  w.fire('pointermove', w.centerHit, { clientX: 100, clientY: 201 });
  w.fire('pointerup', w.centerHit, { clientX: 100, clientY: 201 });

  assert.equal(w.repeaterTrack.style.transform, undefined, 'no scroll on tiny move');

  // Normal click proceeds: hub center fires the center item's action
  w.fire('click', w.centerHit);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'hub-select');
});

test('menu item: action scroll-repeater slides and scrolls targeted repeater container', () => {
  const w = createScreenWorld({ repeaterAxis: 'y', repeaterLoop: 500, targetId: 'rpt-custom' });
  const actions = [];
  bindMenus(w.root, { onAction: a => actions.push(a) });

  w.scrollItem.setAttribute('data-target-repeater', 'rpt-custom');

  // Pointerdown on scrollItem
  w.fire('pointerdown', w.scrollItem, { clientX: 150, clientY: 300 });

  // Slide down (clientY 300 -> 350, dy = -50 units)
  w.fire('pointermove', w.scrollItem, { clientX: 150, clientY: 350 });

  // In a loop of 500: -50 wraps to 450
  assert.equal(w.repeaterTrack.style.transform, 'translateY(-450px)');

  w.fire('pointerup', w.scrollItem, { clientX: 150, clientY: 350 });
  const clickEv = w.fire('click', w.scrollItem);
  assert.equal(clickEv.defaultPrevented, true, 'click suppressed after menu item slide');
});

test('horizontal repeater: sliding scrolls along X axis with translateX', () => {
  const w = createScreenWorld({ repeaterAxis: 'x', repeaterLoop: 600 });
  bindMenus(w.root);

  w.fire('pointerdown', w.centerHit, { clientX: 200, clientY: 100 });
  w.fire('pointermove', w.centerHit, { clientX: 150, clientY: 100 }); // dx = 50px left
  w.fire('pointerup', w.centerHit, { clientX: 150, clientY: 100 });

  assert.equal(w.repeaterTrack.style.transform, 'translateX(-50px)', 'track moved along X axis');
});
