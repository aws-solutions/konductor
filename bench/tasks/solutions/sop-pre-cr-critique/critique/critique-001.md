# Pre-submission critique 001

Scope: `src/handlers`, `src/services`, `src/repository` (read only, no git history). Dimensions checked: correctness, performance, security, maintainability, architecture, testing.

## Executive Summary

The layering is clean (handlers call the service, the service calls the repository) and the files are small. The code is not ready for review. Two security defects sit on public routes: string-built SQL in search and a missing token check on stock changes. Input validation is absent, a read-then-write race can lose stock updates, and the reorder report uses the wrong comparison. The two test files cover the service and repository happy paths only.

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Important | 5 |
| Minor | 3 |

## Critical Issues

### C1. String-built SQL in search

- Severity: Critical. Dimension: security.
- File: `src/repository/itemRepo.js:22`
- Snippet:

```js
const sql = "SELECT id, name, qty FROM items WHERE name LIKE '%" + term + "%'";
```

- Problem: the search term becomes part of the SQL text. `zzz%' OR '1'='1' --` returns every item.
- Suggested fix: bind the term as a parameter (`name LIKE ?` with `'%' + term + '%'`).
- Decision: fix. This is exploitable from the public search route.

### C2. `adjustStock` has no authorization check

- Severity: Critical. Dimension: security.
- File: `src/handlers/items.js:25`
- Snippet:

```js
async function adjustStock(req) {
  const delta = Number(req.body.delta);
```

- Problem: `createItem` calls `isAdmin`, `adjustStock` does not, though the README requires the token for stock changes.
- Suggested fix: return 403 unless `isAdmin(req)` is true, before reading the body.
- Decision: fix. Anyone can edit stock today.

## Important Issues

### I1. `delta` is not validated

- Severity: Important. Dimension: correctness.
- File: `src/handlers/items.js:26`
- Snippet: `const delta = Number(req.body.delta);`
- Problem: `"abc"` gives NaN, `1.5` is stored, and a large negative value makes stock negative. A missing body object throws a TypeError.
- Suggested fix: require a finite integer, reject a result below zero, answer 400.
- Decision: fix.

### I2. `createItem` stores unchecked input

- Severity: Important. Dimension: correctness.
- File: `src/handlers/items.js:21`
- Snippet: `const item = await service.createItem(req.body);`
- Problem: name and quantity are not checked against the README rules.
- Suggested fix: validate before calling the service and return 400 naming the field.
- Decision: fix.

### I3. Lost update in `adjustStock`

- Severity: Important. Dimension: architecture.
- File: `src/services/inventoryService.js:21-25`
- Snippet:

```js
const item = await repo.get(id);
item.qty += delta;
return repo.save(item);
```

- Problem: two concurrent adjustments read the same quantity and one result is overwritten.
- Suggested fix: add an atomic increment to the repository (single update statement or transaction).
- Decision: defer. Needs a repository API change; track it as its own task.

### I4. Reorder report excludes items at the level

- Severity: Important. Dimension: correctness.
- File: `src/services/inventoryService.js:31`
- Snippet: `const low = items.filter((i) => i.qty < i.reorderLevel);`
- Problem: the README says "at or below"; item 2 (5 of 5) is missing.
- Suggested fix: use `<=` and add a test for the boundary.
- Decision: fix.

### I5. No tests for the handlers

- Severity: Important. Dimension: testing.
- File: `src/handlers/items.js:1`
- Snippet: `module.exports = { getItem, createItem, adjustStock, search, reorderReport };`
- Problem: none of the five handlers is exercised, which is where both Critical issues are.
- Suggested fix: add handler tests for auth, validation and the 404 path.
- Decision: fix.

## Minor Issues

### M1. Token compared with `===`

- Severity: Minor. Dimension: security.
- File: `src/handlers/items.js:8`
- Snippet: `req.headers['x-admin-token'] === config.adminToken`
- Problem: not a constant-time comparison.
- Suggested fix: `crypto.timingSafeEqual` on equal-length buffers.
- Decision: defer. Low risk on a loopback-only demo.

### M2. Duplicate id guards

- Severity: Minor. Dimension: maintainability.
- File: `src/services/inventoryService.js:15`
- Snippet: `if (id === undefined || id === null) return null;`
- Problem: the handler already rejects a missing id (`src/handlers/items.js:13`), and `repo.get` handles unknown ids.
- Suggested fix: drop one of the two guards.
- Decision: won't fix. Harmless, and the service may gain other callers.

### M3. Defensive `Array.isArray` in `reorderReport`

- Severity: Minor. Dimension: performance.
- File: `src/services/inventoryService.js:30`
- Snippet: `if (!Array.isArray(items)) return { count: 0, items: [] };`
- Problem: `repo.list` always returns an array, so the branch is dead code.
- Suggested fix: remove it.
- Decision: fix. Trivial.
