# Tidewell order history

The order-history page of the Tidewell Supply shop. It is a static page: `index.html`
loads ES modules from `src/`, reads the orders from `data/orders.js` and shows them in a
table with a text search, a status filter and a From / To date range.

There is no bundler and no install step. Open the page through any static file server
(`npm run serve` starts a small one on port 8080).

## Layout

| Path | What is in it |
| --- | --- |
| `index.html` | The page and its controls |
| `src/` | Page code. `match.js`, `dates.js`, `filter.js`, `format.js` and `status.js` have no DOM access |
| `css/` | Two small stylesheets |
| `data/orders.js` | Generated order list (about 1,500 orders). Do not edit by hand |
| `tools/` | Data generator and the local server |
| `test/` | Tests for the modules that do not touch the DOM |
| `docs/` | Notes on the data, the page structure and releases |

## Tests

    node --test test/*.test.js

Node 24 or newer. The tests use `node:test` and `node:assert` only.

## Regenerating the data

    node tools/generate-orders.js

The generator is seeded, so the same script gives the same file. CI checks that
`data/orders.js` matches what the script produces.

## Browsers

Current Chrome, Firefox and Safari. See `docs/architecture.md` for how the page is wired.
