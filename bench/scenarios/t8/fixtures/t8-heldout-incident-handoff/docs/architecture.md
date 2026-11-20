# Ledgerly architecture

- **invoice-api** creates and serves invoices. `POST /v1/invoices` writes the invoice and its `invoice_lines` in one
  transaction; the client times out after 30 s and gets a 504.
- **render-worker** turns invoices into PDFs. It fetches each invoice from invoice-api (10 s timeout, 3 tries).
- **billing-scheduler** runs batch jobs: dunning emails, FX rates, tax recalculation, the nightly ledger export, and
  `flags-sync`.
- **flag-service** holds feature flags; `flagctl` changes them, and every change is in the flag audit log.
- **Postgres**: one primary and one streaming replica. invoice-api and the jobs write to the primary.
