# Test coverage review report: inventory-api

Inputs: `test-gap-analysis.md` and `e2e-test-strategy.md` in this folder. Source and tests were not changed.

## Summary

- 7 source files, 2 test files, 8 tests, all passing.
- Gaps found: 4 critical, 5 important, 4 suggestions (see the gap analysis).
- The handlers and the server have no tests, and both Critical code defects (string-built SQL, missing token check) live there or behind them.

## Security test plan

| Domain | Planned tests |
|--------|---------------|
| Authentication | Create and adjust without `X-Admin-Token` return 403; wrong token returns 403; token comes from `ADMIN_TOKEN`, not the fallback. |
| Input validation | Invalid `delta` (NaN, fraction, negative result), invalid name and quantity, oversize body. |
| API security | SQL injection payload on `/search` returns nothing extra; unknown routes return 404. |
| Data protection | 500 responses contain no stack; the fallback token is not accepted when `ADMIN_TOKEN` is set. |
| Session management | The service has no sessions; confirm no cookies are set and that the token is not echoed in responses. |
| Error handling | Invalid JSON gives 400; service exceptions give a generic 500 and are logged server side. |
| Infrastructure | Server binds to 127.0.0.1 by default; startup fails without `ADMIN_TOKEN` once that rule exists. |

## Release assessment

- The P0 scenarios in `e2e-test-strategy.md` do not exist yet and would fail on today's code.
- Behaviour documented in the README (400 responses, token on stock changes, reorder at or below the level) is not verified by any test.

Verdict: NOT READY

Reasons:

1. Authorization and input validation on the stock route are untested and broken.
2. The search injection would pass the current suite unnoticed.
3. No handler or server tests exist.
4. Concurrency and the reorder boundary are untested; both have real defects.

Re-run this review after the P0 and P1 tests are added and passing.
