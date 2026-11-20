# Changelog

## 2.5.0 - 2025-02-15

- Added HMAC-SHA256 signature verification for POST /webhooks/payment.
- Supports payment-signature header with timestamp and multiple v1 signatures.
- Validates timestamps within WEBHOOK_TOLERANCE_SECONDS (default 300).
- Accepts both WEBHOOK_SECRET_PRIMARY and WEBHOOK_SECRET_SECONDARY for key rotation.
- Returns 401 for missing, malformed, expired, future, or non-matching signatures.
- Returns 400 for malformed JSON or invalid event payloads.
- Maintains idempotency for duplicate event ids.

## 2.4.1 - 2025-02-12

- Clarified the health endpoint response in the operations notes.
- Added a command for exporting the in-memory ledger.

## 2.4.0 - 2025-01-18

- Added the ledger view for the operations dashboard.
- Moved route handlers into separate modules.

## 2.3.0 - 2024-11-07

- Added support for provider event names in callback records.
