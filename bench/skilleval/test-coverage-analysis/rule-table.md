# Rules: test-coverage-analysis

Bucket is the rubric bucket for items tied to the rule. Status shows the owner decision when there is one.

| Rule | Bucket | Status | Worth votes | Style votes | Rule text |
| --- | --- | --- | --- | --- | --- |
| R01 | value | kept (owner) | 2 of 3 | 0 | When analyzing test coverage, the answer must first determine the application architecture type (frontend, backend, serverless, microservices, or full-stack) and recommend an appropriate testing model (pyramid, trophy, hybrid, or microservices). |
| R02 | value | kept | 3 of 3 | 0 | When reporting test distribution, the answer must use test case counts from running the test suite, not file counts, because a single test file may contain 10-50 test cases. |
| R03 | value | kept | 3 of 3 | 0 | When analyzing test distribution, the answer must compare the current distribution against the recommended model and report alignment status as Aligned (within ±10%), Misaligned (±10% to ±25%), or Severely Misaligned (>±25%). |
| R04 | value | kept | 3 of 3 | 0 | When identifying test gaps, the answer must categorize each gap as Critical (must fix), Warning (should fix), or Manual Testing Required. |
| R05 | value | kept (owner) | 2 of 3 | 0 | When analyzing non-functional requirements, the answer must map each NFR category to the appropriate test type (e.g., Performance NFRs to load tests, Security NFRs to security tests, Reliability NFRs to failure injection tests). |
| R06 | value | kept | 3 of 3 | 0 | When evaluating release readiness, the answer must apply coverage thresholds based on the testing philosophy (e.g., for Frontend Trophy model: critical user flows require 100% integration test coverage). |
| R07 | value | kept | 3 of 3 | 0 | When detecting anti-patterns in tests, the answer must flag tests that test implementation details instead of behavior, especially in frontend applications. |
| R08 | - | dropped | 0 of 3 | 0 | When calculating test coverage percentages, the answer must use the formula (covered_items / total_items) * 100 for acceptance criteria coverage, test plan coverage, and feature coverage. |
| R09 | format | kept (owner) | 3 of 3 | 1 | When presenting findings, the answer must organize them in order: CRITICAL issues first, then IMPORTANT issues, then SUGGESTIONs. |
| R10 | - | dropped (owner) | 3 of 3 | 2 | When reporting coverage status, the answer must use visual indicators consistently: ✅ for Covered/Pass, ❌ for Missing/Fail, ⚠️ for Partial/Warning, and 🔍 for Manual Required. |
| R11 | value | kept | 3 of 3 | 0 | When assessing release readiness, the answer must report the status as Ready (all gates passed), At Risk (minor gaps), or Not Ready (critical gaps or failing tests). |
