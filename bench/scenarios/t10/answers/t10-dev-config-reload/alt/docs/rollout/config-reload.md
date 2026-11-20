# Configuration reload rollout

The implementation is guarded by the `hh_runtime_reload_config` deployment flag. The flag is registered with the runtime team and defaults off. A disabled process keeps startup-only behavior, which gives the team a clean comparison before enabling the new path.

## Evidence

The flag naming rule and ring order come from the operations catalogue. The metrics catalogue supplies the names and units used by the gates, while the runbook gives the readiness path and the staged-file behavior.

```json
{
 "evidence": [
  "docs/runbook.md:13",
  "ops/metrics.csv:4",
  "ops/rings.json:3",
  "ops/flags.json:2"
 ],
 "rollback": {
  "steps": [
   "disable hh_runtime_reload_config in the affected ring",
   "stop the watcher and retain the last accepted snapshot",
   "restart with the previous image and configuration bundle if the worker is unhealthy",
   "confirm /ready returns 200 and inspect queue age and reload errors before restoring traffic"
  ],
  "trigger": "mixed job configuration, a continuing reload error count, queue age above 30 seconds, or a reload listener failure"
 },
 "phases": [
  {
   "action": "enable the flag for the canary ring and inspect one signal and one file event",
   "gate": {
    "threshold": 1,
    "unit": "count",
    "metric": "worker_config_reload_total"
   },
   "audience": "runtime-team",
   "ring": "canary",
   "name": "canary observation"
  },
  {
   "action": "enable the harbor ring and hold it when rejected reloads or queue age breach the gate",
   "gate": {
    "threshold": 1,
    "unit": "count per 15 minutes",
    "metric": "worker_config_reload_errors"
   },
   "audience": "internal-ferries",
   "ring": "harbor",
   "name": "internal ferry"
  },
  {
   "action": "enable the coast ring, watch failures and queue age, and keep the flag for one release cycle",
   "gate": {
    "threshold": 30,
    "unit": "seconds",
    "metric": "worker_queue_age_seconds"
   },
   "audience": "all-ferries",
   "ring": "coast",
   "name": "all ferries"
  }
 ]
}
```

## Rollback

Rollback when an accepted change is followed by mixed job behavior, the invalid-candidate counter grows continuously, queue age exceeds its gate, or a listener causes the worker to fail. Disable `hh_runtime_reload_config` in the current ring, stop the watcher, and leave the last good snapshot in place; if the process is already unhealthy, restart it with the previous image and configuration bundle. Confirm `/ready` returns 200, then inspect reload errors and queue age before restoring traffic. Re-enable rings only after the offending file or integration change has been corrected.

## Phases

We will keep the same image and configuration bundle while moving the flag through the deployment rings. Each gate is measured over 15 minutes after the ring is stable. The reload counters are emitted by the reloader integration and are checked alongside normal queue health.

First enable the canary ring for the runtime team. Confirm at least 99 percent of accepted reloads produce a change event when the effective settings differ, with no rejected reload that is followed by a changed snapshot. Inspect structured logs and exercise one SIGHUP and one saved-file update.

Next enable the harbor ring for internal ferries. Hold the ring if `worker_config_reload_errors` exceeds 1 count per 15 minutes or if queue age rises above 30 seconds. Compare active-job completion and timeout distributions with the preceding window before continuing.

Finally enable the coast ring for all ferries. Keep the flag available for one release cycle, watch `worker_failures_total` and `worker_queue_age_seconds`, and remove the old startup-only branch only after the ring has completed without a reload-related incident.
