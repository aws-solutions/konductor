# API rate limits: how we build it

## Shape of the change

Two small modules under a new `src/limits/` folder, and one wrapper in `src/server.js`:

| Part | Job |
| --- | --- |
| `src/limits/policy.js` | Who is limited and by how much: `allowanceFor(caller, plans)` returns `null` for admin callers, else `plans[caller.plan].requestsPerMinute`. `plans` is `config/plans.json`, read once at start-up. |
| `src/limits/counter.js` | How many requests a key made in the last minute, counted in the shared store `src/kv.js`. |
| `src/server.js` | `handle()` keeps answering `/health` first and authenticating second; the limiter sits between authentication and routing. |

So unknown keys still get 401 and are not counted, `/health` never reaches the limiter, and admin keys skip it
because their allowance is `null`.

## Counting: a sliding window from two counters

A plain fixed minute is simple but lets a key send twice its allowance across a minute boundary (90 at 12:00:59 and
90 more at 12:01:00). Customers hammering `/v1/notes` is the very problem we are solving, so we smooth it:

- Each key has one counter per calendar minute in `src/kv.js`: `limit:<key>:<minute>`, created by `kv.incr()` with a
  two-minute expiry. `incr` is atomic in the managed store, so every instance adds to the same number.
- The estimate for "the last 60 seconds" is `current + previous * (1 - secondsIntoMinute / 60)`. This costs one
  `incr` and one read per request.
- A request is refused when the estimate is above the allowance. `Retry-After` is the seconds until the estimate
  drops back under it, at most the rest of the minute, at least 1. `X-RateLimit-Remaining` is
  `max(0, floor(allowance - estimate))`.

The estimate assumes the previous minute's requests were spread evenly. That is accepted: it is never more lenient
than a fixed window, and an exact sliding log would need one store entry per request.

## When the store cannot be reached

Fail open, but not without limit: if `kv.incr` throws, the counter falls back to an in-memory count on that instance
with half the allowance (two instances share the load), and logs `rate_limit_store_unavailable` at most once a minute.
That keeps the API up during a store outage and still stops a runaway script. Product should confirm this (Q2).

## Responses

`send()` gets one more argument, the limit headers, so every response of a limited key, 2xx, 4xx or 429, carries
`X-RateLimit-Remaining`. A refusal is `429`, `Retry-After`, body `{"error": "rate_limited"}`; the notes route is not called.

## What we are not doing

- Per-IP limits at the load balancer: the 2025 proposal, replaced because office IPs are shared and the balancer cannot see keys.
- Counting in each instance's memory: a script alternating between the two instances would get double.
- Using the `burst` figure from `config/plans.json`: nobody has said what it means (Q1).
