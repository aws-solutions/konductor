# Remaining risks after the search fix

The search query is now parameterised (`src/repository/itemRepo.js`) and has an attack-style test. I re-read the rest of `src/` for related input-handling problems and left these unfixed, as requested.

## Open

1. **No admin-token check on stock changes** - `src/handlers/items.js:25-27`. `adjustStock` never calls `isAdmin`, although the README requires the token. Anyone can change stock.
2. **`delta` is not validated** - `src/handlers/items.js:26`. `Number(req.body.delta)` accepts NaN, fractions and values that push stock below zero; a missing body throws.
3. **`createItem` input is not validated** - `src/handlers/items.js:21`. Name and quantity are stored as sent; the README rules (non-empty name up to 100 characters, non-negative integer quantity) are not enforced.
4. **Stack trace in the 500 response** - `src/server.js:50`. The client receives `err.stack`, which discloses paths and internals.
5. **Fallback admin token** - `src/config.js:6`. When `ADMIN_TOKEN` is unset the service accepts a known placeholder value instead of refusing to start.
6. **No request body size limit** - `src/server.js:36-37`. The server buffers any size of body.
7. **Lost update on concurrent stock changes** - `src/services/inventoryService.js:19-25`. Read, modify and write are separate awaits.

## Not input handling, but noticed

- `src/services/inventoryService.js:31` uses `<` where the README says "at or below".
