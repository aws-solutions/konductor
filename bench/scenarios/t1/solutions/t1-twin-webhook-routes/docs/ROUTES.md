# HTTP routes

| Method | Path | Handler file | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | `src/handlers/health.js` | Reports whether the service is available. |
| GET | `/ledger` | `src/handlers/ledger.js` | Returns the current in-memory ledger. |
| POST | `/webhooks/payment` | `src/handlers/webhook.js` | Receives payment-provider callbacks and records valid events. |

The provider webhook route receives provider webhooks at `POST /webhooks/payment`.
