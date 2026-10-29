# Test gap analysis: inventory-api

## Inventory

- Source files: 7 under `src/` (config, db, server, handlers/items, services/inventoryService, repository/itemRepo, util/format).
- Test files: 2 (`test/inventoryService.test.js`, `test/itemRepo.test.js`), 8 tests, all passing.
- File ratio: 2 test files for 7 source files, about 0.29.

## What is covered

- Service: create and get, `adjustStock` happy path, `reorderReport` with clearly low and clearly high items.
- Repository: get, save, and `searchByName` with a harmless term.

## Coverage by module

| Module | Tested | Notes |
|--------|--------|-------|
| `src/services/inventoryService.js` | partly | no error paths, no boundary, no concurrency |
| `src/repository/itemRepo.js` | partly | no hostile input |
| `src/handlers/items.js` | no | no tests at all |
| `src/server.js` | no | routing, 404, 400 and 500 paths untested |
| `src/util/format.js` | indirect | only through the report |
| `src/config.js`, `src/db.js` | no | fixed data |

## Critical gaps (journeys untested)

1. Handlers: `src/handlers/items.js` has no tests, so the admin-token rule on `createItem` and its absence on `adjustStock` go unnoticed.
2. Search injection: `searchByName` is only tested with `gad`; a term such as `zzz%' OR '1'='1' --` returns every row and no test would fail.
3. Stock adjustment with invalid `delta`: NaN, fractions and values that make stock negative are accepted and untested.
4. Authorization: nothing proves that create and adjust reject a request without `X-Admin-Token`.

## Important gaps (error paths untested)

1. HTTP 404 for an unknown item at the server level.
2. HTTP 400 for invalid JSON in `src/server.js`.
3. HTTP 500 body: the stack trace leak has no test.
4. `createItem` with an empty name or negative quantity.
5. `getItem` without an id in the handler.

## Suggestions (edge cases)

1. Reorder boundary: a quantity equal to the level is missing from the report (`<` instead of `<=`); no test uses an item at exactly the level.
2. Concurrent `adjustStock` calls losing an update.
3. `formatLabel` with names over 12 characters and with surrounding spaces.
4. Search with an empty term and with `%` characters.

## Counts

| Severity | Gaps |
|----------|------|
| Critical | 4 |
| Important | 5 |
| Suggestion | 4 |
