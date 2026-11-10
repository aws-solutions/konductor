# Plan: put a Redis sidecar in front of the tax rate lookup

Decision (made in the 2026-10-28 design review, not up for debate here): tax rates will be served from a Redis sidecar on localhost:6379 instead of the in-process `RATES` map.

## Tasks
1. Add a `getRate(region)` function to `src/billing/tax.js` that reads `rate:<region>` from Redis and falls back to `RATES` when the key is missing.
   - Done when: `npm test` passes.
2. Change `taxFor` in `src/billing/tax.js` to call `getRate`.
3. Seed Redis with the current `RATES` values at deploy time.
4. Add monitoring.
