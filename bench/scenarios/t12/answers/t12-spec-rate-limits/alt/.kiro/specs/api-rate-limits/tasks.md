# API rate limits: work order

Tests come first, so each later step turns some of them green.

1. Write the behaviour tests in `test/rate-limit.test.js` against `createServer()`: going over the allowance gives
   429 with `Retry-After` and `rate_limited`; two keys of one account are counted apart; ops keys and `/health` are
   never refused; `X-RateLimit-Remaining` counts down. They fail until step 4.
2. Build the sliding-window counter `src/limits/counter.js` on `kv.incr` in `src/kv.js`, with unit tests for the
   minute boundary.
3. Build `src/limits/policy.js`: allowances from `config/plans.json`, `null` for admin keys.
4. Wire the limiter into `src/server.js` between `authenticate()` and routing; add the limit headers to `send()`.
5. Store unreachable: fall back to the per-instance count at half the allowance and log once a minute.
6. Two-instance test: two servers on one store share one allowance.

```json
{
  "openQuestions": [
    "Q1 (product, Dana): what does burst in config/plans.json mean, extra requests on top of the minute figure or a per-second cap? It is ignored until decided.",
    "Q2 (product and support): is failing open to a per-instance count at half the allowance acceptable while the shared store is down, or should the API refuse with 503?",
    "Q3 (support): should 429 responses also be logged per account so support can see who is being limited?"
  ],
  "tasks": [
    { "id": "T1", "title": "Behaviour tests first: over the limit gives 429 with Retry-After and rate_limited, keys counted apart, ops keys and /health never refused, X-RateLimit-Remaining counts down", "requirements": ["LIM-1", "LIM-3", "LIM-4", "LIM-5", "LIM-6"], "files": ["test/rate-limit.test.js"], "dependsOn": [] },
    { "id": "T2", "title": "Sliding-window counter on the shared store's atomic incr", "requirements": ["LIM-7"], "files": ["src/limits/counter.js", "src/kv.js", "test/limits-counter.test.js"], "dependsOn": [] },
    { "id": "T3", "title": "Policy: allowance per plan from config/plans.json, none for admin keys", "requirements": ["LIM-2", "LIM-5"], "files": ["src/limits/policy.js", "config/plans.json"], "dependsOn": [] },
    { "id": "T4", "title": "Wire the limiter between authenticate() and routing; 429 refusal and X-RateLimit-Remaining on every limited response", "requirements": ["LIM-3", "LIM-4", "LIM-6"], "files": ["src/server.js"], "dependsOn": ["T2", "T3"] },
    { "id": "T5", "title": "Store unreachable: per-instance fallback count at half the allowance, one log line a minute", "requirements": ["LIM-7"], "files": ["src/limits/counter.js"], "dependsOn": ["T2"] },
    { "id": "T6", "title": "Two server instances on one store share one allowance", "requirements": ["LIM-7"], "files": ["test/two-instances.test.js"], "dependsOn": ["T4"] }
  ],
  "requirements": [
    { "id": "LIM-1", "text": "Each API key has its own allowance; keys of the same account are counted separately.", "acceptance": ["After key A of an account uses its allowance, key B of the same account is still served."] },
    { "id": "LIM-2", "text": "A key's allowance is its plan's requestsPerMinute in config/plans.json (starter 90, studio 720 today), never a figure in code.", "acceptance": ["With starter.requestsPerMinute set to 3, the fourth starter request in a minute is refused.", "A studio key gets studio.requestsPerMinute requests a minute."] },
    { "id": "LIM-3", "text": "A key over its allowance gets 429 with a Retry-After header in whole seconds and the body {\"error\": \"rate_limited\"}; the route does not run.", "acceptance": ["The first request over the allowance gets 429, Retry-After between 1 and 60, the rate_limited body, and creates no note."] },
    { "id": "LIM-4", "text": "Every response to a limited key carries X-RateLimit-Remaining, the requests left this minute.", "acceptance": ["After 2 of 90 requests the header is 88; on a 429 it is 0."] },
    { "id": "LIM-5", "text": "Ops keys (admin: true in data/keys.json) are exempt: never refused and never counted.", "acceptance": ["1,000 requests in a minute from qb_ops_0001 all succeed."] },
    { "id": "LIM-6", "text": "GET /health is never limited and needs no key.", "acceptance": ["/health answers 200 with no key while a starter key is being refused."] },
    { "id": "LIM-7", "text": "The allowance holds for the whole service: both instances count in the shared store, so a key does not get double by switching server.", "acceptance": ["Spread over two instances sharing one store, a starter key is refused at request 91 in total."] }
  ]
}
```
