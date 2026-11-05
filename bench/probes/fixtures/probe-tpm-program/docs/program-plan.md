# Program plan: ledger migration

Sponsor: Priya Raman. Program manager: Sam Ortiz. Version 3, 2025-05-02.

## Goal

Move the general ledger from the legacy system to the new platform with no gap in month-end close.

## Milestones

| ID | Milestone | Date | Owner | Depends on |
|----|-----------|------|-------|------------|
| M1 | Data migration complete | 2025-06-20 | Mara Chen | none |
| M2 | API cutover complete | 2025-06-27 | Jon Park | M1, vendor API v2 |
| M3 | Security sign-off | 15 July 2025 | Lee Novak | M2 |
| M4 | Go-live | 2025-07-01 | Sam Ortiz | M2, M3 |
| M5 | Legacy system retired | 2025-09-30 | Sam Ortiz | M4 |

## Dependencies

- Vendor API v2 must be delivered before M2 can finish. It is promised "in the second quarter".
- Training for the finance team must finish before go-live.

## Budget

| Line | Amount |
|------|--------|
| Engineering | 220,000 |
| Vendor licences | 90,000 |
| Testing | 55,000 |
| Training | 45,000 |
| Total approved | 380,000 |

## Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R1 | Vendor API v2 arrives late | likely | high | none yet |
| R2 | Mapping errors in migrated balances | possible | high | two reconciliation runs before M1 |
| R3 | Finance staff not trained in time | possible | medium | weekly sessions from 2025-06-02 |

## Status colours

Workstreams are reported as G, A or R.
