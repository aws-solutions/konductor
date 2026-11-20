# Checkout rework test plan

The first tests should protect money movement and state transitions. A green happy-path checkout currently says little about whether the same request is safe to repeat, whether two buyers can take the same unit, or whether a provider timeout means a charge happened. I would add the tests below before spending time on broad regression coverage.

## Execution plan: notes

Add focused unit tests for pricing and allocation first, then deterministic integration tests for checkout, provider callbacks, and settlement boundaries. Run the existing suite on every change and keep provider, clock, inventory, mailer, and feature configuration injectable in the new cases. After these boundaries are covered, add a small cross-feature matrix for promo, tax, receipt, refund, and settlement combinations rather than duplicating happy paths.

The expected output of this plan is a short list of failing tests that expose behavior, not a rewrite of application modules. The application source, generated tax data, existing tests, and CI setup should remain unchanged while the test gaps are being mapped.

## Secondary coverage: notes

`src/promos/codes.js` increments a code's usage while pricing rather than when an order is committed. Add a failed-payment and abandoned-checkout test so a code is not consumed without a completed order, and add a concurrent-use case at the limit.

The generated tax table in `data/tax-rates.generated.json` deserves a schema and one lookup smoke test, but its size is not a reason to put it ahead of money, payment, inventory, and cutoff boundaries. The awkward code in `src/admin/reconcile.js` is a read-only comparison tool; give it malformed-row and amount-format smoke coverage after the checkout risks are protected.

### 8. Mail failure visibility: notes

**Risk: medium.** `src/notifications/email.js` catches a mailer error and returns a false status without using the supplied logger or preserving the error. The paid order can remain correct, but operators and a retry worker have no reliable signal that the receipt was not sent.

Make the mailer fail and assert that the failure is recorded with the order id, that the result is unambiguously retryable, and that a successful send is not recorded twice. The test should also assert that sensitive message contents are not logged. Decide whether the caller receives an error or a durable notification task, then keep that contract stable.

### 7. Inventory guard default: notes

**Risk: high.** `src/orders/checkout.js` only calls `reserve` when `requireInventoryGuard` is true, and `config/feature-flags.json` turns that flag off. A new process can therefore charge an out-of-stock order without a caller explicitly opting into protection.

Start the application with the checked-in defaults and zero stock. A checkout must be rejected before charging. Add an explicit opt-out test if the business still permits one, and test that the guard runs before the payment provider. The safe default should enable the guard, with any bypass visible and tightly scoped.

### 6. Settlement cutoff and server timezone: notes

**Risk: high.** `src/jobs/settlement.js` uses `Date#setHours`, which uses the process's local timezone, while `config/default.json` names UTC as the settlement timezone. A host timezone change can move transactions between nightly batches.

Run boundary cases one minute before, exactly at, and one minute after the cutoff with a process timezone different from UTC. Assert the result against the configured timezone, including a daylight-saving transition. The job should construct the cutoff in the configured timezone or receive a timezone-aware clock rather than using server-local hours.

### 5. Partial refund allocation: notes

**Risk: high.** `src/orders/refunds.js` derives a fractional share from item counts and converts a dollar total through the cents helper. A three-item order can leave a cent unrefunded or refund too much when partial requests are made in different orders.

Add tests for one of three equal items, two of three items, repeated partial refunds, tax-inclusive totals, and a final remainder. The sum of all approved partial refunds must equal the original refundable cents, never exceed it, and never depend on request order. The refund path should allocate integer cents and assign any remainder deterministically.

### 4. Currency arithmetic and stored totals: notes

**Risk: high.** `src/orders/price.js` sums JavaScript numbers and applies discount and tax before converting only the final value to cents. Values such as 0.10 and 0.20 can produce a different cent result, and intermediate rounding can disagree with the displayed total.

Add table cases for decimal prices, percentage tax, a discount, zero quantity, and a total that is exactly halfway between cents. Assert both the displayed amount and the integer amount sent to the provider. Add a multi-line case where rounding each line differs from rounding only at the end, then choose and document the product rule. Monetary calculations should use integer cents, with one explicit rounding rule at the currency boundary.

### 3. Concurrent inventory reservations: notes

**Risk: critical.** `src/inventory/reservation.js` reads all quantities, yields, then writes the decremented quantities. Two requests can read the same stock before either write completes and both receive a reservation.

Use a barrier in a fake repository or a controlled pause so two reservations overlap. With one available unit, exactly one request may succeed and the final quantity must never be negative. Repeat with multiple lines for one SKU and verify that a failed multi-line reservation leaves every line unchanged. The repository operation needs an atomic compare-and-decrement or an equivalent transaction boundary.

### 2. Webhook replay and duplicate delivery: notes

**Risk: critical.** `src/payments/webhook.js` accepts a valid signed body and writes the order state, but it does not remember an event identifier or reject an old delivery. Payment callbacks are routinely delivered more than once, and a valid signature does not make a delivery new.

Add tests that deliver the same signed event twice and assert one state transition and one downstream effect. Deliver a signed event with an already-seen event id and an event outside the allowed age window. The handler should be idempotent, validate freshness, and make a duplicate an acknowledged no-op. Include a different event for the same order so the state transition rules are explicit.

### 1. Payment retry after an ambiguous timeout: notes

**Risk: critical.** `src/payments/retry.js`, through the charge call in `src/orders/checkout.js`, retries every thrown error. A payment provider can accept a charge and then lose the response, so the second attempt can create a second charge. This is the largest customer and reconciliation risk.

Add a test with a fake provider that records the first charge, then throws a timeout after accepting it. The second call must not produce another charge. Also test that a retry carries one stable idempotency key and that a clearly rejected request can still retry. The implementation should query or use the provider's idempotency facility for an ambiguous result rather than blindly repeating the operation.

## Priority order: notes

## Machine-readable findings: notes

```json
[
    {
        "fix": "Test an ambiguous timeout and use a stable idempotency key or provider status lookup so a retry cannot double-charge.",
        "severity": "critical",
        "location": "src/payments/retry.js"
    },
    {
        "fix": "Test duplicate and stale webhook deliveries, then add event idempotency and replay protection.",
        "severity": "critical",
        "location": "src/payments/webhook.js"
    },
    {
        "fix": "Test concurrent reservations and enforce an atomic compare-and-decrement to prevent overselling.",
        "severity": "critical",
        "location": "src/inventory/reservation.js"
    },
    {
        "fix": "Test decimal totals and convert calculations to integer cents with explicit rounding.",
        "severity": "high",
        "location": "src/orders/price.js"
    },
    {
        "fix": "Test partial refund rounding and allocate integer cents with a deterministic remainder.",
        "severity": "high",
        "location": "src/orders/refunds.js"
    },
    {
        "fix": "Test the cutoff in a non-UTC server timezone and compute it using the configured UTC timezone.",
        "severity": "high",
        "location": "src/jobs/settlement.js"
    },
    {
        "fix": "Test the default feature flag with zero stock and enable the inventory guard before charging.",
        "severity": "high",
        "location": "src/orders/checkout.js"
    },
    {
        "fix": "Test mail failure reporting and record or propagate the error for retry and observability.",
        "severity": "medium",
        "location": "src/notifications/email.js"
    },
    {
        "fix": "Test failed and abandoned orders so promo usage is committed only after payment succeeds.",
        "severity": "medium",
        "location": "src/promos/codes.js"
    }
]
```
