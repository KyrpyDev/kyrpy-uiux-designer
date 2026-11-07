/**
 * Items the user edited: most recent first, remembered in this browser (localStorage, best effort).
 * The library lists them before everything else and draws their edge red; `clearEdited()` resets the marks.
 * Keys are "type:id". No imports: api.js calls markEdited after every successful write, the library panels read editedIndex().
 */
const STORE = 'uiux.edited';
const MAX = 40;
let list = [];
try { const raw = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(raw)) list = raw.filter(k => typeof k === 'string').slice(0, MAX); } catch { /* storage may be blocked */ }
let index = null;
const subs = new Set();

function changed() {
  index = null;
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* ignore */ }
  for (const fn of subs) { try { fn(list); } catch (e) { console.error(e); } }
}

export function markEdited(type, id) {
  if (!type || id == null) return;
  const k = `${type}:${id}`;
  if (list[0] === k) return;
  list = [k, ...list.filter(x => x !== k)].slice(0, MAX);
  changed();
}
export function unmarkEdited(type, id) { const k = `${type}:${id}`; if (list.includes(k)) { list = list.filter(x => x !== k); changed(); } }
export function clearEdited() { if (list.length) { list = []; changed(); } }
export const editedKeys = () => list;
/** Map "type:id" -> recency rank (0 = edited last); cached until the list changes. */
export function editedIndex() { if (!index) index = new Map(list.map((k, i) => [k, i])); return index; }
export function onEditedChange(fn) { subs.add(fn); return () => subs.delete(fn); }
