# Key: risk-management
program-notes.md: perf test env is already blocking (Issue, not Risk); contractors and legacy batch API are Assumptions; SAML vendor and egress proxy are Dependencies/Risks; unchecked index-rebuild window is an unassessed Risk.

## v2: raid-log-draft.md (p3) planted defects, by skill quality gate
CRITICAL
- R-02: probability and score blank (risk without score).
- R-01: H x H scored "Medium" (should be Critical); mitigation "Monitor vendor updates" is not Avoid/Mitigate/Transfer/Accept and has no trigger; Critical needs escalation criteria.
- I-01: issue with owner TBD and no due date.
- D-01: dependency with no contingency if unmet (tracking is not a contingency).
IMPORTANT
- A-01: assumption with no validation plan (contractor paperwork unsigned per program-notes.md).
- No review cadence anywhere in the log.
- No escalation criteria for the Critical risk (R-01 once rescored).
Mis-scoring / mis-typing
- R-03 has already happened (load test blocked today) -> it is an Issue, not a Risk.
- R-04: M x M scored "High" (should be Medium).
- D-01: M x H = High is correct; do not "fix" it.
Restraint traps (sound entries, should not be flagged as defects)
- A-02 has a dated validation plan with a fallback.
- D-02 is scored correctly (L x M = Low) and has a contingency.
