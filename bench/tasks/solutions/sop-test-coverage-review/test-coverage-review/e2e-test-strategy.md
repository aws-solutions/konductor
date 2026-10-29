# End-to-end test strategy: inventory-api

Goal: close the gaps in `test-gap-analysis.md` with tests that start the real HTTP server on an ephemeral port and call it with `fetch`. No browser is needed.

## Approach

- Framework: the built-in `node:test` runner, so no new dependency.
- Each test file starts `createServer()` from `src/server.js` on port 0 and resets the in-memory rows.
- Execution: run with `npm test` on every push; the whole suite should finish in under 10 seconds.
- Environment: set `ADMIN_TOKEN` in the test setup rather than relying on the fallback value.

## P0: must exist before release

| ID | Scenario | Gap covered |
|----|----------|-------------|
| P0-1 | POST /items/1/stock without the admin token returns 403 | authorization on stock adjustment |
| P0-2 | POST /items/1/stock with `delta` of "abc", 1.5 and missing returns 400 | invalid delta |
| P0-3 | POST /items/3/stock with a delta that would make stock negative is rejected | stock never below zero |
| P0-4 | GET /search?q=zzz%25' OR '1'='1' -- returns no items | search injection |
| P0-5 | GET /search?q=gad returns only the Gadget | search still works |

## P1: high value

| ID | Scenario | Gap covered |
|----|----------|-------------|
| P1-1 | POST /items without a token returns 403, with a token returns 201 | create authorization |
| P1-2 | POST /items with empty name or negative quantity returns 400 | create validation |
| P1-3 | Stock adjustment of 1 then GET /items/1 shows the new quantity | read after write |
| P1-4 | Invalid JSON body returns 400 | server error path |

## P2: medium value

| ID | Scenario | Gap covered |
|----|----------|-------------|
| P2-1 | GET /reorder-report includes an item at exactly its level | reorder boundary |
| P2-2 | 20 concurrent +1 adjustments end with +20 | lost update |
| P2-3 | GET /items/unknown returns 404 | not found path |

## P3: nice to have

| ID | Scenario | Gap covered |
|----|----------|-------------|
| P3-1 | A forced service error returns 500 without a stack field | information leak |
| P3-2 | Label truncation at 12 characters in the report | format helper |

## Order of work

1. P0 tests first; several will fail until the code is fixed, which is the point.
2. P1 and P2 next.
3. P3 when time allows.
