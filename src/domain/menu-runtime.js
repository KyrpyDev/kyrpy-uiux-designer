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
 * Hub kind (`data-kind="hub"`): a ring of root items shown as a bar of up to 5 (odd) / 6 (even) buttons sized edge / side / centre, always open.
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
   * The hub bar size follows the number of top-level items: even -> up to 6 slots, odd -> up to 5. Slot sizes go by the distance
   * from the middle, as fractions of the centre size (data-hub-sizes = centre, side, edge): even 0.4 0.6 1 1 0.6 0.4, odd
   * 0.4 0.6 1 0.6 0.4. With more items than slots the bar scrolls (a click on a far end steps it). Even bars have two middle
   * items and no centre hit area; the bar shrinks to fit the device screen.
   */
  function hubSlots(m, n) {
    // data-hub-count (1-6): the bar shows that many buttons, the other items are reached by turning the ring
    var cnt = Math.round(+m.getAttribute('data-hub-count'));
    if (cnt >= 1) { var vc = Math.max(1, Math.min(n, cnt, 6)); return { v: vc, odd: vc % 2 === 1, more: n > vc }; }
    var odd = n % 2 === 1, v = Math.min(n, odd ? 5 : 6);
    return { v: Math.max(1, v), odd: odd, more: n > v };
  }
  /* a fan level with more items than its arc holds (8 when even, 9 when odd) shows a window of them; the first and the last
     are 30 % smaller and scroll the window when clicked (st.fo = { level path: offset }) */
  /*
   * "Sub items stay inside the screen" (data-sub-inside="1"): the centre does not move; the open level uses only the part
   * of its ring that lies inside the device screen. Returns { start, sweep, cap } (degrees, items that fit) or null when
   * the screen cannot be measured / the whole fan already fits where it was designed.
   */
  function insideArc(btn, m, level, items) {
    if (m.getAttribute('data-sub-inside') !== '1' || m.getAttribute('data-keep') === '0') return null;
    var box = screenBox(btn), svg = btn.ownerSVGElement;
    if (!box || !svg || !btn.getBoundingClientRect || btn.getBoundingClientRect().width >= svg.getBoundingClientRect().width * 0.8) return null;   // the button designer: no device screen
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), R = +level.getAttribute('data-fan-r');
    if (m.getAttribute('data-hub-fixed') === '1') {
      var key0 = level.getAttribute('data-level');
      var parentItem0 = btn.querySelector('.rm-hub-item[data-item="' + key0 + '"]');
      if (parentItem0) {
        cx = parseFloat(parentItem0.style.getPropertyValue('--x')) || cx;
        cy = parseFloat(parentItem0.style.getPropertyValue('--y')) || cy;
      }
    }
    var a0 = +level.getAttribute('data-fan-start') || 0, sw = Math.max(1, Math.min(360, Math.abs(+level.getAttribute('data-fan-sweep') || 0)));
    var r = 0, pad = 4; items.forEach(function (el) { r = Math.max(r, +el.getAttribute('data-r') || 0); });
    if (!(R > 0) || !(r > 0)) return null;
    var ok = [], free = 0, d;
    for (d = 0; d < 360; d++) {
      var a = d * Math.PI / 180, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      ok[d] = x - r >= box.L + pad && x + r <= box.R - pad && y - r >= box.T + pad && y + r <= box.B - pad;
      if (ok[d]) free++;
    }
    if (!free) return null;
    var norm = function (v) { return ((Math.round(v) % 360) + 360) % 360; };
    var start = a0, sweep = sw, designed = true;
    for (d = 0; d <= sw; d++) if (!ok[norm(a0 + d)]) { designed = false; break; }
    if (!designed && free < 360) {
      // free runs of the ring; take the one that shares most with the designed fan (else the longest)
      var runs = [], first = 0; while (ok[first]) first++;
      for (d = first; d < first + 360; d++) {
        if (!ok[d % 360]) continue;
        var s0 = d; while (d + 1 < first + 360 && ok[(d + 1) % 360]) d++;
        runs.push({ s: s0, len: d - s0 });
      }
      var best = null;
      runs.forEach(function (run) {
        var ov = 0; for (var q = 0; q <= sw; q++) { var t = norm(a0 + q), rel = ((t - run.s) % 360 + 360) % 360; if (rel <= run.len) ov++; }
        run.ov = ov;
        if (!best || run.ov > best.ov || (run.ov === best.ov && run.len > best.len)) best = run;
      });
      if (best.len >= sw) {
        // room for the whole sweep: slide the designed fan along the ring until it is inside
        var rel0 = ((norm(a0) - best.s) % 360 + 360) % 360; if (rel0 > 180 + best.len / 2) rel0 -= 360;
        start = best.s + Math.max(0, Math.min(best.len - sw, rel0)); sweep = sw;
      } else { start = best.s; sweep = best.len; }
    }
    // items may shrink to 80 % before the level starts hiding some of them
    var cap = Math.max(1, Math.floor((R * sweep * Math.PI / 180) / (r * 2.16 * 0.8)) + 1);
    return { start: start, sweep: sweep, cap: cap, len: R * sweep * Math.PI / 180, r: r };
  }
  function syncFanLabel(menu, el, dx, dy) {
    if (!menu || menu.getAttribute('data-show-labels') !== '1') return;
    var mode = menu.getAttribute('data-label-pos') || 'auto';
    var lbl = el && el.querySelector ? el.querySelector('.rm-label') : null;
    if (!lbl) return;
    var pos = mode === 'beside' || mode === 'over' ? mode : (Math.abs(dx) > Math.abs(dy) * 1.05 ? 'beside' : 'over');
    var side = pos === 'beside' ? (dx < -0.5 ? 'left' : 'right') : (dy > 2 ? 'bottom' : 'top');
    var r = +el.getAttribute('data-r') || 0, lw = +lbl.getAttribute('data-lw') || 0, lh = +lbl.getAttribute('data-lh') || 0, lg = +lbl.getAttribute('data-lgap') || 4;
    var lx = pos === 'beside' ? (side === 'left' ? -(r + lg + lw / 2) : (r + lg + lw / 2)) : 0;
    var ly = pos === 'over' ? (side === 'bottom' ? (r + lg + lh / 2) : -(r + lg + lh / 2)) : 0;
    var rd = function (v) { return Math.round(v * 100) / 100; };
    lbl.setAttribute('data-label-pos', pos);
    lbl.setAttribute('data-label-side', side);
    lbl.setAttribute('transform', 'translate(' + rd(lx) + ' ' + rd(ly) + ')');
    el.setAttribute('data-lbox', [rd(lx - lw / 2), rd(ly - lh / 2), rd(lx + lw / 2), rd(ly + lh / 2)].join(','));
  }
  function layoutFan(btn, st) {
    var key = st.path.join('/'), handled = false;
    Array.prototype.forEach.call(btn.querySelectorAll('.rm-level[data-fan-r]'), function (level) {
      var items = Array.prototype.slice.call(level.querySelectorAll('.rm-item')), n = items.length, cap = n % 2 ? 9 : 8;
      if (!items.length || level.getAttribute('data-level') !== key) return;
      var mm = btn.querySelector('.ud-menu'), arc = insideArc(btn, mm, level, items);
      if (arc) {
        handled = true;
        var acx = +mm.getAttribute('data-cx'), acy = +mm.getAttribute('data-cy'), aR = +level.getAttribute('data-fan-r');
        var win = Math.min(cap, arc.cap), over = n > win;
        if (over && win < 3) win = Math.min(n, 3);              // a window needs its two end items and one to click
        var show = over ? win : n;
        // items that share a short arc shrink (never below half) instead of overlapping
        var sc = show > 1 ? Math.max(0.5, Math.min(1, arc.len / ((show - 1) * arc.r * 2.16))) : 1;
        var aoff = over ? (((st.fo && st.fo[key]) || 0) % n) : 0;
        items.forEach(function (el, i) {
          var t = over ? (i - aoff + n) % n : i, shown = t < show, end = over && shown && (t === 0 || t === show - 1);
          el.setAttribute('data-fan-hidden', shown ? '0' : '1');
          el.setAttribute('data-fan-end', end ? (t === 0 ? 'first' : 'last') : '0');
          el.style.setProperty('--end', end ? '0.7' : '1');
          el.style.setProperty('--fit', String(Math.round(sc * 1000) / 1000));
          var ang = (show > 1 ? arc.start + arc.sweep * Math.min(t, show - 1) / (show - 1) : arc.start + arc.sweep / 2) * Math.PI / 180;
          var ax = acx + aR * Math.cos(ang), ay = acy + aR * Math.sin(ang);
          el._ox = ax; el._oy = ay;
          el.style.setProperty('--x', ax + 'px'); el.style.setProperty('--y', ay + 'px');
          syncFanLabel(mm, el, ax - acx, ay - acy);
        });
        return;
      }
      if (n <= cap) { items.forEach(function (el) { if (el.removeAttribute) { el.removeAttribute('data-fan-hidden'); el.removeAttribute('data-fan-end'); } if (el.style) el.style.setProperty('--end', '1'); }); return; }
      var m = btn.querySelector('.ud-menu'), cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy');
      if (m && m.getAttribute('data-hub-fixed') === '1') {
        var parentItem = btn.querySelector('.rm-hub-item[data-item="' + key + '"]');
        if (parentItem) {
          cx = parseFloat(parentItem.style.getPropertyValue('--x')) || cx;
          cy = parseFloat(parentItem.style.getPropertyValue('--y')) || cy;
        }
      }
      var a0 = +level.getAttribute('data-fan-start'), sw = +level.getAttribute('data-fan-sweep'), R = +level.getAttribute('data-fan-r');
      var off = ((st.fo && st.fo[key]) || 0) % n;
      items.forEach(function (el, i) {
        var t = (i - off + n) % n, shown = t < cap;
        el.setAttribute('data-fan-hidden', shown ? '0' : '1');
        el.setAttribute('data-fan-end', shown && (t === 0 || t === cap - 1) ? (t === 0 ? 'first' : 'last') : '0');
        el.style.setProperty('--end', shown && (t === 0 || t === cap - 1) ? '0.7' : '1');
        var a = (a0 + sw * Math.min(t, cap - 1) / (cap - 1)) * Math.PI / 180, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        el._ox = x; el._oy = y;
        el.style.setProperty('--x', x + 'px'); el.style.setProperty('--y', y + 'px');
        syncFanLabel(m, el, x - cx, y - cy);
      });
    });
    return handled;
  }
  /* click on the first / last item of an overflowing fan: scroll the window by one, no action */
  function fanScroll(btn, t, st) {
    var end = t.getAttribute && t.getAttribute('data-fan-end');
    if (end !== 'first' && end !== 'last') return null;
    var key = st.path.join('/'), level = t.parentNode, n = level && level.querySelectorAll ? level.querySelectorAll('.rm-item').length : 0;
    var fo = {}; for (var k in (st.fo || {})) fo[k] = st.fo[k];
    fo[key] = (((fo[key] || 0) + (end === 'last' ? 1 : -1)) % (n || 1) + (n || 1)) % (n || 1);
    var next = {}; for (var k2 in st) next[k2] = st[k2]; next.fo = fo;
    return next;
  }
  function layoutHub(btn, st) {
    var m = btn.querySelector('.ud-menu'), items = hubItems(btn), n = items.length, c = st.c || 0;
    var fixed = m && m.getAttribute('data-hub-fixed') === '1';
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), small = +m.getAttribute('data-hub-small'), gap = +m.getAttribute('data-hub-gap');
    var big = +m.getAttribute('data-hub-big') || small * 2, hk = +m.getAttribute('data-hub-k') || 0.5;
    var vert = m.getAttribute('data-hub-vertical') === '1', fan = st.path.length > 0;
    var sl = hubSlots(m, n), v = sl.v;
    // sizes by distance from the middle, as fractions of the centre size: centre, side, edge (data-hub-sizes)
    var fr = String(m.getAttribute('data-hub-sizes') || '1,0.6,0.4').split(',').map(Number);
    var frac = function (dist) { return dist <= 0 ? (fr[0] || 1) : dist === 1 ? (fr[1] || 0.6) : (fr[2] || 0.4); };
    if (btn.setAttribute) btn.setAttribute('data-hub-even', sl.odd ? '0' : '1');
    // slot -> {dx, size}: positions along the bar, centred on the button
    var slots = {}, lo, hi;
    if (sl.odd) { var h = (v - 1) / 2; lo = -h; hi = h; } else { lo = -(v / 2 - 1); hi = v / 2; }
    var sizeOf = function (d) { return big * frac(sl.odd ? Math.abs(d) : (d <= 0 ? -d : d - 1)); };
    if (sl.odd) {
      slots[0] = { dx: 0, s: sizeOf(0) };
      for (var side = -1; side <= 1; side += 2) {
        var edge = sizeOf(0) / 2;
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
      if (fan && !fixed) {                                       // a fan is open: only the current item stays, in the middle
        if (d === 0) { k = sizeOf(0) / big; o = st.path.length > 1 ? 0 : 1; pos = 'center'; }
      } else if (slot) {
        dx = slot.dx * f; k = (slot.s / big) * f; o = 1;
        pos = d === 0 ? 'center' : d < 0 ? (d === -1 ? 'prev' : 'prev' + (-d)) : (d === 1 ? 'next' : 'next' + d);
        if (!fixed && sl.more && (d === lo || d === hi)) el.setAttribute('data-hub-end', '1'); else if (el.removeAttribute) el.removeAttribute('data-hub-end');
      }
      el.style.setProperty('--x', (cx + (vert ? 0 : dx)) + 'px');
      el.style.setProperty('--y', (cy + (vert ? dx : 0)) + 'px');
      el.style.setProperty('--k', String(Math.round(k * 1000) / 1000));
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
    var menuEl = btn.querySelector('.ud-menu');
    items.forEach(function (el, i) {
      var t = n === 1 ? (lo + hi) / 2 : lo + (hi - lo) * i / (n - 1);
      var dx = sx * R * Math.cos(t), dy = sy * R * Math.sin(t);
      el.style.setProperty('--x', (ox + dx) + 'px');
      el.style.setProperty('--y', (oy + dy) + 'px');
      syncFanLabel(menuEl, el, dx, dy);
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
      if (el.getAttribute('data-hub-pos') === 'hidden' || el.getAttribute('data-fan-hidden') === '1') return;
      var k = el.hasAttribute('data-hub-index') ? (parseFloat(el.style.getPropertyValue('--k')) || 1) : (parseFloat(el.style.getPropertyValue('--fit')) || 1);
      if (k === 0) return;
      var r = (+el.getAttribute('data-r') || 0) * k, x = px(el.style.getPropertyValue('--x')), y = px(el.style.getPropertyValue('--y'));
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
      var lb = el.getAttribute && el.getAttribute('data-lbox');
      if (lb) {
        var lp = lb.split(',');
        x0 = Math.min(x0, x + (+lp[0] || 0) * k); y0 = Math.min(y0, y + (+lp[1] || 0) * k);
        x1 = Math.max(x1, x + (+lp[2] || 0) * k); y1 = Math.max(y1, y + (+lp[3] || 0) * k);
      }
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
    var m = btn.querySelector('.ud-menu'), items = Array.prototype.slice.call(btn.querySelectorAll('.rm-level.is-active:not([data-level=""]) .rm-item')).filter(function (el) { return el.getAttribute('data-fan-hidden') !== '1'; });
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
    var fixed = layoutFan(btn, st);   // true: the open level was placed inside the screen around a centre that stays put
    restoreSpins(btn, st);
    btn.querySelectorAll('.rm-center').forEach(function (c) { c.classList.toggle('is-active', st.open && rotating && st.path.length > 0 && c.getAttribute('data-for') === key); });
    // a corner fan is already placed inside the screen: the rest of the menu stays where it is
    var m = btn.querySelector('.ud-menu');
    if (fixed || layoutCorner(btn, screenBox(btn))) { if (m && m.style) { m.style.setProperty('--sx', '0px'); m.style.setProperty('--sy', '0px'); } }
    else { downsize(btn, screenBox(btn)); fit(btn); }
  }
  function set(btn, st) { if (isHub(btn) && st && !st.open) st = { open: true, path: [], c: st.c == null ? get(btn).c : st.c, prev: st.prev == null ? get(btn).prev : st.prev }; var old = states.get(btn); if (st && !st.spins && old && old.spins) st.spins = old.spins; if (st && !st.fo && old && old.fo && (st.path || []).join('/') === (old.path || []).join('/')) st.fo = old.fo; states.set(btn, st); apply(btn, st); if (opts.onState) opts.onState(btn, st); }
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
    var m = btn.querySelector('.ud-menu'), fixed = m && m.getAttribute('data-hub-fixed') === '1';
    if (t.getAttribute('data-rm') === 'center') {
      // second click on the centre: back one level (the centre icon turns back)
      if (st.path.length) { var np = st.path.slice(0, -1); if (!np.length && items[c]) spin(btn, items[c], false); return { open: true, path: np, c: c, prev: c }; }   // closes this level; the same item stays in the centre
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
      var i = +t.getAttribute('data-hub-index');
      if (fixed) {
        if (opts.onItem) opts.onItem(btn, t);
        var hasKids = t.getAttribute('data-children') === '1';
        var itemPath = t.getAttribute('data-item') || '';
        if (hasKids) {
          var isOpen = st.path.length > 0 && st.path.join('/') === itemPath;
          if (isOpen) {
            spin(btn, t, false);
            return { open: true, path: [], c: c, prev: prev };
          } else {
            if (st.path.length) {
              var oldItem = items.find(function (it) { return it.getAttribute('data-item') === st.path.join('/'); });
              if (oldItem) spin(btn, oldItem, false);
            }
            spin(btn, t, true);
            return { open: true, path: itemPath.split('/'), c: c, prev: prev };
          }
        }
        spin(btn, t);
        fire(btn, t);
        return { open: true, path: [], c: c, prev: prev };
      }
      if (st.path.length) return st;
      // an end item that marks more items (30 % smaller) scrolls the bar one step towards it instead of acting
      var dd = (i - c + n) % n, far = Math.min(dd, n - dd) > 1;
      if (t.getAttribute('data-hub-end') === '1' && far) { var nc = (c + (dd > n / 2 ? -1 : 1) + n) % n; return { open: true, path: [], c: nc, prev: nc }; }
      if (opts.onItem) opts.onItem(btn, t);
      if (items[c] && items[c] !== t) spin(btn, items[c], false);   // the item leaving the centre turns back
      spin(btn, t, t.getAttribute('data-children') === '1' ? true : null);
      // the clicked item swaps into the centre; its existing sub items fan out at once (also in the editor)
      return { open: true, path: t.getAttribute('data-children') === '1' ? t.getAttribute('data-item').split('/') : [], c: i, prev: c };
    }
    // an item of a fan (sub level): the ends of an overflowing fan scroll it
    var sc = fanScroll(btn, t, st); if (sc) return sc;
    if (opts.onItem) opts.onItem(btn, t);
    spin(btn, t);
    if (t.getAttribute('data-children') === '1') return { open: true, path: t.getAttribute('data-item').split('/'), c: c, prev: prev };
    fire(btn, t);
    return opts.keepOpen ? st : { open: true, path: [], c: prev, prev: prev };
  }
  var doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  function findRepeaterStage(btn, itemEl) {
    var perIt = itemEl && itemEl.getAttribute && itemEl.getAttribute('data-item-scroll') === '1';
    var menuEl = btn && btn.querySelector ? btn.querySelector('.ud-menu') : null;
    var targetId = perIt ? (itemEl.getAttribute('data-target-repeater') || null)
      : ((itemEl && (itemEl.getAttribute('data-target-repeater') || itemEl.getAttribute('data-popup-element-id') || itemEl.getAttribute('data-popup-element') || (itemEl.getAttribute('data-action') === 'scroll-repeater' ? itemEl.getAttribute('data-target') : null))) ||
         (btn && (btn.getAttribute('data-target-repeater') || btn.getAttribute('data-hub-repeater-target'))) ||
         (menuEl && menuEl.getAttribute('data-hub-repeater-target')) || null);
    var d = doc;
    var screen = (btn && btn.closest && (btn.closest('.ud-screen') || btn.closest('svg'))) || root;
    if (targetId) {
      var tid = String(targetId).replace(/["\\]/g, '');
      var sel = '[data-repeater-for="' + tid + '"], [data-container-for="' + tid + '"], [data-el="' + tid + '"]' + (/^[A-Za-z_][\w-]*$/.test(tid) ? ', #' + tid : '');
      var q = function (n) { try { return n && n.querySelector ? n.querySelector(sel) : null; } catch (e) { return null; } };
      var found = q(screen) || q(root) || q(d);
      // a library element picked as the target: the placed instance of it on this screen, then that node's container
      if (!found) {
        var sel0 = sel; sel = '[data-ref-el="' + tid + '"]';
        var inst = q(screen) || q(root);
        sel = sel0;
        var nid = inst && inst.getAttribute('data-el');
        if (nid) { var s2 = sel; sel = '[data-repeater-for="' + nid + '"], [data-container-for="' + nid + '"]'; found = q(screen) || q(root) || inst; sel = s2; }
      }
      if (found) {
        var st = (found.getAttribute && found.getAttribute('data-rpt-axis')) ? found : (found.querySelector ? found.querySelector('.ud-rpt-stage') : null);
        if (st) return st;
        // any other container chosen on the screen: its children group scrolls inside the container's clip
        var g = (found.getAttribute && found.getAttribute('data-container-for') != null) ? found : (found.querySelector ? found.querySelector('[data-container-for]') : null);
        if (g) { g.setAttribute('data-scroll-generic', '1'); if (!g.getAttribute('data-rpt-axis')) g.setAttribute('data-rpt-axis', g.getAttribute('data-scroll-y') === '0' && g.getAttribute('data-scroll-x') !== '0' ? 'x' : 'y'); return g; }
      }
      // a chosen target that is not on this screen scrolls nothing (it never falls back to another container)
      if (itemEl && itemEl.getAttribute && itemEl.getAttribute('data-item-scroll') === '1') return null;
    }
    var stage = (screen && screen.querySelector) ? screen.querySelector('.ud-repeater .ud-rpt-stage, .ud-rpt-stage[data-rpt-axis], .ud-rpt-stage') : null;
    if (!stage && root && root.querySelector) stage = root.querySelector('.ud-repeater .ud-rpt-stage, .ud-rpt-stage[data-rpt-axis], .ud-rpt-stage');
    return stage;
  }
  // the clip-path sits on the container group, so the scroll offset goes on an inner wrapper (moving the clipped group would move its clip too)
  function genericInner(g) {
    var f = g.firstElementChild;
    if (f && f.getAttribute('data-scroll-inner') === '1' && g.childElementCount === 1) return f;
    var w = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    w.setAttribute('data-scroll-inner', '1');
    while (g.firstChild) w.appendChild(g.firstChild);
    g.appendChild(w);
    return w;
  }
  function genericMax(g) {
    var clipH = 0, clipW = 0, ch = 0, cw = 0, cy = 0, cx = 0;
    try {
      var cp = (g.getAttribute('clip-path') || '').match(/#([^)"']+)/);
      var cr = cp && g.ownerDocument ? g.ownerDocument.getElementById(cp[1]) : null;
      var rect = cr && cr.querySelector ? cr.querySelector('rect') : null;
      if (rect) { clipH = parseFloat(rect.getAttribute('height')) || 0; clipW = parseFloat(rect.getAttribute('width')) || 0; cy = parseFloat(rect.getAttribute('y')) || 0; cx = parseFloat(rect.getAttribute('x')) || 0; }
      var inner = genericInner(g);
      var prev = inner.getAttribute('transform'); if (prev) inner.removeAttribute('transform');
      var bb = inner.getBBox ? inner.getBBox() : null;
      if (prev) inner.setAttribute('transform', prev);
      if (bb) { ch = bb.y + bb.height - cy; cw = bb.x + bb.width - cx; }
    } catch (e) {}
    var ax = g.getAttribute('data-scroll-x') !== '0', ay = g.getAttribute('data-scroll-y') !== '0';
    return { y: ay ? Math.max(0, ch - clipH) : 0, x: ax ? Math.max(0, cw - clipW) : 0 };
  }
  function moveRepeater(st, delta, preserve) {
    if (!st) return false;
    if (st.getAttribute && st.getAttribute('data-scroll-generic') === '1') {
      var gm = st.__udMax || (st.__udMax = genericMax(st));
      var gx = st.getAttribute('data-rpt-axis') === 'x' || (gm.y <= 0 && gm.x > 0);
      var lim = gx ? gm.x : gm.y;
      if (!lim) return false;
      var go = st.__udOff || 0, gn = Math.max(0, Math.min(lim, go + delta));
      if (gn === go) return false;
      st.__udOff = gn;
      genericInner(st).setAttribute('transform', (gx ? 'translate(' + (-gn) + ' 0)' : 'translate(0 ' + (-gn) + ')'));
      return true;
    }
    var track = st.querySelector ? st.querySelector('.ud-rpt-track') : null;
    if (!track) return false;
    var axis = st.getAttribute('data-rpt-axis') || 'y';
    var loop = parseFloat(st.getAttribute('data-rpt-loop')) || 0;
    var max = parseFloat(st.getAttribute('data-rpt-max')) || 0;
    if (!loop && !max) return false;
    var off = st.__udOff;
    if (off == null) {
      off = 0;
      try {
        var d = doc;
        var view = (d && d.defaultView) || (typeof window !== 'undefined' ? window : null);
        if (view && view.getComputedStyle) {
          var cs = view.getComputedStyle(track);
          var tf = cs ? (cs.transform || cs.webkitTransform || '') : '';
          var m = tf ? tf.match(/matrix\(([^)]+)\)/) : null;
          if (m) {
            var p = m[1].split(',');
            off = -(parseFloat(p[axis === 'x' ? 4 : 5]) || 0);
          }
        }
      } catch (e) { off = 0; }
    }
    var next = off + delta;
    next = loop ? ((next % loop) + loop) % loop : Math.max(0, Math.min(max, next));
    if (!loop && next === off && st.__udOff != null) return false;
    st.__udOff = next;
    if (track.style) {
      track.style.animation = 'none';
      track.style.transform = (axis === 'x' ? 'translateX(' : 'translateY(') + (-Math.round(next * 100) / 100) + 'px)';
    }
    if (st.__udT) { clearTimeout(st.__udT); st.__udT = null; }
    if (!preserve) {
      var period = parseFloat(st.getAttribute('data-rpt-period')) || 0;
      if (period) {
        st.__udT = setTimeout(function () {
          var slide = st.getAttribute('data-rpt-kind') === 'slide';
          var step = parseFloat(st.getAttribute('data-rpt-step')) || 1;
          var count = parseFloat(st.getAttribute('data-rpt-count')) || 1;
          var part = slide ? Math.round(next / step) / Math.max(1, count) : (loop ? next / loop : 0);
          if (track.style) {
            track.style.transform = '';
            track.style.animation = '';
            track.style.animationDelay = Math.round(-part * period) + 'ms';
          }
          st.__udOff = null;
        }, 1600);
      }
    }
    return true;
  }
  var rptDrag = null;
  var suppressClickUntil = 0;
  function getBtnRadius(t, btn) {
    var r = 32;
    try {
      var rect = (t.getBoundingClientRect && t.getBoundingClientRect()) || (btn.getBoundingClientRect && btn.getBoundingClientRect());
      if (rect && rect.width && rect.height) {
        r = Math.min(rect.width, rect.height) / 2;
      }
    } catch (e) {}
    return Math.max(16, r);
  }
  function autoScrollTick() {
    if (!rptDrag) return;
    if (rptDrag.activeSpeed) {
      moveRepeater(rptDrag.stage, rptDrag.activeSpeed / (rptDrag.scale || 1), true);
    }
    var view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (view && view.requestAnimationFrame) {
      rptDrag.rafId = view.requestAnimationFrame(autoScrollTick);
    }
  }
  function onPointerDown(ev) {
    if (ev.button) return;
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-rm="center"], .rm-hub-item, .rm-item') : null;
    if (!t) return;
    var btn = t.closest ? t.closest('.ud-btn') : null;
    if (!btn) return;
    var isCenter = t.getAttribute('data-rm') === 'center' || t.getAttribute('data-hub-pos') === 'center';
    var m = btn.querySelector ? btn.querySelector('.ud-menu') : null;
    // hub: the item sitting in the centre decides (per item slide-scroll setting); the centre hit area stands for it
    var src = t;
    if (isHub(btn) && t.getAttribute('data-rm') === 'center' && btn.querySelector) {
      var ci = btn.querySelector('.rm-hub-item[data-hub-pos="center"]');
      if (ci) src = ci;
    }
    var perItem = src.getAttribute('data-item-scroll');
    if (perItem === '0') return;
    var isRptAction = perItem === '1' || src.getAttribute('data-action') === 'scroll-repeater' || !!src.getAttribute('data-target-repeater');
    var centerScrollAllowed = isHub(btn) ? (perItem === '1' || (t.getAttribute('data-hub-center-scroll') !== '0' && (!m || m.getAttribute('data-hub-center-scroll') !== '0'))) : isRptAction;
    if (!isRptAction && (!isCenter || !centerScrollAllowed)) return;
    if (perItem !== '1' && isHub(btn) && m && m.getAttribute('data-item-scroll-mode') === '1' && !isRptAction) return;

    var stage = findRepeaterStage(btn, src !== t ? src : t);
    if (!stage) return;

    var scale = 1;
    var svg = (stage.ownerSVGElement) || (root && root.ownerSVGElement) || (root && root.matches && root.matches('svg') ? root : null);
    if (svg && svg.getScreenCTM) {
      try {
        var ctm = svg.getScreenCTM();
        if (ctm) {
          var det = ctm.a * ctm.d - ctm.b * ctm.c;
          if (det) scale = Math.sqrt(Math.abs(det)) || 1;
        }
      } catch (e) {}
    }
    var radius = getBtnRadius(t, btn);
    var originX = ev.clientX;
    var originY = ev.clientY;
    try {
      var rect = t.getBoundingClientRect ? t.getBoundingClientRect() : (btn.getBoundingClientRect ? btn.getBoundingClientRect() : null);
      if (rect && rect.width && rect.height) {
        originX = rect.left + rect.width / 2;
        originY = rect.top + rect.height / 2;
      }
    } catch (e) {}

    rptDrag = {
      btn: btn,
      target: t,
      stage: stage,
      scale: scale,
      radius: radius,
      originX: originX,
      originY: originY,
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      activeSpeed: 0,
      rafId: null,
      moved: false
    };
  }
  function onPointerMove(ev) {
    if (!rptDrag) return;
    var dx = rptDrag.lastX - ev.clientX;
    var dy = rptDrag.lastY - ev.clientY;
    var rawDx = ev.clientX - rptDrag.originX;
    var rawDy = ev.clientY - rptDrag.originY;
    var totalX = Math.abs(ev.clientX - rptDrag.startX);
    var totalY = Math.abs(ev.clientY - rptDrag.startY);
    if (!rptDrag.moved && (totalY >= 4 || totalX >= 4)) {
      rptDrag.moved = true;
    }
    if (!rptDrag.moved) return;

    var axis = rptDrag.stage.getAttribute('data-rpt-axis') || 'y';
    var dStep = axis === 'x' ? (Math.abs(dx) >= Math.abs(dy) ? dx : dy) : (Math.abs(dy) >= Math.abs(dx) ? dy : dx);

    // Auto-scroll continuous velocity:
    // Distance from the center of the button up/downwards sets velocity.
    // Limits are clamped to the button radius.
    var dist = axis === 'x' ? rawDx : rawDy;
    var R = rptDrag.radius || 32;
    var clamped = Math.max(-R, Math.min(R, dist));
    var deadZone = 3;
    var MAX_SPEED = 14;

    if (Math.abs(clamped) > deadZone) {
      var ratio = (clamped - (clamped > 0 ? deadZone : -deadZone)) / (R - deadZone);
      ratio = Math.max(-1, Math.min(1, ratio));
      rptDrag.activeSpeed = -ratio * MAX_SPEED;
    } else {
      rptDrag.activeSpeed = 0;
    }

    var view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    var hasRAF = !!(view && view.requestAnimationFrame);
    if (hasRAF) {
      if (!rptDrag.rafId) {
        rptDrag.rafId = view.requestAnimationFrame(autoScrollTick);
      }
    } else {
      // In synchronous/mock environments without RAF (like node test runner),
      // apply the direct step displacement preserving position on release.
      moveRepeater(rptDrag.stage, dStep / (rptDrag.scale || 1), true);
    }
    rptDrag.lastX = ev.clientX;
    rptDrag.lastY = ev.clientY;

    if (ev.preventDefault) ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
  }
  function onPointerEnd(ev) {
    if (rptDrag) {
      if (rptDrag.rafId) {
        var view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
        if (view && view.cancelAnimationFrame) view.cancelAnimationFrame(rptDrag.rafId);
      }
      if (rptDrag.moved) {
        suppressClickUntil = Date.now() + 250;
      }
      rptDrag = null;
    }
  }
  if (root.addEventListener) {
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerEnd);
    root.addEventListener('pointercancel', onPointerEnd);
    root.addEventListener('mousedown', function (ev) { if (!ev.pointerType) onPointerDown(ev); });
    root.addEventListener('mousemove', function (ev) { if (!ev.pointerType) onPointerMove(ev); });
    root.addEventListener('mouseup', function (ev) { if (!ev.pointerType) onPointerEnd(ev); });
  }
  if (doc && doc.addEventListener) {
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerEnd);
    doc.addEventListener('pointercancel', onPointerEnd);
  }
  function hubBack(ev) {
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.ud-btn'), function (btn) {
      var st = states.get(btn);
      if (!st || !st.path || !st.path.length || !isHub(btn)) return;
      var inside = false; try { inside = btn.contains(ev.target); } catch (e) { inside = false; }
      if (!inside) {
        var m = btn.querySelector('.ud-menu'), fixed = m && m.getAttribute('data-hub-fixed') === '1';
        if (fixed) {
          hubItems(btn).forEach(function (it) { spin(btn, it, false); });
        } else {
          spin(btn, hubItems(btn)[st.c || 0], false);
        }
        set(btn, { open: true, path: [], c: st.prev == null ? st.c : st.prev, prev: st.prev });
      }
    });
  }
  if (doc && doc.addEventListener) doc.addEventListener('click', hubBack);
  root.addEventListener('wheel', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.ud-btn') : null;
    if (!btn || !isHub(btn)) return;
    var m = btn.querySelector('.ud-menu');
    if (m && m.getAttribute('data-hub-fixed') === '1') return;
    var st = get(btn), n = hubItems(btn).length;
    if (st.path.length || n < 2) return;
    ev.preventDefault();
    var c = ((st.c || 0) + (ev.deltaY > 0 ? 1 : -1) + n) % n;
    set(btn, { open: true, path: [], c: c, prev: c });
  }, { passive: false });
  root.addEventListener('click', function (ev) {
    if (suppressClickUntil && Date.now() < suppressClickUntil) {
      if (ev.stopPropagation) ev.stopPropagation();
      if (ev.preventDefault) ev.preventDefault();
      return;
    }
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
      var sc2 = fanScroll(btn, t, st);
      if (sc2) { ev.stopPropagation(); set(btn, sc2); return; }
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
  return { get: get, set: set, apply: apply, findRepeaterStage: findRepeaterStage, moveRepeater: moveRepeater };
}
