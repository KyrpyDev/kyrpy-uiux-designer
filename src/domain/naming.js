/** Naming rules: every design object has a unique dashed "variable name" (key) used in code. */
const KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function slugify(text, fallback = 'item') {
  const s = String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const out = /^[a-z]/.test(s) ? s : (s ? `${fallback}-${s}` : fallback);
  return out;
}

export function isValidKey(key) { return typeof key === 'string' && KEY_RE.test(key); }

/** Human readable label from a key: "folder-ai-analyze" -> "Folder ai analyze". */
export function labelFromKey(key) {
  const s = String(key).replace(/-/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Returns `base`, or `base-2`, `base-3`... the first one for which `exists(key)` is false. */
export function uniqueKey(base, exists) {
  let key = slugify(base);
  if (!exists(key)) return key;
  let n = 2;
  while (exists(`${key}-${n}`)) n++;
  return `${key}-${n}`;
}
