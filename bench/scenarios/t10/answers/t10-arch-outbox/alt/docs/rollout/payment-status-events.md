# Payment status status-events rollout

The release changes the write path and adds a publisher. Keep the existing JSON file and take the normal volume backup before starting. The publisher is controlled by `STATUS_EVENTS_PUBLISH_ENABLED` in the host process, while the numeric settings use the documented millisecond keys from `src/config.js`.

## Rollback

Trigger rollback if `broker.errors` reaches 1 in a five-minute window, status lag exceeds 60 seconds for 10 minutes, or a consumer reports an ordering violation. Stop enabling new traffic, disable the publisher on both instances, drain old workers, restore the previous application version, and leave the status-events data intact. Do not delete unsent records. If the old publisher is restarted, use the normal instance sequence and reconcile any status changes from the backup before resuming. Re-enable the new publisher only after the data and consumer state are reconciled.

```json
{
 "evidence": [
  "docs/consumers.md:3",
  "ops/instance-deploy.json:1",
  "ops/deploy-rings.json:1",
  "ops/metrics.csv:8",
  "ops/metrics.csv:7"
 ],
 "rollback": {
  "steps": [
   "disable publisher on orders-a and orders-b",
   "drain workers and stop new status traffic",
   "restore the previous application version without deleting the status-events",
   "reconcile unsent records and consumer state before resuming"
  ],
  "trigger": "broker.errors reaches 1 or status.lag exceeds 60 seconds for 10 minutes or a per-order ordering violation is reported"
 },
 "phases": [
  {
   "action": "deploy orders-a with publisher disabled, drain the old publisher, then enable and inspect one event",
   "gate": {
    "threshold": 0,
    "unit": "count",
    "metric": "broker.errors"
   },
   "audience": "operations",
   "name": "canary"
  },
  {
   "action": "deploy orders-b disabled, enable both claiming publishers, and exercise both instances",
   "gate": {
    "threshold": 60,
    "unit": "seconds",
    "metric": "status.lag"
   },
   "audience": "staff",
   "name": "internal"
  },
  {
   "action": "keep both publishers enabled, watch delivery, and retain the backup through observation",
   "gate": {
    "threshold": 0,
    "unit": "count",
    "metric": "broker.errors"
   },
   "audience": "all customers",
   "name": "general"
  }
 ]
}
```

## Phases

1. **Canary**: deploy orders-a with the new code and publisher disabled. Drain its old workers before enabling the new writer, then enable the publisher on orders-a only. Confirm new status updates have one status-events record and that the publisher can publish it.
2. **Internal**: deploy orders-b with the same code and publisher disabled, then enable its publisher after orders-a is healthy. Exercise updates from both instances and confirm a single order's messages arrive in order. The claim makes the two publisher triggers safe.
3. **General**: keep both publishers enabled and expose the release to all customers. Watch the backlog and broker error behavior through the existing catalogue metrics. Keep the pre-release file backup until the backlog is empty and the observation window ends.

A phase advances only when its gate stays below the threshold for 15 minutes and no manual inspection finds an unowned event. `status.lag` is measured in seconds, `broker.errors` and `broker.published` are counts, and the deployment audiences are the names in the ring file.
