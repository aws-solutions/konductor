# Ledger API 3.0 rollout plan

## Objective

Move the twelve-host ledger fleet from 2.9.4 to 3.0 before the month-end close freeze, while keeping settlement writes safe and leaving a reversible application path. The release adds `settlement_route`; the expand and prepare migrations must remain compatible with old hosts.

## What the last canary tells us

The canary log shows `not_null_violation` and `legacy_field_required` failures on null `settlement_code` values. This is a compatibility-data problem: the 2.x settlement handler cannot process a touched row whose old `settlement_code` is null. The connection-pool wait at 10:15 UTC is a symptom of retries, not the release cause. The prepare migration must drive `ledger_null_legacy_rows` below one before any 3.0 traffic is enabled.

## Schedule and ownership

Jo Lin is the release primary and Mara Voss is the secondary for the Monday window. Priya Nair will provide Wednesday 2025-11-19 secondary coverage before the contingency window is used, closing the rota gap. All times are UTC.

- Monday 2025-11-17 15:00: apply the expand migration.
- Monday 2025-11-17 15:25: run bounded prepare batches and verify zero null legacy codes.
- Monday 2025-11-17 16:00 onward: move application traffic through the listed cohorts.
- Wednesday 2025-11-19 14:30: only after the application has held at 70 percent, run the contract migration. This is before the freeze at 2025-11-21 18:00.

## Rollback

The page threshold is `ledger_write_error_rate > 0.5 percent for 5 minutes`. On that signal, stop the next promotion, pin traffic to the previous 2.9.4 image, and restore the failed cohort. Do not run the contract migration during rollback. Leave the expand schema in place, keep the compatibility value populated, and investigate before retrying. If the database gate fails, stop the migration and keep both replicas serving.

```json
{
 "rootCause": "The canary exposed a version 2 compatibility failure: rows with a null settlement_code make the old settlement handler fail; retries also produced routine wait noise, but that noise was not the cause.",
 "coverage": "Wednesday 2025-11-19 secondary coverage is assigned to Priya Nair before the contingency window.",
 "evidence": [
  "logs/ledger-canary.log:622-623",
  "logs/ledger-canary.log:626"
 ],
 "steps": [
  {
   "id": "expand-schema",
   "action": "Apply migration 001_expand.sql to expand the schema with nullable settlement_route",
   "percent": null,
   "start": "2025-11-17T15:00:00Z",
   "gate": {
    "metric": "ledger_replica_lag_seconds",
    "op": "<",
    "threshold": 11,
    "windowMin": 4
   }
  },
  {
   "id": "prepare-compatibility-data",
   "action": "Run migration 002_prepare.sql in bounded batches and verify settlement_code null count is zero",
   "percent": null,
   "start": "2025-11-17T15:25:00Z",
   "gate": {
    "metric": "ledger_null_legacy_rows",
    "op": "<",
    "threshold": 1,
    "windowMin": 7
   }
  },
  {
   "id": "canary-v3",
   "action": "Deploy ledger-api 3.0 to one host and send the 8 percent canary cohort",
   "percent": 6,
   "start": "2025-11-17T16:00:00Z",
   "gate": {
    "metric": "ledger_write_error_rate",
    "op": "<",
    "threshold": 0.35,
    "windowMin": 4
   }
  },
  {
   "id": "quarter-traffic",
   "action": "Promote ledger-api 3.0 to 25 percent of traffic",
   "percent": 18,
   "start": "2025-11-17T16:30:00Z",
   "gate": {
    "metric": "ledger_write_error_rate",
    "op": "<",
    "threshold": 0.35,
    "windowMin": 4
   }
  }
 ],
 "rollback": {
  "trigger": {
   "metric": "ledger_write_error_rate",
   "op": ">",
   "threshold": 0.35,
   "windowMin": 4
  },
  "steps": [
   "Stop advancing traffic and pin the load balancer to the previous 2.9.4 version.",
   "Restore the failed 3.0 cohort to the previous image and verify stable traffic.",
   "Do not run the contract migration; leave the expanded schema and compatibility data in place.",
   "Recheck write errors, replica lag, authorizer errors, and reconciliation before any retry."
  ]
 }
}
```
