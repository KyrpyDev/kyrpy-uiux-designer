/**
 * System (non-human) accounts. They cannot sign in (empty password hash, status `suspended`), cannot be
 * updated or deleted, and no session or API key is ever issued for them.
 *
 *  - `public`: the immutable placeholder owner of the public library. Every `visibility='public'` design
 *    item is owned by it (creator_id = root_owner_id = public user id), and the GitHub snapshot
 *    (`npm run db:export-public`) exports ONLY this user's public items.
 *  - `kyrpy-agent-designer`: attribution for AI-applied changes (see mcp/domain/agent-user.js).
 *
 * Ids differ between databases (autoincrement), so always resolve them by username.
 */
import { AGENT_USERNAME, AGENT_EMAIL } from '../mcp/domain/agent-user.js';

export const PUBLIC_USERNAME = 'public';
export const PUBLIC_EMAIL = 'public@kyrpy.local';
export const PUBLIC_DISPLAY_NAME = 'Public Library';
export const PUBLIC_AVATAR_COLOR = '#8b949e';

export const SYSTEM_USERNAMES = new Set([PUBLIC_USERNAME, AGENT_USERNAME]);
export const RESERVED_EMAILS = new Set([PUBLIC_EMAIL, AGENT_EMAIL]);

export const isSystemUsername = name => SYSTEM_USERNAMES.has(String(name ?? '').trim().toLowerCase());
export const isReservedEmail = email => RESERVED_EMAILS.has(String(email ?? '').trim().toLowerCase());
export const isSystemUser = u => !!u && isSystemUsername(u.username);

/** Id of the public library owner in this SQLite db, or null when the users table / row is missing. */
export function publicUserId(db) {
  try {
    return db.prepare('SELECT id FROM users WHERE username = ?').get(PUBLIC_USERNAME)?.id ?? null;
  } catch { return null; }
}

/**
 * Owner of a record written without an actor: the superadmin, found by role (ids differ between databases and can
 * change after a PostgreSQL pull). Id 1 is only the last resort.
 */
export function defaultOwnerId(db) {
  try {
    const row = db.prepare("SELECT id FROM users WHERE role = 'superadmin' AND username NOT IN (?, ?) ORDER BY id LIMIT 1")
      .get(PUBLIC_USERNAME, AGENT_USERNAME);
    return row?.id ?? 1;
  } catch { return 1; }
}

/**
 * Create the public user if missing (idempotent) and return its id. Throws when the username is held by
 * a real (password-bearing or active) account, which must never become the library owner.
 */
export function ensurePublicUser(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) return null;
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password_hash, salt, display_name, role, status, permissions, avatar_color)
    VALUES (?, ?, '', '', ?, 'viewer', 'suspended', '[]', ?)`).run(PUBLIC_USERNAME, PUBLIC_EMAIL, PUBLIC_DISPLAY_NAME, PUBLIC_AVATAR_COLOR);
  const u = db.prepare('SELECT id, password_hash, status FROM users WHERE username = ?').get(PUBLIC_USERNAME);
  if (!u) throw new Error(`could not create system user "${PUBLIC_USERNAME}" (email ${PUBLIC_EMAIL} taken?)`);
  if (u.password_hash !== '' || u.status !== 'suspended') {
    throw new Error(`username "${PUBLIC_USERNAME}" is held by a real account; rename it before upgrading`);
  }
  return u.id;
}

export const DESIGN_TABLES = ['paths', 'icons', 'buttons', 'elements', 'screens', 'workflows'];

/** Ownership / lineage fields an edit (PUT / patch) may never change; only create, clone and migrations set them. */
export const OWNERSHIP_FIELDS = ['creatorId', 'rootOwnerId', 'clonedFromId', 'rootItemId'];
export function stripOwnership(patch) {
  const out = { ...(patch || {}) };
  for (const k of OWNERSHIP_FIELDS) delete out[k];
  return out;
}

/**
 * Re-owns every `visibility='public'` row of the design tables and `trash_items` to the public user
 * (creator_id = root_owner_id = pub). Returns the number of rows changed. No-op when pub is null.
 */
export function reownPublicRows(db, pub) {
  if (pub == null) return 0;
  let changed = 0;
  for (const t of [...DESIGN_TABLES, 'trash_items']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) continue;
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
    if (!cols.includes('creator_id') || !cols.includes('root_owner_id') || !cols.includes('visibility')) continue;
    changed += Number(db.prepare(`UPDATE "${t}" SET creator_id = ?, root_owner_id = ?
      WHERE visibility = 'public' AND (creator_id IS NOT ? OR root_owner_id IS NOT ?)`).run(pub, pub, pub, pub).changes);
  }
  return changed;
}

