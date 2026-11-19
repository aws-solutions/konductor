# Internal API notes

## Checkout

`checkout(input, dependencies)` accepts an order id, customer email, lines, discount, and tax rate. A successful response has `state: "paid"`, a payment result, and pricing fields.

## Payment callbacks

Webhook requests provide the exact raw body, a provider signature, and the shared secret. The callback returns an `accepted` boolean and records the resulting order payment state.

## Settlement

`eligibleTransactions` receives provider records and a reference time. It returns succeeded records at or before the configured daily cutoff.
