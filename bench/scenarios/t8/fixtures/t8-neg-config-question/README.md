# Northline deployment configuration

This repository stores the deployment settings for the Northline service group. Each environment has one JSON record per service under `config/<environment>/`. Records contain replica counts, resource limits, log levels, and feature flags.

Use the renderer when inspecting a complete environment. It reads the service records and applies any environment-level adjustments before returning the result.

```sh
node scripts/render-config.js production
```

The repository has no runtime dependencies. Node.js 24 or newer is expected.

## Checks

Run the local suite with:

```sh
node --test test/
```

Operational examples and release notes live in `docs/` and `runbooks/`. The files under `data/` and `logs/` are representative records retained for local troubleshooting exercises.
