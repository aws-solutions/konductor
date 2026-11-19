# Operations notes

Invoices are created before a payment attempt. A failed attempt is retained with its provider code and may be retried according to the schedule returned by `src/dunning.js`.

The process that consumes webhooks should persist the event id before applying an event. Reconciliation output is safe to rerun because ledger entries carry a stable reference.
