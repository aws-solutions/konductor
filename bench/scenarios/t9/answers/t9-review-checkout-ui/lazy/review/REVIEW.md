# Checkout review

The checkout is generally in good shape. I found a few issues worth addressing before release. The existing tests pass.

- `src/ui/order-summary.js` / `renderOrderSummary` uses HTML strings for product data. Escape values and add a test with a tag.
- `src/ui/modal.js` / `openModal` puts errors into HTML. Sanitize messages and test an unsafe error.
- `src/forms/payment-form.js` / `bindPaymentForm` permits repeated clicks. Disable submit and test a double click.
- `src/session.js` / `saveSession` stores session information in localStorage. Avoid storing secrets there and test token persistence.
- `src/cart/totals.js` / `calculateSubtotal` uses floating point prices. Use cents and test rounding.

```json
[
  {"location":"src/ui/order-summary.js renderOrderSummary","severity":"high","fix":"Test escaping product markup."},
  {"location":"src/ui/modal.js openModal","severity":"high","fix":"Test sanitizing error markup."},
  {"location":"src/forms/payment-form.js bindPaymentForm","severity":"high","fix":"Test disabling duplicate submit."},
  {"location":"src/session.js saveSession","severity":"high","fix":"Test that secrets avoid localStorage."},
  {"location":"src/cart/totals.js calculateSubtotal","severity":"medium","fix":"Test integer cents and rounding."}
]
```
