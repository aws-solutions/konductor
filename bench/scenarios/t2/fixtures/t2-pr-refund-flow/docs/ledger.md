# Ledger rules

The ledger is append-only. Every monetary `amount` is an integer number of
minor units in the currency of the account. A cent is `1` for USD and a yen is
also `1` for JPY. Ledger entries must balance by account and carry a source id.

Refunds debit the merchant clearing account and credit the platform clearing
account. A refund cannot exceed the captured amount for its order. Consumers
may project balances from entries, but must not edit an entry in place.

Amounts received from a user interface are decimal strings and must be parsed
with the currency exponent before they reach this module.
