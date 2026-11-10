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

/*
 * The same marks for this browser session only (sessionStorage; reset when another user signs in): the designers'
 * History menu lists them per designer type. `names` remembers what an item was called (screens and workflows are not
 * in the library lists the menu could look them up in).
 */
const SESSION = 'uiux.edited.session';
let session = { uid: null, keys: [], names: {} };
try { const raw = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); if (raw && Array.isArray(raw.keys)) session = { uid: raw.uid ?? null, keys: raw.keys.filter(k => typeof k === 'string').slice(0, 200), names: raw.names && typeof raw.names === 'object' ? raw.names : {} }; } catch { /* storage may be blocked */ }
const saveSession = () => { try { sessionStorage.setItem(SESSION, JSON.stringify(session)); } catch { /* ignore */ } };
/** Items edited in this session, most recent first; `type` keeps one designer's items ("type:id" keys). */
export const sessionEdited = (type = '') => (type ? session.keys.filter(k => k.startsWith(`${type}:`)) : session.keys);
/** Id of the item of `type` that was edited last (this session first, else the remembered marks), or null. */
export function lastEdited(type) {
  const k = sessionEdited(type)[0] || list.find(x => x.startsWith(`${type}:`));
  return k ? Number(k.split(':')[1]) : null;
}
export function rememberName(type, id, name) { const k = `${type}:${id}`; if (name && session.names[k] !== name) { session.names[k] = String(name); saveSession(); } }
export const editedName = (type, id) => session.names[`${type}:${id}`] || '';
/** A session belongs to one signed-in user: another user starts with an empty history. */
export function setEditedSessionUser(uid) {
  const u = uid == null ? null : Number(uid);
  if (session.uid === u) return;
  if (session.uid != null) session = { uid: u, keys: [], names: {} }; else session.uid = u;
  saveSession();
}

export function markEdited(type, id) {
  if (!type || id == null) return;
  const k = `${type}:${id}`;
  if (session.keys[0] !== k) { session.keys = [k, ...session.keys.filter(x => x !== k)].slice(0, 200); saveSession(); }
  if (list[0] === k) return;
  list = [k, ...list.filter(x => x !== k)].slice(0, MAX);
  changed();
}
export function unmarkEdited(type, id) { const k = `${type}:${id}`; if (session.keys.includes(k)) { session.keys = session.keys.filter(x => x !== k); saveSession(); } if (list.includes(k)) { list = list.filter(x => x !== k); changed(); } }
export function clearEdited() { if (list.length) { list = []; changed(); } }
export const editedKeys = () => list;
/** Map "type:id" -> recency rank (0 = edited last); cached until the list changes. */
export function editedIndex() { if (!index) index = new Map(list.map((k, i) => [k, i])); return index; }
export function onEditedChange(fn) { subs.add(fn); return () => subs.delete(fn); }
