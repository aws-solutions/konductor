# Receipt PDF rollout plan

The release owner opens a rollout record with state at zero for every audience and attaches the build identifier. The service on-call owns the live halt path. Every decision includes the exact snapshot file, UTC evaluation time, and the printed command result.

## Completion

At 100 percent general, compare PDF error rate and delivery success with the pre-release snapshot, close the rollout record, and leave the old generator in place until the compatibility date. Removal is a separate change with its own review.

```json
{
  "evidence": [
    "docs/runbook.md:5",
    "docs/partners.md:3",
    "ops/freeze-calendar.csv:2",
    "ops/budget-policy.json:3",
    "ops/rings.json:3"
  ],
  "rollback": {
    "steps": [
      "Halt new promotion and preserve the triggering snapshot and artifact.",
      "Invoke explicit rollback on the highest enabled general ring, then work downward through regional and other enabled rings.",
      "Do not remove the old generator: Ledger Lantern needs its envelope through 2025-09-30. Notify owners and require a new complete window before resuming."
    ],
    "trigger": "A ring-specific rollback threshold, an operator halt, or a material compatibility failure."
  },
  "phases": [
    {
      "action": "Enable 10 percent after a complete window and post the snapshot.",
      "gate": {
        "threshold": 1,
        "unit": "percent",
        "metric": "receipt_error_rate"
      },
      "audience": "staff",
      "name": "staff-10"
    },
    {
      "action": "Enable the next pilot step after its own complete window and owner acknowledgement.",
      "gate": {
        "threshold": 1.5,
        "unit": "percent",
        "metric": "receipt_error_rate"
      },
      "audience": "pilot",
      "name": "pilot-25"
    },
    {
      "action": "Enable regional traffic only outside the 2025-12-20 to 2026-01-03 calendar freeze.",
      "gate": {
        "threshold": 2,
        "unit": "percent",
        "metric": "receipt_error_rate"
      },
      "audience": "regional",
      "name": "regional-50"
    },
    {
      "action": "Enable all merchants after the general window and partner confirmation.",
      "gate": {
        "threshold": 2.5,
        "unit": "percent",
        "metric": "receipt_error_rate"
      },
      "audience": "general",
      "name": "general-100"
    }
  ]
}
```

## Rollback

The on-call may halt immediately without waiting for the release owner. Roll back the highest enabled audience first, using the library's explicit rollback operation, then move down through enabled rings until the affected change is disabled. Preserve the previous artifact and the legacy generator, record the triggering snapshot, and notify the release owner and partner owners. Resume only after a new complete window and a recorded approval.

## Operating sequence

Start with staff at 10 percent. After the staff window has ten contiguous complete minutes below its ring-specific promotion limit, move to 25 percent, then 50 percent, then 100 percent. Repeat the same sequence for pilot, regional, and general, but use the window and limits assigned to that audience. Do not use a later ring while its predecessor is incomplete.

The regional calendar has a freeze window. During any active freeze the release owner records HOLD and waits; a good snapshot does not override the calendar. A missing minute, unknown header, absent metric, or insufficient sample is also HOLD. A rollback-level value is ROLLBACK and stops expansion.

Before each move, the release owner posts the decision and evidence in the release channel and tags the service on-call and the audience owner. The partner owner acknowledges the compatibility impact before the first external audience. The old receipt generator and envelope stay deployed while the dependent consumer finishes migration.
