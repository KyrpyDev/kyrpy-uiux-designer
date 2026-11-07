/**
 * Self-service profile routes. They live under /api/auth/ so read-only (viewer) accounts can still edit
 * their own profile and password; ProfileService itself requires a real session token for every call.
 */
export function profileRoutes(router, c) {
  router.get('/api/auth/profile', ({ token }) => c.profile.get(token));
  router.put('/api/auth/profile', ({ token, body }) => c.profile.update(token, body));
  router.post('/api/auth/profile/password', ({ token, body }) => c.profile.changePassword(token, body));
  router.get('/api/auth/profile/sessions', ({ token }) => ({ sessions: c.profile.sessions(token) }));
  router.post('/api/auth/profile/sessions/revoke-others', ({ token }) => c.profile.revokeOtherSessions(token));
  router.delete('/api/auth/profile/sessions/:sid', ({ token, params }) => c.profile.revokeSession(token, params.sid));
}
