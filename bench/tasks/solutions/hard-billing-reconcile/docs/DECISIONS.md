# Decisions: conflicting billing rules

Rule: when the two documents disagree on a rule, the entry with the later `updated` date wins. An entry
marked `[regulatory]` wins over one that is not. If both are regulatory, or the dates are equal, the
requirements document wins. Both documents now state the winning value.

| id | requirements | integration guide | winner | why |
|----|--------------|-------------------|--------|-----|
| R1 | 14 days (2025-02-01) | 7 days (2025-05-20) | integration guide: 7 days | later date |
| R2 | 30 days (2025-06-01) | 14 days (2025-03-10) | requirements: 30 days | later date |
| R3 | half up (regulatory) | half to even (2025-07-01) | requirements: half up | regulatory beats later date |
| R5 | 10 (2025-01-15) | 25 (2025-01-15) | requirements: 10 | equal dates, requirements win |
| R6 | includes tax (regulatory) | excludes tax (regulatory) | requirements: tax included | both regulatory, requirements win |
| R7 | 15% (2025-03-01) | 20% (2025-09-01) | integration guide: 20% | later date |
| R9 | end of period, no credit (2025-04-10) | immediately, prorated credit (2025-02-02, regulatory) | integration guide: immediate | regulatory beats later date |
| R10 | 500 cents (2025-06-15) | $4.50 = 450 cents (2025-07-01) | integration guide: 450 cents | later date |

R4 (5 days, written as 120 hours in the integration guide) and R8 (integer cents) say the same in both documents.
