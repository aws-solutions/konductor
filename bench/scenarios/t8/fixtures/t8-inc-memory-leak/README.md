# Atlas search API operations folder

This folder contains a sampled four-day production record for the Atlas search API. The service ran eight containers behind the edge gateway. Times in operational data are UTC.

- `ops/logs/` contains gateway, API, indexer, and node-agent records.
- `ops/metrics/` contains five-minute container samples.
- `ops/deploy-history.csv`, `ops/traffic-report.csv`, and `ops/config/release-diff.yaml` describe changes and load.
- `docs/` has the normal operating notes used by the on-call rotation.

The records are a working set rather than a complete archive. Line numbers in the logs and configuration files are stable for incident references.
