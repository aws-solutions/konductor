# Cleanup report

Scope: every file under `src/` (no git history, so all treated as changed). Behaviour and signatures are unchanged. `node --test` passes (8 tests) after the cleanup.

## Removed Items

- 5 comments that only restated the next line:
  - `// Format the label for display` and `// Trim the name` and `// Return the result` in `src/util/format.js`
  - `// Get the item from the repository` and `// Increment the quantity` in `src/services/inventoryService.js`
- 1 pass-through wrapper: `getQty(item)` in `src/util/format.js`, inlined to `item.qty` in `src/handlers/items.js`.

Total removed: 5 comments and 1 wrapper (6 items).

## Preserved Items

- `// Label printer truncates at 12 chars, so cap here.` in `src/util/format.js`: it explains why the cap exists.
- `// TODO(lead): switch to cents once pricing lands` in `src/util/format.js`.
- The `try/catch` around JSON parsing in `src/server.js`, including the `console.error` call and the 400 response.
- All error responses in the handlers and the 12-character cap in `formatLabel`.
- The overlapping id guards in `getItem` (handler and service) and the `Array.isArray` check in `reorderReport`: harmless, and removing them is a judgement call I left to the reviewer.

## Review Findings

These were noticed but not fixed, because the task was to remove slop and not to change behaviour:

- `adjustStock` in `src/handlers/items.js` does not validate `delta`.
- `adjustStock` has no admin-token check although `createItem` does.
- The search repository function builds SQL by concatenation.
