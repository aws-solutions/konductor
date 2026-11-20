# Architecture

`index.html` holds all the markup. `src/main.js` is the only module that touches the DOM
besides `src/render.js` (table rows) and `src/dom.js` (two small helpers).

## Data flow

1. `data/orders.js` exports the full order list once, at load.
2. `src/search.js` holds the text search. `createSearch` waits `delayMs` (200) after the
   last keystroke before it filters, and Enter filters at once. It takes the timer as a
   parameter so tests can drive it by hand.
3. `main.js` keeps a small `state` object: `status`, `from`, `to`. Every control calls
   `refresh()`, which runs `filterOrders` on the search results and draws the first page.
4. `src/pager.js` counts the rows on screen (50 at first, 50 more per "Show more").
5. `src/range.js` checks the From / To text and returns one message per field.
6. `filterOrders` (in `src/filter.js`) is a pure function. It uses `matchesQuery` from
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
