# Design Document: API Rate Limiter

Express middleware `rateLimit()` in TypeScript. Sliding-window counter in Redis using a
sorted set per key (`rl:{apiKey}`), trimmed with ZREMRANGEBYSCORE then ZCARD inside a MULTI.
`PlanResolver` caches plan per key for 5 minutes. Redis errors are caught in the middleware,
which calls `metrics.increment('ratelimit.failopen')` and calls `next()`.
Tests: unit tests with a fake Redis; one integration test against redis-server in CI.
