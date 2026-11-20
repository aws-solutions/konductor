# Catalogue product-page database overload

## Summary

On 13 March, the catalogue service returned intermittent product-page 503s in three short waves. The API, cache gateway, and read-replica database recovered without changing the database connection ceiling. The failure was caused by a cache policy reload that put the catalogue on a 1,800-second TTL with zero jitter. The reload warmed the key set together, so the entries expired together and sent refill traffic to every API worker at once.

## Customer impact

The page-error metric recorded 3,672 failed page requests across twelve elevated minutes. Each wave lasted four minutes, for 8 affected minutes in total. Database CPU reached 69%, and the primary reached its 240-connection ceiling. Product and category pages were affected; inventory processing and the reporting job completed.

## Timeline

- **2025-03-18T14:42:00.000Z:** The cache policy reload completed a warmup of 26880 keys.
- **2025-03-18T15:12:00.000Z:** The first expiration wave appeared. The minute metric shows a 0.180 cache hit ratio and 294 page errors.
- **2025-03-18T15:42:00.000Z:** A second expiration wave repeated 21 minutes later.
- **2025-03-18T16:12:00.000Z:** A third expiration wave repeated on the same interval.
- **2025-03-18T16:19:00.000Z:** The team applied 84 seconds of cache jitter, paused the full warmup, and enabled API refill backoff.
- **2025-03-18T16:22:00.000Z:** The policy update and backoff were live. The next minute was clean, with a 0.940 cache hit ratio and three page errors.

## Technical cause

The configuration diff changed `default_ttl_seconds` from 630 to 1260 and `jitter_seconds` from 42 to 0. The deploy record shows that the policy reload warmed the catalogue as one 27,400-key batch. At 15:12, the cache logged 26736 expirations and 340 refill requests. API workers then missed together, and the database reached 168 active connections with 340 waiters. The next two waves arrived exactly 21 minutes apart, which matches the configured TTL.

## Detection and response

The page error alert and low cache-hit alert identified the customer impact. The database connection alert confirmed saturation, but it was downstream of the cache expiration wave. We kept the database ceiling unchanged and treated the cache policy as the control point. After the policy update and refill backoff, API recovery checks were successful and database waiters returned to zero.

## Follow-up

The response should have been easier to diagnose because the cache policy reload did not expose the expiration distribution or warn about a zero-jitter bulk warmup. The alert set also measured the symptoms independently rather than joining cache hit ratio, page errors, and database waiters into one page.

```json
{
 "rootCause": {
  "summary": "A cache policy reload changed the default TTL to 1800 seconds with zero jitter; the warmup loaded the catalogue together, so entries expired in synchronized waves and flooded the database.",
  "evidence": [
   "config/config-review.diff:7",
   "config/config-review.diff:8",
   "deploy/deploy-history.jsonl:4",
   "logs/cache.log:583",
   "logs/api.log:593",
   "logs/db.log:585"
  ]
 },
 "timeline": [
  {
   "time": "2025-03-18T14:42:00.000Z",
   "event": "Cache policy reload completed a warmup of 38400 keys."
  },
  {
   "time": "2025-03-18T15:12:00.000Z",
   "event": "First expiration wave caused the cache hit ratio to fall and page errors to begin."
  },
  {
   "time": "2025-03-18T15:42:00.000Z",
   "event": "Second expiration wave repeated and database connections saturated."
  }
 ],
 "impact": {
  "failedPageRequests": 2772,
  "peakDbCpuPercent": 69.44,
  "peakDbConnections": 168,
  "affectedMinutes": 8
 },
 "actionItems": [
  {
   "text": "Restore cache expiry jitter and keep a bounded TTL distribution for every policy reload.",
   "owner": "Maya Chen"
  },
  {
   "text": "Add an alert joining low cache hit ratio with page errors and database CPU or connection waiters.",
   "owner": "Ravi Mehta"
  }
 ]
}
```
