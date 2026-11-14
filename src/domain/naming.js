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

/** A project's global unique prefix: set once when the project is created (2-16 chars, lowercase letter first). */
export const PROJECT_PREFIX_RE = /^[a-z][a-z0-9]{1,15}$/;
export function isValidProjectPrefix(prefix) { return typeof prefix === 'string' && PROJECT_PREFIX_RE.test(prefix); }

/**
 * Variable name of a public item dropped onto a screen: `projectprefix-[itemtype]-itemname`
 * (lowercase, dashed; e.g. untrap-element-scan-button). Without a prefix the item name alone is used.
 */
export function prefixedVariableName(prefix, itemType, itemName) {
  const base = slugify(String(itemName ?? ''), 'item');
  if (!prefix) return base;
  return `${prefix}-${slugify(String(itemType || 'item'), 'item')}-${base}`;
}
