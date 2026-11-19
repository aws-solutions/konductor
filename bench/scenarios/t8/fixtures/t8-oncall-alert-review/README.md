# Mossvale monitoring workspace

This folder contains the production alert definitions and the evidence used during the February 2025 on-call rotation for Mossvale, a web product for collaborative project work.

- `alerts/alert-rules.yml` is the deployed alert configuration.
- `catalogue/metrics.csv` is the current metric catalogue.
- `history/alert-firings.csv` contains alert starts and ends for the review window.
- `incidents/incidents.csv` is the incident register for the same month.
- `logs/` contains sampled service logs in UTC.
- `docs/` and `runbooks/` contain the notes available to the on-call engineer.

The CSV files use a header row. Times in operational records are UTC ISO 8601 strings. Alert names are case-sensitive in the rules file.
