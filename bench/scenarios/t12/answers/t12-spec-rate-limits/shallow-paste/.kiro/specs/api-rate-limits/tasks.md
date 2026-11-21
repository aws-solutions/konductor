# Tasks

A shallow fake (review fix, 2026-11-21): the product request pasted in as the requirements, each one its own
acceptance, and three generic tasks. It must score 40 or less.

```json
{
  "requirements": [
    { "id": "R1", "text": "The limit belongs to the API key. Two keys of the same account each get their own allowance.", "acceptance": ["The limit belongs to the API key. Two keys of the same account each get their own allowance."] },
    { "id": "R2", "text": "Each plan gets the per-minute figure in config/plans.json; read them from there, do not copy them into code.", "acceptance": ["Each plan gets the per-minute figure in config/plans.json; read them from there, do not copy them into code."] },
    { "id": "R3", "text": "When a caller goes over, answer 429 with a Retry-After header and the body {\"error\": \"rate_limited\"}.", "acceptance": ["When a caller goes over, answer 429 with a Retry-After header and the body {\"error\": \"rate_limited\"}."] },
    { "id": "R4", "text": "Every limited response also tells the caller how many requests are left in the current minute, in X-RateLimit-Remaining.", "acceptance": ["Every limited response also tells the caller how many requests are left in the current minute, in X-RateLimit-Remaining."] },
    { "id": "R5", "text": "Ops keys (admin: true in data/keys.json) must never be limited.", "acceptance": ["Ops keys (admin: true in data/keys.json) must never be limited."] },
    { "id": "R6", "text": "/health must never be limited or need a key.", "acceptance": ["/health must never be limited or need a key."] },
    { "id": "R7", "text": "We run two instances; a key allowance is for the whole service, not per instance.", "acceptance": ["We run two instances; a key allowance is for the whole service, not per instance."] }
  ],
  "tasks": [
    { "id": "T1", "title": "Add a limiter counter in src/kv.js", "requirements": ["R1", "R2"], "files": ["src/kv.js"], "dependsOn": [] },
    { "id": "T2", "title": "Wire the limiter into the server", "requirements": ["R3", "R4", "R5", "R6"], "files": ["src/server.js"], "dependsOn": ["T1"] },
    { "id": "T3", "title": "Write tests and handle the remaining edge cases", "requirements": ["R1", "R7"], "files": ["test/limiter.test.js"], "dependsOn": ["T2"] }
  ],
  "openQuestions": ["What burst size should we allow?"]
}
```
