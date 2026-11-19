# Small Shop Checkout

This repository contains the HTTP-free services behind a small online shop. The
service layer keeps carts in memory and calculates prices in integer minor units,
so callers do not need a web server to use it.

## Development

Node.js 24 is the supported runtime. There are no third-party dependencies.

```sh
node --test
npm run catalog:check
```

The public API is assembled in `src/index.js`. See `docs/` for the price and
cart rules.
