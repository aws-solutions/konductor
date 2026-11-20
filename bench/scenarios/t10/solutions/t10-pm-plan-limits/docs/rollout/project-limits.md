# Active project limits rollout

## Preparation

Ship the catalogue, usage endpoint, account override field, and both flags together. Keep enforcement disabled while the service reports active counts and near-limit observations. Check that the service can read old account records with no override and that a support operator can identify the effective plan or override in the usage response.

## Ring progression

Move through the existing rings in order. The first phase is the developer ring, followed by staging, canary, and general. Shadow mode runs in the internal rings first. Review active-count distributions, warning volume, create conflicts, and batch row outcomes before enabling enforcement for the next ring. Compare shadow projections with actual rejects and investigate warning noise before promoting. A threshold is useful only when its unit and source are explicit, so each gate below names a catalogue metric and a count or millisecond unit.

Before the general ring, sample accounts already above their plan limit. Their projects should still be present, while a new create returns `project_limit_reached`. Test an expired support override with a fixed UTC timestamp. Exercise a batch with both accepted and rejected rows and confirm response order.

## Rollback

If create failures, request latency, or import errors rise unexpectedly, stop advancement and disable `project_limits_enabled` for the affected ring. Keep the usage endpoint and shadow observations available while investigating. The application flag makes the admission decision reversible without deleting projects or changing stored plan data. If a release artifact must be reverted, restore the prior application files after the flag is off, then re-run the health and batch checks.

Resume only after the cause is understood and the previous ring is healthy. An override is a support remedy for a specific account, not a way to hide a broad catalogue or counting error.

The closing record uses repository-relative `path:line` evidence and names only metrics and rings that exist in the operational catalogue.

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
        "threshold": 250
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
    },
    {
      "name": "enforce-canary",
      "audience": "one percent",
      "ring": "canary",
      "gate": {
        "metric": "http_request_duration_ms",
        "unit": "milliseconds",
        "threshold": 300
      },
      "action": "enable enforcement"
    },
    {
      "name": "enforce-general",
      "audience": "all customer accounts",
      "ring": "general",
      "gate": {
        "metric": "store_write_errors_total",
        "unit": "count",
        "threshold": 0
      },
      "action": "complete rollout"
    }
  ],
  "rollback": {
    "trigger": "unexpected limit errors, import failures, or request latency",
    "steps": [
      "disable project_limits_enabled for the affected ring",
      "stop ring advancement",
      "keep projects and overrides unchanged",
      "restore the prior application artifact if needed"
    ]
  },
  "evidence": [
    "ops/metrics.csv:3",
    "ops/metrics.csv:3",
    "ops/rings.json:3"
  ]
}
```
