# Request: rate limits for the public API

From: Dana (product), to the API team. Status: agreed with support and sales on 2026-10-30.

Two customers on the starter plan ran scripts that hammered `/v1/notes` last month and slowed everyone else down.
We want limits before the studio plan launch.

What we agreed:

- The limit belongs to the API key. Two keys of the same account each get their own allowance.
- Each plan gets the per-minute figure in `config/plans.json` (sales quotes those numbers, so read them from there,
  do not copy them into code).
- When a caller goes over, answer 429 with a `Retry-After` header (whole seconds until they may try again) and the
  body `{"error": "rate_limited"}`.
- Every limited response also tells the caller how many requests are left in the current minute, in
  `X-RateLimit-Remaining`. Support wants that so customers can pace themselves.
- Our own ops keys (`admin: true` in `data/keys.json`) must never be limited: the status page and the nightly export
  use them.
- `/health` is called by the load balancer every few seconds and must never be limited or need a key.
- We run two instances behind the load balancer. A key's allowance is for the whole service, not per instance:
  a script must not get double by hitting both.

Out of scope for this round: a billing change, a dashboard, limits on the admin API.
