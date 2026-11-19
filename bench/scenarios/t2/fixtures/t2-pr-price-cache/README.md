# Ledger Catalog API

A small multi-tenant catalog service for regional sales teams. The service reads its fixture data from JSON files so a local checkout can run without a database.

## Run locally

Node.js 24 or newer is required. There are no runtime dependencies.

```sh
npm test
npm start
```

The HTTP API listens on `PORT` (3000 by default). Every catalog request includes an `x-tenant-id` header. Price responses are scoped to that tenant and price list.

## Layout

- `src/repositories` owns file-backed reads and writes.
- `src/services` applies tenant and catalog rules.
- `src/routes.mjs` maps HTTP requests to services.
- `test` contains the contract tests used in CI.

The sample tenants are `northwind` and `southridge`. They are intentionally small enough to inspect by hand.
