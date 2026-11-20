# Tasks: API rate limits

- [ ] 1. Counter on the shared store
  - [ ] 1.1 Add `src/rate-limit.js` with `check(caller, plans, now)` counting in `src/kv.js` per key and minute window
    - _Requirements: R1, R2, R6_
  - [ ] 1.2 Load `config/plans.json` once at start-up and pass it to the limiter
    - _Requirements: R2_
- [ ] 2. Wire the limiter into the request path
  - [ ] 2.1 In `src/server.js`, call the limiter after `authenticate()`, skip admin keys, answer 429 with `Retry-After` and `rate_limited`
    - _Requirements: R3, R5_
  - [ ] 2.2 Add `X-RateLimit-Remaining` to every response of a limited key through `send()`
    - _Requirements: R4_
- [ ] 3. Fail open when the store is down, with one log line per minute
  - _Requirements: R6_
- [ ] 4. Tests
  - [ ] 4.1 Test a starter key going over the limit (429, Retry-After, body), two keys of one account counted apart, admin and /health never limited
    - _Requirements: R1, R3, R5_
  - [ ] 4.2 Test two server instances sharing one store hold one allowance between them
    - _Requirements: R6_

## Task Dependency Graph

- Wave 1: 1.1, 1.2
- Wave 2: 2.1, 2.2, 3 (after 1.1)
- Wave 3: 4.1, 4.2 (after wave 2)

```json
{
 "openQuestions": [
  "Q2: when the shared store is down, should requests fail open (allowed) or closed (429)? The design fails open.",
  "Q1: config/plans.json has a burst value per plan, but the request does not say what it means (extra requests above the minute figure, or a per-second cap?). Not used until product decides."
 ],
 "tasks": [
  {
   "dependsOn": [],
   "files": [
    "src/kv.js",
    "src/rate-limit.js"
   ],
   "requirements": [
    "item-13",
    "item-9",
    "item-8"
   ],
   "title": "In short: Add src/rate-limit.js counting per key and minute in src/kv.js",
   "id": "item-1"
  },
  {
   "dependsOn": [],
   "files": [
    "config/plans.json",
    "src/rate-limit.js"
   ],
   "requirements": [
    "item-9"
   ],
   "title": "In short: Load config/plans.json at start-up for the limiter",
   "id": "item-2"
  },
  {
   "dependsOn": [
    "item-1"
   ],
   "files": [
    "src/server.js"
   ],
   "requirements": [
    "item-12",
    "item-10"
   ],
   "title": "In short: Call the limiter after authenticate, skip admin keys, answer 429 with Retry-After",
   "id": "item-3"
  },
  {
   "dependsOn": [
    "item-1"
   ],
   "files": [
    "src/server.js"
   ],
   "requirements": [
    "item-11"
   ],
   "title": "In short: Add X-RateLimit-Remaining to limited responses",
   "id": "item-4"
  },
  {
   "dependsOn": [
    "item-1"
   ],
   "files": [
    "src/rate-limit.js"
   ],
   "requirements": [
    "item-13"
   ],
   "title": "In short: Fail open when the shared store is down",
   "id": "item-5"
  },
  {
   "dependsOn": [
    "item-4",
    "item-3"
   ],
   "files": [
    "test/rate-limit.test.js"
   ],
   "requirements": [
    "item-12",
    "item-10",
    "item-8"
   ],
   "title": "In short: Test over the limit (429, Retry-After), keys counted apart, admin and health never limited",
   "id": "item-6"
  },
  {
   "dependsOn": [
    "item-3"
   ],
   "files": [
    "test/rate-limit.test.js"
   ],
   "requirements": [
    "item-13"
   ],
   "title": "In short: Test two instances sharing one store hold one allowance",
   "id": "item-7"
  }
 ],
 "requirements": [
  {
   "acceptance": [
    "WHEN a key alternates between two instances THEN it gets one allowance in total"
   ],
   "text": "In short: Counting is shared across both instances through src/kv.js so the allowance holds for the whole service, not per instance; the store being down fails open.",
   "id": "item-13"
  },
  {
   "acceptance": [
    "WHEN GET /health is called THEN it is never limited",
    "WHEN an admin key sends any number of requests THEN none is refused"
   ],
   "text": "In short: Admin (ops) keys are never limited or counted, and /health is never limited and needs no key.",
   "id": "item-12"
  },
  {
   "acceptance": [
    "WHEN a limited key is answered THEN X-RateLimit-Remaining is 0 or more"
   ],
   "text": "In short: Every response to a limited key carries X-RateLimit-Remaining with the requests left in the window.",
   "id": "item-11"
  },
  {
   "acceptance": [
    "WHEN a key has used its allowance THEN the answer is 429 with Retry-After and rate_limited"
   ],
   "text": "In short: Over the limit the service answers 429 with a Retry-After header in whole seconds and the body {\"error\": \"rate_limited\"}; the route does not run.",
   "id": "item-10"
  },
  {
   "acceptance": [
    "WHEN a studio key is counted THEN its allowance is studio.requestsPerMinute",
    "WHEN a starter key is counted THEN its allowance is starter.requestsPerMinute"
   ],
   "text": "In short: Allowances come from config/plans.json requestsPerMinute: starter 90, studio 720 today.",
   "id": "item-9"
  },
  {
   "acceptance": [
    "WHEN two keys of one account send requests THEN each key is counted separately"
   ],
   "text": "In short: The limit belongs to each API key: two keys of the same account are counted apart; the service does not limit by client IP (the 2025 per-IP note is superseded).",
   "id": "item-8"
  }
 ]
}
```
