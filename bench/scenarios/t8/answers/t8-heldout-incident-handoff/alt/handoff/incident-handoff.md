# Invoice creation incident, hand-off at 16:30 UTC

**Status: investigating.** Cause known, fix not applied yet. Please start with the first step below.

## In one paragraph

Only `enterprise-us` tenants are hit. Fifteen of them have had invoice creation time out since 14:03 UTC, 157 failed
requests so far, all `504` after 30 s waiting on a lock on `invoice_lines`. The locks belong to the `tax-recalc` job,
which Tax Engine switched on for that segment one minute earlier with the `bulk_tax_recalc` flag (TAX-512). Its
updates run in huge transactions and keep rows locked for minutes at a time.

Proof, in order:

1. `logs/flag-service.log:13`: `bulk_tax_recalc` enabled for `enterprise-us` at 14:02:11 UTC.
2. `logs/postgres-primary.log:172`: the blocked insert is waiting on a process named `tax-recalc`.
3. `logs/invoice-api.log:2966`: the first 504, 14:03:08 UTC, `lock wait timeout on invoice_lines`.

The 2.41.0 deploy is not the cause: it went out at 13:50, changed the email footer and a log field, and the failures
are limited to one segment. The render-worker errors are a side effect of invoice-api being slow.

## First step

Turn `bulk_tax_recalc` off for `enterprise-us`. Do not fail over, do not roll back 2.41.0.

| Option | Why not |
| --- | --- |
| Promote the replica | It is about 260 s behind and the runbook caps lag at 30 s; we would lose invoice writes. |
| Restart invoice-api | Tried at 14:44 UTC; relief lasted a few minutes and the lock waits came back, because the job still holds the locks. |
| Roll back 2.41.0 | Unrelated change (footer and logging); leave the queued rollback alone. |
| Add invoice-api replicas | More pods just queue on the same locked rows in the database. |

## Done when

`invoice_create_p99_ms` stays below 1500 ms.

## Watch out

- The `flags-sync` run at 18:00 UTC copies `config/flag-defaults.yaml` back, and that file still has the flag on, so
  it would turn the job back on.
- Batches already in flight keep their locks until they end.

```json
{
  "status": "investigating",
  "rootCause": {
    "summary": "TAX-512 turned on bulk_tax_recalc for enterprise-us at 14:02 UTC; the tax-recalc job's long transactions keep invoice_lines rows locked, so invoice inserts for those tenants wait on the lock and time out with 504. The 2.41.0 deploy is not the cause.",
    "evidence": [
      "logs/flag-service.log:13",
      "logs/postgres-primary.log:172",
      "logs/invoice-api.log:2966"
    ]
  },
  "impact": {
    "since": "2026-11-20T14:03:08Z",
    "failedRequests": 157,
    "affectedTenants": 15
  },
  "mitigation": {
    "action": "Turn the bulk_tax_recalc flag off for enterprise-us; do not fail over and do not roll back 2.41.0.",
    "rejected": [
      { "action": "Promote the replica", "reason": "About 260 s behind against the runbook's 30 s cap, so writes would be lost." },
      { "action": "Restart invoice-api", "reason": "Tried at 14:44 UTC; the relief was short and the lock waits came back." },
      { "action": "Roll back 2.41.0", "reason": "Unrelated: footer and logging only." },
      { "action": "Add invoice-api replicas", "reason": "More pods just wait on the same locked rows in the database." }
    ]
  },
  "verification": {
    "metric": "invoice_create_p99_ms",
    "healthyBelow": 1500
  },
  "owner": "Tax Engine",
  "openRisks": [
    "flags-sync at 18:00 UTC copies config/flag-defaults.yaml back, which would turn the flag on again.",
    "Batches already in flight keep their locks until they end."
  ],
  "actionItems": [
    { "text": "Rewrite the tax-recalc job to commit in small batches so no transaction holds invoice_lines locks for long.", "owner": "Tax Engine" },
    { "text": "Flip bulk_tax_recalc to off in config/flag-defaults.yaml before 18:00 UTC.", "owner": "Tax Engine" },
    { "text": "Leave the queued 2.41.0 rollback alone and drop it once the incident closes.", "owner": "Billing Core" }
  ]
}
```
