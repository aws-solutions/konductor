# Payments re-platform: draft program plan

| ID | Milestone | Owner | Target date | Exit criteria | Depends on |
|----|-----------|-------|-------------|---------------|------------|
| M1 | Design approved | Arch team | 2027-02-05 | Design doc signed off by PE review | - |
| M2 | Core ledger service live in beta | Payments team | 2027-03-12 | All ledger APIs pass contract tests in beta | M1 |
| M3 | Improve performance | Payments team | 2027-03-26 | Better performance | M5 |
| M4 | Fraud checks integrated | Risk team | 2027-04-02 | Fraud API called on 100% of beta transactions | M2 |
| M5 | Load test complete | Payments team | 2027-04-09 | Sustains 3,000 TPS for 1 hour with p99 < 300 ms | M3 |
| M6 | GA | Payments team | 2027-03-30 | 100% of traffic on new stack for 7 days with no Sev2 | M4, M5 |

Estimates: M2 is an L (3-4 weeks), M4 is an M (1-2 weeks), M5 is an M. No buffer applied.
Resourcing: Dana (Payments) is 60% on M2, 50% on M3 and 40% on M5 during March.
