# Northstar Catalog API

Northstar serves product records to the web shop, mobile clients, and the search indexing worker. It is a small Node.js service with no runtime dependencies.

## Local commands

```sh
node --test
node src/http/server.js
```

The server listens on `PORT` (8080 by default). The sample data is small so the service can be run from a checkout without a database.

## Endpoints

- `GET /health` returns the process status.
- `GET /v2/products/:id` returns a product payload.
- `POST /v2/products` accepts a JSON product draft.

Product changes are published as JSON lines for the indexing worker. The payload shapes are documented in `docs/api/catalog.yaml` and the event consumer notes.
