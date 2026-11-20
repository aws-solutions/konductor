# Runbook: invoice creation slow or failing

Page: `InvoiceCreateLatencyHigh` (p99 of invoice creation over the SLO for 10 minutes).

## First look

- Which tenants? Check `tenant=` on failing `POST /v1/invoices` lines and `config/tenants.csv` for their segments.
- What changed? Deploys (`deploy/history.csv`), flag changes (flag-service audit lines), scheduler jobs.
- Database: lock waits and long statements in the primary log, replica lag in the replica log.

## Mitigations

| Option | How | Use when |
| --- | --- | --- |
| Restart invoice-api | `kubectl rollout restart deploy/invoice-api` | the API itself is wedged (threads stuck, memory) |
| Roll back the last invoice-api deploy | `deployctl rollback invoice-api` | the problem started with that deploy |
| Turn a flag off | `flagctl disable <flag> --segment <segment>` | a flag change lines up with the start |
| Scale out invoice-api | `kubectl scale deploy/invoice-api --replicas=12` | CPU-bound and the database has headroom |
| Fail over to the replica | `pgctl promote replica` | the primary is unhealthy. **Only when replica lag is under 30 s**: anything not replayed is lost |

After any change, watch `invoice_create_p99_ms` until it is back under the SLO for 15 minutes.
