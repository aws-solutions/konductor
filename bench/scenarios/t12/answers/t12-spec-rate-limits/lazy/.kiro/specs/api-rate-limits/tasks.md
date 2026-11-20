# Tasks: API rate limits

- [ ] 1. Counter on the shared store
  - [ ] 1.1 Add `src/rate-limit.js` with `check(caller, plans, now)` counting in `src/kv.js` per key and minute window
    - _Requirements: R1, R2, R6_
  - [ ] 1.2 Load `config/plans.json` once at start-up and pass it to the limiter
    - _Requirements: R2_
- [ ] 2. Wire the limiter into the request path
  - [ ] 2.1 In `src/server.js`, call the limiter after `authenticate()`, skip admin keys, answer 300 with `Retry-After` and `rate_limited`
    - _Requirements: R3, R5_
  - [ ] 2.2 Add `X-RateLimit-Remaining` to every response of a limited key through `send()`
    - _Requirements: R4_
- [ ] 3. Fail open when the store is down, with one log line per minute
  - _Requirements: R6_
- [ ] 4. Tests
  - [ ] 4.1 Test a starter key going over the limit (300, Retry-After, body), two keys of one account counted apart, admin and /health never limited
    - _Requirements: R1, R3, R5_
  - [ ] 4.2 Test two server instances sharing one store hold one allowance between them
    - _Requirements: R6_

## Task Dependency Graph

- Wave 1: 1.1, 1.2
- Wave 2: 2.1, 2.2, 3 (after 1.1)
- Wave 3: 4.1, 4.2 (after wave 2)

```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "The limit belongs to each API key: two keys of the same account are counted apart; the service does not limit by client IP (the 2025 per-IP note is superseded).",
   "acceptance": [
    "WHEN two keys of one account send requests THEN each key is counted separately"
   ]
  },
  {
   "id": "R2",
   "text": "Allowances come from config/plans.json requestsPerMinute: starter 90, studio 720 today.",
   "acceptance": [
    "WHEN a starter key is counted THEN its allowance is starter.requestsPerMinute"
   ]
  },
  {
   "id": "R3",
   "text": "Over the limit the service answers 429 with a Retry-After header in whole seconds and the body {\"error\": \"rate_limited\"}; the route does not run.",
   "acceptance": [
    "WHEN a key has used its allowance THEN the answer is 429 with Retry-After and rate_limited"
   ]
  }
 ],
 "tasks": [
  {
   "id": "1.1",
   "title": "Add src/rate-limit.js counting per key and minute in src/kv.js",
   "requirements": [
    "R1",
    "R2"
   ],
   "files": [
    "src/rate-limit.js"
   ],
   "dependsOn": []
  },
  {
   "id": "1.2",
   "title": "Load config/plans.json at start-up for the limiter",
   "requirements": [
    "R2"
   ],
   "files": [
    "src/rate-limit.js"
   ],
   "dependsOn": []
  },
  {
   "id": "2.1",
   "title": "Call the limiter after authenticate, skip admin keys, answer 429 with Retry-After",
   "requirements": [
    "R3"
   ],
   "files": [
    "src/server.js"
   ],
   "dependsOn": [
    "1.1"
   ]
  },
  {
   "id": "2.2",
   "title": "Add X-RateLimit-Remaining to limited responses",
   "requirements": [
    "R4"
   ],
   "files": [
    "src/server.js"
   ],
   "dependsOn": [
    "1.1"
   ]
  }
 ],
 "openQuestions": [
  "Q1: config/plans.json has a burst value per plan, but the request does not say what it means (extra requests above the minute figure, or a per-second cap?). Not used until product decides."
 ]
}
```
