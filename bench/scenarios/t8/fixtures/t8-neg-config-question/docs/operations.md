# Operations notes

## Rendering an environment

The renderer accepts one environment name and emits a JSON document with the environment and its service records. It is the same merge used by the release job, so use it instead of inspecting a single record when checking an environment.

```sh
node scripts/render-config.js staging > /tmp/staging-config.json
```

The command exits non-zero for an environment that is not present. Keep generated output outside this repository unless it is part of a reviewed change.

## Reviewing a configuration change

Check that replica counts match the expected traffic tier, resource values use the team units, and feature flags are intentional for the target environment. A service record should retain its service and environment fields. The production renderer also reads the optional `overrides.json` file in that environment directory.

## Useful local data

`logs/platform.log` contains representative UTC application lines. `data/request-metrics.csv` is useful for quick time-window queries, while `data/deploy-history.jsonl` records recent deployment outcomes. These files are examples, not a source of current capacity values.
