# Lantern static site and API

Lantern is a small static site with a single regional API function. The deploy scripts publish the site assets, update the API bundle, and optionally refresh the CDN. Staging and production use separate cloud resources in the same account.

## Requirements

- Node.js 24 or newer
- An environment with access to the configured cloud account when running a real deploy

There are no runtime packages to install. Run the local checks with:

```sh
npm test
```

## Deploying

The CI workflow calls `scripts/deploy.js` with either `staging` or `production`. Configuration lives in `config/`. A release can be rolled back with `scripts/rollback.js`, which restores the API's live alias to the selected version.

The cloud adapter is intentionally small. Production wiring can replace the adapter implementation without changing the deploy planner or its configuration handling.
