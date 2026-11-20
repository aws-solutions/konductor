# Corner Market Inventory

This service keeps the sellable quantity for each SKU at each warehouse. It is
intentionally small: the default process uses an in-memory store, while the
store interface leaves room for the nightly file-backed importer.

## Run it

Node.js 24 or newer is required. There are no runtime dependencies.

```sh
npm test
npm start
```

The HTTP adapter listens on port 3400 by default. Set `PORT` to use another
local port. Requests use JSON and must include `x-request-id` when they need
to be correlated with an audit record.

## Boundaries

`src/services` owns business rules. `src/store` owns persistence. Event
listeners in `src/events` send changes to the catalog mirror and audit log.
The service should not expose the mutable objects returned by a store.

A stock quantity is an integer greater than or equal to zero. A warehouse can
serve a SKU only when its `sellable` flag is true in the catalog. The import
process updates stock after the close-of-day count and can replace a quantity
with zero.

See [the API notes](docs/api.md), [operations notes](docs/operations.md), and
[the architecture note](docs/architecture.md) before changing those boundaries.
