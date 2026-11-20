# Harbor & Pine storefront

Harbor & Pine is a small home-goods shop front end. The browser layer is intentionally thin: cart state and its presentation model live in `src/`, so pricing rules can be checked without a DOM.

## Development

This repository targets Node 24 and has no runtime dependencies. Run `npm test` or `node --test test/` from the repository root.

The cart view model accepts item records with `id`, `name`, `quantity`, and a unit price in minor currency units. `config/site.json` contains the defaults used by the sample page.
