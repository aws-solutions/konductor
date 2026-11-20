# Checkout handoff notes, 2.4

## What I checked

This review covers the static page, all checkout flows, DOM assembly, storage, async order progress, and the recent change history. The existing suite is green. Each item below includes a regression test that should be added before release.

## Release blockers and follow-up

1. **`src/ui/order-summary.js`: `renderOrderSummary` (high).** The row template trusts catalog fields. A product name can become markup. Build rows with text nodes or encode values, then test a name containing `<` and `>`.
2. **`src/ui/modal.js`: `openModal` (high).** Error title and message are interpolated into HTML. Test a gateway error containing tags and require safe text insertion or sanitization.
3. **`src/order/order-status.js`: `watchOrder` (high).** Promise completion order is unconstrained, so an old poll can paint over a fresh status. Test out-of-order completions and use a latest-request sequence or abort.
4. **`src/forms/payment-form.js`: `bindPaymentForm` (high).** Nothing marks a request in flight. Test two synchronous submits and require the button to disable or a duplicate guard to allow only one gateway call.
5. **`src/forms/address-form.js`: `renderAddressFields` (low).** Delivery notes has no label relationship. Test its accessible name and add a label or aria-label tied to the input.
6. **`src/ui/cart-panel.js`: `renderCartPanel` (medium).** Replacing the panel discards keyboard focus. Test an update while a control is focused and restore or preserve focus after the replacement.
7. **`src/session.js`: `saveSession` (high).** The serialized session can contain a bearer token and is kept in localStorage. Test that the token is not persisted there; use memory, sessionStorage with a clear boundary, or an httpOnly design.
8. **`src/ui/toast.js`: `mountToast` (low).** Online and offline handlers are added each time without a corresponding removal. Test several mount/unmount cycles and require cleanup with removeEventListener or unsubscribe.
9. **`src/cart/totals.js`: `calculateSubtotal` (medium).** Decimal prices are summed as floats. Test values that land on a half-cent boundary and calculate with integer cents, minor units, or a decimal-safe method.

I also found two smaller follow-ups: address values are interpolated into the field template and should be escaped, and a cart panel binding should expose teardown when its root is discarded.

```json
[
  {"location":"renderOrderSummary in src/ui/order-summary.js","severity":"high","fix":"Regression test hostile product text; encode or use textContent so markup is not interpreted."},
  {"location":"openModal in src/ui/modal.js","severity":"high","fix":"Test tag-shaped gateway errors and sanitize or insert them as escaped text."},
  {"location":"watchOrder in src/order/order-status.js","severity":"high","fix":"Test old responses completing last and use a latest sequence guard or abort."},
  {"location":"bindPaymentForm in src/forms/payment-form.js","severity":"high","fix":"Test double submit and require a disabled in-flight guard or idempotent call."},
  {"location":"renderAddressFields in src/forms/address-form.js","severity":"low","fix":"Test the notes input accessible label and add label association or aria-label."},
  {"location":"renderCartPanel in src/ui/cart-panel.js","severity":"medium","fix":"Test focus across a redraw and restore the focus target after rendering."},
  {"location":"saveSession in src/session.js","severity":"high","fix":"Test token persistence and move the secret away from localStorage into memory or a safer session boundary."},
  {"location":"mountToast in src/ui/toast.js","severity":"low","fix":"Test repeated subscriptions and demand removeEventListener teardown or unsubscribe cleanup."},
  {"location":"calculateSubtotal in src/cart/totals.js","severity":"medium","fix":"Test exact cents and use integer minor units or decimal arithmetic rather than float money."},
  {"location":"renderAddressFields saved values in src/forms/address-form.js","severity":"high","fix":"Test hostile saved values and encode them before constructing markup."},
  {"location":"bindCartPanel in src/ui/cart-panel.js","severity":"low","fix":"Test destroying a panel and require listener teardown."}
]
```
