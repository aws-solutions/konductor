# Architecture

`index.html` holds all the markup. `src/main.js` is the only module that touches the DOM
besides `src/render.js` (table rows) and `src/dom.js` (two small helpers).

## Data flow

1. `data/orders.js` exports the full order list once, at load.
2. `main.js` keeps a small `state` object: `query`, `status`, `from`, `to`.
3. Every control calls `refresh()`, which runs `filterOrders(orders, state)` and replaces
   the table body.
4. `filterOrders` (in `src/filter.js`) is a pure function. It uses `matchesQuery` from
   `src/match.js` for the text and `parseDate` from `src/dates.js` for the dates.

## Rules that live in one place

- Text matching (case, accents, several words): `src/match.js`.
- What counts as a date (formats, real calendar days): `src/dates.js`.
- Status names and labels: `src/status.js`.

New code should call these instead of re-implementing them, so the page and the tests
agree on what a match is.

## Modules and `package.json`

`src/`, `data/`, `test/` and `tools/` each carry a `package.json` with `"type": "module"`
so Node treats the files as ES modules. The browser ignores these files.
