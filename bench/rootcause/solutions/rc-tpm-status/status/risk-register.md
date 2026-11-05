# Risk register, 2025-03-14

Score = probability x impact on a 1 to 3 scale (Low 1, Medium 2, High 3).

| ID | Risk | Probability | Impact | Score | Owner | Mitigation | Trigger or contingency |
|----|------|-------------|--------|-------|-------|------------|------------------------|
| R1 | Payment provider changes its API during integration | Medium | High | 6 | Priya | Weekly sync with the provider; pin the API version | Provider announces a breaking change: freeze W3 scope and re-estimate |
| R2 | Contract for the load-testing tool is not signed | n/a | n/a | n/a | Omar | Contract signed on 2025-03-03 | Closed: obsolete, retire from the register |
| R3 | Staging environment lacks capacity for the load test and the payment connection | High | High | 9 | Omar | Add the sandbox connection and size staging for the test by 2025-03-21 | Staging not ready by 2025-03-21: move the load test and launch together |
| R4 | QA lead is away for two weeks in April | Medium | Medium | 4 | Sam | Borrow a tester from another team | No cover confirmed by 2025-03-28: reduce regression scope |
| R5 | Design system release breaks the old checkout | Low | Medium | 2 | Lena | Visual regression suite | Closed |
| R6 | Critical path slip: W3 and then W7 push launch past 2025-04-15 | High | High | 9 | Priya | Executive decision on date or scope this week; start W7 prep early | W3 not at 70 percent by 2025-03-28: confirm the new launch date |
| R7 | Key person: Priya owns W2, W3, W9 and W11 and is the only engineer who knows the gateway code | High | High | 9 | Ana | Chen pairs on gateway code from next week; document the integration | Priya unavailable for more than 2 days: Chen takes W11 |
| R8 | Payment provider sandbox outages (3 working days lost 2025-03-10 to 2025-03-12) | Medium | Medium | 4 | Priya | Ask the provider for an availability commitment; build a local stub for tests | Another outage over one day: escalate to the provider account manager |
| R9 | Budget overrun: 78 percent spent at 55 percent progress, estimate at completion about 1.70 million | High | High | 9 | Ana | Reforecast with finance this week; review the loyalty points UI for descoping | Forecast above 1.5 million at next review: request extra funding |
