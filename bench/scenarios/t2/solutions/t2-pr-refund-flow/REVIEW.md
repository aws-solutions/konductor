# Review of PR 214

This should not merge yet. The endpoint adds a useful refund path, but the current implementation can move money twice, can cross merchant boundaries, and can exceed an order's captured balance under concurrent requests. It also logs data that the repository's logging rules explicitly exclude. The single full-refund test does not exercise the paths where these failures occur.

The highest-risk fixes are to make retries return the original result, authorize the merchant against the order before doing any work, and make the balance check and ledger write one conditional transaction. The amount conversion should use the existing minor-unit contract, and the audit fields should be redacted before logging. Add tests for those behaviors before release.

## Findings

- **Critical, duplicate refunds on retry.** The new route sends the request straight to `refundOrder`; although the repository already has an idempotency store and request-key helper, this flow never reads or records them. A client or proxy retry can therefore create another refund, ledger entry, and merchant event. Store the result under the request key and return it for a repeat, with the write protected by the same atomic operation.

- **Medium, floating-point money conversion.** `Number(amount) * 100` does not implement the integer minor-unit boundary documented for the ledger. Values such as `0.29` can become a non-integer and be rejected by `appendEntry`, while other values can carry a binary rounding error. Parse the decimal string with the currency exponent and pass an integer minor-unit value to the ledger.

- **High, missing merchant ownership check.** Captures compare the authenticated merchant with `order.merchantId`, but refunds only load the order and use the caller-supplied merchant id in the new entry. A merchant that learns another order id can refund that order. Apply the same ownership authorization before calculating or writing the refund.

- **Critical, non-atomic captured-balance enforcement.** The service totals existing refunds, checks the remaining balance, yields, and then appends the entry. Two partial requests can observe the same remaining balance and both succeed. Move the check and reservation or ledger insert into a transaction or conditional update that fails when the captured balance has changed.

- **High, sensitive values in logs.** The created-event log includes the complete card fingerprint and customer email. The logging documentation forbids both fields, and log access is broader than payment access. Redact those values and keep only the approved identifiers or a provider reference suffix.

- **Medium, insufficient refund tests.** The new test checks only one successful full refund and the expected event. It does not cover partial amounts, retries, cross-merchant requests, concurrent limit enforcement, invalid amounts, or over-refunds. Add focused tests for those cases so the failure modes above are enforced in CI.

```json
[
  {
    "location": "src/http/routes.js:19",
    "severity": "critical",
    "issue": "The refund route does not apply the existing idempotency key helper, so a retried request can create duplicate refunds and ledger entries.",
    "fix": "Read and atomically store an idempotency key and return the original result for repeats."
  },
  {
    "location": "src/refunds/service.js:18",
    "severity": "medium",
    "issue": "The service multiplies a decimal amount with floating point instead of parsing an integer minor-unit value required by the ledger.",
    "fix": "Parse the decimal using the currency exponent and pass integer minor units to the ledger."
  },
  {
    "location": "src/refunds/service.js:17",
    "severity": "high",
    "issue": "The service never checks that the order belongs to the authenticated merchant, allowing cross-merchant refunds.",
    "fix": "Add the same merchant ownership check used by capture before calculating the refund."
  },
  {
    "location": "src/refunds/service.js:25",
    "severity": "critical",
    "issue": "The balance check and ledger write are separated by an asynchronous gap with no conditional guard, so concurrent partial refunds can exceed the captured amount.",
    "fix": "Use an atomic transaction or conditional update that reserves the remaining balance."
  },
  {
    "location": "src/refunds/service.js:44",
    "severity": "high",
    "issue": "The log includes the full card fingerprint and customer email despite the repository logging rules.",
    "fix": "Redact the fingerprint and email and log only approved identifiers or a reference suffix."
  },
  {
    "location": "test/refunds.test.js:6",
    "severity": "medium",
    "issue": "The only refund test is a successful full-refund case and leaves partial, duplicate, ownership, limit, and invalid-input behavior untested.",
    "fix": "Add partial, duplicate, ownership, limit, and invalid-input tests."
  }
]
```