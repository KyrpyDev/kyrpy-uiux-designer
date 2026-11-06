/**
 * Stable, instance-independent item identity.
 *
 * - `uuidv7()` is used when the application issues an id itself (time-ordered, RFC 9562).
 * - Rows inserted by code that does not know about `uid` get a random v4 UUID from a SQLite trigger
 *   (see `UID_SQL_EXPR`). Both are valid UUIDs; nothing may depend on the version nibble.
 */
export const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUid = v => typeof v === 'string' && UID_RE.test(v);

/** RFC 9562 UUIDv7. `randomBytes` is injected so the function stays usable in browser and node. */
export function uuidv7(randomBytes, now = Date.now()) {
  const b = new Uint8Array(randomBytes(16));
  let ts = BigInt(now);
  for (let i = 5; i >= 0; i--) { b[i] = Number(ts & 0xffn); ts >>= 8n; }
  b[6] = (b[6] & 0x0f) | 0x70;   // version 7
  b[8] = (b[8] & 0x3f) | 0x80;   // RFC variant
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** SQL expression producing a random v4 UUID in SQLite (used by insert triggers and backfill). */
export const UID_SQL_EXPR = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;
