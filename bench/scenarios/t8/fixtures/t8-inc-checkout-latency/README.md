# Northstar Shop operations folder

This folder contains one UTC day of checkout operations data for the Northstar Shop. The checkout API calls the payments adapter and inventory service, and its database traffic passes through the shared Postgres pooler.

Start with `docs/architecture.md` for component names and `docs/metrics-catalog.md` for the CSV columns. The raw service and pooler logs are under `logs/`; minute-level service measurements are in `metrics/checkout-minute.csv`. Deployment records, configuration changes, alerts, the on-call transcript, and small utility scripts are kept in their respective folders.

The data includes normal traffic, background warnings, deploy activity, and a short period of degraded checkout behavior. All timestamps are UTC.
