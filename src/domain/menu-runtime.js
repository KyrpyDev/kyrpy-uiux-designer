/**
 * Runtime of button menus. `bindMenus` is deliberately self-contained (no outer references, ES5 style) because the
 * exporter embeds its source verbatim into the generated js/app.js and ts/menu.ts: the designer preview, the exported
 * pages and the dev team's reference all run this exact function.
 *
 * Markup contract (see menu.js): .ud-btn[data-menu] > .ud-menu > .rm-level[data-level] > .rm-item[data-item][data-children],
 * .rm-center[data-for], and the click target [data-rm="center"].
 *
 * State per button: { open: boolean, path: string[] }   (path = names of the items entered so far)
 *   centre click:  closed -> open root | open at root -> close | open inside an item -> one level back
 *   item click:    has sub items -> enter it (centre shows its icon in the "rotating" kind) | leaf -> action + close
 *
 * Hub kind (`data-kind="hub"`): a ring of 3+ root items shown as 3 buttons (small left, DOUBLE-size centre, small right), always open.
 *   state { open:true, path, c: ring index of the centre, prev: ring index to return to }
 *   side click:   the clicked button swaps place and size with the centre; with sub items they fan out around the centre
 *   centre click: sub items of the centre item fan out | in a fan: one level back (at the first level: back to the previous ring position)
 *   outside click: back to the previous ring position · mouse wheel over the hub: scroll the ring (infinite)
 *
 * opts: onAction({menu,item,id,action,target}) · onState(btnEl,state) · keepOpen (editor: leaf click does not close) · onItem(btnEl, itemEl)
 * returns { get(btnEl), set(btnEl,state), apply(btnEl,state) }
 */
