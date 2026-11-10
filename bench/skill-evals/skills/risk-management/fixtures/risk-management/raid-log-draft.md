# DC exit program: RAID log (draft by Sam, week of 2026-11-02)

| ID | Type | Description | Probability | Impact | Score | Mitigation | Owner | Due Date | Status |
|----|------|-------------|-------------|--------|-------|------------|-------|----------|--------|
| R-01 | R | Identity vendor SAML fix slips past mid-January, blocking Payments cutover | High | High | Medium | Monitor vendor updates | Priya | 2027-01-15 | Open |
| R-02 | R | Search index rebuild may not fit the 4-hour cutover window |  | High |  | Run a timed rebuild in staging | Lin | 2026-12-05 | Open |
| R-03 | R | Search load test is blocked because the performance test environment is not ready | High | Medium | High | Escalate to infra | Lin | 2026-11-20 | Open |
| R-04 | R | Payments cutover runbook not reviewed by on-call | Medium | Medium | High | Mitigate: tabletop review with on-call | Marco | 2026-12-12 | Open |
| A-01 | A | Two contractors start 2027-01-06 | | | | | Priya | | Open |
| A-02 | A | Legacy batch API stays up until the last cutover | | | | Validate: written confirmation from the batch API owner by 2026-11-30; if not confirmed, add API to cutover wave 1 | Priya | 2026-11-30 | Open |
| I-01 | I | Data migration tooling licence expired; nightly sync failing since 2026-10-30 | | High | | Renew licence | TBD | | Open |
| D-01 | D | Payments depends on Platform's new network egress proxy (target 2027-02-01) | Medium | High | High | Track in Platform sprint review | Priya | 2027-02-01 | Open |
| D-02 | D | Search depends on the shared DNS cutover tooling from Networking | Low | Medium | Low | Accept: if unavailable, Search uses manual Route 53 record swap (runbook RB-12) | Lin | 2027-01-20 | Open |
