# Harbor Receipts

Harbor Receipts turns payment records into printable receipts and sends them to the account inbox. It runs as a small CommonJS service with no runtime dependencies.

## Local checks

Node 24 or newer is required. Run `npm test`, `npm run check:config`, and `npm run check:csv`. The test suite uses in-memory stores and never calls a remote service.

## Shape of a receipt

The stable receipt object contains an account id, receipt id, amount in cents, currency, and issued-at timestamp. The renderer accepts that object and returns a string. `src/legacy.js` remains available to consumers that have not moved to the current envelope.

Operational settings live under `config/` and `ops/`. The service uses UTC timestamps at its boundaries. See the architecture and runbook documents for ownership and day-to-day operation.