export function bindMenus(root, opts) {
  opts = opts || {};
  var states = new WeakMap();
  function isHub(btn) { return !!(btn.querySelector && btn.querySelector('.ud-menu[data-kind="hub"]')); }
  function get(btn) { var s = states.get(btn); if (!s) { if (isHub(btn)) { var m0 = btn.querySelector('.ud-menu'), c0 = +(m0 && m0.getAttribute('data-hub-start')) || 0; s = { open: true, path: [], c: c0, prev: c0 }; } else s = { open: false, path: [] };   /* hub: starts on its default centre item */ states.set(btn, s); } return s; }
  function hubItems(btn) { return Array.prototype.slice.call(btn.querySelectorAll('.rm-level[data-level=""] .rm-hub-item')); }
  function layoutHub(btn, st) {
    var m = btn.querySelector('.ud-menu'), items = hubItems(btn), n = items.length, c = st.c || 0;
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), small = +m.getAttribute('data-hub-small'), gap = +m.getAttribute('data-hub-gap');
    var big = +m.getAttribute('data-hub-big') || small * 2, hk = +m.getAttribute('data-hub-k') || 0.5;
    var vert = m.getAttribute('data-hub-vertical') === '1', off = big / 2 + gap + small / 2, fan = st.path.length > 0;
    items.forEach(function (el, i) {
      var d = (i - c + n) % n, dx = 0, k = 0, o = 0, pos = 'hidden';
      if (d === 0) { k = 1; o = st.path.length > 1 ? 0 : 1; pos = 'center'; }
      else if (d === 1) { dx = off; k = hk; o = fan ? 0 : 1; pos = 'next'; }
      else if (d === n - 1) { dx = -off; k = hk; o = fan ? 0 : 1; pos = 'prev'; }
      el.style.setProperty('--x', (cx + (vert ? 0 : dx)) + 'px');
      el.style.setProperty('--y', (cy + (vert ? dx : 0)) + 'px');
      el.style.setProperty('--k', String(k));
      el.style.setProperty('--o', String(o));
      el.setAttribute('data-hub-pos', pos);
    });
  }
  /* the device screen in the button's own coordinates ({L,R,T,B}), or null when it cannot be measured */
  function screenBox(btn) {
    var svg = btn.ownerSVGElement;
    if (!svg || !btn.getScreenCTM || !svg.createSVGPoint || !svg.getBoundingClientRect) return null;
    var ctm = btn.getScreenCTM(), sr = svg.getBoundingClientRect();
    if (!ctm || !ctm.a || !sr.width) return null;
    var inv = ctm.inverse(), p1 = svg.createSVGPoint(), p2 = svg.createSVGPoint();
    p1.x = sr.left; p1.y = sr.top; p2.x = sr.right; p2.y = sr.bottom;
    var a = p1.matrixTransform(inv), b = p2.matrixTransform(inv);
    return { L: Math.min(a.x, b.x), R: Math.max(a.x, b.x), T: Math.min(a.y, b.y), B: Math.max(a.y, b.y) };
  }
  /* corner fan (data-corner on a level): its items sit on a quarter circle around a corner of the screen, none clipped by the edges */
  function cornerLevel(btn) {
    var l = btn.querySelector('.rm-level.is-active[data-corner]');
    return l || null;   // the hub ring never carries data-corner; a plain burger button's root level may
  }
  function layoutCorner(btn, box) {
    var level = cornerLevel(btn);
    if (!level || !box) return false;
    var corner = level.getAttribute('data-corner') || 'bottom-right';
    var items = Array.prototype.slice.call(level.querySelectorAll('.rm-item')), n = items.length;
    if (!n) return false;
    var r = 0; items.forEach(function (el) { r = Math.max(r, +el.getAttribute('data-r') || 0); });
    var pad = 4, m = r + pad, left = corner.indexOf('left') >= 0, top = corner.indexOf('top') === 0;
    var ox = left ? box.L : box.R, oy = top ? box.T : box.B, sx = left ? 1 : -1, sy = top ? 1 : -1;
    var R = Math.max(+level.getAttribute('data-corner-r') || 0, m * 1.5), lo = 0, hi = 0;
    for (var g = 0; g < 40; g++) {                  // grow the radius until the items fit on the arc without touching
      lo = Math.asin(Math.min(1, m / R)); hi = Math.acos(Math.min(1, m / R));
      if (hi > lo && (n === 1 || R * (hi - lo) >= (n - 1) * r * 2.2)) break;
      R *= 1.12;
    }
    items.forEach(function (el, i) {
      var t = n === 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (n - 1);
      el.style.setProperty('--x', (ox + sx * R * Math.cos(t)) + 'px');
      el.style.setProperty('--y', (oy + sy * R * Math.sin(t)) + 'px');
    });
    return true;
  }
  /* keep the opened menu inside the device screen: shift it (all items together) back by the part that sticks out */
  function px(v) { return parseFloat(v) || 0; }
  function fit(btn) {
    var m = btn.querySelector('.ud-menu');
    if (!m || !m.style) return;
    m.style.setProperty('--sx', '0px'); m.style.setProperty('--sy', '0px');
    if (m.getAttribute('data-keep') !== '1') return;
    var svg = btn.ownerSVGElement;
    if (!svg || !btn.getScreenCTM || !svg.createSVGPoint) return;
    var ctm = btn.getScreenCTM(), sr = svg.getBoundingClientRect(), br = btn.getBoundingClientRect();
    if (!ctm || !ctm.a || !sr.width || br.width >= sr.width * 0.8) return;     // the button designer shows the button alone: nothing to keep inside
    var inv = ctm.inverse(), p1 = svg.createSVGPoint(), p2 = svg.createSVGPoint();
    p1.x = sr.left; p1.y = sr.top; p2.x = sr.right; p2.y = sr.bottom;
    var a = p1.matrixTransform(inv), b = p2.matrixTransform(inv), pad = 4;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    btn.querySelectorAll('.rm-level.is-active .rm-item').forEach(function (el) {
      if (el.getAttribute('data-hub-pos') === 'hidden') return;
      var k = el.hasAttribute('data-hub-index') ? (parseFloat(el.style.getPropertyValue('--k')) || 1) : (parseFloat(el.style.getPropertyValue('--fit')) || 1);
      if (k === 0) return;
      var r = (+el.getAttribute('data-r') || 0) * k, x = px(el.style.getPropertyValue('--x')), y = px(el.style.getPropertyValue('--y'));
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
    });
    if (x0 === Infinity) return;
    var L = Math.min(a.x, b.x) + pad, R = Math.max(a.x, b.x) - pad, T = Math.min(a.y, b.y) + pad, B = Math.max(a.y, b.y) - pad;
    var dx = x0 < L ? L - x0 : (x1 > R ? R - x1 : 0), dy = y0 < T ? T - y0 : (y1 > B ? B - y1 : 0);
    if (x1 - x0 > R - L) dx = (L + R) / 2 - (x0 + x1) / 2;
    if (y1 - y0 > B - T) dy = (T + B) / 2 - (y0 + y1) / 2;
    m.style.setProperty('--sx', dx + 'px'); m.style.setProperty('--sy', dy + 'px');
  }
  /* hub "auto downsize": the sub items of the open level are scaled down (size and distance from the centre) when they would not fit the screen */
  function downsize(btn, box) {
    var m = btn.querySelector('.ud-menu'), items = Array.prototype.slice.call(btn.querySelectorAll('.rm-level.is-active:not([data-level=""]) .rm-item'));
    if (!m || !items.length) return;
    var on = m.getAttribute('data-kind') === 'hub' && m.getAttribute('data-hub-fit') === '1' && m.getAttribute('data-keep') === '1' && box;
    var svg = btn.ownerSVGElement;
    if (on && svg && svg.getBoundingClientRect && btn.getBoundingClientRect && btn.getBoundingClientRect().width >= svg.getBoundingClientRect().width * 0.8) on = false;   // the button designer shows the button alone: no screen
    if (!on && !items.some(function (el) { return el._ox != null; })) return;       // never scaled: leave the items alone
    items.forEach(function (el) { if (el._ox == null) { el._ox = px(el.style.getPropertyValue('--x')); el._oy = px(el.style.getPropertyValue('--y')); } });
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), s = 1;
    if (on) {
      // largest scale (about the hub centre) that keeps every item inside the screen without shifting; never below 20 %
      var pad = 4, dl = 0, dr = 0, dt = 0, db = 0;
      items.forEach(function (el) { var r = +el.getAttribute('data-r') || 0; dl = Math.max(dl, cx - (el._ox - r)); dr = Math.max(dr, el._ox + r - cx); dt = Math.max(dt, cy - (el._oy - r)); db = Math.max(db, el._oy + r - cy); });
      var lim = function (avail, d) { return d > 0 ? Math.max(0, avail) / d : 1; };
      s = Math.max(0.2, Math.min(1, lim(cx - box.L - pad, dl), lim(box.R - pad - cx, dr), lim(cy - box.T - pad, dt), lim(box.B - pad - cy, db)));
    }
    items.forEach(function (el) {
      el.style.setProperty('--x', (cx + (el._ox - cx) * s) + 'px'); el.style.setProperty('--y', (cy + (el._oy - cy) * s) + 'px');
      el.style.setProperty('--fit', String(s));
    });
  }
  function apply(btn, st) {
    var menu = btn.querySelector('.ud-menu');
    var kind = menu ? menu.getAttribute('data-kind') : '';
    var rotating = kind === 'rotating' || kind === 'radial' || kind === 'hub';
    var hub = kind === 'hub';
    var key = st.path.join('/');
    btn.setAttribute('data-open', st.open ? '1' : '0');
    btn.setAttribute('data-center', rotating && !hub && st.open && st.path.length ? '1' : '0');
    btn.querySelectorAll('.rm-level').forEach(function (l) { var lv = l.getAttribute('data-level'); l.classList.toggle('is-active', st.open && (lv === key || (hub && lv === ''))); });
    btn.setAttribute('data-hubdepth', hub ? String(st.path.length) : '0');
    if (hub) btn.setAttribute('data-hub', '1');
    if (hub) layoutHub(btn, st);
    btn.querySelectorAll('.rm-center').forEach(function (c) { c.classList.toggle('is-active', st.open && rotating && st.path.length > 0 && c.getAttribute('data-for') === key); });
    // a corner fan is already placed inside the screen: the rest of the menu stays where it is
    var m = btn.querySelector('.ud-menu');
    if (layoutCorner(btn, screenBox(btn))) { if (m && m.style) { m.style.setProperty('--sx', '0px'); m.style.setProperty('--sy', '0px'); } }
    else { downsize(btn, screenBox(btn)); fit(btn); }
  }
  function set(btn, st) { states.set(btn, st); apply(btn, st); if (opts.onState) opts.onState(btn, st); }
  function fire(btn, el) {
    if (opts.onAction) opts.onAction({
      menu: btn.getAttribute('data-menu'), item: el.getAttribute('data-item'), id: el.getAttribute('data-menu-id'), action: el.getAttribute('data-action'),
      target: el.getAttribute('data-target'), targetElement: el.getAttribute('data-popup-element'), targetElementId: el.getAttribute('data-popup-element-id')
    });
  }
  /* hub "when clicked rotate": the clicked item's icon turns by data-hub-spin degrees on every click (accumulates, so it always turns the same way) */
  function spin(btn, el) {
    var m = btn.querySelector('.ud-menu'), deg = +(m && m.getAttribute('data-hub-spin')) || 0;
    if (!deg || !el || !el.style) return;
    el.style.setProperty('--spin', ((parseFloat(el.style.getPropertyValue('--spin')) || 0) + deg) + 'deg');
  }
  function hubStep(btn, t, st) {
    var items = hubItems(btn), n = items.length, c = st.c || 0, prev = st.prev == null ? c : st.prev;
    if (t.getAttribute('data-rm') === 'center') {
      if (st.path.length) { var np = st.path.slice(0, -1); return { open: true, path: np, c: np.length ? c : prev, prev: prev }; }
      var cur = items[c];
      if (!cur) return st;
      if (opts.onItem) opts.onItem(btn, cur);
      spin(btn, cur);
      if (cur.getAttribute('data-children') === '1') return { open: true, path: cur.getAttribute('data-item').split('/'), c: c, prev: c };
      fire(btn, cur);
      return st;
    }
    if (t.hasAttribute && t.hasAttribute('data-hub-index')) {
      if (st.path.length) return st;
      var i = +t.getAttribute('data-hub-index');
      if (opts.onItem) opts.onItem(btn, t);
      spin(btn, t);
      // the clicked item swaps into the centre; its existing sub items fan out at once (also in the editor)
      return { open: true, path: t.getAttribute('data-children') === '1' ? t.getAttribute('data-item').split('/') : [], c: i, prev: c };
    }
    // an item of a fan (sub level)
    if (opts.onItem) opts.onItem(btn, t);
    spin(btn, t);
    if (t.getAttribute('data-children') === '1') return { open: true, path: t.getAttribute('data-item').split('/'), c: c, prev: prev };
    fire(btn, t);
    return opts.keepOpen ? st : { open: true, path: [], c: prev, prev: prev };
  }
  var doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  function hubBack(ev) {
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.ud-btn'), function (btn) {
      var st = states.get(btn);
      if (!st || !st.path || !st.path.length || !isHub(btn)) return;
      var inside = false; try { inside = btn.contains(ev.target); } catch (e) { inside = false; }
      if (!inside) set(btn, { open: true, path: [], c: st.prev == null ? st.c : st.prev, prev: st.prev });
    });
  }
  if (doc && doc.addEventListener) doc.addEventListener('click', hubBack);
  root.addEventListener('wheel', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.ud-btn') : null;
    if (!btn || !isHub(btn)) return;
    var st = get(btn), n = hubItems(btn).length;
    if (st.path.length || n < 2) return;
    ev.preventDefault();
    var c = ((st.c || 0) + (ev.deltaY > 0 ? 1 : -1) + n) % n;
    set(btn, { open: true, path: [], c: c, prev: c });
  }, { passive: false });
  root.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-rm="center"], .rm-item') : null;
    if (!t) return;
    var btn = t.closest('.ud-btn');
    if (!btn) return;
    var st = get(btn), next;
    if (isHub(btn)) { ev.stopPropagation(); set(btn, hubStep(btn, t, st)); return; }
    if (t.getAttribute('data-rm') === 'center') {
      var showElId = t.getAttribute('data-show-element-id');
      if (showElId && opts.onAction) {
        opts.onAction({
          menu: btn.getAttribute('data-menu'),
          item: 'center',
          action: 'show-element',
          targetElement: showElId,
          targetElementId: showElId
        });
      }
      if (!st.open) next = { open: true, path: [] };
      else if (st.path.length) next = { open: true, path: st.path.slice(0, -1) };
      else next = { open: false, path: [] };
    } else {
      var item = t.getAttribute('data-item');
      if (opts.onItem) opts.onItem(btn, t);
      if (t.getAttribute('data-children') === '1') next = { open: true, path: item.split('/') };
      else {
        if (opts.onAction) opts.onAction({
          menu: btn.getAttribute('data-menu'),
          item: item,
          id: t.getAttribute('data-menu-id'),
          action: t.getAttribute('data-action'),
          target: t.getAttribute('data-target'),
          targetElement: t.getAttribute('data-popup-element'),
          targetElementId: t.getAttribute('data-popup-element-id')
        });
        next = opts.keepOpen ? st : { open: false, path: [] };
      }
    }
    ev.stopPropagation();
    set(btn, next);
  });
  if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('.ud-btn'), function (btn) { if (isHub(btn)) apply(btn, get(btn)); });
  return { get: get, set: set, apply: apply };
}
