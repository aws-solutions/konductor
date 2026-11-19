# Northstar Checkout

Northstar is the small checkout service used by the shop application. It creates orders, reserves stock, charges a payment provider, applies promo codes, and sends order mail. A separate settlement command prepares the previous day's completed payments for the finance import.

The service is deliberately dependency-free. It runs on Node.js 24 and uses CommonJS modules. Run the test suite with:

```sh
npm test
```

Local development uses the in-memory repositories in `src`. Production wiring lives in `src/app.js`; deployment configuration is kept under `config/`.

Tax data under `data/` is generated from the finance team's monthly export. Do not edit that file by hand.
