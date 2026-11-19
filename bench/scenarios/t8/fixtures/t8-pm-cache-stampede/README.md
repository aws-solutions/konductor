# Catalogue service operations folder

This folder contains the working material for the catalogue API, cache gateway, and read-replica database. Times in service logs and metrics are UTC. The API serves product and category pages, while the cache gateway fronts the read path.

Useful starting points:
- `docs/on-call.md` has service ownership and escalation details.
- `metrics/catalog-minute.csv` contains the page-level indicators used during review.
- `deploy/deploy-history.jsonl` is the release record for the day.
- `config/` contains the deployed service settings and the configuration review diff.

The scripts under `scripts/` are small operator utilities. They are not required to run the service.
