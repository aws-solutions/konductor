# Change calendar

Calendar owner: release operations. All times below are UTC.

| Date and time | Entry |
|---|---|
| 2025-11-17 15:00 | Ledger 3.0 release window opens |
| 2025-11-18 10:00 | Finance reconciliation review |
| 2025-11-19 13:00 | Ledger release contingency window |
| 2025-11-21 18:00 | Month-end close freeze begins |
| 2025-12-02 08:00 | Month-end close freeze ends |

No production changes may start during the month-end close freeze. Emergency database recovery is the exception. The ledger release should finish before the freeze and must leave a tested rollback path for the finance review.
