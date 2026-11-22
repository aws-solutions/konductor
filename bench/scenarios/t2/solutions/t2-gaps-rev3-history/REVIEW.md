# Review

I would not approve this revision yet. The change touches customer balances, expiry, and staff operations, but the new tests cover only sequential happy paths. The earlier review history also matters here: the open redemption-policy thread remains unresolved, while one regression resembles a previously settled concern.

Findings:

- `src/routes-redeem.js:8` reads the balance and writes a lower value in separate operations. Two concurrent requests can both observe the same balance and both succeed, overspending the customer. Use the store's compare-and-set or another atomic transaction for the debit.
- `src/expiry-job.js:7` derives the comparison date with the server's local timezone and bypasses `businessDate`. A server west of a customer can expire that customer's points on the previous UTC business date. Compare using the configured UTC business date.
- `src/points-ledger.js:9` floors every earn result. This drops fractional points on every order even though `earnPrecision` and the API contract allow two decimal places. Round to the configured decimal precision instead of truncating.
- `src/routes-admin.js:11` adds a balance-writing handler without calling `requireRole`. The existing inspection route requires the admin role, so this new route lets callers change points without authorization. Apply the same admin-role middleware before the write.
- `src/routes-earn.js:10` retries `credit`, which reads and writes the balance and has no idempotency key. If the write succeeds before a timeout, the retry credits the order again. Add idempotency or remove the retry around the non-idempotent operation.
- `src/validation.js:10` still validates only that redemption points are positive. The current redemption handler uses this validator but no longer enforces the 10,000-point policy from `config/points-policy.json`, so the open review thread remains a service-side limit gap. Enforce the configured maximum in the validator or handler.

```json
[
  {
    "location": "src/routes-redeem.js:8",
    "severity": "critical",
    "issue": "The redemption handler reads a balance and later writes the decremented value without an atomic guard, so two concurrent redemptions can both pass the check and overspend the customer.",
    "fix": "Use compare-and-set or an atomic transaction for the debit."
  },
  {
    "location": "src/expiry-job.js:7",
    "severity": "high",
    "issue": "Expiry uses the server local calendar date instead of the configured UTC business date, so customers east of the server can lose points a day early.",
    "fix": "Use the configured UTC business date or timezone-aware businessDate helper."
  },
  {
    "location": "src/points-ledger.js:9",
    "severity": "medium",
    "issue": "Flooring every earn result discards fractional points even though the policy supports two decimal places.",
    "fix": "Round to the configured decimal precision and preserve fractional points."
  },
  {
    "location": "src/routes-admin.js:11",
    "severity": "high",
    "issue": "The new balance-adjustment handler writes customer balances without the admin role check used by the existing staff route.",
    "fix": "Call requireRole for the admin role before changing the balance."
  },
  {
    "location": "src/routes-earn.js:10",
    "severity": "high",
    "issue": "Retrying the non-idempotent credit operation can double-credit an earn when the first write succeeds but its response times out.",
    "fix": "Add idempotency or remove the retry around credit."
  },
  {
    "location": "src/validation.js:10",
    "severity": "medium",
    "issue": "The redemption validator accepts any positive amount and the current handler no longer applies the configured 10,000-point maximum.",
    "fix": "Enforce the maximum limit of 10000 in validation or the handler."
  }
]
```
