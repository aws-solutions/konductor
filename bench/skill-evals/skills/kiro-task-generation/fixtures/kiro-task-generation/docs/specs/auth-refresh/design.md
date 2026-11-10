# Design Document: Auth Token Refresh

## Components

- Client `AuthInterceptor` (TypeScript, axios interceptor): proactive refresh at <60s, single-flight refresh promise, one retry.
- Server `POST /auth/refresh` in `TokenController`, backed by `TokenFamilyRepository` (Postgres table `refresh_tokens`: id, family_id, user_id, revoked_at, replaced_by).
- Rotation uses `UPDATE ... SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id` so a racing second call gets zero rows.
- Reuse detection: presenting a revoked token revokes every row in its family.

## Testing

Unit tests for the interceptor with a mocked axios adapter; integration tests for the controller against a test Postgres.
