# Checkout architecture

The request path builds a price, optionally reserves inventory, submits a payment, and returns an order. The application wires in-memory adapters for local operation; production adapters have the same small interfaces.

Payment provider callbacks enter through `src/payments/webhook.js`. The settlement command reads completed payment records and emits a batch for finance. Order mail is intentionally outside the charge transaction so a mail outage does not block a paid order.

Configuration is loaded once when `src/config.js` is required. Generated tax rates are data rather than application logic.
