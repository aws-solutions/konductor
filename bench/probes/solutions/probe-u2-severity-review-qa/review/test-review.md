# Review of test/orders.test.js

Reviewed against `docs/feature-spec.md` and `src/orders.js`. No files were changed.

## Findings

### 1. The refund authorization test asserts nothing

Severity: critical

`refund by another customer is rejected` wraps `requestRefund` in a `try`/`catch` with an empty catch block and has no assertion. It passes whether or not the call throws. In `src/orders.js`, `requestRefund` never looks at `actor`, so any customer can refund any cancelled order, and this test hides the hole.
Recommendation: use `assert.throws` with the message `not allowed` and add the ownership check to `requestRefund`.

### 2. Error paths and the approval branch are untested

Severity: important

There is no test that a shipped order cannot be cancelled (rule 1), none that a non-owner cannot cancel (rule 2), and none for the pending-approval state of a refund over 500.00 (rule 4). Only happy paths are covered.
Recommendation: add one test for each, including the 500.00 boundary (below, at, above).

### 3. No rounding case for money

Severity: important

Prices are summed as floating-point numbers in `itemsTotal` and the tests only use amounts that happen to come out exact. A price such as 0.10 times 3 gives 0.30000000000000004, and nothing checks the rounding to two decimals.
Recommendation: add a test with such a price and decide where the amount is rounded.

### 4. Test names say nothing

Severity: suggestion

Two tests are named `test 1` and `test 2`. Rename them after the rule they cover, for example `owner can cancel a placed order`.

### 5. Repeated order literals

Severity: suggestion

Every test builds its order object by hand. A small `makeOrder(overrides)` helper would cut the repetition and make each test's intent clearer.
