# Ledger rules

The journal is the source of truth for account movement. A transfer creates exactly two journal lines: a negative debit for the source and a positive credit for the destination. The two amounts must sum to zero.

Amounts are integer minor units. The service does not store decimal floating-point balances. A client key identifies a transfer and is retained so a retried request returns the original result rather than posting another movement.

A journal append and its account balance update are one transaction. Readers may see either the state before a transaction or the complete state after it, never a half-written transfer.
