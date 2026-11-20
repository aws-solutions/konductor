# Ledgerly on-call folder

The on-call working folder for Ledgerly, our B2B invoicing service. Today's raw logs, the per-minute metrics export,
config, runbooks and the on-call chat are here. Times are UTC.

- `logs/`: invoice-api, render-worker, billing-scheduler, flag-service, Postgres primary and replica
- `metrics/`: `per-minute.csv` and the metric catalogue
- `config/`: scheduler jobs, flag defaults, tenants and their segments
- `deploy/`: deploy history and release notes
- `runbooks/`, `docs/`: incident runbook, ownership, SLOs, architecture
- `chat/`, `notes/`: the on-call channel export and shift notes

Hand-offs go in `handoff/`.
