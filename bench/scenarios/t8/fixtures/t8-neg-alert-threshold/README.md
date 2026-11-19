# Northstar monitoring configuration

This repository holds the alert rules used by the Northstar service group. Each file in `rules/` describes one service and follows the JSON schema checked by `src/validate-rules.js`.

## Local commands

Node.js 24 is the supported runtime. The repository has no external packages.

```sh
node --test test/
node src/validate-rules.js
```

Rules are reviewed with the owning team before they are published.

The `logs/` and `data/` files are small samples kept for local troubleshooting and dashboard fixture work. They are not production telemetry.
