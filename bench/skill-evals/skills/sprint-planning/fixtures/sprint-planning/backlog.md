# Backlog (solo developer, notifications service)

1. Fix flaky `test/login.spec.ts` that fails about 1 in 10 CI runs.
2. Add `Retry-After` header to 429 responses in the API gateway handler.
3. Migrate the nightly cleanup cron from a server crontab to an EventBridge schedule + Lambda.
4. New "digest email" feature: API endpoint, preferences UI toggle, and the scheduled sender.
5. Integrate notifications with billing, identity and audit services (three services, new auth between them).
6. Update the on-call runbook for the new alarm names.
7. Bump the AWS SDK minor version across the service.
8. Add unit tests for `src/templates/render.ts` (currently 0% coverage).
9. Investigate and fix duplicate push notifications reported by two customers.
