Request changes before enabling the worker. The scheduled path does not preserve the ledger's atomicity or retry guarantees, and its time and amount handling disagree with the project contracts. Reconciliation also silently omits a class of accounts, so the current tests do not provide enough protection for production scheduling.

- `src/scheduled-transfers.js:21` — **critical**: The debit and credit are appended with separate calls, with balance mutations between them. A crash after either call can leave one journal line and an unbalanced ledger. Wrap the complete journal and balance update in the store's transaction API, and ensure the two lines commit atomically.
- `src/scheduled-transfers.js:25` — **critical**: The client-key lookup runs after the journal and balance writes. A retry therefore posts a second movement before it is reported as a duplicate. Check the idempotency key before writing, and keep the uniqueness check inside the transaction as well.
- `src/scheduled-transfers.js:5` — **high**: `parseFloat(amount) * scale` followed by `Math.floor` is unsafe for decimal money strings and can turn `0.29` into 28 minor units. Use an exact decimal-to-integer conversion that validates the configured scale.
- `src/reconcile.js:5` — **medium**: Filtering out accounts created today contradicts the operations rule that reconciliation checks every account. Remove the same-day filter so new accounts are included in the report.
- `src/scheduler.js:17` — **high**: The catch path records and returns `done` for a failed transfer. That suppresses retry of transient failures and makes the operator state misleading. Record an error or failed status and leave the schedule eligible for retry.
- `src/scheduler.js:5` — **medium**: `getHours()` and `getMinutes()` interpret a UTC schedule in the server's local timezone. The repeated local time at a daylight-saving fallback can satisfy the same daily schedule twice. Match the configured timezone or UTC offset and persist a run identity that handles the fallback.

```json
[
  {
    "location": "src/scheduled-transfers.js:21",
    "severity": "critical",
    "issue": "The debit and credit are written in separate calls, so a crash between them can leave an unbalanced journal.",
    "fix": "Run the journal and balance changes in one atomic transaction."
  },
  {
    "location": "src/scheduled-transfers.js:25",
    "severity": "critical",
    "issue": "The client-key idempotency check occurs after the journal and balance writes, so retries can double-post.",
    "fix": "Check the unique client key before writing and enforce it inside the transaction."
  },
  {
    "location": "src/scheduled-transfers.js:5",
    "severity": "high",
    "issue": "Floating-point parsing and flooring can convert a decimal amount such as 0.29 to the wrong integer minor units.",
    "fix": "Use an exact decimal parser for integer conversion."
  },
  {
    "location": "src/reconcile.js:5",
    "severity": "medium",
    "issue": "The same-day filter omits newly created accounts from reconciliation even though the operations contract includes all accounts.",
    "fix": "Remove the filter and reconcile all accounts."
  },
  {
    "location": "src/scheduler.js:17",
    "severity": "high",
    "issue": "A caught transfer failure is recorded and returned as done, preventing retries and misreporting the outcome.",
    "fix": "Record a failed error status and leave the job eligible for retry."
  },
  {
    "location": "src/scheduler.js:5",
    "severity": "medium",
    "issue": "Local server time is used for a UTC schedule, allowing the repeated daylight-saving fallback time to run the transfer twice.",
    "fix": "Use UTC or the configured timezone offset and a run identity that handles fallback."
  }
]
```
