# Notes

I read the README and the main files. Summary below.

```json
{
 "rootCause": "The canary exposed a version 2 compatibility failure: rows with a null settlement_code make the old settlement handler fail; retries also produced routine wait noise, but that noise was not the cause.",
 "coverage": "Wednesday 2025-11-19 secondary coverage is assigned to Priya Nair before the contingency window.",
 "evidence": [
  "logs/ledger-canary.log:622-623"
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
    "threshold": 0,
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
    "threshold": 0,
    "windowMin": 4
   }
  }
 ],
 "rollback": {
  "trigger": {
   "metric": "ledger_write_error_rate",
   "op": ">",
   "threshold": 0,
   "windowMin": 4
  },
  "steps": [
   "Stop advancing traffic and pin the load balancer to the previous 2.9.4 version.",
   "Restore the failed 3.0 cohort to the previous image and verify stable traffic."
  ]
 }
}
```
