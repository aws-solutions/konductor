# Design: API rate limits

## Where the check runs

`src/server.js` `handle()` already knows the caller after `authenticate()`. The limiter runs right after that line and
before routing, so `/health` (answered earlier) is never counted and unknown keys get 401 before any counting.
Admin callers (`caller.admin`) skip the limiter.

## Counting

A new module `src/rate-limit.js` exports `check(caller, plans, now)`:

- window id: `Math.floor(now / 60000)`; counter key: `rl:<api key>:<window id>`.
- `kv.incr(counterKey, 60000)` gives the count for this window. Because both instances use the same store and
  `incr` is atomic there, the count is service-wide (R6).
- allowance: `plans[caller.plan].requestsPerMinute`, read from `config/plans.json` at start-up (R2).
- result: `{ allowed: count <= allowance, remaining: max(0, allowance - count), retryAfterSec: ceil(kv.ttl / 1000) }`.

A fixed window can let a key send up to twice its allowance across a window edge. That is accepted for this round;
a sliding window needs two reads per request. The `burst` field in `config/plans.json` is not used until product says
what it means (Q1).

## Responses

- Allowed: route runs; `X-RateLimit-Remaining` is added to the response headers (`send()` gets the header).
- Refused: 429, `Retry-After`, `X-RateLimit-Remaining: 0`, body `{"error":"rate_limited"}`; the route does not run.
- Store failure: allow, log `rate_limit_store_error` once per minute (R6.2).

## Alternatives rejected

- Per-IP limits at the load balancer: superseded (shared office IPs; the balancer cannot see keys).
- Per-instance in-memory counters: a script hitting both instances would get double the allowance (R6).
