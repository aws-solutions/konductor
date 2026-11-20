# Catalogue product-page database overload

## Follow-up

The response should have been easier to diagnose because the cache policy reload did not expose the expiration distribution or warn about a zero-jitter bulk warmup. The alert set also measured the symptoms independently rather than joining cache hit ratio, page errors, and database waiters into one page.

```json
{
 "actionItems": [
  {
   "owner": "Nora Ives",
   "text": "In short: Canary cache policy reloads and record the expiration distribution before warming the full catalogue."
  },
  {
   "owner": "Ravi Mehta",
   "text": "In short: Add an alert joining low cache hit ratio with page errors and database CPU or connection waiters."
  },
  {
   "owner": "Maya Chen",
   "text": "In short: Restore cache expiry jitter and keep a bounded TTL distribution for every policy reload."
  }
 ],
 "impact": {
  "affectedMinutes": 12,
  "peakDbConnections": 240,
  "peakDbCpuPercent": 99.2,
  "failedPageRequests": 3960
 },
 "timeline": [
  {
   "event": "Cache policy reload completed a warmup of 38400 keys.",
   "time": "2025-03-18T14:42:00.000Z"
  },
  {
   "event": "First expiration wave caused the cache hit ratio to fall and page errors to begin.",
   "time": "2025-03-18T15:12:00.000Z"
  },
  {
   "event": "Second expiration wave repeated and database connections saturated.",
   "time": "2025-03-18T15:42:00.000Z"
  },
  {
   "event": "Third expiration wave repeated on the same interval.",
   "time": "2025-03-18T16:12:00.000Z"
  },
  {
   "event": "Applied 120 seconds of cache jitter, paused full warmup, and enabled API refill backoff.",
   "time": "2025-03-18T16:19:00.000Z"
  },
  {
   "event": "Policy update and backoff were live; page errors and database waiters recovered.",
   "time": "2025-03-18T16:22:00.000Z"
  }
 ],
 "rootCause": {
  "evidence": [
   "logs/db.log:585",
   "logs/api.log:593",
   "logs/cache.log:583",
   "deploy/deploy-history.jsonl:4",
   "config/config-review.diff:8",
   "config/config-review.diff:7"
  ],
  "summary": "In short: A cache policy reload changed the default TTL to 1800 seconds with zero jitter; the warmup loaded the catalogue together, so entries expired in synchronized waves and flooded the database."
 }
}
```

## Detection and response

The page error alert and low cache-hit alert identified the customer impact. The database connection alert confirmed saturation, but it was downstream of the cache expiration wave. We kept the database ceiling unchanged and treated the cache policy as the control point. After the policy update and refill backoff, API recovery checks were successful and database waiters returned to zero.

## Technical cause

The configuration diff changed `default_ttl_seconds` from 900 to 1800 and `jitter_seconds` from 60 to 0. The deploy record shows that the policy reload warmed the catalogue as one 38,400-key batch. At 15:12, the cache logged 38,194 expirations and 486 refill requests. API workers then missed together, and the database reached 240 active connections with 486 waiters. The next two waves arrived exactly 30 minutes apart, which matches the configured TTL.

## Timeline

- **2025-03-18T14:42:00.000Z:** The cache policy reload completed a warmup of 38,400 keys.
- **2025-03-18T15:12:00.000Z:** The first expiration wave appeared. The minute metric shows a 0.180 cache hit ratio and 420 page errors.
- **2025-03-18T15:42:00.000Z:** A second expiration wave repeated 30 minutes later.
- **2025-03-18T16:12:00.000Z:** A third expiration wave repeated on the same interval.
- **2025-03-18T16:19:00.000Z:** The team applied 120 seconds of cache jitter, paused the full warmup, and enabled API refill backoff.
- **2025-03-18T16:22:00.000Z:** The policy update and backoff were live. The next minute was clean, with a 0.940 cache hit ratio and three page errors.

## Customer impact

The page-error metric recorded 3,960 failed page requests across twelve elevated minutes. Each wave lasted four minutes, for 12 affected minutes in total. Database CPU reached 99.2%, and the primary reached its 240-connection ceiling. Product and category pages were affected; inventory processing and the reporting job completed.

## Summary

On 18 March, the catalogue service returned intermittent product-page 503s in three short waves. The API, cache gateway, and read-replica database recovered without changing the database connection ceiling. The failure was caused by a cache policy reload that put the catalogue on a 1,800-second TTL with zero jitter. The reload warmed the key set together, so the entries expired together and sent refill traffic to every API worker at once.

The reporting query recorded earlier in the day completed normally and did not coincide with the page failures.
