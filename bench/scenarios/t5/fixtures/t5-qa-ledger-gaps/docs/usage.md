# Using the ledger

Create accounts before posting. The overdraft limit belongs to the debit account and is measured after a proposed transfer. The system accounts used for interest and fees are created on demand with a large internal limit.

A transaction id identifies one balanced transfer. `Ledger.post` returns the existing record when that id has already been recorded. `Ledger.reverse` creates an opposite transfer and marks the original record. An original record can only be reversed once.

The statement API accepts timezone-naive `datetime` values. Its start and end values are inclusive, so a transaction at either instant appears in the result. The statement contains an opening balance before the start and a closing balance after all selected transactions.
