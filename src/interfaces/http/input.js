import { ValidationError } from '../../domain/errors.js';

/** Query parameters that are ids, counts or sizes: whole numbers, never negative. */
export const NUMERIC_QUERY = new Set(['projectId', 'creatorId', 'targetId', 'itemId', 'authorId', 'limit', 'offset', 'size']);
const EMPTY = new Set(['', 'null', 'undefined']);
const MAX_ID = Number.MAX_SAFE_INTEGER;

/** A path id as a positive whole number; anything else is a 422 (it never reaches SQL as NaN). */
export function intId(value, name = 'id') {
  const s = String(value ?? '').trim();
  const n = /^\d{1,16}$/.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_ID) throw new ValidationError(`"${name}" must be a positive whole number`);
  return n;
}

/**
 * Checks the numeric query parameters in place: an empty one (`?projectId=`, `null`, `undefined` from a client
 * that had no value) is removed, a value that is not a whole number >= 0 is refused.
 */
export function checkQuery(query) {
  for (const name of NUMERIC_QUERY) {
    if (!query.has(name)) continue;
    const s = String(query.get(name)).trim();
    if (EMPTY.has(s)) { query.delete(name); continue; }
    if (!/^\d{1,16}$/.test(s) || !Number.isSafeInteger(Number(s))) throw new ValidationError(`Query parameter "${name}" must be a whole number`);
  }
  return query;
}

/** A request body is a JSON object or array (`null` counts as no body); a bare string, number or boolean is refused. */
export function checkBody(body) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object') throw new ValidationError('The request body must be a JSON object');
  return body;
}
