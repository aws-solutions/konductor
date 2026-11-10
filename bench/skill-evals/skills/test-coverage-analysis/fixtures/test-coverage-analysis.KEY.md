# test-coverage-analysis fixture key
backend-api/ (Express backend -> testing pyramid expected):
- Covered: AC-1.1 (unit + integration), AC-1.2 (unit).
- Uncovered: AC-1.3 (requestReset / SendGrid, no test), AC-1.4 (EXPIRED_TOKEN -> 410 path, no test), AC-2.1 (Stripe integration, no test), AC-2.2 (StripeCardError -> 402 error path, no test).
- AC-2.3 is manual-only (email rendering in Gmail/Outlook) -> Manual Testing Required with steps.
- NFR-1 (p99 latency) has no performance test; NFR-2 bcrypt unverified by tests.
- Integration points without integration tests: Stripe, SendGrid.
- Readiness mode: core error paths and payment flow untested -> should be NOT ready / blocking.
frontend-app/ (React -> testing trophy expected):
- Only shallow unit/snapshot tests of leaf components; no integration tests of ProductPage/CartPage flows; AC-3.1..AC-3.4 uncovered (AC-3.4 checkout form does not even exist in code).
