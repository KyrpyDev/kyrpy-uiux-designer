/**
 * HMAC pepper for API key hashes. Resolution order:
 *   1. env KYRPY_UIUX_KEY_PEPPER
 *   2. KYRPY_UIUX_KEY_PEPPER in <repo>/.env, credentials.env or config.env (all git-ignored)
 *   3. <db folder>/mcp-key-pepper, created with mode 0600 on first use (git-ignored)
 *   4. in-memory random value for ':memory:' databases (tests)
 *
 * Losing the pepper invalidates every API key (owners then create new keys); it never exposes them.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_NAME = 'KYRPY_UIUX_KEY_PEPPER';
export const PEPPER_FILE_NAME = 'mcp-key-pepper';
const MIN_LENGTH = 32;

function fromEnvFiles() {
  for (const f of ['.env', 'credentials.env', 'config.env'].map(n => join(repoRoot, n))) {
    if (!existsSync(f)) continue;
    const m = new RegExp(`^\\s*(?:export\\s+)?${ENV_NAME}\\s*=\\s*["']?([^"'\\r\\n#]+)`, 'm').exec(readFileSync(f, 'utf8'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/** Returns { pepper, source } for the given database file. */
export function loadKeyPepper(dbFile) {
  const fromEnv = process.env[ENV_NAME] || fromEnvFiles();
  if (fromEnv) {
    if (fromEnv.length < MIN_LENGTH) throw new Error(`${ENV_NAME} must be at least ${MIN_LENGTH} characters`);
    return { pepper: fromEnv, source: 'env' };
  }
  if (!dbFile || dbFile === ':memory:') return { pepper: randomBytes(32).toString('hex'), source: 'memory' };
  const file = join(dirname(resolve(dbFile)), PEPPER_FILE_NAME);
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim();
    if (v.length >= MIN_LENGTH) return { pepper: v, source: 'file' };
  }
  mkdirSync(dirname(file), { recursive: true });
  const v = randomBytes(32).toString('hex');
  writeFileSync(file, `${v}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX file systems */ }
  return { pepper: v, source: 'file' };
}
