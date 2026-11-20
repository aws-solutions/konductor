# HTTP Routes

This document describes the HTTP surface of the payment service.

| Method | Path | Handler file | Purpose |
|--------|------|--------------|---------|
| GET | /health | src/handlers/health.js | Returns service health status |
| GET | /ledger | src/handlers/ledger.js | Returns the current ledger snapshot |
| POST | /webhooks/payment | src/handlers/webhook.js | Processes payment events from providers |

The `POST /webhooks/payment` route is the endpoint that receives webhooks from payment providers.
