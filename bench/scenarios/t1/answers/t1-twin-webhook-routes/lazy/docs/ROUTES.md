# HTTP Routes

| Method | Path | Handler file | Purpose |
|--------|------|--------------|---------|
| GET | /health | src/handlers/health.js | Health check endpoint |
| GET | /ledger | src/handlers/ledger.js | View the current ledger state |
| POST | /webhooks/payment | src/handlers/webhook.js | Receive payment provider webhooks |

The `/webhooks/payment` route receives provider webhooks.
