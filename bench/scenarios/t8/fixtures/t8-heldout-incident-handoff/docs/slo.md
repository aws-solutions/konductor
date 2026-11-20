# Ledgerly SLOs

| SLI | Objective | Metric |
| --- | --- | --- |
| Invoice creation latency | p99 under 1500 ms in 99 % of minutes (30 days) | `invoice_create_p99_ms` |
| Invoice creation success | 99.9 % of `POST /v1/invoices` not 5xx | `invoice_create_5xx` / `invoice_create_requests` |
| PDF delivery | 99 % of PDFs within 5 minutes | render-worker job times |

An incident counts as mitigated when the latency SLI is back under its objective for 15 minutes.
