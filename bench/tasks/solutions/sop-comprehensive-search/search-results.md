# Search results: where stock quantity is read or changed

Searched `src/` and `test/` for `qty`, `quantity`, `stock`, `delta` and `reorderLevel` (case-insensitive). 22 matching lines in 10 files. Code only, no web sources.

## src/handlers/items.js

- `src/handlers/items.js:16`: `return { status: 200, body: { id: item.id, name: item.name, qty: getQty(item) } };` reads the quantity for GET /items/:id.
- `src/handlers/items.js:26`: `const delta = Number(req.body.delta);` takes the stock change from the request body.
- `src/handlers/items.js:27`: `const item = await service.adjustStock(req.params.id, delta);` passes the change to the service.

## src/services/inventoryService.js

- `src/services/inventoryService.js:9`: `async function createItem({ name, qty }) {` sets the initial quantity.
- `src/services/inventoryService.js:11`: `return repo.save({ id, name, qty, reorderLevel: config.reorderLevel });` stores it.
- `src/services/inventoryService.js:19`: `async function adjustStock(id, delta) {` entry point for changes.
- `src/services/inventoryService.js:24`: `item.qty += delta;` the only place stock is changed.
- `src/services/inventoryService.js:31`: `const low = items.filter((i) => i.qty < i.reorderLevel);` compares quantity with the level for the report.
- `src/services/inventoryService.js:34`: `items: low.map((i) => ({ id: i.id, label: formatLabel(i.name), qty: i.qty })),` exposes it in the report.

## src/repository/itemRepo.js

- `src/repository/itemRepo.js:22`: `const sql = "SELECT id, name, qty FROM items WHERE name LIKE '%" + term + "%'";` selects the quantity in search.

## src/util/format.js

- `src/util/format.js:14`: `return item.qty;` the `getQty` helper.

## src/db.js

- `src/db.js:4`: `{ id: '1', name: 'Widget', qty: 10, reorderLevel: 5 },` seed row.
- `src/db.js:5`: `{ id: '2', name: 'Gadget', qty: 5, reorderLevel: 5 },` seed row.
- `src/db.js:6`: `{ id: '3', name: 'Gizmo', qty: 2, reorderLevel: 5 },` seed row.

## src/config.js

- `src/config.js:7`: `reorderLevel: 5,` default level for new items.

## src/server.js

- `src/server.js:22`: `if (req.method === 'POST' && parts[0] === 'items' && parts[2] === 'stock') {` routes the stock change.

## test/inventoryService.test.js

- `test/inventoryService.test.js:8`: `const item = await service.createItem({ name: 'Sprocket', qty: 7 });` creates with a quantity.
- `test/inventoryService.test.js:18`: `test('adjustStock adds the delta to the quantity', async () => {` the only adjustStock test.
- `test/inventoryService.test.js:21`: `assert.strictEqual(after.qty, before.qty + 3);` asserts the new quantity.
- `test/inventoryService.test.js:24`: `test('reorderReport lists clearly low items and skips well-stocked ones', async () => {` covers the report.

## test/itemRepo.test.js

- `test/itemRepo.test.js:17`: `await repo.save({ id: '99', name: 'Doohickey', qty: 1, reorderLevel: 5 });` saves a row with a quantity.

## Most important findings

1. The only write to a quantity after creation is `src/services/inventoryService.js:24`, a read-modify-write with no atomicity.
2. `src/handlers/items.js:26` converts the delta without validation, so NaN, fractions and negative stock can reach line 24.
3. `src/services/inventoryService.js:31` uses `<` where the README says "at or below".
4. No test touches the handlers, so lines 16, 26 and 27 of `src/handlers/items.js` are untested.
