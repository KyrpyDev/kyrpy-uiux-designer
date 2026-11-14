/**
 * One search rule for the whole app (library, pickers, browsers, trash, projects, workflows, changes, exports).
 *
 * A query is split into words at spaces, dashes, underscores, dots, commas and slashes, and an item matches when
 * EVERY word appears somewhere in its searchable text (label, name, variable name / key, tags, description-dev…),
 * in any order. Case and accents are folded (Turkish ş/ğ/ı/İ/ç/ö/ü too), so "home screen", "screen home",
 * "home-screen" and "Home Screen" all find "untrap-home-screen" and an item labelled "Home Screen".
 */

/** Lower-cases and strips accents: "İçerik Şablonu" → "icerik sablonu". */
export function foldSearchText(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i');
}

const SEPARATORS = /[\s\-_.,/\\|:;]+/g;

/** The words of a query (folded; separators dropped). Empty query → []. */
export function searchTerms(q) {
  return foldSearchText(q).split(SEPARATORS).filter(Boolean);
}

/**
 * Searchable text: folded, every separator (space, dash, underscore…) turned into one space, with a space in front,
 * so " <word>" marks the start of a word ("untrap-home-screen" → " untrap home screen").
 */
export function foldSearchHaystack(v) {
  return ` ${foldSearchText(v).replace(SEPARATORS, ' ').trim()}`;
}

/** Where a word may match: a one-character word only at the start of a word ("0" finds "Screen 0", not "Screen 10"). */
const needle = t => (t.length === 1 ? ` ${t}` : t);

/** The folded text of an item's searchable fields (arrays, e.g. tags, are flattened). */
export function searchHaystack(...fields) {
  return foldSearchHaystack(fields.flat(Infinity).filter(v => v != null && v !== '').join(' '));
}

/**
 * True when every word of `q` is in the item's fields. `q` may be a query string or the result of searchTerms
 * (pass the terms when filtering many items). An empty query matches everything.
 */
export function matchesSearch(q, ...fields) {
  const terms = Array.isArray(q) ? q : searchTerms(q);
  if (!terms.length) return true;
  const hay = searchHaystack(...fields);
  return terms.every(t => hay.includes(needle(t)));
}

/** The usual searchable fields of a library item (screen, element, button, icon, workflow, theme…). */
export function itemSearchFields(it = {}) {
  return [it.label, it.name, it.key, it.category, it.tags, it.descriptionDev, it.description];
}

/**
 * SQL for a multi-word search over columns: one `LIKE` per word on all the columns joined, so every word has to
 * appear in some column. `fold` is the SQL function registered by the database (ufold) that applies foldSearchHaystack.
 * Returns { sql: '' , args: [] } for an empty query.
 */
export function sqlSearch(q, columns, { fold = 'ufold' } = {}) {
  const terms = searchTerms(q);
  if (!terms.length || !columns.length) return { sql: '', args: [] };
  const hay = `${fold}(${columns.map(c => `COALESCE(${c}, '')`).join(` || ' ' || `)})`;
  return {
    sql: `(${terms.map(() => `${hay} LIKE ? ESCAPE '\\'`).join(' AND ')})`,
    args: terms.map(t => `%${needle(t).replace(/[\\%_]/g, '\\$&')}%`)
  };
}
