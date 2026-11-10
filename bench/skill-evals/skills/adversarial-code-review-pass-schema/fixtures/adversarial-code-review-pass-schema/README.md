# orders-api

Public REST API for orders (v1, shipped). Mobile clients (iOS 4.x, Android 6.x)
switch on `status` and on error `code` values. Orders also arrive through an SQS
consumer (`src/consumers/orderQueue.js`) used by the partner integration.

Shared helpers:
- `validate(schema)` in `src/lib/validate.js` is the request-validation middleware.
- `authorize` in `src/lib/auth.js` guards every route.

The change under review is `change.diff`.
