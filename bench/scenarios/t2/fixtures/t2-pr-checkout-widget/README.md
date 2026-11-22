# Harbor Cart

Harbor Cart is a small storefront for the neighborhood goods catalog. It is a browser-only app with no build step and no runtime dependencies.

## Development

Use Node.js 24 or newer, then run:

```sh
node --test
```

To view the pages, serve this directory with any static file server and open `public/index.html`. The checkout page reads catalog data from `data/catalog.json` in the deployed bundle.

## Structure

- `src/` contains browser modules and small pure helpers.
- `tests/` contains the Node test suite for helpers and service boundaries.
- `docs/` records product and accessibility contracts.
- `config/` contains release settings that are safe to ship to the browser.
