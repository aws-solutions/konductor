# Ledger release folder

This folder is the working set for releases of the ledger service. The production fleet has twelve ledger-api hosts behind the `ledger-public` load balancer and a primary database with two read replicas.

The current release material is under `docs/`, `migrations/`, `metrics/`, `logs/`, and `config/`. Historical exports are retained for comparison. Times in operational records use UTC.

The small scripts are operator aids, not application build tooling. Read the release notes, calendar, capacity note, and rota together before scheduling production work.
