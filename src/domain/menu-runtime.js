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
 * opts: onAction({menu,item,id,action,target}) · onState(btnEl,state) · keepOpen (editor: leaf click does not close) · onItem(btnEl, itemEl)
 * returns { get(btnEl), set(btnEl,state), apply(btnEl,state) }
 */
export function bindMenus(root, opts) {
  opts = opts || {};
  var states = new WeakMap();
  function get(btn) { var s = states.get(btn); if (!s) { s = { open: false, path: [] }; states.set(btn, s); } return s; }
  function apply(btn, st) {
    var menu = btn.querySelector('.ud-menu');
    var rotating = !!menu && menu.getAttribute('data-kind') === 'rotating';
    var key = st.path.join('/');
    btn.setAttribute('data-open', st.open ? '1' : '0');
    btn.setAttribute('data-center', rotating && st.open && st.path.length ? '1' : '0');
    btn.querySelectorAll('.rm-level').forEach(function (l) { l.classList.toggle('is-active', st.open && l.getAttribute('data-level') === key); });
    btn.querySelectorAll('.rm-center').forEach(function (c) { c.classList.toggle('is-active', st.open && rotating && st.path.length > 0 && c.getAttribute('data-for') === key); });
  }
  function set(btn, st) { states.set(btn, st); apply(btn, st); if (opts.onState) opts.onState(btn, st); }
  root.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-rm="center"], .rm-item') : null;
    if (!t) return;
    var btn = t.closest('.ud-btn');
    if (!btn) return;
    var st = get(btn), next;
    if (t.getAttribute('data-rm') === 'center') {
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
  return { get: get, set: set, apply: apply };
}
