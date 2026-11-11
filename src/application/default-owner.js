/**
 * The account that owns a record written without an actor (imports, seeds, scripts): the superadmin, found by
 * role. Ids differ between databases and can change after a PostgreSQL pull, so the literal id 1 is only the
 * last resort (BUG-13).
 *
 * `host` is a service: its users repository is taken from `users`, `auth.users` or `collaboration.users`.
 */
export function fallbackOwnerId(host) {
  const users = host?.users ?? host?.auth?.users ?? host?.collaboration?.users ?? null;
  try { return users?.defaultOwnerId?.() ?? 1; } catch { return 1; }
}
