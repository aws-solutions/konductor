# Tasks: API rate limits

- [ ] 1. Add rate limiting middleware
- [ ] 2. Add tests

```json
{
  "requirements": [
    { "id": "R1", "text": "The API SHALL be rate limited per API key according to the plan.", "acceptance": ["WHEN a client exceeds the limit THEN the API returns 429 with Retry-After and rate_limited"] },
    { "id": "R2", "text": "Responses SHALL include X-RateLimit-Remaining.", "acceptance": ["WHEN a request is made THEN the header is present"] },
    { "id": "R3", "text": "Limits SHALL be configurable.", "acceptance": ["WHEN the config changes THEN limits change"] }
  ],
  "tasks": [
    { "id": "1", "title": "Add a rate limiting middleware", "requirements": ["R1"], "files": ["src/middleware/rate-limit.js"], "dependsOn": [] },
    { "id": "2", "title": "Add tests for 429 responses", "requirements": ["R1", "R2"], "files": ["test/rate-limit.test.js"], "dependsOn": ["1"] }
  ],
  "openQuestions": ["Should limits be per minute or per hour?"]
}
```
