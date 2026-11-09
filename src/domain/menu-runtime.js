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
  /*
   * The hub bar shows `data-hub-visible` items (default 3). Odd (3 / 5): the current item is the big centre, the others small at its
   * sides. Even (2 / 4 / 6): every item is small; the current one sits just left of (above) the middle. When the menu has more items
   * than slots, the two end slots are drawn 30 % smaller (there are more items), and the bar shrinks to fit the device screen.
   */
  function hubSlots(m, n) {
    var v = +m.getAttribute('data-hub-visible') || 3, odd = v % 2 === 1;
    v = Math.min(v, odd ? 5 : 6);
    if (n < v) v = odd ? (n % 2 ? n : n - 1) : (n % 2 ? n - 1 : n);
    return { v: Math.max(1, v), odd: odd || v === 1, more: n > v };
  }
  function layoutHub(btn, st) {
    var m = btn.querySelector('.ud-menu'), items = hubItems(btn), n = items.length, c = st.c || 0;
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), small = +m.getAttribute('data-hub-small'), gap = +m.getAttribute('data-hub-gap');
    var big = +m.getAttribute('data-hub-big') || small * 2, hk = +m.getAttribute('data-hub-k') || 0.5;
    var vert = m.getAttribute('data-hub-vertical') === '1', fan = st.path.length > 0;
    var sl = hubSlots(m, n), v = sl.v, END = 0.7;
    if (btn.setAttribute) btn.setAttribute('data-hub-even', sl.odd ? '0' : '1');
    // slot -> {dx, size}: positions along the bar, centred on the button
    var slots = {}, lo, hi;
    if (sl.odd) { var h = (v - 1) / 2; lo = -h; hi = h; } else { lo = -(v / 2 - 1); hi = v / 2; }
    var sizeOf = function (d) { if (sl.odd && d === 0) return big; return small * (sl.more && (d === lo || d === hi) && v > 1 ? END : 1); };
    if (sl.odd) {
      slots[0] = { dx: 0, s: big };
      for (var side = -1; side <= 1; side += 2) {
        var edge = big / 2;
        for (var j = 1; j <= (v - 1) / 2; j++) { var d = side * j, s = sizeOf(d); slots[d] = { dx: side * (edge + gap + s / 2), s: s }; edge += gap + s; }
      }
    } else {
      var total = 0, d2;
      for (d2 = lo; d2 <= hi; d2++) total += sizeOf(d2) + (d2 > lo ? gap : 0);
      var at = -total / 2;
      for (d2 = lo; d2 <= hi; d2++) { var s2 = sizeOf(d2); slots[d2] = { dx: at + s2 / 2, s: s2 }; at += s2 + gap; }
    }
    // shrink the whole bar when it would leave the device screen (keep-inside menus)
    var f = 1, box = m.getAttribute('data-keep') === '1' ? screenBox(btn) : null;
    // (the button designer draws the button on its own small canvas: that is not a device screen, so nothing shrinks there)
    if (box && (vert ? box.B - box.T : box.R - box.L) > big * 1.5) {
      var reach = 0; for (var key in slots) reach = Math.max(reach, Math.abs(slots[key].dx) + slots[key].s / 2);
      var avail = vert ? Math.min(cy - box.T, box.B - cy) : Math.min(cx - box.L, box.R - cx);
      if (reach > 0 && avail > 0) f = Math.max(0.3, Math.min(1, (avail - 4) / reach));
    }
    items.forEach(function (el, i) {
      var d = (i - c + n) % n; if (d > n / 2) d -= n;          // signed ring distance from the current item
      if (!sl.odd && n > v && d > hi) d -= n; if (!sl.odd && n > v && d < lo) d += n;
      var slot = slots[d], dx = 0, k = 0, o = 0, pos = 'hidden';
      if (fan) {                                                 // a fan is open: only the current item stays, in the middle
        if (d === 0) { k = sl.odd ? 1 : hk; o = st.path.length > 1 ? 0 : 1; pos = 'center'; }
      } else if (slot) {
        dx = slot.dx * f; k = (slot.s / big) * f; o = 1;
        pos = d === 0 ? 'center' : d < 0 ? (d === -1 ? 'prev' : 'prev' + (-d)) : (d === 1 ? 'next' : 'next' + d);
        if (sl.more && (d === lo || d === hi)) el.setAttribute('data-hub-end', '1'); else if (el.removeAttribute) el.removeAttribute('data-hub-end');
      }
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
    if (hub && !st.open) st = { open: true, path: [], c: st.c, prev: st.prev };   // a hub bar is always shown: "closed" means back at the bar
    var key = st.path.join('/');
    btn.setAttribute('data-open', st.open ? '1' : '0');
    btn.setAttribute('data-center', rotating && !hub && st.open && st.path.length ? '1' : '0');
    btn.querySelectorAll('.rm-level').forEach(function (l) { var lv = l.getAttribute('data-level'); l.classList.toggle('is-active', st.open && (lv === key || (hub && lv === ''))); });
    btn.setAttribute('data-hubdepth', hub ? String(st.path.length) : '0');
    if (hub) btn.setAttribute('data-hub', '1');
    if (hub) layoutHub(btn, st);
    restoreSpins(btn, st);
    btn.querySelectorAll('.rm-center').forEach(function (c) { c.classList.toggle('is-active', st.open && rotating && st.path.length > 0 && c.getAttribute('data-for') === key); });
    // a corner fan is already placed inside the screen: the rest of the menu stays where it is
    var m = btn.querySelector('.ud-menu');
    if (layoutCorner(btn, screenBox(btn))) { if (m && m.style) { m.style.setProperty('--sx', '0px'); m.style.setProperty('--sy', '0px'); } }
    else { downsize(btn, screenBox(btn)); fit(btn); }
  }
  function set(btn, st) { if (isHub(btn) && st && !st.open) st = { open: true, path: [], c: st.c == null ? get(btn).c : st.c, prev: st.prev == null ? get(btn).prev : st.prev }; var old = states.get(btn); if (st && !st.spins && old && old.spins) st.spins = old.spins; states.set(btn, st); apply(btn, st); if (opts.onState) opts.onState(btn, st); }
  function fire(btn, el) {
    if (opts.onAction) opts.onAction({
      menu: btn.getAttribute('data-menu'), item: el.getAttribute('data-item'), id: el.getAttribute('data-menu-id'), action: el.getAttribute('data-action'),
      target: el.getAttribute('data-target'), targetElement: el.getAttribute('data-popup-element'), targetElementId: el.getAttribute('data-popup-element-id')
    });
  }
  /* hub "when clicked rotate": a click turns the item's icon to data-hub-spin degrees (animated); the second click turns it back to 0 */
  function spin(btn, el, on) {
    var m = btn.querySelector('.ud-menu'), deg = +(m && m.getAttribute('data-hub-spin')) || 0;
    if (!deg || !el || !el.style) return;
    var cur = parseFloat(el.style.getPropertyValue('--spin')) || 0;
    if (on == null) on = !cur;
    el.style.setProperty('--spin', (on ? deg : 0) + 'deg');
    // remembered in the menu state, so a redraw of the markup keeps the icon where it stopped
    var st = get(btn), key = el.getAttribute('data-item');
    if (key) { st.spins = st.spins || {}; if (on) st.spins[key] = deg; else delete st.spins[key]; }
  }
  function restoreSpins(btn, st) {
    if (!st.spins) return;
    Array.prototype.forEach.call(btn.querySelectorAll('.rm-item'), function (el) {
      var v = st.spins[el.getAttribute('data-item')];
      if (v != null && el.style) el.style.setProperty('--spin', v + 'deg');
    });
  }
  function hubStep(btn, t, st) {
    var items = hubItems(btn), n = items.length, c = st.c || 0, prev = st.prev == null ? c : st.prev;
    if (t.getAttribute('data-rm') === 'center') {
      // second click on the centre: back one level (the centre icon turns back)
      if (st.path.length) { var np = st.path.slice(0, -1); if (!np.length) spin(btn, items[c], false); return { open: true, path: np, c: c, prev: c }; }   // closes this level; the same item stays in the centre
      var cur = items[c];
      if (!cur) return st;
      if (opts.onItem) opts.onItem(btn, cur);
      // the centre item's own action fires too, and its sub items (if any) pop up around it
      if (cur.getAttribute('data-action') || cur.getAttribute('data-target')) fire(btn, cur);
      if (cur.getAttribute('data-children') === '1') { spin(btn, cur, true); return { open: true, path: cur.getAttribute('data-item').split('/'), c: c, prev: c }; }
      spin(btn, cur);
      if (!cur.getAttribute('data-action') && !cur.getAttribute('data-target')) fire(btn, cur);
      return st;
    }
    if (t.hasAttribute && t.hasAttribute('data-hub-index')) {
      if (st.path.length) return st;
      var i = +t.getAttribute('data-hub-index');
      // an end item that marks more items (30 % smaller) scrolls the bar one step towards it instead of acting
      var dd = (i - c + n) % n, far = Math.min(dd, n - dd) > 1;
      if (t.getAttribute('data-hub-end') === '1' && far) { var nc = (c + (dd > n / 2 ? -1 : 1) + n) % n; return { open: true, path: [], c: nc, prev: nc }; }
      if (opts.onItem) opts.onItem(btn, t);
      if (items[c] && items[c] !== t) spin(btn, items[c], false);   // the item leaving the centre turns back
      spin(btn, t, t.getAttribute('data-children') === '1' ? true : null);
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
      if (!inside) { spin(btn, hubItems(btn)[st.c || 0], false); set(btn, { open: true, path: [], c: st.prev == null ? st.c : st.prev, prev: st.prev }); }
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
