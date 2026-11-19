# Cursor pagination for issue lists

## What changed

Issue collection responses now use cursor pagination. The list handler orders issues, accepts a cursor from the query string, and returns the next cursor in the page metadata. The API document and request tests now show the new response envelope.

## Why

Offset pages become awkward for clients as issue collections grow and records are added between requests. A cursor lets a client continue from the last page without carrying an offset through its own state.

## How it was tested

- `node --test`
- `node scripts/check-format.js`

The new token tests cover initial, invalid, and larger page positions. Existing issue filters and route tests continue to pass.
