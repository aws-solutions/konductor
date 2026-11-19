# Recent incident index

| start (UTC) | end (UTC) | service | symptom | customer impact |
|---|---|---|---|---|
| 2025-04-05T08:12:00Z | 2025-04-05T08:21:00Z | payments-api | elevated 502 responses | 0.01% of checkout requests |
| 2025-04-14T15:07:00Z | 2025-04-14T15:48:00Z | payments-api | authorization timeouts and retries | 0.74% of checkout requests |
| 2025-04-19T22:40:00Z | 2025-04-19T22:51:00Z | payments-worker | reconciliation lag | no synchronous checkout impact |
| 2025-04-26T06:03:00Z | 2025-04-26T06:10:00Z | payments-api | isolated 504 responses | 0.02% of checkout requests |

The April 14 event is the only event in this sample window with sustained customer-facing impact. The index is a timeline, not a cause analysis.
