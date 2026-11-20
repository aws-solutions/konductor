# Changelog

## 2.5.0 - 2025-02-15

- Added HMAC-SHA256 signature verification for payment webhooks.
- The endpoint now checks the payment-signature header before processing events.

## 2.4.1 - 2025-02-12

- Clarified the health endpoint response in the operations notes.
- Added a command for exporting the in-memory ledger.

## 2.4.0 - 2025-01-18

- Added the ledger view for the operations dashboard.
- Moved route handlers into separate modules.

## 2.3.0 - 2024-11-07

- Added support for provider event names in callback records.
