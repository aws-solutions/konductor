# Requirements: API rate limits

Source: `docs/product/rate-limits-request.md` (agreed 2026-10-30). The June 2025 per-IP note in `docs/notes/` is
superseded and is not a requirement.

## R6. One allowance across instances

1. WHILE two or more instances serve traffic, the service SHALL count a key's requests in the shared key-value
   store (`src/kv.js`), so the allowance holds for the whole service and not per instance.
2. IF the key-value store cannot be reached THEN the service SHALL let the request through and log the failure
   (fail open), so an outage of the store does not take the API down. (Open question Q2 asks product to confirm.)

## R5. Exempt callers

1. WHEN a request carries a key with `admin: true` THEN the service SHALL NOT limit or count it.
2. WHEN a request is `GET /health` THEN the service SHALL NOT limit it and SHALL NOT require a key.

## R4. Remaining allowance header

1. WHEN the service answers a request from a limited key (any status, including 429) THEN it SHALL set
   `X-RateLimit-Remaining` to the requests left in the current window (0 or more).

## R3. Over the limit

1. WHEN a key has used its allowance in the current window THEN the service SHALL answer 429 with the body
   `{"error": "rate_limited"}` and a `Retry-After` header holding the whole seconds until the window ends (at least 1).
2. WHEN a request is refused with 429 THEN the service SHALL NOT run the route.

## R2. Plan figures come from configuration

1. WHEN a key on the `starter` plan is counted THEN its allowance SHALL be the `starter.requestsPerMinute` value of
   `config/plans.json` (90 today).
2. WHEN a key on the `studio` plan is counted THEN its allowance SHALL be the `studio.requestsPerMinute` value (720 today).
3. The service SHALL read the figures from `config/plans.json`; no figure is copied into code.

## R1. Limit belongs to the key

As an account owner, I want each of my keys to have its own allowance, so that one script does not block my other keys.

1. WHEN a request carries a valid key THEN the service SHALL count it against that key's allowance only.
2. WHEN two keys of the same account send requests THEN the service SHALL count each key separately.
3. The service SHALL NOT limit by client IP address (the June 2025 proposal is superseded).

## Glossary

- **Key**: an API key from `data/keys.json`, sent in `X-Api-Key`.
- **Allowance**: the number of requests a key may make in one minute, from `config/plans.json` (`requestsPerMinute`).
- **Window**: one fixed minute, counted for the whole service (both instances together).
