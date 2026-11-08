/**
 * AI-assisted design: project "versions" are separate projects named `<master>-v001`, `<master>-v002` …
 * The link to the master is recorded in the project settings (`settings.ai.versionOf = { master, number }`);
 * the name suffix is only the display convention, never trusted to find versions.
 */
export const VERSION_SUFFIX_RE = /-v(\d{3,})$/;

export const pad3 = n => String(n).padStart(3, '0');

/** `app-v002` → `{ base: 'app', number: 2 }`, a plain key → null. */
export function parseVersionSuffix(key) {
  const m = VERSION_SUFFIX_RE.exec(String(key || ''));
  return m ? { base: String(key).slice(0, m.index), number: Number(m[1]) } : null;
}

/** `{key:'app', name:'App'}`, 3 → `{ key: 'app-v003', name: 'App-v003' }`. */
export function versionIdentity(master, number) {
  const suffix = `-v${pad3(number)}`;
  return { key: `${master.key}${suffix}`, name: `${master.name}${suffix}` };
}

/** Accepts 2, "2", "v2", "v002", or the full version key; returns the version number or null. */
export function parseVersionRef(ref, masterKey = '') {
  if (ref === undefined || ref === null || ref === '') return null;
  if (Number.isInteger(ref)) return ref > 0 ? ref : null;
  const s = String(ref).trim().toLowerCase();
  let m = /^v?(\d{1,6})$/.exec(s);
  if (m) return Number(m[1]) || null;
  m = VERSION_SUFFIX_RE.exec(s);
  if (m && (!masterKey || s === `${masterKey}-v${m[1]}`)) return Number(m[1]);
  return null;
}
