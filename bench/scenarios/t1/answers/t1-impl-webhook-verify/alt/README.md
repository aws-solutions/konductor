# Harbor Payments

Harbor Payments receives payment-provider callbacks and keeps a small in-memory ledger for the operations dashboard. It is intentionally dependency-free so the service can run in the maintenance container without a package install.

## Run

Use Node.js 24 or newer:

```sh
npm test
npm start
```

The service listens on `PORT` (8080 by default). `GET /health` reports service availability, `GET /ledger` returns the current ledger, and payment callbacks use `POST /webhooks/payment` with a JSON body.

## Configuration

Configuration defaults live in `config/default.json`. Environment variables may override the listening port, the ledger label, and webhook verification settings:

- `PORT` - Listening port (default: 8080)
- `LEDGER_LABEL` - Label for the ledger (default: harbor-main)
- `WEBHOOK_SECRET_PRIMARY` - Primary secret for signature verification
- `WEBHOOK_SECRET_SECONDARY` - Optional secondary secret for key rotation
- `WEBHOOK_TOLERANCE_SECONDS` - Timestamp tolerance in seconds (default: 300)

The process does not persist ledger state across restarts.

## Webhook Verification

The `POST /webhooks/payment` endpoint requires a `payment-signature` header formatted as:

```
t=<unix seconds>,v1=<hex signature>
```

Multiple `v1` values are allowed. Each signature is an HMAC-SHA256 over the timestamp, a dot, and the exact raw request bytes. Timestamps must be within `WEBHOOK_TOLERANCE_SECONDS` of the current time.

See [operations](docs/operations.md) and [architecture](docs/architecture.md) for the small set of operating assumptions.
