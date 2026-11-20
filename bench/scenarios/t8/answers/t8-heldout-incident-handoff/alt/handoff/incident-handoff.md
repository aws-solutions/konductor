# Hand-off: invoice creation failing for enterprise-us tenants (2026-11-20, 16:30 UTC)

From Lena (on-call until 16:30 UTC) to the incoming developer. Status: **investigating**. The cause is found; the safe
mitigation has not been applied yet.

## Who owns what

The cause is owned by **Tax Engine** (the `tax-recalc` job and the `bulk_tax_recalc` flag). Billing Core owns
invoice-api, which is the victim here. Documents and Data Platform have nothing to fix.

```json
{
 "actionItems": [
  {
   "owner": "Data Platform",
   "text": "In short: Confirm the replica lag is back under 30 s before any failover is considered."
  },
  {
   "owner": "Billing Core",
   "text": "In short: Cancel the queued rollback of invoice-api 2.41.0."
  },
  {
   "owner": "Tax Engine",
   "text": "In short: Change the tax-recalc job to small batches with short transactions so it cannot hold invoice_lines locks for minutes."
  },
  {
   "owner": "Tax Engine",
   "text": "In short: Set bulk_tax_recalc to disabled in config/flag-defaults.yaml before the 18:00 UTC flags-sync."
  }
 ],
 "openRisks": [
  "The replica stays far behind until the recalc writes stop; a failover in that time loses data.",
  "Recalc batches already running keep their locks until they finish or time out.",
  "At 18:00 UTC the flags-sync job re-applies config/flag-defaults.yaml, which still enables bulk_tax_recalc for enterprise-us, and turns the flag back on."
 ],
 "owner": "Tax Engine",
 "verification": {
  "healthyBelow": 1500,
  "metric": "invoice_create_p99_ms"
 },
 "mitigation": {
  "rejected": [
   {
    "reason": "In short: More pods only add more waiters on the same locked rows.",
    "action": "Scale out invoice-api"
   },
   {
    "reason": "In short: 2.41.0 changed only the email footer and a log field; failures start 13 minutes later and only for one segment.",
    "action": "Roll back invoice-api 2.41.0"
   },
   {
    "reason": "In short: The 14:44 restart gave only about five minutes of relief; the locks are held by the tax-recalc job, so the waits came back.",
    "action": "Restart invoice-api"
   },
   {
    "reason": "In short: The replica is 260 s behind, far over the runbook's 30 s limit, so promoting it would lose invoice writes.",
    "action": "Fail over to the replica"
   }
  ],
  "action": "Disable the bulk_tax_recalc flag for the enterprise-us segment (flagctl disable bulk_tax_recalc --segment enterprise-us)."
 },
 "impact": {
  "affectedTenants": 15,
  "failedRequests": 157,
  "since": "2026-11-20T14:03:08Z"
 },
 "rootCause": {
  "evidence": [
   "logs/invoice-api.log:2994",
   "logs/invoice-api.log:2966",
   "logs/postgres-primary.log:198",
   "logs/postgres-primary.log:172",
   "logs/postgres-primary.log:171",
   "logs/flag-service.log:13"
  ],
  "summary": "In short: The bulk_tax_recalc flag enabled for enterprise-us at 14:02 UTC (TAX-512) started tax-recalc batches whose long transactions hold row locks on invoice_lines, so invoice creation for those tenants waits on the locks and times out."
 },
 "status": "investigating"
}
```

## What can still go wrong

- At 18:00 UTC the `flags-sync` job re-applies `config/flag-defaults.yaml`, where `bulk_tax_recalc` is still enabled
  for `enterprise-us`: it will turn the flag back on and the incident returns. Change the default before 18:00 UTC.
- Recalc batches still running when the flag goes off may hold locks for up to a few more minutes.
- Until the replica catches up, any failover would lose data.

## How to tell it worked

`invoice_create_p99_ms` back under 1500 ms (the SLO) for 15 minutes in a row, with `db_lock_waits` near 0. The replica
lag should fall as the recalc writes stop.

## What to do now

**Turn the flag off:** `flagctl disable bulk_tax_recalc --segment enterprise-us`. No new recalc batches start; the
batches already running finish or hit their statement timeout, and the locks go with them.

Do not:

- **Fail over to the replica.** The runbook allows it only under 30 s of replica lag; the replica is 260 s behind at
  16:29 UTC (`logs/postgres-replica.log`), so a promotion would lose minutes of invoice writes. The primary is healthy anyway.
- **Restart invoice-api again.** The 14:44 restart helped for about five minutes and the waits came back: the locks
  are held by the tax-recalc job, not by the API.
- **Roll back 2.41.0.** It is queued in deployctl; leave it. It touches only email templates and logging.
- **Scale out invoice-api.** More API pods only add more waiters on the same rows.

## Why

At 14:02:11 UTC Tax Engine enabled the flag `bulk_tax_recalc` for `enterprise-us` (TAX-512,
`logs/flag-service.log:13`). That starts the scheduler's `tax-recalc` job for those tenants, which updates up to 90,000
`invoice_lines` rows per transaction (`config/scheduler.yaml`). Those transactions hold row locks for minutes
(`logs/postgres-primary.log:198`: one UPDATE ran 200 s), and invoice creation for the same tenants waits on them:

- `logs/postgres-primary.log:171` and `logs/postgres-primary.log:172`: an invoice insert waiting on a lock held by `application_name=tax-recalc`.
- `logs/invoice-api.log:2966` and `logs/invoice-api.log:2994`: the first 504s, both enterprise-us tenants, 57 s and two minutes after the flag.

What it is not:

- invoice-api 2.41.0 (13:50 UTC) changed the email footer and a log field only; failures start 13 minutes later, only
  for one segment, and only when a tax-recalc transaction holds the lock.
- render-worker errors are downstream: it times out fetching invoices from invoice-api. Documents does not own this.

## What is going on

Since 14:03 UTC, invoice creation for the 15 tenants in the `enterprise-us` segment is slow, and 157 of their
`POST /v1/invoices` calls have timed out with a 504 after 30 s (`lock wait timeout on invoice_lines`). No other segment
is affected.
