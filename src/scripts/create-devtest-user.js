/**
 * Development / interface-test account: `devtest`, role admin with every permission, plus a long-lived access token.
 *
 *   node scripts/create-devtest-user.js [--db <file>] [--days 365]
 *
 * Writes DEVTEST_USERNAME / DEVTEST_PASSWORD / DEVTEST_TOKEN to <repo>/devtest.env (git-ignored, mode 600). Run again
 * to rotate the password and the token. The role is `admin`, not `superadmin`: the database allows exactly one
 * superadmin (publish rule 3). The account is private: the public export purges it.
 *
 * Browser tests (Playwright): before the page loads, set localStorage `ud_auth_token` to the token
 * (`context.addInitScript`), or send `Authorization: Bearer <token>` for API calls.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { hashUserPassword } from '../application/passwords.js';
import { sessionKey } from '../infrastructure/sqlite/session-token.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const prod = join(here, '..', 'data', 'designer.prod.db');
const dbFile = resolve(arg('db') || process.env.DESIGNER_DB_PATH || (existsSync(prod) ? prod : join(here, '..', 'data', 'designer.db')));
const days = Number(arg('days')) || 365;

const c = buildContainer({ dbFile, syncEnabled: false });
try {
  const password = randomBytes(12).toString('base64url');
  const token = `ud_${randomBytes(24).toString('hex')}`;
  const { passwordHash: hash, salt } = hashUserPassword(password);
  const db = c.db;
  const existing = db.prepare("SELECT id FROM users WHERE username = 'devtest'").get();
  let id = existing?.id;
  if (!id) {
    const made = c.auth.register({ username: 'devtest', email: 'devtest@local.dev', password, displayName: 'Dev Test', role: 'designer' });
    id = made.user.id;
  }
  db.prepare("UPDATE users SET role = 'admin', permissions = ?, password_hash = ?, salt = ?, status = 'active' WHERE id = ?")
    .run(JSON.stringify(['*']), hash, salt, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(sessionKey(token), id, expiresAt);
  const out = resolve(here, '..', '..', 'devtest.env');
  writeFileSync(out, `# devtest account of ${dbFile} (private; never commit)\nDEVTEST_USERNAME=devtest\nDEVTEST_PASSWORD=${password}\nDEVTEST_TOKEN=${token}\nDEVTEST_TOKEN_EXPIRES=${expiresAt}\n`, { mode: 0o600 });
  console.log(`devtest (id ${id}, role admin, all permissions) is ready; token valid until ${expiresAt}`);
  console.log(`credentials written to ${out}`);
} finally { c.close(); }
