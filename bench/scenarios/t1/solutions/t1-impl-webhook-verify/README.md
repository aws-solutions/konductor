# Harbor Payments

Harbor Payments receives payment-provider callbacks and keeps a small in-memory ledger for the operations dashboard. It is intentionally dependency-free so the service can run in the maintenance container without a package install.

## Run

Use Node.js 24 or newer:

```sh
npm test
npm start
```

The service listens on `PORT` (8080 by default). `GET /health` reports service availability, `GET /ledger` returns the current ledger, and payment callbacks use `POST /webhooks/payment` with a JSON body.

Payment callbacks use `payment-signature`. The value is `t=<unix seconds>,v1=<hex HMAC>` and the HMAC-SHA256 input is `<timestamp>.<exact request body>`. Configure `WEBHOOK_SECRET_PRIMARY`, optional `WEBHOOK_SECRET_SECONDARY`, and `WEBHOOK_TOLERANCE_SECONDS` (300 by default). A callback response is `{ "ok": true, "duplicate": false }`; a repeated event id is acknowledged with `duplicate: true` without changing the ledger.

Configuration defaults live in `config/default.json`. Environment variables may override the listening port and the ledger label. The process does not persist ledger state across restarts.

See [operations](docs/operations.md) and [architecture](docs/architecture.md) for the small set of operating assumptions.
