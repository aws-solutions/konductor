# Checkout latency incident review

**Date:** 2026-03-17 UTC  
**Service:** checkout-api  
**Severity:** SEV-2  
**Customer symptom:** Checkout requests became slow and returned intermittent 503 responses during the evening traffic period.

## Evidence

The causal chain is the 17:42 configuration diff, the pooler reload accepting `client_pool_size=12` from 40, and the first checkout acquisition timeout at 18:04. The deployment and routine GC messages are nearby or noisy, but they do not explain the pooler limit and checkout waiters.

```json
{
 "actionItems": [
  {
   "owner": "Release engineering",
   "text": "In short: Compare active pool settings with the configuration repository before evening traffic."
  },
  {
   "owner": "SRE",
   "text": "In short: Add a page for sustained pool_waiters together with checkout p99 or five_xx, and alert on runtime pool-size drift."
  },
  {
   "owner": "Platform",
   "text": "In short: Restore and pin the checkout pool at 40 through the reviewed configuration path, and reject unreviewed runtime reductions."
  }
 ],
 "impact": {
  "peakP99Ms": 3505,
  "failedRequests": 407,
  "durationMinutes": 40
 },
 "timeline": [
  {
   "event": "The pooler accepted the checkout pool configuration change from 40 to 12.",
   "time": "2026-03-17T17:42:00Z"
  },
  {
   "event": "Checkout p99 rose to 710 ms and a request waited 904 ms for a database client.",
   "time": "2026-03-17T18:03:00Z"
  },
  {
   "event": "The pooler reached the checkout client limit and checkout began returning connection acquisition timeouts and 503 responses.",
   "time": "2026-03-17T18:04:00Z"
  },
  {
   "event": "The on-call restarted the pooler with the last-known-good operation.",
   "time": "2026-03-17T18:41:00Z"
  },
  {
   "event": "The pooler reported checkout configured at 40 with zero waiters.",
   "time": "2026-03-17T18:43:00Z"
  }
 ],
 "rootCause": {
  "evidence": [
   "logs/checkout-api.log:2228",
   "logs/pooler.log:1083",
   "config/config-diff-week.yaml:17"
  ],
  "summary": "In short: An unreviewed runtime configuration reduced the checkout pool from 40 to 12, starving checkout of database connections during the evening peak."
 }
}
```

## Action items

- Restore and pin the checkout pool at 40 through the reviewed configuration path, and reject unreviewed runtime reductions. **Owner:** Platform
- Add a page for sustained `pool_waiters` together with checkout p99 or 5xx, and alert on runtime pool-size drift from the approved value. **Owner:** SRE
- Add a release-time check that compares active pool settings with the configuration repository before evening traffic. **Owner:** Release engineering

## Contributing conditions

The runtime configuration path accepted a pool-size change without the normal reviewed deployment record. The checkout service had no alert for configuration drift or for a pool limit being materially below its known-good value. Existing p99 and 5xx alerts eventually paged, but the pool-waiter signal could have shortened diagnosis if it had been tied directly to the checkout path.

## Impact

The customer-visible degradation lasted 40 minutes, from 18:04 through 18:43 UTC inclusive. The minute metrics contain 407 checkout responses with HTTP 5xx status during that period. Peak checkout p99 was 3,505 ms. The highest observed pool waiter count was 74. Payments and inventory did not show a corresponding outage.

## What happened

At 17:42 UTC, the running pooler accepted a runtime configuration that reduced the checkout client pool from 40 to 12. The change was active before the evening request volume arrived. At 18:03 UTC, checkout p99 rose to 710 ms and the first request showed 904 ms waiting for a database client. At 18:04 UTC, the pooler began reporting that the checkout client limit had been reached. Checkout requests then timed out while acquiring a connection and returned 503 responses.

The payments adapter and inventory service continued to report normal dependency behavior. The application release at 17:44 UTC changed receipt copy only and has no matching request-path error. The recurring garbage-collection warnings also appear outside the incident window and do not align with the pooler queue. Neither is the cause.

At 18:41 UTC, the on-call restarted the pooler using the last-known-good operation. The process came up with a checkout pool of 40 at 18:42 UTC, and the pooler reported zero waiters at 18:43 UTC. Metrics returned to their usual range after the remaining queued work drained.
