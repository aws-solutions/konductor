# Rules flagged for owner review: test-coverage-analysis

Panel: gpt-5.6-luna, deepseek-3.2, glm-5. Votes are worth/style per judge (Y or n).

| Rule | Tag | Votes | Vote result | Flags | Rule text |
| --- | --- | --- | --- | --- | --- |
| R01 | useful | gpt-5.6-luna: Y/n; deepseek-3.2: Y/n; glm-5: n/n | keep | split on worth (2 of 3) | When analyzing test coverage, the answer must first determine the application architecture type (frontend, backend, serverless, microservices, or full-stack) and recommend an appropriate testing model (pyramid, trophy, hybrid, or microservices). |
| R05 | useful | gpt-5.6-luna: Y/n; deepseek-3.2: Y/n; glm-5: n/n | keep | split on worth (2 of 3) | When analyzing non-functional requirements, the answer must map each NFR category to the appropriate test type (e.g., Performance NFRs to load tests, Security NFRs to security tests, Reliability NFRs to failure injection tests). |
| R09 | style | gpt-5.6-luna: Y/Y; deepseek-3.2: Y/n; glm-5: Y/n | keep | style (1 vote), extractor tagged style | When presenting findings, the answer must organize them in order: CRITICAL issues first, then IMPORTANT issues, then SUGGESTIONs. |
| R10 | style | gpt-5.6-luna: Y/Y; deepseek-3.2: Y/n; glm-5: Y/Y | drop | style (2 votes), extractor tagged style | When reporting coverage status, the answer must use visual indicators consistently: ✅ for Covered/Pass, ❌ for Missing/Fail, ⚠️ for Partial/Warning, and 🔍 for Manual Required. |

Record a decision in owner-decisions.json as {"R03": "keep", "R07": "drop"} and run vote again (cached, no cost).
