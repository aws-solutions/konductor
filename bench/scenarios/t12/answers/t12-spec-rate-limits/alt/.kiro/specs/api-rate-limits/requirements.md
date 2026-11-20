# API rate limits: what we must deliver

Everything below comes from Dana's request (`docs/product/rate-limits-request.md`, agreed 2026-10-30) and from
`config/plans.json`. The 2025 note about throttling by IP at the load balancer was replaced by that request and plays
no part here.

The requirements are grouped by who is calling.

## Customers' API keys

**LIM-1 Each key has its own allowance.** A customer with two keys can use the full allowance on both; one script
cannot eat the allowance of the customer's other keys.

- Check: send the starter allowance from key A, then one request from key B of the same account; B is served.

**LIM-2 The allowance is the plan's per-minute figure in `config/plans.json`.** Starter is 90 and studio 720 today,
but sales changes them in that file, so nothing in the code repeats the numbers.

- Check: with `starter.requestsPerMinute` set to 3 in a test copy of the file, the fourth request in a minute is refused.
- Check: a studio key is allowed `studio.requestsPerMinute` requests a minute.

**LIM-3 Going over gives a clear refusal.** The answer is status 429, a `Retry-After` header with the whole seconds
(at least 1) until the key may call again, and the body `{"error": "rate_limited"}`. The route itself does not run.

- Check: the first request over the allowance gets 429, `Retry-After` between 1 and 60, the `rate_limited` body, and
  creates no note.

**LIM-4 Callers can pace themselves.** Every response to a limited key, refused or not, carries
`X-RateLimit-Remaining`: how many requests the key has left in the current minute.

- Check: after 2 of 90 requests the header says 88; on a 429 it says 0.

## Our own callers

**LIM-5 Ops keys are exempt.** A key with `admin: true` in `data/keys.json` is never refused and never counted
(the status page and the nightly export use them).

- Check: 1,000 requests in a minute from `qb_ops_0001` all succeed.

**LIM-6 The load balancer's health check is exempt.** `GET /health` is never refused and still needs no key.

- Check: `/health` answers 200 with no key while a starter key is being refused.

## The service as a whole

**LIM-7 One allowance across all instances.** Two instances run behind the load balancer; a key gets its allowance
once for the whole service, not once per server.

- Check: the starter allowance spread over two server instances that share one store is refused at request 91 in total.
