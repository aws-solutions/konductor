# Example Document Service

Example Document Service is a small CommonJS service used by internal teams to store document metadata and object content for several customer workspaces. It runs on Node.js 24 and deliberately keeps its runtime dependency-free.

## Local commands

```sh
node --test
node scripts/stamp-tenants.js --check
```

The service uses a single object store bucket and a metadata table. Tenant role policy files under `infra/tenants` are generated from the catalog for local review. Account identifiers in this repository are examples only.

See `docs/operations.md` for the daily operator notes and `docs/access-model.md` for the current access description.
