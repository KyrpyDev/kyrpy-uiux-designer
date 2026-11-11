/**
 * Session tokens are stored hashed: the `sessions.token` column holds `h1:` + sha256(token), so a copy of the
 * database (backup, sync, snapshot) cannot be used to sign in. The clear token only exists in the browser.
 */
import { createHash } from 'node:crypto';

export const SESSION_KEY_PREFIX = 'h1:';
const sha = token => createHash('sha256').update(String(token)).digest('hex');

/** Value stored in `sessions.token` for a clear token. */
export const sessionKey = token => `${SESSION_KEY_PREFIX}${sha(token)}`;

/** Short public id of a session (first 16 hex chars of the hash); safe to show and to use in URLs. */
export const sessionId = token => sha(token).slice(0, 16);

/** Public id from a stored value (hashed row, or a clear token written before hashing existed). */
export const sessionIdOfStored = stored => (String(stored).startsWith(SESSION_KEY_PREFIX)
  ? String(stored).slice(SESSION_KEY_PREFIX.length, SESSION_KEY_PREFIX.length + 16)
  : sessionId(stored));
