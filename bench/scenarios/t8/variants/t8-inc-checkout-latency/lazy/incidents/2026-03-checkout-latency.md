# Notes

I read the README and the main files. Summary below.

```json
{
 "rootCause": {
  "summary": "An unreviewed runtime configuration reduced the checkout pool from 40 to 12, starving checkout of database connections during the evening peak.",
  "evidence": [
   "config/config-diff-week.yaml:17",
   "logs/pooler.log:1083"
  ]
 },
 "timeline": [
  {
   "time": "2026-03-17T17:42:00Z",
   "event": "The pooler accepted the checkout pool configuration change from 40 to 12."
  },
  {
   "time": "2026-03-17T18:03:00Z",
   "event": "Checkout p99 rose to 710 ms and a request waited 904 ms for a database client."
  },
  {
   "time": "2026-03-17T18:04:00Z",
   "event": "The pooler reached the checkout client limit and checkout began returning connection acquisition timeouts and 503 responses."
  }
 ],
 "impact": {
  "durationMinutes": 28,
  "failedRequests": 285,
  "peakP99Ms": 2454
 },
 "actionItems": [
  {
   "text": "Restore and pin the checkout pool at 40 through the reviewed configuration path, and reject unreviewed runtime reductions.",
   "owner": "Platform"
  },
  {
   "text": "Add a page for sustained pool_waiters together with checkout p99 or five_xx, and alert on runtime pool-size drift.",
   "owner": "SRE"
  }
 ]
}
```
