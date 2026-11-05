/** Tiny DOM helpers: h() builds nodes, modal()/toast()/confirmBox()/promptBox() are the shared dialogs. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function toast(message, kind = 'info', ms = 3200) {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * Opens a modal. content: Node. Returns {close, requestClose, el}.
 * `beforeClose` (optional, may be async) can veto the user's attempts to close (✕, Esc, click outside) by returning false;
 * `close()` always closes, `requestClose()` asks first.
 */
export function modal({ title, content, wide = false, full = false, w90 = false, onClose, actions, beforeClose }) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: `modal-box${wide ? ' wide' : ''}${full ? ' full' : ''}${w90 ? ' w90' : ''}`, role: 'dialog', 'aria-label': title });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  let asking = false;
  const requestClose = async () => {
    if (!beforeClose) return close();
    if (asking) return;
    asking = true;
    try { if (await beforeClose()) close(); } finally { asking = false; }
  };
  const onKey = e => { if (e.key === 'Escape' && overlay === root.lastElementChild) { e.stopPropagation(); requestClose(); } };
  const head = h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', title: 'Close', onclick: requestClose }, '✕'));
  box.append(head, h('div', { class: 'modal-body' }, content));
  if (actions) box.append(h('div', { class: 'modal-actions' }, actions(close)));
  const overlay = h('div', { class: 'modal-overlay', onmousedown: e => { if (e.target === overlay) requestClose(); } }, box);
  root.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  return { close, requestClose, el: box };
}

/** A question with several answers. buttons: [{label, value, kind?: 'primary'|'danger'}]; resolves to the chosen value, or null when dismissed. */
export function choiceBox(title, message, buttons) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    modal({ title, content: h('p', {}, message), onClose: () => finish(null),
      actions: close => buttons.map(b => h('button', { class: `btn${b.kind ? ` ${b.kind}` : ''}`, onclick: () => { finish(b.value); close(); } }, b.label)) });
  });
}

export function confirmBox(message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    modal({ title: 'Please confirm', content: h('p', {}, message), onClose: () => finish(false),
      actions: close => [h('button', { class: 'btn', onclick: () => { finish(false); close(); } }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { finish(true); close(); } }, okLabel)] });
  });
}

export function promptBox(title, { value = '', label = 'Name', okLabel = 'OK', multiline = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const input = multiline ? h('textarea', { rows: 6, value }) : h('input', { type: 'text', value });
    input.value = value;
    const m = modal({ title, content: h('label', { class: 'field' }, h('span', {}, label), input), onClose: () => finish(null),
      actions: close => [h('button', { class: 'btn', onclick: () => { finish(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { finish(input.value); close(); } }, okLabel)] });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) { finish(input.value); m.close(); } });
    setTimeout(() => { input.focus(); input.select?.(); }, 30);
  });
}

export function download(filename, content, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Context menu at screen position (x, y). items: [{label, kbd?, fn, disabled?} | '-']. Closes on outside click, Esc or blur.
 */
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', onOut, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', close); };
  const onOut = e => { if (!menu.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    menu.append(h('button', { class: 'menu-item', role: 'menuitem', disabled: !!it.disabled, onclick: () => { close(); it.fn?.(); } }, h('span', {}, it.label), it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null));
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  document.addEventListener('pointerdown', onOut, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  return close;
}
