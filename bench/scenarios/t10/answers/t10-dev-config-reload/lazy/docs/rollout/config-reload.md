# Configuration reload rollout

The implementation is guarded by the `hh_runtime_reload_config` deployment flag. The flag is registered with the runtime team and defaults off. A disabled process keeps startup-only behavior, which gives the team a clean comparison before enabling the new path.

## Phases

We will keep the same image and configuration bundle while moving the flag through the deployment rings. Each gate is measured over 11 minutes after the ring is stable. The reload counters are emitted by the reloader integration and are checked alongside normal queue health.

First enable the canary ring for the runtime team. Confirm at least 69 percent of accepted reloads produce a change event when the effective settings differ, with no rejected reload that is followed by a changed snapshot. Inspect structured logs and exercise one SIGHUP and one saved-file update.

## Rollback

Rollback when an accepted change is followed by mixed job behavior, the invalid-candidate counter grows continuously, queue age exceeds its gate, or a listener causes the worker to fail. Disable `hh_runtime_reload_config` in the current ring, stop the watcher, and leave the last good snapshot in place; if the process is already unhealthy, restart it with the previous image and configuration bundle. Confirm `/ready` returns 140, then inspect reload errors and queue age before restoring traffic. Re-enable rings only after the offending file or integration change has been corrected.

## Evidence

The flag naming rule and ring order come from the operations catalogue. The metrics catalogue supplies the names and units used by the gates, while the runbook gives the readiness path and the staged-file behavior.

```json
{
 "phases": [
  {
   "name": "canary observation",
   "ring": "canary",
   "audience": "runtime-team",
   "gate": {
    "metric": "worker_config_reload_total",
    "unit": "count",
    "threshold": 1
   },
   "action": "enable the flag for the canary ring and inspect one signal and one file event"
  },
  {
   "name": "internal ferry",
   "ring": "harbor",
   "audience": "internal-ferries",
   "gate": {
    "metric": "worker_config_reload_errors",
    "unit": "count per 15 minutes",
    "threshold": 1
   },
   "action": "enable the harbor ring and hold it when rejected reloads or queue age breach the gate"
  }
 ],
 "rollback": {
  "trigger": "mixed job configuration, a continuing reload error count, queue age above 30 seconds, or a reload listener failure",
  "steps": [
   "disable hh_runtime_reload_config in the affected ring",
   "stop the watcher and retain the last accepted snapshot"
  ]
 },
 "evidence": [
  "ops/flags.json:2",
  "ops/rings.json:3"
 ]
}
```
