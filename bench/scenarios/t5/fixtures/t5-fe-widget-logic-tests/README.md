# Staywise booking widget logic

This package contains the non-visual part of the Staywise booking widget. It runs in Node so the same date, form, pricing, timing, store, and view-model rules can be used by several clients without a DOM.

## Development

The project targets Node.js 24 and has no runtime dependencies. Run `node --test` to execute the suite. The public entry point is `src/index.js`; individual modules are kept small so callers can import only the logic they need.

Dates use ISO calendar strings (`YYYY-MM-DD`). Date ranges are inclusive. Prices are formatted through the platform's `Intl.NumberFormat` implementation.

## Release notes

See `CHANGELOG.md` for the history of the package. Operational conventions live in `docs/`.
