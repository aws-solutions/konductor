# Notes

I read the README and the main files. Summary below.

```json
{
 "rootCause": {
  "summary": "A cache policy reload changed the default TTL to 1800 seconds with zero jitter; the warmup loaded the catalogue together, so entries expired in synchronized waves and flooded the database.",
  "evidence": [
   "config/config-review.diff:7",
   "config/config-review.diff:8",
   "deploy/deploy-history.jsonl:4"
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
  "peakDbCpuPercent": 69,
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
