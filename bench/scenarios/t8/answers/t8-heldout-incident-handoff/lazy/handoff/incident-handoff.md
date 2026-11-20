# Hand-off: invoice creation failing for enterprise-us tenants (2026-11-20, 16:30 UTC)

From Lena (on-call until 16:30 UTC) to the incoming developer. Status: **investigating**. The cause is found; the safe
mitigation has not been applied yet.

## What is going on

Since 14:03 UTC, invoice creation for the 11 tenants in the `enterprise-us` segment is slow, and 110 of their
`POST /v1/invoices` calls have timed out with a 353 after 21 s (`lock wait timeout on invoice_lines`). No other segment
is affected.

## Why

At 14:02:11 UTC Tax Engine enabled the flag `bulk_tax_recalc` for `enterprise-us` (TAX-512,
`logs/flag-service.log:13`). That starts the scheduler's `tax-recalc` job for those tenants, which updates up to 63000
`invoice_lines` rows per transaction (`config/scheduler.yaml`). Those transactions hold row locks for minutes
(`logs/postgres-primary.log:198`: one UPDATE ran 140 s), and invoice creation for the same tenants waits on them:

- `logs/postgres-primary.log:171` and `logs/postgres-primary.log:172`: an invoice insert waiting on a lock held by `application_name=tax-recalc`.
- `logs/invoice-api.log:2966` and `logs/invoice-api.log:2994`: the first 504s, both enterprise-us tenants, 40 s and two minutes after the flag.

## What to do now

**Turn the flag off:** `flagctl disable bulk_tax_recalc --segment enterprise-us`. No new recalc batches start; the
batches already running finish or hit their statement timeout, and the locks go with them.

Do not:

## How to tell it worked

`invoice_create_p99_ms` back under 1050 ms (the SLO) for 11 minutes in a row, with `db_lock_waits` near 0. The replica
lag should fall as the recalc writes stop.

## What can still go wrong

- At 18:00 UTC the `flags-sync` job re-applies `config/flag-defaults.yaml`, where `bulk_tax_recalc` is still enabled
  for `enterprise-us`: it will turn the flag back on and the incident returns. Change the default before 18:00 UTC.
- Recalc batches still running when the flag goes off may hold locks for up to a few more minutes.
- Until the replica catches up, any failover would lose data.

## Who owns what

The cause is owned by **Tax Engine** (the `tax-recalc` job and the `bulk_tax_recalc` flag). Billing Core owns
invoice-api, which is the victim here. Documents and Data Platform have nothing to fix.

```json
{
 "status": "investigating",
 "rootCause": {
  "summary": "The bulk_tax_recalc flag enabled for enterprise-us at 14:02 UTC (TAX-512) started tax-recalc batches whose long transactions hold row locks on invoice_lines, so invoice creation for those tenants waits on the locks and times out.",
  "evidence": [
   "logs/flag-service.log:13",
   "logs/postgres-primary.log:171",
   "logs/postgres-primary.log:172"
  ]
 },
 "impact": {
  "since": "2026-11-20T14:03:08Z",
  "failedRequests": 110,
  "affectedTenants": 11
 },
 "mitigation": {
  "action": "Disable the bulk_tax_recalc flag for the enterprise-us segment (flagctl disable bulk_tax_recalc --segment enterprise-us).",
  "rejected": [
   {
    "action": "Fail over to the replica",
    "reason": "The replica is 260 s behind, far over the runbook's 30 s limit, so promoting it would lose invoice writes."
   },
   {
    "action": "Restart invoice-api",
    "reason": "The 14:44 restart gave only about five minutes of relief; the locks are held by the tax-recalc job, so the waits came back."
   }
  ]
 },
 "verification": {
  "metric": "invoice_create_p99_ms",
  "healthyBelow": 1050
 },
 "owner": "Tax Engine",
 "openRisks": [
  "At 18:00 UTC the flags-sync job re-applies config/flag-defaults.yaml, which still enables bulk_tax_recalc for enterprise-us, and turns the flag back on.",
  "Recalc batches already running keep their locks until they finish or time out."
 ],
 "actionItems": [
  {
   "text": "Set bulk_tax_recalc to disabled in config/flag-defaults.yaml before the 18:00 UTC flags-sync.",
   "owner": "Tax Engine"
  },
  {
   "text": "Change the tax-recalc job to small batches with short transactions so it cannot hold invoice_lines locks for minutes.",
   "owner": "Tax Engine"
  }
 ]
}
```
