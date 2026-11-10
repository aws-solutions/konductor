# doc-accuracy-analyzer fixture key (docs/order-service-design.md)
- "10,000 RPS at peak" : Inaccurate. perf/results.csv tops out at ~2,310 achieved RPS; at 10k target error rate 48%.
- "Retry with backoff already implemented in src/retry.js, used by every outbound call": Inaccurate. retry.js is a TODO single try; client.js notifyBilling bypasses it.
- "Auth requires only configuration; auth.js validates JWTs": Inaccurate. auth.js decodes only, no signature check.
- "All DB access parameterized in orderRepo.js": Inaccurate. search() concatenates (SQL injection).
- "DynamoDB max item 400 KB": Verified. "Lambda max 15 minutes": Verified.
- "Standard pattern AWS recommends... well known exactly-once": Unverifiable/Inaccurate (outbox + streams is at-least-once).
- "Rollout takes one sprint because nearly everything is built": Overstated/Inaccurate given the above.

# docs/export-design.md (added in v2, used by p2)
- "exporter.js already streams rows to S3 using multipart upload": Inaccurate. src/exporter.js builds the whole CSV in memory and writes /tmp/export-<id>.csv; no S3 call at all.
- "Lambda /tmp gives plenty of room for 1.2 GB": Missing Context / Unverifiable. /tmp defaults to 512 MB and is configurable up to 10,240 MB; nothing in the repo shows the function's ephemeral storage setting.
- "Exports complete in about 40 seconds": Overstated / Missing Context. 38 s is the medium-tier p50 only; large tier p50 212 s, p95 610 s, max 1480 s (perf/export-timings.csv).
- Step 4 feasibility break (the key finding): a synchronous API Gateway REST + Lambda request cannot return a 1.2 GB body or run for minutes. Relevant limits to cite or mark for verification: API Gateway REST integration timeout 29 s by default, 10 MB payload; Lambda synchronous response payload 6 MB. Even the medium p50 (38 s) exceeds a 29 s timeout. Building a 1.2 GB string in memory also likely exceeds the V8 string length limit. "No new infrastructure / one week" is therefore Overstated.
- "Failed exports are retried three times by src/scheduler.js": the scheduler does retry 3 times (true), but the on-demand request path in section 2 never calls the scheduler. Expected: Verified-with-caveat or Missing Context. Calling the retry code nonexistent is a false positive.
- "Exports are rate limited per customer": Unverifiable (no rate-limit code or config in the repo).
