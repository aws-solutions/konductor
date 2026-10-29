# inventory-api

A small in-memory inventory service. Local demo only: data lives in memory and the server binds to loopback by default.

## Routes

| Method | Path | Notes |
|--------|------|-------|
| GET | /items/:id | Returns one item. |
| POST | /items | Creates an item. Requires the `X-Admin-Token` header. |
| POST | /items/:id/stock | Adjusts stock by `delta`. Requires the `X-Admin-Token` header. |
| GET | /search?q=term | Finds items whose name contains the term. |
| GET | /reorder-report | Lists items that need reordering. |

## Rules

- An item is on the reorder report when its quantity is at or below its reorder level.
- Stock never goes below zero.
- `delta` must be a finite integer.
- `name` must be a non-empty string of at most 100 characters.
- `qty` must be a non-negative integer.
- Invalid input should produce a 400 response with a clear message.

## Layout

- `src/server.js`: HTTP routing.
- `src/handlers/`: request handlers returning `{ status, body }`.
- `src/services/`: business logic.
- `src/repository/`: data access.
- `src/db.js`: in-memory stand-in for a SQL driver.

## Development

`npm test` runs the tests with the built-in Node test runner.
