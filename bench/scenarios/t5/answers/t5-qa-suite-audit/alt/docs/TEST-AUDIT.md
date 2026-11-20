# Test suite audit

The suite reports broad execution but several tests do not provide independent evidence. A passing result in these cases mostly proves that the test can reproduce the implementation or avoid exercising the meaningful branch.

### `test/invoice-snapshot.test.js` — medium: notes

The test overwrites the snapshot with the current result before reading it. Any regression becomes the new expected file and the comparison can never fail. Keep the snapshot committed and read-only during the test. Review intentional updates separately, and add direct assertions for fields whose value must not drift.

### `test/discounts.test.js` — medium: notes

The loop gets its inputs from a filter that produces no rows for the fixture invoice. Its assertion body therefore never runs, and `assert.ok(true)` masks that fact. Supply a non-empty case containing the behavior under test, assert that the collection is non-empty before iterating, and include a contrasting case that should be excluded.

### `test/api-routes.test.js` — high: notes

The route test checks only the status. It would pass if the handler returned the wrong invoice, omitted the body, or returned an incorrect error shape. Assert the response body, including the created invoice identity, and add a not-found response assertion with its error payload.

### `test/webhook-failure.test.js` — high: notes

The catch block discards every error and the final assertion is unconditional. The test passes if parsing succeeds, throws the wrong error, or throws for the wrong reason. Assert that an invalid signature or malformed payload throws the expected validation error, and separately assert the valid event path.

### `test/retry.test.js` — high: notes

The test replaces `dunning.nextAttempt` and then calls the replacement. It never runs the retry policy implementation, so any schedule or limit bug is invisible. Call the real function and assert its first, last, and exhausted attempts. If a collaborator must be isolated, stub only that collaborator rather than the function being tested.

### `test/invoice-contract.test.js` — high: notes

Both sides of the equality come from `makeInvoice` with the same input. This cannot detect a missing field, an incorrect due date, or a bad total. Build the expected object from literal fields, or assert the important fields and line amounts separately. Keep a case with an extra line and an explicit due date.

### `test/proration-preview.test.js` — critical: notes

The expected proration amount is calculated with the same difference, remaining-days, and total-days formula used by `src/proration.js`. A defect copied into both expressions passes unchanged. Use independently chosen examples with fixed expected cents, especially the first and last day of a cycle, and assert the reported day counts as well as the amount.

### `test/proration.test.js` — critical: notes

The test compares `result.amountCents` with itself. That assertion remains true for a wrong amount, including a wrong rounding rule or a boundary calculation. The plan-name assertion does not cover the money result. Replace it with a literal expected amount for a mid-cycle change and add cases for a cycle boundary, a month with a different number of days, and a downgrade that produces a credit.

## Findings: notes

## Additional gaps: notes

`test/service.test.js` should assert the exact charge request sent to the payment gateway, including the invoice amount and token. Its current fake returns a result but does not prove that the service passed the right data.

`test/date.test.js` should exercise the proration cycle boundary with a date equal to the next cycle start. The date helpers are covered, but the caller's boundary contract is not.

The long reconciliation test and the payment adapter test are not false confidence merely because they are large or use doubles. The reconciliation test supplies many independent entries and checks every report row. The adapter test isolates an external client while verifying both the translated request and translated result, which is the behavior that adapter-level test owns.

```json
[
    {
        "fix": "Replace the self-comparison with independent literal expected amounts and boundary cases.",
        "severity": "critical",
        "location": "test/proration.test.js"
    },
    {
        "fix": "Assert literal expected invoice fields, line amounts, totals, and due dates instead of recomputing the output.",
        "severity": "high",
        "location": "test/invoice-contract.test.js"
    },
    {
        "fix": "Run the real retry implementation and assert its schedule and exhausted behavior; stub only external dependencies.",
        "severity": "high",
        "location": "test/retry.test.js"
    },
    {
        "fix": "Assert the expected validation error for invalid signatures and malformed payloads, plus a valid event case.",
        "severity": "high",
        "location": "test/webhook-failure.test.js"
    },
    {
        "fix": "Use independent fixed expected proration amounts and day counts for boundary and mid-cycle examples.",
        "severity": "critical",
        "location": "test/proration-preview.test.js"
    },
    {
        "fix": "Assert response bodies and error payloads as well as status codes.",
        "severity": "high",
        "location": "test/api-routes.test.js"
    },
    {
        "fix": "Use a non-empty input case, assert it is exercised, and cover both included and excluded adjustments.",
        "severity": "medium",
        "location": "test/discounts.test.js"
    },
    {
        "fix": "Read a committed snapshot without overwriting it, review updates separately, and assert important fields directly.",
        "severity": "medium",
        "location": "test/invoice-snapshot.test.js"
    },
    {
        "fix": "Spy on the gateway request and assert the exact amount, invoice id, and payment token passed to it.",
        "severity": "medium",
        "location": "test/service.test.js"
    },
    {
        "fix": "Add a caller-level case for a change exactly at the next cycle boundary.",
        "severity": "low",
        "location": "test/date.test.js"
    }
]
```
