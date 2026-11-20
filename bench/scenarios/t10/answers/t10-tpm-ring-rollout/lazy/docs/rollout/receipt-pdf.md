# Receipt PDF rollout plan

The release owner opens a rollout record with state at zero for every audience and attaches the build identifier. The service on-call owns the live halt path. Every decision includes the exact snapshot file, UTC evaluation time, and the printed command result.

## Operating sequence

Start with staff at 7 percent. After the staff window has ten contiguous complete minutes below its ring-specific promotion limit, move to 18 percent, then 35 percent, then 70 percent. Repeat the same sequence for pilot, regional, and general, but use the window and limits assigned to that audience. Do not use a later ring while its predecessor is incomplete.

The regional calendar has a freeze window. During any active freeze the release owner records HOLD and waits; a good snapshot does not override the calendar. A missing minute, unknown header, absent metric, or insufficient sample is also HOLD. A rollback-level value is ROLLBACK and stops expansion.

## Rollback

The on-call may halt immediately without waiting for the release owner. Roll back the highest enabled audience first, using the library's explicit rollback operation, then move down through enabled rings until the affected change is disabled. Preserve the previous artifact and the legacy generator, record the triggering snapshot, and notify the release owner and partner owners. Resume only after a new complete window and a recorded approval.

## Completion

At 70 percent general, compare PDF error rate and delivery success with the pre-release snapshot, close the rollout record, and leave the old generator in place until the compatibility date. Removal is a separate change with its own review.

```json
{
 "phases": [
  {
   "name": "staff-10",
   "audience": "staff",
   "gate": {
    "metric": "receipt_error_rate",
    "unit": "percent",
    "threshold": 1
   },
   "action": "Enable 10 percent after a complete window and post the snapshot."
  },
  {
   "name": "pilot-25",
   "audience": "pilot",
   "gate": {
    "metric": "receipt_error_rate",
    "unit": "percent",
    "threshold": 1.05
   },
   "action": "Enable the next pilot step after its own complete window and owner acknowledgement."
  }
 ],
 "rollback": {
  "trigger": "A ring-specific rollback threshold, an operator halt, or a material compatibility failure.",
  "steps": [
   "Halt new promotion and preserve the triggering snapshot and artifact.",
   "Invoke explicit rollback on the highest enabled general ring, then work downward through regional and other enabled rings."
  ]
 },
 "evidence": [
  "ops/rings.json:3",
  "ops/budget-policy.json:3",
  "ops/freeze-calendar.csv:2"
 ]
}
```
