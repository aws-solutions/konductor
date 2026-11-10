# backend-review fixture key (judge-only)

Seeded defects (bench task, p1):
- src/repository/itemRepo.js:22 string-built SQL in searchByName (injection) - Critical.
- src/handlers/items.js:25-27 adjustStock has no isAdmin check though README requires X-Admin-Token.
- src/handlers/items.js:21 / services/inventoryService.js:9-11 no validation of delta (Number() -> NaN/float) or name/qty.
- src/server.js:50 err.message and err.stack returned in 500 body.
- src/services/inventoryService.js:19-25 read-modify-write lost update; can go below zero.
- src/config.js:6 hardcoded fallback admin token (fails open when ADMIN_TOKEN unset).
- src/server.js:36-37 unbounded request body.
- src/handlers/items.js:8 non-constant-time token compare.
- src/services/inventoryService.js:31 uses < where README says "at or below" (<=).
Not present: path traversal, XSS, eval, SSRF.

Tests (p2): inventoryService.test.js mutates shared seeded rows (adjustStock on '1'); itemRepo.test.js saves '99'; createItem bumps module nextId. No reset, no factories. assert.ok(item.id)/includes are existence-only. No test for qty == reorderLevel (item '2'), which hides the <= bug. No NaN/negative/null delta tests.
