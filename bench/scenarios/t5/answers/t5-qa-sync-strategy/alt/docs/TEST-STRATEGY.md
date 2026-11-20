# Customer sync test strategy

The migration weekend needs confidence in data preservation and restart behavior before operator convenience. The order below puts tests that can silently lose or alter customers ahead of reporting polish.

## Risk tests and the cost of skipping them: notes

| Priority | Location | Test to add | If skipped |
| --- | --- | --- | --- |
| Critical | `src/migration/batch-runner.js` | Inject a process failure after checkpoint persistence and before target writes. Restart from that checkpoint and assert every source row is present. | A crash can advance the cursor past a batch, causing silent customer loss. |
| Critical | `src/capture/apply-change.js` | Make the first target attempt fail after its side effect and let the retry run. Assert the operation is idempotent or that a stable change identifier prevents a second side effect. | A transient error can apply a non-idempotent change twice. |
| Critical | `src/migration/resume.js` | Stop midway, invoke the real resume path, and compare the final target with a clean full run. Include an empty checkpoint and a checkpoint at the last row. | A path that only looks correct in isolation can skip or repeat data during the weekend restart. |
| High | `src/mapping/field-mapper.js` | Use values above field limits, invalid numbers, empty values, and long text. Assert the contract says whether to reject, preserve, or explicitly transform each value. | Silent truncation, `NaN`, and a false zero can change customer data without an alarm. |
| High | `src/conflicts/resolve-conflict.js` | Present equal timestamps in both input orders and with different source priorities. Assert the documented winner is unchanged by iteration order. | Replaying the same changes in another order can produce different customer records. |
| High | `src/conflicts/timestamps.js` | Compare equivalent instants with different offsets and compare a timestamp without an offset under a fixed non-UTC process zone. | Records near a boundary can be ordered differently by host timezone. |
| High | `src/verification/verify-migration.js` | Keep source and target counts equal while changing, removing, and adding field values. Assert verification reports the mismatch and identifies affected records. | A green count-only report can approve a corrupt migration. |
| Medium | `src/queue/dead-letter-queue.js` | Enqueue the same record for validation, target, and timeout failures, then inspect and replay the stored entries. Assert the original reason and useful context survive. | Operators may see an unhelpful dead letter and retry the wrong fix. |

The two-week plan should stop at a critical or high failure that can lose, duplicate, or mis-order data. A medium dead-letter finding can proceed only if operators still have a reliable alternate error record. Low-risk formatting and generated-artifact checks belong in the normal suite after the data path is covered.

## Order for the two weeks: notes

| Window | Focus | Exit condition |
| --- | --- | --- |
| Days 1-2 | Mapping, timestamp parsing, and conflict resolution | Boundary values, time zones, and equal-version cases have explicit expected results. |
| Days 3-5 | Batch writes, checkpoints, and resume | A forced stop at each boundary restarts without loss or an unplanned duplicate. |
| Days 6-7 | Captured changes, retry, and dead letters | Transient failures, permanent failures, and replay produce auditable outcomes. |
| Days 8-9 | Verification and reconciliation | Matching counts are not enough; changed and missing field values are detected. |
| Days 10-12 | CLI flows and a production-shaped rehearsal | Operators can run, stop, resume, inspect, and verify a representative copy. |
| Days 13-14 | Defect retest and go/no-go evidence | Critical and high findings are closed or have an explicit migration-weekend decision. |

## Additional coverage: notes

The change reader should reject or report a sequence gap rather than quietly presenting an incomplete stream. The admin command should return a non-zero result for an unknown command and for an invalid plan size. These tests protect operator feedback but follow the data-integrity cases above.

```json
[
    {
        "fix": "Add a crash-injection test between checkpoint write and batch commit, then resume and assert no records are skipped.",
        "severity": "critical",
        "location": "src/migration/batch-runner.js"
    },
    {
        "fix": "Add a retry test where the first attempt has a side effect and assert idempotency or deduplication by change ID.",
        "severity": "critical",
        "location": "src/capture/apply-change.js"
    },
    {
        "fix": "Add an end-to-end restart test from an empty and partial checkpoint and compare it with a clean run.",
        "severity": "critical",
        "location": "src/migration/resume.js"
    },
    {
        "fix": "Add boundary and invalid-value tests that require validation and preserve precision instead of silent truncation or coercion.",
        "severity": "high",
        "location": "src/mapping/field-mapper.js"
    },
    {
        "fix": "Add order-independent equal-timestamp tests with an explicit deterministic tie rule.",
        "severity": "high",
        "location": "src/conflicts/resolve-conflict.js"
    },
    {
        "fix": "Add UTC and offset-aware timezone tests, including a naive timestamp under a non-UTC zone.",
        "severity": "high",
        "location": "src/conflicts/timestamps.js"
    },
    {
        "fix": "Add content and field comparison tests with equal counts but changed, missing, and extra records.",
        "severity": "high",
        "location": "src/verification/verify-migration.js"
    },
    {
        "fix": "Add dead-letter tests that preserve the error reason, message, and record context through storage and replay.",
        "severity": "medium",
        "location": "src/queue/dead-letter-queue.js"
    },
    {
        "fix": "Add a sequence-gap test and require an explicit incomplete-stream result.",
        "severity": "high",
        "location": "src/capture/change-reader.js"
    },
    {
        "fix": "Add invalid-command and invalid-plan tests that assert a useful non-zero operator result.",
        "severity": "low",
        "location": "src/cli/commands.js"
    }
]
```
