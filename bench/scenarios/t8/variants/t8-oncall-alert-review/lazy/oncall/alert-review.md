# Notes

I read the README and the main files. Summary below.

```json
{
 "alerts": [
  {
   "name": "ApiLatencyP95",
   "problem": "The 850 ms threshold is below the normal evening peak, so this page fires on expected daily behavior. It fired 29 times in the 30-day export; an ordinary evening request is recorded at logs/api-gateway.log:82.",
   "change": "Use http_request_duration_p95_ms > 1200 for 10m, route to edge-queue, and make the alert a ticket.",
   "severity": "ticket"
  },
  {
   "name": "ApiCpuSaturation",
   "problem": "CPU is a cause signal without matching user impact. It fired 15 times without an incident, and the outage at 2025-02-18T14:16:41Z shows CPU at 0.41 while requests failed (logs/api-gateway.log:1804).",
   "change": "Use process_cpu_utilization > 0.90 for 15m, route to platform-queue, and make the alert a ticket.",
   "severity": "ticket"
  },
  {
   "name": "DbConnectionPoolExhaustion",
   "problem": "The rule uses the missing db_pool_used_ratio metric name. The current pool metric is db_pool_in_use_ratio, and at 2025-02-18T14:13:19Z the outage showed a full pool and connection waiters (logs/api-gateway.log:1800-1803).",
   "change": "Use db_pool_in_use_ratio > 0.90 for 3m, route to data-primary, and keep this as a page.",
   "severity": "page"
  },
  {
   "name": "Api5xxBurst",
   "problem": "This is a duplicate of ApiHigh5xxRate with the same 5xx expression and the same February 18 incident.",
   "change": "Remove the duplicate rule and its page.",
   "severity": "remove"
  }
 ],
 "keep": [
  "ApiHigh5xxRate",
  "HealthCheckDown",
  "QueueAgeHigh",
  "WorkerErrorRate",
  "CacheHitRateLow",
  "LoginFailureSpike"
 ]
}
```
