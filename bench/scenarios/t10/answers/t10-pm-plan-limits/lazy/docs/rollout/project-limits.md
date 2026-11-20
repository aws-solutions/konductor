# Active project limits rollout

## Preparation

Ship the catalogue, usage endpoint, account override field, and both flags together. Keep enforcement disabled while the service reports active counts and near-limit observations. Check that the service can read old account records with no override and that a support operator can identify the effective plan or override in the usage response.

## Ring progression

Move through the existing rings in order. The first phase is the developer ring, followed by staging, canary, and general. Shadow mode runs in the internal rings first. Review active-count distributions, warning volume, create conflicts, and batch row outcomes before enabling enforcement for the next ring. Compare shadow projections with actual rejects and investigate warning noise before promoting. A threshold is useful only when its unit and source are explicit, so each gate below names a catalogue metric and a count or millisecond unit.

## Rollback

If create failures, request latency, or import errors rise unexpectedly, stop advancement and disable `project_limits_enabled` for the affected ring. Keep the usage endpoint and shadow observations available while investigating. The application flag makes the admission decision reversible without deleting projects or changing stored plan data. If a release artifact must be reverted, restore the prior application files after the flag is off, then re-run the health and batch checks.

Resume only after the cause is understood and the previous ring is healthy. An override is a support remedy for a specific account, not a way to hide a broad catalogue or counting error.

```json
{
 "phases": [
  {
   "name": "shadow-dev",
   "audience": "internal",
   "ring": "dev",
   "gate": {
    "metric": "http_request_duration_ms",
    "unit": "milliseconds",
    "threshold": 175
   },
   "action": "observe only"
  },
  {
   "name": "shadow-staging",
   "audience": "internal test accounts",
   "ring": "staging",
   "gate": {
    "metric": "store_write_errors_total",
    "unit": "count",
    "threshold": 0
   },
   "action": "observe batch outcomes"
  }
 ],
 "rollback": {
  "trigger": "unexpected limit errors, import failures, or request latency",
  "steps": [
   "disable project_limits_enabled for the affected ring",
   "stop ring advancement"
  ]
 },
 "evidence": [
  "ops/metrics.csv:3",
  "ops/metrics.csv:3"
 ]
}
```
