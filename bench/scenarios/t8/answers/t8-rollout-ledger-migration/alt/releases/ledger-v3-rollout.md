# Ledger API 3.0 rollout plan

## Rollback

The page threshold is `ledger_write_error_rate > 0.5 percent for 5 minutes`. On that signal, stop the next promotion, pin traffic to the previous 2.9.4 image, and restore the failed cohort. Do not run the contract migration during rollback. Leave the expand schema in place, keep the compatibility value populated, and investigate before retrying. If the database gate fails, stop the migration and keep both replicas serving.

```json
{
 "rollback": {
  "steps": [
   "Stop advancing traffic and pin the load balancer to the previous 2.9.4 version.",
   "Restore the failed 3.0 cohort to the previous image and verify stable traffic.",
   "Do not run the contract migration; leave the expanded schema and compatibility data in place.",
   "Recheck write errors, replica lag, authorizer errors, and reconciliation before any retry."
  ],
  "trigger": {
   "windowMin": 5,
   "threshold": 0.5,
   "op": ">",
   "metric": "ledger_write_error_rate"
  }
 },
 "steps": [
  {
   "gate": {
    "windowMin": 5,
    "threshold": 15,
    "op": "<",
    "metric": "ledger_replica_lag_seconds"
   },
   "start": "2025-11-17T15:00:00Z",
   "percent": null,
   "action": "Apply migration 001_expand.sql to expand the schema with nullable settlement_route",
   "id": "item-1"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 1,
    "op": "<",
    "metric": "ledger_null_legacy_rows"
   },
   "start": "2025-11-17T15:25:00Z",
   "percent": null,
   "action": "Run migration 002_prepare.sql in bounded batches and verify settlement_code null count is zero",
   "id": "item-2"
  },
  {
   "gate": {
    "windowMin": 5,
    "threshold": 0.5,
    "op": "<",
    "metric": "ledger_write_error_rate"
   },
   "start": "2025-11-17T16:00:00Z",
   "percent": 8,
   "action": "Deploy ledger-api 3.0 to one host and send the 8 percent canary cohort",
   "id": "item-3"
  },
  {
   "gate": {
    "windowMin": 5,
    "threshold": 0.5,
    "op": "<",
    "metric": "ledger_write_error_rate"
   },
   "start": "2025-11-17T16:30:00Z",
   "percent": 25,
   "action": "Promote ledger-api 3.0 to 25 percent of traffic",
   "id": "item-4"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 450,
    "op": "<",
    "metric": "ledger_request_latency_p95_ms"
   },
   "start": "2025-11-17T17:05:00Z",
   "percent": 50,
   "action": "Promote ledger-api 3.0 to 50 percent of traffic",
   "id": "item-5"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 1,
    "op": "<",
    "metric": "ledger_v3_5xx_rate"
   },
   "start": "2025-11-17T17:45:00Z",
   "percent": 100,
   "action": "Promote ledger-api 3.0 to 100 percent of traffic and hold through the evening",
   "id": "item-6"
  },
  {
   "gate": {
    "windowMin": 5,
    "threshold": 15,
    "op": "<",
    "metric": "ledger_replica_lag_seconds"
   },
   "start": "2025-11-19T14:30:00Z",
   "percent": null,
   "action": "Apply migration 003_contract.sql to contract the old settlement_code column",
   "id": "item-7"
  },
  {
   "gate": {
    "windowMin": 10,
    "threshold": 1,
    "op": "<",
    "metric": "ledger_v3_5xx_rate"
   },
   "start": "2025-11-19T15:00:00Z",
   "percent": null,
   "action": "Close the release record after the contract migration and final dashboard review",
   "id": "item-8"
  }
 ],
 "evidence": [
  "logs/ledger-canary.log:626",
  "logs/ledger-canary.log:622-623"
 ],
 "coverage": "Wednesday 2025-11-19 secondary coverage is assigned to Priya Nair before the contingency window.",
 "rootCause": "The canary exposed a version 2 compatibility failure: rows with a null settlement_code make the old settlement handler fail; retries also produced routine wait noise, but that noise was not the cause."
}
```

## Schedule and ownership

Jo Lin is the release primary and Mara Voss is the secondary for the Monday window. Priya Nair will provide Wednesday 2025-11-19 secondary coverage before the contingency window is used, closing the rota gap. All times are UTC.

- Monday 2025-11-17 15:00: apply the expand migration.
- Monday 2025-11-17 15:25: run bounded prepare batches and verify zero null legacy codes.
- Monday 2025-11-17 16:00 onward: move application traffic through the listed cohorts.
- Wednesday 2025-11-19 14:30: only after the application has held at 100 percent, run the contract migration. This is before the freeze at 2025-11-21 18:00.

At every hold, record the UTC observation, host cohort, replica lag, write error rate, p95 latency, authorizer errors, and reconciliation queue age. Stop advancing if a gate fails. Do not drain more than one host from an availability zone or two hosts in total.

## What the last canary tells us

The canary log shows `not_null_violation` and `legacy_field_required` failures on null `settlement_code` values. This is a compatibility-data problem: the 2.x settlement handler cannot process a touched row whose old `settlement_code` is null. The connection-pool wait at 10:15 UTC is a symptom of retries, not the release cause. The prepare migration must drive `ledger_null_legacy_rows` below one before any 3.0 traffic is enabled.

The production fleet can drain at most two hosts. I use one host, about 8 percent of load-balancer traffic, for the first application cohort. Each traffic movement is held for its gate window. The application release uses the existing authorizer synchronously and the reconciliation consumer asynchronously, so both the write/error signal and downstream health need review.

## Objective

Move the twelve-host ledger fleet from 2.9.4 to 3.0 before the month-end close freeze, while keeping settlement writes safe and leaving a reversible application path. The release adds `settlement_route`; the expand and prepare migrations must remain compatible with old hosts.
