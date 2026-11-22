# Points Counter

Points Counter is a small loyalty-points service used by the store checkout and
customer portal. It keeps a per-customer balance, accepts earn and redeem
requests, and removes expired points during the nightly maintenance window.

## Development

The service has no runtime dependencies. Use Node.js 24 or newer.

```sh
node --test
node src/server.js
```

The example server exposes the handlers in `src/server.js`; deployment wiring
in the production service supplies the HTTP adapter and a persistent store.

## Behaviour

Balances are represented in points with up to two decimal places. Earn values
are calculated from the order subtotal and the customer's tier. A single
redemption is limited by the policy in `config/points-policy.json`.

Operational conventions, including the reporting timezone and the maintenance
window, are in `docs/operations.md`. The API examples in `docs/api.md` use
customer IDs that are safe for local development.
