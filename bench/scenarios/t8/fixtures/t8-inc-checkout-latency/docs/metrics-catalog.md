# Checkout metrics catalogue

The file `metrics/checkout-minute.csv` has one row per UTC minute.

| Column | Unit | Meaning |
|---|---|---|
| `timestamp` | ISO 8601 UTC | Start of the minute |
| `request_rate_rpm` | requests/minute | Completed and attempted checkout requests |
| `p50_ms` | milliseconds | Median checkout request latency |
| `p99_ms` | milliseconds | 99th percentile checkout request latency |
| `five_xx` | requests/minute | Responses with an HTTP 5xx status |
| `pool_waiters` | clients | Requests waiting for a checkout pool slot |
| `checkout_cpu_pct` | percent | Checkout API process CPU |

The CSV is an observation stream, not a generated alert history. A missing row means the sampler did not run.
