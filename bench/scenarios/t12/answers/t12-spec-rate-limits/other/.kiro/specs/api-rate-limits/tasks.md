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
  "requirements": [
    {
      "id": "R1",
      "text": "Unlike the June 2025 proposal to throttle by client IP, the allowance follows the API key: each key of an account has its own count.",
      "acceptance": [
        "WHEN two keys of one account send requests THEN each key is counted separately"
      ]
    },
    {
      "id": "R2",
      "text": "Allowances come from config/plans.json requestsPerMinute: starter 90, studio 720 today.",
      "acceptance": [
        "WHEN a starter key is counted THEN its allowance is starter.requestsPerMinute",
        "WHEN a studio key is counted THEN its allowance is studio.requestsPerMinute"
      ]
    },
    {
      "id": "R3a",
      "text": "A key over its allowance gets status 429 and the route does not run.",
      "acceptance": [
        "WHEN a key has used its allowance THEN the answer is 429"
      ]
    },
    {
      "id": "R3b",
      "text": "That answer carries Retry-After: the whole seconds left in the window.",
      "acceptance": [
        "WHEN a 429 is sent THEN Retry-After is a positive whole number of seconds"
      ]
    },
    {
      "id": "R3c",
      "text": "Its body is {\"error\": \"rate_limited\"}.",
      "acceptance": [
        "WHEN a 429 is sent THEN the JSON body error is rate_limited"
      ]
    },
    {
      "id": "R4",
      "text": "Every response to a limited key carries X-RateLimit-Remaining with the requests left in the window.",
      "acceptance": [
        "WHEN a limited key is answered THEN X-RateLimit-Remaining is 0 or more"
      ]
    },
    {
      "id": "R5",
      "text": "Admin (ops) keys are never limited or counted, and /health is never limited and needs no key.",
      "acceptance": [
        "WHEN an admin key sends any number of requests THEN none is refused",
        "WHEN GET /health is called THEN it is never limited"
      ]
    },
    {
      "id": "R6",
      "text": "Both instances share one count through src/kv.js, so a key has one allowance across the whole service; when the store is down, requests fail closed with 503 until it returns.",
      "acceptance": [
        "WHEN a key alternates between two instances THEN it gets one allowance in total"
      ]
    }
  ],
  "tasks": [
    {
      "id": "1.1",
      "title": "Add src/rate-limit.js counting per key and minute in src/kv.js",
      "requirements": [
        "R1",
        "R2",
        "R6"
      ],
      "files": [
        "src/rate-limit.js",
        "src/kv.js"
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
        "src/rate-limit.js",
        "config/plans.json"
      ],
      "dependsOn": []
    },
    {
      "id": "2.1",
      "title": "Call the limiter after authenticate, skip admin keys, answer 429 with Retry-After",
      "requirements": [
        "R3a",
        "R5",
        "R3b",
        "R3c"
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
    },
    {
      "id": "3",
      "title": "Fail open when the shared store is down",
      "requirements": [
        "R6"
      ],
      "files": [
        "src/rate-limit.js"
      ],
      "dependsOn": [
        "1.1"
      ]
    },
    {
      "id": "4.1",
      "title": "Test over the limit (429, Retry-After), keys counted apart, admin and health never limited",
      "requirements": [
        "R1",
        "R3a",
        "R5",
        "R3b",
        "R3c"
      ],
      "files": [
        "test/rate-limit.test.js"
      ],
      "dependsOn": [
        "2.1",
        "2.2"
      ]
    },
    {
      "id": "4.2",
      "title": "Test two instances sharing one store hold one allowance",
      "requirements": [
        "R6"
      ],
      "files": [
        "test/rate-limit.test.js"
      ],
      "dependsOn": [
        "2.1"
      ]
    }
  ],
  "openQuestions": [
    "burst in config/plans.json is not explained by the request; it stays unused until product says what it means. Owner: product.",
    "Should X-RateLimit-Remaining go on every response or only on limited ones? Default here: every response to a limited key.",
    "Fail closed was chosen for a store outage to protect the database; product may prefer fail open. Owner: product."
  ]
}
```
