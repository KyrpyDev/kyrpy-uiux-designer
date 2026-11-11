/** Helpers and errors shared by the user / project / collaboration services. */
import { DomainError } from '../domain/errors.js';

/** A step that failed inside a larger operation which goes on without it: logged, never silent. Returns the message. */
export function noteSkipped(what, e) {
  const msg = `${what}: ${e?.message || e}`;
  console.warn(`[collab] skipped — ${msg}`);
  return msg;
}
/** A copy of a parent/child list (`id`, `parentId`) ordered by real depth, so a parent always precedes its children at any nesting level. */
export function parentsFirst(list = []) {
  const byId = new Map(list.map(x => [x.id, x]));
  const depth = x => { let d = 0, cur = x; const seen = new Set(); while (cur?.parentId != null && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId); d++; } return d; };
  return list.map((x, i) => ({ x, i, d: depth(x) })).sort((a, b) => a.d - b.d || a.i - b.i).map(o => o.x);
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Permission denied for this operation') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/** Raised after too many failed sign-in attempts for one account from one address. */
export class TooManyAttemptsError extends DomainError {
  constructor(retryAfterSec) {
    super(`Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`, 'TOO_MANY_ATTEMPTS', 429);
    this.retryAfterSec = retryAfterSec;
  }
}
