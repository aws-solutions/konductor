# Ledgerline API reference excerpt

## Authentication

Clients send a dashboard-issued bearer token in the `Authorization` header. Tokens identify an account and are not valid for a different account.

## Resource identifiers

Payment, refund, and payout responses use opaque string identifiers. An identifier is stable for the life of the resource. Timestamps are RFC 3339 strings with an explicit offset.

## Event vocabulary

The internal event catalog currently contains `payment.authorized`, `payment.failed`, `refund.created`, and `payout.completed`. The catalog is not yet exposed as a public subscription API.

## Errors

The shared problem response contains `code`, `message`, and an optional `request_id`. Error messages must not echo cardholder data or credentials.
