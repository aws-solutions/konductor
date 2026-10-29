# Context report: changing stock adjustments (`POST /items/:id/stock`)

Nothing was changed. This is what I found by reading `src/`, `test/` and the README.

## Current State: how the flow works today

1. `src/server.js:22-25` matches `POST /items/<id>/stock`, copies the id into `request.params` and calls `items.adjustStock(request)`. The JSON body is parsed earlier (`src/server.js:41`); an empty body becomes `{}`.
2. `src/handlers/items.js:25-30` (`adjustStock`) converts the body field with `Number(req.body.delta)` and calls the service. It returns 404 when the service returns null, otherwise 200 with the saved item. It does not call `isAdmin`.
3. `src/services/inventoryService.js:19-26` (`adjustStock`) reads the item with `repo.get(id)`, adds the delta to `item.qty`, and writes it back with `repo.save(item)`.
4. `src/repository/itemRepo.js:5-8` returns a copy of the row from `db.rows`; `save` (lines 14-19) replaces the row. The data lives in the in-memory array in `src/db.js`.

## Patterns and Conventions

- Layers: server routes to handlers, handlers return `{ status, body }`, services hold the logic, the repository owns data access.
- Everything is async and uses `'use strict'` CommonJS modules.
- Handlers never throw for expected conditions; they return a status. Unexpected errors are caught in `src/server.js:49-51`.
- Tests use `node:test` and `node:assert`, one file per layer.

## Dependencies and Integration Points

- `adjustStock` depends on `itemRepo.get` and `itemRepo.save` only.
- The reorder report (`inventoryService.reorderReport`) reads the same quantity, so a bad stock value shows up there.
- `src/util/format.js` `formatLabel` is used by the report; `getQty` is used by `getItem`.
- Nothing outside this repo calls the route in the code I can see.

## Constraints to Respect

- README rules: `delta` must be a finite integer, stock never goes below zero, invalid input gets a 400 with a clear message, and stock changes require `X-Admin-Token`.
- Today `adjustStock` has no token check and no validation, so the code and the README disagree. Fixing it changes behaviour for existing callers.
- The repository copies rows, so any atomic change needs a new repository function; the service cannot do it safely with get and save.
- Keep the handler return shape `{ status, body }`.

## Existing Tests

- `test/inventoryService.test.js:18-22`: one happy-path test, `adjustStock` adds 3 to item 1.
- `test/itemRepo.test.js`: covers get, save and search only.
- There are no tests for `src/handlers/items.js` or `src/server.js`, so the missing token check, bad `delta` values and the 404 path are all untested. There is no concurrency test.

## Risks Found

- Missing admin-token check (README mismatch).
- No validation: `"abc"` makes the quantity NaN, `1.5` is accepted, and a large negative delta makes stock negative.
- Lost update: the read at `src/services/inventoryService.js:21` and the write at line 25 are separate awaits, so two concurrent adjustments can overwrite each other.

## Recommended Approach

1. Write handler tests first for 403 without a token, 400 for non-integer and missing `delta`, 400 when the result would be negative, and 404 for an unknown id. They should fail today.
2. Add the `isAdmin` check and the validation in the handler.
3. Add the "never below zero" rule in the service, and replace get-then-save with one atomic repository operation (a single update or a transaction).
4. Update the README only if the 400 messages need documenting.

## Escalation

Yes, I recommend a short review by a senior architect before starting. The change touches authorization behaviour, adds a new repository operation and addresses a concurrency problem, and each of those can affect other callers. The edits themselves are small.
