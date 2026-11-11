/**
 * Offline copy of GET answers (PERF-10). The answers live in IndexedDB: writes do not block the page, the value
 * is stored as it is (no JSON text), and the size is not limited to the few megabytes of `localStorage`.
 * Without IndexedDB (private windows of some browsers, tests) a `localStorage` driver with a size cap is used.
 *
 * A driver is `{ get(key), set(key, record), delete(key), keys() }`, all returning promises; a record is
 * `{ data, at }`.
 */
export const CACHE_MAX_ENTRIES = 200;
const DB_NAME = 'ud-response-cache', STORE = 'responses';
const LS_MAX_CHARS = 2 * 1024 * 1024;

export function idbDriver(idb) {
  let opening = null;
  const open = () => (opening ||= new Promise((resolve, reject) => {
    const rq = idb.open(DB_NAME, 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => { opening = null; reject(rq.error); };
    rq.onblocked = () => { opening = null; reject(new Error('cache database is blocked')); };
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const rq = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(rq?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('cache write aborted'));
    });
  };
  return {
    get: key => run('readonly', s => s.get(key)),
    set: (key, record) => run('readwrite', s => s.put(record, key)),
    delete: key => run('readwrite', s => s.delete(key)),
    keys: () => run('readonly', s => s.getAllKeys())
  };
}

export function localStorageDriver(storage, prefix) {
  const each = fn => { for (let i = storage.length - 1; i >= 0; i--) { const k = storage.key(i); if (k && k.startsWith(prefix)) fn(k); } };
  return {
    async get(key) { const raw = storage.getItem(key); return raw ? { data: JSON.parse(raw), at: 0 } : undefined; },
    async set(key, record) {
      const text = JSON.stringify(record.data);
      if (text.length > LS_MAX_CHARS) throw new Error('too large for localStorage');
      storage.setItem(key, text);
    },
    async delete(key) { storage.removeItem(key); },
    async keys() { const out = []; each(k => out.push(k)); return out; }
  };
}

/**
 * @param {object} driver see above
 * @param {object} [opts] `maxEntries`, `now` (clock for tests)
 * `put` never throws and never waits for the caller: it returns a promise of true / false (stored or not).
 */
export function createResponseCache(driver, { maxEntries = CACHE_MAX_ENTRIES, now = () => Date.now() } = {}) {
  let writes = 0;
  const trim = async () => {
    const keys = await driver.keys();
    if (keys.length <= maxEntries) return;
    const aged = [];
    for (const k of keys) aged.push([k, (await driver.get(k))?.at ?? 0]);
    aged.sort((a, b) => a[1] - b[1]);
    for (const [k] of aged.slice(0, keys.length - maxEntries)) await driver.delete(k);
  };
  return {
    async get(key) {
      try { return (await driver.get(key))?.data; } catch { return undefined; }
    },
    async put(key, data) {
      const record = { data, at: now() };
      try { await driver.set(key, record); }
      catch {
        // full (or too large): the other answers go first, then one more try
        try {
          for (const k of await driver.keys()) if (k !== key) await driver.delete(k);
          await driver.set(key, record);
        } catch { return false; }
      }
      if (++writes % 20 === 0) { try { await trim(); } catch { /* next round */ } }
      return true;
    },
    async delete(key) { try { await driver.delete(key); } catch { /* nothing to remove */ } },
    trim
  };
}

/** The page's cache: IndexedDB when there is one, else `localStorage`, else nothing is kept. */
export function defaultResponseCache(prefix) {
  const g = globalThis;
  try {
    if (g.indexedDB) return createResponseCache(idbDriver(g.indexedDB));
    if (g.localStorage) return createResponseCache(localStorageDriver(g.localStorage, prefix));
  } catch { /* storage disabled */ }
  return createResponseCache({ get: async () => undefined, set: async () => { throw new Error('no storage'); }, delete: async () => {}, keys: async () => [] });
}
