# Code review report: inventory-api `src/`

Reviewed: all 7 files under `src/` (treated as changed, no git history). Weak and speculative findings were dropped; the dropped list is at the end. Source files were not changed.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Important | 6 |
| Suggestions | 3 |

Total: 11 findings. Two Critical findings are security defects on the public routes.

## Critical Issues

1. **SQL injection in search** - `src/repository/itemRepo.js:22`
   The `q` parameter is concatenated into the statement. The input `zzz%' OR '1'='1' --` returns every row.
   Fix: use a placeholder (`name LIKE ?`) and bind `'%' + term + '%'`; add a test with an attack-style term.

2. **Missing authorization on stock changes** - `src/handlers/items.js:25`
   `adjustStock` never calls `isAdmin`, although the README requires `X-Admin-Token` for `POST /items/:id/stock`.
   Fix: return 403 when the token check fails, and cover it with a handler test.

## Important Issues

1. **Unvalidated `delta`** - `src/handlers/items.js:26`
   `Number(req.body.delta)` lets `"abc"` (NaN), `1.5` and large negatives through, so stock can become NaN or negative.
   Fix: require a finite integer and reject results below zero with a 400.

2. **Unvalidated `createItem` input** - `src/handlers/items.js:21`
   Name and quantity are not checked against the README rules (non-empty name up to 100 characters, non-negative integer quantity).
   Fix: validate both fields and return 400 with the field name in the message.

3. **Stack trace sent to the client** - `src/server.js:50`
   The 500 body includes `err.stack`.
   Fix: log it server side, return a generic message.

4. **Lost update in `adjustStock`** - `src/services/inventoryService.js:21-25`
   Read, modify and write are separate awaits, so concurrent requests overwrite each other.
   Fix: do the increment atomically in the repository.

5. **Reorder report skips items exactly at the level** - `src/services/inventoryService.js:31`
   `i.qty < i.reorderLevel` should be `<=`; the README says "at or below". Item 2 (quantity 5, level 5) is missing from the report.
   Fix: change the operator and add a boundary test.

6. **Hard-coded fallback admin token** - `src/config.js:6`
   An unset `ADMIN_TOKEN` silently falls back to a known value.
   Fix: refuse to start without the variable.

## Suggestions

1. **Constant-time token comparison** - `src/handlers/items.js:8`
   Use `crypto.timingSafeEqual` instead of `===`.

2. **Cap the request body** - `src/server.js:36-37`
   Stop reading after a fixed number of bytes and answer 413.

3. **Remove the `getQty` wrapper** - `src/util/format.js:13-15`
   It only returns `item.qty`; inline it at `src/handlers/items.js:16`.

## Dropped findings

- "formatLabel truncation may surprise users" (`src/util/format.js:8`): documented by the comment above it, so not a defect.
- "db.js is not a real database": it is a stand-in by design, as the README says.

## Test status

`node --test` passes with 8 tests, but nothing exercises `src/handlers/items.js` or `src/server.js`, which is where the Critical findings sit.

Verdict: NEEDS FIXES
