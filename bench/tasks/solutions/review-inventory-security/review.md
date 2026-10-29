# Security review: inventory-api

Scope: every file under `src/` (config, db, server, handlers, services, repository, util).
Method: read each file, then called the search repository function and the stock handler directly with hostile input to confirm the findings below. Nine findings, ordered by severity. Nothing here is speculative; each one has a line you can open.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Important | 5 |
| Minor | 2 |

## Critical

### 1. SQL injection in item search (`src/repository/itemRepo.js:22`)

`searchByName` builds the statement by concatenating the raw `q` query parameter:

```js
const sql = "SELECT id, name, qty FROM items WHERE name LIKE '%" + term + "%'";
```

Why it matters: any caller of `GET /search` controls the SQL text. I ran `searchByName("zzz%' OR '1'='1' --")` and it returned all three items (Widget, Gadget, Gizmo) instead of none. With a real driver the same input reads or changes other tables.

Fix: keep the term out of the statement and bind it, for example `"... WHERE name LIKE ?"` with the parameter `'%' + term + '%'`. Add a test that passes a quote and `OR` and expects no extra rows.

### 2. Stock changes need no credentials (`src/handlers/items.js:25-27`)

`createItem` checks `isAdmin(req)` (line 20) but `adjustStock` goes straight to the service. The README says `POST /items/:id/stock` requires the `X-Admin-Token` header.

Why it matters: anyone who can reach the port can set any item's quantity to any number, which also feeds the reorder report.

Fix: add `if (!isAdmin(req)) return { status: 403, body: { error: 'forbidden' } };` as the first line of `adjustStock`, and test both the 403 and the allowed path.

## Important

### 3. `delta` is never validated (`src/handlers/items.js:26`)

`Number(req.body.delta)` accepts anything. Observed results:

- `"abc"` becomes `NaN`, and the item's quantity becomes `NaN` (serialised as `null`).
- `1.5` is stored, giving a quantity of 6.5.
- `-100` on item 3 leaves a quantity of -98.
- A request without a body object makes the handler throw a `TypeError`.

Why it matters: it corrupts stock data and the README rules (finite integer, never below zero) are not enforced. Fix: reject non-integers and results below zero with a 400 before calling the service.

### 4. `createItem` stores unchecked input (`src/handlers/items.js:21`)

`name` and `qty` go to the service as sent. An empty name with a quantity of -4 was created with status 201. The README requires a non-empty name of at most 100 characters and a non-negative integer quantity. Fix: validate both fields and return 400 with a message that names the field.

### 5. The 500 response leaks the stack trace (`src/server.js:50`)

`send(res, 500, { error: err.message, stack: err.stack })` returns file paths and line numbers to the client. Fix: log the stack with `console.error` and return only a generic message.

### 6. Lost update on concurrent stock changes (`src/services/inventoryService.js:19-25`)

`adjustStock` reads the item (line 21), awaits, changes `item.qty` (line 24) and writes it back. Two requests that interleave both start from the same quantity and one adjustment is lost. Fix: make the read-modify-write atomic in the repository (a single `UPDATE ... SET qty = qty + ?` or a transaction with a row lock).

### 7. Hard-coded fallback admin token (`src/config.js:6`)

`process.env.ADMIN_TOKEN || 'FAKE-ADMIN-TOKEN-0000-placeholder'` means a deployment that forgets the variable runs with a known token. The value here is a placeholder, but the pattern is the risk. Fix: fail at startup when `ADMIN_TOKEN` is unset.

## Minor

### 8. Token compared with `===` (`src/handlers/items.js:8`)

A plain comparison is not constant time, which allows a timing attack in theory. Fix: compare with `crypto.timingSafeEqual` on equal-length buffers.

### 9. Request body has no size limit (`src/server.js:36-37`)

The server collects chunks without a cap, so a single large POST can exhaust memory. Fix: stop reading and answer 413 once the body passes a limit such as 100 KB.

## Not reported

I did not find path traversal, template rendering, shell execution or `eval` in `src/`, so none is listed.
