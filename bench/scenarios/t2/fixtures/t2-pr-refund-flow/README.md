# Market payments

A small Node.js service for orders, card captures, merchant payouts, and the
internal ledger. It deliberately uses only Node's standard library so the
sample service can run in a clean worker image.

## Development

Run the test suite with `node --test`. Start the local HTTP server with
`node src/index.js`; it listens on `PORT` (8080 by default).

The API accepts JSON and identifies a merchant with the `x-merchant-id`
header. Amounts crossing the ledger boundary are integer minor units.

Operational notes live in `docs/operations.md`. The service keeps its in-memory
store for examples and tests; production workers connect the same interfaces
to the durable store adapter.
