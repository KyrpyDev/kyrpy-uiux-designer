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
  function get(btn) { var s = states.get(btn); if (!s) { s = isHub(btn) ? { open: true, path: [], c: 0, prev: 0 } : { open: false, path: [] }; states.set(btn, s); } return s; }
  function hubItems(btn) { return Array.prototype.slice.call(btn.querySelectorAll('.rm-level[data-level=""] .rm-hub-item')); }
  function layoutHub(btn, st) {
    var m = btn.querySelector('.ud-menu'), items = hubItems(btn), n = items.length, c = st.c || 0;
    var cx = +m.getAttribute('data-cx'), cy = +m.getAttribute('data-cy'), small = +m.getAttribute('data-hub-small'), gap = +m.getAttribute('data-hub-gap');
    var vert = m.getAttribute('data-hub-vertical') === '1', off = small + gap + small / 2, fan = st.path.length > 0;
    items.forEach(function (el, i) {
      var d = (i - c + n) % n, dx = 0, k = 0, o = 0, pos = 'hidden';
      if (d === 0) { k = 1; o = st.path.length > 1 ? 0 : 1; pos = 'center'; }
      else if (d === 1) { dx = off; k = 0.5; o = fan ? 0 : 1; pos = 'next'; }
      else if (d === n - 1) { dx = -off; k = 0.5; o = fan ? 0 : 1; pos = 'prev'; }
      el.style.setProperty('--x', (cx + (vert ? 0 : dx)) + 'px');
      el.style.setProperty('--y', (cy + (vert ? dx : 0)) + 'px');
      el.style.setProperty('--k', String(k));
      el.style.setProperty('--o', String(o));
      el.setAttribute('data-hub-pos', pos);
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
    if (hub) layoutHub(btn, st);
    btn.querySelectorAll('.rm-center').forEach(function (c) { c.classList.toggle('is-active', st.open && rotating && st.path.length > 0 && c.getAttribute('data-for') === key); });
  }
  function set(btn, st) { states.set(btn, st); apply(btn, st); if (opts.onState) opts.onState(btn, st); }
  function fire(btn, el) {
    if (opts.onAction) opts.onAction({
      menu: btn.getAttribute('data-menu'), item: el.getAttribute('data-item'), id: el.getAttribute('data-menu-id'), action: el.getAttribute('data-action'),
      target: el.getAttribute('data-target'), targetElement: el.getAttribute('data-popup-element'), targetElementId: el.getAttribute('data-popup-element-id')
    });
  }
  function hubStep(btn, t, st) {
    var items = hubItems(btn), n = items.length, c = st.c || 0, prev = st.prev == null ? c : st.prev;
    if (t.getAttribute('data-rm') === 'center') {
      if (st.path.length) { var np = st.path.slice(0, -1); return { open: true, path: np, c: np.length ? c : prev, prev: prev }; }
      var cur = items[c];
      if (!cur) return st;
      if (opts.onItem) opts.onItem(btn, cur);
      if (cur.getAttribute('data-children') === '1') return { open: true, path: cur.getAttribute('data-item').split('/'), c: c, prev: c };
      fire(btn, cur);
      return st;
    }
    if (t.hasAttribute && t.hasAttribute('data-hub-index')) {
      if (st.path.length) return st;
      var i = +t.getAttribute('data-hub-index');
      if (opts.onItem) opts.onItem(btn, t);
      return { open: true, path: t.getAttribute('data-children') === '1' ? t.getAttribute('data-item').split('/') : [], c: i, prev: c };
    }
    // an item of a fan (sub level)
    if (opts.onItem) opts.onItem(btn, t);
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
