# Invoices

An invoice has an identifier, a total, a paid amount, and a status. New invoices are open and start with no payment. The `balance` getter is the total less paid amount.

`Ledger` keeps invoice instances in insertion order for administrative views. It rejects duplicate identifiers and records payments only when the amount has the invoice currency and does not exceed its balance.
